# Architectuur & modulecontract

This document is the binding contract between modules. It is written for the
developers (and agents) who build the modules in parallel. All shared types
live in `src/core/types.ts`, defaults in `src/core/defaults.ts`. **Do not edit
those two files** — if you believe the contract needs a change, work around it
locally and mention it in your final report.

Runtime: Node 22+, TypeScript run via `tsx` (ESM, `"type": "module"`).
Imports inside `src/` are extensionless relative imports (e.g.
`import { ema } from "../indicators"`). No path aliases. No new npm
dependencies without a very good reason (Node 22 has global `fetch`,
`WebSocket`, `crypto`, `EventSource` is NOT available in Node).

User-facing text (UI, log messages, reasons, errors shown in the dashboard) is
**Dutch**. Code identifiers and code comments may be English or Dutch.

Shared helpers already written (do not modify, just use): `src/core/util.ts` —
`dayKey(ms)` (YYYY-MM-DD Europe/Amsterdam, for daily limits), `newId(prefix)`,
`clamp`, `isClosedCandle(candle, interval, now)`, `closedCandles(candles, interval, now)`,
`sleep`, `mulberry32(seed)` (deterministic PRNG), `hashString(s)`.

## Data flow

```
                ┌──────────────┐    candles     ┌──────────────┐
 Bitvavo REST ─▶│ BitvavoFeed  │──────────────▶│              │
 (or simulator) │ SimulatedFeed│               │ TradingEngine│── events ──▶ SSE ──▶ dashboard
                └──────────────┘               │  (per tick)  │
                                               │  runEnsemble │◀── strategies ◀── indicators
                                               │  RiskManager │
                                               │  Broker      │──▶ PaperBroker / LiveBroker ──▶ BitvavoClient
                                               └──────────────┘
 Backtester uses the SAME runEnsemble + RiskManager on historical candles.
```

## Signal timing (no lookahead — everyone must respect this)

* A strategy's `run(candles)` returns one signal per index; `signal[i]` may only
  use `candles[0..i]` (the close of candle i is known).
* Backtest: the decision on candle `i` is executed at the **open of candle
  i+1** (plus slippage, plus taker fee). Stops/take-profits are checked on each
  candle's high/low starting from the candle after entry. If both stop and
  take-profit are hit inside one candle, assume the **stop** was hit first.
  Exits are checked starting with the entry candle (i+1) itself, because the
  entry happened at its open. Gaps: if a candle opens below the stop, the exit
  price is the open (and above the take-profit: the open).
* `Position.candlesHeld`: the CALLER (backtester / engine) increments it for
  every new closed candle **before** calling
  `risk.updatePosition(pos, candle, atr, /*closedCandle*/ true)`. The risk
  manager never mutates the position; it returns a `PositionUpdate` and the
  caller applies `stopPrice` / `highestPrice`.
* Live engine: exit checks on a closed candle only use candles whose
  `time >= pos.entryTime` (the part of a candle before the entry must not
  trigger a stop). Between candles the engine checks the latest price every
  tick with a synthetic candle `{open=high=low=close=price}` and
  `closedCandle=false`.
* Live/paper engine: only evaluates **closed** candles (a candle is closed when
  `time + INTERVAL_MS[interval] <= now`). It executes immediately at market.

## Module ownership & exact exports

### A1 — Exchange client + live broker
* `src/exchange/errors.ts` — `export class BitvavoApiError extends Error { status: number; errorCode: number | null }`
* `src/exchange/signing.ts` — `export function signRequest(secret: string, timestamp: number, method: string, pathWithQuery: string, body: string): string`
  (HMAC-SHA256 hex over `timestamp + METHOD + "/v2" + path + body`; `pathWithQuery` passed here already starts with `/v2`).
* `src/exchange/precision.ts` — `roundPrice(price: number, m: MarketInfo, mode?: "down"|"up"|"nearest"): number`,
  `roundAmount(amount: number, m: MarketInfo): number` (floors), `roundQuote(q: number, m: MarketInfo): number` (floors),
  `toSignificant(value: number, digits: number, mode?): number`, `formatDecimal(value: number, decimals: number): string` (no exponent notation — Bitvavo rejects `1e-7`).
* `src/exchange/bitvavoClient.ts` — `export class BitvavoClient`:
  ```ts
  constructor(opts?: { apiKey?: string; apiSecret?: string; baseUrl?: string; accessWindow?: number;
                       operatorId?: number; fetchImpl?: typeof fetch; now?: () => number; timeoutMs?: number })
  readonly hasCredentials: boolean
  rateLimitRemaining: number | null
  time(): Promise<number>
  markets(): Promise<MarketInfo[]>
  candles(market: string, interval: Interval, opts?: { limit?: number; start?: number; end?: number }): Promise<Candle[]> // ASCENDING
  ticker24h(market?: string): Promise<Ticker24h[]>
  tickerPrice(market?: string): Promise<{ market: string; price: number }[]>
  book(market: string, depth?: number): Promise<OrderBook>
  balance(): Promise<Balance[]>
  account(): Promise<{ takerFee: number; makerFee: number; volume: number }>
  placeOrder(p: { market: string; side: Side; orderType: "market" | "limit"; amount?: number; amountQuote?: number;
                  price?: number; clientOrderId?: string; timeInForce?: "GTC" | "IOC" | "FOK"; postOnly?: boolean }): Promise<BitvavoOrder>
  getOrder(market: string, orderId: string): Promise<BitvavoOrder>
  cancelOrder(market: string, orderId: string): Promise<void>
  openOrders(market?: string): Promise<BitvavoOrder[]>
  ```
  `BitvavoOrder` is exported from `bitvavoClient.ts` (raw-ish order shape with numbers parsed).
* `src/broker/liveBroker.ts` — `export class LiveBroker implements Broker` (`mode = "live"`):
  `constructor(client: BitvavoClient, opts?: { getMarketInfo?: (market: string) => Promise<MarketInfo | undefined>; maxSlippagePct?: number })`.
* Tests: `tests/exchange/*.test.ts` (mocked `fetchImpl`, no network).

### A2 — Indicators
* `src/indicators/index.ts` re-exports everything. All functions are pure and
  return arrays **the same length as the input**, with `NaN` during warmup.
  ```ts
  sma(values: number[], period: number): number[]
  ema(values: number[], period: number): number[]
  stdev(values: number[], period: number): number[]
  rsi(closes: number[], period?: number /*14*/): number[]            // Wilder smoothing
  macd(closes: number[], fast?: 12, slow?: 26, signal?: 9): { macd: number[]; signal: number[]; histogram: number[] }
  bollinger(closes: number[], period?: 20, mult?: 2): { upper: number[]; middle: number[]; lower: number[]; bandwidth: number[]; percentB: number[] }
  atr(candles: Candle[], period?: 14): number[]                       // Wilder
  adx(candles: Candle[], period?: 14): { adx: number[]; plusDI: number[]; minusDI: number[] }
  donchian(candles: Candle[], period: number): { upper: number[]; lower: number[]; middle: number[] } // of the PREVIOUS `period` candles (excludes candle i)
  vwap(candles: Candle[]): number[]                                   // session VWAP, resets at 00:00 UTC
  stochastic(candles: Candle[], kPeriod?: 14, dPeriod?: 3): { k: number[]; d: number[] }
  obv(candles: Candle[]): number[]
  rollingMax(values: number[], period: number): number[]
  rollingMin(values: number[], period: number): number[]
  closes(candles: Candle[]): number[]
  chartIndicators(candles: Candle[]): ChartIndicators  // emaFast=EMA9, emaSlow=EMA21, ema200, BB(20,2), vwap, RSI14, MACD(12,26,9), ATR14; NaN → null
  ```
* Tests: `tests/indicators/*.test.ts`.

### A3 — Strategies, regime detection, ensemble
* `src/strategies/emaTrend.ts`, `rsiReversion.ts`, `breakout.ts`, `macdMomentum.ts`, `vwapReversion.ts` — each `export const <name>: StrategyDefinition`.
* `src/strategies/index.ts` — `export const STRATEGIES: Record<StrategyId, StrategyDefinition>`, `export function listStrategies(): StrategyMeta[]` (no functions, JSON-safe), `export function getStrategy(id: StrategyId): StrategyDefinition`, `export function resolveParams(id: StrategyId, overrides?: StrategyParams): StrategyParams`.
* `src/strategies/regime.ts` — `export function detectRegimes(candles: Candle[]): Regime[]` (same length, "unknown" during warmup).
* `src/strategies/ensemble.ts` —
  `export function runEnsemble(market: string, candles: Candle[], cfg: EnsembleConfig): EnsembleDecision[]` (same length as candles),
  `export function latestDecision(market: string, candles: Candle[], cfg: EnsembleConfig): EnsembleDecision | null`,
  `export function decisionsToMarkers(decisions: EnsembleDecision[]): SignalMarker[]` (only buy/sell, de-duplicated so consecutive identical actions yield one marker),
  `export function classify(score: number, regime: Regime, cfg: EnsembleConfig): SignalAction` (the single source of truth for score → action incl. the regime filter; the optimizer uses it to re-threshold cached decisions).
* Tests: `tests/strategies/*.test.ts`.

### A4 — Risk manager
* `src/risk/riskManager.ts` — `export class RiskManager implements RiskManagerLike { constructor(cfg: RiskConfig, interval: Interval) }`,
  plus `export function validateRiskConfig(partial: Partial<RiskConfig>): { ok: boolean; errors: string[] }` (Dutch errors, sane bounds)
  and `export function roundTripCostPct(cfg: RiskConfig): number` (fraction: 2×takerFee + 2×slippage).
* Tests: `tests/risk/*.test.ts`.

### A5 — Backtester, metrics, optimizer, walk-forward, CLI
* `src/backtest/metrics.ts` — `export function computeMetrics(args: { trades: Trade[]; equityCurve: EquityCurvePoint[]; initialCapital: number; interval: Interval; candles: Candle[]; takerFee: number; exposureCandles: number }): BacktestMetrics`.
* `src/backtest/backtester.ts` —
  ```ts
  export interface BacktestInput { market: string; interval: Interval; candles: Candle[]; initialCapital: number;
    ensemble: EnsembleConfig; risk: RiskConfig; marketInfo?: MarketInfo; dataSource?: DataSource;
    /** Candles before this index are indicator warmup only: no trading, not in equity curve/metrics (default 0) */
    tradeFromIndex?: number }
  export interface BacktestDeps { decide?: (market: string, candles: Candle[], cfg: EnsembleConfig) => EnsembleDecision[];
    createRisk?: (cfg: RiskConfig, interval: Interval) => RiskManagerLike }
  export function runBacktest(input: BacktestInput, deps?: BacktestDeps): BacktestResult
  ```
  Defaults: `decide = runEnsemble`, `createRisk = (c, i) => new RiskManager(c, i)`.
* `src/backtest/optimizer.ts` — `export function optimize(input: BacktestInput, opts: { strategy?: StrategyId; objective: OptimizeObjective; maxCombos?: number }, deps?: BacktestDeps): OptimizationResult`.
* `src/backtest/walkForward.ts` — `export function walkForward(input: BacktestInput, opts: { folds: number; trainRatio: number; strategy?: StrategyId; objective: OptimizeObjective; maxCombos?: number }, deps?: BacktestDeps): WalkForwardResult`.
* `src/cli/backtest.ts` — `npm run backtest -- --market BTC-EUR --interval 15m --days 30 [--capital 50] [--source simulated|bitvavo] [--walkforward]` prints a readable Dutch report (fetches data via the feeds from A6).
* Tests: `tests/backtest/*.test.ts` (use `deps` to inject stubs so tests don't depend on A3/A4 behaviour).

### A6 — Market data feeds + paper broker
* `src/data/bitvavoFeed.ts` — `export class BitvavoFeed implements MarketDataFeed { constructor(client: BitvavoClient, opts?: { cacheDir?: string; now?: () => number }) }` (markets cached 1h; `getHistory` paginates via `end` with limit 1440 and respects rate limits; optional disk cache of closed candles).
* `src/data/simulatedFeed.ts` — `export class SimulatedFeed implements MarketDataFeed { constructor(opts?: { seed?: number; now?: () => number; markets?: string[] }) }`. Deterministic per (seed, market, interval, candle time) so history never changes between calls; realistic regimes (trends, ranges, volatility clusters, occasional spikes), realistic price levels, spreads and 24h tickers. Must support every `Interval`.
* `src/data/reachability.ts` — `export async function isBitvavoReachable(client: BitvavoClient, timeoutMs?: number): Promise<boolean>`.
* `src/broker/paperBroker.ts` — `export class PaperBroker implements Broker` (`mode = "paper"`):
  `constructor(opts: { startingQuote: number; takerFee: number; slippagePct: number; now?: () => number; quote?: string })`,
  `getBalances()`, `placeMarketOrder()`, `restore(balances: Balance[]): void`, `reset(startingQuote: number): void`.
  Buy with `amountQuote = Q`: total spent is Q; `fee = Q - Q/(1+takerFee)`; fill price = ref × (1 + slippage); `amount = (Q - fee) / fillPrice`.
  Sell with `amount`: fill price = ref × (1 − slippage); gross = amount × fillPrice; fee = gross × takerFee.
  Rejects (status "rejected", Dutch `error`) on insufficient balance or order below €5.
* Tests: `tests/data/*.test.ts`, `tests/broker/paperBroker.test.ts`.

### A7 — Trading engine + state store
* `src/engine/stateStore.ts` — `export class StateStore { constructor(filePath: string); load(): PersistedState | null; save(state: PersistedState): void /* atomic: write tmp + rename; debounced ok */; flush(): void }`.
* `src/engine/tradingEngine.ts` —
  ```ts
  export interface EngineDeps { feed: MarketDataFeed; broker: Broker; config: EngineConfig; mode: TradingMode;
    store?: StateStore; now?: () => number; startingCapital: number /* paper: start capital; live: capital limit in EUR */;
    decide?: (market: string, candles: Candle[], cfg: EnsembleConfig) => EnsembleDecision[];
    createRisk?: (cfg: RiskConfig, interval: Interval) => RiskManagerLike }
  export class TradingEngine extends EventEmitter {
    constructor(deps: EngineDeps)
    start(): Promise<void>; stop(): Promise<void>; tick(): Promise<void>
    snapshot(): EngineSnapshot
    updateConfig(partial: Partial<EngineConfig>): EngineConfig
    closePosition(id: string, reason?: ExitReason): Promise<Trade | null>
    killSwitch(): Promise<void>        // close everything, stop, log
    arm(): void; disarm(): void; readonly liveArmed: boolean
    resetPaper(startingCapital: number): void
  }
  ```
  Emits exactly the `ServerEvent` types (event name = `type`, payload = `data`).
  In live mode without `arm()`, the engine evaluates everything but places NO orders (logs "zou kopen …").
  The engine keeps its own ledger (cash, positions) in both modes; in live mode its cash is capped at `startingCapital` so it never touches more of the user's balance than allowed.
* Tests: `tests/engine/*.test.ts` (use PaperBroker/SimulatedFeed if present, otherwise inline fakes; inject `decide` for deterministic behaviour).

### A8 — Config, HTTP server, SSE, scanner, main entry
* `src/config.ts` — `export interface AppConfig { mode: TradingMode; dataSource: "auto" | DataSource; host: string; port: number;
  apiKey?: string; apiSecret?: string; operatorId: number; paperStartingCapital: number; capitalLimitQuote: number;
  dashboardToken?: string; dataDir: string; engine: EngineConfig }` and `export function loadConfig(env?: NodeJS.ProcessEnv): AppConfig`
  (reads `.env` via `process.loadEnvFile` if present; merges `data/config.json` overrides saved by the UI) and
  `export function saveEngineOverrides(dataDir: string, cfg: EngineConfig): void`.
* `src/server/sse.ts`, `src/server/httpServer.ts`, `src/server/routes.ts`, `src/server/scanner.ts`, `src/main.ts`.
* Serves `public/` statically and `/vendor/lightweight-charts.js` from
  `node_modules/lightweight-charts/dist/lightweight-charts.standalone.production.js`.
* Binds to `127.0.0.1` by default. If `DASHBOARD_TOKEN` is set, every `/api/*` request needs header `x-dashboard-token` (or `?token=` for SSE).
* API (all JSON; errors → `{ error: string }` with proper status):

  | Method | Path | Body / query | Response |
  |---|---|---|---|
  | GET | `/api/info` | | `AppInfo` |
  | GET | `/api/state` | | `EngineSnapshot` |
  | GET | `/api/events` | SSE | `ServerEvent` stream (`event: <type>`, `data: <json>`), sends a `snapshot` immediately, heartbeat comment every 15s |
  | GET | `/api/config` | | `EngineConfig` |
  | PUT | `/api/config` | `Partial<EngineConfig>` (risk/ensemble may be partial) | `EngineConfig` (validated, persisted) |
  | POST | `/api/engine/start` / `stop` / `kill` | | `EngineSnapshot` |
  | POST | `/api/positions/:id/close` | | `Trade` |
  | POST | `/api/live/arm` | `{ confirm: "IK BEGRIJP HET RISICO" }` | `AppInfo` (400 in paper mode or wrong text) |
  | POST | `/api/live/disarm` | | `AppInfo` |
  | POST | `/api/paper/reset` | | `EngineSnapshot` (400 in live mode) |
  | GET | `/api/markets` | | `MarketInfo[]` (quote EUR, status trading, sorted) |
  | GET | `/api/candles` | `market, interval, limit` | `CandlesResponse` |
  | GET | `/api/scanner` | `limit` | `ScannerRow[]` (top-N EUR markets by 24h volume, cached 60s) |
  | GET | `/api/strategies` | | `StrategyMeta[]` |
  | POST | `/api/backtest` | `BacktestRequest` | `BacktestResult` |
  | POST | `/api/optimize` | `OptimizeRequest` | `OptimizationResult` |
  | POST | `/api/walkforward` | `WalkForwardRequest` | `WalkForwardResult` |
* Tests: `tests/server/*.test.ts`.

### A9 — Dashboard core (live view)
Owns `public/index.html`, `public/css/base.css`, `public/js/main.js`, `public/js/liveChart.js`,
`public/js/header.js`, `public/js/tables.js`, `public/js/log.js`, `public/favicon.svg`.

### A10 — Dashboard panels (analysis views)
Owns `public/css/panels.css` and `public/js/panels/{signals,equity,risk,backtest,scanner,settings}.js`.

## Frontend contract (A9 + A10)

* Plain browser ES modules, no build step, no framework. `index.html` loads
  `/vendor/lightweight-charts.js` (global `window.LightweightCharts`, **v5 API**:
  `createChart`, `chart.addSeries(LightweightCharts.CandlestickSeries | LineSeries | HistogramSeries | AreaSeries | BaselineSeries, opts)`,
  `LightweightCharts.createSeriesMarkers(series, markers)`, `series.createPriceLine(...)`. Check
  `node_modules/lightweight-charts/dist/typings.d.ts`). Chart time = **seconds** (`Math.floor(ms / 1000)`).
  Show local time via `localization.timeFormatter` / `timeScale.tickMarkFormatter`.
* Shared modules already written (do not modify): `public/js/api.js` (`api`, `connectEvents`, `setToken`, `ApiError`),
  `public/js/format.js` (`fmt`, `esc`), `public/js/bus.js` (`createBus`).
* `main.js` (A9) builds a `ctx` object and mounts A10's panels with **dynamic imports** so a missing panel never breaks the page:
  ```js
  const ctx = {
    api, bus, fmt, esc,
    getState: () => lastSnapshot,          // EngineSnapshot | null
    getSelectedMarket: () => selectedMarket,
    toast: (message, kind = "info") => {}, // kind: "info" | "success" | "warn" | "error"
    openModal: ({ title, bodyHtml, confirmText, cancelText, onConfirm }) => {}, // returns close()
    theme,                                  // { bg, panel, border, text, muted, green, red, accent, yellow, grid }
    LightweightCharts: window.LightweightCharts,
  };
  import("./panels/signals.js").then(m => m.mountSignals(ctx, document.getElementById("panel-signals")))
  // …same for equity (panel-equity), risk (panel-risk), backtest (backtest-root), scanner (scanner-root), settings (settings-root)
  ```
  Each A10 module exports exactly one `mountX(ctx, el)` function and subscribes to `ctx.bus` itself.
* Bus events: every SSE type (`snapshot`, `price`, `candle`, `decision`, `order`, `position-opened`, `position-closed`, `log`)
  plus UI events `market-selected` `{ market }`, `tab-changed` `{ tab }` (`live|backtest|scanner|settings`),
  `connection` `{ status }`, `config-changed` (EngineConfig). Panels that are hidden in an inactive tab must
  call `chart.applyOptions({ width, height })`/`resize` on `tab-changed` or use `autoSize: true`.
* Container IDs in `index.html` (A9 creates them all, A10 fills its own):
  * Tabs: `#tab-live`, `#tab-backtest`, `#tab-scanner`, `#tab-settings` (nav buttons `[data-tab="live"]` etc.)
  * A9: `#header-stats`, `#bot-controls`, `#mode-banner`, `#market-tabs`, `#chart-main`, `#chart-rsi`, `#chart-macd`, `#panel-positions`, `#panel-trades`, `#panel-log`, `#toast-root`, `#modal-root`
  * A10: `#panel-signals`, `#panel-equity`, `#panel-risk`, `#backtest-root`, `#scanner-root`, `#settings-root`
* CSS variables (defined by A9 in `base.css` on `:root`, dark trading theme; A10 must only use these):
  `--bg --panel --panel-2 --border --text --muted --green --green-bg --red --red-bg --accent --yellow --radius --gap --font --font-mono`.
  Shared utility classes (A9): `.panel`, `.panel-title`, `.btn`, `.btn-primary`, `.btn-danger`, `.btn-ghost`, `.badge`,
  `.pos` (green text), `.neg` (red text), `.flat`, `.muted`, `.mono`, `.grid-2`, `.table` (compact data table), `.stat` / `.stat-label` / `.stat-value`, `.form-row`, `.input`, `.select`, `.spinner`.
* Must work at 1280–1920px wide; stack panels on narrow screens (≤ 900px).
