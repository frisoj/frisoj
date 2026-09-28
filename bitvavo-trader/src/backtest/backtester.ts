/**
 * Public backtest entry point. The simulation itself lives in `simulator.ts`
 * (dependency-free); this file only wires in the real ensemble + risk manager
 * as defaults, exactly like the live engine uses them.
 */
import type { BacktestResult } from "../core/types";
import { RiskManager } from "../risk/riskManager";
import { runEnsemble } from "../strategies/ensemble";
import {
  runBacktestWith,
  type BacktestDeps,
  type BacktestInput,
  type ResolvedBacktestDeps,
} from "./simulator";

export type { BacktestDeps, BacktestInput, ResolvedBacktestDeps } from "./simulator";
export { MAX_CHART_CANDLES, aggregateCandles, exitMarkerLabel, fmtPctNl } from "./simulator";

export function resolveBacktestDeps(deps?: BacktestDeps): ResolvedBacktestDeps {
  return {
    decide: deps?.decide ?? runEnsemble,
    createRisk: deps?.createRisk ?? ((cfg, interval) => new RiskManager(cfg, interval)),
  };
}

export function runBacktest(input: BacktestInput, deps?: BacktestDeps): BacktestResult {
  return runBacktestWith(input, resolveBacktestDeps(deps)).result;
}
