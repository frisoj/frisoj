import { EventEmitter } from "node:events";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { request as httpRequest } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { AppConfig } from "../../src/config";
import { DEFAULT_ENGINE_CONFIG } from "../../src/core/defaults";
import {
  INTERVAL_MS,
  type BacktestResult,
  type Candle,
  type ChartIndicators,
  type EngineConfig,
  type EngineSnapshot,
  type EnsembleDecision,
  type ExitReason,
  type Interval,
  type MarketDataFeed,
  type MarketInfo,
  type OpenPositionView,
  type OptimizationResult,
  type OrderBook,
  type RiskConfig,
  type StrategyMeta,
  type Ticker24h,
  type Trade,
  type WalkForwardResult,
} from "../../src/core/types";
import { createApp, startHttpServer, type CreateAppDeps, type RunningServer } from "../../src/server/httpServer";
import type { BacktestInputLike, EngineLike, Services } from "../../src/server/routes";

export const NOW = Date.UTC(2026, 8, 28, 12, 7, 0); // niet op een candlegrens

export function makeConfig(overrides: Partial<AppConfig> = {}): AppConfig {
  return {
    mode: "paper",
    dataSource: "simulated",
    host: "127.0.0.1",
    port: 0,
    operatorId: 1,
    paperStartingCapital: 50,
    capitalLimitQuote: 50,
    dataDir: mkdtempSync(join(tmpdir(), "bvt-server-")),
    engine: structuredClone(DEFAULT_ENGINE_CONFIG),
    autostart: false,
    ...overrides,
  };
}

function market(m: string, status = "trading"): MarketInfo {
  const [base, quote] = m.split("-");
  return {
    market: m,
    base,
    quote,
    status,
    minOrderQuote: 5,
    minOrderBase: 0.0001,
    pricePrecision: 5,
    quantityDecimals: 8,
    notionalDecimals: 2,
  };
}

export const MARKETS: MarketInfo[] = [
  market("SOL-EUR"),
  market("BTC-EUR"),
  market("ETH-EUR"),
  market("XRP-EUR", "halted"),
  market("BTC-USDC"),
  market("ADA-EUR"),
];

/** Candles tot en met de candle die nu in vorming is (laatste = open). */
export function makeCandles(interval: Interval, count: number, now = NOW, base = 100): Candle[] {
  const step = INTERVAL_MS[interval];
  const lastOpen = Math.floor(now / step) * step;
  const out: Candle[] = [];
  for (let i = count - 1; i >= 0; i--) {
    const t = lastOpen - i * step;
    const p = base + Math.sin(t / step / 7) * 5 + (count - i) * 0.01;
    out.push({ time: t, open: p, high: p * 1.01, low: p * 0.99, close: p * 1.002, volume: 10 });
  }
  return out;
}

export class FakeFeed implements MarketDataFeed {
  readonly source = "simulated" as const;
  historyCalls: { market: string; interval: Interval; from: number; to: number }[] = [];
  candleCalls: { market: string; interval: Interval; limit: number }[] = [];
  /** Als gezet: getHistory wacht op deze promise (voor busy-tests) */
  historyGate: Promise<void> | null = null;
  failCandlesFor = new Set<string>();
  marketsCalls = 0;
  tickerCalls = 0;

  async getMarkets(): Promise<MarketInfo[]> {
    this.marketsCalls++;
    return MARKETS;
  }
  async getCandles(m: string, interval: Interval, limit: number): Promise<Candle[]> {
    this.candleCalls.push({ market: m, interval, limit });
    if (this.failCandlesFor.has(m)) throw new Error("netwerkfout");
    return makeCandles(interval, limit);
  }
  async getHistory(m: string, interval: Interval, from: number, to: number): Promise<Candle[]> {
    this.historyCalls.push({ market: m, interval, from, to });
    if (this.historyGate) await this.historyGate;
    const step = INTERVAL_MS[interval];
    const count = Math.min(5000, Math.floor((to - from) / step));
    return makeCandles(interval, count + 1, to).slice(0, -1); // alleen gesloten candles
  }
  async getTickers24h(): Promise<Ticker24h[]> {
    this.tickerCalls++;
    const vols: Record<string, number> = {
      "BTC-EUR": 5_000_000,
      "ETH-EUR": 3_000_000,
      "SOL-EUR": 1_000_000,
      "ADA-EUR": 500_000,
      "XRP-EUR": 9_000_000,
      "BTC-USDC": 8_000_000,
    };
    return Object.entries(vols).map(([m, v]) => ({
      market: m,
      last: 100,
      open: 98,
      high: 105,
      low: 95,
      volume: v / 100,
      volumeQuote: v,
      bid: 99.9,
      ask: 100.1,
      changePct: 2.0408,
      timestamp: NOW,
    }));
  }
  async getPrice(): Promise<number> {
    return 100;
  }
  async getOrderBook(m: string): Promise<OrderBook> {
    return { market: m, bids: [[99.9, 1]], asks: [[100.1, 1]], timestamp: NOW };
  }
}

function emptyMetrics() {
  return {
    finalEquity: 50,
    totalReturnPct: 0,
    buyHoldReturnPct: 0,
    maxDrawdownPct: 0,
    sharpe: 0,
    sortino: 0,
    calmar: 0,
    trades: 0,
    winRatePct: 0,
    profitFactor: 0,
    avgTradePct: 0,
    avgWinPct: 0,
    avgLossPct: 0,
    expectancyQuote: 0,
    feesPaid: 0,
    exposurePct: 0,
    bestTradePct: 0,
    worstTradePct: 0,
    avgCandlesHeld: 0,
  };
}

function nulls(n: number): (number | null)[] {
  return new Array(n).fill(null);
}

export function makeServices() {
  const calls = {
    runBacktest: [] as BacktestInputLike[],
    optimize: [] as { input: BacktestInputLike; opts: unknown }[],
    walkForward: [] as { input: BacktestInputLike; opts: unknown }[],
    runEnsemble: [] as { market: string; count: number; lastTime: number }[],
  };
  const services: Services = {
    runBacktest(input): BacktestResult {
      calls.runBacktest.push(input);
      return {
        market: input.market,
        interval: input.interval,
        dataSource: input.dataSource ?? "simulated",
        from: input.candles[0]?.time ?? 0,
        to: input.candles[input.candles.length - 1]?.time ?? 0,
        candlesCount: input.candles.length,
        initialCapital: input.initialCapital,
        metrics: emptyMetrics(),
        trades: [],
        equityCurve: [],
        candles: [],
        markers: [],
        durationMs: 1,
      };
    },
    optimize(input, opts): OptimizationResult {
      calls.optimize.push({ input, opts });
      return { objective: opts.objective, rows: [], best: null, combosTested: 0, heatmap: null, durationMs: 1 };
    },
    walkForward(input, opts): WalkForwardResult {
      calls.walkForward.push({ input, opts });
      return { folds: [], oosMetrics: emptyMetrics(), oosEquityCurve: [], verdict: "Test", durationMs: 1 };
    },
    listStrategies: (): StrategyMeta[] => [
      {
        id: "ema-trend",
        name: "EMA-trend",
        description: "test",
        defaultParams: { fast: 9, slow: 21 },
        paramSpace: { fast: [5, 9], slow: [21, 30] },
        preferredRegimes: ["trend-up"],
      },
      {
        id: "rsi-reversion",
        name: "RSI",
        description: "test",
        defaultParams: { period: 14 },
        paramSpace: { period: [10, 14] },
        preferredRegimes: ["range"],
      },
    ],
    chartIndicators(candles: Candle[]): ChartIndicators {
      const n = candles.length;
      const atr = candles.map(() => 2);
      const rsi = candles.map((_c, i) => (i < 14 ? null : 55.55));
      return {
        emaFast: nulls(n),
        emaSlow: nulls(n),
        ema200: nulls(n),
        bbUpper: nulls(n),
        bbMiddle: nulls(n),
        bbLower: nulls(n),
        vwap: nulls(n),
        rsi,
        macd: nulls(n),
        macdSignal: nulls(n),
        macdHist: nulls(n),
        atr,
      };
    },
    runEnsemble(m: string, candles: Candle[]): EnsembleDecision[] {
      calls.runEnsemble.push({ market: m, count: candles.length, lastTime: candles[candles.length - 1]?.time ?? 0 });
      return candles.map((c, i) => ({
        market: m,
        time: c.time,
        price: c.close,
        action: i === candles.length - 1 ? "buy" : i === 10 ? "sell" : "hold",
        score: i === candles.length - 1 ? 0.5 : 0,
        confidence: 0.5,
        regime: "range",
        atr: NaN,
        votes: [],
      }));
    },
    decisionsToMarkers: (decisions) =>
      decisions
        .filter((d) => d.action !== "hold")
        .map((d) => ({
          time: d.time,
          action: d.action as "buy" | "sell",
          price: d.price,
          score: d.score,
          label: d.action === "buy" ? "KOOP" : "VERKOOP",
        })),
    detectRegimes: (candles) => candles.map(() => "trend-up" as const),
    validateRiskConfig: (partial: Partial<RiskConfig>) => {
      const errors: string[] = [];
      if ((partial.riskPerTradePct ?? 1) > 5) errors.push("Risico per trade mag maximaal 5% zijn.");
      return { ok: errors.length === 0, errors };
    },
  };
  return { services, calls };
}

export class FakeEngine extends EventEmitter implements EngineLike {
  config: EngineConfig = structuredClone(DEFAULT_ENGINE_CONFIG);
  running = false;
  armed = false;
  resetCalls: number[] = [];
  closed: { id: string; reason?: ExitReason }[] = [];
  killed = 0;
  positions: OpenPositionView[] = [];
  trades: Trade[] = [];

  constructor(public mode: "paper" | "live" = "paper") {
    super();
  }
  get liveArmed(): boolean {
    return this.armed;
  }
  snapshot(): EngineSnapshot {
    return {
      running: this.running,
      mode: this.mode,
      dataSource: "simulated",
      liveArmed: this.armed,
      startedAt: null,
      lastTickAt: null,
      config: structuredClone(this.config),
      account: {
        startingEquity: 50,
        cashQuote: 50,
        equity: 50,
        dayStartEquity: 50,
        dayKey: "2026-09-28",
        realizedPnl: 0,
        realizedPnlToday: 0,
        unrealizedPnl: 0,
        feesPaid: 0,
        tradesToday: 0,
        lastLossAt: {},
      },
      positions: this.positions,
      trades: this.trades,
      equityHistory: [],
      decisions: {},
      prices: {},
      halted: { halted: false },
      logs: [],
    };
  }
  async start() {
    this.running = true;
  }
  async stop() {
    this.running = false;
  }
  updateConfig(partial: Partial<EngineConfig>): EngineConfig {
    this.config = { ...this.config, ...structuredClone(partial) };
    return structuredClone(this.config);
  }
  async closePosition(id: string, reason?: ExitReason): Promise<Trade | null> {
    const pos = this.positions.find((p) => p.id === id);
    if (!pos) return null;
    this.closed.push({ id, reason });
    this.positions = this.positions.filter((p) => p.id !== id);
    const trade: Trade = {
      id: "trd_1",
      market: pos.market,
      entryTime: pos.entryTime,
      exitTime: NOW,
      entryPrice: pos.entryPrice,
      exitPrice: pos.currentPrice,
      amount: pos.amount,
      costQuote: pos.costQuote,
      proceedsQuote: pos.costQuote,
      feesQuote: 0,
      pnlQuote: 0,
      pnlPct: 0,
      rMultiple: 0,
      exitReason: reason ?? "manual",
      candlesHeld: 0,
      entryReason: "",
    };
    this.trades.unshift(trade);
    return trade;
  }
  async killSwitch() {
    this.killed++;
    this.running = false;
  }
  arm() {
    this.armed = true;
  }
  disarm() {
    this.armed = false;
  }
  resetPaper(startingCapital: number) {
    this.resetCalls.push(startingCapital);
  }
}

export function makePosition(id: string, m = "BTC-EUR"): OpenPositionView {
  return {
    id,
    market: m,
    side: "long",
    entryTime: NOW - 3_600_000,
    entryPrice: 100,
    amount: 0.1,
    costQuote: 10,
    entryFeeQuote: 0.025,
    stopPrice: 95,
    initialStopPrice: 95,
    takeProfitPrice: 110,
    highestPrice: 101,
    candlesHeld: 3,
    entryReason: "test",
    currentPrice: 101,
    unrealizedPnl: 0.1,
    unrealizedPct: 1,
  };
}

export function makePublicDir(): string {
  const dir = mkdtempSync(join(tmpdir(), "bvt-public-"));
  writeFileSync(join(dir, "index.html"), "<!doctype html><title>Test</title>");
  mkdirSync(join(dir, "js"));
  writeFileSync(join(dir, "js", "app.js"), "export const x = 1;");
  mkdirSync(join(dir, "css"));
  writeFileSync(join(dir, "css", "base.css"), "body{}");
  writeFileSync(join(dir, "favicon.svg"), "<svg xmlns='http://www.w3.org/2000/svg'/>");
  writeFileSync(join(dir, ".secret"), "geheim");
  return dir;
}

export interface TestServer {
  base: string;
  port: number;
  engine: FakeEngine;
  feed: FakeFeed;
  calls: ReturnType<typeof makeServices>["calls"];
  persisted: EngineConfig[];
  config: AppConfig;
  server: RunningServer;
  close: () => Promise<void>;
}

export async function startTestServer(
  opts: {
    config?: Partial<AppConfig>;
    engine?: FakeEngine;
    feed?: FakeFeed;
    deps?: Partial<CreateAppDeps>;
  } = {},
): Promise<TestServer> {
  const config = makeConfig(opts.config);
  const engine = opts.engine ?? new FakeEngine(config.mode);
  const feed = opts.feed ?? new FakeFeed();
  const { services, calls } = makeServices();
  const persisted: EngineConfig[] = [];
  const app = createApp({
    config,
    engine,
    feed,
    services,
    now: () => NOW,
    persistConfig: (cfg) => persisted.push(cfg),
    log: () => {},
    publicDir: makePublicDir(),
    ...opts.deps,
  });
  const server = await startHttpServer(app, "127.0.0.1", 0);
  return {
    base: `http://127.0.0.1:${server.port}`,
    port: server.port,
    engine,
    feed,
    calls,
    persisted,
    config,
    server,
    close: () => server.close(),
  };
}

export async function json(
  base: string,
  method: string,
  path: string,
  body?: unknown,
  headers: Record<string, string> = {},
): Promise<{ status: number; data: any; headers: Headers }> {
  const res = await fetch(base + path, {
    method,
    headers: { ...(body !== undefined ? { "Content-Type": "application/json" } : {}), ...headers },
    body: body === undefined ? undefined : typeof body === "string" ? body : JSON.stringify(body),
  });
  const text = await res.text();
  let data: any = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = text;
  }
  return { status: res.status, data, headers: res.headers };
}

/** Ruwe HTTP-request zonder URL-normalisatie (voor traversal-tests). */
export function rawGet(
  port: number,
  path: string,
  headers: Record<string, string> = {},
): Promise<{ status: number; body: string; headers: Record<string, string | string[] | undefined> }> {
  return new Promise((resolve, reject) => {
    const req = httpRequest({ host: "127.0.0.1", port, path, method: "GET", headers }, (res) => {
      const chunks: Buffer[] = [];
      res.on("data", (c: Buffer) => chunks.push(c));
      res.on("end", () =>
        resolve({ status: res.statusCode ?? 0, body: Buffer.concat(chunks).toString("utf8"), headers: res.headers }),
      );
    });
    req.on("error", reject);
    req.end();
  });
}

/** Ruwe HTTP-request met eigen Host/Origin/Sec-Fetch-headers (fetch staat die niet altijd toe). */
export function rawRequest(
  port: number,
  method: string,
  path: string,
  headers: Record<string, string> = {},
  body?: string,
): Promise<{ status: number; body: string; headers: Record<string, string | string[] | undefined> }> {
  return new Promise((resolve, reject) => {
    const allHeaders: Record<string, string> = { ...headers };
    if (body !== undefined) {
      allHeaders["Content-Type"] ??= "application/json";
      allHeaders["Content-Length"] = String(Buffer.byteLength(body));
    }
    const req = httpRequest({ host: "127.0.0.1", port, path, method, headers: allHeaders }, (res) => {
      const chunks: Buffer[] = [];
      res.on("data", (c: Buffer) => chunks.push(c));
      res.on("end", () =>
        resolve({ status: res.statusCode ?? 0, body: Buffer.concat(chunks).toString("utf8"), headers: res.headers }),
      );
    });
    req.on("error", reject);
    req.end(body);
  });
}
