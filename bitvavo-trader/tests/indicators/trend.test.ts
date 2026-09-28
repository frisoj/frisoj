import { describe, expect, it } from "vitest";
import { adx } from "../../src/indicators";
import { candle, expectClose, firstFinite, naiveAdx, randomCandles } from "./helpers";

describe("adx", () => {
  it("komt overeen met Wilder's definitie op random data", () => {
    const cs = randomCandles(1500);
    for (const p of [3, 14, 20]) {
      const out = adx(cs, p);
      const ref = naiveAdx(cs, p);
      expectClose(out.adx, ref.adx, 1e-9);
      expectClose(out.plusDI, ref.plusDI, 1e-9);
      expectClose(out.minusDI, ref.minusDI, 1e-9);
    }
  });

  it("warmup: DI vanaf index period, ADX vanaf 2·period−1", () => {
    const cs = randomCandles(100);
    const out = adx(cs);
    expect(out.adx.length).toBe(100);
    expect(firstFinite(out.plusDI)).toBe(14);
    expect(firstFinite(out.minusDI)).toBe(14);
    expect(firstFinite(out.adx)).toBe(27);
    const short = adx(cs.slice(0, 27), 14);
    expect(firstFinite(short.adx)).toBe(-1);
    expect(firstFinite(adx(cs.slice(0, 28), 14).adx)).toBe(27);
  });

  it("sterke uptrend → +DI > −DI en hoge ADX; binnen 0..100", () => {
    const cs = Array.from({ length: 60 }, (_, i) => candle(i, 101 + i, 99 + i, 100.5 + i));
    const out = adx(cs, 14);
    expect(out.plusDI[59]).toBeGreaterThan(out.minusDI[59]);
    expect(out.minusDI[59]).toBe(0);
    expect(out.adx[59]).toBeCloseTo(100, 6);
    for (const arr of [out.adx, out.plusDI, out.minusDI]) {
      for (const x of arr) if (!Number.isNaN(x)) expect(x >= 0 && x <= 100).toBe(true);
    }
  });

  it("constante candles geven 0, geen NaN na warmup", () => {
    const flat = Array.from({ length: 40 }, (_, i) => candle(i, 5, 5, 5));
    const ranged = Array.from({ length: 40 }, (_, i) => candle(i, 6, 4, 5));
    for (const cs of [flat, ranged]) {
      const out = adx(cs, 14);
      for (let i = 27; i < 40; i++) {
        expect(out.adx[i]).toBe(0);
        expect(out.plusDI[i]).toBe(0);
        expect(out.minusDI[i]).toBe(0);
      }
    }
  });
});
