/**
 * Inline fakes voor de engine-tests: scriptbare feed, broker, beslissingen en
 * risk manager + een bestuurbare klok. Geen afhankelijkheid van andere modules.
 */
import { vi } from "vitest";
import { DEFAULT_ENGINE_CONFIG, DEFAULT_ENSEMBLE_CONFIG } from "../../src/core/defaults";
import type {
  AccountSnapshot,
  Balance,
  Broker,
  Candle,
  EngineConfig,
  EnsembleConfig,
  EnsembleDecision,
  EntryPlan,
  HaltStatus,
  Interval,
  MarketDataFeed,
  MarketInfo,
  MarketOrderRequest,
  OrderBook,
  OrderResult,
  Position,
  PositionUpdate,
  RiskConfig,
  RiskManagerLike,
  ServerEventType,
  SignalAction,
  Ticker24h,
  TradingMode,
  TrendFilterConfig,
  UniverseConfig,
} from "../../src/core/types";
import { TradingEngine, type EngineDeps } from "../../src/engine/tradingEngine";

export const I15 = 15 * 60_000;
/** Maandag 5 januari 2026 10:00 Amsterdam (09:00 UTC), uitgelijnd op 15m */
export const T0 = Date.UTC(2026, 0, 5, 9, 0, 0);

export class Clock {
  t: number;
  constructor(t: number) {
    this.t = t;
  }
  now = (): number => this.t;
  advance(ms: number): void {
    this.t += ms;
  }
  set(t: number): void {
    this.t = t;
  }
}

export function mkCandle(time: number, close: number, o: Partial<Candle> = {}): Candle {
  return {
    time,
    open: o.open ?? close,
    high: o.high ?? Math.max(close, o.open ?? close),
    low: o.low ?? Math.min(close, o.open ?? close),
    close,
    volume: o.volume ?? 1,
  };
}

export function marketInfo(market: string): MarketInfo {
  const [base, quote] = market.split("-");
  return {
    market,
    base,
    quote,
    status: "trading",
    minOrderQuote: 5,
    minOrderBase: 0,
    pricePrecision: 5,
    quantityDecimals: 8,
    notionalDecimals: 2,
  };
}

export class Deferred {
  promise: Promise<void>;
  resolve!: () => void;
  constructor() {
    this.promise = new Promise<void>((r) => (this.resolve = r));
  }
}

export class FakeFeed implements MarketDataFeed {
  readonly source = "simulated" as const;
  series = new Map<string, Candle[]>();
  /** Candles per `${market}|${interval}` (bijv. dagcandles voor het trendfilter); gaan vóór `series` */
  intervalSeries = new Map<string, Candle[]>();
  failing = new Set<string>();
  /** Alleen dit interval laten falen: `${market}|${interval}` */
  failingInterval = new Set<string>();
  calls: { market: string; interval: Interval; limit: number }[] = [];
  gate: Promise<void> | null = null;
  marketsFail = false;
  /** 24h-tickers (standaard geen) */
  tickers: Ticker24h[] = [];
  tickersFail = false;
  tickerCalls = 0;
  /** Orderboek per markt (standaard: een krappe spread van 0,02% rond de laatste koers) */
  books = new Map<string, OrderBook>();
  bookFail = new Set<string>();
  bookCalls: { market: string; depth?: number }[] = [];
  /** Extra markten voor getMarkets (bijv. een stablecoin zonder candles) */
  extraMarkets: MarketInfo[] = [];

  /** `n` candles van 15m met slotkoers `close`; de laatste heeft tijd `lastTime`. */
  setSeries(market: string, close: number, lastTime: number, n = 60): void {
    const arr: Candle[] = [];
    for (let i = n - 1; i >= 0; i--) arr.push(mkCandle(lastTime - i * I15, close));
    this.series.set(market, arr);
  }

  /** Past de laatste (vormende) candle aan. */
  setLast(market: string, close: number, o: Partial<Candle> = {}): void {
    const arr = this.series.get(market)!;
    const last = arr[arr.length - 1];
    arr[arr.length - 1] = mkCandle(last.time, close, o);
  }

  /** Voegt een nieuwe (vormende) candle toe na de huidige laatste. */
  append(market: string, close: number, o: Partial<Candle> = {}): Candle {
    const arr = this.series.get(market)!;
    const c = mkCandle(arr[arr.length - 1].time + I15, close, o);
    arr.push(c);
    return c;
  }

  lastTime(market: string): number {
    const arr = this.series.get(market)!;
    return arr[arr.length - 1].time;
  }

  async getMarkets(): Promise<MarketInfo[]> {
    if (this.marketsFail) throw new Error("markets down");
    return [...[...this.series.keys()].map(marketInfo), ...this.extraMarkets];
  }

  async getCandles(market: string, interval: Interval, limit: number): Promise<Candle[]> {
    this.calls.push({ market, interval, limit });
    if (this.gate) await this.gate;
    if (this.failing.has(market) || this.failingInterval.has(`${market}|${interval}`)) {
      throw new Error(`HTTP 503 voor ${market}`);
    }
    const src = this.intervalSeries.get(`${market}|${interval}`) ?? this.series.get(market) ?? [];
    return src.slice(-limit).map((c) => ({ ...c }));
  }

  /** Candles op een eigen interval (bijv. "1d" voor het trendfilter): slotkoersen oplopend, de laatste opent op `lastTime`. */
  setIntervalSeries(market: string, interval: Interval, closes: number[], lastTime: number, ms: number): void {
    const n = closes.length;
    this.intervalSeries.set(
      `${market}|${interval}`,
      closes.map((c, i) => mkCandle(lastTime - (n - 1 - i) * ms, c)),
    );
  }

  async getHistory(): Promise<Candle[]> {
    return [];
  }

  async getTickers24h(): Promise<Ticker24h[]> {
    this.tickerCalls++;
    if (this.tickersFail) throw new Error("tickers down");
    return this.tickers.map((t) => ({ ...t }));
  }

  async getPrice(market: string): Promise<number> {
    const arr = this.series.get(market);
    if (!arr?.length) throw new Error("geen koers");
    return arr[arr.length - 1].close;
  }

  async getOrderBook(market: string, depth?: number): Promise<OrderBook> {
    this.bookCalls.push({ market, depth });
    if (this.bookFail.has(market)) throw new Error(`orderboek ${market} niet beschikbaar`);
    const own = this.books.get(market);
    if (own) return own;
    const arr = this.series.get(market);
    const px = arr?.length ? arr[arr.length - 1].close : 1;
    return { market, bids: [[px * 0.9999, 1]], asks: [[px * 1.0001, 1]], timestamp: 0 };
  }
}

/** FakeFeed mét `getPrices` (één verzoek voor alle koersen), zoals BitvavoFeed/SimulatedFeed in v2. */
export class BulkFeed extends FakeFeed {
  priceCalls = 0;
  pricesFail = false;
  /** Koersen die afwijken van de laatste candle */
  priceOverride = new Map<string, number>();

  async getPrices(): Promise<Record<string, number>> {
    this.priceCalls++;
    if (this.pricesFail) throw new Error("prijzen down");
    const out: Record<string, number> = {};
    for (const [m, arr] of this.series) if (arr.length) out[m] = arr[arr.length - 1].close;
    for (const [m, p] of this.priceOverride) out[m] = p;
    return out;
  }
}

/** 24h-ticker voor tests. */
export function ticker(market: string, o: Partial<Ticker24h> = {}): Ticker24h {
  const last = o.last ?? 100;
  return {
    market,
    last,
    open: o.open ?? last,
    high: o.high ?? last,
    low: o.low ?? last,
    volume: o.volume ?? 1000,
    volumeQuote: o.volumeQuote ?? 1_000_000,
    bid: o.bid === undefined ? last * 0.9999 : o.bid,
    ask: o.ask === undefined ? last * 1.0001 : o.ask,
    changePct: o.changePct ?? 0,
    timestamp: o.timestamp ?? 0,
  };
}

export class FakeBroker implements Broker {
  readonly mode: TradingMode;
  fee: number;
  /** Vulprijs = referentie × (1 + slip) bij buy, × (1 − slip) bij sell */
  slip = 0;
  rejectBuys = 0;
  rejectSells = 0;
  throwOnOrder = false;
  orders: { req: MarketOrderRequest; ref: number; res: OrderResult }[] = [];
  balances = new Map<string, number>();
  /** Saldo dat vastzit in openstaande orders (per symbool) */
  inOrder = new Map<string, number>();
  /** Optioneel: order opzoeken op clientOrderId (null = bevestigd niet gevonden, throw = onbekend) */
  lookupOrder?: (market: string, clientOrderId: string) => Promise<OrderResult | null>;
  /** Tijdelijk leeg antwoord van GET /balance simuleren */
  emptyBalances = false;
  restored: Balance[] | null = null;
  resetTo: number | null = null;
  private seq = 0;

  constructor(mode: TradingMode = "paper", eur = 1000, fee = 0.0025) {
    this.mode = mode;
    this.fee = fee;
    this.balances.set("EUR", eur);
  }

  async getBalances(): Promise<Balance[]> {
    if (this.emptyBalances) return [];
    const symbols = new Set([...this.balances.keys(), ...this.inOrder.keys()]);
    return [...symbols].map((symbol) => ({
      symbol,
      available: this.balances.get(symbol) ?? 0,
      inOrder: this.inOrder.get(symbol) ?? 0,
    }));
  }

  /** Gescripte antwoorden (FIFO) die voorrang krijgen op het standaardgedrag */
  script: ((req: MarketOrderRequest, ref: number) => OrderResult)[] = [];

  async placeMarketOrder(req: MarketOrderRequest, ref: number): Promise<OrderResult> {
    if (this.throwOnOrder) throw new Error("netwerkfout");
    const scripted = this.script.shift();
    if (scripted) {
      const r = scripted(req, ref);
      this.orders.push({ req, ref, res: r });
      return r;
    }
    const base = req.market.split("-")[0];
    const common = {
      orderId: `ord-${++this.seq}`,
      clientOrderId: req.clientOrderId,
      market: req.market,
      side: req.side,
      timestamp: 0,
    };
    let res: OrderResult;
    if (req.side === "buy") {
      if (this.rejectBuys > 0) {
        this.rejectBuys--;
        res = { ...common, status: "rejected", filledAmount: 0, filledQuote: 0, avgPrice: 0, feeQuote: 0, error: "Onvoldoende saldo" };
      } else {
        const q = req.amountQuote!;
        const fee = q - q / (1 + this.fee);
        const px = ref * (1 + this.slip);
        const amount = (q - fee) / px;
        this.balances.set("EUR", (this.balances.get("EUR") ?? 0) - q);
        this.balances.set(base, (this.balances.get(base) ?? 0) + amount);
        res = { ...common, status: "filled", filledAmount: amount, filledQuote: amount * px, avgPrice: px, feeQuote: fee };
      }
    } else if (this.rejectSells > 0) {
      this.rejectSells--;
      res = { ...common, status: "rejected", filledAmount: 0, filledQuote: 0, avgPrice: 0, feeQuote: 0, error: "Markt tijdelijk gesloten" };
    } else {
      const amount = req.amount!;
      const px = ref * (1 - this.slip);
      const gross = amount * px;
      const fee = gross * this.fee;
      this.balances.set(base, (this.balances.get(base) ?? 0) - amount);
      this.balances.set("EUR", (this.balances.get("EUR") ?? 0) + gross - fee);
      res = { ...common, status: "filled", filledAmount: amount, filledQuote: gross, avgPrice: px, feeQuote: fee };
    }
    this.orders.push({ req, ref, res });
    return res;
  }

  restore(balances: Balance[]): void {
    this.restored = balances;
    this.balances = new Map(balances.map((b) => [b.symbol, b.available]));
  }

  reset(startingQuote: number): void {
    this.resetTo = startingQuote;
    this.balances = new Map([["EUR", startingQuote]]);
  }

  buys() {
    return this.orders.filter((o) => o.req.side === "buy");
  }

  sells() {
    return this.orders.filter((o) => o.req.side === "sell");
  }
}

/** Scriptbare beslissingen: per candle-tijd een actie. */
export class Signals {
  buyAt = new Set<number>();
  sellAt = new Set<number>();
  /** Alleen deze markten geven een koopsignaal op `buyAt` (null = alle markten) */
  buyMarkets: Set<string> | null = null;
  /** Score per markt bij een koopsignaal (standaard 0,52) */
  scores = new Map<string, number>();
  throwOnce = false;
  atr = 100;
  decide = vi.fn((market: string, candles: Candle[], _cfg: EnsembleConfig): EnsembleDecision[] => {
    if (this.throwOnce) {
      this.throwOnce = false;
      throw new Error("strategie kapot");
    }
    return candles.map((c) => {
      const buy = this.buyAt.has(c.time) && (this.buyMarkets === null || this.buyMarkets.has(market));
      const action: SignalAction = buy ? "buy" : this.sellAt.has(c.time) ? "sell" : "hold";
      return {
        market,
        time: c.time,
        price: c.close,
        action,
        score: action === "buy" ? (this.scores.get(market) ?? 0.52) : action === "sell" ? -0.5 : 0,
        confidence: 0.6,
        regime: "trend-up",
        atr: this.atr,
        votes:
          action === "buy"
            ? [
                { strategy: "ema-trend", action: "buy", confidence: 0.8, reason: "EMA 9 boven EMA 21" },
                { strategy: "breakout", action: "buy", confidence: 0.6, reason: "Uitbraak boven 20-candle high" },
                { strategy: "rsi-reversion", action: "hold", confidence: 0, reason: "" },
              ]
            : [],
      };
    });
  });
}

export class StubRisk implements RiskManagerLike {
  quote = 20;
  stopDist = 1000;
  tpDist = 2000;
  approve = true;
  rejectReasons = ["Maximum aantal trades per dag bereikt (6/6)"];
  halted = false;
  planCalls: { decision: EnsembleDecision; account: AccountSnapshot; market: MarketInfo | undefined; now: number }[] = [];
  updateCalls: { pos: Position; candle: Candle; atr: number; closed: boolean }[] = [];
  cfg: RiskConfig | null = null;
  interval: Interval | null = null;

  planEntry(decision: EnsembleDecision, account: AccountSnapshot, market: MarketInfo | undefined, now: number): EntryPlan {
    this.planCalls.push({ decision, account, market, now });
    const entry = decision.price;
    return {
      approved: this.approve,
      reasons: this.approve ? [] : [...this.rejectReasons],
      market: decision.market,
      quoteAmount: this.approve ? Math.min(this.quote, account.cashQuote) : 0,
      expectedEntryPrice: entry,
      stopPrice: entry - this.stopDist,
      takeProfitPrice: entry + this.tpDist,
      riskQuote: this.approve ? 0.4 : 0,
    };
  }

  updatePosition(pos: Position, candle: Candle, atr: number, closed: boolean): PositionUpdate {
    this.updateCalls.push({ pos: { ...pos }, candle: { ...candle }, atr, closed });
    const highestPrice = Math.max(pos.highestPrice, candle.high);
    if (candle.low <= pos.stopPrice) {
      return { exit: true, exitReason: "stop-loss", exitPrice: pos.stopPrice, stopPrice: pos.stopPrice, highestPrice };
    }
    if (candle.high >= pos.takeProfitPrice) {
      return { exit: true, exitReason: "take-profit", exitPrice: pos.takeProfitPrice, stopPrice: pos.stopPrice, highestPrice };
    }
    return { exit: false, stopPrice: pos.stopPrice, highestPrice };
  }

  shouldExitOnSignal(_pos: Position, decision: EnsembleDecision): boolean {
    return decision.action === "sell";
  }

  haltStatus(_account: AccountSnapshot): HaltStatus {
    return this.halted ? { halted: true, reason: "Dagelijkse verlieslimiet bereikt (-5,0%)" } : { halted: false };
  }
}

/**
 * v2: de standaardinstellingen kiezen munten automatisch en hebben een marktfilter.
 * De bestaande tests gaan uit van precies de ingestelde markten zonder trendfilter
 * (tests die de v2-functies testen zetten ze zelf aan).
 */
export const TEST_UNIVERSE: UniverseConfig = { mode: "manual", count: 30, minVolumeEur: 0 };
export const NO_TREND_FILTER: TrendFilterConfig = { market: false, coin: false, interval: "1d", period: 50 };

export function testConfig(over: Partial<EngineConfig> = {}): EngineConfig {
  return structuredClone({
    ...DEFAULT_ENGINE_CONFIG,
    markets: ["BTC-EUR"],
    interval: "15m" as Interval,
    pollMs: 15_000,
    historyCandles: 50,
    universe: TEST_UNIVERSE,
    ensemble: { ...DEFAULT_ENSEMBLE_CONFIG, trendFilter: NO_TREND_FILTER },
    ...over,
  });
}

export const EVENT_TYPES: ServerEventType[] = [
  "snapshot",
  "price",
  "candle",
  "decision",
  "order",
  "position-opened",
  "position-closed",
  "log",
];

export interface Harness {
  engine: TradingEngine;
  feed: FakeFeed;
  broker: FakeBroker;
  risk: StubRisk;
  signals: Signals;
  clock: Clock;
  createRisk: ReturnType<typeof vi.fn>;
  events: { type: ServerEventType; data: any }[];
  of: (type: ServerEventType) => any[];
  logs: () => string[];
  /** Tijd van de laatste gesloten candle bij de huidige klok */
  lastClosed: () => number;
}

export function setup(
  opts: {
    mode?: TradingMode;
    startingCapital?: number;
    markets?: string[];
    config?: Partial<EngineConfig>;
    deps?: Partial<EngineDeps>;
    broker?: FakeBroker;
    feed?: FakeFeed;
    clock?: Clock;
  } = {},
): Harness {
  const mode = opts.mode ?? "paper";
  const markets = opts.markets ?? ["BTC-EUR"];
  const clock = opts.clock ?? new Clock(T0 + 60_000);
  const feed = opts.feed ?? new FakeFeed();
  if (!opts.feed) {
    markets.forEach((m, i) => feed.setSeries(m, i === 0 ? 50_000 : 3_000, T0));
  }
  const broker = opts.broker ?? new FakeBroker(mode);
  const risk = new StubRisk();
  const signals = new Signals();
  const createRisk = vi.fn((cfg: RiskConfig, interval: Interval) => {
    risk.cfg = cfg;
    risk.interval = interval;
    return risk;
  });
  const engine = new TradingEngine({
    feed,
    broker,
    mode,
    config: testConfig({ markets, ...(opts.config ?? {}) }),
    startingCapital: opts.startingCapital ?? 100,
    now: clock.now,
    decide: signals.decide,
    createRisk,
    ...(opts.deps ?? {}),
  });
  const events: { type: ServerEventType; data: any }[] = [];
  for (const type of EVENT_TYPES) engine.on(type, (data: unknown) => events.push({ type, data }));
  return {
    engine,
    feed,
    broker,
    risk,
    signals,
    clock,
    createRisk,
    events,
    of: (type) => events.filter((e) => e.type === type).map((e) => e.data),
    logs: () => engine.snapshot().logs.map((l) => l.message),
    lastClosed: () => {
      const arr = feed.series.get(markets[0])!;
      const closed = arr.filter((c) => c.time + I15 <= clock.t);
      return closed[closed.length - 1].time;
    },
  };
}

/** Opent een BTC-EUR positie via een koopsignaal op de laatste gesloten candle. */
export async function openBtcPosition(h: Harness): Promise<Position> {
  h.signals.buyAt.add(h.lastClosed());
  await h.engine.tick();
  const pos = h.engine.snapshot().positions.find((p) => p.market === "BTC-EUR");
  if (!pos) throw new Error("positie niet geopend");
  return pos;
}
