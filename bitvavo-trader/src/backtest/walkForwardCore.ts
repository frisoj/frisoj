/**
 * Walk-forward validation with injected dependencies. The candles (from
 * `tradeFromIndex` on) are split into `folds` consecutive windows; in each
 * window the optimizer only sees the first `trainRatio` part, the best params
 * are then traded on the rest (out-of-sample). Earlier candles are only used
 * as indicator warmup, never traded twice.
 */
import type {
  BacktestMetrics,
  Candle,
  EquityCurvePoint,
  Trade,
  WalkForwardFold,
  WalkForwardResult,
} from "../core/types";
import { computeMetrics } from "./metrics";
import {
  buildParamGrid,
  currentParamValues,
  forceEnableStrategy,
  optimizeWith,
  applyParams,
  type OptimizeOptions,
  type ResolvedOptimizerDeps,
} from "./optimizerCore";
import { runBacktestWith, type BacktestInput } from "./simulator";
import { walkForwardVerdict } from "./verdict";

export interface WalkForwardOptions extends OptimizeOptions {
  folds: number;
  trainRatio: number;
}

/** Candles before each train/test segment used purely as indicator warmup. */
export const WF_WARMUP_CANDLES = 250;
export const WF_MIN_TRAIN_CANDLES = 50;
export const WF_MIN_TEST_CANDLES = 20;
export const WF_MAX_FOLDS = 20;

export interface FoldWindow {
  index: number;
  /** First candle index of the window (= first training candle) */
  winStart: number;
  /** First test candle index (exclusive end of training) */
  trainEnd: number;
  /** Exclusive end of the window (and of the test part) */
  winEnd: number;
}

/** Consecutive, non-overlapping windows over [from, n). */
export function foldWindows(from: number, n: number, folds: number, trainRatio: number): FoldWindow[] {
  const f = Math.max(1, Math.min(WF_MAX_FOLDS, Math.floor(folds)));
  const ratio = Math.max(0.1, Math.min(0.9, trainRatio));
  const len = n - from;
  const size = Math.floor(len / f);
  const windows: FoldWindow[] = [];
  for (let k = 0; k < f; k++) {
    const winStart = from + k * size;
    const winEnd = k === f - 1 ? n : winStart + size;
    const trainEnd = winStart + Math.round((winEnd - winStart) * ratio);
    if (trainEnd - winStart < WF_MIN_TRAIN_CANDLES || winEnd - trainEnd < WF_MIN_TEST_CANDLES) {
      throw new Error(
        `Te weinig candles voor een walk-forward met ${f} folds: ${len} candles, per fold minimaal ` +
          `${WF_MIN_TRAIN_CANDLES} train- en ${WF_MIN_TEST_CANDLES} testcandles nodig. Kies meer dagen of minder folds.`,
      );
    }
    windows.push({ index: k, winStart, trainEnd, winEnd });
  }
  return windows;
}

export function walkForwardWith(
  input: BacktestInput,
  opts: WalkForwardOptions,
  deps: ResolvedOptimizerDeps,
): WalkForwardResult {
  const startedAt = Date.now();
  const base: BacktestInput = opts.strategy
    ? { ...input, ensemble: forceEnableStrategy(input.ensemble, opts.strategy) }
    : input;
  const { candles } = base;
  const n = candles.length;
  const from = Math.max(0, Math.min(n, Math.floor(base.tradeFromIndex ?? 0)));
  const windows = foldWindows(from, n, opts.folds, opts.trainRatio);
  const gridKeys = Object.keys(buildParamGrid(opts.strategy, deps.paramSpace));
  const optOpts: OptimizeOptions = { strategy: opts.strategy, objective: opts.objective, maxCombos: opts.maxCombos };

  const folds: WalkForwardFold[] = [];
  const oosCurve: EquityCurvePoint[] = [];
  const oosTrades: Trade[] = [];
  const oosCandles: Candle[] = [];
  let exposureCandles = 0;
  let equity = input.initialCapital;
  let benchmark = input.initialCapital;
  let profitableFolds = 0;

  for (const w of windows) {
    // ── Train: optimise only on [winStart, trainEnd) (+ warmup before it) ──
    const trainSliceStart = Math.max(0, w.winStart - WF_WARMUP_CANDLES);
    const trainInput: BacktestInput = {
      ...base,
      candles: candles.slice(trainSliceStart, w.trainEnd),
      tradeFromIndex: w.winStart - trainSliceStart,
      initialCapital: equity,
    };
    const opt = optimizeWith(trainInput, optOpts, deps);
    let bestParams: Record<string, number>;
    let trainMetrics: BacktestMetrics;
    if (opt.best) {
      bestParams = opt.best.params;
      trainMetrics = opt.best.metrics;
    } else {
      // No combo had enough trades: keep the current settings (never pick a lucky outlier).
      bestParams = currentParamValues(base, gridKeys);
      trainMetrics = runBacktestWith(applyParams(trainInput, bestParams), deps, { lite: true }).result.metrics;
    }

    // ── Test: trade [trainEnd, winEnd) with the chosen params, compounding ──
    const testSliceStart = Math.max(0, w.trainEnd - WF_WARMUP_CANDLES);
    const testInput = applyParams(
      {
        ...base,
        candles: candles.slice(testSliceStart, w.winEnd),
        tradeFromIndex: w.trainEnd - testSliceStart,
        initialCapital: equity,
      },
      bestParams,
    );
    const out = runBacktestWith(testInput, deps, { lite: true });
    const res = out.result;

    const foldStartEquity = equity;
    for (const p of res.equityCurve) {
      oosCurve.push({
        time: p.time,
        equity: p.equity,
        benchmark: foldStartEquity > 0 ? benchmark * (p.benchmark / foldStartEquity) : benchmark,
        drawdownPct: 0,
      });
    }
    if (res.equityCurve.length > 0) benchmark = oosCurve[oosCurve.length - 1].benchmark;
    equity = res.metrics.finalEquity;
    oosTrades.push(...res.trades);
    exposureCandles += out.exposureCandles;
    for (let i = w.trainEnd; i < w.winEnd; i++) oosCandles.push(candles[i]);
    if (res.metrics.totalReturnPct > 0) profitableFolds++;

    folds.push({
      index: w.index,
      trainFrom: candles[w.winStart].time,
      trainTo: candles[w.trainEnd - 1].time,
      testFrom: candles[w.trainEnd].time,
      testTo: candles[w.winEnd - 1].time,
      bestParams,
      trainMetrics,
      testMetrics: res.metrics,
    });
  }

  // Drawdown over the stitched out-of-sample curve.
  let peak = input.initialCapital;
  for (const p of oosCurve) {
    if (p.equity > peak) peak = p.equity;
    p.drawdownPct = peak > 0 ? Math.min(0, (p.equity / peak - 1) * 100) : 0;
  }

  const oosMetrics = computeMetrics({
    trades: oosTrades,
    equityCurve: oosCurve,
    initialCapital: input.initialCapital,
    interval: input.interval,
    candles: oosCandles,
    takerFee: input.risk.takerFee,
    exposureCandles,
  });
  // The test periods are not contiguous: buy & hold = the compounded per-fold benchmark.
  oosMetrics.buyHoldReturnPct = input.initialCapital > 0 ? (benchmark / input.initialCapital - 1) * 100 : 0;

  const verdict = walkForwardVerdict({
    oosReturnPct: oosMetrics.totalReturnPct,
    buyHoldReturnPct: oosMetrics.buyHoldReturnPct,
    profitableFolds,
    folds: folds.length,
    oosTrades: oosTrades.length,
    simulatedData: (input.dataSource ?? "simulated") === "simulated",
  });

  return { folds, oosMetrics, oosEquityCurve: oosCurve, verdict, durationMs: Date.now() - startedAt };
}
