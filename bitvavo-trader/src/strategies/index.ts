export { STRATEGIES, getStrategy, isStrategyId, listStrategies, resolveParams } from "./registry";
export { emaTrend } from "./emaTrend";
export { rsiReversion } from "./rsiReversion";
export { breakout } from "./breakout";
export { macdMomentum } from "./macdMomentum";
export { vwapReversion } from "./vwapReversion";
export { detectRegimes, REGIME_THRESHOLDS } from "./regime";
export {
  OFF_REGIME_WEIGHT,
  classify,
  decisionsToMarkers,
  latestDecision,
  runEnsemble,
  summarizeVotes,
} from "./ensemble";
export type { EnsembleDecisionWithExit } from "./ensemble";
