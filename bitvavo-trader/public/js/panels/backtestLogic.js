// Pure hulpfuncties van het Backtest-lab (geen DOM), zodat ze los te testen zijn
// (tests/frontend/backtestLogic.test.ts). Gebruikt door panels/backtest.js.

/** Zelfde waarden als src/backtest/optimizerCore.ts (PENALTY_SCORE / MIN_TRADES_FOR_SCORE). */
export const PENALTY_SCORE = -1e9;
export const MIN_TRADES_FOR_SCORE = 5;

const isNum = (v) => typeof v === "number" && Number.isFinite(v);

/**
 * Kwaliteit van een KPI-kaart: "good" | "warn" | "bad" | "neutral".
 * `maxDrawdownPct` is volgens het contract ≤ 0 (metrics.ts); we vergelijken de
 * grootte (|dd|), zodat beide tekenconventies goed gaan.
 */
export function quality(kind, m, initial) {
  switch (kind) {
    case "ret":
      return m.totalReturnPct <= 0 ? "bad" : m.totalReturnPct >= m.buyHoldReturnPct ? "good" : "warn";
    case "dd": {
      if (!isNum(m?.maxDrawdownPct)) return "neutral";
      const dd = Math.abs(m.maxDrawdownPct);
      return dd <= 10 ? "good" : dd <= 20 ? "warn" : "bad";
    }
    case "sharpe":
      return m.sharpe >= 1 ? "good" : m.sharpe >= 0.3 ? "warn" : "bad";
    case "win":
      return m.winRatePct >= 50 ? "good" : m.winRatePct >= 35 ? "warn" : "bad";
    case "pf":
      return m.profitFactor >= 1.5 ? "good" : m.profitFactor >= 1 ? "warn" : "bad";
    case "trades":
      return m.trades >= 30 ? "good" : m.trades >= 10 ? "warn" : "bad";
    case "fees":
      return initial > 0 && m.feesPaid / initial > 0.05 ? "warn" : "neutral";
    case "final":
      return m.finalEquity > initial ? "good" : m.finalEquity < initial ? "bad" : "neutral";
    default:
      return "neutral";
  }
}

/** Telt een optimizer-rij mee? Rijen met te weinig trades krijgen PENALTY_SCORE van de server. */
export function isScoredRow(r) {
  return !!r && isNum(r.score) && r.score > PENALTY_SCORE;
}

/** De beste combinatie, of null als de server er geen vond (nooit een afgestrafte rij). */
export function bestScoredRow(res) {
  return res && isScoredRow(res.best) ? res.best : null;
}

/** Schaal van de scorebalkjes: alleen over rijen die echt meetellen. */
export function scoreBarMax(rows) {
  return Math.max(...(rows || []).filter(isScoredRow).map((r) => Math.abs(Math.min(r.score, 999))), 1e-9);
}

/** Zet optimizer-parameters ("ensemble.x", "risk.x", "<strategie>.x") om naar een Partial<EngineConfig>. */
export function paramsToPartial(params, cfg, strategyIds) {
  const ids = strategyIds instanceof Set ? strategyIds : new Set(strategyIds || []);
  const partial = {};
  for (const [key, value] of Object.entries(params || {})) {
    const i = key.indexOf(".");
    if (i < 0) continue;
    const head = key.slice(0, i);
    const rest = key.slice(i + 1);
    if (head === "ensemble") {
      partial.ensemble ??= {};
      if (rest.startsWith("weights.")) {
        partial.ensemble.weights ??= { ...(cfg?.ensemble?.weights || {}) };
        partial.ensemble.weights[rest.slice(8)] = value;
      } else partial.ensemble[rest] = value;
    } else if (head === "risk") {
      partial.risk ??= {};
      partial.risk[rest] = value;
    } else if (ids.has(head)) {
      partial.ensemble ??= {};
      partial.ensemble.params ??= JSON.parse(JSON.stringify(cfg?.ensemble?.params || {}));
      partial.ensemble.params[head] = { ...(partial.ensemble.params[head] || {}), [rest]: value };
    }
  }
  return partial;
}

/**
 * De configuratie die de optimizer ECHT heeft getest, als PUT-body voor de bot:
 * de ensemble-/risico-velden uit het lab-formulier (`req`), plus de strategie die
 * de optimizer geforceerd aanzet (optimizerCore.forceEnableStrategy / applyParams:
 * aan, met gewicht ≥ 1), plus de parameters van de rij. Rij-waarden gaan voor.
 */
export function testedPartial(row, req, cfg, strategyIds) {
  const ids = strategyIds instanceof Set ? strategyIds : new Set(strategyIds || []);
  const p = paramsToPartial(row?.params, cfg, ids);
  p.ensemble ??= {};
  p.risk ??= {};
  const reqEns = req?.ensemble || {};
  const reqRisk = req?.risk || {};

  const forced = [];
  if (req?.strategy) forced.push(req.strategy);
  for (const key of Object.keys(row?.params || {})) {
    const head = key.slice(0, Math.max(0, key.indexOf(".")));
    if (ids.has(head) && !forced.includes(head)) forced.push(head);
  }
  const baseEnabled = Array.isArray(reqEns.enabled) ? reqEns.enabled : cfg?.ensemble?.enabled || [];
  const enabled = [...new Set([...baseEnabled, ...forced])];
  if (enabled.length) p.ensemble.enabled = enabled;
  for (const id of forced) {
    const w = p.ensemble.weights?.[id] ?? cfg?.ensemble?.weights?.[id] ?? 0;
    if (!(w > 0)) p.ensemble.weights = { ...(p.ensemble.weights || {}), [id]: 1 };
  }
  for (const [k, v] of Object.entries(reqEns)) {
    if (k === "enabled" || k === "weights" || k === "params" || v === undefined || k in p.ensemble) continue;
    p.ensemble[k] = v;
  }
  for (const [k, v] of Object.entries(reqRisk)) {
    if (v === undefined || k in p.risk) continue;
    p.risk[k] = v;
  }
  if (!Object.keys(p.ensemble).length) delete p.ensemble;
  if (!Object.keys(p.risk).length) delete p.risk;
  return p;
}

function currentValue(key, cfg, strategies) {
  const i = key.indexOf(".");
  const head = key.slice(0, i);
  const rest = key.slice(i + 1);
  if (head === "ensemble") {
    if (rest.startsWith("weights.")) return cfg?.ensemble?.weights?.[rest.slice(8)];
    return cfg?.ensemble?.[rest];
  }
  if (head === "risk") return cfg?.risk?.[rest];
  const p = cfg?.ensemble?.params?.[head]?.[rest];
  if (p !== undefined) return p;
  return (strategies || []).find((s) => s.id === head)?.defaultParams?.[rest];
}

function nextValue(key, partial, row) {
  const i = key.indexOf(".");
  const head = key.slice(0, i);
  const rest = key.slice(i + 1);
  const e = partial?.ensemble || {};
  if (head === "ensemble") {
    if (rest.startsWith("weights.")) return e.weights?.[rest.slice(8)];
    return e[rest];
  }
  if (head === "risk") return partial?.risk?.[rest];
  return e.params?.[head]?.[rest] ?? row?.params?.[key];
}

/**
 * Overzicht "Nu → Nieuw" voor de bevestiging: alle instellingen die de PUT
 * aanraakt (niet alleen de grid-parameters).
 * @returns {{ enabled: null | { cur: string[], next: string[], added: string[], removed: string[] },
 *             rows: { key: string, cur: any, next: any, same: boolean }[] }}
 */
export function describeApply(partial, row, cfg, strategies) {
  const e = partial?.ensemble || {};
  const keys = [];
  const add = (k) => {
    if (!keys.includes(k)) keys.push(k);
  };
  for (const k of Object.keys(row?.params || {})) add(k);
  for (const k of Object.keys(e)) {
    if (k === "enabled" || k === "params" || k === "weights") continue;
    add(`ensemble.${k}`);
  }
  for (const [id, w] of Object.entries(e.weights || {})) {
    const key = `ensemble.weights.${id}`;
    if (keys.includes(key) || w !== cfg?.ensemble?.weights?.[id]) add(key);
  }
  for (const k of Object.keys(partial?.risk || {})) add(`risk.${k}`);
  const rows = keys.map((key) => {
    const cur = currentValue(key, cfg, strategies);
    const next = nextValue(key, partial, row);
    return { key, cur, next, same: cur === next };
  });
  let enabled = null;
  if (Array.isArray(e.enabled)) {
    const before = cfg?.ensemble?.enabled || [];
    enabled = {
      cur: [...before],
      next: [...e.enabled],
      added: e.enabled.filter((id) => !before.includes(id)),
      removed: before.filter((id) => !e.enabled.includes(id)),
    };
  }
  return { enabled, rows };
}
