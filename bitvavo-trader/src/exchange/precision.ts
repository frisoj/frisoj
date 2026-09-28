/**
 * Afronding volgens de Bitvavo-marktregels.
 *
 * - Prijzen: `tickSize` (nieuw, voorkeur) of `pricePrecision` significante cijfers (legacy, meestal 5).
 * - `amount` (base): maximaal `quantityDecimals` decimalen, altijd naar BENEDEN afgerond.
 * - `amountQuote` (EUR): maximaal `notionalDecimals` decimalen, altijd naar BENEDEN afgerond.
 * - Bitvavo accepteert geen exponent-notatie ("1e-7"), dus getallen gaan via `formatDecimal`.
 *
 * Floating point: 0.29 * 100 = 28.999999999999996. Daarom wordt elke geschaalde
 * waarde eerst "gesnapt" naar 15 significante cijfers voordat er gefloord wordt.
 */
import type { MarketInfo } from "../core/types";

export type RoundMode = "down" | "up" | "nearest";

const DEFAULT_PRICE_PRECISION = 5;
const DEFAULT_QUANTITY_DECIMALS = 8;
const DEFAULT_NOTIONAL_DECIMALS = 2;
const MAX_DECIMALS = 100;

/** Verwijdert float-ruis (alles voorbij 15 significante cijfers). */
function snap(x: number): number {
  if (!Number.isFinite(x) || x === 0) return x;
  return Number(x.toPrecision(15));
}

function applyMode(x: number, mode: RoundMode): number {
  if (mode === "down") return Math.floor(x);
  if (mode === "up") return Math.ceil(x);
  return Math.round(x);
}

/** Rondt af op `decimals` decimalen (mag negatief zijn: -2 = op honderdtallen). */
export function roundToDecimals(value: number, decimals: number, mode: RoundMode = "nearest"): number {
  if (!Number.isFinite(value) || value === 0) return value;
  const d = Math.trunc(decimals);
  if (d >= 0) {
    const f = 10 ** d;
    return applyMode(snap(value * f), mode) / f;
  }
  const f = 10 ** -d;
  return applyMode(snap(value / f), mode) * f;
}

/** Rondt af op `digits` significante cijfers (bijv. 5 → 64123 of 0.12345). */
export function toSignificant(value: number, digits: number, mode: RoundMode = "nearest"): number {
  if (!Number.isFinite(value) || value === 0) return value;
  const d = Math.max(1, Math.trunc(Number.isFinite(digits) ? digits : DEFAULT_PRICE_PRECISION));
  const magnitude = Number(Math.abs(snap(value)).toExponential().split("e")[1]);
  return roundToDecimals(value, d - 1 - magnitude, mode);
}

/** Aantal decimalen van een getal zoals het in decimale notatie geschreven wordt (0.001 → 3). */
export function decimalsOf(value: number): number {
  if (!Number.isFinite(value)) return 0;
  const s = toPlainString(value);
  const dot = s.indexOf(".");
  return dot < 0 ? 0 : s.length - dot - 1;
}

/** Rondt af op een veelvoud van `step` (bijv. tickSize 0.01). */
export function roundToStep(value: number, step: number, mode: RoundMode = "nearest"): number {
  if (!Number.isFinite(value) || !(step > 0) || !Number.isFinite(step)) return value;
  const n = applyMode(snap(value / step), mode);
  const decimals = decimalsOf(step);
  return roundToDecimals(n * step, decimals, "nearest");
}

/**
 * Rondt een prijs af volgens de markt: `tickSize` als die er is, anders
 * `pricePrecision` significante cijfers. Standaard naar dichtstbijzijnde.
 */
export function roundPrice(price: number, m: MarketInfo, mode: RoundMode = "nearest"): number {
  if (!Number.isFinite(price) || price <= 0) return price;
  const tick = m.tickSize;
  if (typeof tick === "number" && Number.isFinite(tick) && tick > 0) {
    return roundToStep(price, tick, mode);
  }
  const precision =
    Number.isFinite(m.pricePrecision) && m.pricePrecision > 0 ? m.pricePrecision : DEFAULT_PRICE_PRECISION;
  return toSignificant(price, precision, mode);
}

function validDecimals(d: unknown, fallback: number): number {
  return typeof d === "number" && Number.isFinite(d) && d >= 0 ? Math.min(Math.trunc(d), 20) : fallback;
}

/** Hoeveelheid base, naar BENEDEN afgerond op `quantityDecimals`. Ongeldig/negatief → 0. */
export function roundAmount(amount: number, m: MarketInfo): number {
  if (!Number.isFinite(amount) || amount <= 0) return 0;
  const r = roundToDecimals(amount, validDecimals(m.quantityDecimals, DEFAULT_QUANTITY_DECIMALS), "down");
  return r > 0 ? r : 0;
}

/** Bedrag in quote (EUR), naar BENEDEN afgerond op `notionalDecimals`. Ongeldig/negatief → 0. */
export function roundQuote(q: number, m: MarketInfo): number {
  if (!Number.isFinite(q) || q <= 0) return 0;
  const r = roundToDecimals(q, validDecimals(m.notionalDecimals, DEFAULT_NOTIONAL_DECIMALS), "down");
  return r > 0 ? r : 0;
}

/**
 * Schrijft een getal in gewone decimale notatie met maximaal 15 significante
 * cijfers (geen exponent, geen float-ruis, geen overbodige nullen).
 * 1e-7 → "0.0000001", 0.1 + 0.2 → "0.3", 1e21 → "1000000000000000000000".
 */
export function toPlainString(value: number): string {
  if (!Number.isFinite(value)) throw new RangeError(`Ongeldig getal: ${value}`);
  if (value === 0) return "0";
  const neg = value < 0;
  const [mantissa, expStr] = Math.abs(value).toExponential(14).split("e");
  const exp = Number(expStr);
  const digits = mantissa.replace(".", "");
  let intPart: string;
  let fracPart: string;
  if (exp >= 0) {
    if (exp + 1 >= digits.length) {
      intPart = digits + "0".repeat(exp + 1 - digits.length);
      fracPart = "";
    } else {
      intPart = digits.slice(0, exp + 1);
      fracPart = digits.slice(exp + 1);
    }
  } else {
    intPart = "0";
    fracPart = "0".repeat(-exp - 1) + digits;
  }
  fracPart = fracPart.replace(/0+$/, "");
  const s = fracPart ? `${intPart}.${fracPart}` : intPart;
  return neg && s !== "0" ? `-${s}` : s;
}

/**
 * Formatteert met maximaal `decimals` decimalen, zonder exponent-notatie en
 * zonder overbodige nullen. Kapt af richting nul (verhoogt een bedrag nooit);
 * rond dus eerst zelf af met roundPrice/roundAmount/roundQuote.
 * formatDecimal(1e-7, 8) → "0.0000001", formatDecimal(1.5, 2) → "1.5".
 */
export function formatDecimal(value: number, decimals: number): string {
  if (!Number.isFinite(value)) throw new RangeError(`Ongeldig getal: ${value}`);
  const d = Math.min(MAX_DECIMALS, Math.max(0, Math.trunc(Number.isFinite(decimals) ? decimals : 0)));
  const abs = Math.abs(value);
  const truncated = roundToDecimals(abs, d, "down");
  let s = toPlainString(truncated);
  const dot = s.indexOf(".");
  if (dot >= 0 && s.length - dot - 1 > d) {
    s = d === 0 ? s.slice(0, dot) : s.slice(0, dot + 1 + d);
    s = s.includes(".") ? s.replace(/0+$/, "").replace(/\.$/, "") : s;
  }
  if (s === "" || /^0*$/.test(s.replace(".", ""))) return "0";
  return value < 0 ? `-${s}` : s;
}
