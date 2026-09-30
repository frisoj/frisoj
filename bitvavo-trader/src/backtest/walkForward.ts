/** Public walk-forward entry point (wires the real ensemble / risk / strategies). */
import { resolveOptimizerDeps, type OptimizerDeps } from "./optimizer";
import type { BacktestInput } from "./simulator";
import { walkForwardWith, type WalkForwardOptions, type WalkForwardOutput } from "./walkForwardCore";

export type { WalkForwardFoldWithGates, WalkForwardOptions, WalkForwardOutput } from "./walkForwardCore";
export { WF_WARMUP_CANDLES, foldWindows } from "./walkForwardCore";
export { walkForwardVerdict, backtestVerdict } from "./verdict";

export function walkForward(input: BacktestInput, opts: WalkForwardOptions, deps?: OptimizerDeps): WalkForwardOutput {
  return walkForwardWith(input, opts, resolveOptimizerDeps(deps));
}
