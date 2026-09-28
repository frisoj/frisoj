import { describe, expect, it } from "vitest";
import * as ind from "../../src/indicators";
import type { Candle } from "../../src/core/types";
import { randomCandles } from "./helpers";

function runAll(cs: Candle[]): number {
  const c = ind.closes(cs);
  let sink = 0;
  const add = (a: number[]) => {
    sink += a.length;
  };
  add(ind.sma(c, 50));
  add(ind.ema(c, 21));
  add(ind.rma(c, 14));
  add(ind.stdev(c, 20));
  add(ind.rsi(c, 14));
  const m = ind.macd(c, 12, 26, 9);
  add(m.histogram);
  const bb = ind.bollinger(c, 20, 2);
  add(bb.percentB);
  add(ind.atr(cs, 14));
  add(ind.adx(cs, 14).adx);
  add(ind.donchian(cs, 20).upper);
  add(ind.vwap(cs));
  add(ind.stochastic(cs, 14, 3).d);
  add(ind.obv(cs));
  add(ind.rollingMax(c, 100));
  add(ind.rollingMin(c, 100));
  add(ind.trueRange(cs));
  add(ind.chartIndicators(cs).atr as number[]);
  return sink;
}

describe("performance", () => {
  it("alle indicatoren op 20k candles < 300 ms", () => {
    const cs = randomCandles(20_000, 123);
    runAll(cs); // JIT-opwarming
    const t0 = performance.now();
    const sink = runAll(cs);
    const ms = performance.now() - t0;
    expect(sink).toBe(20_000 * 17);
    expect(ms).toBeLessThan(300);
  });

  it("grote periodes blijven O(n) (rollingMax/donchian/sma met periode 5000)", () => {
    const cs = randomCandles(20_000, 5);
    const c = ind.closes(cs);
    const t0 = performance.now();
    ind.rollingMax(c, 5000);
    ind.rollingMin(c, 5000);
    ind.donchian(cs, 5000);
    ind.sma(c, 5000);
    ind.stdev(c, 5000);
    ind.ema(c, 5000);
    expect(performance.now() - t0).toBeLessThan(200);
  });
});
