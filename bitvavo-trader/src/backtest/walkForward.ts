/** Public walk-forward entry point (wires the real ensemble / risk / strategies). */
import type { WalkForwardResult } from "../core/types";
import { resolveOptimizerDeps, type OptimizerDeps } from "./optimizer";
import type { BacktestInput } from "./simulator";
import { walkForwardWith, type WalkForwardOptions } from "./walkForwardCore";

export type { WalkForwardOptions } from "./walkForwardCore";
export { WF_WARMUP_CANDLES, foldWindows } from "./walkForwardCore";
export { walkForwardVerdict, backtestVerdict } from "./verdict";

export function walkForward(input: BacktestInput, opts: WalkForwardOptions, deps?: OptimizerDeps): WalkForwardResult {
  return walkForwardWith(input, opts, resolveOptimizerDeps(deps));
}
