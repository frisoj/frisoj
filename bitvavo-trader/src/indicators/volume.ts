import type { Candle } from "../core/types";

const DAY_MS = 86_400_000;

/**
 * Sessie-VWAP met typical price (h+l+c)/3 × volume, reset om 00:00 UTC.
 * Is het cumulatieve sessievolume 0, dan de typical price van de candle.
 * Niet-eindig of negatief volume telt als 0. Geen warmup (alle waarden gezet).
 */
export function vwap(candles: ArrayLike<Candle>): number[] {
  const n = candles.length;
  const out = new Array<number>(n);
  let day = NaN;
  let pv = 0;
  let vol = 0;
  for (let i = 0; i < n; i++) {
    const c = candles[i];
    const d = Math.floor(c.time / DAY_MS);
    if (d !== day) {
      day = d;
      pv = 0;
      vol = 0;
    }
    const tp = (c.high + c.low + c.close) / 3;
    const v = c.volume > 0 && Number.isFinite(c.volume) ? c.volume : 0;
    pv += tp * v;
    vol += v;
    out[i] = vol > 0 ? pv / vol : tp;
  }
  return out;
}

/**
 * On-Balance Volume: start op 0; +volume bij een hogere slotkoers, −volume bij
 * een lagere, ongewijzigd bij gelijke slotkoers. Geen warmup.
 */
export function obv(candles: ArrayLike<Candle>): number[] {
  const n = candles.length;
  const out = new Array<number>(n);
  let acc = 0;
  for (let i = 0; i < n; i++) {
    if (i > 0) {
      const c = candles[i].close;
      const pc = candles[i - 1].close;
      const v = Number.isFinite(candles[i].volume) ? candles[i].volume : 0;
      if (c > pc) acc += v;
      else if (c < pc) acc -= v;
    }
    out[i] = acc;
  }
  return out;
}
