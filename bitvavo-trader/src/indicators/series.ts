import type { Candle } from "../core/types";

/** Slotkoersen van de candles. */
export function closes(candles: ArrayLike<Candle>): number[] {
  const n = candles.length;
  const out = new Array<number>(n);
  for (let i = 0; i < n; i++) out[i] = candles[i].close;
  return out;
}

/** Highs van de candles (extra export). */
export function highs(candles: ArrayLike<Candle>): number[] {
  const n = candles.length;
  const out = new Array<number>(n);
  for (let i = 0; i < n; i++) out[i] = candles[i].high;
  return out;
}

/** Lows van de candles (extra export). */
export function lows(candles: ArrayLike<Candle>): number[] {
  const n = candles.length;
  const out = new Array<number>(n);
  for (let i = 0; i < n; i++) out[i] = candles[i].low;
  return out;
}

/** Zet NaN/±Infinity om naar null (voor JSON/grafieken). */
export function toNullable(values: ArrayLike<number>): (number | null)[] {
  const n = values.length;
  const out = new Array<number | null>(n);
  for (let i = 0; i < n; i++) {
    const v = values[i];
    out[i] = Number.isFinite(v) ? v : null;
  }
  return out;
}
