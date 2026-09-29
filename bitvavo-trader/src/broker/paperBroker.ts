/**
 * PaperBroker: simuleert market orders met fees en slippage, zonder echt geld.
 *
 * Koop met `amountQuote = Q` (EUR inclusief fee):
 *   fee = Q − Q / (1 + takerFee); vulprijs = ref × (1 + slippage); amount = (Q − fee) / vulprijs
 * Verkoop met `amount`:
 *   vulprijs = ref × (1 − slippage); bruto = amount × vulprijs; fee = bruto × takerFee
 *
 * Afwijzingen geven status "rejected" met een Nederlandse foutmelding terug
 * (er wordt nooit gegooid). Een verkoop onder het beursminimum begint met
 * "ONVERKOOPBAAR:" (zelfde voorvoegsel als de LiveBroker).
 *
 * Minimale ordergrootte = het BEURSminimum (Bitvavo: €5, of de per-markt
 * waarden uit `getMarketInfo`), NOOIT de instelling `risk.minOrderQuote` van
 * de gebruiker: paper moet dezelfde orders weigeren als Bitvavo, niet meer en
 * niet minder.
 */
import type { Balance, Broker, MarketInfo, MarketOrderRequest, OrderResult, TradingMode } from "../core/types";
import { newId } from "../core/util";

export interface PaperBrokerOptions {
  startingQuote: number;
  takerFee: number;
  slippagePct: number;
  now?: () => number;
  /** Quote-valuta (standaard "EUR") */
  quote?: string;
  /**
   * Beursminimum per order in quote als er geen marktinfo is (standaard 5, zoals
   * Bitvavo). Niet vullen met `risk.minOrderQuote` (dat is een risico-instelling).
   */
  minOrderQuote?: number;
  /**
   * Optioneel: marktinfo van de beurs (per-markt `minOrderQuote`/`minOrderBase`).
   * Ontbreekt de info (of faalt het ophalen), dan geldt `minOrderQuote`.
   */
  getMarketInfo?: (market: string) => MarketInfo | undefined | Promise<MarketInfo | undefined>;
}

/** Zelfde voorvoegsel als LiveBroker: verkoop onder het beursminimum, opnieuw proberen heeft geen zin. */
const UNSELLABLE_PREFIX = "ONVERKOOPBAAR:";
const DEFAULT_TAKER_FEE = 0.0025;
const DEFAULT_MIN_ORDER_QUOTE = 5;

/** Absolute tolerantie voor afrondingsruis bij EUR-bedragen. */
const QUOTE_EPS = 1e-8;
/** Relatieve tolerantie voor afrondingsruis bij base-hoeveelheden. */
const REL_EPS = 1e-9;

function isPosNum(v: unknown): v is number {
  return typeof v === "number" && Number.isFinite(v) && v > 0;
}

function fmtEur(v: number): string {
  return `€${v.toFixed(2).replace(".", ",")}`;
}

/** Fee/slippage als fractie: eindig, >= 0 en < 10% (zelfde grens als LiveBroker). */
function validCostFraction(v: unknown): v is number {
  return typeof v === "number" && Number.isFinite(v) && v >= 0 && v < 0.1;
}

/** Beursminima voor één order. */
interface OrderMinimums {
  quote: number;
  base: number;
}

export class PaperBroker implements Broker {
  readonly mode: TradingMode = "paper";
  private readonly quote: string;
  private takerFee: number;
  private slippagePct: number;
  private readonly minOrderQuote: number;
  private readonly getMarketInfo?: PaperBrokerOptions["getMarketInfo"];
  private readonly nowFn: () => number;
  /** Totale saldi per symbool (paper kent geen openstaande orders) */
  private balances = new Map<string, number>();

  constructor(opts: PaperBrokerOptions) {
    this.quote = (opts.quote ?? "EUR").toUpperCase();
    this.takerFee = validCostFraction(opts.takerFee) ? opts.takerFee : DEFAULT_TAKER_FEE;
    this.slippagePct = validCostFraction(opts.slippagePct) ? opts.slippagePct : 0;
    this.minOrderQuote =
      opts.minOrderQuote !== undefined && Number.isFinite(opts.minOrderQuote) && opts.minOrderQuote >= 0
        ? opts.minOrderQuote
        : DEFAULT_MIN_ORDER_QUOTE;
    this.getMarketInfo = typeof opts.getMarketInfo === "function" ? opts.getMarketInfo : undefined;
    this.nowFn = opts.now ?? (() => Date.now());
    this.reset(opts.startingQuote);
  }

  async getBalances(): Promise<Balance[]> {
    const out: Balance[] = [{ symbol: this.quote, available: this.get(this.quote), inOrder: 0 }];
    const others = [...this.balances.entries()]
      .filter(([sym, amt]) => sym !== this.quote && amt > 0)
      .sort((a, b) => a[0].localeCompare(b[0]));
    for (const [symbol, available] of others) out.push({ symbol, available, inOrder: 0 });
    return out;
  }

  /** Zet de saldi terug (bijv. uit de opgeslagen state). */
  restore(balances: Balance[]): void {
    const next = new Map<string, number>();
    next.set(this.quote, 0);
    for (const b of Array.isArray(balances) ? balances : []) {
      if (!b || typeof b.symbol !== "string" || !b.symbol) continue;
      const avail = Number.isFinite(b.available) ? b.available : 0;
      const inOrder = Number.isFinite(b.inOrder) ? b.inOrder : 0;
      const total = Math.max(0, avail + inOrder);
      const sym = b.symbol.toUpperCase();
      next.set(sym, (next.get(sym) ?? 0) + total);
    }
    this.balances = next;
  }

  /** Begin opnieuw met alleen `startingQuote` in de quote-valuta. */
  reset(startingQuote: number): void {
    this.balances = new Map([[this.quote, Number.isFinite(startingQuote) && startingQuote > 0 ? startingQuote : 0]]);
  }

  /**
   * `Broker.setCosts`: houdt fee/slippage gelijk aan de risico-instellingen
   * (bijv. na een config-wijziging). Ongeldige waarden worden genegeerd (de
   * vorige blijft gelden). Het beursminimum verandert hier NIET mee.
   */
  setCosts(takerFee: number, slippagePct: number): void {
    if (validCostFraction(takerFee)) this.takerFee = takerFee;
    if (validCostFraction(slippagePct)) this.slippagePct = slippagePct;
  }

  async placeMarketOrder(req: MarketOrderRequest, referencePrice: number): Promise<OrderResult> {
    const orderId = newId("paper");
    const timestamp = this.nowFn();
    const market = typeof req?.market === "string" ? req.market : "";
    const side = req?.side;
    const base: OrderResult = {
      orderId,
      clientOrderId: req?.clientOrderId,
      market,
      side: side === "sell" ? "sell" : "buy",
      status: "rejected",
      filledAmount: 0,
      filledQuote: 0,
      avgPrice: 0,
      feeQuote: 0,
      timestamp,
    };
    const reject = (error: string): OrderResult => ({ ...base, error });

    const parts = market.toUpperCase().split("-");
    if (parts.length !== 2 || !parts[0] || !parts[1]) return reject(`Ongeldige markt: "${market}"`);
    const [baseSym, quoteSym] = parts;
    if (quoteSym !== this.quote) {
      return reject(`Paper trading ondersteunt alleen ${this.quote}-markten (${market})`);
    }
    if (side !== "buy" && side !== "sell") return reject(`Ongeldige orderzijde: "${String(side)}"`);
    if (!isPosNum(referencePrice)) return reject(`Geen geldige referentiekoers voor ${market}`);

    const mins = this.getMarketInfo ? await this.minimums(market) : { quote: this.minOrderQuote, base: 0 };
    return side === "buy"
      ? this.buy(base, baseSym, req, referencePrice, mins, reject)
      : this.sell(base, baseSym, req, referencePrice, mins, reject);
  }

  // ─────────────── intern ───────────────

  /** Beursminima voor deze markt: per-markt info als die er is, anders het standaardminimum. */
  private async minimums(market: string): Promise<OrderMinimums> {
    const fallback: OrderMinimums = { quote: this.minOrderQuote, base: 0 };
    const getInfo = this.getMarketInfo;
    if (!getInfo) return fallback;
    let info: MarketInfo | undefined;
    try {
      info = await getInfo(market);
    } catch {
      return fallback; // marktinfo niet beschikbaar: standaard beursminimum
    }
    if (!info || typeof info !== "object") return fallback;
    return {
      quote: isPosNum(info.minOrderQuote) ? info.minOrderQuote : this.minOrderQuote,
      base: isPosNum(info.minOrderBase) ? info.minOrderBase : 0,
    };
  }

  private buy(
    base: OrderResult,
    baseSym: string,
    req: MarketOrderRequest,
    ref: number,
    mins: OrderMinimums,
    reject: (e: string) => OrderResult,
  ): OrderResult {
    let q = req.amountQuote;
    if (q === undefined || q === null) return reject("Kooporder zonder bedrag (amountQuote ontbreekt)");
    if (!isPosNum(q)) return reject(`Ongeldig bedrag voor kooporder: ${String(q)}`);
    if (q < mins.quote - QUOTE_EPS) {
      return reject(`Order van ${fmtEur(q)} is kleiner dan het minimum van ${fmtEur(mins.quote)}`);
    }
    if (mins.base > 0 && q / ref < mins.base * (1 - REL_EPS)) {
      return reject(
        `Geschatte hoeveelheid ${q / ref} ${baseSym} is kleiner dan het minimum van ${mins.base} ${baseSym}`,
      );
    }
    const cash = this.get(this.quote);
    if (q > cash + QUOTE_EPS) {
      return reject(`Onvoldoende ${this.quote}-saldo: ${fmtEur(cash)} beschikbaar, ${fmtEur(q)} nodig`);
    }
    // Afrondingsruis: nooit meer uitgeven dan er is
    if (q > cash) q = cash;

    const fee = q - q / (1 + this.takerFee);
    const fillPrice = ref * (1 + this.slippagePct);
    const amount = (q - fee) / fillPrice;
    if (!isPosNum(amount)) return reject("Kon de orderhoeveelheid niet berekenen");

    this.set(this.quote, cash - q);
    this.set(baseSym, this.get(baseSym) + amount);
    return {
      ...base,
      status: "filled",
      filledAmount: amount,
      filledQuote: amount * fillPrice,
      avgPrice: fillPrice,
      feeQuote: fee,
    };
  }

  private sell(
    base: OrderResult,
    baseSym: string,
    req: MarketOrderRequest,
    ref: number,
    mins: OrderMinimums,
    reject: (e: string) => OrderResult,
  ): OrderResult {
    let amount = req.amount;
    if (amount === undefined || amount === null) return reject("Verkooporder zonder hoeveelheid (amount ontbreekt)");
    if (!isPosNum(amount)) return reject(`Ongeldige hoeveelheid voor verkooporder: ${String(amount)}`);
    const notional = amount * ref;
    if (notional < mins.quote - QUOTE_EPS) {
      return reject(
        `${UNSELLABLE_PREFIX} orderwaarde ${fmtEur(Math.floor(notional * 100 + 1e-9) / 100)} is kleiner dan het beursminimum van ${fmtEur(mins.quote)}; ` +
          "wacht tot de waarde boven het minimum komt of schrijf de positie af",
      );
    }
    if (mins.base > 0 && amount < mins.base * (1 - REL_EPS)) {
      return reject(
        `${UNSELLABLE_PREFIX} hoeveelheid ${amount} ${baseSym} is kleiner dan het beursminimum van ${mins.base} ${baseSym}; ` +
          "wacht tot de waarde boven het minimum komt of schrijf de positie af",
      );
    }
    const held = this.get(baseSym);
    if (amount > held * (1 + REL_EPS) + 1e-15) {
      return reject(`Onvoldoende ${baseSym}-saldo: ${held} beschikbaar, ${amount} nodig`);
    }
    // Afrondingsruis: nooit meer verkopen dan er is
    if (amount > held) amount = held;

    const fillPrice = ref * (1 - this.slippagePct);
    const gross = amount * fillPrice;
    const fee = gross * this.takerFee;
    this.set(baseSym, held - amount);
    this.set(this.quote, this.get(this.quote) + gross - fee);
    return {
      ...base,
      status: "filled",
      filledAmount: amount,
      filledQuote: gross,
      avgPrice: fillPrice,
      feeQuote: fee,
    };
  }

  private get(symbol: string): number {
    return this.balances.get(symbol) ?? 0;
  }

  /** Zet een saldo; kleine negatieve afrondingsruis wordt 0. */
  private set(symbol: string, value: number): void {
    const v = Number.isFinite(value) && value > 0 ? value : 0;
    if (v === 0 && symbol !== this.quote) this.balances.delete(symbol);
    else this.balances.set(symbol, v);
  }
}
