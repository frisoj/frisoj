/**
 * Public optimizer entry point: wires the real ensemble `classify` and the
 * strategies' parameter spaces into the dependency-free `optimizerCore.ts`.
 */
import type { OptimizationResult } from "../core/types";
import { getStrategy } from "../strategies";
import { classify as ensembleClassify } from "../strategies/ensemble";
import { resolveBacktestDeps } from "./backtester";
import { optimizeWith, type OptimizeOptions, type OptimizerDeps, type ResolvedOptimizerDeps } from "./optimizerCore";
import type { BacktestInput } from "./simulator";

export type { OptimizeOptions, OptimizerDeps, ResolvedOptimizerDeps } from "./optimizerCore";
export {
  DEFAULT_MAX_COMBOS,
  DEFAULT_PARAM_GRID,
  MIN_TRADES_FOR_SCORE,
  PENALTY_SCORE,
  applyParams,
  buildParamGrid,
  objectiveScore,
} from "./optimizerCore";

export function resolveOptimizerDeps(deps?: OptimizerDeps): ResolvedOptimizerDeps {
  return {
    ...resolveBacktestDeps(deps),
    // Re-thresholding cached decisions is only valid for the real runEnsemble
    // (classify is its single source of truth) or with an explicit classify.
    classify: deps?.classify ?? (deps?.decide ? null : ensembleClassify),
    paramSpace: deps?.paramSpace ?? ((id) => getStrategy(id).paramSpace),
  };
}

export function optimize(input: BacktestInput, opts: OptimizeOptions, deps?: OptimizerDeps): OptimizationResult {
  return optimizeWith(input, opts, resolveOptimizerDeps(deps));
}
