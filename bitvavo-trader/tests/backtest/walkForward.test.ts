import { describe, expect, it } from "vitest";
import { WF_WARMUP_CANDLES, foldWindows, walkForwardWith } from "../../src/backtest/walkForwardCore";
import { backtestVerdict, walkForwardVerdict } from "../../src/backtest/verdict";
import { emptyMetrics } from "../../src/backtest/metrics";
import type { Candle } from "../../src/core/types";
import { input, momentumDecide, stubOptimizerDeps, walkCandles } from "./helpers";

describe("foldWindows", () => {
  it("splits into consecutive, non-overlapping windows with a train/test split", () => {
    const w = foldWindows(100, 1100, 4, 0.7);
    expect(w).toHaveLength(4);
    expect(w[0].winStart).toBe(100);
    expect(w[3].winEnd).toBe(1100);
    for (let k = 0; k < w.length; k++) {
      expect(w[k].trainEnd).toBe(w[k].winStart + Math.round((w[k].winEnd - w[k].winStart) * 0.7));
      if (k > 0) expect(w[k].winStart).toBe(w[k - 1].winEnd);
    }
  });

  it("throws a Dutch error when the windows get too small", () => {
    expect(() => foldWindows(0, 100, 5, 0.7)).toThrow(/Te weinig candles/);
  });
});

describe("walkForward", () => {
  const candles = walkCandles(3000, 11);

  it("uses non-overlapping train/test periods and never lets the optimizer see test data", () => {
    const lastTimes: number[] = [];
    const m = momentumDecide();
    const deps = stubOptimizerDeps({
      decide: (market, cs: Candle[], cfg) => {
        lastTimes.push(cs[cs.length - 1].time);
        return m.decide(market, cs, cfg);
      },
      classify: m.classify,
    });
    const res = walkForwardWith(input(candles, { tradeFromIndex: 250 }), { folds: 4, trainRatio: 0.7, objective: "sharpe", maxCombos: 30 }, deps);
    expect(res.folds).toHaveLength(4);
    for (let k = 0; k < res.folds.length; k++) {
      const f = res.folds[k];
      expect(f.trainFrom).toBeLessThan(f.trainTo);
      expect(f.trainTo).toBeLessThan(f.testFrom);
      expect(f.testFrom).toBeLessThan(f.testTo);
      if (k > 0) expect(f.trainFrom).toBeGreaterThan(res.folds[k - 1].testTo);
    }
    expect(res.folds[0].trainFrom).toBe(candles[250].time);
    expect(res.folds[3].testTo).toBe(candles[candles.length - 1].time);
    // Every decide() call ends either at a training end (optimisation) or at a test end (OOS run).
    const allowed = new Set(res.folds.flatMap((f) => [f.trainTo, f.testTo]));
    for (const t of lastTimes) expect(allowed.has(t)).toBe(true);
    // The out-of-sample curve only covers test windows.
    for (const p of res.oosEquityCurve) {
      expect(res.folds.some((f) => p.time >= f.testFrom && p.time <= f.testTo)).toBe(true);
    }
    const oosTrades = res.folds.reduce((s, f) => s + f.testMetrics.trades, 0);
    expect(res.oosMetrics.trades).toBe(oosTrades);
  });

  it("stitches the out-of-sample curve with compounding equity", () => {
    const res = walkForwardWith(input(candles), { folds: 3, trainRatio: 0.6, objective: "return", maxCombos: 24 }, stubOptimizerDeps());
    const windows = foldWindows(0, candles.length, 3, 0.6);
    const testLen = windows.reduce((s, w) => s + (w.winEnd - w.trainEnd), 0);
    expect(res.oosEquityCurve).toHaveLength(testLen);
    for (let i = 1; i < res.oosEquityCurve.length; i++) {
      expect(res.oosEquityCurve[i].time).toBeGreaterThan(res.oosEquityCurve[i - 1].time);
    }
    // Compounding: final = initial × Π(1 + fold return).
    const compounded = res.folds.reduce((e, f) => e * (1 + f.testMetrics.totalReturnPct / 100), 100);
    expect(res.oosMetrics.finalEquity).toBeCloseTo(compounded, 8);
    expect(res.oosEquityCurve[res.oosEquityCurve.length - 1].equity).toBeCloseTo(res.oosMetrics.finalEquity, 10);
    // Each fold starts with the previous fold's ending equity.
    let start = 100;
    let idx = 0;
    for (let k = 0; k < windows.length; k++) {
      const len = windows[k].winEnd - windows[k].trainEnd;
      const foldEnd = res.oosEquityCurve[idx + len - 1].equity;
      expect(foldEnd).toBeCloseTo(start * (1 + res.folds[k].testMetrics.totalReturnPct / 100), 8);
      start = foldEnd;
      idx += len;
    }
    // Benchmark compounds per test window too.
    const bh = windows.reduce(
      (e, w) => e * ((candles[w.winEnd - 1].close / candles[w.trainEnd].open) * (1 - 0.0025)) / (1 + 0.0025),
      100,
    );
    expect(res.oosEquityCurve[res.oosEquityCurve.length - 1].benchmark).toBeCloseTo(bh, 8);
    expect(res.oosMetrics.buyHoldReturnPct).toBeCloseTo((bh / 100 - 1) * 100, 8);
    for (const p of res.oosEquityCurve) expect(p.drawdownPct).toBeLessThanOrEqual(0);
    expect(typeof res.verdict).toBe("string");
    expect(res.verdict.length).toBeGreaterThan(20);
  });

  it("uses ~250 warmup candles before each test window without trading them", () => {
    const res = walkForwardWith(input(candles), { folds: 2, trainRatio: 0.7, objective: "sharpe", maxCombos: 12 }, stubOptimizerDeps());
    for (const f of res.folds) {
      const testStartIdx = candles.findIndex((c) => c.time === f.testFrom);
      expect(testStartIdx).toBeGreaterThanOrEqual(WF_WARMUP_CANDLES);
    }
    const oosTimes = new Set(res.oosEquityCurve.map((p) => p.time));
    for (const f of res.folds) {
      expect(oosTimes.has(f.testFrom)).toBe(true);
      expect(oosTimes.has(f.trainTo)).toBe(false);
    }
  });

  it("falls back to the current settings when no combo has enough trades", () => {
    const deps = stubOptimizerDeps({ decide: (market, cs) => momentumDecide().decide(market, cs, { ...input(cs).ensemble, buyThreshold: 99, sellThreshold: -99 }) });
    const res = walkForwardWith(input(candles), { folds: 2, trainRatio: 0.7, objective: "sharpe", maxCombos: 10 }, deps);
    for (const f of res.folds) {
      expect(f.bestParams["ensemble.buyThreshold"]).toBe(0.35);
      expect(f.bestParams["risk.stopAtrMult"]).toBe(2);
    }
    expect(res.oosMetrics.trades).toBe(0);
    expect(res.verdict).toMatch(/geen enkele trade/);
  });
});

describe("verdicts", () => {
  const v = { profitableFolds: 2, folds: 4, oosTrades: 30 };

  it("losing out-of-sample → do not go live", () => {
    expect(walkForwardVerdict({ ...v, oosReturnPct: -3.2, buyHoldReturnPct: 1.1 })).toBe(
      "Out-of-sample verliesgevend (-3,2%) en slechter dan buy & hold (+1,1%). Niet live gaan met deze instellingen.",
    );
    const s = walkForwardVerdict({ ...v, oosReturnPct: -3.2, buyHoldReturnPct: -9 });
    expect(s).toContain("verliesgevend (-3,2%)");
    expect(s).toContain("Niet live gaan");
  });

  it("slightly profitable but weak evidence → keep paper trading", () => {
    expect(walkForwardVerdict({ ...v, oosReturnPct: 0.8, buyHoldReturnPct: -1 })).toBe(
      "Out-of-sample licht winstgevend (+0,8%) in 2 van 4 folds; te weinig bewijs, blijf paper traden.",
    );
    const worse = walkForwardVerdict({ ...v, profitableFolds: 3, oosReturnPct: 4, buyHoldReturnPct: 6 });
    expect(worse).toContain("niet beter dan buy & hold (+6,0%)");
    expect(worse).toContain("blijf paper traden");
    const few = walkForwardVerdict({ ...v, profitableFolds: 4, oosReturnPct: 4, buyHoldReturnPct: 1, oosTrades: 19 });
    expect(few).toContain("slechts 19 trades");
    expect(few).not.toMatch(/Robuust/);
  });

  it("robust only when all conditions hold, and still with a warning", () => {
    const robust = walkForwardVerdict({ ...v, profitableFolds: 3, oosReturnPct: 5, buyHoldReturnPct: 2, oosTrades: 20 });
    expect(robust).toMatch(/^Robuust in deze test/);
    expect(robust).toContain("resultaten uit het verleden bieden geen garantie");
    expect(walkForwardVerdict({ ...v, profitableFolds: 2, oosReturnPct: 5, buyHoldReturnPct: 2 })).not.toMatch(/Robuust/);
    expect(walkForwardVerdict({ ...v, profitableFolds: 4, oosReturnPct: 5, buyHoldReturnPct: 5 })).not.toMatch(/Robuust/);
    expect(walkForwardVerdict({ ...v, oosTrades: 0, oosReturnPct: 0, buyHoldReturnPct: 3 })).toMatch(/geen enkele trade/);
    expect(walkForwardVerdict({ ...v, profitableFolds: 3, oosReturnPct: 5, buyHoldReturnPct: 2, simulatedData: true })).toContain(
      "gesimuleerde data",
    );
  });

  it("single backtest verdict is never unconditionally positive", () => {
    const m = { ...emptyMetrics(50), trades: 40, totalReturnPct: 12, buyHoldReturnPct: 3 };
    expect(backtestVerdict(m)).toContain("walk-forward");
    expect(backtestVerdict({ ...m, totalReturnPct: -2 })).toContain("Niet live gaan");
    expect(backtestVerdict({ ...m, totalReturnPct: 2, buyHoldReturnPct: 5 })).toContain("niet beter dan");
    expect(backtestVerdict({ ...m, trades: 0 })).toContain("Geen trades");
  });
});
