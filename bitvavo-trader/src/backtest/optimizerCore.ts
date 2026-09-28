/**
 * Grid-search optimizer with fully injected dependencies (no imports from the
 * strategy / risk modules). `optimizer.ts` wires in the real defaults.
 */
import type {
  BacktestMetrics,
  EnsembleConfig,
  EnsembleDecision,
  Heatmap,
  OptimizationResult,
  OptimizationRow,
  OptimizeObjective,
  Regime,
  SignalAction,
  StrategyId,
} from "../core/types";
import { STRATEGY_IDS } from "../core/types";
import { hashString, mulberry32 } from "../core/util";
import { simulate, type BacktestDeps, type BacktestInput, type ResolvedBacktestDeps } from "./simulator";

export interface OptimizeOptions {
  strategy?: StrategyId;
  objective: OptimizeObjective;
  maxCombos?: number;
}

export type ClassifyFn = (score: number, regime: Regime, cfg: EnsembleConfig) => SignalAction;
export type ParamSpaceFn = (strategy: StrategyId) => Record<string, number[]>;

/** BacktestDeps plus optional hooks for the optimizer (mainly for tests). */
export interface OptimizerDeps extends BacktestDeps {
  /**
   * Score → action mapping used to re-threshold cached decisions. Defaults to
   * the ensemble's `classify` only when `decide` is the default `runEnsemble`
   * (re-classifying a custom `decide` with the real classify would be wrong).
   */
  classify?: ClassifyFn;
  /** Parameter space of a strategy (default: STRATEGIES[id].paramSpace). */
  paramSpace?: ParamSpaceFn;
}

export interface ResolvedOptimizerDeps extends ResolvedBacktestDeps {
  classify: ClassifyFn | null;
  paramSpace: ParamSpaceFn;
}

export const DEFAULT_MAX_COMBOS = 120;
/** Combos with fewer trades than this can never win (lucky 1-trade results). */
export const MIN_TRADES_FOR_SCORE = 5;
export const PENALTY_SCORE = -1e9;
export const MAX_ROWS = 50;

export const DEFAULT_PARAM_GRID: Readonly<Record<string, readonly number[]>> = {
  "ensemble.buyThreshold": [0.25, 0.35, 0.45, 0.55],
  "ensemble.sellThreshold": [-0.2, -0.3, -0.45],
  "risk.stopAtrMult": [1.5, 2, 2.5, 3],
  "risk.takeProfitR": [1.5, 2, 3],
};

function isStrategyId(s: string): s is StrategyId {
  return (STRATEGY_IDS as readonly string[]).includes(s);
}

/** The parameter grid: a strategy's paramSpace ("<id>.<param>") or the default ensemble/risk grid. */
export function buildParamGrid(strategy: StrategyId | undefined, paramSpace: ParamSpaceFn): Record<string, number[]> {
  const grid: Record<string, number[]> = {};
  if (strategy) {
    const space = paramSpace(strategy) ?? {};
    for (const [param, values] of Object.entries(space)) {
      const vals = [...new Set(values.filter((v) => Number.isFinite(v)))];
      if (vals.length > 0) grid[`${strategy}.${param}`] = vals;
    }
  } else {
    for (const [k, v] of Object.entries(DEFAULT_PARAM_GRID)) grid[k] = [...v];
  }
  return grid;
}

/** Make sure `strategy` is part of the ensemble (with a positive weight). */
export function forceEnableStrategy(ensemble: EnsembleConfig, strategy: StrategyId): EnsembleConfig {
  const enabled = ensemble.enabled.includes(strategy) ? [...ensemble.enabled] : [...ensemble.enabled, strategy];
  const weights = { ...ensemble.weights };
  if (!((weights[strategy] ?? 0) > 0)) weights[strategy] = 1;
  return { ...ensemble, enabled, weights };
}

/**
 * Apply optimizer params ("ensemble.x", "risk.x", "<strategyId>.x") to a copy of
 * the input. Strategies whose params are set are force-enabled.
 */
export function applyParams(input: BacktestInput, params: Record<string, number>): BacktestInput {
  let ensemble: EnsembleConfig = { ...input.ensemble, params: { ...input.ensemble.params } };
  const risk = { ...input.risk };
  for (const [key, value] of Object.entries(params)) {
    const dot = key.indexOf(".");
    if (dot <= 0) continue;
    const scope = key.slice(0, dot);
    const name = key.slice(dot + 1);
    if (scope === "ensemble") {
      if (typeof (ensemble as unknown as Record<string, unknown>)[name] === "number") {
        ensemble = { ...ensemble, [name]: value };
      }
    } else if (scope === "risk") {
      if (typeof (risk as unknown as Record<string, unknown>)[name] === "number") {
        (risk as unknown as Record<string, number>)[name] = value;
      }
    } else if (isStrategyId(scope)) {
      ensemble.params[scope] = { ...(ensemble.params[scope] ?? {}), [name]: value };
      ensemble = forceEnableStrategy(ensemble, scope);
    }
  }
  return { ...input, ensemble, risk };
}

/** Current values of the grid keys in the input config (keys without a known value are skipped). */
export function currentParamValues(input: BacktestInput, keys: string[]): Record<string, number> {
  const out: Record<string, number> = {};
  for (const key of keys) {
    const dot = key.indexOf(".");
    const scope = key.slice(0, dot);
    const name = key.slice(dot + 1);
    let v: unknown;
    if (scope === "ensemble") v = (input.ensemble as unknown as Record<string, unknown>)[name];
    else if (scope === "risk") v = (input.risk as unknown as Record<string, unknown>)[name];
    else if (isStrategyId(scope)) v = input.ensemble.params[scope]?.[name];
    if (typeof v === "number" && Number.isFinite(v)) out[key] = v;
  }
  return out;
}

export function objectiveValue(m: BacktestMetrics, objective: OptimizeObjective): number {
  switch (objective) {
    case "sharpe":
      return m.sharpe;
    case "return":
      return m.totalReturnPct;
    case "profitFactor":
      return m.profitFactor;
    case "calmar":
      return m.calmar;
    default:
      return m.sharpe;
  }
}

/** Objective score; fewer than MIN_TRADES_FOR_SCORE trades → PENALTY_SCORE. */
export function objectiveScore(m: BacktestMetrics, objective: OptimizeObjective): number {
  if (m.trades < MIN_TRADES_FOR_SCORE) return PENALTY_SCORE;
  const v = objectiveValue(m, objective);
  return Number.isFinite(v) ? v : PENALTY_SCORE;
}

/** Deterministic sample of `count` distinct indices from [0, total), ascending. */
export function sampleComboIndices(total: number, count: number, seed: number): number[] {
  if (count >= total) return Array.from({ length: total }, (_, i) => i);
  const rng = mulberry32(seed);
  let picked: number[];
  if (total <= 2_000_000) {
    const idx = new Uint32Array(total);
    for (let i = 0; i < total; i++) idx[i] = i;
    for (let i = 0; i < count; i++) {
      const j = i + Math.floor(rng() * (total - i));
      const t = idx[i];
      idx[i] = idx[j];
      idx[j] = t;
    }
    picked = Array.from(idx.subarray(0, count));
  } else {
    const set = new Set<number>();
    while (set.size < count) set.add(Math.floor(rng() * total));
    picked = [...set];
  }
  return picked.sort((a, b) => a - b);
}

function decodeCombo(index: number, keys: string[], grid: Record<string, number[]>): Record<string, number> {
  const params: Record<string, number> = {};
  let rest = index;
  for (let k = keys.length - 1; k >= 0; k--) {
    const values = grid[keys[k]];
    params[keys[k]] = values[rest % values.length];
    rest = Math.floor(rest / values.length);
  }
  // Keep key order stable (grid order) for display.
  const ordered: Record<string, number> = {};
  for (const key of keys) ordered[key] = params[key];
  return ordered;
}

/** Heatmap over the two params with the most distinct values; cell = best (non-penalised) score. */
export function buildHeatmap(
  grid: Record<string, number[]>,
  tested: { params: Record<string, number>; score: number }[],
): Heatmap | null {
  const keys = Object.keys(grid);
  if (keys.length < 2) return null;
  const byCount = keys
    .map((k, order) => ({ k, order, count: grid[k].length }))
    .sort((a, b) => b.count - a.count || a.order - b.order);
  const xParam = byCount[0].k;
  const yParam = byCount[1].k;
  const xValues = [...grid[xParam]].sort((a, b) => a - b);
  const yValues = [...grid[yParam]].sort((a, b) => a - b);
  const values: (number | null)[][] = yValues.map(() => xValues.map(() => null));
  for (const t of tested) {
    if (!(t.score > PENALTY_SCORE)) continue; // too few trades → leave the cell empty
    const xi = xValues.indexOf(t.params[xParam]);
    const yi = yValues.indexOf(t.params[yParam]);
    if (xi < 0 || yi < 0) continue;
    const cur = values[yi][xi];
    if (cur === null || t.score > cur) values[yi][xi] = t.score;
  }
  return { xParam, yParam, xValues, yValues, values };
}

/** Grid-search optimisation with resolved dependencies. */
export function optimizeWith(input: BacktestInput, opts: OptimizeOptions, deps: ResolvedOptimizerDeps): OptimizationResult {
  const startedAt = Date.now();
  const base: BacktestInput = opts.strategy
    ? { ...input, ensemble: forceEnableStrategy(input.ensemble, opts.strategy) }
    : input;
  const grid = buildParamGrid(opts.strategy, deps.paramSpace);
  const keys = Object.keys(grid);
  const total = keys.reduce((acc, k) => acc * grid[k].length, 1);
  const maxCombos = Math.max(1, Math.floor(opts.maxCombos ?? DEFAULT_MAX_COMBOS));
  const seed = hashString(`${keys.join("|")}#${total}#${maxCombos}`);
  const indices = sampleComboIndices(total, maxCombos, seed);

  // ── Decision cache ──
  // Scores only depend on the non-threshold part of the ensemble config. When a
  // classify() is available, compute decisions once per score-key and
  // re-threshold them; otherwise call decide() once per distinct config.
  const { market, candles } = base;
  const fullCache = new Map<string, EnsembleDecision[]>();
  const scoreCache = new Map<string, { decisions: EnsembleDecision[]; overridden: Uint8Array }>();
  const classify = deps.classify;
  const getDecisions = (ens: EnsembleConfig): EnsembleDecision[] => {
    const fullKey = JSON.stringify(ens);
    const hit = fullCache.get(fullKey);
    if (hit) return hit;
    let decisions: EnsembleDecision[];
    if (classify) {
      const scoreKey = JSON.stringify({ ...ens, buyThreshold: null, sellThreshold: null });
      let entry = scoreCache.get(scoreKey);
      if (!entry) {
        const computed = deps.decide(market, candles, ens);
        // Decisions whose action is not what classify() says (e.g. forced "hold"
        // during warmup) keep their action when re-thresholding.
        const overridden = new Uint8Array(computed.length);
        for (let i = 0; i < computed.length; i++) {
          const d = computed[i];
          if (classify(d.score, d.regime, ens) !== d.action) overridden[i] = 1;
        }
        entry = { decisions: computed, overridden };
        scoreCache.set(scoreKey, entry);
        decisions = computed;
      } else {
        const src = entry.decisions;
        decisions = new Array(src.length);
        for (let i = 0; i < src.length; i++) {
          const d = src[i];
          if (entry.overridden[i]) {
            decisions[i] = d;
            continue;
          }
          const action = classify(d.score, d.regime, ens);
          decisions[i] = action === d.action ? d : { ...d, action };
        }
      }
    } else {
      decisions = deps.decide(market, candles, ens);
    }
    fullCache.set(fullKey, decisions);
    return decisions;
  };

  const tested: (OptimizationRow & { order: number })[] = [];
  indices.forEach((comboIndex, order) => {
    const params = decodeCombo(comboIndex, keys, grid);
    const comboInput = applyParams(base, params);
    const decisions = getDecisions(comboInput.ensemble);
    const risk = deps.createRisk(comboInput.risk, comboInput.interval);
    const { result } = simulate(comboInput, decisions, risk, { lite: true });
    tested.push({ params, metrics: result.metrics, score: objectiveScore(result.metrics, opts.objective), order });
  });

  tested.sort((a, b) => b.score - a.score || a.order - b.order);
  const rows: OptimizationRow[] = tested.slice(0, MAX_ROWS).map(({ params, metrics, score }) => ({ params, metrics, score }));
  const best = rows.length > 0 && rows[0].score > PENALTY_SCORE ? rows[0] : null;

  return {
    objective: opts.objective,
    rows,
    best,
    combosTested: tested.length,
    heatmap: buildHeatmap(grid, tested),
    durationMs: Date.now() - startedAt,
  };
}
