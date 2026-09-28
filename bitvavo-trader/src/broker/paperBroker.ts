/**
 * PaperBroker: simuleert market orders met fees en slippage, zonder echt geld.
 *
 * Koop met `amountQuote = Q` (EUR inclusief fee):
 *   fee = Q − Q / (1 + takerFee); vulprijs = ref × (1 + slippage); amount = (Q − fee) / vulprijs
 * Verkoop met `amount`:
 *   vulprijs = ref × (1 − slippage); bruto = amount × vulprijs; fee = bruto × takerFee
 *
 * Afwijzingen geven status "rejected" met een Nederlandse foutmelding terug
 * (er wordt nooit gegooid).
 */
import type { Balance, Broker, MarketOrderRequest, OrderResult, TradingMode } from "../core/types";
import { newId } from "../core/util";

export interface PaperBrokerOptions {
  startingQuote: number;
  takerFee: number;
  slippagePct: number;
  now?: () => number;
  /** Quote-valuta (standaard "EUR") */
  quote?: string;
  /** Minimale orderwaarde in quote (standaard 5, zoals Bitvavo) */
  minOrderQuote?: number;
}

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

export class PaperBroker implements Broker {
  readonly mode: TradingMode = "paper";
  private readonly quote: string;
  private takerFee: number;
  private slippagePct: number;
  private readonly minOrderQuote: number;
  private readonly nowFn: () => number;
  /** Totale saldi per symbool (paper kent geen openstaande orders) */
  private balances = new Map<string, number>();

  constructor(opts: PaperBrokerOptions) {
    this.quote = (opts.quote ?? "EUR").toUpperCase();
    this.takerFee = Number.isFinite(opts.takerFee) && opts.takerFee >= 0 ? opts.takerFee : 0.0025;
    this.slippagePct = Number.isFinite(opts.slippagePct) && opts.slippagePct >= 0 ? opts.slippagePct : 0;
    this.minOrderQuote =
      opts.minOrderQuote !== undefined && Number.isFinite(opts.minOrderQuote) && opts.minOrderQuote >= 0
        ? opts.minOrderQuote
        : 5;
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

  /** Pas fee/slippage aan (bijv. na een config-wijziging). */
  setCosts(takerFee: number, slippagePct: number): void {
    if (Number.isFinite(takerFee) && takerFee >= 0) this.takerFee = takerFee;
    if (Number.isFinite(slippagePct) && slippagePct >= 0) this.slippagePct = slippagePct;
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

    return side === "buy"
      ? this.buy(base, baseSym, req, referencePrice, reject)
      : this.sell(base, baseSym, req, referencePrice, reject);
  }

  // ─────────────── intern ───────────────

  private buy(
    base: OrderResult,
    baseSym: string,
    req: MarketOrderRequest,
    ref: number,
    reject: (e: string) => OrderResult,
  ): OrderResult {
    let q = req.amountQuote;
    if (q === undefined || q === null) return reject("Kooporder zonder bedrag (amountQuote ontbreekt)");
    if (!isPosNum(q)) return reject(`Ongeldig bedrag voor kooporder: ${String(q)}`);
    if (q < this.minOrderQuote - QUOTE_EPS) {
      return reject(`Order van ${fmtEur(q)} is kleiner dan het minimum van ${fmtEur(this.minOrderQuote)}`);
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
    reject: (e: string) => OrderResult,
  ): OrderResult {
    let amount = req.amount;
    if (amount === undefined || amount === null) return reject("Verkooporder zonder hoeveelheid (amount ontbreekt)");
    if (!isPosNum(amount)) return reject(`Ongeldige hoeveelheid voor verkooporder: ${String(amount)}`);
    const notional = amount * ref;
    if (notional < this.minOrderQuote - QUOTE_EPS) {
      return reject(
        `Orderwaarde ${fmtEur(notional)} is kleiner dan het minimum van ${fmtEur(this.minOrderQuote)}`,
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
