/**
 * Invoervalidatie voor de API. Alle foutmeldingen zijn Nederlands; bij fouten
 * wordt een HttpError(400) gegooid met alle problemen in één bericht.
 */
import {
  INTERVALS,
  STRATEGY_IDS,
  type EngineConfig,
  type EnsembleConfig,
  type Interval,
  type OptimizeObjective,
  type RiskConfig,
  type StrategyId,
  type StrategyMeta,
  type StrategyParams,
  type TrendFilterConfig,
  type UniverseConfig,
} from "../core/types";
import { DEFAULT_RISK_CONFIG, MAX_MARKETS } from "../core/defaults";
import {
  TREND_PERIOD_MAX,
  TREND_PERIOD_MIN,
  UNIVERSE_MIN_VOLUME_MAX,
  isTrendFilterInterval,
  trendFilterOrOff,
  universeOrManual,
} from "../config";
import { HttpError } from "./router";

export type RiskValidator = (partial: Partial<RiskConfig>) => { ok: boolean; errors: string[] };

export const OBJECTIVES: readonly OptimizeObjective[] = ["sharpe", "return", "profitFactor", "calmar"];

/** Maximaal aantal dagen historie per interval (houdt backtests snel en binnen rate limits). */
export const MAX_DAYS_BY_INTERVAL: Record<Interval, number> = {
  "1m": 7,
  "5m": 30,
  "15m": 120,
  "30m": 180,
  "1h": 365,
  "2h": 365,
  "4h": 365,
  "6h": 365,
  "8h": 365,
  "12h": 365,
  "1d": 365,
};

export function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

/**
 * Korte, veilige weergave van een onbekende invoerwaarde in een foutmelding.
 * Niet-recursief: String() op een diep geneste lijst kan de stack laten overlopen.
 */
export function inputLabel(v: unknown): string {
  if (typeof v === "string") return v.length > 40 ? `${v.slice(0, 40)}…` : v;
  if (typeof v === "number" || typeof v === "boolean") return String(v);
  if (v === null) return "null";
  if (Array.isArray(v)) return "[lijst]";
  return typeof v;
}

export function fail(errors: string | string[]): never {
  const list = Array.isArray(errors) ? errors : [errors];
  throw new HttpError(400, list.join(" "));
}

/** Getal uit JSON of querystring (numerieke strings toegestaan). */
export function toNumber(v: unknown): number | undefined {
  if (typeof v === "number") return Number.isFinite(v) ? v : undefined;
  if (typeof v === "string" && v.trim() !== "") {
    const n = Number(v.trim().replace(",", "."));
    return Number.isFinite(n) ? n : undefined;
  }
  return undefined;
}

function numberInRange(
  errors: string[],
  label: string,
  v: unknown,
  min: number,
  max: number,
  integer = false,
): number | undefined {
  const n = toNumber(v);
  if (n === undefined) {
    errors.push(`${label} moet een getal zijn.`);
    return undefined;
  }
  if (integer && !Number.isInteger(n)) {
    errors.push(`${label} moet een geheel getal zijn.`);
    return undefined;
  }
  if (n < min || n > max) {
    errors.push(`${label} moet tussen ${min} en ${max} liggen (nu: ${n}).`);
    return undefined;
  }
  return n;
}

export function isInterval(v: unknown): v is Interval {
  return typeof v === "string" && (INTERVALS as readonly string[]).includes(v);
}

export function isStrategyId(v: unknown): v is StrategyId {
  return typeof v === "string" && (STRATEGY_IDS as readonly string[]).includes(v);
}

export function parseInterval(v: unknown, label = "interval"): Interval {
  if (!isInterval(v)) fail(`Ongeldig ${label}: kies uit ${INTERVALS.join(", ")}.`);
  return v;
}

export function normalizeMarket(v: unknown): string | undefined {
  if (typeof v !== "string") return undefined;
  const m = v.trim().toUpperCase();
  return /^[A-Z0-9]{1,20}-[A-Z0-9]{1,20}$/.test(m) ? m : undefined;
}

/** Valideert een markt tegen de lijst bekende markten. */
export function parseMarket(v: unknown, known: ReadonlySet<string>): string {
  const m = normalizeMarket(v);
  if (!m) fail("Geef een geldige markt op, bijv. BTC-EUR.");
  if (!known.has(m)) fail(`Onbekende markt: ${m}.`);
  return m;
}

// ─────────────────────────────── trendfilter ───────────────────────────────

/**
 * Legt een gedeeltelijk trendfilter (`market`, `coin`, `interval`, `period`)
 * over `current` heen (ontbreekt `current`: filter uit). Fouten gaan naar `errors`.
 */
export function mergeTrendFilter(
  patch: unknown,
  current: TrendFilterConfig | undefined,
  errors: string[],
): TrendFilterConfig {
  const out = trendFilterOrOff(current);
  if (!isPlainObject(patch)) {
    errors.push("ensemble.trendFilter moet een object zijn (market, coin, interval, period).");
    return out;
  }
  const known = new Set(["market", "coin", "interval", "period"]);
  for (const k of Object.keys(patch)) if (!known.has(k)) errors.push(`Onbekende trendfilter-instelling: ${inputLabel(k)}.`);
  if (patch.market !== undefined) {
    if (typeof patch.market !== "boolean") errors.push("Marktfilter (trendFilter.market) moet true of false zijn.");
    else out.market = patch.market;
  }
  if (patch.coin !== undefined) {
    if (typeof patch.coin !== "boolean") errors.push("Muntfilter (trendFilter.coin) moet true of false zijn.");
    else out.coin = patch.coin;
  }
  if (patch.interval !== undefined) {
    if (!isTrendFilterInterval(patch.interval)) {
      errors.push('Tijdschaal van het trendfilter (trendFilter.interval) moet "4h" (4 uur) of "1d" (dag) zijn.');
    } else out.interval = patch.interval;
  }
  if (patch.period !== undefined) {
    const n = numberInRange(
      errors,
      "Periode van het trendfilter (trendFilter.period)",
      patch.period,
      TREND_PERIOD_MIN,
      TREND_PERIOD_MAX,
      true,
    );
    if (n !== undefined) out.period = n;
  }
  return out;
}

// ─────────────────────────────── muntkeuze ───────────────────────────────

/**
 * Legt een gedeeltelijke muntkeuze (`mode`, `count`, `minVolumeEur`) over
 * `current` heen (ontbreekt `current`: "manual"). Fouten gaan naar `errors`.
 */
export function mergeUniverse(patch: unknown, current: UniverseConfig | undefined, errors: string[]): UniverseConfig {
  const out = universeOrManual(current);
  if (!isPlainObject(patch)) {
    errors.push("universe moet een object zijn (mode, count, minVolumeEur).");
    return out;
  }
  const known = new Set(["mode", "count", "minVolumeEur"]);
  for (const k of Object.keys(patch)) if (!known.has(k)) errors.push(`Onbekende muntkeuze-instelling: ${inputLabel(k)}.`);
  if (patch.mode !== undefined) {
    if (patch.mode !== "manual" && patch.mode !== "auto") {
      errors.push('Muntkeuze (universe.mode) moet "manual" (zelf kiezen) of "auto" (automatisch) zijn.');
    } else out.mode = patch.mode;
  }
  if (patch.count !== undefined) {
    const n = numberInRange(errors, "Aantal munten (universe.count)", patch.count, 1, MAX_MARKETS, true);
    if (n !== undefined) out.count = n;
  }
  if (patch.minVolumeEur !== undefined) {
    const n = numberInRange(
      errors,
      "Minimale handel per dag in euro (universe.minVolumeEur)",
      patch.minVolumeEur,
      0,
      UNIVERSE_MIN_VOLUME_MAX,
    );
    if (n !== undefined) out.minVolumeEur = n;
  }
  return out;
}

// ─────────────────────────────── ensemble ───────────────────────────────

/** Legt een gedeeltelijke ensemble-config over `current` en valideert het resultaat. */
export function mergeEnsemble(
  patch: unknown,
  current: EnsembleConfig,
  strategies?: StrategyMeta[],
): EnsembleConfig {
  if (patch === undefined || patch === null) return structuredClone(current);
  if (!isPlainObject(patch)) fail("ensemble moet een object zijn.");
  const errors: string[] = [];
  const out: EnsembleConfig = structuredClone(current);
  const known = new Set(["enabled", "weights", "params", "buyThreshold", "sellThreshold", "regimeFilter", "trendFilter"]);
  for (const k of Object.keys(patch)) if (!known.has(k)) errors.push(`Onbekende ensemble-instelling: ${k}.`);

  if (patch.enabled !== undefined) {
    if (!Array.isArray(patch.enabled) || patch.enabled.length === 0) {
      errors.push("Kies minstens één strategie (ensemble.enabled).");
    } else {
      const bad = patch.enabled.filter((s) => !isStrategyId(s));
      if (bad.length > 0) errors.push(`Onbekende strategie(ën): ${bad.map(inputLabel).join(", ")}.`);
      else out.enabled = [...new Set(patch.enabled as StrategyId[])];
    }
  }
  if (patch.weights !== undefined) {
    if (!isPlainObject(patch.weights)) errors.push("ensemble.weights moet een object zijn.");
    else {
      for (const [k, v] of Object.entries(patch.weights)) {
        if (!isStrategyId(k)) {
          errors.push(`Onbekende strategie in gewichten: ${k}.`);
          continue;
        }
        const n = numberInRange(errors, `Gewicht van ${k}`, v, 0, 5);
        if (n !== undefined) out.weights[k] = n;
      }
    }
  }
  if (patch.params !== undefined) {
    if (!isPlainObject(patch.params)) errors.push("ensemble.params moet een object zijn.");
    else {
      for (const [id, params] of Object.entries(patch.params)) {
        if (!isStrategyId(id)) {
          errors.push(`Onbekende strategie in parameters: ${id}.`);
          continue;
        }
        if (params === null) {
          delete out.params[id];
          continue;
        }
        if (!isPlainObject(params)) {
          errors.push(`Parameters van ${id} moeten een object zijn.`);
          continue;
        }
        const meta = strategies?.find((s) => s.id === id);
        const clean: StrategyParams = {};
        for (const [p, v] of Object.entries(params)) {
          if (meta && !(p in meta.defaultParams)) {
            errors.push(`Onbekende parameter ${id}.${p}.`);
            continue;
          }
          const n = toNumber(v);
          if (n === undefined) errors.push(`Parameter ${id}.${p} moet een getal zijn.`);
          else clean[p] = n;
        }
        out.params[id] = { ...(out.params[id] ?? {}), ...clean };
      }
    }
  }
  if (patch.buyThreshold !== undefined) {
    const n = numberInRange(errors, "Koopdrempel (buyThreshold)", patch.buyThreshold, 0.05, 1);
    if (n !== undefined) out.buyThreshold = n;
  }
  if (patch.sellThreshold !== undefined) {
    const n = numberInRange(errors, "Verkoopdrempel (sellThreshold)", patch.sellThreshold, -1, -0.05);
    if (n !== undefined) out.sellThreshold = n;
  }
  if (patch.regimeFilter !== undefined) {
    if (typeof patch.regimeFilter !== "boolean") errors.push("regimeFilter moet true of false zijn.");
    else out.regimeFilter = patch.regimeFilter;
  }
  if (patch.trendFilter !== undefined) out.trendFilter = mergeTrendFilter(patch.trendFilter, current.trendFilter, errors);
  if (out.enabled.length === 0) errors.push("Kies minstens één strategie.");
  if (errors.length > 0) fail(errors);
  return out;
}

// ─────────────────────────────── risk ───────────────────────────────

/** Legt een gedeeltelijke risk-config over `current` en valideert met validateRiskConfig. */
export function mergeRisk(patch: unknown, current: RiskConfig, validateRisk: RiskValidator): RiskConfig {
  if (patch === undefined || patch === null) return { ...current };
  if (!isPlainObject(patch)) fail("risk moet een object zijn.");
  const errors: string[] = [];
  const out: RiskConfig = { ...current };
  const keys = new Set(Object.keys(DEFAULT_RISK_CONFIG));
  for (const [k, v] of Object.entries(patch)) {
    if (!keys.has(k)) {
      errors.push(`Onbekende risico-instelling: ${k}.`);
      continue;
    }
    const n = toNumber(v);
    if (n === undefined) errors.push(`Risico-instelling ${k} moet een getal zijn.`);
    else out[k as keyof RiskConfig] = n;
  }
  if (errors.length > 0) fail(errors);
  const res = validateRisk(out);
  if (!res.ok) fail(res.errors.length > 0 ? res.errors : ["Ongeldige risico-instellingen."]);
  return out;
}

// ─────────────────────────────── engine config ───────────────────────────────

/**
 * Valideert een `Partial<EngineConfig>` voor PUT /api/config. Het resultaat
 * bevat ensemble (incl. trendFilter), risk en universe volledig samengevoegd
 * met de huidige config.
 */
export function validateConfigPatch(
  body: unknown,
  current: EngineConfig,
  deps: { knownEurMarkets: ReadonlySet<string>; validateRisk: RiskValidator; strategies?: StrategyMeta[] },
): Partial<EngineConfig> {
  if (!isPlainObject(body)) fail("Stuur de instellingen als JSON-object.");
  const errors: string[] = [];
  const out: Partial<EngineConfig> = {};
  const known = new Set(["markets", "interval", "pollMs", "historyCandles", "ensemble", "risk", "universe"]);
  for (const k of Object.keys(body)) if (!known.has(k)) errors.push(`Onbekende instelling: ${k}.`);

  if (body.markets !== undefined) {
    if (!Array.isArray(body.markets)) errors.push("markets moet een lijst zijn.");
    else {
      const list = [...new Set(body.markets.map(normalizeMarket))];
      if (list.some((m) => m === undefined)) errors.push("markets bevat een ongeldige markt.");
      else {
        const markets = list as string[];
        const unknown = markets.filter((m) => !m.endsWith("-EUR") || !deps.knownEurMarkets.has(m));
        if (unknown.length > 0) errors.push(`Onbekende of niet-verhandelbare EUR-markt(en): ${unknown.join(", ")}.`);
        else if (markets.length < 1 || markets.length > MAX_MARKETS) errors.push(`Kies 1 tot ${MAX_MARKETS} markten.`);
        else out.markets = markets;
      }
    }
  }
  if (body.interval !== undefined) {
    if (!isInterval(body.interval)) errors.push(`Ongeldig interval: kies uit ${INTERVALS.join(", ")}.`);
    else out.interval = body.interval;
  }
  if (body.pollMs !== undefined) {
    const n = numberInRange(errors, "pollMs", body.pollMs, 5000, 300_000, true);
    if (n !== undefined) out.pollMs = n;
  }
  if (body.historyCandles !== undefined) {
    const n = numberInRange(errors, "historyCandles", body.historyCandles, 100, 1000, true);
    if (n !== undefined) out.historyCandles = n;
  }
  if (body.universe !== undefined) out.universe = mergeUniverse(body.universe, current.universe, errors);
  if (errors.length > 0) fail(errors);
  if (body.ensemble !== undefined) out.ensemble = mergeEnsemble(body.ensemble, current.ensemble, deps.strategies);
  if (body.risk !== undefined) out.risk = mergeRisk(body.risk, current.risk, deps.validateRisk);
  return out;
}

// ─────────────────────────────── backtest / optimize / walk-forward ───────────────────────────────

export interface ParsedBacktestRequest {
  market: string;
  interval: Interval;
  /** Na begrenzing per interval */
  days: number;
  initialCapital: number;
  ensemble: EnsembleConfig;
  risk: RiskConfig;
}

export interface ParsedOptimizeRequest extends ParsedBacktestRequest {
  strategy?: StrategyId;
  objective: OptimizeObjective;
  maxCombos: number;
}

export interface ParsedWalkForwardRequest extends ParsedOptimizeRequest {
  folds: number;
  trainRatio: number;
}

export function parseBacktestRequest(
  body: unknown,
  deps: {
    knownMarkets: ReadonlySet<string>;
    current: EngineConfig;
    defaultCapital: number;
    validateRisk: RiskValidator;
    strategies?: StrategyMeta[];
  },
): ParsedBacktestRequest {
  if (!isPlainObject(body)) fail("Stuur de backtest-instellingen als JSON-object.");
  const market = parseMarket(body.market, deps.knownMarkets);
  const interval = parseInterval(body.interval);
  const errors: string[] = [];
  const maxDays = MAX_DAYS_BY_INTERVAL[interval];
  let days = maxDays;
  if (body.days !== undefined) {
    const n = toNumber(body.days);
    if (n === undefined || n < 1) errors.push("days moet een getal van minimaal 1 zijn.");
    else days = Math.min(n, maxDays);
  } else {
    days = Math.min(30, maxDays);
  }
  let initialCapital = deps.defaultCapital;
  if (body.initialCapital !== undefined && body.initialCapital !== null) {
    const n = numberInRange(errors, "Startkapitaal (initialCapital)", body.initialCapital, 5, 10_000_000);
    if (n !== undefined) initialCapital = n;
  }
  if (errors.length > 0) fail(errors);
  const ensemble = mergeEnsemble(body.ensemble, deps.current.ensemble, deps.strategies);
  const risk = mergeRisk(body.risk, deps.current.risk, deps.validateRisk);
  return { market, interval, days, initialCapital, ensemble, risk };
}

export function parseOptimizeRequest(
  body: unknown,
  deps: Parameters<typeof parseBacktestRequest>[1],
): ParsedOptimizeRequest {
  const base = parseBacktestRequest(body, deps);
  const b = body as Record<string, unknown>;
  const errors: string[] = [];
  let strategy: StrategyId | undefined;
  if (b.strategy !== undefined && b.strategy !== null && b.strategy !== "") {
    if (!isStrategyId(b.strategy)) errors.push(`Onbekende strategie: ${inputLabel(b.strategy)}.`);
    else strategy = b.strategy;
  }
  let objective: OptimizeObjective = "sharpe";
  if (b.objective !== undefined) {
    if (typeof b.objective !== "string" || !(OBJECTIVES as readonly string[]).includes(b.objective)) {
      errors.push(`Ongeldig doel (objective): kies uit ${OBJECTIVES.join(", ")}.`);
    } else objective = b.objective as OptimizeObjective;
  }
  let maxCombos = 60;
  if (b.maxCombos !== undefined && b.maxCombos !== null) {
    const n = numberInRange(errors, "maxCombos", b.maxCombos, 1, 200, true);
    if (n !== undefined) maxCombos = n;
  }
  if (errors.length > 0) fail(errors);
  return { ...base, strategy, objective, maxCombos };
}

export function parseWalkForwardRequest(
  body: unknown,
  deps: Parameters<typeof parseBacktestRequest>[1],
): ParsedWalkForwardRequest {
  const base = parseOptimizeRequest(body, deps);
  const b = body as Record<string, unknown>;
  const errors: string[] = [];
  let folds = 4;
  if (b.folds !== undefined && b.folds !== null) {
    const n = numberInRange(errors, "Aantal folds", b.folds, 2, 8, true);
    if (n !== undefined) folds = n;
  }
  let trainRatio = 0.7;
  if (b.trainRatio !== undefined && b.trainRatio !== null) {
    const n = numberInRange(errors, "trainRatio", b.trainRatio, 0.5, 0.9);
    if (n !== undefined) trainRatio = n;
  }
  if (errors.length > 0) fail(errors);
  return { ...base, folds, trainRatio };
}

export function parseLimit(v: string | null, def: number, min: number, max: number, label = "limit"): number {
  if (v === null || v.trim() === "") return def;
  const n = toNumber(v);
  if (n === undefined || !Number.isInteger(n)) fail(`${label} moet een geheel getal zijn.`);
  if (n < min || n > max) fail(`${label} moet tussen ${min} en ${max} liggen (nu: ${n}).`);
  return n;
}
