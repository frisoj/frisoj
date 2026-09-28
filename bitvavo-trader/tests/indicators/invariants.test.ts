import { describe, expect, it } from "vitest";
import * as ind from "../../src/indicators";
import type { Candle } from "../../src/core/types";
import { firstFinite, randomCandles, randomValues } from "./helpers";

type Series = Record<string, number[]>;

/** Alle indicatoren als (naam → functie die een map van reeksen teruggeeft). */
const valueFns: Record<string, (v: number[], p: number) => Series> = {
  sma: (v, p) => ({ sma: ind.sma(v, p) }),
  ema: (v, p) => ({ ema: ind.ema(v, p) }),
  rma: (v, p) => ({ rma: ind.rma(v, p) }),
  stdev: (v, p) => ({ stdev: ind.stdev(v, p) }),
  rsi: (v, p) => ({ rsi: ind.rsi(v, p) }),
  macd: (v, p) => ({ ...ind.macd(v, p, p + 5, p) }),
  bollinger: (v, p) => ({ ...ind.bollinger(v, p, 2) }),
  rollingMax: (v, p) => ({ rollingMax: ind.rollingMax(v, p) }),
  rollingMin: (v, p) => ({ rollingMin: ind.rollingMin(v, p) }),
};

const candleFns: Record<string, (c: Candle[], p: number) => Series> = {
  atr: (c, p) => ({ atr: ind.atr(c, p) }),
  adx: (c, p) => ({ ...ind.adx(c, p) }),
  donchian: (c, p) => ({ ...ind.donchian(c, p) }),
  stochastic: (c, p) => ({ ...ind.stochastic(c, p, 3) }),
  vwap: (c) => ({ vwap: ind.vwap(c) }),
  obv: (c) => ({ obv: ind.obv(c) }),
  closes: (c) => ({ closes: ind.closes(c) }),
  trueRange: (c) => ({ trueRange: ind.trueRange(c) }),
};

/** Verwacht aantal NaN's warmup voor periode p. */
const warmup: Record<string, (p: number) => number> = {
  sma: (p) => p - 1,
  ema: (p) => p - 1,
  rma: (p) => p - 1,
  stdev: (p) => p - 1,
  rsi: (p) => p,
  macd: (p) => p + 5 - 1,
  signal: (p) => p + 5 - 1 + p - 1,
  histogram: (p) => p + 5 - 1 + p - 1,
  upper: (p) => p - 1,
  middle: (p) => p - 1,
  lower: (p) => p - 1,
  bandwidth: (p) => p - 1,
  percentB: (p) => p - 1,
  rollingMax: (p) => p - 1,
  rollingMin: (p) => p - 1,
  atr: (p) => p - 1,
  adx: (p) => 2 * p - 1,
  plusDI: (p) => p,
  minusDI: (p) => p,
  k: (p) => p - 1,
  d: (p) => p + 1,
  vwap: () => 0,
  obv: () => 0,
  closes: () => 0,
  trueRange: () => 0,
};
const donchianWarmup = (p: number) => p;

describe("invarianten voor elke indicator", () => {
  const v = randomValues(300);
  const cs = randomCandles(300);

  for (const [name, fn] of Object.entries(valueFns)) {
    it(`${name}: zelfde lengte, juiste warmup, geen NaN daarna, lege invoer, periode > lengte`, () => {
      for (const p of [1, 2, 5, 14]) {
        const out = fn(v, p);
        for (const [key, arr] of Object.entries(out)) {
          expect(arr.length, `${name}.${key}`).toBe(v.length);
          const w = warmup[key](p);
          expect(firstFinite(arr), `${name}.${key} p=${p}`).toBe(w);
          for (let i = w; i < arr.length; i++) expect(Number.isFinite(arr[i]), `${name}.${key}[${i}]`).toBe(true);
        }
      }
      for (const arr of Object.values(fn([], 3))) expect(arr).toEqual([]);
      for (const arr of Object.values(fn(v.slice(0, 3), 50))) {
        expect(arr.length).toBe(3);
        expect(arr.every((x) => Number.isNaN(x))).toBe(true);
      }
    });

    it(`${name}: gooit bij periode <= 0 of NaN`, () => {
      for (const bad of [0, -3, NaN, Infinity]) expect(() => fn(v, bad)).toThrow(/periode/);
    });
  }

  for (const [name, fn] of Object.entries(candleFns)) {
    it(`${name}: zelfde lengte, juiste warmup, geen NaN daarna, lege invoer`, () => {
      for (const p of [1, 2, 5, 14]) {
        const out = fn(cs, p);
        for (const [key, arr] of Object.entries(out)) {
          expect(arr.length, `${name}.${key}`).toBe(cs.length);
          const w = name === "donchian" ? donchianWarmup(p) : warmup[key](p);
          expect(firstFinite(arr), `${name}.${key} p=${p}`).toBe(w);
          for (let i = w; i < arr.length; i++) expect(Number.isFinite(arr[i]), `${name}.${key}[${i}]`).toBe(true);
        }
      }
      for (const arr of Object.values(fn([], 3))) expect(arr).toEqual([]);
      const short = fn(cs.slice(0, 3), 50);
      for (const arr of Object.values(short)) expect(arr.length).toBe(3);
    });
  }

  it("candle-indicatoren met periode gooien bij periode <= 0", () => {
    for (const bad of [0, -1, NaN]) {
      expect(() => ind.atr(cs, bad)).toThrow(/periode/);
      expect(() => ind.adx(cs, bad)).toThrow(/periode/);
      expect(() => ind.donchian(cs, bad)).toThrow(/periode/);
      expect(() => ind.stochastic(cs, bad)).toThrow(/kPeriod/);
      expect(() => ind.stochastic(cs, 14, bad)).toThrow(/dPeriod/);
      expect(() => ind.macd(v, 12, bad)).toThrow(/slow-periode/);
    }
    expect(() => ind.bollinger(v, 20, NaN)).toThrow(/multiplier/);
  });

  it("standaardparameters komen overeen met het contract", () => {
    expect(ind.rsi(v)).toEqual(ind.rsi(v, 14));
    expect(ind.macd(v)).toEqual(ind.macd(v, 12, 26, 9));
    expect(ind.bollinger(v)).toEqual(ind.bollinger(v, 20, 2));
    expect(ind.atr(cs)).toEqual(ind.atr(cs, 14));
    expect(ind.adx(cs)).toEqual(ind.adx(cs, 14));
    expect(ind.stochastic(cs)).toEqual(ind.stochastic(cs, 14, 3));
  });

  it("functies muteren hun invoer niet", () => {
    const vCopy = [...v];
    const csCopy = JSON.stringify(cs);
    ind.chartIndicators(cs);
    ind.adx(cs);
    ind.donchian(cs, 20);
    ind.stochastic(cs);
    ind.obv(cs);
    ind.macd(v);
    ind.bollinger(v);
    ind.rollingMax(v, 5);
    expect(v).toEqual(vCopy);
    expect(JSON.stringify(cs)).toBe(csCopy);
  });

  it("zero-volume candles geven geen NaN", () => {
    const zero = cs.map((c) => ({ ...c, volume: 0 }));
    expect(ind.vwap(zero).every(Number.isFinite)).toBe(true);
    expect(ind.obv(zero).every((x) => x === 0)).toBe(true);
  });
});
