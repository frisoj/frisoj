import { checkPeriod, expSmooth, rollingStats } from "./internal";

/**
 * Simple moving average. out[i] = gemiddelde van values[i-period+1..i];
 * NaN tijdens warmup (eerste period-1 indices) en voor vensters met NaN.
 */
export function sma(values: ArrayLike<number>, period: number): number[] {
  const p = checkPeriod("sma", period);
  return rollingStats(values, p, false).mean;
}

/**
 * Exponential moving average, alpha = 2/(period+1). Geseed met het SMA van de
 * eerste `period` opeenvolgende eindige waarden (werkt dus ook op reeksen met
 * leidende NaN's, zoals een MACD-lijn). Een NaN na het seeden geeft NaN op die
 * index; het EMA loopt daarna gewoon door.
 */
export function ema(values: ArrayLike<number>, period: number): number[] {
  const p = checkPeriod("ema", period);
  return expSmooth(values, p, 2 / (p + 1));
}

/**
 * Wilder's moving average (RMA / SMMA), alpha = 1/period, geseed zoals `ema`.
 * Extra export (bouwsteen van RSI/ATR/ADX).
 */
export function rma(values: ArrayLike<number>, period: number): number[] {
  const p = checkPeriod("rma", period);
  return expSmooth(values, p, 1 / p);
}

/** Populatie-standaarddeviatie over een voortschrijdend venster van `period`. */
export function stdev(values: ArrayLike<number>, period: number): number[] {
  const p = checkPeriod("stdev", period);
  return rollingStats(values, p, true).std as number[];
}
