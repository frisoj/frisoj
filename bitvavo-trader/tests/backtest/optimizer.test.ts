import { describe, expect, it } from "vitest";
import {
  DEFAULT_PARAM_GRID,
  MIN_TRADES_FOR_SCORE,
  PENALTY_SCORE,
  applyParams,
  buildHeatmap,
  objectiveScore,
  optimizeWith,
  sampleComboIndices,
  type HeatmapDetail,
} from "../../src/backtest/optimizerCore";
import { emptyMetrics } from "../../src/backtest/metrics";
import type { Candle, EnsembleConfig, EnsembleDecision, Regime, RiskConfig, SignalAction } from "../../src/core/types";
import { decisionsFrom, input, momentumDecide, stubOptimizerDeps, stubRisk, walkCandles } from "./helpers";

const candles = walkCandles(2000, 7);

describe("optimizer", () => {
  it("is deterministic and samples 120 of the 144 default combos", () => {
    const deps = stubOptimizerDeps();
    const a = optimizeWith(input(candles), { objective: "sharpe" }, deps);
    const b = optimizeWith(input(candles), { objective: "sharpe" }, stubOptimizerDeps());
    expect(a.combosTested).toBe(120);
    expect(a.rows.map((r) => [r.params, r.score])).toEqual(b.rows.map((r) => [r.params, r.score]));
    expect(a.heatmap).toEqual(b.heatmap);
    const all = optimizeWith(input(candles), { objective: "sharpe", maxCombos: 500 }, stubOptimizerDeps());
    expect(all.combosTested).toBe(4 * 3 * 4 * 3);
  });

  it("returns rows sorted by score (desc), max 50, with the grid keys", () => {
    const res = optimizeWith(input(candles), { objective: "return" }, stubOptimizerDeps());
    expect(res.rows.length).toBeLessThanOrEqual(50);
    for (let i = 1; i < res.rows.length; i++) expect(res.rows[i - 1].score).toBeGreaterThanOrEqual(res.rows[i].score);
    expect(Object.keys(res.rows[0].params)).toEqual(Object.keys(DEFAULT_PARAM_GRID));
    expect(res.best).not.toBeNull();
    expect(res.best!.score).toBe(res.rows[0].score);
    expect(res.best!.score).toBeCloseTo(res.best!.metrics.totalReturnPct, 12);
    expect(res.best!.metrics.trades).toBeGreaterThanOrEqual(MIN_TRADES_FOR_SCORE);
  });

  it("penalises combos with fewer than 5 trades so lucky outliers never win", () => {
    const single = decisionsFrom(candles, candles.map((_, i) => (i === 500 ? "B" : ".")).join(""));
    const deps = stubOptimizerDeps({ decide: () => single });
    const res = optimizeWith(input(candles), { objective: "profitFactor" }, deps);
    expect(res.rows.every((r) => r.score === PENALTY_SCORE)).toBe(true);
    expect(res.best).toBeNull();
    expect(res.heatmap!.values.flat().every((v) => v === null)).toBe(true);
    const m = { ...emptyMetrics(100), trades: 4, profitFactor: 999 };
    expect(objectiveScore(m, "profitFactor")).toBe(PENALTY_SCORE);
    expect(objectiveScore({ ...m, trades: 5 }, "profitFactor")).toBe(999);
  });

  it("builds a heatmap over the two params with the most distinct values", () => {
    const res = optimizeWith(input(candles), { objective: "sharpe" }, stubOptimizerDeps());
    const hm = res.heatmap as HeatmapDetail;
    expect(hm.xParam).toBe("ensemble.buyThreshold");
    expect(hm.yParam).toBe("risk.stopAtrMult");
    expect(hm.xValues).toEqual([0.25, 0.35, 0.45, 0.55]);
    expect(hm.yValues).toEqual([1.5, 2, 2.5, 3]);
    expect(hm.values).toHaveLength(4);
    for (const row of hm.values) expect(row).toHaveLength(4);
    // `best` holds the best score over the other params; the colour value is the median (never above it).
    const best = res.best!;
    const xi = hm.xValues.indexOf(best.params[hm.xParam]);
    const yi = hm.yValues.indexOf(best.params[hm.yParam]);
    expect(hm.best[yi][xi]).toBe(best.score);
    expect(hm.values[yi][xi]).not.toBeNull();
    expect(hm.values[yi][xi]!).toBeLessThanOrEqual(best.score);
    // 120 sampled combos, every one of them lands in exactly one cell.
    expect(hm.tested.flat().reduce((a, b) => a + b, 0)).toBe(120);
    expect(buildHeatmap({ "risk.takeProfitR": [1, 2] }, [])).toBeNull();
  });

  it("heatmap cell = median of the scored combos, plus best / tested / scored / positive counts", () => {
    const grid = { "a.x": [1, 2], "a.y": [10, 20, 30], "a.z": [0] };
    const P = PENALTY_SCORE;
    const tested = [
      // cell (x=1, y=10): one lucky combo, the rest loses → median negative, best positive
      { params: { "a.x": 1, "a.y": 10, "a.z": 0 }, score: 5 },
      { params: { "a.x": 1, "a.y": 10, "a.z": 0 }, score: -1 },
      { params: { "a.x": 1, "a.y": 10, "a.z": 0 }, score: -2 },
      { params: { "a.x": 1, "a.y": 10, "a.z": 0 }, score: P }, // too few trades: tested, not scored
      // cell (x=2, y=20): even count → average of the middle two
      { params: { "a.x": 2, "a.y": 20, "a.z": 0 }, score: 1 },
      { params: { "a.x": 2, "a.y": 20, "a.z": 0 }, score: 3 },
      // cell (x=2, y=30): tested, but never enough trades
      { params: { "a.x": 2, "a.y": 30, "a.z": 0 }, score: P },
    ];
    const hm = buildHeatmap(grid, tested, "sharpe")!;
    expect(hm.xParam).toBe("a.y"); // 3 values
    expect(hm.yParam).toBe("a.x");
    // values[yi][xi] with y = a.x ∈ [1, 2], x = a.y ∈ [10, 20, 30]
    expect(hm.values).toEqual([
      [-1, null, null],
      [null, 2, null],
    ]);
    expect(hm.best).toEqual([
      [5, null, null],
      [null, 3, null],
    ]);
    expect(hm.tested).toEqual([
      [4, 0, 0],
      [0, 2, 1],
    ]);
    expect(hm.scored).toEqual([
      [3, 0, 0],
      [0, 2, 0],
    ]);
    expect(hm.positive).toEqual([
      [1, 0, 0],
      [0, 2, 0],
    ]);
    // Profit factor: neutral point is 1, not 0.
    const pf = buildHeatmap(grid, tested, "profitFactor")!;
    expect(pf.positive[1][1]).toBe(1); // only the 3 beats 1
  });

  it("re-thresholds with the decision's exitScore (identical to calling decide per config)", () => {
    // Stub decide with a separate exit score (like the real ensemble): score = mom / 4, exitScore = mom.
    const classify = (score: number, _r: Regime, cfg: EnsembleConfig, exitScore = score): SignalAction =>
      score > 0 && score >= cfg.buyThreshold ? "buy" : exitScore < 0 && exitScore <= cfg.sellThreshold ? "sell" : "hold";
    let calls = 0;
    const decide = (market: string, cs: Candle[], cfg: EnsembleConfig): EnsembleDecision[] => {
      calls++;
      return cs.map((c, i) => {
        const back = cs[Math.max(0, i - 5)];
        const mom = i >= 5 ? Math.max(-1, Math.min(1, (c.close / back.close - 1) * 100)) : 0;
        const score = mom / 4;
        return {
          market, time: c.time, price: c.close, action: classify(score, "range", cfg, mom), score, exitScore: mom,
          confidence: Math.abs(score), regime: "range" as const, atr: c.close * 0.004, votes: [],
        } as EnsembleDecision;
      });
    };
    const fast = optimizeWith(input(candles), { objective: "return" }, stubOptimizerDeps({ decide, classify }));
    expect(calls).toBe(1);
    const slow = optimizeWith(input(candles), { objective: "return" }, stubOptimizerDeps({ decide, classify: null }));
    expect(fast.rows.map((r) => [r.params, r.score])).toEqual(slow.rows.map((r) => [r.params, r.score]));
    // The exit score matters: with it, some sells happen that the plain score would never trigger.
    const sells = decide("X", candles, { ...input(candles).ensemble, buyThreshold: 0.35, sellThreshold: -0.45 }).filter(
      (d) => d.action === "sell" && d.score > -0.45,
    );
    expect(sells.length).toBeGreaterThan(0);
  });

  it("hands the spread-aware slippage to every combo's risk manager", () => {
    const seen: RiskConfig[] = [];
    const deps = stubOptimizerDeps({
      createRisk: (cfg) => {
        seen.push(cfg);
        return stubRisk({ quote: 40, cfg });
      },
    });
    optimizeWith({ ...input(candles), spreadPct: 0.003 }, { objective: "sharpe", maxCombos: 5 }, deps);
    expect(seen).toHaveLength(5);
    for (const cfg of seen) expect(cfg.slippagePct).toBeCloseTo(0.0015, 15);
  });

  it("re-thresholds cached scores when classify is available (decide runs once) with identical results", () => {
    const m = momentumDecide();
    const fast = stubOptimizerDeps({ decide: m.decide, classify: m.classify });
    const resFast = optimizeWith(input(candles), { objective: "sharpe" }, fast);
    expect(m.calls.count).toBe(1);

    const m2 = momentumDecide();
    const resSlow = optimizeWith(input(candles), { objective: "sharpe" }, stubOptimizerDeps({ decide: m2.decide, classify: null }));
    expect(m2.calls.count).toBe(4 * 3); // one per distinct threshold pair
    expect(resFast.rows.map((r) => [r.params, r.score])).toEqual(resSlow.rows.map((r) => [r.params, r.score]));
  });

  it("optimises a strategy's paramSpace with prefixed keys and force-enables it", () => {
    const seen: EnsembleConfig[] = [];
    const m = momentumDecide();
    const deps = stubOptimizerDeps({
      decide: (market, cs, cfg) => {
        seen.push(cfg);
        return m.decide(market, cs, cfg);
      },
      paramSpace: () => ({ fast: [5, 9], slow: [21, 30, 50] }),
    });
    const base = input(candles);
    base.ensemble = { ...base.ensemble, enabled: ["rsi-reversion"], params: {} };
    const res = optimizeWith(base, { strategy: "ema-trend", objective: "sharpe" }, deps);
    expect(res.combosTested).toBe(6);
    expect(Object.keys(res.rows[0].params)).toEqual(["ema-trend.fast", "ema-trend.slow"]);
    expect(seen).toHaveLength(6);
    for (const cfg of seen) {
      expect(cfg.enabled).toContain("ema-trend");
      expect(cfg.enabled).toContain("rsi-reversion");
      expect(cfg.weights["ema-trend"]).toBeGreaterThan(0);
    }
    expect(seen.map((c) => c.params["ema-trend"])).toContainEqual({ fast: 9, slow: 50 });
    expect(res.heatmap!.xParam).toBe("ema-trend.slow");
    expect(res.heatmap!.yParam).toBe("ema-trend.fast");
  });

  it("applyParams sets ensemble / risk / strategy values without mutating the input", () => {
    const base = input(candles);
    const before = JSON.stringify({ e: base.ensemble, r: base.risk });
    const out = applyParams(base, {
      "ensemble.buyThreshold": 0.55,
      "risk.stopAtrMult": 3,
      "breakout.lookback": 30,
      "bogus.x": 1,
    });
    expect(out.ensemble.buyThreshold).toBe(0.55);
    expect(out.risk.stopAtrMult).toBe(3);
    expect(out.ensemble.params.breakout).toEqual({ lookback: 30 });
    expect(JSON.stringify({ e: base.ensemble, r: base.risk })).toBe(before);
  });

  it("samples deterministically and without duplicates", () => {
    const a = sampleComboIndices(1000, 50, 42);
    expect(a).toEqual(sampleComboIndices(1000, 50, 42));
    expect(new Set(a).size).toBe(50);
    expect(a).toEqual([...a].sort((x, y) => x - y));
    expect(sampleComboIndices(10, 50, 1)).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8, 9]);
  });

  it("runs 120 combos on ~6000 candles within a few seconds", () => {
    const big = walkCandles(6000, 3);
    const m = momentumDecide();
    const t0 = Date.now();
    const res = optimizeWith(input(big), { objective: "sharpe" }, stubOptimizerDeps({ decide: m.decide, classify: m.classify }));
    const ms = Date.now() - t0;
    expect(res.combosTested).toBe(120);
    expect(ms).toBeLessThan(5000);
  });
});
