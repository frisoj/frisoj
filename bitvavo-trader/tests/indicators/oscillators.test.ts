import { describe, expect, it } from "vitest";
import { ema, macd, rsi, sma, stochastic } from "../../src/indicators";
import { candle, expectClose, firstFinite, naiveRsi, naiveSma, randomCandles, randomValues } from "./helpers";

describe("rsi", () => {
  it("rekent een klein voorbeeld met de hand goed uit (Wilder)", () => {
    // veranderingen +1 +1 −1 +1, p=2:
    // idx2: avgG 1, avgL 0 → 100; idx3: avgG 0.5, avgL 0.5 → 50; idx4: avgG .75, avgL .25 → 75
    expectClose(rsi([1, 2, 3, 2, 3], 2), [NaN, NaN, 100, 50, 75]);
  });

  it("reproduceert het StockCharts-voorbeeld (RSI 14)", () => {
    const c = [
      44.34, 44.09, 44.15, 43.61, 44.33, 44.83, 45.1, 45.42, 45.84, 46.08, 45.89, 46.03, 45.61, 46.28, 46.28, 46.0,
      46.03, 46.41, 46.22, 45.64, 46.21, 46.25, 45.71,
    ];
    const expected = [70.46, 66.25, 66.48, 69.35, 66.29, 57.92, 62.88, 63.21, 56.01];
    const out = rsi(c, 14);
    expect(firstFinite(out)).toBe(14);
    expected.forEach((e, j) => expect(Math.abs(out[14 + j] - e)).toBeLessThan(0.006));
  });

  it("komt overeen met een naïeve implementatie op random data", () => {
    const v = randomValues(2000);
    for (const p of [2, 7, 14, 30]) expectClose(rsi(v, p), naiveRsi(v, p), 1e-9);
  });

  it("gebruikt standaard periode 14 en heeft 14 NaN's warmup", () => {
    const out = rsi(randomValues(100));
    expect(out.length).toBe(100);
    expect(firstFinite(out)).toBe(14);
  });

  it("randgevallen: constant → 50, alleen stijgen → 100, alleen dalen → 0", () => {
    const flat = rsi(new Array(30).fill(5), 14);
    const up = rsi(Array.from({ length: 30 }, (_, i) => i + 1), 14);
    const down = rsi(Array.from({ length: 30 }, (_, i) => 100 - i), 14);
    for (let i = 14; i < 30; i++) {
      expect(flat[i]).toBe(50);
      expect(up[i]).toBe(100);
      expect(down[i]).toBe(0);
    }
  });

  it("verwerkt leidende NaN's", () => {
    const v = randomValues(100);
    const out = rsi([NaN, NaN, NaN, ...v], 14);
    expect(firstFinite(out)).toBe(3 + 14);
    expectClose(out.slice(3), naiveRsi(v, 14), 1e-12);
  });

  it("blijft binnen 0..100", () => {
    for (const x of rsi(randomValues(5000, 3), 14)) if (!Number.isNaN(x)) expect(x >= 0 && x <= 100).toBe(true);
  });
});

describe("macd", () => {
  const v = randomValues(500);

  it("macd = EMA(fast) − EMA(slow), signal = EMA(macd), histogram = macd − signal", () => {
    const m = macd(v);
    const f = ema(v, 12);
    const s = ema(v, 26);
    expect(m.macd.length).toBe(500);
    expect(m.signal.length).toBe(500);
    expect(m.histogram.length).toBe(500);
    for (let i = 0; i < 500; i++) {
      if (i < 25) expect(Number.isNaN(m.macd[i])).toBe(true);
      else expect(m.macd[i]).toBeCloseTo(f[i] - s[i], 12);
      if (i < 33) {
        expect(Number.isNaN(m.signal[i])).toBe(true);
        expect(Number.isNaN(m.histogram[i])).toBe(true);
      } else {
        expect(m.histogram[i]).toBeCloseTo(m.macd[i] - m.signal[i], 12);
      }
    }
    // signal = textbook EMA(9) van de (eindige) macd-lijn
    const sig = ema(m.macd.slice(25), 9);
    expectClose(m.signal.slice(25), sig, 1e-12);
    expect(firstFinite(m.macd)).toBe(25);
    expect(firstFinite(m.signal)).toBe(33);
  });

  it("respecteert eigen periodes", () => {
    const m = macd(v, 5, 10, 4);
    expect(firstFinite(m.macd)).toBe(9);
    expect(firstFinite(m.signal)).toBe(12);
  });

  it("is 0 bij een constante reeks", () => {
    const m = macd(new Array(60).fill(123.45));
    for (let i = 33; i < 60; i++) {
      expect(m.macd[i]).toBe(0);
      expect(m.signal[i]).toBe(0);
      expect(m.histogram[i]).toBe(0);
    }
  });
});

describe("stochastic", () => {
  it("rekent %K en %D volgens de definitie", () => {
    const cs = randomCandles(300);
    const { k, d } = stochastic(cs, 14, 3);
    expect(k.length).toBe(300);
    expect(d.length).toBe(300);
    expect(firstFinite(k)).toBe(13);
    expect(firstFinite(d)).toBe(15);
    for (let i = 13; i < 300; i++) {
      const w = cs.slice(i - 13, i + 1);
      const hh = Math.max(...w.map((c) => c.high));
      const ll = Math.min(...w.map((c) => c.low));
      expect(k[i]).toBeCloseTo((100 * (cs[i].close - ll)) / (hh - ll), 9);
      expect(k[i] >= 0 && k[i] <= 100).toBe(true);
    }
    expectClose(d, naiveSma(k.map((x) => (Number.isNaN(x) ? 0 : x)), 3).map((x, i) => (i < 15 ? NaN : x)), 1e-9);
    expectClose(d, sma(k, 3));
  });

  it("geeft 50 als de range 0 is", () => {
    const cs = Array.from({ length: 20 }, (_, i) => candle(i * 60_000, 10, 10, 10));
    const { k, d } = stochastic(cs);
    for (let i = 13; i < 20; i++) expect(k[i]).toBe(50);
    for (let i = 15; i < 20; i++) expect(d[i]).toBe(50);
  });
});
