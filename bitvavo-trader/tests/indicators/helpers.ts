/**
 * Testhulpmiddelen: deterministische candle-generator en naïeve (O(n·k),
 * letterlijk-uit-het-boek) referentie-implementaties, onafhankelijk van de
 * bibliotheekcode.
 */
import type { Candle } from "../../src/core/types";
import { mulberry32 } from "../../src/core/util";

export const MIN15 = 15 * 60_000;

export function randomCandles(n: number, seed = 42, start = Date.UTC(2024, 0, 1), step = MIN15): Candle[] {
  const rnd = mulberry32(seed);
  const out: Candle[] = [];
  let price = 30000;
  for (let i = 0; i < n; i++) {
    const open = price;
    const close = Math.max(1, open * (1 + (rnd() - 0.5) * 0.02));
    const high = Math.max(open, close) * (1 + rnd() * 0.005);
    const low = Math.min(open, close) * (1 - rnd() * 0.005);
    const volume = rnd() < 0.05 ? 0 : rnd() * 10;
    out.push({ time: start + i * step, open, high, low, close, volume });
    price = close;
  }
  return out;
}

export function randomValues(n: number, seed = 7): number[] {
  const rnd = mulberry32(seed);
  const out: number[] = [];
  let v = 100;
  for (let i = 0; i < n; i++) {
    v += (rnd() - 0.5) * 4;
    out.push(v);
  }
  return out;
}

export function candle(time: number, high: number, low: number, close: number, volume = 1, open = close): Candle {
  return { time, open, high, low, close, volume };
}

/** Eerste index met een eindige waarde (−1 als die er niet is). */
export function firstFinite(a: ArrayLike<number | null>): number {
  for (let i = 0; i < a.length; i++) {
    const v = a[i];
    if (v !== null && Number.isFinite(v)) return i;
  }
  return -1;
}

export function expectClose(actual: number[], expected: number[], tol = 1e-9): void {
  if (actual.length !== expected.length) {
    throw new Error(`lengte ${actual.length} != ${expected.length}`);
  }
  for (let i = 0; i < actual.length; i++) {
    const a = actual[i];
    const e = expected[i];
    if (Number.isNaN(e)) {
      if (!Number.isNaN(a)) throw new Error(`index ${i}: verwacht NaN, kreeg ${a}`);
      continue;
    }
    const scale = Math.max(1, Math.abs(e));
    if (!(Math.abs(a - e) <= tol * scale)) {
      throw new Error(`index ${i}: verwacht ${e}, kreeg ${a}`);
    }
  }
}

// ───────────────────────── Naïeve referenties ─────────────────────────

export function naiveSma(v: number[], p: number): number[] {
  return v.map((_, i) => {
    if (i < p - 1) return NaN;
    let s = 0;
    for (let j = i - p + 1; j <= i; j++) s += v[j];
    return s / p;
  });
}

export function naiveStd(v: number[], p: number): number[] {
  return v.map((_, i) => {
    if (i < p - 1) return NaN;
    const w = v.slice(i - p + 1, i + 1);
    const m = w.reduce((a, b) => a + b, 0) / p;
    return Math.sqrt(w.reduce((a, b) => a + (b - m) ** 2, 0) / p);
  });
}

/** Textbook EMA zonder NaN-ondersteuning: seed = SMA van de eerste p waarden. */
export function naiveEma(v: number[], p: number): number[] {
  const k = 2 / (p + 1);
  const out = v.map(() => NaN);
  if (v.length < p) return out;
  let e = v.slice(0, p).reduce((a, b) => a + b, 0) / p;
  out[p - 1] = e;
  for (let i = p; i < v.length; i++) {
    e = v[i] * k + e * (1 - k);
    out[i] = e;
  }
  return out;
}

export function naiveRsi(c: number[], p: number): number[] {
  const out = c.map(() => NaN);
  const gains: number[] = [];
  const losses: number[] = [];
  for (let i = 1; i < c.length; i++) {
    const d = c[i] - c[i - 1];
    gains.push(Math.max(d, 0));
    losses.push(Math.max(-d, 0));
  }
  if (gains.length < p) return out;
  let ag = gains.slice(0, p).reduce((a, b) => a + b, 0) / p;
  let al = losses.slice(0, p).reduce((a, b) => a + b, 0) / p;
  const val = () => (al === 0 ? (ag === 0 ? 50 : 100) : 100 - 100 / (1 + ag / al));
  out[p] = val();
  for (let j = p; j < gains.length; j++) {
    ag = (ag * (p - 1) + gains[j]) / p;
    al = (al * (p - 1) + losses[j]) / p;
    out[j + 1] = val();
  }
  return out;
}

export function naiveTr(cs: Candle[]): number[] {
  return cs.map((c, i) =>
    i === 0
      ? c.high - c.low
      : Math.max(c.high - c.low, Math.abs(c.high - cs[i - 1].close), Math.abs(c.low - cs[i - 1].close)),
  );
}

export function naiveAtr(cs: Candle[], p: number): number[] {
  const tr = naiveTr(cs);
  const out = cs.map(() => NaN);
  if (cs.length < p) return out;
  let a = tr.slice(0, p).reduce((x, y) => x + y, 0) / p;
  out[p - 1] = a;
  for (let i = p; i < cs.length; i++) {
    a = (a * (p - 1) + tr[i]) / p;
    out[i] = a;
  }
  return out;
}

/** Wilder's ADX zoals in "New Concepts in Technical Trading Systems" (met Wilder-sommen). */
export function naiveAdx(cs: Candle[], p: number): { adx: number[]; plusDI: number[]; minusDI: number[] } {
  const n = cs.length;
  const adx = cs.map(() => NaN);
  const plusDI = cs.map(() => NaN);
  const minusDI = cs.map(() => NaN);
  const tr: number[] = [NaN];
  const pdm: number[] = [NaN];
  const mdm: number[] = [NaN];
  for (let i = 1; i < n; i++) {
    const up = cs[i].high - cs[i - 1].high;
    const dn = cs[i - 1].low - cs[i].low;
    pdm.push(up > dn && up > 0 ? up : 0);
    mdm.push(dn > up && dn > 0 ? dn : 0);
    tr.push(
      Math.max(cs[i].high - cs[i].low, Math.abs(cs[i].high - cs[i - 1].close), Math.abs(cs[i].low - cs[i - 1].close)),
    );
  }
  const dx: number[] = cs.map(() => NaN);
  let sTr = 0;
  let sP = 0;
  let sM = 0;
  for (let i = 1; i < n; i++) {
    if (i < p) {
      sTr += tr[i];
      sP += pdm[i];
      sM += mdm[i];
      continue;
    }
    if (i === p) {
      sTr += tr[i];
      sP += pdm[i];
      sM += mdm[i];
    } else {
      sTr = sTr - sTr / p + tr[i];
      sP = sP - sP / p + pdm[i];
      sM = sM - sM / p + mdm[i];
    }
    const pd = sTr === 0 ? 0 : (100 * sP) / sTr;
    const md = sTr === 0 ? 0 : (100 * sM) / sTr;
    plusDI[i] = pd;
    minusDI[i] = md;
    dx[i] = pd + md === 0 ? 0 : (100 * Math.abs(pd - md)) / (pd + md);
  }
  const first = 2 * p - 1;
  if (n > first) {
    let a = 0;
    for (let i = p; i <= first; i++) a += dx[i];
    a /= p;
    adx[first] = a;
    for (let i = first + 1; i < n; i++) {
      a = (a * (p - 1) + dx[i]) / p;
      adx[i] = a;
    }
  }
  return { adx, plusDI, minusDI };
}

export function naiveRollingMax(v: number[], p: number): number[] {
  return v.map((_, i) => (i < p - 1 ? NaN : Math.max(...v.slice(i - p + 1, i + 1))));
}

export function naiveRollingMin(v: number[], p: number): number[] {
  return v.map((_, i) => (i < p - 1 ? NaN : Math.min(...v.slice(i - p + 1, i + 1))));
}

export function naiveVwap(cs: Candle[]): number[] {
  return cs.map((c, i) => {
    const day = new Date(c.time).toISOString().slice(0, 10);
    let pv = 0;
    let v = 0;
    for (let j = i; j >= 0 && new Date(cs[j].time).toISOString().slice(0, 10) === day; j--) {
      const tp = (cs[j].high + cs[j].low + cs[j].close) / 3;
      pv += tp * cs[j].volume;
      v += cs[j].volume;
    }
    return v === 0 ? (c.high + c.low + c.close) / 3 : pv / v;
  });
}
