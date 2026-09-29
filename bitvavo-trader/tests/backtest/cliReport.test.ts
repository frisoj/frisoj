/**
 * Pure helpers of the CLI backtest (src/cli/backtestReport.ts): warmup window
 * and the warning about sells the exchange would refuse.
 */
import { describe, expect, it } from "vitest";
import { backtestWindow, stuckTradesWarning } from "../../src/cli/backtestReport";
import { DEFAULT_ENSEMBLE_CONFIG } from "../../src/core/defaults";
import { backtestWarmupCandles } from "../../src/server/warmup";
import { STEP, T0, flatCandles } from "./helpers";

describe("CLI backtestWindow — never trade during the strategies' warmup", () => {
  const candles = flatCandles(500); // times T0 + i × STEP

  it("starts at the first candle of the period when there is enough history before it", () => {
    const w = backtestWindow(candles, T0 + 300 * STEP, 111);
    expect(w).toEqual({ firstInPeriod: 300, tradeFromIndex: 300, shortened: false });
  });

  it("shifts the start to the warmup when the history begins (almost) at the period start", () => {
    // Recent listing / long period: the first candle is already inside the period.
    const w = backtestWindow(candles, T0 - 10 * STEP, 111);
    expect(w).toEqual({ firstInPeriod: 0, tradeFromIndex: 111, shortened: true });
    const partial = backtestWindow(candles, T0 + 50 * STEP, 111);
    expect(partial).toEqual({ firstInPeriod: 50, tradeFromIndex: 111, shortened: true });
  });

  it("uses the same warmup as the server (default ensemble: 111 candles; optimising ema-trend: 211)", () => {
    const required = backtestWarmupCandles(DEFAULT_ENSEMBLE_CONFIG);
    expect(required).toBeGreaterThanOrEqual(100);
    expect(backtestWindow(candles, T0, required).tradeFromIndex).toBe(required);
    const opt = backtestWarmupCandles(DEFAULT_ENSEMBLE_CONFIG, "ema-trend");
    expect(opt).toBeGreaterThan(required);
    expect(backtestWindow(candles, T0, opt).tradeFromIndex).toBe(opt);
  });

  it("handles a period after the last candle and odd warmup values", () => {
    expect(backtestWindow(candles, T0 + 10_000 * STEP, 111)).toEqual({ firstInPeriod: 500, tradeFromIndex: 500, shortened: false });
    expect(backtestWindow(candles, T0 + 300 * STEP, Number.NaN).tradeFromIndex).toBe(300);
    expect(backtestWindow(candles, T0, 10_000)).toEqual({ firstInPeriod: 0, tradeFromIndex: 500, shortened: true });
    expect(backtestWindow([], T0, 111)).toEqual({ firstInPeriod: 0, tradeFromIndex: 0, shortened: false });
  });
});

describe("CLI stuckTradesWarning — sold later vs. still unsellable at the end", () => {
  it("is null without refused sells", () => {
    expect(stuckTradesWarning({ stuckTrades: 0, stuckAtEnd: 0, stuckCandles: 0, minOrderQuote: 5 })).toBeNull();
  });

  it("only sold later: says it was sold after all, not that it is still stuck", () => {
    const w = stuckTradesWarning({ stuckTrades: 2, stuckAtEnd: 0, stuckCandles: 7, minOrderQuote: 5 })!;
    expect(w).toContain("bij 2 trades weigerde de beurs eerst de verkoop");
    expect(w).toContain("beursminimum van €5,00");
    expect(w).toContain("later alsnog verkocht");
    expect(w).not.toContain("onverkoopbaar");
    expect(w).toContain("Samen 7 candles zonder stop-loss");
  });

  it("only still unsellable at the end: does NOT claim it was sold later", () => {
    const w = stuckTradesWarning({ stuckTrades: 1, stuckAtEnd: 1, stuckCandles: 1, minOrderQuote: 5 })!;
    expect(w).toMatch(/^Let op: 1 positie was aan het einde van de test nog steeds onverkoopbaar/);
    expect(w).toContain("tegen de laatste slotkoers gewaardeerd");
    expect(w).not.toContain("alsnog verkocht");
    expect(w).not.toContain("weigerde de beurs eerst");
    expect(w).toContain("Samen 1 candle zonder stop-loss");
  });

  it("both: names each group with its own count", () => {
    const w = stuckTradesWarning({ stuckTrades: 3, stuckAtEnd: 1, stuckCandles: 12, minOrderQuote: 1 })!;
    expect(w).toContain("bij 2 trades weigerde de beurs eerst de verkoop");
    expect(w).toContain("later alsnog verkocht");
    expect(w).toContain("Daarnaast was 1 positie aan het einde van de test nog steeds onverkoopbaar");
    expect(w).toContain("beursminimum van €1,00");
    expect(w).toContain("Samen 12 candles");
  });

  it("clamps inconsistent counts (never more stuck at the end than stuck in total)", () => {
    const w = stuckTradesWarning({ stuckTrades: 1, stuckAtEnd: 5, stuckCandles: 2, minOrderQuote: 5 })!;
    expect(w).toContain("Let op: 1 positie was");
    expect(w).not.toContain("alsnog verkocht");
    const many = stuckTradesWarning({ stuckTrades: 2, stuckAtEnd: 2, stuckCandles: 2, minOrderQuote: 5 })!;
    expect(many).toContain("Let op: 2 posities waren aan het einde");
    expect(many).toContain("zijn die tegen de laatste slotkoers gewaardeerd");
  });
});
