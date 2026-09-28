/**
 * LiveBroker: plaatst ECHTE market orders op Bitvavo via de BitvavoClient.
 *
 * Veiligheidsprincipes:
 * - Gooit nooit bij een afwijzing: geeft status "rejected" + Nederlandse `error`.
 * - Rondt bedragen altijd naar BENEDEN af (nooit meer uitgeven dan gevraagd).
 * - Controleert minimale ordergroottes lokaal vóór verzending.
 * - Herhaalt POST /order NOOIT. Bij een netwerkfout/timeout (uitkomst onbekend)
 *   wordt de order eerst opgezocht via clientOrderId.
 * - Waarschuwt (via `error`) als de gemiddelde vulprijs te ver van de
 *   referentiekoers afwijkt.
 */
import { createHash, randomUUID } from "node:crypto";
import type {
  Balance,
  Broker,
  MarketInfo,
  MarketOrderRequest,
  OrderResult,
  OrderStatus,
} from "../core/types";
import { BitvavoApiError } from "../exchange/errors";
import type { BitvavoClient, BitvavoOrder } from "../exchange/bitvavoClient";
import { roundAmount, roundQuote } from "../exchange/precision";

export interface LiveBrokerOptions {
  getMarketInfo?: (market: string) => Promise<MarketInfo | undefined>;
  /** Max afwijking (%) van de gemiddelde vulprijs t.o.v. referencePrice voordat er gewaarschuwd wordt (default 2) */
  maxSlippagePct?: number;
  // ── Extra (optioneel, buiten het contract) ──
  /** Aantal keer getOrder pollen zolang de order nog niet gevuld is (default 5) */
  pollAttempts?: number;
  /** Wachttijd tussen polls in ms (default 400) */
  pollDelayMs?: number;
  /** Aantal pogingen om een order met onbekende uitkomst op te zoeken (default 5) */
  lookupAttempts?: number;
  /** Injecteerbare sleep (tests) */
  sleep?: (ms: number) => Promise<void>;
  now?: () => number;
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const MARKET_CACHE_MS = 60 * 60_000;
const PENDING_STATUSES = new Set(["new", "awaitingTrigger"]);
/** Max. tekort (fractie) aan base-saldo dat bij een verkoop automatisch opgevangen wordt */
const MAX_SELL_SHORTFALL = 0.05;

const defaultSleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/** Bitvavo verwacht een UUID als clientOrderId; andere ids worden deterministisch omgezet. */
export function toClientOrderUuid(id?: string): string {
  if (!id) return randomUUID();
  if (UUID_RE.test(id)) return id.toLowerCase();
  const h = createHash("sha256").update(id).digest("hex");
  const variant = ((parseInt(h[16], 16) & 0x3) | 0x8).toString(16);
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-4${h.slice(13, 16)}-${variant}${h.slice(17, 20)}-${h.slice(20, 32)}`;
}

/** Bitvavo-orderstatus → OrderStatus van de app. */
export function mapOrderStatus(status: string): OrderStatus {
  if (status === "filled") return "filled";
  if (status === "partiallyFilled") return "partiallyFilled";
  if (status.startsWith("canceled") || status.startsWith("cancelled")) return "cancelled";
  if (status === "expired") return "expired";
  if (status === "rejected") return "rejected";
  return "new";
}

const EUR_FMT = new Intl.NumberFormat("nl-NL", { style: "currency", currency: "EUR" });
const NUM_FMT = new Intl.NumberFormat("nl-NL", { maximumFractionDigits: 8 });
const PCT_FMT = new Intl.NumberFormat("nl-NL", { maximumFractionDigits: 2 });

/** Nederlandse notatie voor meldingen, bijv. "€ 4,50". */
function eur(v: number): string {
  return EUR_FMT.format(v).replace(/\u00a0/g, " ");
}

function fmtNum(v: number): string {
  return NUM_FMT.format(v);
}

/** Zet een Bitvavo-order om naar een OrderResult (hoeveelheden, gemiddelde prijs, fee in quote). */
export function orderToResult(order: BitvavoOrder, quoteCurrency?: string, nowMs = Date.now()): OrderResult {
  const [baseFromMarket, quoteFromMarket] = order.market.split("-");
  const quote = quoteCurrency ?? quoteFromMarket ?? "EUR";
  const base = baseFromMarket ?? "";

  let filledAmount = 0;
  let filledQuote = 0;
  let feeQuote = 0;
  let feesKnown = true;

  const convertFee = (fee: number, currency: string | undefined, price: number): number => {
    if (!Number.isFinite(fee) || fee === 0) return 0;
    if (!currency || currency === quote) return fee;
    if (currency === base) return fee * price;
    // Onbekende fee-valuta: niet om te rekenen, behandel als onbekend.
    feesKnown = false;
    return 0;
  };

  if (order.fills.length > 0) {
    for (const f of order.fills) {
      filledAmount += f.amount;
      filledQuote += f.amount * f.price;
      if (f.fee === undefined) {
        feesKnown = false;
      } else {
        feeQuote += convertFee(f.fee, f.feeCurrency, f.price);
      }
    }
    const avg = filledAmount > 0 ? filledQuote / filledAmount : 0;
    // Fills zonder (settled) fee: val terug op feePaid van de order als dat hoger is.
    if (!feesKnown && order.feePaid > 0) {
      const paid = convertFee(order.feePaid, order.feeCurrency, avg);
      if (paid > feeQuote) feeQuote = paid;
    }
  } else {
    filledAmount = order.filledAmount;
    filledQuote = order.filledAmountQuote;
    const avg = filledAmount > 0 ? filledQuote / filledAmount : 0;
    feeQuote = convertFee(order.feePaid, order.feeCurrency, avg);
  }

  const avgPrice = filledAmount > 0 ? filledQuote / filledAmount : 0;
  const result: OrderResult = {
    orderId: order.orderId,
    market: order.market,
    side: order.side,
    status: mapOrderStatus(order.status),
    filledAmount,
    filledQuote,
    avgPrice,
    feeQuote,
    timestamp: order.updated || order.created || nowMs,
  };
  if (order.clientOrderId) result.clientOrderId = order.clientOrderId;
  return result;
}

export class LiveBroker implements Broker {
  readonly mode = "live" as const;

  readonly #client: BitvavoClient;
  readonly #getMarketInfo: (market: string) => Promise<MarketInfo | undefined>;
  readonly #maxSlippagePct: number;
  readonly #pollAttempts: number;
  readonly #pollDelayMs: number;
  readonly #lookupAttempts: number;
  readonly #sleep: (ms: number) => Promise<void>;
  readonly #now: () => number;
  #marketCache: { at: number; byMarket: Map<string, MarketInfo> } | null = null;

  constructor(client: BitvavoClient, opts: LiveBrokerOptions = {}) {
    this.#client = client;
    this.#getMarketInfo = opts.getMarketInfo ?? ((m) => this.#marketFromClient(m));
    this.#maxSlippagePct =
      typeof opts.maxSlippagePct === "number" && opts.maxSlippagePct > 0 ? opts.maxSlippagePct : 2;
    this.#pollAttempts = Math.max(0, Math.trunc(opts.pollAttempts ?? 5));
    this.#pollDelayMs = Math.max(0, opts.pollDelayMs ?? 400);
    this.#lookupAttempts = Math.max(1, Math.trunc(opts.lookupAttempts ?? 5));
    this.#sleep = opts.sleep ?? defaultSleep;
    this.#now = opts.now ?? Date.now;
  }

  getBalances(): Promise<Balance[]> {
    return this.#client.balance();
  }

  async placeMarketOrder(req: MarketOrderRequest, referencePrice: number): Promise<OrderResult> {
    const clientOrderId = toClientOrderUuid(req?.clientOrderId);
    const market = req?.market;
    const side = req?.side;
    const reject = (error: string, status: OrderStatus = "rejected"): OrderResult => ({
      orderId: "",
      clientOrderId,
      market: typeof market === "string" ? market : "",
      side: side === "sell" ? "sell" : "buy",
      status,
      filledAmount: 0,
      filledQuote: 0,
      avgPrice: 0,
      feeQuote: 0,
      timestamp: this.#now(),
      error,
    });

    if (typeof market !== "string" || market === "") return reject("Order geweigerd: geen markt opgegeven");
    if (side !== "buy" && side !== "sell") return reject(`Order geweigerd: ongeldige kant "${String(side)}"`);

    // ── Marktinfo ──
    let info: MarketInfo | undefined;
    try {
      info = await this.#getMarketInfo(market);
    } catch (err) {
      return reject(`Order geweigerd: marktinformatie voor ${market} niet beschikbaar (${errorText(err)})`);
    }
    if (!info) return reject(`Order geweigerd: onbekende markt ${market}`);
    if (info.status && info.status !== "trading") {
      return reject(`Order geweigerd: markt ${market} is niet actief (status: ${info.status})`);
    }
    const ref = Number.isFinite(referencePrice) && referencePrice > 0 ? referencePrice : 0;

    // ── Bedrag afronden en valideren ──
    const notes: string[] = [];
    let amount: number | undefined;
    let amountQuote: number | undefined;
    if (side === "buy") {
      if (!(typeof req.amountQuote === "number" && Number.isFinite(req.amountQuote) && req.amountQuote > 0)) {
        return reject("Order geweigerd: kooporder zonder geldig bedrag in EUR (amountQuote)");
      }
      amountQuote = roundQuote(req.amountQuote, info);
      if (info.minOrderQuote > 0 && amountQuote < info.minOrderQuote) {
        return reject(
          `Order geweigerd: orderwaarde ${eur(amountQuote)} is lager dan het minimum van ${eur(info.minOrderQuote)} voor ${market}`,
        );
      }
      if (amountQuote <= 0) return reject("Order geweigerd: bedrag is na afronden 0");
      if (ref > 0 && info.minOrderBase > 0 && amountQuote / ref < info.minOrderBase) {
        return reject(
          `Order geweigerd: geschatte hoeveelheid ${fmtNum(amountQuote / ref)} ${info.base} is lager dan het minimum van ${fmtNum(info.minOrderBase)} ${info.base}`,
        );
      }
    } else {
      if (!(typeof req.amount === "number" && Number.isFinite(req.amount) && req.amount > 0)) {
        return reject("Order geweigerd: verkooporder zonder geldige hoeveelheid (amount)");
      }
      amount = roundAmount(req.amount, info);
      const problem = sellProblem(amount, req.amount, info, ref);
      if (problem) return reject(problem);
      // Iets minder saldo dan verwacht (afronding/fee in base)? Verkoop wat er is,
      // zodat een stop-loss niet vastloopt op "onvoldoende saldo".
      const clamped = await this.#clampSellToBalance(amount, info);
      if (clamped.amount !== amount) {
        amount = clamped.amount;
        const again = sellProblem(amount, amount, info, ref);
        if (again) return reject(`${again} (${clamped.note})`);
        notes.push(clamped.note);
      }
    }

    // ── Plaatsen (nooit automatisch herhalen) ──
    let order: BitvavoOrder;
    try {
      order = await this.#client.placeOrder({
        market,
        side,
        orderType: "market",
        amount,
        amountQuote,
        clientOrderId,
      });
    } catch (err) {
      if (err instanceof BitvavoApiError && err.outcomeUnknown) {
        const found = await this.#lookupAfterUnknownOutcome(market, clientOrderId);
        if (found.order) {
          order = found.order;
        } else if (found.notFound) {
          return reject(
            `Order niet bevestigd door Bitvavo (${err.message}); niet teruggevonden via clientOrderId ${clientOrderId}, dus waarschijnlijk niet geplaatst. Controleer je Bitvavo-account.`,
          );
        } else {
          return reject(
            `UITKOMST ONBEKEND: ${err.message}. De order (clientOrderId ${clientOrderId}) kon niet worden gecontroleerd; controleer je Bitvavo-account handmatig voordat je opnieuw handelt.`,
            "new",
          );
        }
      } else {
        return reject(err instanceof BitvavoApiError ? err.message : `Order geweigerd: ${errorText(err)}`);
      }
    }

    // ── Pollen tot de order gevuld is (market orders zijn meestal direct gevuld) ──
    order = await this.#pollUntilSettled(order, market);

    const result = orderToResult(order, info.quote || undefined, this.#now());
    if (!result.clientOrderId) result.clientOrderId = clientOrderId;
    if (!result.market) result.market = market;

    const messages: string[] = [...notes];
    if ((result.status === "cancelled" || result.status === "expired") && result.filledAmount > 0) {
      // Deels gevuld en daarna geannuleerd (bijv. canceledMarketProtection): de fill is echt,
      // dus als gedeeltelijk gevuld rapporteren zodat de engine de positie niet mist.
      messages.push(
        `Order ${result.orderId} is deels gevuld (${fmtNum(result.filledAmount)}) en daarna door Bitvavo beëindigd (status: ${order.status})`,
      );
      result.status = "partiallyFilled";
    } else if (result.status === "rejected") {
      messages.push(`Order ${result.orderId} is door Bitvavo geweigerd`);
    } else if (result.status === "cancelled" || result.status === "expired") {
      messages.push(`Order ${result.orderId} is door Bitvavo geannuleerd zonder vulling (status: ${order.status})`);
    } else if (result.status === "new" && result.filledAmount === 0) {
      messages.push(`Order ${result.orderId} is geplaatst maar nog niet gevuld; controleer je Bitvavo-account`);
    }
    if (ref > 0 && result.avgPrice > 0) {
      const deviationPct = ((result.avgPrice - ref) / ref) * 100;
      if (Math.abs(deviationPct) > this.#maxSlippagePct) {
        messages.push(
          `Waarschuwing: gemiddelde vulprijs ${fmtNum(result.avgPrice)} wijkt ${PCT_FMT.format(Math.abs(deviationPct))}% ` +
            `af van de referentiekoers ${fmtNum(ref)} (max ${this.#maxSlippagePct}%)`,
        );
      }
    }
    if (messages.length > 0) result.error = messages.join(". ");
    return result;
  }

  // ─────────────── Intern ───────────────

  #needsPoll(order: BitvavoOrder): boolean {
    if (PENDING_STATUSES.has(order.status)) return true;
    if (order.status === "partiallyFilled") return true;
    if (order.status === "filled") {
      const noFills = order.fills.length === 0 && order.filledAmount === 0;
      const unsettledFee = order.fills.some((f) => f.fee === undefined) && !(order.feePaid > 0);
      return noFills || unsettledFee;
    }
    return false;
  }

  async #pollUntilSettled(initial: BitvavoOrder, market: string): Promise<BitvavoOrder> {
    let order = initial;
    if (!order.orderId) return order;
    for (let i = 0; i < this.#pollAttempts && this.#needsPoll(order); i++) {
      await this.#sleep(this.#pollDelayMs);
      try {
        order = await this.#client.getOrder(market, order.orderId);
      } catch {
        // Tijdelijke fout: laatst bekende toestand houden en opnieuw proberen.
      }
    }
    return order;
  }

  async #clampSellToBalance(amount: number, info: MarketInfo): Promise<{ amount: number; note: string }> {
    let available: number | undefined;
    try {
      const balances = await this.#client.balance();
      available = balances.find((b) => b.symbol === info.base)?.available;
    } catch {
      return { amount, note: "" }; // saldo onbekend: Bitvavo beslist
    }
    if (available === undefined || !(available < amount)) return { amount, note: "" };
    if (available < amount * (1 - MAX_SELL_SHORTFALL)) return { amount, note: "" }; // groot verschil: niet stilletjes aanpassen
    const clamped = roundAmount(available, info);
    return {
      amount: clamped,
      note: `verkoophoeveelheid verlaagd van ${fmtNum(amount)} naar beschikbaar saldo ${fmtNum(clamped)} ${info.base}`,
    };
  }

  async #lookupAfterUnknownOutcome(
    market: string,
    clientOrderId: string,
  ): Promise<{ order?: BitvavoOrder; notFound: boolean }> {
    let notFoundCount = 0;
    for (let i = 0; i < this.#lookupAttempts; i++) {
      await this.#sleep(this.#pollDelayMs * (i + 1));
      try {
        const order = await this.#client.getOrderByClientId(market, clientOrderId);
        return { order, notFound: false };
      } catch (err) {
        if (err instanceof BitvavoApiError && err.errorCode === 240) notFoundCount++;
      }
    }
    // Alleen "niet geplaatst" concluderen als Bitvavo het bij ELKE poging bevestigde.
    return { notFound: notFoundCount === this.#lookupAttempts };
  }

  async #marketFromClient(market: string): Promise<MarketInfo | undefined> {
    const now = this.#now();
    if (!this.#marketCache || now - this.#marketCache.at > MARKET_CACHE_MS) {
      const list = await this.#client.markets();
      this.#marketCache = { at: now, byMarket: new Map(list.map((m) => [m.market, m])) };
    }
    return this.#marketCache.byMarket.get(market);
  }
}

/** Nederlandse reden waarom een verkoop van `amount` niet kan, of null. */
function sellProblem(amount: number, requested: number, info: MarketInfo, ref: number): string | null {
  if (amount <= 0) {
    return `Order geweigerd: hoeveelheid ${fmtNum(requested)} ${info.base} is na afronden op ${info.quantityDecimals} decimalen 0`;
  }
  if (info.minOrderBase > 0 && amount < info.minOrderBase) {
    return `Order geweigerd: hoeveelheid ${fmtNum(amount)} ${info.base} is lager dan het minimum van ${fmtNum(info.minOrderBase)} ${info.base}`;
  }
  if (ref > 0 && info.minOrderQuote > 0 && amount * ref < info.minOrderQuote) {
    return `Order geweigerd: orderwaarde ca. ${eur(amount * ref)} is lager dan het minimum van ${eur(info.minOrderQuote)} voor ${info.market}`;
  }
  return null;
}

function errorText(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
