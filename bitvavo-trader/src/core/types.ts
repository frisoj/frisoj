/**
 * Gedeelde types voor de hele applicatie. Dit bestand is het contract tussen
 * alle modules (exchange, data, indicators, strategies, risk, backtest,
 * broker, engine, server en de dashboard-API). Wijzig hier niets zonder alle
 * gebruikers mee te nemen.
 *
 * Conventies:
 * - Alle tijden zijn Unix-epoch in MILLISECONDEN (UTC).
 * - Bedragen in de quote-valuta (EUR) heten `...Quote`.
 * - Hoeveelheden in de base-valuta (BTC, ETH, ...) heten `amount`.
 * - Percentages als `...Pct` zijn echte procenten (1.5 = 1,5%).
 * - Fracties (fees, slippage) zijn fracties (0.0025 = 0,25%).
 */

// ─────────────────────────────── Marktdata ───────────────────────────────

export type Interval =
  | "1m"
  | "5m"
  | "15m"
  | "30m"
  | "1h"
  | "2h"
  | "4h"
  | "6h"
  | "8h"
  | "12h"
  | "1d";

export const INTERVALS: readonly Interval[] = [
  "1m",
  "5m",
  "15m",
  "30m",
  "1h",
  "2h",
  "4h",
  "6h",
  "8h",
  "12h",
  "1d",
];

const MIN = 60_000;
export const INTERVAL_MS: Record<Interval, number> = {
  "1m": MIN,
  "5m": 5 * MIN,
  "15m": 15 * MIN,
  "30m": 30 * MIN,
  "1h": 60 * MIN,
  "2h": 120 * MIN,
  "4h": 240 * MIN,
  "6h": 360 * MIN,
  "8h": 480 * MIN,
  "12h": 720 * MIN,
  "1d": 1440 * MIN,
};

/** OHLCV-candle. `time` = openingstijd van de candle in ms. */
export interface Candle {
  time: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

export interface MarketInfo {
  /** Bijv. "BTC-EUR" */
  market: string;
  base: string;
  quote: string;
  /** "trading" | "halted" | "auction" | ... */
  status: string;
  /** Minimale orderwaarde in quote (EUR), Bitvavo: meestal 5 */
  minOrderQuote: number;
  /** Minimale orderhoeveelheid in base */
  minOrderBase: number;
  /** Legacy Bitvavo: aantal significante cijfers voor prijzen (meestal 5) */
  pricePrecision: number;
  /** Nieuwere Bitvavo-velden (optioneel): tick size voor prijzen */
  tickSize?: number;
  /** Aantal decimalen toegestaan voor `amount` (base) */
  quantityDecimals: number;
  /** Aantal decimalen toegestaan voor `amountQuote` (meestal 2) */
  notionalDecimals: number;
}

export interface Ticker24h {
  market: string;
  last: number;
  open: number;
  high: number;
  low: number;
  /** Volume in base */
  volume: number;
  /** Volume in quote (EUR) */
  volumeQuote: number;
  bid: number | null;
  ask: number | null;
  /** (last - open) / open * 100 */
  changePct: number;
  timestamp: number;
}

export interface OrderBook {
  market: string;
  /** [prijs, hoeveelheid], beste bid eerst */
  bids: [number, number][];
  /** [prijs, hoeveelheid], beste ask eerst */
  asks: [number, number][];
  timestamp: number;
}

export interface Balance {
  symbol: string;
  available: number;
  inOrder: number;
}

export type DataSource = "bitvavo" | "simulated";

/** Bron van marktdata. Implementaties: BitvavoFeed, SimulatedFeed. */
export interface MarketDataFeed {
  readonly source: DataSource;
  /** Alle markten (alleen status "trading" hoeft niet: filteren doet de caller). */
  getMarkets(): Promise<MarketInfo[]>;
  /**
   * Recente candles, OPLOPEND gesorteerd op tijd. De laatste candle kan nog
   * "in vorming" zijn (time + INTERVAL_MS[interval] > nu).
   */
  getCandles(market: string, interval: Interval, limit: number): Promise<Candle[]>;
  /**
   * Historische candles in [fromMs, toMs], OPLOPEND, gepagineerd, zonder
   * duplicaten en ALLEEN gesloten candles.
   */
  getHistory(market: string, interval: Interval, fromMs: number, toMs: number): Promise<Candle[]>;
  /** 24h-tickers; zonder argument alle markten. */
  getTickers24h(markets?: string[]): Promise<Ticker24h[]>;
  getPrice(market: string): Promise<number>;
  getOrderBook(market: string, depth?: number): Promise<OrderBook>;
}

// ─────────────────────────────── Signalen ───────────────────────────────

export type StrategyId =
  | "ema-trend"
  | "rsi-reversion"
  | "breakout"
  | "macd-momentum"
  | "vwap-reversion";

export const STRATEGY_IDS: readonly StrategyId[] = [
  "ema-trend",
  "rsi-reversion",
  "breakout",
  "macd-momentum",
  "vwap-reversion",
];

export type SignalAction = "buy" | "sell" | "hold";

export type Regime = "trend-up" | "trend-down" | "range" | "volatile" | "unknown";

export interface StrategySignal {
  strategy: StrategyId;
  action: SignalAction;
  /** 0..1 */
  confidence: number;
  /** Korte Nederlandse uitleg, bijv. "EMA 9 kruist boven EMA 21" */
  reason: string;
}

export type StrategyParams = Record<string, number>;

export interface StrategyMeta {
  id: StrategyId;
  name: string;
  description: string;
  defaultParams: StrategyParams;
  /** Waarden per parameter die de optimizer mag proberen */
  paramSpace: Record<string, number[]>;
  /** Regimes waarin deze strategie het best werkt */
  preferredRegimes: Regime[];
}

export interface StrategyDefinition extends StrategyMeta {
  /** Aantal candles nodig voordat de strategie iets anders dan "hold" kan geven */
  warmup(params: StrategyParams): number;
  /**
   * Berekent in één keer een signaal voor ELKE candle-index.
   * Resultaat heeft exact `candles.length` elementen. result[i] mag alleen
   * candles[0..i] gebruiken (GEEN lookahead). Tijdens warmup: "hold".
   */
  run(candles: Candle[], params: StrategyParams): StrategySignal[];
}

export interface EnsembleConfig {
  enabled: StrategyId[];
  weights: Partial<Record<StrategyId, number>>;
  /** Parameter-overrides per strategie (ontbrekende keys → defaultParams) */
  params: Partial<Record<StrategyId, StrategyParams>>;
  /** score >= buyThreshold → "buy" (bijv. 0.35) */
  buyThreshold: number;
  /** score <= sellThreshold → "sell" (NEGATIEF getal, bijv. -0.3) */
  sellThreshold: number;
  /** Regimefilter: weeg strategieën buiten hun regime minder, geen buys in trend-down */
  regimeFilter: boolean;
}

export interface EnsembleDecision {
  market: string;
  /** Openingstijd van de geëvalueerde (gesloten) candle */
  time: number;
  /** Slotkoers van die candle */
  price: number;
  action: SignalAction;
  /** Gewogen score -1..1 */
  score: number;
  /** 0..1 */
  confidence: number;
  regime: Regime;
  /** ATR(14) op deze candle (in prijs-eenheden), NaN tijdens warmup */
  atr: number;
  votes: StrategySignal[];
}

// ─────────────────────────────── Risico ───────────────────────────────

export interface RiskConfig {
  /** % van equity dat je maximaal verliest als de stop geraakt wordt */
  riskPerTradePct: number;
  /** Max % van equity in één positie */
  maxPositionPct: number;
  maxOpenPositions: number;
  /** Max % van equity in alle posities samen */
  maxTotalExposurePct: number;
  /** Stop-loss afstand = stopAtrMult × ATR */
  stopAtrMult: number;
  /** Take-profit op takeProfitR × (entry - stop) boven entry */
  takeProfitR: number;
  /** Trailing stop = hoogste koers - trailingAtrMult × ATR (0 = uit) */
  trailingAtrMult: number;
  /** Stop naar break-even (entry + kosten) zodra winst >= breakEvenAtR × R (0 = uit) */
  breakEvenAtR: number;
  /** Stop met nieuwe trades als het dagverlies dit % van dag-start-equity bereikt */
  dailyLossLimitPct: number;
  maxTradesPerDay: number;
  /** Aantal candles wachten in een markt na een verliestrade */
  cooldownCandlesAfterLoss: number;
  /** Afstand naar take-profit moet >= dit × totale round-trip kosten zijn */
  minEdgeFeeMultiple: number;
  /** Bitvavo taker fee als fractie (0.0025 = 0,25%) */
  takerFee: number;
  makerFee: number;
  /** Verwachte slippage per kant als fractie */
  slippagePct: number;
  /** Minimale orderwaarde in EUR (wordt overschreven door MarketInfo) */
  minOrderQuote: number;
  /** Sluit positie na N candles als hij niet in de winst staat (0 = uit) */
  timeStopCandles: number;
}

export interface Position {
  id: string;
  market: string;
  side: "long";
  entryTime: number;
  /** Gemiddelde vulprijs (incl. slippage, excl. fee) */
  entryPrice: number;
  /** Hoeveelheid base in bezit */
  amount: number;
  /** Totaal uitgegeven EUR incl. fee */
  costQuote: number;
  entryFeeQuote: number;
  stopPrice: number;
  initialStopPrice: number;
  takeProfitPrice: number;
  /** Hoogste koers sinds entry (voor trailing stop) */
  highestPrice: number;
  /** Aantal GESLOTEN candles sinds entry */
  candlesHeld: number;
  /** Waarom gekocht (samenvatting van de stemmen) */
  entryReason: string;
  orderId?: string;
}

export type ExitReason =
  | "stop-loss"
  | "take-profit"
  | "trailing-stop"
  | "break-even"
  | "signal"
  | "time-stop"
  | "manual"
  | "kill-switch"
  | "end-of-backtest";

export interface Trade {
  id: string;
  market: string;
  entryTime: number;
  exitTime: number;
  entryPrice: number;
  exitPrice: number;
  amount: number;
  /** EUR uitgegeven incl. entry-fee */
  costQuote: number;
  /** EUR ontvangen na exit-fee */
  proceedsQuote: number;
  /** entry-fee + exit-fee */
  feesQuote: number;
  /** proceedsQuote - costQuote */
  pnlQuote: number;
  /** pnlQuote / costQuote * 100 */
  pnlPct: number;
  /** pnl / initieel risico (entry - initialStop) × amount */
  rMultiple: number;
  exitReason: ExitReason;
  candlesHeld: number;
  entryReason: string;
}

export interface AccountSnapshot {
  cashQuote: number;
  equity: number;
  dayStartEquity: number;
  tradesToday: number;
  realizedPnlToday: number;
  openPositions: Position[];
  /** Per markt: tijd (ms) van de laatste verliesgevende exit */
  lastLossAt: Record<string, number>;
}

export interface EntryPlan {
  approved: boolean;
  /** Nederlandse redenen waarom NIET (leeg als approved) of korte samenvatting */
  reasons: string[];
  market: string;
  /** EUR om uit te geven INCLUSIEF fee (amountQuote van de market-buy) */
  quoteAmount: number;
  expectedEntryPrice: number;
  stopPrice: number;
  takeProfitPrice: number;
  /** EUR verlies als de stop geraakt wordt (incl. kosten) */
  riskQuote: number;
}

export interface PositionUpdate {
  exit: boolean;
  exitReason?: ExitReason;
  /** Verwachte exitprijs (vóór slippage) als exit === true */
  exitPrice?: number;
  /** Nieuwe (eventueel verhoogde) stop; stops dalen NOOIT */
  stopPrice: number;
  highestPrice: number;
}

export interface HaltStatus {
  halted: boolean;
  reason?: string;
}

export interface RiskManagerLike {
  planEntry(
    decision: EnsembleDecision,
    account: AccountSnapshot,
    market: MarketInfo | undefined,
    now: number,
  ): EntryPlan;
  /**
   * Controleer stops/take-profit/trailing/break-even/time-stop tegen een candle.
   * `closedCandle` = true als dit een gesloten candle is (dan telt candlesHeld
   * mee voor de time-stop en wordt trailing opnieuw berekend met `atr`).
   */
  updatePosition(pos: Position, candle: Candle, atr: number, closedCandle: boolean): PositionUpdate;
  shouldExitOnSignal(pos: Position, decision: EnsembleDecision): boolean;
  haltStatus(account: AccountSnapshot): HaltStatus;
}

// ─────────────────────────────── Broker ───────────────────────────────

export type TradingMode = "paper" | "live";
export type Side = "buy" | "sell";

export interface MarketOrderRequest {
  market: string;
  side: Side;
  /** Voor buys: EUR om uit te geven INCLUSIEF fee */
  amountQuote?: number;
  /** Voor sells: hoeveelheid base */
  amount?: number;
  clientOrderId?: string;
}

export type OrderStatus =
  | "new"
  | "filled"
  | "partiallyFilled"
  | "cancelled"
  | "expired"
  | "rejected";

export interface OrderResult {
  orderId: string;
  clientOrderId?: string;
  market: string;
  side: Side;
  status: OrderStatus;
  /** Gevulde hoeveelheid base */
  filledAmount: number;
  /** filledAmount × avgPrice (BRUTO, excl. fee) */
  filledQuote: number;
  avgPrice: number;
  /** Betaalde fee in EUR */
  feeQuote: number;
  timestamp: number;
  error?: string;
}

export interface Broker {
  readonly mode: TradingMode;
  getBalances(): Promise<Balance[]>;
  /**
   * Plaatst een market order. `referencePrice` = laatst bekende koers (paper
   * broker vult hierop + slippage; live broker gebruikt hem als sanity check).
   * Gooit NIET bij een afwijzing maar geeft status "rejected" + error terug.
   */
  placeMarketOrder(req: MarketOrderRequest, referencePrice: number): Promise<OrderResult>;
}

// ─────────────────────────────── Engine ───────────────────────────────

export interface EngineConfig {
  markets: string[];
  interval: Interval;
  /** Hoe vaak de engine tickt (ms) */
  pollMs: number;
  /** Aantal candles dat per tick opgehaald wordt voor de strategieën */
  historyCandles: number;
  ensemble: EnsembleConfig;
  risk: RiskConfig;
}

export interface AccountState {
  startingEquity: number;
  cashQuote: number;
  equity: number;
  dayStartEquity: number;
  /** YYYY-MM-DD in Europe/Amsterdam */
  dayKey: string;
  realizedPnl: number;
  realizedPnlToday: number;
  unrealizedPnl: number;
  feesPaid: number;
  tradesToday: number;
  lastLossAt: Record<string, number>;
}

export interface OpenPositionView extends Position {
  currentPrice: number;
  /** Netto (na geschatte exit-fee) */
  unrealizedPnl: number;
  unrealizedPct: number;
}

export interface EquityPoint {
  time: number;
  equity: number;
}

export type LogLevel = "info" | "warn" | "error" | "trade";

export interface LogEntry {
  time: number;
  level: LogLevel;
  message: string;
}

export interface EngineSnapshot {
  running: boolean;
  mode: TradingMode;
  dataSource: DataSource;
  /** Alleen relevant in live mode: pas na "armen" worden echte orders geplaatst */
  liveArmed: boolean;
  startedAt: number | null;
  lastTickAt: number | null;
  config: EngineConfig;
  account: AccountState;
  positions: OpenPositionView[];
  /** Laatste 200 gesloten trades, nieuwste eerst */
  trades: Trade[];
  /** Max ~2000 punten, oplopend */
  equityHistory: EquityPoint[];
  /** Laatste beslissing per markt */
  decisions: Record<string, EnsembleDecision>;
  prices: Record<string, number>;
  halted: HaltStatus;
  /** Laatste 150 logregels, nieuwste eerst */
  logs: LogEntry[];
}

/** Wat de StateStore op schijf bewaart */
export interface PersistedState {
  version: 1;
  mode: TradingMode;
  savedAt: number;
  account: AccountState;
  positions: Position[];
  trades: Trade[];
  equityHistory: EquityPoint[];
  /** Balances van de paper broker (alleen paper mode) */
  paperBalances?: Balance[];
}

/**
 * Events die de engine uitstuurt (EventEmitter, eventnaam = `type`) en die de
 * server 1-op-1 als Server-Sent Events doorstuurt (`event: <type>`).
 */
export type ServerEvent =
  | { type: "snapshot"; data: EngineSnapshot }
  | { type: "price"; data: { market: string; price: number; time: number } }
  | { type: "candle"; data: { market: string; interval: Interval; candle: Candle } }
  | { type: "decision"; data: EnsembleDecision }
  | { type: "order"; data: OrderResult }
  | { type: "position-opened"; data: Position }
  | { type: "position-closed"; data: Trade }
  | { type: "log"; data: LogEntry };

export type ServerEventType = ServerEvent["type"];

// ─────────────────────────────── API DTO's ───────────────────────────────

/** Indicatorreeksen voor de grafiek, even lang als `candles`, null tijdens warmup */
export interface ChartIndicators {
  emaFast: (number | null)[];
  emaSlow: (number | null)[];
  ema200: (number | null)[];
  bbUpper: (number | null)[];
  bbMiddle: (number | null)[];
  bbLower: (number | null)[];
  vwap: (number | null)[];
  rsi: (number | null)[];
  macd: (number | null)[];
  macdSignal: (number | null)[];
  macdHist: (number | null)[];
  atr: (number | null)[];
}

export interface SignalMarker {
  time: number;
  action: "buy" | "sell";
  price: number;
  score: number;
  /** Korte tekst voor in de grafiek, bijv. "KOOP 0.52" of "TP +1.8%" */
  label: string;
}

/** GET /api/candles */
export interface CandlesResponse {
  market: string;
  interval: Interval;
  candles: Candle[];
  indicators: ChartIndicators;
  /** Ensemble-signalen (alleen buy/sell) binnen dit venster */
  signals: SignalMarker[];
  /** Laatste beslissing (op de laatste gesloten candle) */
  decision: EnsembleDecision | null;
  /** Gesloten trades van de engine voor deze markt */
  trades: Trade[];
  /** Open posities van de engine voor deze markt */
  positions: OpenPositionView[];
}

/** GET /api/scanner */
export interface ScannerRow {
  market: string;
  price: number;
  changePct24h: number;
  volumeQuote24h: number;
  /** ATR% op het engine-interval */
  volatilityPct: number;
  spreadPct: number | null;
  regime: Regime;
  action: SignalAction;
  score: number;
  rsi: number | null;
  /** Kleine koersreeks (laatste ~48 slotkoersen) voor een sparkline */
  sparkline: number[];
}

export interface BacktestRequest {
  market: string;
  interval: Interval;
  /** Aantal dagen terug vanaf nu */
  days: number;
  initialCapital?: number;
  ensemble?: Partial<EnsembleConfig>;
  risk?: Partial<RiskConfig>;
}

export interface BacktestMetrics {
  finalEquity: number;
  totalReturnPct: number;
  /** Buy & hold van dezelfde markt, zelfde periode, incl. 1× fee in en uit */
  buyHoldReturnPct: number;
  maxDrawdownPct: number;
  /** Geannualiseerd, op basis van candle-returns */
  sharpe: number;
  sortino: number;
  /** totalReturn / maxDrawdown (0 als geen drawdown) */
  calmar: number;
  trades: number;
  winRatePct: number;
  /** bruto winst / bruto verlies (Infinity-safe: 999 als geen verlies) */
  profitFactor: number;
  avgTradePct: number;
  avgWinPct: number;
  avgLossPct: number;
  /** Gemiddelde PnL per trade in EUR */
  expectancyQuote: number;
  feesPaid: number;
  /** % van de tijd dat er een positie open stond */
  exposurePct: number;
  bestTradePct: number;
  worstTradePct: number;
  avgCandlesHeld: number;
}

export interface EquityCurvePoint {
  time: number;
  equity: number;
  /** Buy & hold equity met hetzelfde startkapitaal */
  benchmark: number;
  /** Drawdown t.o.v. piek, <= 0 (bijv. -3.2) */
  drawdownPct: number;
}

export interface BacktestResult {
  market: string;
  interval: Interval;
  dataSource: DataSource;
  from: number;
  to: number;
  candlesCount: number;
  initialCapital: number;
  metrics: BacktestMetrics;
  trades: Trade[];
  equityCurve: EquityCurvePoint[];
  /** Candles voor de grafiek (max ~1500, gedownsampled indien nodig) */
  candles: Candle[];
  markers: SignalMarker[];
  durationMs: number;
}

export type OptimizeObjective = "sharpe" | "return" | "profitFactor" | "calmar";

export interface OptimizeRequest extends BacktestRequest {
  /** Optimaliseer de params van één strategie; zonder: ensemble-drempels + risk */
  strategy?: StrategyId;
  objective: OptimizeObjective;
  maxCombos?: number;
}

export interface OptimizationRow {
  /** Keys zoals "ema-trend.fast", "ensemble.buyThreshold", "risk.stopAtrMult" */
  params: Record<string, number>;
  metrics: BacktestMetrics;
  score: number;
}

export interface Heatmap {
  xParam: string;
  yParam: string;
  xValues: number[];
  yValues: number[];
  /** values[yIndex][xIndex] = beste score voor die combinatie (null = niet getest) */
  values: (number | null)[][];
}

export interface OptimizationResult {
  objective: OptimizeObjective;
  /** Aflopend op score, max 50 */
  rows: OptimizationRow[];
  best: OptimizationRow | null;
  combosTested: number;
  heatmap: Heatmap | null;
  durationMs: number;
}

export interface WalkForwardRequest extends OptimizeRequest {
  folds: number;
  /** Deel van elk venster voor training, bijv. 0.7 */
  trainRatio: number;
}

export interface WalkForwardFold {
  index: number;
  trainFrom: number;
  trainTo: number;
  testFrom: number;
  testTo: number;
  bestParams: Record<string, number>;
  trainMetrics: BacktestMetrics;
  testMetrics: BacktestMetrics;
}

export interface WalkForwardResult {
  folds: WalkForwardFold[];
  /** Metrics over alle aan elkaar geplakte out-of-sample periodes */
  oosMetrics: BacktestMetrics;
  oosEquityCurve: EquityCurvePoint[];
  /** Eerlijk Nederlandstalig oordeel, bijv. "Out-of-sample verliesgevend: niet live gaan." */
  verdict: string;
  durationMs: number;
}

/** GET /api/info: statische info over de omgeving */
export interface AppInfo {
  mode: TradingMode;
  dataSource: DataSource;
  hasApiKeys: boolean;
  /** Live mode vereist expliciet "armen" via de UI */
  liveArmed: boolean;
  capitalLimitQuote: number;
  version: string;
}
