import { describe, expect, it } from "vitest";
import { atr, bollinger, donchian, sma, stdev, trueRange } from "../../src/indicators";
import {
  candle,
  expectClose,
  firstFinite,
  naiveAtr,
  naiveSma,
  naiveStd,
  naiveTr,
  randomCandles,
  randomValues,
} from "./helpers";

describe("atr", () => {
  it("rekent een klein voorbeeld met de hand goed uit (Wilder)", () => {
    const cs = [
      candle(0, 10, 8, 9), // TR 2 (h−l)
      candle(1, 11, 9, 10.5), // TR max(2, 2, 0) = 2
      candle(2, 12, 10.5, 11), // TR max(1.5, 1.5, 0) = 1.5
      candle(3, 15, 14, 14.5), // gap: TR max(1, 4, 3) = 4
      candle(4, 14, 12, 13), // TR max(2, 0.5, 2.5) = 2.5
    ];
    expectClose(trueRange(cs), [2, 2, 1.5, 4, 2.5]);
    // p=3: 5.5/3 = 11/6; (11/6·2 + 4)/3 = 23/9; (23/9·2 + 2.5)/3 = 137/54
    expectClose(atr(cs, 3), [NaN, NaN, 11 / 6, 23 / 9, 137 / 54]);
  });

  it("komt overeen met een naïeve implementatie en heeft period−1 NaN's warmup", () => {
    const cs = randomCandles(1000);
    expectClose(trueRange(cs), naiveTr(cs), 1e-12);
    for (const p of [1, 5, 14]) expectClose(atr(cs, p), naiveAtr(cs, p), 1e-10);
    expect(firstFinite(atr(cs))).toBe(13);
  });

  it("is 0 bij candles zonder beweging", () => {
    const cs = Array.from({ length: 30 }, (_, i) => candle(i, 5, 5, 5));
    for (const x of atr(cs, 14).slice(13)) expect(x).toBe(0);
  });
});

describe("bollinger", () => {
  it("middle = SMA, banden = middle ± mult × populatie-stdev (symmetrisch)", () => {
    const v = randomValues(400);
    const bb = bollinger(v, 20, 2);
    expectClose(bb.middle, naiveSma(v, 20), 1e-10);
    const sd = naiveStd(v, 20);
    for (let i = 0; i < v.length; i++) {
      if (i < 19) {
        for (const arr of [bb.upper, bb.middle, bb.lower, bb.bandwidth, bb.percentB]) {
          expect(Number.isNaN(arr[i])).toBe(true);
        }
        continue;
      }
      expect(bb.upper[i] - bb.middle[i]).toBeCloseTo(bb.middle[i] - bb.lower[i], 9);
      expect(bb.upper[i] - bb.middle[i]).toBeCloseTo(2 * sd[i], 9);
      expect(bb.bandwidth[i]).toBeCloseTo((bb.upper[i] - bb.lower[i]) / bb.middle[i], 12);
      expect(bb.percentB[i]).toBeCloseTo((v[i] - bb.lower[i]) / (bb.upper[i] - bb.lower[i]), 9);
    }
    expectClose(bb.middle, sma(v, 20));
    expectClose(stdev(v, 20), sd, 1e-9);
  });

  it("hand-voorbeeld [1..5], p=5, mult=2", () => {
    const bb = bollinger([1, 2, 3, 4, 5], 5, 2);
    expect(bb.middle[4]).toBeCloseTo(3, 12);
    expect(bb.upper[4]).toBeCloseTo(3 + 2 * Math.SQRT2, 12);
    expect(bb.lower[4]).toBeCloseTo(3 - 2 * Math.SQRT2, 12);
    expect(bb.percentB[4]).toBeCloseTo((5 - (3 - 2 * Math.SQRT2)) / (4 * Math.SQRT2), 12);
  });

  it("constante koersen: breedte 0, percentB 0.5, geen NaN na warmup", () => {
    for (const price of [100, 0.1, 61234.57]) {
      const bb = bollinger(new Array(40).fill(price));
      for (let i = 19; i < 40; i++) {
        expect(bb.upper[i]).toBe(price);
        expect(bb.lower[i]).toBe(price);
        expect(bb.middle[i]).toBe(price);
        expect(bb.bandwidth[i]).toBe(0);
        expect(bb.percentB[i]).toBe(0.5);
      }
    }
  });
});

describe("donchian", () => {
  it("sluit de huidige candle uit (breakout = close[i] > upper[i])", () => {
    const cs = Array.from({ length: 10 }, (_, i) => candle(i, 10, 5, 7));
    cs[6] = candle(6, 20, 1, 19); // spike
    const d = donchian(cs, 3);
    expect(firstFinite(d.upper)).toBe(3);
    expect(d.upper[6]).toBe(10); // spike zelf telt niet mee
    expect(d.lower[6]).toBe(5);
    expect(cs[6].close > d.upper[6]).toBe(true); // breakout detecteerbaar
    expect(d.upper[7]).toBe(20);
    expect(d.lower[7]).toBe(1);
    expect(d.middle[7]).toBe(10.5);
    expect(d.upper[9]).toBe(20);
    expect(d.upper[10 - 1]).toBe(20);
    const later = donchian([...cs, candle(10, 10, 5, 7)], 3);
    expect(later.upper[10]).toBe(10); // spike (index 6) valt buiten [7..9]
  });

  it("komt overeen met een naïeve implementatie", () => {
    const cs = randomCandles(800);
    for (const p of [1, 5, 20]) {
      const d = donchian(cs, p);
      for (let i = 0; i < cs.length; i++) {
        if (i < p) {
          expect(Number.isNaN(d.upper[i])).toBe(true);
          continue;
        }
        const w = cs.slice(i - p, i);
        const u = Math.max(...w.map((c) => c.high));
        const l = Math.min(...w.map((c) => c.low));
        expect(d.upper[i]).toBe(u);
        expect(d.lower[i]).toBe(l);
        expect(d.middle[i]).toBe((u + l) / 2);
      }
    }
  });
});
