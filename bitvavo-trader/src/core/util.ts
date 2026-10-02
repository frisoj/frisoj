import { randomUUID } from "node:crypto";
import { INTERVAL_MS, type Candle, type Interval } from "./types";

const dayFormatter = new Intl.DateTimeFormat("en-CA", {
  timeZone: "Europe/Amsterdam",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});

/** Kalenderdag (YYYY-MM-DD) in Europe/Amsterdam; gebruikt voor dagelijkse limieten. */
export function dayKey(ms: number): string {
  return dayFormatter.format(new Date(ms));
}

/** Korte unieke id, bijv. "pos_3f2a9c1b". */
export function newId(prefix: string): string {
  return `${prefix}_${randomUUID().replace(/-/g, "").slice(0, 12)}`;
}

export function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

/** True als de candle volledig voorbij is op tijdstip `now`. */
export function isClosedCandle(candle: Candle, interval: Interval, now: number): boolean {
  return candle.time + INTERVAL_MS[interval] <= now;
}

/** Alleen de gesloten candles (de laatste kan nog in vorming zijn). */
export function closedCandles(candles: Candle[], interval: Interval, now: number): Candle[] {
  let end = candles.length;
  while (end > 0 && !isClosedCandle(candles[end - 1], interval, now)) end--;
  return end === candles.length ? candles : candles.slice(0, end);
}

export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Deterministische PRNG (mulberry32), voor simulaties en reproduceerbare sampling. */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Stabiele 32-bit hash van een string (FNV-1a), handig als seed. */
export function hashString(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}
