/**
 * LiveBroker: plaatst ECHTE market orders op Bitvavo via de BitvavoClient.
 *
 * Veiligheidsprincipes:
 * - Gooit nooit bij een afwijzing: geeft status "rejected" + Nederlandse `error`.
 * - Rondt bedragen altijd naar BENEDEN af (nooit meer uitgeven dan gevraagd).
 * - Controleert minimale ordergroottes lokaal vóór verzending. Een verkoop onder
 *   het beursminimum (ook na het verlagen naar het beschikbare saldo) wordt
 *   niet verstuurd: status "rejected" met een `error` die begint met
 *   "ONVERKOOPBAAR:".
 * - Herhaalt POST /order NOOIT. Bij een netwerkfout/timeout (uitkomst onbekend)
 *   wordt de order eerst opgezocht via clientOrderId.
 * - Laat nooit een order open staan: staat een market order na het pollen nog
 *   open, dan wordt hij geannuleerd en de eindstatus opgehaald.
 * - Is de uitkomst niet zeker (order niet teruggevonden, annuleren niet
 *   bevestigd, status niet op te halen), dan begint `error` met
 *   "UITKOMST ONBEKEND" (status "new", of "partiallyFilled" als er al iets
 *   gevuld is), zodat de engine niet blind opnieuw handelt.
 * - Schat de fee (taker-fee) als Bitvavo die nog niet heeft afgerekend.
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
  /**
   * Aantal pogingen om een order die na het pollen nog open staat te annuleren
   * en de eindstatus op te halen (default 3)
   */
  cancelAttempts?: number;
  /**
   * Taker-fee (fractie) voor de schatting als Bitvavo de fee van een fill nog
   * niet heeft afgerekend (default 0.0025). Bij te werken via `setCosts`.
   */
  takerFee?: number;
  /** Injecteerbare sleep (tests) */
  sleep?: (ms: number) => Promise<void>;
  now?: () => number;
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const MARKET_CACHE_MS = 60 * 60_000;
const PENDING_STATUSES = new Set(["new", "awaitingTrigger"]);
/** Max. tekort (fractie) aan base-saldo dat bij een verkoop automatisch opgevangen wordt */
const MAX_SELL_SHORTFALL = 0.05;
const DEFAULT_TAKER_FEE = 0.0025;
/** Annuleer-fouten waarbij de order al niet meer open is (niet gevonden / niet meer actief). */
const CANCEL_NOT_OPEN_CODES = new Set([233, 240]);
/**
 * Voorvoegsel van `error` als een verkoop lokaal geweigerd is omdat hij onder
 * het beursminimum zou uitkomen (niets verstuurd; opnieuw proberen bij deze
 * koers heeft geen zin).
 */
export const UNSELLABLE_PREFIX = "ONVERKOOPBAAR:";

/**
 * Eindstatus: de order kan niet meer (verder) vullen. Alles wat niet
 * gevuld/geannuleerd/verlopen/geweigerd is (new, awaitingTrigger,
 * partiallyFilled of een onbekende nieuwe status) staat mogelijk nog open.
 */
export function isFinalOrderStatus(status: string): boolean {
  const mapped = mapOrderStatus(status);
  return mapped === "filled" || mapped === "cancelled" || mapped === "expired" || mapped === "rejected";
}

function validTakerFee(fee: unknown): fee is number {
  return typeof fee === "number" && Number.isFinite(fee) && fee >= 0 && fee < 0.1;
}

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
const SIG_FMT = new Intl.NumberFormat("nl-NL", { maximumSignificantDigits: 8 });
const PCT_FMT = new Intl.NumberFormat("nl-NL", { maximumFractionDigits: 2 });

/** Nederlandse notatie voor meldingen, bijv. "€ 4,50". */
function eur(v: number): string {
  return EUR_FMT.format(v).replace(/\u00a0/g, " ");
}

function fmtNum(v: number): string {
  return NUM_FMT.format(v);
}

/** Orderwaarde naar beneden op centen (een waarde onder het minimum mag niet als "€ 5,00" verschijnen). */
function eurFloor(v: number): string {
  return eur(Math.floor(v * 100 + 1e-9) / 100);
}

/** Zet een Bitvavo-order om naar een OrderResult (hoeveelheden, gemiddelde prijs, fee in quote). */
export function orderToResult(order: BitvavoOrder, quoteCurrency?: string, nowMs = Date.now()): OrderResult {
  return summarizeOrder(order, quoteCurrency, nowMs).result;
}

interface OrderSummary {
  result: OrderResult;
  /** Som van de bekende fill-fees (in quote) */
  knownFillFeeQuote: number;
  /**
   * Gevulde waarde (quote) waarvan de fee nog NIET bekend is: fills die Bitvavo
   * nog niet heeft afgerekend (geen `fee`) of met een onbekende fee-valuta.
   */
  unknownFeeFilledQuote: number;
}

function summarizeOrder(order: BitvavoOrder, quoteCurrency?: string, nowMs = Date.now()): OrderSummary {
  const [baseFromMarket, quoteFromMarket] = order.market.split("-");
  const quote = quoteCurrency ?? quoteFromMarket ?? "EUR";
  const base = baseFromMarket ?? "";

  let filledAmount = 0;
  let filledQuote = 0;
  let feeQuote = 0;
  let feesKnown = true;
  let unknownFeeFilledQuote = 0;

  /** Fee omgerekend naar quote, of null als de fee-valuta onbekend is. */
  const convertFee = (fee: number, currency: string | undefined, price: number): number | null => {
    if (!Number.isFinite(fee) || fee === 0) return 0;
    if (!currency || currency === quote) return fee;
    if (currency === base) return fee * price;
    // Onbekende fee-valuta: niet om te rekenen, behandel als onbekend.
    return null;
  };

  if (order.fills.length > 0) {
    for (const f of order.fills) {
      filledAmount += f.amount;
      filledQuote += f.amount * f.price;
      const converted = f.fee === undefined ? null : convertFee(f.fee, f.feeCurrency, f.price);
      if (converted === null) {
        feesKnown = false;
        unknownFeeFilledQuote += f.amount * f.price;
      } else {
        feeQuote += converted;
      }
    }
  } else {
    filledAmount = order.filledAmount;
    filledQuote = order.filledAmountQuote;
    const avg = filledAmount > 0 ? filledQuote / filledAmount : 0;
    const converted = convertFee(order.feePaid, order.feeCurrency, avg);
    if (converted === null) {
      feesKnown = false;
      unknownFeeFilledQuote = filledQuote;
    } else {
      feeQuote = converted;
    }
  }
  const knownFillFeeQuote = feeQuote;
  if (!feesKnown && order.fills.length > 0 && order.feePaid > 0) {
    // Fills zonder (settled) fee: val terug op feePaid van de order als dat hoger is.
    const avg = filledAmount > 0 ? filledQuote / filledAmount : 0;
    const paid = convertFee(order.feePaid, order.feeCurrency, avg);
    if (paid !== null && paid > feeQuote) feeQuote = paid;
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
  return { result, knownFillFeeQuote, unknownFeeFilledQuote };
}

export class LiveBroker implements Broker {
  readonly mode = "live" as const;

  readonly #client: BitvavoClient;
  readonly #getMarketInfo: (market: string) => Promise<MarketInfo | undefined>;
  readonly #maxSlippagePct: number;
  readonly #pollAttempts: number;
  readonly #pollDelayMs: number;
  readonly #lookupAttempts: number;
  readonly #cancelAttempts: number;
  readonly #sleep: (ms: number) => Promise<void>;
  readonly #now: () => number;
  #takerFee: number;
  #marketCache: { at: number; byMarket: Map<string, MarketInfo> } | null = null;

  constructor(client: BitvavoClient, opts: LiveBrokerOptions = {}) {
    this.#client = client;
    this.#getMarketInfo = opts.getMarketInfo ?? ((m) => this.#marketFromClient(m));
    this.#maxSlippagePct =
      typeof opts.maxSlippagePct === "number" && opts.maxSlippagePct > 0 ? opts.maxSlippagePct : 2;
    this.#pollAttempts = Math.max(0, Math.trunc(opts.pollAttempts ?? 5));
    this.#pollDelayMs = Math.max(0, opts.pollDelayMs ?? 400);
    this.#lookupAttempts = Math.max(1, Math.trunc(opts.lookupAttempts ?? 5));
    this.#cancelAttempts = Math.max(1, Math.trunc(opts.cancelAttempts ?? 3));
    this.#takerFee = validTakerFee(opts.takerFee) ? opts.takerFee : DEFAULT_TAKER_FEE;
    this.#sleep = opts.sleep ?? defaultSleep;
    this.#now = opts.now ?? Date.now;
  }

  /** Huidige taker-fee (fractie) die gebruikt wordt om een nog niet afgerekende fee te schatten. */
  get takerFee(): number {
    return this.#takerFee;
  }

  /**
   * Zelfde (duck-typed) hook als PaperBroker: houdt de fee-schatting gelijk aan
   * `config.risk.takerFee`. Slippage speelt bij echte orders geen rol.
   */
  setCosts(takerFee: number, _slippagePct?: number): void {
    if (validTakerFee(takerFee)) this.#takerFee = takerFee;
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
      // zodat een stop-loss niet vastloopt op "onvoldoende saldo". Maar NOOIT onder
      // het beursminimum: zo'n order weigert Bitvavo toch, dus niets versturen.
      const clamped = await this.#clampSellToBalance(amount, info);
      if (clamped.amount !== amount) {
        const again = sellProblem(clamped.amount, clamped.amount, info, ref);
        if (again) {
          return reject(
            `${UNSELLABLE_PREFIX} op Bitvavo staat maar ${fmtNum(clamped.amount)} ${info.base} beschikbaar ` +
              `(gevraagd: ${fmtNum(amount)} ${info.base}); ${again.slice(UNSELLABLE_PREFIX.length).trim()}`,
          );
        }
        amount = clamped.amount;
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
          // "Niet gevonden" is geen bewijs: na een timeout/109 kan de order nog in de
          // wachtrij staan of is de lookup nog niet bijgewerkt. Dus NIET als afwijzing
          // melden (dan zou de engine opnieuw kopen/verkopen), maar als onbekende uitkomst.
          return reject(
            `UITKOMST ONBEKEND: ${err.message}. De order (clientOrderId ${clientOrderId}) is niet teruggevonden bij Bitvavo — waarschijnlijk niet geplaatst, maar dat is niet zeker. Controleer je Bitvavo-account voordat je opnieuw handelt.`,
            "new",
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

    return this.#settleAndReport(order, {
      market,
      base: info.base,
      quote: info.quote || undefined,
      ref,
      notes,
      clientOrderId,
    });
  }

  /**
   * Zoekt een eerder geplaatste order op via de eigen clientOrderId (bijv. een
   * order met een onbekende uitkomst); contract: `Broker.lookupOrder`.
   * - `null`: Bitvavo meldt dat er geen order met deze clientOrderId is (code
   *   240, één poging).
   * - Gooit als de uitkomst nog onbekend is (netwerk, timeout, rate limit, ...):
   *   later opnieuw proberen.
   * - Anders een OrderResult met de BEVESTIGDE eindtoestand: een order die nog
   *   open staat wordt eerst geannuleerd. Status is dan "filled", "cancelled",
   *   "expired" of "rejected" (ook bij een deels gevulde, daarna beëindigde
   *   order: `filledAmount` > 0 met status "cancelled"/"expired"). Is annuleren
   *   niet bevestigd (of de gevulde hoeveelheid onbekend), dan begint `error`
   *   met "UITKOMST ONBEKEND" en is de status "new" of "partiallyFilled".
   */
  async lookupOrder(market: string, clientOrderId: string): Promise<OrderResult | null> {
    if (typeof market !== "string" || market === "" || typeof clientOrderId !== "string" || clientOrderId === "") {
      throw new Error("Order opzoeken: markt en clientOrderId zijn verplicht");
    }
    const cid = toClientOrderUuid(clientOrderId);
    let order: BitvavoOrder;
    try {
      order = await this.#client.getOrderByClientId(market, cid);
    } catch (err) {
      if (err instanceof BitvavoApiError && err.errorCode === 240) return null;
      throw err;
    }
    let info: MarketInfo | undefined;
    try {
      info = await this.#getMarketInfo(market);
    } catch {
      info = undefined; // alleen nodig voor de valuta's; die volgen ook uit de marktnaam
    }
    const [baseFromMarket, quoteFromMarket] = market.split("-");
    return this.#settleAndReport(order, {
      market,
      base: info?.base || baseFromMarket || "",
      quote: info?.quote || quoteFromMarket || undefined,
      ref: 0,
      notes: [],
      clientOrderId: cid,
      keepFinalStatus: true,
    });
  }

  // ─────────────── Intern ───────────────

  /**
   * Wacht tot een geplaatste order klaar is, annuleert hem als hij open blijft,
   * en zet hem om naar een OrderResult met Nederlandse meldingen in `error`.
   */
  async #settleAndReport(
    placed: BitvavoOrder,
    ctx: {
      market: string;
      base: string;
      quote?: string;
      ref: number;
      notes: string[];
      clientOrderId: string;
      /**
       * lookupOrder: een deels gevulde, daarna beëindigde order houdt zijn
       * eindstatus ("cancelled"/"expired") i.p.v. "partiallyFilled", zodat de
       * aanroeper ziet dat hij klaar is (placeMarketOrder meldt "partiallyFilled").
       */
      keepFinalStatus?: boolean;
    },
  ): Promise<OrderResult> {
    const { market, ref, notes, clientOrderId } = ctx;
    const info = { base: ctx.base, quote: ctx.quote };
    // ── Pollen tot de order gevuld is (market orders zijn meestal direct gevuld) ──
    let order = await this.#pollUntilSettled(placed, market);

    // ── Nog open (of status niet te controleren)? Annuleren en de eindstatus ophalen. ──
    // Een open order mag nooit "vergeten" worden: hij kan later alsnog (verder) vullen
    // terwijl de engine denkt dat hij afgewezen of maar deels gevuld is.
    let stillOpen = false;
    let cancelledByBot = false;
    if (!isFinalOrderStatus(order.status)) {
      const settled = await this.#cancelAndConfirm(order, market);
      order = settled.order;
      stillOpen = !settled.final;
      cancelledByBot = settled.final && mapOrderStatus(order.status) === "cancelled";
    }

    const summary = summarizeOrder(order, info.quote, this.#now());
    const result = summary.result;
    if (!result.clientOrderId) result.clientOrderId = clientOrderId;
    if (!result.market) result.market = market;

    // Een onbekende uitkomst moet VOORAAN in `error` staan: de engine herkent die aan het
    // voorvoegsel "UITKOMST ONBEKEND" (en blokkeert dan de markt / controleert het saldo).
    let unknownNote: string | null = null;
    let statusNote: string | null = null;
    if (stillOpen) {
      const filledPart = result.filledAmount > 0 ? `${fmtNum(result.filledAmount)} ${info.base}` : "niets";
      unknownNote =
        `UITKOMST ONBEKEND: order ${result.orderId} is nog open of niet te controleren (status: ${order.status}, tot nu toe gevuld: ${filledPart}); ` +
        `annuleren is niet bevestigd, dus de order kan nog (verder) uitgevoerd worden. Controleer je Bitvavo-account voordat je opnieuw handelt`;
      result.status = result.filledAmount > 0 ? "partiallyFilled" : "new";
    } else if (result.status === "filled" && result.filledAmount <= 0) {
      // Volgens Bitvavo uitgevoerd, maar zonder gevulde hoeveelheid: niet als afwijzing behandelen.
      unknownNote = `UITKOMST ONBEKEND: order ${result.orderId} is volgens Bitvavo gevuld, maar de gevulde hoeveelheid is niet bekend. Controleer je Bitvavo-account voordat je opnieuw handelt`;
      result.status = "new";
    } else if ((result.status === "cancelled" || result.status === "expired") && result.filledAmount > 0) {
      // Deels gevuld en daarna beëindigd (bijv. canceledMarketProtection, of door de bot
      // geannuleerd na het wachten): de fill is echt, dus als gedeeltelijk gevuld rapporteren
      // zodat de engine de positie niet mist. De order is klaar; de rest wordt niet meer uitgevoerd.
      statusNote = cancelledByBot
        ? `Order ${result.orderId} was na het wachten nog niet volledig gevuld en is door de bot geannuleerd; alleen het gevulde deel (${fmtNum(result.filledAmount)} ${info.base}) is uitgevoerd`
        : `Order ${result.orderId} is deels gevuld (${fmtNum(result.filledAmount)}) en daarna door Bitvavo beëindigd (status: ${order.status})`;
      if (!ctx.keepFinalStatus) result.status = "partiallyFilled";
    } else if (result.status === "rejected") {
      statusNote = `Order ${result.orderId} is door Bitvavo geweigerd`;
    } else if (result.status === "cancelled" || result.status === "expired") {
      statusNote = cancelledByBot
        ? `Order ${result.orderId} was na het wachten nog niet gevuld en is door de bot geannuleerd (status: ${order.status}); er is niets uitgevoerd`
        : `Order ${result.orderId} is door Bitvavo geannuleerd zonder vulling (status: ${order.status})`;
    }
    const messages: string[] = [];
    if (unknownNote) messages.push(unknownNote);
    messages.push(...notes);
    if (statusNote) messages.push(statusNote);
    // Fee nog niet (volledig) afgerekend door Bitvavo: niet stil op €0 laten staan, maar schatten.
    if (summary.unknownFeeFilledQuote > 0 && result.filledQuote > 0) {
      const estimate = summary.knownFillFeeQuote + summary.unknownFeeFilledQuote * this.#takerFee;
      if (estimate > result.feeQuote) {
        result.feeQuote = estimate;
        messages.push(
          `fee nog niet door Bitvavo afgerekend; geschat op ${eur(estimate)} (${PCT_FMT.format(this.#takerFee * 100)}% taker-fee)`,
        );
      }
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

  /**
   * Annuleert een order die na het pollen nog open staat (of waarvan de status
   * niet op te halen was) en haalt daarna de eindstatus op. Een annulering van
   * een order die intussen al gevuld is geeft een fout; die is onschuldig, de
   * opgehaalde status beslist. `final` = Bitvavo bevestigt een eindstatus.
   */
  async #cancelAndConfirm(initial: BitvavoOrder, market: string): Promise<{ order: BitvavoOrder; final: boolean }> {
    let order = initial;
    if (!order.orderId) return { order, final: false };
    let cancelSettled = false;
    for (let i = 0; i < this.#cancelAttempts; i++) {
      if (!cancelSettled) {
        try {
          await this.#client.cancelOrder(market, order.orderId);
          cancelSettled = true;
        } catch (err) {
          // Niet (meer) open (240/233): niet opnieuw annuleren. Andere fouten (netwerk,
          // rate limit, 5xx): bij de volgende poging opnieuw annuleren als hij nog open is.
          if (err instanceof BitvavoApiError && err.errorCode !== null && CANCEL_NOT_OPEN_CODES.has(err.errorCode)) {
            cancelSettled = true;
          }
        }
      }
      await this.#sleep(this.#pollDelayMs);
      try {
        order = await this.#client.getOrder(market, order.orderId);
      } catch {
        continue; // tijdelijke fout: opnieuw proberen
      }
      if (isFinalOrderStatus(order.status)) return { order, final: true };
    }
    return { order, final: false };
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

/**
 * Nederlandse reden waarom een verkoop van `amount` niet kan (onder het
 * beursminimum of na afronden 0), of null. Begint altijd met
 * "ONVERKOOPBAAR:": de engine herkent daaraan dat opnieuw proberen bij deze
 * koers geen zin heeft (er is niets naar Bitvavo gestuurd).
 */
function sellProblem(amount: number, requested: number, info: MarketInfo, ref: number): string | null {
  const advice = "er is niets naar Bitvavo gestuurd. Wacht tot de waarde boven het minimum komt of schrijf de positie af";
  if (amount <= 0) {
    return `${UNSELLABLE_PREFIX} hoeveelheid ${SIG_FMT.format(requested)} ${info.base} is na afronden op ${info.quantityDecimals} decimalen 0 (te klein om te verkopen); ${advice}`;
  }
  if (info.minOrderBase > 0 && amount < info.minOrderBase) {
    return `${UNSELLABLE_PREFIX} hoeveelheid ${fmtNum(amount)} ${info.base} is lager dan het beursminimum van ${fmtNum(info.minOrderBase)} ${info.base} voor ${info.market}; ${advice}`;
  }
  if (ref > 0 && info.minOrderQuote > 0 && amount * ref < info.minOrderQuote) {
    return `${UNSELLABLE_PREFIX} orderwaarde ca. ${eurFloor(amount * ref)} is lager dan het beursminimum van ${eur(info.minOrderQuote)} voor ${info.market}; ${advice}`;
  }
  return null;
}

function errorText(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
