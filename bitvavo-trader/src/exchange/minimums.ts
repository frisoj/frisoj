/**
 * Beursminima per order — één regel voor PaperBroker, LiveBroker, de
 * backtest-simulator, de RiskManager en `BitvavoClient.markets()`.
 *
 * Het minimum in EUR geldt op Bitvavo voor kopen ÉN verkopen. Een
 * `MarketInfo.minOrderQuote` die ontbreekt, niet eindig is of ≤ 0 is ONBEKEND
 * (nooit "geen minimum"): dan geldt `EXCHANGE_MIN_ORDER_QUOTE` (€5). De
 * instelling `risk.minOrderQuote` hoort hier NIET bij: dat is alleen een extra
 * ondergrens voor instappen en vervangt het beursminimum nooit.
 */
import { EXCHANGE_MIN_ORDER_QUOTE } from "../core/defaults";

function isPositiveFinite(v: unknown): v is number {
  return typeof v === "number" && Number.isFinite(v) && v > 0;
}

/** Minimale orderwaarde (EUR) op de beurs: `minOrderQuote` als die geldig is (eindig, > 0), anders €5. */
export function exchangeMinQuote(info?: { readonly minOrderQuote?: unknown } | null): number {
  const v = info?.minOrderQuote;
  return isPositiveFinite(v) ? v : EXCHANGE_MIN_ORDER_QUOTE;
}

/** Minimale hoeveelheid (base) op de beurs, of 0 als die onbekend is (dan telt alleen het EUR-minimum). */
export function exchangeMinBase(info?: { readonly minOrderBase?: unknown } | null): number {
  const v = info?.minOrderBase;
  return isPositiveFinite(v) ? v : 0;
}
