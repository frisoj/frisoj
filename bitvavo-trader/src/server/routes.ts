/**
 * API-routes (/api/*). Alle afhankelijkheden worden geïnjecteerd zodat de
 * routes testbaar zijn zonder echte engine, feed of strategieën.
 */
import type {
  AppInfo,
  BacktestResult,
  BotSummary,
  Candle,
  CandlesResponse,
  ChartIndicators,
  DataSource,
  EngineConfig,
  EngineSnapshot,
  EnsembleConfig,
  EnsembleDecision,
  ExitReason,
  Interval,
  KillResult,
  MarketDataFeed,
  MarketInfo,
  OptimizationResult,
  OptimizeObjective,
  Regime,
  RiskConfig,
  SignalMarker,
  StrategyId,
  StrategyMeta,
  Trade,
  WalkForwardResult,
} from "../core/types";
import { APP_VERSION } from "../core/defaults";
import { INTERVAL_MS } from "../core/types";
import { closedCandles } from "../core/util";
import { spreadFromTicker } from "../backtest/backtester";
import { loadTrendCandles, type TrendCandles } from "../backtest/trendData";
import { foldWindows } from "../backtest/walkForward";
import { trendFilterActive } from "../strategies/trendFilter";
import type { AppConfig } from "../config";
import { HttpError, Router, type RequestContext } from "./router";
import { Scanner, SCANNER_DEFAULT_LIMIT, SCANNER_MAX_LIMIT } from "./scanner";
import type { SseHub } from "./sse";
import { backtestWarmupCandles } from "./warmup";
import {
  fail,
  isPlainObject,
  normalizeMarket,
  parseBacktestRequest,
  parseInterval,
  parseLimit,
  parseMarket,
  parseOptimizeRequest,
  parseWalkForwardRequest,
  toNumber,
  validateConfigPatch,
  type ParsedBacktestRequest,
  type RiskValidator,
} from "./validation";

/** Wat de server van de TradingEngine gebruikt (structureel, zodat tests een fake kunnen geven). */
export interface EngineLike {
  snapshot(): EngineSnapshot;
  /** Verwerpt met "Starten geblokkeerd: …" (→ 409) zolang een noodstop loopt. */
  start(): Promise<void>;
  stop(): Promise<void>;
  updateConfig(partial: Partial<EngineConfig>): EngineConfig;
  closePosition(id: string, reason?: ExitReason): Promise<Trade | null>;
  /** Noodstop; de echte engine geeft een KillResult terug (oudere fakes niets). */
  killSwitch(): Promise<KillResult | void>;
  /** Gooit "Armen geblokkeerd: …" zolang de gebruiker een herstelmelding niet bevestigd heeft. */
  arm(): void;
  disarm(): void;
  readonly liveArmed: boolean;
  resetPaper(startingCapital: number): void;
  // ── Optioneel (duck-typed): ontbreken → 501 ──
  /** Blokkade na kooporders met onbekende uitkomst opheffen (gebruiker heeft Bitvavo zelf gecontroleerd). */
  acknowledgeUnknownOrders?(): void;
  /** Herstelmelding (onbruikbaar statusbestand bij het starten) bevestigen; daarna mag armen weer. */
  acknowledgeStateRecovery?(): void;
  /**
   * Onverkoopbare positie afschrijven (de echte engine is async: verse koers/saldo);
   * gooit/verwerpt met "Afschrijven kan …" als dat (nu) niet mag.
   */
  writeOffPosition?(id: string): Trade | Promise<Trade>;
  /**
   * Nederlandse reden waarom de laatste `closePosition` de positie niet sloot
   * (bijv. "onverkoopbaar: waarde €4,78 < minimum €5,00"), of null.
   */
  readonly lastCloseFailure?: string | null;
  /**
   * Laatste beslissing van een markt (ook als de snapshot hem bij veel markten
   * weglaat). Ontbreekt → de route valt terug op `snapshot().decisions`.
   */
  decisionFor?(market: string): EnsembleDecision | null;
}

/** Zelfde vorm als BacktestInput in src/backtest/backtester.ts */
export interface BacktestInputLike {
  market: string;
  interval: Interval;
  candles: Candle[];
  initialCapital: number;
  ensemble: EnsembleConfig;
  risk: RiskConfig;
  marketInfo?: MarketInfo;
  dataSource?: DataSource;
  tradeFromIndex?: number;
  /** Huidige bid/ask-spread als fractie ((ask − bid) / mid), best effort uit de 24h-ticker */
  spreadPct?: number;
  /**
   * Candles voor het trendfilter (`ensemble.trendFilter.interval`, gesloten, oplopend), vanaf
   * `trendWarmupMs` vóór de eerste handelscandle. Alleen als het trendfilter aan staat.
   */
  trendCandles?: TrendCandles;
}

export interface OptimizeOptsLike {
  strategy?: StrategyId;
  objective: OptimizeObjective;
  maxCombos?: number;
}

/**
 * De zware berekeningen mogen een Promise teruggeven: main.ts laat ze in een
 * worker-thread draaien (heavyRunner.ts), zodat de engine, stop-losses,
 * LiveBroker-polling, SSE en de noodstop blijven reageren.
 */
export interface Services {
  runBacktest(input: BacktestInputLike): BacktestResult | Promise<BacktestResult>;
  optimize(input: BacktestInputLike, opts: OptimizeOptsLike): OptimizationResult | Promise<OptimizationResult>;
  walkForward(
    input: BacktestInputLike,
    opts: OptimizeOptsLike & { folds: number; trainRatio: number },
  ): WalkForwardResult | Promise<WalkForwardResult>;
  listStrategies(): StrategyMeta[];
  chartIndicators(candles: Candle[]): ChartIndicators;
  runEnsemble(market: string, candles: Candle[], cfg: EnsembleConfig): EnsembleDecision[];
  decisionsToMarkers(decisions: EnsembleDecision[]): SignalMarker[];
  detectRegimes(candles: Candle[]): Regime[];
  validateRiskConfig: RiskValidator;
}

/** Eén bot voor de wedstrijd-routes (`/api/bots…`). */
export interface BotEntry {
  id: string;
  engine: Pick<EngineLike, "start" | "stop" | "killSwitch">;
  /** Samenvatting voor het klassement (zie src/bots/summary.ts) */
  summary(): BotSummary;
}

/** Uitkomst per bot van `POST /api/bots/start-all | stop-all | kill-all`. */
export interface BotActionResult {
  id: string;
  /**
   * start/stop: gelukt. kill: de noodstop liep én elke positie is verkocht; staat er
   * nog iets open (`killResult.failed`), dan false met een Nederlandse `error`.
   */
  ok: boolean;
  error?: string;
  killResult?: KillResult;
}

export interface ApiDeps {
  config: AppConfig;
  engine: EngineLike;
  feed: MarketDataFeed;
  services: Services;
  hub: SseHub;
  /** Overschrijft (delen van) AppInfo, bijv. voor tests */
  info?: () => Partial<AppInfo>;
  /** Aanroepen na een geslaagde config-wijziging (standaard: saveEngineOverrides) */
  persistConfig?: (cfg: EngineConfig) => void;
  scanner?: Scanner;
  now?: () => number;
  log?: (level: "info" | "warn" | "error", msg: string) => void;
  /**
   * Meerdere bots (optioneel): alle bots in de volgorde van BOTS. Met deze provider
   * krijgt de router `GET /api/bots` en `POST /api/bots/start-all | stop-all | kill-all`,
   * met dezelfde beveiliging als elke andere API-route.
   */
  bots?: () => readonly BotEntry[];
  /**
   * Gedeelde vergrendeling voor backtest/optimalisatie/walk-forward (één tegelijk).
   * Meerdere bots in één proces delen één rekenwerker en dus ook deze vergrendeling;
   * zonder deze optie heeft elke router zijn eigen.
   */
  heavyGate?: HeavyGate;
}

/** Welke zware berekening er nu loopt (null = geen). */
export interface HeavyGate {
  busy: string | null;
}

export const ARM_CONFIRM_TEXT = "IK BEGRIJP HET RISICO";

/** Extra candles vóór de backtestperiode, alleen voor indicator-warmup. */
export const BACKTEST_WARMUP_CANDLES = 250;
export const MIN_BACKTEST_CANDLES = 60;
/** Minimaal aantal candles IN de gekozen periode (na de warmup) om te kunnen testen. */
export const MIN_PERIOD_CANDLES = MIN_BACKTEST_CANDLES / 2;
/** Langer wachten we niet op de 24h-ticker voor de spread (de backtest gaat dan zonder). */
export const SPREAD_LOOKUP_TIMEOUT_MS = 3_000;
const MARKETS_CACHE_MS = 5 * 60_000;

function isKillResult(v: unknown): v is KillResult {
  return (
    typeof v === "object" &&
    v !== null &&
    typeof (v as KillResult).closed === "number" &&
    Array.isArray((v as KillResult).failed)
  );
}

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

/** "BTC-EUR (onverkoopbaar: …); ETH-EUR (…)" — wat na een noodstop nog open staat. */
function failedText(failed: KillResult["failed"]): string {
  const shown = failed.slice(0, 5).map((f) => `${f.market} (${f.reason})`);
  if (failed.length > shown.length) shown.push(`+${failed.length - shown.length} meer`);
  return shown.join("; ");
}

/**
 * Voert een actie uit op ELKE bot tegelijk; een fout bij de ene bot houdt de andere
 * niet tegen (allSettled). De actie wordt voor alle bots synchroon in gang gezet, dus
 * bij de noodstop stoppen alle bots meteen met kopen.
 */
async function forEachBot<T>(
  bots: readonly BotEntry[],
  action: (bot: BotEntry) => Promise<T>,
  toResult: (bot: BotEntry, value: T) => BotActionResult,
): Promise<{ results: BotActionResult[] }> {
  const runs = bots.map((bot) => {
    try {
      return action(bot);
    } catch (err) {
      return Promise.reject(err);
    }
  });
  const settled = await Promise.allSettled(runs);
  return {
    results: settled.map((r, i) =>
      r.status === "fulfilled" ? toResult(bots[i], r.value) : { id: bots[i].id, ok: false, error: errorMessage(r.reason) },
    ),
  };
}

export function buildApiRouter(deps: ApiDeps): Router {
  const { config, engine, feed, services, hub } = deps;
  const now = deps.now ?? Date.now;
  const log = deps.log ?? ((level, msg) => (level === "error" ? console.error(msg) : console.log(msg)));
  const scanner =
    deps.scanner ??
    new Scanner({ feed, services, now, log: (m) => log("warn", m) });

  const getInfo = (): AppInfo => {
    const base: AppInfo = {
      mode: config.mode,
      dataSource: feed.source,
      hasApiKeys: Boolean(config.apiKey && config.apiSecret),
      liveArmed: engine.liveArmed,
      capitalLimitQuote: config.capitalLimitQuote,
      version: APP_VERSION,
      paperStartingCapital: config.paperStartingCapital,
    };
    return deps.info ? { ...base, ...deps.info() } : base;
  };

  // ── markten (kort gecachet; BitvavoFeed cachet zelf ook) ──
  let marketsCache: { at: number; list: MarketInfo[] } | null = null;
  const allMarkets = async (): Promise<MarketInfo[]> => {
    if (marketsCache && now() - marketsCache.at < MARKETS_CACHE_MS) return marketsCache.list;
    const list = await feed.getMarkets();
    marketsCache = { at: now(), list };
    return list;
  };
  const eurTradingMarkets = async (): Promise<MarketInfo[]> =>
    (await allMarkets())
      .filter((m) => m.quote === "EUR" && m.status === "trading")
      .sort((a, b) => a.market.localeCompare(b.market));

  // ── zware berekeningen: één tegelijk ──
  // Meerdere bots delen één rekenwerker: dan delen ze ook deze vergrendeling (heavyGate).
  const gate: HeavyGate = deps.heavyGate ?? { busy: null };
  const heavy = async <T>(name: string, fn: () => Promise<T>): Promise<T> => {
    if (gate.busy) throw new HttpError(429, `Er loopt al een berekening (${gate.busy}). Wacht tot die klaar is.`);
    gate.busy = name;
    try {
      return await fn();
    } finally {
      gate.busy = null;
    }
  };

  const strategiesSafe = (): StrategyMeta[] | undefined => {
    try {
      return services.listStrategies();
    } catch {
      return undefined;
    }
  };

  /**
   * Huidige bid/ask-spread van de markt (fractie), best effort: een fout of
   * een trage ticker laat de backtest NOOIT mislukken, hij rekent dan alleen
   * met de ingestelde slippage.
   */
  const currentSpread = async (market: string): Promise<number | undefined> => {
    const lookup = (async () => spreadFromTicker((await feed.getTickers24h([market])).find((t) => t.market === market)))()
      .catch(() => undefined);
    let timer: NodeJS.Timeout | undefined;
    const timeout = new Promise<undefined>((resolve) => {
      timer = setTimeout(() => resolve(undefined), SPREAD_LOOKUP_TIMEOUT_MS);
      timer.unref?.();
    });
    try {
      return await Promise.race([lookup, timeout]);
    } finally {
      clearTimeout(timer);
    }
  };

  const dateNl = (ms: number) =>
    new Date(ms).toLocaleDateString("nl-NL", { timeZone: "Europe/Amsterdam", day: "numeric", month: "long", year: "numeric" });

  /**
   * Haalt de historie op (periode + warmup ervoor). Er wordt NOOIT gehandeld
   * tijdens de warmup van de strategieën: bij een markt met korte historie
   * (recente listing) schuift het begin op en komt er een `note` terug; een te
   * korte periode geeft een 400 in plaats van stilletjes een andere periode.
   */
  const loadHistory = async (
    p: ParsedBacktestRequest,
    optimizeStrategy?: StrategyId,
  ): Promise<{ input: BacktestInputLike; note?: string }> => {
    const to = now();
    const from = to - p.days * 86_400_000;
    const step = INTERVAL_MS[p.interval];
    const required = backtestWarmupCandles(p.ensemble, optimizeStrategy);
    const warmupFrom = from - Math.max(BACKTEST_WARMUP_CANDLES, required) * step;
    // Tegelijk met de historie; faalt nooit (hooguit `undefined`).
    const spreadPromise = currentSpread(p.market);
    const candles = await feed.getHistory(p.market, p.interval, warmupFrom, to);
    if (candles.length < MIN_BACKTEST_CANDLES) {
      fail(
        `Te weinig historische candles (${candles.length}) voor ${p.market} op ${p.interval}. ` +
          "Kies meer dagen of een korter interval.",
      );
    }
    const firstInPeriod = candles.findIndex((c) => c.time >= from);
    if (firstInPeriod < 0) fail(`Geen candles in de gekozen periode voor ${p.market} op ${p.interval}.`);
    // Recente listing: de historie begint ná `from` → eerst de warmup afwachten.
    const tradeFromIndex = Math.max(firstInPeriod, required);
    const periodCandles = Math.max(0, candles.length - tradeFromIndex);
    if (periodCandles < MIN_PERIOD_CANDLES) {
      if (tradeFromIndex > firstInPeriod) {
        fail(
          `${p.market} heeft te weinig historie op ${p.interval}: de strategieën hebben ${required} candles ` +
            `opwarmtijd nodig en daarna blijven er maar ${periodCandles} candles over om te testen ` +
            `(minimaal ${MIN_PERIOD_CANDLES}). Kies een korter interval of een andere markt.`,
        );
      }
      fail(
        `Periode te kort: maar ${periodCandles} candles van ${p.interval} om te testen ` +
          `(minimaal ${MIN_PERIOD_CANDLES}). Kies meer dagen of een korter interval.`,
      );
    }
    const notes: string[] = [];
    if (tradeFromIndex > firstInPeriod) {
      const start = candles[tradeFromIndex].time;
      const days = (to - start) / 86_400_000;
      notes.push(
        `Periode ingekort: ${p.market} heeft pas historie vanaf ${dateNl(candles[0].time)}. Na ${required} candles ` +
          `opwarmtijd begint de test op ${dateNl(start)} (${days.toLocaleString("nl-NL", { maximumFractionDigits: 1 })} ` +
          `dagen in plaats van ${p.days}).`,
      );
    }
    // Trendfilter: Bitcoin en/of de munt zelf op de tijdschaal van het filter, vanaf
    // ruim vóór de eerste handelscandle. Mislukt laden → het filter blokkeert
    // (voor de zekerheid) en de note zegt waarom.
    let trendCandles: TrendCandles | undefined;
    const tf = p.ensemble.trendFilter;
    if (trendFilterActive(tf)) {
      const trend = await loadTrendCandles(feed, p.market, tf, candles[tradeFromIndex].time, to);
      trendCandles = trend.trendCandles;
      if (trend.note) notes.push(trend.note);
    }
    const marketInfo = (await allMarkets()).find((m) => m.market === p.market);
    const spreadPct = await spreadPromise;
    return {
      input: {
        market: p.market,
        interval: p.interval,
        candles,
        initialCapital: p.initialCapital,
        ensemble: p.ensemble,
        risk: p.risk,
        marketInfo,
        dataSource: feed.source,
        tradeFromIndex,
        ...(spreadPct !== undefined ? { spreadPct } : {}),
        ...(trendCandles !== undefined ? { trendCandles } : {}),
      },
      note: notes.length > 0 ? notes.join(" ") : undefined,
    };
  };

  /**
   * Zet de uitleg van het ophalen (periode ingekort, trendfilter-data) vóór een
   * eventuele eigen `note` van de berekening (bijv. over de spread); geen van
   * beide gaat verloren.
   */
  const withNote = <T extends object>(result: T, note: string | undefined): T => {
    if (!note) return result;
    const own = (result as { note?: unknown }).note;
    const combined = typeof own === "string" && own.trim() !== "" && own !== note ? `${note} ${own}` : note;
    return { ...result, note: combined };
  };

  const backtestDeps = async () => ({
    knownMarkets: new Set((await allMarkets()).map((m) => m.market)),
    current: engine.snapshot().config,
    defaultCapital: config.paperStartingCapital,
    validateRisk: services.validateRiskConfig,
    strategies: strategiesSafe(),
  });

  const router = new Router();

  router.get("/api/info", () => getInfo());

  router.get("/api/state", () => engine.snapshot());

  router.get("/api/events", ({ req, res }: RequestContext) => {
    // HEAD zou een SSE-client registreren waarvan het antwoord nooit eindigt.
    if ((req.method ?? "GET").toUpperCase() === "HEAD") {
      res.setHeader("Allow", "GET");
      throw new HttpError(405, "Methode HEAD niet toegestaan voor /api/events (de eventstream werkt alleen met GET).");
    }
    hub.addClient(req, res, [{ type: "snapshot", data: engine.snapshot() }]);
    return undefined;
  });

  router.get("/api/config", () => engine.snapshot().config);

  router.put("/api/config", async ({ body }) => {
    const patch = await body();
    const current = engine.snapshot().config;
    const eur = new Set((await eurTradingMarkets()).map((m) => m.market));
    const valid = validateConfigPatch(patch, current, {
      knownEurMarkets: eur,
      validateRisk: services.validateRiskConfig,
      strategies: strategiesSafe(),
    });
    let updated: EngineConfig;
    try {
      updated = engine.updateConfig(valid);
    } catch (err) {
      throw new HttpError(400, (err as Error).message);
    }
    try {
      deps.persistConfig?.(updated);
    } catch (err) {
      log("error", `Kon instellingen niet opslaan: ${(err as Error).message}`);
      throw new HttpError(500, `Instellingen zijn actief maar konden niet worden opgeslagen: ${(err as Error).message}`);
    }
    scanner.clearCache();
    return updated;
  });

  router.post("/api/engine/start", async () => {
    try {
      await engine.start();
    } catch (err) {
      const msg = errorMessage(err);
      // "Starten geblokkeerd: noodstop bezig …": een noodstop eindigt altijd met een stilstaande bot.
      if (msg.startsWith("Starten geblokkeerd")) throw new HttpError(409, msg);
      throw err;
    }
    return engine.snapshot();
  });
  router.post("/api/engine/stop", async () => {
    await engine.stop();
    return engine.snapshot();
  });
  router.post("/api/engine/kill", async () => {
    const killResult = await engine.killSwitch();
    const snap = engine.snapshot();
    // Ook bij posities die NIET gesloten konden worden: 200 met de details, zodat
    // het dashboard precies kan tonen wat de gebruiker zelf nog moet verkopen.
    return isKillResult(killResult) ? { ...snap, killResult } : snap;
  });

  router.post("/api/positions/:id/close", async ({ params }) => {
    const id = params.id;
    if (!id || id.length > 100) fail("Ongeldige positie-id.");
    const exists = engine.snapshot().positions.some((p) => p.id === id);
    if (!exists) throw new HttpError(404, "Positie niet gevonden (misschien al gesloten).");
    const trade = await engine.closePosition(id, "manual");
    if (!trade) {
      // Direct na de await lezen: een volgende closePosition zet hem weer terug.
      const reason = engine.lastCloseFailure;
      throw new HttpError(
        409,
        typeof reason === "string" && reason.trim() !== ""
          ? reason
          : "Positie kon niet worden gesloten. Bekijk het logboek voor details.",
      );
    }
    return trade;
  });

  router.post("/api/positions/:id/writeoff", async ({ params }) => {
    const id = params.id;
    if (!id || id.length > 100) fail("Ongeldige positie-id.");
    if (typeof engine.writeOffPosition !== "function") {
      throw new HttpError(501, "Afschrijven wordt door deze versie van de bot niet ondersteund.");
    }
    const exists = engine.snapshot().positions.some((p) => p.id === id);
    if (!exists) throw new HttpError(404, "Positie niet gevonden (misschien al gesloten).");
    try {
      // De engine haalt vlak voor de beslissing een verse koers (en live een vers saldo) op.
      const trade = await engine.writeOffPosition(id);
      return trade;
    } catch (err) {
      const msg = errorMessage(err);
      // "Afschrijven kan alleen voor een onverkoopbare positie …" / "Afschrijven kan nu (even) niet …"
      if (msg.startsWith("Afschrijven")) throw new HttpError(409, msg);
      if (/niet gevonden/.test(msg)) throw new HttpError(404, "Positie niet gevonden (misschien al gesloten).");
      throw err;
    }
  });

  router.post("/api/live/arm", async ({ body }) => {
    const b = await body();
    if (config.mode !== "live") fail("Armen kan alleen in live mode. Je draait nu in oefenmodus (paper).");
    if (!isPlainObject(b) || b.confirm !== ARM_CONFIRM_TEXT) {
      fail(`Typ exact "${ARM_CONFIRM_TEXT}" om live handelen met echt geld aan te zetten.`);
    }
    if (!config.apiKey || !config.apiSecret) fail("Geen Bitvavo API-sleutel ingesteld.");
    try {
      engine.arm();
    } catch (err) {
      const msg = errorMessage(err);
      // Bijv. een onbevestigde herstelmelding: eerst POST /api/state/recovery/ack.
      if (msg.startsWith("Armen geblokkeerd")) throw new HttpError(409, msg);
      throw err;
    }
    return getInfo();
  });

  router.post("/api/live/disarm", () => {
    engine.disarm();
    return getInfo();
  });

  router.post("/api/live/unknown-orders/ack", () => {
    if (typeof engine.acknowledgeUnknownOrders !== "function") {
      throw new HttpError(501, "Bevestigen van orders met onbekende uitkomst wordt door deze versie van de bot niet ondersteund.");
    }
    engine.acknowledgeUnknownOrders();
    return engine.snapshot();
  });

  router.post("/api/state/recovery/ack", () => {
    if (typeof engine.acknowledgeStateRecovery !== "function") {
      throw new HttpError(501, "Bevestigen van de herstelmelding wordt door deze versie van de bot niet ondersteund.");
    }
    engine.acknowledgeStateRecovery();
    return engine.snapshot();
  });

  router.post("/api/paper/reset", async ({ body }) => {
    const b = await body();
    if (config.mode !== "paper") fail("Resetten kan alleen in oefenmodus (paper), niet in live mode.");
    let capital = config.paperStartingCapital;
    if (isPlainObject(b) && b.startingCapital !== undefined && b.startingCapital !== null) {
      const n = toNumber(b.startingCapital);
      if (n === undefined || n < 5 || n > 10_000_000) fail("startingCapital moet tussen 5 en 10000000 liggen.");
      capital = n;
    }
    engine.resetPaper(capital);
    return engine.snapshot();
  });

  // ── Meerdere bots (wedstrijd) ──
  if (deps.bots) {
    const bots = deps.bots;
    router.get("/api/bots", () => bots().map((b) => b.summary()));
    router.post("/api/bots/start-all", () =>
      forEachBot(
        bots(),
        (b) => b.engine.start(),
        (b) => ({ id: b.id, ok: true }),
      ),
    );
    router.post("/api/bots/stop-all", () =>
      forEachBot(
        bots(),
        (b) => b.engine.stop(),
        (b) => ({ id: b.id, ok: true }),
      ),
    );
    // Noodstop van ALLE bots: elke bot krijgt zijn noodstop, ook als die van een andere
    // bot mislukt. Net als bij één bot 200 met de details van wat niet verkocht kon worden.
    router.post("/api/bots/kill-all", () =>
      forEachBot(
        bots(),
        (b) => b.engine.killSwitch(),
        (b, killResult) => {
          if (!isKillResult(killResult)) return { id: b.id, ok: true };
          if (killResult.failed.length === 0) return { id: b.id, ok: true, killResult };
          return {
            id: b.id,
            ok: false,
            error: `Niet alles verkocht: ${failedText(killResult.failed)}`,
            killResult,
          };
        },
      ),
    );
  }

  router.get("/api/markets", () => eurTradingMarkets());

  // Laatste beslissing van één markt: bij veel markten staat niet elke markt in snapshot.decisions.
  router.get("/api/decision", ({ query }) => {
    const market = normalizeMarket(query.get("market"));
    if (!market) fail("Geef een geldige markt op, bijv. BTC-EUR.");
    const decision =
      typeof engine.decisionFor === "function"
        ? engine.decisionFor(market)
        : (engine.snapshot().decisions[market] ?? null);
    return { decision: decision ?? null };
  });

  router.get("/api/candles", async ({ query }) => {
    const known = new Set((await allMarkets()).map((m) => m.market));
    const market = parseMarket(query.get("market"), known);
    const interval = parseInterval(query.get("interval") ?? engine.snapshot().config.interval);
    // Buiten 50–1000 wordt begrensd (het dashboard vraagt bijv. 25 uur-candles voor 24u-statistieken)
    const limit = Math.min(1000, Math.max(50, parseLimit(query.get("limit"), 300, 1, 100_000)));
    const candles = await feed.getCandles(market, interval, limit);
    const snap = engine.snapshot();
    const closed = closedCandles(candles, interval, now());
    const decisions = closed.length > 0 ? services.runEnsemble(market, closed, snap.config.ensemble) : [];
    const response: CandlesResponse = {
      market,
      interval,
      candles,
      indicators: services.chartIndicators(candles),
      signals: services.decisionsToMarkers(decisions),
      decision: decisions.length > 0 ? decisions[decisions.length - 1] : null,
      trades: snap.trades.filter((t) => t.market === market),
      positions: snap.positions.filter((p) => p.market === market),
    };
    return response;
  });

  router.get("/api/scanner", async ({ query }) => {
    const raw = query.get("limit");
    let limit = SCANNER_DEFAULT_LIMIT;
    if (raw !== null && raw.trim() !== "") {
      const n = toNumber(raw);
      if (n === undefined || !Number.isInteger(n) || n < 1) fail("limit moet een positief geheel getal zijn.");
      limit = Math.min(n, SCANNER_MAX_LIMIT);
    }
    const cfg = engine.snapshot().config;
    return scanner.scan(limit, cfg.interval, cfg.ensemble);
  });

  router.get("/api/strategies", () => services.listStrategies());

  router.post("/api/backtest", async ({ body }) => {
    const b = await body();
    const parsed = parseBacktestRequest(b, await backtestDeps());
    return heavy("backtest", async () => {
      const { input, note } = await loadHistory(parsed);
      return withNote(await services.runBacktest(input), note);
    });
  });

  router.post("/api/optimize", async ({ body }) => {
    const b = await body();
    const parsed = parseOptimizeRequest(b, await backtestDeps());
    return heavy("optimalisatie", async () => {
      const { input, note } = await loadHistory(parsed, parsed.strategy);
      const result = await services.optimize(input, {
        strategy: parsed.strategy,
        objective: parsed.objective,
        maxCombos: parsed.maxCombos,
      });
      return withNote(result, note);
    });
  });

  router.post("/api/walkforward", async ({ body }) => {
    const b = await body();
    const parsed = parseWalkForwardRequest(b, await backtestDeps());
    return heavy("walk-forward", async () => {
      const { input, note } = await loadHistory(parsed, parsed.strategy);
      // Te weinig candles voor de folds is een invoerfout (400), geen interne fout.
      try {
        foldWindows(input.tradeFromIndex ?? 0, input.candles.length, parsed.folds, parsed.trainRatio);
      } catch (err) {
        fail((err as Error).message);
      }
      const result = await services.walkForward(input, {
        strategy: parsed.strategy,
        objective: parsed.objective,
        maxCombos: parsed.maxCombos,
        folds: parsed.folds,
        trainRatio: parsed.trainRatio,
      });
      return withNote(result, note);
    });
  });

  return router;
}
