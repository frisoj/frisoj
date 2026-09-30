// Gedeelde API-client voor het dashboard. Alle panelen gebruiken deze module;
// praat nooit rechtstreeks met fetch vanuit een paneel.
//
// Meerdere bots (v3): staat de pagina onder /bot/<id>/, dan gaat elk verzoek voor
// "deze bot" (en de SSE-stream) naar /bot/<id>/api/…; de wedstrijdroutes
// (/api/bots…) gaan altijd naar de root.

const TOKEN_KEY = "bvt-dashboard-token";

function getToken() {
  try {
    return localStorage.getItem(TOKEN_KEY) || "";
  } catch {
    return "";
  }
}

export function setToken(token) {
  try {
    if (token) localStorage.setItem(TOKEN_KEY, token);
    else localStorage.removeItem(TOKEN_KEY);
  } catch {
    /* localStorage niet beschikbaar */
  }
}

/**
 * BASE voor een URL-pad: `/bot/<id>` als het pad met /bot/<id> begint, anders "".
 * Alleen veilige ids (letters, cijfers, - en _), zoals de profielen in src/bots/profiles.ts.
 */
export function basePath(pathname) {
  const m = /^\/bot\/([A-Za-z0-9_-]+)(?:\/|$)/.exec(String(pathname || ""));
  return m ? `/bot/${m[1]}` : "";
}

/** Bot-id uit de BASE ("" = de root, dus de standaardbot) */
export function baseBotId(pathname) {
  const b = basePath(pathname);
  return b ? b.slice("/bot/".length) : "";
}

/** BASE van deze pagina (verandert niet zonder herladen; een #hash telt niet mee) */
export function apiBase() {
  try {
    return basePath(globalThis.location ? globalThis.location.pathname : "");
  } catch {
    return "";
  }
}

/** BASE bij het laden van de pagina: `/bot/<id>` of "" */
export const BASE = apiBase();

export class ApiError extends Error {
  constructor(message, status) {
    super(message);
    this.status = status;
  }
}

/** Opties voor routes die niet bij één bot horen (altijd de root) */
const ROOT = { root: true };

async function request(method, path, body, opts) {
  const headers = { Accept: "application/json" };
  const token = getToken();
  if (token) headers["x-dashboard-token"] = token;
  if (body !== undefined) headers["Content-Type"] = "application/json";
  const url = opts && opts.root ? path : apiBase() + path;
  const res = await fetch(url, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  let data = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = { error: text };
  }
  if (!res.ok) {
    const msg = (data && (data.error || data.message)) || `HTTP ${res.status}`;
    throw new ApiError(msg, res.status);
  }
  return data;
}

const qs = (params) =>
  Object.entries(params)
    .filter(([, v]) => v !== undefined && v !== null && v !== "")
    .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`)
    .join("&");

export const api = {
  /** AppInfo */
  info: () => request("GET", "/api/info"),
  /** EngineSnapshot */
  getState: () => request("GET", "/api/state"),
  /** EngineConfig */
  getConfig: () => request("GET", "/api/config"),
  /** Partial<EngineConfig> → EngineConfig */
  putConfig: (partial) => request("PUT", "/api/config", partial),
  start: () => request("POST", "/api/engine/start"),
  stop: () => request("POST", "/api/engine/stop"),
  /** Noodstop: sluit alle posities en stopt de bot */
  kill: () => request("POST", "/api/engine/kill"),
  closePosition: (id) => request("POST", `/api/positions/${encodeURIComponent(id)}/close`),
  /** Onverkoopbare positie afschrijven (bot beheert hem niet meer, inleg = verlies) → Trade */
  writeOffPosition: (id) => request("POST", `/api/positions/${encodeURIComponent(id)}/writeoff`),
  /** Live mode: bevestigingstekst moet exact "IK BEGRIJP HET RISICO" zijn */
  arm: (confirm) => request("POST", "/api/live/arm", { confirm }),
  disarm: () => request("POST", "/api/live/disarm"),
  /** Live: gebruiker heeft Bitvavo gecontroleerd na kooporder(s) met onbekende uitkomst → EngineSnapshot */
  ackUnknownOrders: () => request("POST", "/api/live/unknown-orders/ack"),
  /** Onbruikbare opgeslagen staat bevestigd (deblokkeert live armen) → EngineSnapshot */
  ackStateRecovery: () => request("POST", "/api/state/recovery/ack"),
  /** Paper mode: reset account naar startkapitaal */
  resetPaper: () => request("POST", "/api/paper/reset"),
  /** MarketInfo[] (alleen EUR-markten die traden) */
  getMarkets: () => request("GET", "/api/markets"),
  /** CandlesResponse */
  getCandles: (market, interval, limit = 300) =>
    request("GET", `/api/candles?${qs({ market, interval, limit })}`),
  /** Laatste beslissing van de engine voor één markt → { decision: EnsembleDecision | null } (null = nog niet beoordeeld) */
  getDecision: (market) => request("GET", `/api/decision?${qs({ market })}`),
  /** ScannerRow[] */
  getScanner: (limit = 30) => request("GET", `/api/scanner?${qs({ limit })}`),
  /** StrategyMeta[] */
  getStrategies: () => request("GET", "/api/strategies"),
  /** BacktestRequest → BacktestResult */
  backtest: (req) => request("POST", "/api/backtest", req),
  /** OptimizeRequest → OptimizationResult */
  optimize: (req) => request("POST", "/api/optimize", req),
  /** WalkForwardRequest → WalkForwardResult */
  walkForward: (req) => request("POST", "/api/walkforward", req),

  // ── Bot-wedstrijd (altijd de root, ook vanaf /bot/<id>/) ──
  /** BotSummary[] (volgorde van BOTS); 404 = server zonder meerdere bots */
  getBots: () => request("GET", "/api/bots", undefined, ROOT),
  /** → { results: { id, ok, error? }[] } */
  startAll: () => request("POST", "/api/bots/start-all", undefined, ROOT),
  /** → { results: { id, ok, error? }[] } (open posities blijven staan) */
  stopAll: () => request("POST", "/api/bots/stop-all", undefined, ROOT),
  /** Noodstop van elke bot (ook als er één mislukt) → { results: { id, ok, error?, killResult? }[] } */
  killAll: () => request("POST", "/api/bots/kill-all", undefined, ROOT),
};

/** Alle event-types die de server via SSE stuurt (zie ServerEvent in src/core/types.ts) */
export const EVENT_TYPES = [
  "snapshot",
  "price",
  "candle",
  "decision",
  "order",
  "position-opened",
  "position-closed",
  "log",
];

/**
 * Verbindt met de SSE-stream. `onEvent(type, data)` voor elk server-event,
 * `onStatus("open" | "closed")` bij verbindingswijzigingen. EventSource
 * herverbindt automatisch. Geeft een functie terug om te sluiten.
 */
export function connectEvents(onEvent, onStatus) {
  const token = getToken();
  const path = `${apiBase()}/api/events`;
  const url = token ? `${path}?${qs({ token })}` : path;
  const es = new EventSource(url);
  es.onopen = () => onStatus && onStatus("open");
  es.onerror = () => onStatus && onStatus("closed");
  for (const type of EVENT_TYPES) {
    es.addEventListener(type, (ev) => {
      try {
        onEvent(type, JSON.parse(ev.data));
      } catch (err) {
        console.error("Kon event niet lezen", type, err);
      }
    });
  }
  return () => es.close();
}
