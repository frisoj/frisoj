/**
 * Opwarmtijd van het ensemble voor backtests: zoveel candles moeten vóór de
 * eerste handelscandle liggen, anders "handelt" de backtest terwijl de
 * strategieën en de regimedetectie nog niets kunnen zeggen (alles "hold" /
 * regime "unknown"), en krijgt buy & hold een oneerlijke voorsprong.
 */
import type { EnsembleConfig, StrategyId, StrategyParams } from "../core/types";
import { getStrategy, isStrategyId, resolveParams } from "../strategies";

/** Regimedetectie: EMA 50 + helling over 10 candles (ADX 14 / ATR-gemiddelde zijn eerder klaar). */
export const REGIME_WARMUP_CANDLES = 64;
/** Extra marge zodat EMA's/ADX na de eerste geldige waarde iets kunnen convergeren. */
export const WARMUP_MARGIN_CANDLES = 10;

function strategyWarmup(id: StrategyId, params: StrategyParams | undefined): number {
  try {
    const n = getStrategy(id).warmup(resolveParams(id, params));
    return typeof n === "number" && Number.isFinite(n) ? n : 0;
  } catch {
    return 0;
  }
}

/** Grootste waarde per parameter uit de zoekruimte (de optimizer kan die combinatie kiezen). */
function maxOfParamSpace(id: StrategyId): StrategyParams {
  const out: StrategyParams = {};
  for (const [k, values] of Object.entries(getStrategy(id).paramSpace)) {
    const finite = values.filter((v) => Number.isFinite(v));
    if (finite.length > 0) out[k] = Math.max(...finite);
  }
  return out;
}

/**
 * Minimaal aantal candles vóór de eerste handelscandle: de grootste warmup van
 * de ingeschakelde strategieën en de regimedetectie, plus een marge. Met
 * `optimizeStrategy` telt ook de grootste combinatie uit de zoekruimte van die
 * strategie mee (de optimizer probeert bijv. een trend-EMA van 200).
 */
export function backtestWarmupCandles(ens: EnsembleConfig, optimizeStrategy?: StrategyId): number {
  let w = REGIME_WARMUP_CANDLES;
  const enabled = Array.isArray(ens.enabled) ? ens.enabled : [];
  for (const id of enabled) {
    if (isStrategyId(id)) w = Math.max(w, strategyWarmup(id, ens.params?.[id]));
  }
  if (optimizeStrategy && isStrategyId(optimizeStrategy)) {
    w = Math.max(w, strategyWarmup(optimizeStrategy, ens.params?.[optimizeStrategy]));
    try {
      w = Math.max(w, strategyWarmup(optimizeStrategy, maxOfParamSpace(optimizeStrategy)));
    } catch {
      // zoekruimte onbekend: dan geldt de warmup van de huidige parameters
    }
  }
  return Math.ceil(w) + WARMUP_MARGIN_CANDLES;
}
