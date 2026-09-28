import type { Candle } from "../core/types";
import { checkPeriod, nanArray, rollingExtreme, rollingStats } from "./internal";
import { ema } from "./movingAverages";

export interface MacdResult {
  macd: number[];
  signal: number[];
  histogram: number[];
}

export interface StochasticResult {
  k: number[];
  d: number[];
}

/**
 * Relative Strength Index met Wilder smoothing (alpha = 1/period).
 * Eerste waarde op index `period` (na `period` koersveranderingen; leidende
 * NaN's schuiven dat op). Geen beweging → 50, alleen stijgingen → 100,
 * alleen dalingen → 0.
 */
export function rsi(values: ArrayLike<number>, period = 14): number[] {
  const p = checkPeriod("rsi", period);
  const n = values.length;
  const out = nanArray(n);
  let prev = NaN;
  let count = 0;
  let sumG = 0;
  let sumL = 0;
  let avgG = 0;
  let avgL = 0;
  let seeded = false;
  for (let i = 0; i < n; i++) {
    const c = values[i];
    if (!Number.isFinite(c)) continue;
    if (!Number.isFinite(prev)) {
      prev = c;
      continue;
    }
    const ch = c - prev;
    prev = c;
    const g = ch > 0 ? ch : 0;
    const l = ch < 0 ? -ch : 0;
    if (!seeded) {
      sumG += g;
      sumL += l;
      if (++count < p) continue;
      avgG = sumG / p;
      avgL = sumL / p;
      seeded = true;
    } else {
      avgG = (avgG * (p - 1) + g) / p;
      avgL = (avgL * (p - 1) + l) / p;
    }
    const tot = avgG + avgL;
    out[i] = tot > 0 ? (100 * avgG) / tot : 50;
  }
  return out;
}

/**
 * MACD: macd = EMA(fast) − EMA(slow), signal = EMA(macd, signal),
 * histogram = macd − signal. Eerste macd-waarde op index max(fast,slow)−1,
 * eerste signal/histogram op index max(fast,slow)+signal−2.
 */
export function macd(values: ArrayLike<number>, fast = 12, slow = 26, signal = 9): MacdResult {
  const f = checkPeriod("macd", fast, "fast-periode");
  const s = checkPeriod("macd", slow, "slow-periode");
  const g = checkPeriod("macd", signal, "signal-periode");
  const n = values.length;
  const ef = ema(values, f);
  const es = ema(values, s);
  const line = new Array<number>(n);
  for (let i = 0; i < n; i++) line[i] = ef[i] - es[i];
  const sig = ema(line, g);
  const hist = new Array<number>(n);
  for (let i = 0; i < n; i++) hist[i] = line[i] - sig[i];
  return { macd: line, signal: sig, histogram: hist };
}

/**
 * Stochastic oscillator. %K = 100·(close − laagste low)/(hoogste high − laagste
 * low) over `kPeriod` candles (inclusief de huidige); 50 als de range 0 is.
 * %D = SMA(%K, dPeriod). Eerste %K op index kPeriod−1, eerste %D op
 * kPeriod+dPeriod−2.
 */
export function stochastic(candles: ArrayLike<Candle>, kPeriod = 14, dPeriod = 3): StochasticResult {
  const kp = checkPeriod("stochastic", kPeriod, "kPeriod");
  const dp = checkPeriod("stochastic", dPeriod, "dPeriod");
  const n = candles.length;
  const hi = new Array<number>(n);
  const lo = new Array<number>(n);
  for (let i = 0; i < n; i++) {
    hi[i] = candles[i].high;
    lo[i] = candles[i].low;
  }
  const hh = rollingExtreme(hi, kp, true);
  const ll = rollingExtreme(lo, kp, false);
  const k = nanArray(n);
  for (let i = kp - 1; i < n; i++) {
    const h = hh[i];
    const l = ll[i];
    const range = h - l;
    if (!Number.isFinite(range)) continue;
    k[i] = range > 0 ? (100 * (candles[i].close - l)) / range : 50;
  }
  const d = rollingStats(k, dp, false).mean;
  return { k, d };
}
