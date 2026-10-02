/**
 * Testdata voor strategie-/ensembletests: een realistische, deterministische
 * synthetische koersgenerator plus kleine helpers om gerichte scenario's te
 * bouwen (uitbraak, scherpe daling, trends).
 */
import type { Candle } from "../../src/core/types";
import { mulberry32 } from "../../src/core/util";

export const MIN = 60_000;
export const M15 = 15 * MIN;
export const DAY = 86_400_000;
/** Maandag 5 januari 2026, 00:00 UTC (sessiegrens voor VWAP) */
export const T0 = Date.UTC(2026, 0, 5);

export function gaussian(rand: () => number): () => number {
  let spare: number | null = null;
  return () => {
    if (spare !== null) {
      const s = spare;
      spare = null;
      return s;
    }
    let u = 0;
    let v = 0;
    while (u <= 1e-12) u = rand();
    while (v <= 1e-12) v = rand();
    const mag = Math.sqrt(-2 * Math.log(u));
    spare = mag * Math.sin(2 * Math.PI * v);
    return mag * Math.cos(2 * Math.PI * v);
  };
}

export type SynthRegime = "up" | "down" | "range";

export interface SyntheticOptions {
  n: number;
  seed?: number;
  startPrice?: number;
  intervalMs?: number;
  start?: number;
  /** Basisvolatiliteit per candle (log-return sd), standaard 0,3% (≈ BTC op 15m) */
  baseVol?: number;
  /** Gemiddeld basisvolume per candle */
  baseVolume?: number;
}

export interface SyntheticSeries {
  candles: Candle[];
  /** Het gesimuleerde regime per candle (ground truth) */
  regimes: SynthRegime[];
}

/**
 * Seeded random walk met:
 * - afwisselende regimes: trend omhoog/omlaag (drift) en range (mean reversion
 *   naar een centrum), elk 0,5–3 dagen lang (bij 15m);
 * - volatiliteitsclusters (GARCH(1,1)) plus af en toe een volatiele uitbarsting;
 * - dagritme (Amerikaanse uren drukker, nacht rustiger);
 * - zeldzame sprongen; volume gecorreleerd met de grootte van de beweging.
 */
export function syntheticSeries(opts: SyntheticOptions): SyntheticSeries {
  const n = opts.n;
  const rand = mulberry32(opts.seed ?? 1);
  const z = gaussian(rand);
  const interval = opts.intervalMs ?? M15;
  const start = opts.start ?? T0;
  const baseVol = opts.baseVol ?? 0.003;
  const baseVolume = opts.baseVolume ?? 10;
  const barsPerDay = Math.max(1, Math.round(DAY / interval));

  const alpha = 0.07;
  const beta = 0.9;
  const omega = baseVol * baseVol * (1 - alpha - beta);
  let h = baseVol * baseVol;

  let logP = Math.log(opts.startPrice ?? 60_000);
  let regime: SynthRegime = "range";
  let regimeLeft = 0;
  let drift = 0;
  let center = logP;
  let burstLeft = 0;

  const candles: Candle[] = [];
  const regimes: SynthRegime[] = [];
  for (let i = 0; i < n; i++) {
    if (regimeLeft <= 0) {
      const u = rand();
      regime = u < 0.3 ? "up" : u < 0.55 ? "down" : "range";
      regimeLeft = Math.round(barsPerDay * (0.5 + 2.5 * rand()));
      const mag = 0.0003 + 0.0006 * rand();
      drift = regime === "up" ? mag : regime === "down" ? -mag : 0;
      center = logP;
    }
    regimeLeft--;
    if (burstLeft <= 0 && rand() < 0.004) burstLeft = 10 + Math.floor(rand() * 30);
    const burst = burstLeft > 0 ? 2.2 : 1;
    if (burstLeft > 0) burstLeft--;

    const time = start + i * interval;
    const hour = new Date(time).getUTCHours();
    const season = hour < 6 ? 0.75 : hour < 13 ? 1 : hour < 21 ? 1.3 : 0.9;

    const sigma = Math.sqrt(h) * season * burst;
    const eps = sigma * z();
    const reversion = regime === "range" ? -0.04 * (logP - center) : 0;
    const jump = rand() < 0.002 ? (rand() < 0.5 ? -1 : 1) * (0.01 + 0.015 * rand()) : 0;
    const ret = drift + reversion + eps + jump;
    // GARCH-update op de genormaliseerde schok (zonder dagritme/burst)
    const shock = eps / (season * burst);
    h = omega + alpha * shock * shock + beta * h;

    const open = Math.exp(logP) * (1 + 0.0001 * z());
    logP += ret;
    const close = Math.exp(logP);
    const wick = Math.max(sigma, baseVol * 0.3);
    const high = Math.max(open, close) * Math.exp(Math.abs(z()) * wick * 0.6);
    const low = Math.min(open, close) * Math.exp(-Math.abs(z()) * wick * 0.6);
    const volume =
      baseVolume * season * (burst > 1 ? 1.6 : 1) * Math.exp(0.3 * z()) * (0.5 + 0.9 * Math.min(4, Math.abs(ret) / Math.max(sigma, 1e-9)));
    candles.push({ time, open, high, low, close, volume });
    regimes.push(regime);
  }
  return { candles, regimes };
}

export function syntheticCandles(opts: SyntheticOptions): Candle[] {
  return syntheticSeries(opts).candles;
}

/**
 * Candles uit een reeks slotkoersen: open = vorige slot, high/low = max/min
 * plus een kleine lont. `volume` mag een getal of een array zijn.
 */
export function candlesFromCloses(
  closes: number[],
  opts: { volume?: number | number[]; wickPct?: number; start?: number; intervalMs?: number } = {},
): Candle[] {
  const wick = opts.wickPct ?? 0.001;
  const start = opts.start ?? T0;
  const interval = opts.intervalMs ?? M15;
  return closes.map((close, i) => {
    const open = i === 0 ? close : closes[i - 1];
    const volume = Array.isArray(opts.volume) ? opts.volume[i] : opts.volume ?? 100;
    return {
      time: start + i * interval,
      open,
      high: Math.max(open, close) * (1 + wick),
      low: Math.min(open, close) * (1 - wick),
      close,
      volume,
    };
  });
}

/** Slotkoersen met constante procentuele drift per candle plus seeded ruis. */
export function driftCloses(n: number, startPrice: number, driftPct: number, noisePct: number, seed = 7): number[] {
  const z = gaussian(mulberry32(seed));
  const out: number[] = [];
  let p = startPrice;
  for (let i = 0; i < n; i++) {
    p *= 1 + driftPct / 100 + (noisePct / 100) * z();
    out.push(p);
  }
  return out;
}

/** Zijwaartse reeks die rond `center` schommelt (sinus + ruis), amplitude in %. */
export function rangeCloses(n: number, center: number, amplitudePct: number, noisePct: number, seed = 11): number[] {
  const z = gaussian(mulberry32(seed));
  const out: number[] = [];
  for (let i = 0; i < n; i++) {
    const wave = Math.sin((2 * Math.PI * i) / 16) * (amplitudePct / 100);
    out.push(center * (1 + wave + (noisePct / 100) * z()));
  }
  return out;
}

/** Aantal aaneengesloten "episodes" van een actie (reeksen van opeenvolgende candles). */
export function countEpisodes<T extends { action: string }>(items: T[], action: string): number {
  let count = 0;
  let prev = "";
  for (const it of items) {
    if (it.action === action && prev !== action) count++;
    prev = it.action;
  }
  return count;
}
