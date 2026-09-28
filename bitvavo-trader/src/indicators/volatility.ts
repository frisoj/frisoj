import type { Candle } from "../core/types";
import { checkPeriod, nanArray, rollingExtreme, rollingStats } from "./internal";

export interface BollingerResult {
  upper: number[];
  middle: number[];
  lower: number[];
  /** (upper − lower) / middle (0 bij een band zonder breedte) */
  bandwidth: number[];
  /** (close − lower) / (upper − lower); 0.5 bij een band zonder breedte */
  percentB: number[];
}

export interface DonchianResult {
  upper: number[];
  lower: number[];
  middle: number[];
}

/**
 * True range per candle: max(high−low, |high−prevClose|, |low−prevClose|);
 * voor de eerste candle high−low. Extra export.
 */
export function trueRange(candles: ArrayLike<Candle>): number[] {
  const n = candles.length;
  const out = new Array<number>(n);
  for (let i = 0; i < n; i++) {
    const c = candles[i];
    let tr = c.high - c.low;
    if (i > 0) {
      const pc = candles[i - 1].close;
      const a = Math.abs(c.high - pc);
      const b = Math.abs(c.low - pc);
      if (a > tr) tr = a;
      if (b > tr) tr = b;
    }
    out[i] = tr;
  }
  return out;
}

/**
 * Average True Range met Wilder smoothing (alpha = 1/period). TR van de eerste
 * candle = high − low; eerste ATR (gemiddelde van de eerste `period` TR's) op
 * index period−1.
 */
export function atr(candles: ArrayLike<Candle>, period = 14): number[] {
  const p = checkPeriod("atr", period);
  const n = candles.length;
  const out = nanArray(n);
  if (n < p) return out;
  let sum = 0;
  let a = 0;
  let prevClose = NaN;
  for (let i = 0; i < n; i++) {
    const c = candles[i];
    let tr = c.high - c.low;
    if (i > 0) {
      const x = Math.abs(c.high - prevClose);
      const y = Math.abs(c.low - prevClose);
      if (x > tr) tr = x;
      if (y > tr) tr = y;
    }
    prevClose = c.close;
    if (i < p) {
      sum += tr;
      if (i === p - 1) {
        a = sum / p;
        out[i] = a;
      }
    } else {
      a = (a * (p - 1) + tr) / p;
      out[i] = a;
    }
  }
  return out;
}

/**
 * Bollinger Bands: middle = SMA(period), upper/lower = middle ± mult × populatie-
 * stdev. bandwidth = (upper−lower)/middle, percentB = (close−lower)/(upper−lower).
 */
export function bollinger(values: ArrayLike<number>, period = 20, mult = 2): BollingerResult {
  const p = checkPeriod("bollinger", period);
  if (typeof mult !== "number" || !Number.isFinite(mult)) {
    throw new Error(`Ongeldige multiplier voor bollinger: ${String(mult)}`);
  }
  const n = values.length;
  const { mean, std } = rollingStats(values, p, true);
  const sd = std as number[];
  const upper = nanArray(n);
  const lower = nanArray(n);
  const bandwidth = nanArray(n);
  const percentB = nanArray(n);
  for (let i = p - 1; i < n; i++) {
    const m = mean[i];
    if (!Number.isFinite(m)) continue;
    const w = mult * sd[i];
    const u = m + w;
    const l = m - w;
    upper[i] = u;
    lower[i] = l;
    const width = u - l;
    bandwidth[i] = width !== 0 && m !== 0 ? width / m : 0;
    percentB[i] = width !== 0 ? (values[i] - l) / width : 0.5;
  }
  return { upper, middle: mean, lower, bandwidth, percentB };
}

/**
 * Donchian channel over de VORIGE `period` candles (candle i telt NIET mee),
 * zodat een breakout `close[i] > upper[i]` is. Eerste waarde op index `period`.
 */
export function donchian(candles: ArrayLike<Candle>, period: number): DonchianResult {
  const p = checkPeriod("donchian", period);
  const n = candles.length;
  const upper = nanArray(n);
  const lower = nanArray(n);
  const middle = nanArray(n);
  if (n <= p) return { upper, lower, middle };
  const hi = new Array<number>(n);
  const lo = new Array<number>(n);
  for (let i = 0; i < n; i++) {
    hi[i] = candles[i].high;
    lo[i] = candles[i].low;
  }
  const hh = rollingExtreme(hi, p, true);
  const ll = rollingExtreme(lo, p, false);
  for (let i = p; i < n; i++) {
    const u = hh[i - 1];
    const l = ll[i - 1];
    upper[i] = u;
    lower[i] = l;
    middle[i] = (u + l) / 2;
  }
  return { upper, lower, middle };
}
