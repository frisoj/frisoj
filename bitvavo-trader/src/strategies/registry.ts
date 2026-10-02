import type { StrategyDefinition, StrategyId, StrategyMeta, StrategyParams } from "../core/types";
import { breakout } from "./breakout";
import { emaTrend } from "./emaTrend";
import { macdMomentum } from "./macdMomentum";
import { rsiReversion } from "./rsiReversion";
import { vwapReversion } from "./vwapReversion";

export const STRATEGIES: Record<StrategyId, StrategyDefinition> = {
  "ema-trend": emaTrend,
  "rsi-reversion": rsiReversion,
  breakout,
  "macd-momentum": macdMomentum,
  "vwap-reversion": vwapReversion,
};

export function isStrategyId(id: unknown): id is StrategyId {
  return typeof id === "string" && Object.prototype.hasOwnProperty.call(STRATEGIES, id);
}

/** Metadata van alle strategieën, zonder functies (JSON-veilig, kopieën). */
export function listStrategies(): StrategyMeta[] {
  return Object.values(STRATEGIES).map((s) => ({
    id: s.id,
    name: s.name,
    description: s.description,
    defaultParams: { ...s.defaultParams },
    paramSpace: Object.fromEntries(Object.entries(s.paramSpace).map(([k, v]) => [k, [...v]])),
    preferredRegimes: [...s.preferredRegimes],
  }));
}

export function getStrategy(id: StrategyId): StrategyDefinition {
  if (!isStrategyId(id)) throw new Error(`Onbekende strategie: ${String(id)}`);
  return STRATEGIES[id];
}

/**
 * Standaardparameters samengevoegd met overrides. Alleen bekende keys met een
 * eindige numerieke waarde worden overgenomen.
 */
export function resolveParams(id: StrategyId, overrides?: StrategyParams): StrategyParams {
  const def = getStrategy(id);
  const out: StrategyParams = { ...def.defaultParams };
  if (overrides) {
    for (const key of Object.keys(out)) {
      const v = overrides[key];
      if (typeof v === "number" && Number.isFinite(v)) out[key] = v;
    }
  }
  return out;
}
