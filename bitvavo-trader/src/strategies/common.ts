/**
 * Gedeelde hulpfuncties voor de strategieën.
 *
 * Kernidee (`persistRun`): een strategie geeft niet alleen een signaal op de
 * ene candle waarop iets gebeurt (kruising, uitbraak), maar drukt haar
 * HUIDIGE mening uit. Een vers event geeft hoge confidence (≈0,7–1,0); zolang
 * de onderliggende toestand geldig blijft, houdt de strategie dezelfde actie
 * vast met een confidence die lineair afneemt naar `floor` over `decayBars`
 * candles. Daarna (of zodra de toestand vervalt) wordt het weer "hold". Een
 * tegengesteld event draait de mening meteen om.
 *
 * Alles loopt strikt vooruit (i = 0..n-1) en gebruikt alleen indicatorwaarden
 * op index <= i, dus er is geen lookahead.
 */
import type { StrategyId, StrategyParams, StrategySignal } from "../core/types";

export const WARMUP_REASON = "Opwarmen: nog te weinig candles";
export const NO_SIGNAL_REASON = "Geen signaal";

/** Standaard: confidence zakt in 6 candles lineair naar 0,3 en daarna "hold". */
export const DEFAULT_DECAY_BARS = 10;
export const DEFAULT_FLOOR = 0.35;

export interface SignalEvent {
  action: "buy" | "sell";
  /** 0..1 */
  confidence: number;
  reason: string;
  /** Optioneel: afwijkend aantal candles voor het verval van DIT event (bijv. korter voor exits). */
  decayBars?: number;
}

export interface PersistSpec {
  /** Zijn alle benodigde indicatorwaarden op index i (en i-1) beschikbaar? */
  ready(i: number): boolean;
  /**
   * Vers event op candle i, of null. Wordt voor elke "ready" index precies
   * één keer en in oplopende volgorde aangeroepen, dus mag interne toestand
   * bijhouden (zolang die alleen candles <= i gebruikt).
   */
  event(i: number): SignalEvent | null;
  /** Is de toestand achter het laatste event (actie `action`) nog geldig op i? */
  valid(i: number, action: "buy" | "sell"): boolean;
  /** Uitleg bij "hold" (optioneel). */
  idle?(i: number): string;
  decayBars?: number;
  floor?: number;
}

export function clamp01(x: number): number {
  return x < 0 ? 0 : x > 1 ? 1 : x;
}

/** Getal met Nederlandse decimale komma, bijv. nl(27.44, 1) → "27,4". */
export function nl(x: number, digits = 1): string {
  if (!Number.isFinite(x)) return "–";
  return x.toFixed(digits).replace(".", ",");
}

function candlesWord(k: number): string {
  return k === 1 ? "1 candle geleden" : `${k} candles geleden`;
}

/** Positieve gehele periode uit de params (afgerond, minimaal `min`). */
export function intParam(params: StrategyParams, key: string, fallback: number, min = 1): number {
  const v = params[key];
  const n = typeof v === "number" && Number.isFinite(v) ? Math.round(v) : fallback;
  return Math.max(min, n);
}

/** Eindig getal uit de params, anders de fallback. */
export function numParam(params: StrategyParams, key: string, fallback: number): number {
  const v = params[key];
  return typeof v === "number" && Number.isFinite(v) ? v : fallback;
}

/** True als alle waarden eindige getallen zijn. */
export function finite(...xs: number[]): boolean {
  for (let k = 0; k < xs.length; k++) if (!Number.isFinite(xs[k])) return false;
  return true;
}

export function holdSignal(strategy: StrategyId, reason: string): StrategySignal {
  return { strategy, action: "hold", confidence: 0, reason };
}

/**
 * Loopt één keer vooruit over alle candles en past het event/persistentie/
 * verval-model toe (zie bestandscommentaar).
 */
export function persistRun(
  strategy: StrategyId,
  n: number,
  warmup: number,
  spec: PersistSpec,
): StrategySignal[] {
  const decay = Math.max(1, spec.decayBars ?? DEFAULT_DECAY_BARS);
  const floor = spec.floor ?? DEFAULT_FLOOR;
  const out: StrategySignal[] = new Array(n);
  let last: SignalEvent | null = null;
  let lastIdx = -1;
  let lastDecay = decay;

  for (let i = 0; i < n; i++) {
    if (i < warmup || !spec.ready(i)) {
      out[i] = holdSignal(strategy, WARMUP_REASON);
      last = null;
      continue;
    }
    const ev = spec.event(i);
    if (ev) {
      const confidence = clamp01(ev.confidence);
      out[i] = { strategy, action: ev.action, confidence, reason: ev.reason };
      last = { action: ev.action, confidence, reason: ev.reason };
      lastIdx = i;
      lastDecay = ev.decayBars !== undefined ? Math.max(0, Math.round(ev.decayBars)) : decay;
      continue;
    }
    if (last) {
      const k = i - lastIdx;
      if (k <= lastDecay && spec.valid(i, last.action)) {
        const start = Math.max(last.confidence, floor);
        const confidence = start - ((start - floor) * k) / lastDecay;
        out[i] = {
          strategy,
          action: last.action,
          confidence,
          reason: `${last.reason} (${candlesWord(k)})`,
        };
        continue;
      }
      last = null;
    }
    out[i] = holdSignal(strategy, spec.idle ? spec.idle(i) : NO_SIGNAL_REASON);
  }
  return out;
}

/**
 * Voortschrijdend gemiddelde dat een NaN-aanloop overslaat (NaN tot er
 * `period` opeenvolgende eindige waarden zijn). Handig voor reeksen die zelf
 * uit een indicator komen (zoals ATR%).
 */
export function rollingMeanSkipNaN(values: number[], period: number): number[] {
  const n = values.length;
  const out = new Array<number>(n).fill(NaN);
  let sum = 0;
  let count = 0;
  for (let i = 0; i < n; i++) {
    const v = values[i];
    if (!Number.isFinite(v)) {
      sum = 0;
      count = 0;
      continue;
    }
    sum += v;
    count++;
    if (count > period) {
      sum -= values[i - period];
      count = period;
    }
    if (count === period) out[i] = sum / period;
  }
  return out;
}
