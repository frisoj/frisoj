/**
 * Smoke test with the REAL ensemble (A3), risk manager (A4) and simulated feed (A6).
 * Skipped automatically when those modules are not present, so the unit tests
 * never depend on other modules' behaviour.
 */
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import type { Candle, OptimizationResult } from "../../src/core/types";
import { DEFAULT_ENGINE_CONFIG } from "../../src/core/defaults";
import type { BacktestInput } from "../../src/backtest/simulator";
import { decisionsFrom, stubRisk } from "./helpers";

const SRC = fileURLToPath(new URL("../../src/", import.meta.url));
const REQUIRED = ["strategies/ensemble.ts", "strategies/index.ts", "risk/riskManager.ts", "data/simulatedFeed.ts"];
const available = REQUIRED.every((p) => existsSync(SRC + p));

const FIXED_NOW = Date.UTC(2026, 0, 1, 0, 0, 0);
const WARMUP = 250;

async function simulatedCandles(days: number, market = "BTC-EUR"): Promise<{ candles: Candle[]; tradeFromIndex: number }> {
  const { SimulatedFeed } = await import("../../src/data/simulatedFeed");
  const feed = new SimulatedFeed({ seed: 42, now: () => FIXED_NOW });
  const step = 15 * 60_000;
  const periodStart = FIXED_NOW - days * 86_400_000;
  const candles = await feed.getHistory(market, "15m", periodStart - WARMUP * step, FIXED_NOW);
  const tradeFromIndex = candles.findIndex((c) => c.time >= periodStart);
  return { candles, tradeFromIndex };
}

function baseInput(candles: Candle[], tradeFromIndex: number): BacktestInput {
  return {
    market: "BTC-EUR",
    interval: "15m",
    candles,
    initialCapital: 50,
    ensemble: DEFAULT_ENGINE_CONFIG.ensemble,
    risk: DEFAULT_ENGINE_CONFIG.risk,
    dataSource: "simulated",
    tradeFromIndex,
  };
}

describe.skipIf(!available)("backtest integration (real ensemble + risk manager + simulated feed)", () => {
  it("runs end-to-end with no lookahead, fees on every trade and finite metrics", async () => {
    const { runBacktest } = await import("../../src/backtest/backtester");
    const { runEnsemble } = await import("../../src/strategies/ensemble");
    const { candles, tradeFromIndex } = await simulatedCandles(30);
    expect(candles.length).toBeGreaterThan(2500);
    expect(tradeFromIndex).toBeGreaterThanOrEqual(WARMUP - 1);

    const input = baseInput(candles, tradeFromIndex);
    const res = runBacktest(input);
    const decisions = runEnsemble("BTC-EUR", candles, input.ensemble);
    const idxByTime = new Map(candles.map((c, i) => [c.time, i]));

    expect(res.equityCurve).toHaveLength(candles.length - tradeFromIndex);
    for (const v of Object.values(res.metrics)) expect(Number.isFinite(v)).toBe(true);
    for (const p of res.equityCurve) {
      expect(Number.isFinite(p.equity)).toBe(true);
      expect(p.drawdownPct).toBeLessThanOrEqual(0);
    }
    for (const t of res.trades) {
      const i = idxByTime.get(t.entryTime)!;
      expect(i).toBeGreaterThanOrEqual(tradeFromIndex);
      expect(decisions[i - 1].action).toBe("buy"); // decided on the previous close …
      expect(t.entryPrice).toBeCloseTo(candles[i].open * (1 + input.risk.slippagePct), 9); // … filled at this open
      expect(t.feesQuote).toBeGreaterThan(0);
      expect(t.exitTime).toBeGreaterThanOrEqual(t.entryTime);
      expect(t.costQuote).toBeGreaterThanOrEqual(5 - 1e-9);
    }
    const fees = res.trades.reduce((s, t) => s + t.feesQuote, 0);
    expect(res.metrics.feesPaid).toBeCloseTo(fees, 9);
    const pnl = res.trades.reduce((s, t) => s + t.pnlQuote, 0);
    expect(res.metrics.finalEquity).toBeCloseTo(50 + pnl, 9);
    // Refused sells (below the €5 exchange minimum) are counted in the result.
    expect(res.stuckTrades).toBe(res.trades.filter((t) => t.entryReason.includes("geweigerd")).length);
    expect(res.candles.length).toBeLessThanOrEqual(1500);
  });

  it("public runBacktest honours injected deps", async () => {
    const { runBacktest } = await import("../../src/backtest/backtester");
    const { candles } = await simulatedCandles(3);
    const actions = candles.map((_, i) => (i === 300 ? "B" : ".")).join("");
    const res = runBacktest(baseInput(candles, 0), {
      decide: () => decisionsFrom(candles, actions, 50, "BTC-EUR"),
      createRisk: () => stubRisk({ quote: 20, stopDist: 1000, tpDist: 1000 }),
    });
    expect(res.trades.length).toBeGreaterThanOrEqual(1);
    expect(res.trades[0].entryTime).toBe(candles[301].time);
  });

  it("optimizer: 120 combos on ~6000 candles in a few seconds (cached ensemble)", async () => {
    const { optimize } = await import("../../src/backtest/optimizer");
    const { candles, tradeFromIndex } = await simulatedCandles(60);
    expect(candles.length).toBeGreaterThan(5700);
    const t0 = Date.now();
    const res = optimize(baseInput(candles, tradeFromIndex), { objective: "sharpe" });
    const ms = Date.now() - t0;
    expect(res.combosTested).toBe(120);
    expect(res.rows.length).toBeGreaterThan(0);
    expect(res.heatmap).not.toBeNull();
    expect(ms).toBeLessThan(15_000);
    // What the API sends (JSON): the heatmap carries best / tested / scored / positive per cell.
    const hm = (JSON.parse(JSON.stringify(res)) as OptimizationResult).heatmap!;
    const ny = hm.yValues.length;
    const nx = hm.xValues.length;
    for (const key of ["values", "best", "tested", "scored", "positive"] as const) {
      const grid = hm[key]!;
      expect(grid, key).toHaveLength(ny);
      for (const row of grid) expect(row, key).toHaveLength(nx);
    }
    expect(hm.tested!.flat().reduce((a, b) => a + b, 0)).toBe(120);
    for (let y = 0; y < ny; y++) {
      for (let x = 0; x < nx; x++) {
        expect(hm.scored![y][x]).toBeLessThanOrEqual(hm.tested![y][x]);
        expect(hm.positive![y][x]).toBeLessThanOrEqual(hm.scored![y][x]);
        expect(hm.best![y][x] === null).toBe(hm.scored![y][x] === 0);
      }
    }
    console.log(`[integration] optimize 120 combos on ${candles.length} candles: ${ms} ms, best score ${res.best?.score ?? "n.v.t."}`);
  });

  it("walk-forward produces non-overlapping folds and an honest verdict", async () => {
    const { walkForward } = await import("../../src/backtest/walkForward");
    const { candles, tradeFromIndex } = await simulatedCandles(45);
    const wf = walkForward(baseInput(candles, tradeFromIndex), { folds: 3, trainRatio: 0.7, objective: "sharpe", maxCombos: 40 });
    expect(wf.folds).toHaveLength(3);
    for (let k = 0; k < wf.folds.length; k++) {
      expect(wf.folds[k].trainTo).toBeLessThan(wf.folds[k].testFrom);
      if (k > 0) expect(wf.folds[k].trainFrom).toBeGreaterThan(wf.folds[k - 1].testTo);
    }
    expect(wf.verdict).toMatch(/Out-of-sample|Robuust/);
    expect(wf.verdict).toContain("gesimuleerde data");
    console.log(`[integration] walk-forward: OOS ${wf.oosMetrics.totalReturnPct.toFixed(2)}% vs B&H ${wf.oosMetrics.buyHoldReturnPct.toFixed(2)}% → ${wf.verdict}`);
  });
});
