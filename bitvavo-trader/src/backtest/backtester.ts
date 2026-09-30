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
  type SimulationOutput,
} from "./simulator";

export type {
  BacktestDeps,
  BacktestInput,
  BlockedEntries,
  EntryGates,
  ResolvedBacktestDeps,
  SimulationOutput,
} from "./simulator";
export {
  DEFAULT_EXCHANGE_MIN_QUOTE,
  MAX_CHART_CANDLES,
  TREND_NOT_APPLIED_NOTE,
  aggregateCandles,
  appendNote,
  effectiveSlippagePct,
  entryGates,
  exchangeMinOrderQuote,
  exitMarkerLabel,
  fmtPctNl,
  spreadBlockedNote,
  spreadFromTicker,
  withSpreadCosts,
} from "./simulator";

export function resolveBacktestDeps(deps?: BacktestDeps): ResolvedBacktestDeps {
  return {
    decide: deps?.decide ?? runEnsemble,
    createRisk: deps?.createRisk ?? ((cfg, interval) => new RiskManager(cfg, interval)),
  };
}

export function runBacktest(input: BacktestInput, deps?: BacktestDeps): BacktestResult {
  return runBacktestWith(input, resolveBacktestDeps(deps)).result;
}

/**
 * runBacktest plus simulation details that are not part of BacktestResult:
 * the slippage actually used (incl. half the spread), the exchange minimum
 * order, and how many trades were stuck because a sell below that minimum was
 * refused (sold later vs. still unsellable at the end) and for how many candles.
 */
export function runBacktestDetailed(input: BacktestInput, deps?: BacktestDeps): SimulationOutput {
  return runBacktestWith(input, resolveBacktestDeps(deps));
}
