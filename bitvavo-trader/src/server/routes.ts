/**
 * API-routes (/api/*). Alle afhankelijkheden worden geïnjecteerd zodat de
 * routes testbaar zijn zonder echte engine, feed of strategieën.
 */
import type {
  AppInfo,
  BacktestResult,
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
import type { AppConfig } from "../config";
import { HttpError, Router, type RequestContext } from "./router";
import { Scanner, SCANNER_MAX_LIMIT } from "./scanner";
import type { SseHub } from "./sse";
import {
  fail,
  isPlainObject,
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
  start(): Promise<void>;
  stop(): Promise<void>;
  updateConfig(partial: Partial<EngineConfig>): EngineConfig;
  closePosition(id: string, reason?: ExitReason): Promise<Trade | null>;
  killSwitch(): Promise<void>;
  arm(): void;
  disarm(): void;
  readonly liveArmed: boolean;
  resetPaper(startingCapital: number): void;
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
}

export interface OptimizeOptsLike {
  strategy?: StrategyId;
  objective: OptimizeObjective;
  maxCombos?: number;
}

export interface Services {
  runBacktest(input: BacktestInputLike): BacktestResult;
  optimize(input: BacktestInputLike, opts: OptimizeOptsLike): OptimizationResult;
  walkForward(input: BacktestInputLike, opts: OptimizeOptsLike & { folds: number; trainRatio: number }): WalkForwardResult;
  listStrategies(): StrategyMeta[];
  chartIndicators(candles: Candle[]): ChartIndicators;
  runEnsemble(market: string, candles: Candle[], cfg: EnsembleConfig): EnsembleDecision[];
  decisionsToMarkers(decisions: EnsembleDecision[]): SignalMarker[];
  detectRegimes(candles: Candle[]): Regime[];
  validateRiskConfig: RiskValidator;
}

export interface ApiDeps {
  config: AppConfig;
  engine: EngineLike;
  feed: MarketDataFeed;
  services: Services;
  hub: SseHub;
  /** Overschrijft (delen van) AppInfo, bijv. voor tests */
  info?: () => AppInfo;
  /** Aanroepen na een geslaagde config-wijziging (standaard: saveEngineOverrides) */
  persistConfig?: (cfg: EngineConfig) => void;
  scanner?: Scanner;
  now?: () => number;
  log?: (level: "info" | "warn" | "error", msg: string) => void;
}

export const ARM_CONFIRM_TEXT = "IK BEGRIJP HET RISICO";

/** Extra candles vóór de backtestperiode, alleen voor indicator-warmup. */
export const BACKTEST_WARMUP_CANDLES = 250;
const MIN_BACKTEST_CANDLES = 60;
const MARKETS_CACHE_MS = 5 * 60_000;

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
  let busy: string | null = null;
  const heavy = async <T>(name: string, fn: () => Promise<T>): Promise<T> => {
    if (busy) throw new HttpError(429, `Er loopt al een berekening (${busy}). Wacht tot die klaar is.`);
    busy = name;
    try {
      return await fn();
    } finally {
      busy = null;
    }
  };

  const strategiesSafe = (): StrategyMeta[] | undefined => {
    try {
      return services.listStrategies();
    } catch {
      return undefined;
    }
  };

  const loadHistory = async (p: ParsedBacktestRequest): Promise<BacktestInputLike> => {
    const to = now();
    const from = to - p.days * 86_400_000;
    const warmupFrom = from - BACKTEST_WARMUP_CANDLES * INTERVAL_MS[p.interval];
    const candles = await feed.getHistory(p.market, p.interval, warmupFrom, to);
    if (candles.length < MIN_BACKTEST_CANDLES) {
      fail(
        `Te weinig historische candles (${candles.length}) voor ${p.market} op ${p.interval}. ` +
          "Kies meer dagen of een korter interval.",
      );
    }
    let tradeFromIndex = candles.findIndex((c) => c.time >= from);
    if (tradeFromIndex < 0) tradeFromIndex = 0;
    // Zorg dat er altijd genoeg candles overblijven om te handelen
    if (candles.length - tradeFromIndex < MIN_BACKTEST_CANDLES / 2) tradeFromIndex = 0;
    const marketInfo = (await allMarkets()).find((m) => m.market === p.market);
    return {
      market: p.market,
      interval: p.interval,
      candles,
      initialCapital: p.initialCapital,
      ensemble: p.ensemble,
      risk: p.risk,
      marketInfo,
      dataSource: feed.source,
      tradeFromIndex,
    };
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
    await engine.start();
    return engine.snapshot();
  });
  router.post("/api/engine/stop", async () => {
    await engine.stop();
    return engine.snapshot();
  });
  router.post("/api/engine/kill", async () => {
    await engine.killSwitch();
    return engine.snapshot();
  });

  router.post("/api/positions/:id/close", async ({ params }) => {
    const id = params.id;
    if (!id || id.length > 100) fail("Ongeldige positie-id.");
    const exists = engine.snapshot().positions.some((p) => p.id === id);
    if (!exists) throw new HttpError(404, "Positie niet gevonden (misschien al gesloten).");
    const trade = await engine.closePosition(id, "manual");
    if (!trade) throw new HttpError(409, "Positie kon niet worden gesloten. Bekijk het logboek voor details.");
    return trade;
  });

  router.post("/api/live/arm", async ({ body }) => {
    const b = await body();
    if (config.mode !== "live") fail("Armen kan alleen in live mode. Je draait nu in oefenmodus (paper).");
    if (!isPlainObject(b) || b.confirm !== ARM_CONFIRM_TEXT) {
      fail(`Typ exact "${ARM_CONFIRM_TEXT}" om live handelen met echt geld aan te zetten.`);
    }
    if (!config.apiKey || !config.apiSecret) fail("Geen Bitvavo API-sleutel ingesteld.");
    engine.arm();
    return getInfo();
  });

  router.post("/api/live/disarm", () => {
    engine.disarm();
    return getInfo();
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

  router.get("/api/markets", () => eurTradingMarkets());

  router.get("/api/candles", async ({ query }) => {
    const known = new Set((await allMarkets()).map((m) => m.market));
    const market = parseMarket(query.get("market"), known);
    const interval = parseInterval(query.get("interval") ?? engine.snapshot().config.interval);
    const limit = parseLimit(query.get("limit"), 300, 50, 1000);
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
    let limit = 30;
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
      const input = await loadHistory(parsed);
      return services.runBacktest(input);
    });
  });

  router.post("/api/optimize", async ({ body }) => {
    const b = await body();
    const parsed = parseOptimizeRequest(b, await backtestDeps());
    return heavy("optimalisatie", async () => {
      const input = await loadHistory(parsed);
      return services.optimize(input, {
        strategy: parsed.strategy,
        objective: parsed.objective,
        maxCombos: parsed.maxCombos,
      });
    });
  });

  router.post("/api/walkforward", async ({ body }) => {
    const b = await body();
    const parsed = parseWalkForwardRequest(b, await backtestDeps());
    return heavy("walk-forward", async () => {
      const input = await loadHistory(parsed);
      return services.walkForward(input, {
        strategy: parsed.strategy,
        objective: parsed.objective,
        maxCombos: parsed.maxCombos,
        folds: parsed.folds,
        trainRatio: parsed.trainRatio,
      });
    });
  });

  return router;
}
