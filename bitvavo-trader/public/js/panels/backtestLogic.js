// Pure hulpfuncties van het Backtest-lab (geen DOM), zodat ze los te testen zijn
// (tests/frontend/backtestLogic.test.ts). Gebruikt door panels/backtest.js.

/** Zelfde waarden als src/backtest/optimizerCore.ts (PENALTY_SCORE / MIN_TRADES_FOR_SCORE). */
export const PENALTY_SCORE = -1e9;
export const MIN_TRADES_FOR_SCORE = 5;

const isNum = (v) => typeof v === "number" && Number.isFinite(v);

export const INTERVAL_MS = {
  "1m": 6e4, "5m": 3e5, "15m": 9e5, "30m": 18e5, "1h": 36e5, "2h": 72e5,
  "4h": 144e5, "6h": 216e5, "8h": 288e5, "12h": 432e5, "1d": 864e5,
};
const DAY_MS = 86_400_000;

/** Zelfde als MIN_PERIOD_CANDLES in src/server/routes.ts: minimaal aantal candles in de testperiode. */
export const MIN_PERIOD_CANDLES = 30;

/** Aantal candles in `days` dagen van `interval` (NaN bij onbekend interval). */
export function periodCandles(days, interval) {
  const ms = INTERVAL_MS[interval];
  return ms ? (Number(days) * DAY_MS) / ms : NaN;
}

/** Kleinste aantal (hele) dagen dat minstens MIN_PERIOD_CANDLES candles van `interval` geeft. */
export function minPeriodDays(interval) {
  const ms = INTERVAL_MS[interval];
  return ms ? Math.max(1, Math.ceil((MIN_PERIOD_CANDLES * ms) / DAY_MS - 1e-9)) : 1;
}

/** Nederlandse melding als de periode te kort is voor een backtest, anders null. */
export function periodError(days, interval) {
  const n = periodCandles(days, interval);
  if (!Number.isFinite(n) || n + 1e-9 >= MIN_PERIOD_CANDLES) return null;
  return (
    `Periode te kort: ${days} ${Number(days) === 1 ? "dag" : "dagen"} van ${interval} is maar ${Math.floor(n + 1e-9)} candles ` +
    `(minimaal ${MIN_PERIOD_CANDLES}). Kies minstens ${minPeriodDays(interval)} dagen of een korter interval.`
  );
}

/** Lengte van de ECHTE testperiode van een backtestresultaat in dagen (from/to = openingstijd eerste/laatste candle). */
export function resultDays(res) {
  if (!res || !isNum(res.from) || !isNum(res.to) || res.to < res.from) return NaN;
  return (res.to - res.from + (INTERVAL_MS[res.interval] || 0)) / DAY_MS;
}

// ── Heatmap (optimizer) ──

const idxOf = (list, v) => (Array.isArray(list) && isNum(v) ? list.findIndex((x) => Math.abs(x - v) <= 1e-9 * Math.max(1, Math.abs(v))) : -1);

/**
 * Eén heatmapcel. `values` zijn de MEDIAAN-scores over de overige parameters.
 * status: "ok" (score), "untested" (niets getest in deze cel), "few" (wel
 * getest, maar geen combinatie met genoeg trades) of "none" (oudere server
 * zonder `tested`: null = niet getest óf te weinig trades).
 */
export function heatmapCell(hm, xi, yi) {
  const v = hm?.values?.[yi]?.[xi];
  const value = isNum(v) ? v : null;
  const arr = (k) => (Array.isArray(hm?.[k]) ? hm[k][yi]?.[xi] : undefined);
  const count = (k) => {
    const c = arr(k);
    return isNum(c) ? c : Array.isArray(hm?.[k]) ? 0 : null;
  };
  const b = arr("best");
  const tested = count("tested");
  const scored = count("scored");
  const positive = count("positive");
  let status = "ok";
  if (value === null) status = tested === null ? "none" : tested > 0 ? "few" : "untested";
  return { value, best: isNum(b) ? b : null, tested, scored, positive, status };
}

/** Cel van de beste combinatie (res.best) in de heatmap, of null (niet max(values): die is een mediaan). */
export function bestHeatmapCell(hm, bestRow) {
  if (!hm || !bestRow || !isScoredRow(bestRow) || !bestRow.params) return null;
  const xi = idxOf(hm.xValues, bestRow.params[hm.xParam]);
  const yi = idxOf(hm.yValues, bestRow.params[hm.yParam]);
  return xi >= 0 && yi >= 0 ? { xi, yi } : null;
}

/**
 * Tooltiptekst (zonder HTML) van een heatmapcel, bijv.
 * "mediaan 0,42 · beste 1,10 · 3 van 4 winstgevend (6 getest)".
 * `fmtScore(v)` formatteert een score.
 */
export function heatmapCellTip(cell, fmtScore) {
  if (!cell) return "";
  if (cell.status === "untested") return "niet getest";
  if (cell.status === "few") return `te weinig trades (${cell.tested} getest, geen enkele met minstens ${MIN_TRADES_FOR_SCORE} trades)`;
  if (cell.status === "none") return "niet getest of te weinig trades";
  let s = `mediaan ${fmtScore(cell.value)}`;
  if (cell.best !== null) s += ` · beste ${fmtScore(cell.best)}`;
  if (cell.positive !== null && cell.scored !== null) {
    s += ` · ${cell.positive} van ${cell.scored} winstgevend`;
    if (cell.tested !== null) s += ` (${cell.tested} getest)`;
  }
  return s;
}

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
