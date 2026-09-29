# Architectuur & modulecontract

This document is the binding contract between modules. It is written for the
developers (and agents) who build and maintain the modules. All shared types
live in `src/core/types.ts`, defaults in `src/core/defaults.ts`. **Do not edit
those two files** — if you believe the contract needs a change, work around it
locally and mention it in your final report. New contract fields are always
**optional** (see [Optional contract fields](#optional-contract-fields)), so
older persisted state, older fakes in tests and older UI code keep working.

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

Commands: `npx tsc --noEmit -p .` (typecheck), `npx vitest run [path]` (tests,
Node environment, `tests/**/*.test.ts`).

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
 In the app, backtest / optimize / walk-forward run in a worker thread
 (src/server/heavyRunner.ts) so the engine, stop-losses, order polling, SSE
 and the kill switch keep responding while they compute.
```

## Signal timing (no lookahead — everyone must respect this)

### Signals and classification

* A strategy's `run(candles)` returns one signal per index; `signal[i]` may only
  use `candles[0..i]` (the close of candle i is known).
* `runEnsemble` combines the enabled strategies per candle into two scores
  (with the regime filter, strategies outside their preferred regime count for
  `OFF_REGIME_WEIGHT` = 0.5):
  * `score = Σ w·dir·conf / Σ w` over **all** enabled strategies (dir: buy +1,
    sell −1, hold 0) — buying needs broad support;
  * `exitScore = Σ w·dir·conf / Σ w` over only the strategies that have an
    opinion (not "hold") — so one clear exit vote (e.g. RSI overbought) is not
    diluted by strategies that are waiting. `runEnsemble` / `latestDecision`
    always fill it (`EnsembleDecisionWithExit`); in the contract it is optional.
* `classify(score, regime, cfg, exitScore?)` in `src/strategies/ensemble.ts` is
  the **single source of truth** for score → action:
  * `score > 0 && score >= buyThreshold` → `"buy"`, but `"hold"` when
    `regimeFilter` is on and the regime is `"trend-down"`;
  * otherwise `exit < 0 && exit <= sellThreshold` → `"sell"`, where
    `exit = exitScore` (falls back to `score` when absent or not finite);
  * otherwise `"hold"` (a score of exactly 0 is never a buy or sell).
  The optimizer re-thresholds cached decisions with it and passes
  `decision.exitScore` along; it only does so for the real `runEnsemble`
  (a custom `decide` without an explicit `classify` is re-run per combination).

### Backtest (`src/backtest/simulator.ts`)

* The decision on candle `i` is executed at the **open of candle i+1** (plus
  slippage, plus taker fee). Candle 0 never trades; candles before
  `tradeFromIndex` are indicator warmup only (no trading, not in the equity
  curve or metrics).
* Slippage per side = `max(risk.slippagePct, spreadPct / 2)` (`effectiveSlippagePct`).
  `withSpreadCosts` writes that value into `risk.slippagePct`, so the risk
  manager's cost filter and break-even level see the same costs.
* A sell decision from the close of candle `i` is executed at the open of
  candle `i+1` **before** that candle's range is checked (chronologically first).
* Exits are checked on each candle's high/low **starting with the entry
  candle itself** (the entry happened at its open). If both stop and
  take-profit are hit inside one candle, the **stop** wins. Gaps: a candle that
  opens below the stop exits at the open (above the take-profit: at the open).
  A fill price is always clamped into the candle's range.
* ATR used to manage the position on candle `i` = `decisions[i-1].atr`.
* A position still open at the end is booked as `"end-of-backtest"` at the last
  close (mark-to-market, no minimum-order check).

### Live / paper engine (`src/engine/tradingEngine.ts`)

* Only **closed** candles are evaluated (a candle is closed when
  `time + INTERVAL_MS[interval] <= now`). A decision is executed immediately
  at market.
* Per tick and market: fetch candles → `price` + `candle` events → manage open
  positions → if there is a NEW closed candle: decision → `decision` event →
  sell-signal exit (skipped while an exit is already pending) or entry.
* Managing a position: first every new closed candle since the position's
  cursor, **only candles with `time >= pos.entryTime`** (`updatePosition(…, true)`),
  then the latest price as a synthetic candle `{open=high=low=close=price}` with
  `closedCandle=false`. `entryTime` is the fill moment, so the candle in which
  the buy filled is never used as a closed candle (its part before the fill
  must not trigger a stop); the part after the fill is covered by the per-tick
  synthetic checks.
* The same candle is never traded twice per market, also not after a restart
  or a changed market list (`lastEvaluated` is persisted; an entry at or after
  the close of the signal candle blocks a repeat).

### `candlesHeld`

* `Position.candlesHeld` = number of **full closed candles after the fill**.
  The CALLER increments it for every new closed candle **before** calling
  `risk.updatePosition(pos, candle, atr, /*closedCandle*/ true)`.
  * Backtest: the entry candle's range is checked but **not counted**
    (`rangeCheck(i, false)`), so the first counted candle is `i+2` when the
    decision was on `i`.
  * Engine: counts closed candles with `time >= entryTime` (the entry candle
    is never one of them). After a restart the per-position cursor is
    estimated from `entryTime` + `candlesHeld`, so candles are not counted twice.
  * Both keep counting while an exit is pending.
* Time-stop: only on closed candles, when `candlesHeld >= timeStopCandles` and
  `close <= entryPrice × (1 + roundTripCost)`; exits at the close.

### Stop raises (`RiskManager.updatePosition`)

The risk manager never mutates the position; it returns a `PositionUpdate` and
the caller applies `stopPrice` / `highestPrice` (both only ever go **up**). Order:

1. stop hit (`low <= stop`) → exit at `min(open, stop)`; the reason is
   `"stop-loss"`, `"break-even"` or `"trailing-stop"` depending on the level;
2. take-profit hit (`high >= tp`) → exit at `max(open, tp)`;
3. time-stop (closed candles only, see above);
4. raise the stop for the **next** candles — **only when `closedCandle` is
   true** (a raise must never apply backwards to the low of the candle that
   produced it):
   * break-even: to `entryPrice × (1 + roundTripCost)` once
     `highestPrice >= entry + breakEvenAtR × R` **and the candle's close is
     above that level** (a stop above the market would sell at once, at a loss);
   * trailing: to `highestPrice − trailingAtrMult × ATR` once
     `highestPrice >= entry + 1R`.

Intrabar ticks (`closedCandle=false`) only update `highestPrice` and check the
stop / take-profit that is already in force. In the backtest a raise computed
on candle `i` applies from candle `i+1`.

### Loss cooldown

`lastLossAt[market]` = the exit moment of a losing trade; `planEntry` rejects
entries in that market while `now − lastLossAt < cooldownCandlesAfterLoss × interval`.
* Engine: the time the exit is booked.
* Backtest: the candle's **open** for exits at the open (signal exit, gap
  through stop / take-profit, pending sell retried at the open), the candle's
  **close** (`time + interval`) for intrabar exits (stop / take-profit /
  time-stop, pending sell filled inside the candle) — like the engine, which
  only notices those after the candle opened. A backtest entry's `now` is the
  open of the entry candle.

### Exchange minimum and pending exits

* The **exchange** minimum (`MarketInfo.minOrderQuote` / `minOrderBase`,
  default €5 when there is no MarketInfo) applies to buys **and** sells.
  `risk.minOrderQuote` is a user setting that only adds an extra floor for
  entries; it never lowers or replaces the exchange minimum in brokers,
  engine or backtest (`exchangeMinOrderQuote()` in the simulator).
* Backtest: an exit is only booked when `amount × price >= minimum` (price
  before slippage). Otherwise the sell is **pending**: no more stops,
  take-profit or signals; `candlesHeld` keeps counting; the sell is retried
  every candle at the open, or inside the candle at `max(low, minimum / amount)`
  when the high reaches that price. Such trades count in
  `BacktestResult.stuckTrades` and their `entryReason` gets a Dutch
  "LET OP: verkoop … geweigerd" note; `runBacktestDetailed` also returns
  `stuckAtEnd` / `stuckCandles`.
* Engine: `exitPosition` sends **no order** when the sell would fall below the
  minimum (`dustReason`: live rounds the amount down first; value below the
  quote minimum or amount below the base minimum). The exit reason is kept in
  `pendingExit` and the position is marked unsellable ("engine"); a broker
  rejection whose `error` starts with `"ONVERKOOPBAAR:"` marks it unsellable
  too ("broker"). With a pending exit the engine evaluates no stops, targets or
  signals for that position and retries the sell every tick; it sells as soon
  as `amount × price >= minimum`. The snapshot shows
  `OpenPositionView.unsellable` / `unsellableReason`; the user can
  `writeOffPosition(id)`. The message is logged once per episode, not every tick.
* Any other failed sell (rejected, live not armed, unknown outcome, coins in
  an open order, balance still being checked) also leaves the position open
  with a pending exit that is retried on the next tick.

## Optional contract fields

Added to `src/core/types.ts` after the first review round. All optional:
producers should fill them, consumers must work without them.

| Type | Field | Meaning |
|---|---|---|
| `EnsembleDecision` | `exitScore?` | Score over only the strategies with an opinion; selling uses it (see `classify`). |
| `HaltStatus` | `dailyLimit?` | `true` when the halt is the daily loss limit; the engine then keeps it until the day rollover. |
| `Broker` | `lookupOrder?(market, clientOrderId)` | Look up an earlier order: `null` = Bitvavo does not know it (code 240, one attempt); **throws** while the outcome is still unknown (network / rate limit); a still-open order is cancelled first and the confirmed final state is returned. |
| `Broker` | `setCosts?(takerFee, slippagePct)` | Keep the broker's fee (and paper slippage) equal to `config.risk`. The engine calls it on construction, `start()` and every `updateConfig`. |
| `KillResult` | `{ closed, failed[] }` | Result of the kill switch: number of positions sold and every position (or unknown buy order) that was NOT closed, with a Dutch reason. |
| `AccountState` | `totalReturnPct?`, `dayReturnPct?` | Returns in % computed by the engine, correct after skimming; the UI prefers them. |
| `OpenPositionView` | `unsellable?`, `unsellableReason?` | The position cannot be sold right now (below the exchange minimum), with a Dutch explanation. |
| `EquityPoint` | `skimmed?` | Live: cumulative skimmed profit at that point; charts show `equity + skimmed`. |
| `BacktestResult` | `note?` | Dutch explanation when the period was shortened (short history). |
| `BacktestResult` | `stuckTrades?` | Trades whose sell was first refused because the position was worth less than the minimum. |
| `Heatmap` | `best?`, `tested?`, `scored?`, `positive?` | Per cell: best score, sampled combinations, combinations with enough trades, profitable ones. `values` itself is the **median** of the scored combinations (null = not tested or too few trades). |
| `AppInfo` | `paperStartingCapital?` | Starting capital of paper mode (what `POST /api/paper/reset` resets to). |

Optional fields from earlier (round 1), still part of the contract:
`EngineSnapshot.unknownOrders?` (live buy orders with unknown outcome — while
non-empty NO new positions are opened in any market), `EngineSnapshot.stateRecovery?`
(the persisted state was unusable at startup; arming is blocked until
acknowledged), `EngineSnapshot.skimmedQuote?`, and the optional
`PersistedState` fields listed under A7.

## Module ownership & exact exports

### A1 — Exchange client + live broker
* `src/exchange/errors.ts` — `export class BitvavoApiError extends Error { status: number; errorCode: number | null; kind; bitvavoMessage }`
  with getters `isRateLimit`, `retryable` and **`outcomeUnknown`** (network error, timeout, unreadable
  response, 5xx or Bitvavo code 101/108/109: the request may have been executed — never blindly resend an order).
* `src/exchange/signing.ts` — `export function signRequest(secret: string, timestamp: number, method: string, pathWithQuery: string, body: string): string`
  (HMAC-SHA256 hex over `timestamp + METHOD + "/v2" + path + body`; `pathWithQuery` passed here already starts with `/v2`).
* `src/exchange/precision.ts` — `roundPrice(price: number, m: MarketInfo, mode?: "down"|"up"|"nearest"): number`,
  `roundAmount(amount: number, m: MarketInfo): number` (floors), `roundQuote(q: number, m: MarketInfo): number` (floors),
  `toSignificant(value: number, digits: number, mode?): number`, `formatDecimal(value: number, decimals: number): string` (no exponent notation — Bitvavo rejects `1e-7`).
* `src/exchange/bitvavoClient.ts` — `export class BitvavoClient`:
  ```ts
  constructor(opts?: { apiKey?: string; apiSecret?: string; baseUrl?: string; accessWindow?: number;
                       operatorId?: number; fetchImpl?: typeof fetch; now?: () => number; timeoutMs?: number;
                       maxRetries?: number; retryBaseDelayMs?: number; sleep?: (ms: number) => Promise<void>; autoTimeSync?: boolean })
  readonly hasCredentials: boolean
  rateLimitRemaining: number | null
  rateLimitFor(scope: "public" | "private"): RateLimitStatus
  time(): Promise<number>; syncTime(): Promise<number>
  markets(): Promise<MarketInfo[]>
  candles(market: string, interval: Interval, opts?: { limit?: number; start?: number; end?: number }): Promise<Candle[]> // ASCENDING
  ticker24h(market?: string): Promise<Ticker24h[]>
  tickerPrice(market?: string): Promise<{ market: string; price: number }[]>
  book(market: string, depth?: number): Promise<OrderBook>
  balance(): Promise<Balance[]>
  account(): Promise<{ takerFee: number; makerFee: number; volume: number }>
  placeOrder(p: { market: string; side: Side; orderType: "market" | "limit"; amount?: number; amountQuote?: number;
                  price?: number; clientOrderId?: string; timeInForce?: "GTC" | "IOC" | "FOK"; postOnly?: boolean }): Promise<BitvavoOrder>
                  // NEVER retried; on err.outcomeUnknown the caller must look the order up first
  getOrder(market: string, orderId: string): Promise<BitvavoOrder>
  getOrderByClientId(market: string, clientOrderId: string): Promise<BitvavoOrder>
  cancelOrder(market: string, orderId: string): Promise<void>
  openOrders(market?: string): Promise<BitvavoOrder[]>
  ```
  `BitvavoOrder` is exported from `bitvavoClient.ts` (raw-ish order shape with numbers parsed).
* `src/broker/liveBroker.ts` — `export class LiveBroker implements Broker` (`mode = "live"`):
  ```ts
  constructor(client: BitvavoClient, opts?: {
    getMarketInfo?: (market: string) => Promise<MarketInfo | undefined>; maxSlippagePct?: number /* 2 */;
    pollAttempts?: number /* 5 */; pollDelayMs?: number /* 400 */; lookupAttempts?: number /* 5 */;
    cancelAttempts?: number /* 3 */; takerFee?: number /* 0.0025 */; sleep?; now? })
  readonly takerFee: number
  setCosts(takerFee: number, slippagePct?: number): void   // fee used to estimate a fee Bitvavo has not settled yet
  getBalances(): Promise<Balance[]>
  placeMarketOrder(req: MarketOrderRequest, referencePrice: number): Promise<OrderResult>
  lookupOrder(market: string, clientOrderId: string): Promise<OrderResult | null>   // Broker.lookupOrder contract
  ```
  Also exported: `isFinalOrderStatus(status)` (filled / cancelled / expired / rejected are final;
  anything else — new, awaitingTrigger, partiallyFilled, unknown — may still be open), `mapOrderStatus`,
  `toClientOrderUuid`, `orderToResult`, `UNSELLABLE_PREFIX = "ONVERKOOPBAAR:"`.
  Behaviour the engine relies on:
  * never throws for a rejection: status `"rejected"` + Dutch `error`; amounts are always rounded **down**;
  * `POST /order` is never repeated. On an unknown outcome the order is looked up by clientOrderId
    (`lookupAttempts`); even "not found" every time is reported as unknown, never as a rejection;
  * after placing it polls until the order is settled; an order that is still open is **cancelled** and its
    final state fetched (`cancelAttempts`) — an open order is never "forgotten";
  * `error` starting with **`"UITKOMST ONBEKEND"`** (status `"new"`, or `"partiallyFilled"` if something filled)
    = the order may still (further) execute. The engine keys on this prefix;
  * a sell below the exchange minimum (also after clamping to the available balance, which it does only for a
    shortfall ≤ 5%) is **not sent**: `"rejected"` with `error` starting with **`"ONVERKOOPBAAR:"`**;
  * `lookupOrder` keeps a partially filled, then ended order's final status (`"cancelled"`/`"expired"` with
    `filledAmount > 0`), where `placeMarketOrder` reports `"partiallyFilled"`;
  * a fill price more than `maxSlippagePct` from the reference price adds a warning to `error`.
* Tests: `tests/exchange/*.test.ts`, `tests/broker/liveBroker.test.ts` (mocked `fetchImpl` / client, no network).

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
* `src/strategies/registry.ts` (re-exported by `src/strategies/index.ts`) — `export const STRATEGIES: Record<StrategyId, StrategyDefinition>`,
  `export function listStrategies(): StrategyMeta[]` (no functions, JSON-safe), `export function getStrategy(id: StrategyId): StrategyDefinition`,
  `export function isStrategyId(id: unknown): id is StrategyId`, `export function resolveParams(id: StrategyId, overrides?: StrategyParams): StrategyParams`.
* `src/strategies/regime.ts` — `export function detectRegimes(candles: Candle[]): Regime[]` (same length, "unknown" during warmup), `REGIME_THRESHOLDS`.
* `src/strategies/ensemble.ts` —
  `export function runEnsemble(market: string, candles: Candle[], cfg: EnsembleConfig): EnsembleDecisionWithExit[]` (same length as candles; `exitScore` always filled),
  `export function latestDecision(market: string, candles: Candle[], cfg: EnsembleConfig): EnsembleDecisionWithExit | null`,
  `export function decisionsToMarkers(decisions: EnsembleDecision[]): SignalMarker[]` (only buy/sell, de-duplicated so consecutive identical actions yield one marker),
  `export function classify(score: number, regime: Regime, cfg: EnsembleConfig, exitScore?: number): SignalAction` (see [Signal timing](#signals-and-classification)),
  `export function summarizeVotes(decision: EnsembleDecision): string`, `OFF_REGIME_WEIGHT`.
* Tests: `tests/strategies/*.test.ts`.

### A4 — Risk manager
* `src/risk/riskManager.ts` — `export class RiskManager implements RiskManagerLike { constructor(cfg: RiskConfig, interval: Interval) }`,
  plus `export function validateRiskConfig(partial: Partial<RiskConfig>): { ok: boolean; errors: string[] }` (Dutch errors, sane bounds)
  and `export function roundTripCostPct(cfg: RiskConfig): number` (fraction: 2×takerFee + 2×slippage).
* `planEntry` sizing (capital preservation first; every rejection has a Dutch reason):
  * risk budget = `equity × riskPerTradePct / 100`; loss per unit = stop distance + entry × round-trip cost,
    so the budget **includes costs**. Size = min(by risk, `maxPositionPct`, remaining `maxTotalExposurePct`, 99.5% of cash), floored to cents;
  * the position must still be **sellable at its stop**: required size =
    `max(ceilCents(minOrder), ceilCents(exchangeMin × (1 + takerFee) × entry / stop × 1.03), minOrderBase × entry × (1 + takerFee) × 1.03)`
    (1.03 = buffer for a gap through the stop, a different fill and amount rounding).
    `exchangeMin` = `MarketInfo.minOrderQuote`, or `max(risk.minOrderQuote, 5)` without MarketInfo; `minOrder = max(exchangeMin, risk.minOrderQuote)`;
  * a smaller risk-sized position is raised to that size ("opgehoogd naar minimum") **only** if it fits the position,
    exposure and cash caps **and** its risk stays ≤ 1× the risk budget (`MAX_BUMP_RISK_MULTIPLE = 1`); otherwise the entry is rejected.
    The risk per trade is never exceeded to reach the minimum.
* `haltStatus` returns `dailyLimit: true` for the daily loss limit (the engine then keeps the halt until the day rollover).
* `updatePosition`: see [Stop raises](#stop-raises-riskmanagerupdateposition).
* Tests: `tests/risk/*.test.ts`.

### A5 — Backtester, metrics, optimizer, walk-forward, CLI
Each part is split into a dependency-free core (everything injected, unit-testable on its own) and a thin public
entry point that wires in the real `runEnsemble` / `RiskManager` / strategies.
* `src/backtest/metrics.ts` — `export function computeMetrics(args: { trades: Trade[]; equityCurve: EquityCurvePoint[]; initialCapital: number; interval: Interval; candles: Candle[]; takerFee: number; exposureCandles: number }): BacktestMetrics`.
* `src/backtest/simulator.ts` (core) — `BacktestInput`, `BacktestDeps`, `simulate(input, decisions, risk, opts?)`,
  `runBacktestWith(input, resolvedDeps, opts?)`, `effectiveSlippagePct`, `withSpreadCosts`, `spreadFromTicker`,
  `exchangeMinOrderQuote`, `DEFAULT_EXCHANGE_MIN_QUOTE` (5), `aggregateCandles`, `MAX_CHART_CANDLES` (1500).
* `src/backtest/backtester.ts` (public) —
  ```ts
  export interface BacktestInput { market: string; interval: Interval; candles: Candle[]; initialCapital: number;
    ensemble: EnsembleConfig; risk: RiskConfig; marketInfo?: MarketInfo; dataSource?: DataSource;
    /** Candles before this index are indicator warmup only: no trading, not in equity curve/metrics (default 0) */
    tradeFromIndex?: number;
    /** Bid/ask spread as a fraction of mid; slippage per side = max(risk.slippagePct, spreadPct / 2) */
    spreadPct?: number }
  export interface BacktestDeps { decide?: (market: string, candles: Candle[], cfg: EnsembleConfig) => EnsembleDecision[];
    createRisk?: (cfg: RiskConfig, interval: Interval) => RiskManagerLike }
  export function runBacktest(input: BacktestInput, deps?: BacktestDeps): BacktestResult
  export function runBacktestDetailed(input: BacktestInput, deps?: BacktestDeps): SimulationOutput
    // + exposureCandles, slippagePct, stuckTrades, stuckAtEnd, stuckCandles, minOrderQuote
  ```
  Defaults: `decide = runEnsemble`, `createRisk = (c, i) => new RiskManager(c, i)`.
* `src/backtest/optimizerCore.ts` (core) + `src/backtest/optimizer.ts` (public) —
  `export function optimize(input: BacktestInput, opts: { strategy?: StrategyId; objective: OptimizeObjective; maxCombos?: number }, deps?: OptimizerDeps): OptimizationResult`.
  `OptimizerDeps = BacktestDeps & { classify?: ClassifyFn; paramSpace?: (id) => Record<string, number[]> }`,
  `ClassifyFn = (score, regime, cfg, exitScore?) => SignalAction`. Combinations with fewer than
  `MIN_TRADES_FOR_SCORE` (5) trades get `PENALTY_SCORE` (−1e9); `best` is `null` when nothing scored.
* `src/backtest/walkForwardCore.ts` (core) + `src/backtest/walkForward.ts` (public) —
  `export function walkForward(input: BacktestInput, opts: { folds: number; trainRatio: number; strategy?: StrategyId; objective: OptimizeObjective; maxCombos?: number }, deps?: OptimizerDeps): WalkForwardResult`,
  `foldWindows(from, n, folds, trainRatio)` (throws a Dutch error when there are too few candles), `WF_WARMUP_CANDLES` (250).
* `src/backtest/verdict.ts` — `walkForwardVerdict`, `backtestVerdict` (honest Dutch verdicts).
* `src/cli/backtest.ts` — `npm run backtest -- --market BTC-EUR --interval 15m --days 30 [--capital 50] [--source auto|bitvavo|simulated] [--optimize] [--walkforward] [--objective …] [--strategy <id>] [--folds 4] [--train 0.7] [--combos 120] [--seed 1]`
  prints a readable Dutch report (fetches data via the feeds from A6). It always uses `DEFAULT_ENGINE_CONFIG`
  (not the dashboard's saved settings). `src/cli/backtestReport.ts` holds the testable report helpers.
* Tests: `tests/backtest/*.test.ts` (use `deps` to inject stubs so tests don't depend on A3/A4 behaviour).

### A6 — Market data feeds + paper broker
* `src/data/bitvavoFeed.ts` — `export class BitvavoFeed implements MarketDataFeed { constructor(client: BitvavoClient, opts?: { cacheDir?: string; now?: () => number }) }` (markets cached 1h; `getHistory` paginates via `end` with limit 1440 and respects rate limits; optional disk cache of closed candles).
* `src/data/simulatedFeed.ts` — `export class SimulatedFeed implements MarketDataFeed { constructor(opts?: { seed?: number; now?: () => number; markets?: string[] }) }`. Deterministic per (seed, market, interval, candle time) so history never changes between calls; realistic regimes (trends, ranges, volatility clusters, occasional spikes), realistic price levels, spreads and 24h tickers. Must support every `Interval`.
* `src/data/reachability.ts` — `export async function isBitvavoReachable(client: BitvavoClient, timeoutMs?: number): Promise<boolean>`.
* `src/broker/paperBroker.ts` — `export class PaperBroker implements Broker` (`mode = "paper"`):
  `constructor(opts: { startingQuote: number; takerFee: number; slippagePct: number; now?: () => number; quote?: string;
  minOrderQuote?: number /* exchange minimum, default 5 — never risk.minOrderQuote */; getMarketInfo?: (market) => MarketInfo | undefined | Promise<…> })`,
  `getBalances()`, `placeMarketOrder()`, `setCosts(takerFee, slippagePct)`, `restore(balances: Balance[]): void`, `reset(startingQuote: number): void`.
  Buy with `amountQuote = Q`: total spent is Q; `fee = Q - Q/(1+takerFee)`; fill price = ref × (1 + slippage); `amount = (Q - fee) / fillPrice`.
  Sell with `amount`: fill price = ref × (1 − slippage); gross = amount × fillPrice; fee = gross × takerFee.
  Rejects (status "rejected", Dutch `error`) on insufficient balance or an order below the exchange minimum; a sell
  below the minimum starts with `"ONVERKOOPBAAR:"` (same prefix as the LiveBroker).
* Tests: `tests/data/*.test.ts`, `tests/broker/paperBroker.test.ts`.

### A7 — Trading engine + state store
* `src/engine/stateStore.ts` — `export class StateStore { constructor(filePath: string, opts?: { debounceMs?: number; now?: () => number });
  load(): PersistedState | null; save(state: PersistedState): void; flush(): void; lastLoadProblem: { reason: string; quarantinedTo?: string } | null;
  readonly writesBlocked: boolean; unblockWrites(): void }`.
  `save` is debounced (~500 ms, the LAST state is written); writes are atomic (tmp file + fsync + rename).
  A corrupt/invalid file is renamed to `<file>.corrupt-<timestamp>` and `load()` returns `null` with `lastLoadProblem` set;
  if the file cannot be read or renamed, writing is **blocked** until `unblockWrites()` (a fresh ledger must not overwrite a possibly good file).
* `src/engine/tradingEngine.ts` —
  ```ts
  export interface EngineDeps { feed: MarketDataFeed; broker: Broker; config: EngineConfig; mode: TradingMode;
    store?: StateStore; now?: () => number; startingCapital: number /* paper: start capital; live: capital limit in EUR */;
    decide?: (market: string, candles: Candle[], cfg: EnsembleConfig) => EnsembleDecision[];
    createRisk?: (cfg: RiskConfig, interval: Interval) => RiskManagerLike }
  export function requiredWarmupCandles(ens: EnsembleConfig | undefined): number
  export function candlesToFetch(cfg: Pick<EngineConfig, "historyCandles" | "ensemble">): number
    // max(historyCandles, warmup + 150) + 1, capped at 1440 — the live engine never starves a strategy of warmup
  export class TradingEngine extends EventEmitter {
    constructor(deps: EngineDeps)
    readonly mode: TradingMode
    start(): Promise<void>; stop(): Promise<void>; tick(): Promise<void>
    snapshot(): EngineSnapshot
    updateConfig(partial: Partial<EngineConfig>): EngineConfig
    closePosition(id: string, reason?: ExitReason): Promise<Trade | null>   // null → Dutch reason in lastCloseFailure
    killSwitch(): Promise<KillResult>
    writeOffPosition(id: string): Trade       // throws "Afschrijven kan …" when not allowed (now)
    acknowledgeUnknownOrders(): void          // user checked Bitvavo: lift the entry block
    acknowledgeStateRecovery(): void          // user checked balances after an unusable state file
    arm(): void                               // throws "Armen geblokkeerd: …" while stateRecovery is unacknowledged
    disarm(): void
    resetPaper(startingCapital: number): void
    readonly liveArmed: boolean
    readonly isRunning: boolean
    readonly orderInFlight: boolean           // a broker.placeMarketOrder call is running (used by the shutdown)
    readonly lastCloseFailure: string | null
  }
  ```
  Emits exactly the `ServerEvent` types (event name = `type`, payload = `data`). All state-changing async work
  (tick, close, kill) is serialized behind one lock.
* Rules the engine guarantees:
  * **Live, not armed**: evaluates everything but places NO orders ("zou kopen …" / "zou verkopen …"). That includes
    automatic exits (stop-loss!) on existing positions — they stay pending until armed. Explicit user actions
    (`closePosition`, `killSwitch`) do sell while disarmed. Arming is not persisted: after a restart live is disarmed.
  * **Ledger & capital limit**: the engine keeps its own ledger (cash, positions) in both modes. Live: cash + cost of
    open positions stays within `startingCapital`; profit above it is **skimmed** (`skimmedQuote`, `skimmedToday`):
    start and day-start equity are lowered by the excess and returns are computed with it
    (`totalReturnPct`, `dayReturnPct`, `EquityPoint.skimmed`), so skimming is never a loss and never trips the daily
    limit. A changed `CAPITAL_LIMIT_EUR` between runs is rebased on restore (persisted `capitalLimitQuote`).
  * **Stop / kill**: `stop()` and `killSwitch()` bump a stop generation synchronously; a tick requested before that
    opens no new positions any more, even halfway through.
  * **Unknown buy outcome** (live): no retry and no position; ALL new entries pause (persisted `unknownOrders`)
    until `broker.lookupOrder` finds the order (the filled part is booked as a position with a stop; a partial,
    still-open fill is booked right away), Bitvavo reports it unknown on 3 ticks in a row (= not placed), or the user
    calls `acknowledgeUnknownOrders()` (coins bought by such an order are then NOT managed).
  * **Unknown sell outcome** (live): never a second sell for that position until resolved (persisted `unknownSells`),
    via `lookupOrder`, or — without it — once no coins of that asset sit in an open order.
  * **Coins missing on Bitvavo**: only booked as sold after two observations (two ticks, or two balance reads for an
    explicit close); a missing part is booked separately; coins stuck in an open order are not sold (the exit
    stays pending) and are never booked as gone.
  * **Unsellable positions**: see [Exchange minimum and pending exits](#exchange-minimum-and-pending-exits).
    `writeOffPosition(id)` is only allowed for an unsellable position and not while an order is in flight or an
    unknown-outcome sell for it is pending: the position is no longer managed, the full cost is booked as a loss
    (`pnlPct −100`, exit reason `"manual"`), cash is unchanged and the coins stay on the account.
  * **Kill switch**: synchronously stops and disarms; then (under the lock) resolves unknown buys/sells ("not found"
    does not count towards the 3 ticks), sells every position explicitly and returns a `KillResult` with every
    position still open plus every still-unknown buy order in `failed` (Dutch reasons: unsellable, rejected, unknown
    outcome, coins in an open order, …). The bot stops even when sells fail.
  * **Daily loss limit** stays in force until the day rollover (persisted `haltedDayKey`), even if positions recover.
    The rollover waits for a current price of every open position.
  * **Unusable state file**: the engine starts with an empty ledger, sets `stateRecovery` (persisted) and blocks
    `arm()` until `acknowledgeStateRecovery()`, which also unblocks the store's writes.
  * Broker costs follow the risk settings (`broker.setCosts`) on construction, `start()` and every `updateConfig`.
* Persisted state (`PersistedState`, `version: 1`): the required fields plus the optional `capitalLimitQuote`,
  `lastEvaluated` (per interval), `unknownOrders` (with `stopDist`, `tpDist`, `entryReason`, `positionId`, `bookedAmount`),
  `haltedDayKey`, `skimmedQuote`, `stateRecovery`; engine-only extras (not in `types.ts`, older files load fine):
  `unknownSells`, `skimmedToday`, and a `nullCount` per unknown order. Paper mode also stores `paperBalances`.
  File: `<DATA_DIR>/state-<mode>.json`.
* Tests: `tests/engine/*.test.ts` (use PaperBroker/SimulatedFeed if present, otherwise inline fakes; inject `decide` for deterministic behaviour).

### A8 — Config, HTTP server, SSE, scanner, worker, main entry
* `src/config.ts` — `export interface AppConfig { mode: TradingMode; dataSource: "auto" | DataSource; host: string; port: number;
  apiKey?: string; apiSecret?: string; operatorId: number; paperStartingCapital: number; capitalLimitQuote: number;
  dashboardToken?: string; dataDir: string; engine: EngineConfig; autostart: boolean }` and
  `export function loadConfig(env?: NodeJS.ProcessEnv, opts?: { envFile?: string | false; warn?: (msg: string) => void }): AppConfig`
  (reads `.env` via `process.loadEnvFile` if present; merges `<dataDir>/config.json` overrides saved by the UI),
  `saveEngineOverrides(dataDir, cfg)` (atomic), `readEngineOverrides` (keeps only valid fields, warns about the rest),
  `mergeEngineConfig`, `repairRiskConfig` (invalid risk values → defaults, per key), `isLoopbackHost` (exact:
  localhost, 127.x.y.z, ::1 in any notation), `ConfigError`.
  Precedence: defaults → `.env` (`MARKETS`, `INTERVAL`) → **settings saved in the dashboard**. When saved settings
  override `MARKETS`/`INTERVAL` from `.env`, `loadConfig` warns at startup. Live mode requires API keys, a non-simulated
  data source and a `DASHBOARD_TOKEN` on a non-loopback `HOST`; live never autostarts.
* `src/main.ts` — builds feed, broker (PaperBroker after `repairRiskConfig`; LiveBroker + `syncAccountFees`, which
  copies the account's real fees into the risk config and the broker), `StateStore`, `TradingEngine`, the heavy-job
  runner and the HTTP server; graceful shutdown via `src/server/shutdown.ts` (live: waits up to 90 s while
  `engine.orderInFlight`). **Temporary:** `refuseLiveUntilReviewed()` refuses `TRADING_MODE=live` until the review
  is closed (see `docs/REVIEW-STATUS.md`); update this line when it is removed.
* `src/server/heavyRunner.ts` + `heavyWorker.mjs` + `heavyWorkerImpl.ts` — backtest, optimize and walk-forward run in
  a `worker_threads` worker (the `.mjs` entry registers `tsx` in the worker, then loads the TypeScript implementation).
  One reused worker; hard timeout `HEAVY_TIMEOUT_MS` = 120 s (worker terminated, HTTP 503), heap limit 1024 MB,
  rejected with 503 once the server shuts down.
* `src/server/sse.ts`, `src/server/httpServer.ts`, `src/server/router.ts`, `src/server/routes.ts`,
  `src/server/validation.ts`, `src/server/scanner.ts`, `src/server/static.ts`, `src/server/warmup.ts`,
  `src/server/accountFees.ts`, `src/server/shutdown.ts`.
* `Services` (injected into the routes): `runBacktest`, `optimize` and `walkForward` may return a **Promise** (main.ts
  wires them to the worker; tests may pass the synchronous functions), plus `listStrategies`, `chartIndicators`,
  `runEnsemble`, `decisionsToMarkers`, `detectRegimes`, `validateRiskConfig`. `EngineLike` makes
  `acknowledgeUnknownOrders`, `acknowledgeStateRecovery` and `writeOffPosition` optional (missing → 501) and accepts a
  `killSwitch()` that returns nothing (older fakes).
* Serves `public/` statically and `/vendor/lightweight-charts.js` from
  `node_modules/lightweight-charts/dist/lightweight-charts.standalone.production.js`. Non-API paths accept only GET/HEAD.
* Security (`httpServer.ts`):
  * Binds to `127.0.0.1` by default. When bound to loopback, the `Host` header must be an exact loopback name
    (DNS-rebinding protection; missing `Host` → 400, other → 403).
  * For **every** `/api/*` request, whatever the method (GET and SSE included — the scanner and candles share the
    Bitvavo rate limit with stop-loss orders): `Sec-Fetch-Site` other than `same-origin`/`none` → 403, and an
    `Origin` of `"null"` or with a host different from the `Host` header → 403. Requests without these headers
    (curl, scripts) are allowed.
  * If `DASHBOARD_TOKEN` is set, every `/api/*` request needs header `x-dashboard-token` (or `?token=` for
    `/api/events` only), compared in constant time.
  * Security headers (CSP `default-src 'self'`, `frame-ancestors 'none'`, nosniff, no-referrer, …),
    `Cache-Control: no-store` on the API, JSON bodies max 1 MB (413), non-finite numbers serialized as `null`.
* API (all JSON; errors → `{ error: string }` with proper status):

  | Method | Path | Body / query | Response |
  |---|---|---|---|
  | GET | `/api/info` | | `AppInfo` |
  | GET | `/api/state` | | `EngineSnapshot` |
  | GET | `/api/events` | SSE | `ServerEvent` stream (`event: <type>`, `data: <json>`), sends a `snapshot` immediately, heartbeat comment every 15s |
  | GET | `/api/config` | | `EngineConfig` |
  | PUT | `/api/config` | `Partial<EngineConfig>` (risk/ensemble may be partial) | `EngineConfig` (validated, persisted to `<dataDir>/config.json`; 500 if active but not saved) |
  | POST | `/api/engine/start` / `stop` | | `EngineSnapshot` |
  | POST | `/api/engine/kill` | | `EngineSnapshot & { killResult?: KillResult }` — **200 also when positions could not be sold**; the UI shows `killResult.failed` |
  | POST | `/api/positions/:id/close` | | `Trade` (404 unknown id, 409 not closed — see the log) |
  | POST | `/api/positions/:id/writeoff` | | `Trade` (404 unknown id, 409 "Afschrijven kan …", 501 engine without write-off) |
  | POST | `/api/live/arm` | `{ confirm: "IK BEGRIJP HET RISICO" }` | `AppInfo` (400 in paper mode, wrong text or no API keys; 409 "Armen geblokkeerd" while a state recovery is unacknowledged) |
  | POST | `/api/live/disarm` | | `AppInfo` |
  | POST | `/api/live/unknown-orders/ack` | | `EngineSnapshot` (lifts the entry block after the user checked Bitvavo; 501 if unsupported) |
  | POST | `/api/state/recovery/ack` | | `EngineSnapshot` (acknowledges an unusable state file; arming allowed again; 501 if unsupported) |
  | POST | `/api/paper/reset` | `{ startingCapital? }` (5 – 10 000 000, default `PAPER_STARTING_CAPITAL`) | `EngineSnapshot` (400 in live mode) |
  | GET | `/api/markets` | | `MarketInfo[]` (quote EUR, status trading, sorted) |
  | GET | `/api/candles` | `market, interval, limit` (limit clamped to 50–1000) | `CandlesResponse` |
  | GET | `/api/scanner` | `limit` (max 60) | `ScannerRow[]` (top-N EUR markets by 24h volume, cached 60s) |
  | GET | `/api/strategies` | | `StrategyMeta[]` |
  | POST | `/api/backtest` | `BacktestRequest` | `BacktestResult` |
  | POST | `/api/optimize` | `OptimizeRequest` | `OptimizationResult` |
  | POST | `/api/walkforward` | `WalkForwardRequest` | `WalkForwardResult` |

  Backtest / optimize / walk-forward: one at a time (429 "Er loopt al een berekening"), run in the worker (503 on
  timeout). History = the period plus `max(250, backtestWarmupCandles(ensemble, strategy))` warmup candles; trading
  starts after the warmup (`tradeFromIndex`). A market with short history shortens the period and returns a Dutch
  `note`; too few candles (< 60 in total, or < 30 in the period) → 400. The current bid/ask spread (24h ticker,
  3 s timeout, best effort) is passed as `spreadPct`.
* Tests: `tests/server/*.test.ts`.

### A9 — Dashboard core (live view)
Owns `public/index.html`, `public/css/base.css`, `public/js/main.js`, `public/js/liveChart.js`,
`public/js/header.js`, `public/js/tables.js`, `public/js/log.js`, `public/favicon.svg`.
* `header.js` — stats, bot controls, mode banner and the **alert banners** (`#alert-banners`): "Onbekende
  orderuitkomst" (`snapshot.unknownOrders`, button "Ik heb het gecontroleerd" → `POST /api/live/unknown-orders/ack`)
  and "Opgeslagen staat was onbruikbaar" (`snapshot.stateRecovery` → `POST /api/state/recovery/ack`). Exports
  `killOutcome(res, fmt, minOrder?)` (Dutch toast text from the kill response, listing `killResult.failed`) and
  `accountReturns(snap)` (returns incl. skimmed profit).
* `tables.js` — open positions (badge "Onverkoopbaar" from `unsellable`/`unsellableReason`, buttons "Sluit" and
  "Afschrijven" → `POST /api/positions/:id/writeoff`) and trades. Exports `unsellableWhy(p)`.

### A10 — Dashboard panels (analysis views)
Owns `public/css/panels.css`, `public/js/panels/{signals,equity,risk,backtest,scanner,settings}.js` and the pure,
DOM-free helper modules:
* `public/js/panels/backtestLogic.js` (used by `backtest.js`) — period checks (`periodCandles`, `minPeriodDays`,
  `periodError`, `MIN_PERIOD_CANDLES` = 30, same as the server), heatmap cells and tooltips (`heatmapCell`,
  `bestHeatmapCell`, `heatmapCellTip`), KPI quality (`quality`), optimizer rows (`isScoredRow`, `bestScoredRow`,
  `scoreBarMax`; `PENALTY_SCORE` / `MIN_TRADES_FOR_SCORE` mirror `optimizerCore.ts`) and "apply best settings"
  (`paramsToPartial`, `testedPartial`, `describeApply`) — the applied patch is the configuration the optimizer actually tested.
* `public/js/panels/settingsLogic.js` (used by `settings.js`) — risk field definitions with Dutch help and display
  scaling (`RISK_GROUPS`), `validateDraft` (messages in the units the user sees), `feeWarnings`, `buildPatch`
  (the `PUT /api/config` body with only the fields the user changed, so changes made elsewhere are never reverted)
  and `rebaseDraft` (three-way merge of unsaved edits onto a newer server config, reporting conflicts).

## Frontend contract (A9 + A10)

* Plain browser ES modules, no build step, no framework. `index.html` loads
  `/vendor/lightweight-charts.js` (global `window.LightweightCharts`, **v5 API**:
  `createChart`, `chart.addSeries(LightweightCharts.CandlestickSeries | LineSeries | HistogramSeries | AreaSeries | BaselineSeries, opts)`,
  `LightweightCharts.createSeriesMarkers(series, markers)`, `series.createPriceLine(...)`. Check
  `node_modules/lightweight-charts/dist/typings.d.ts`). Chart time = **seconds** (`Math.floor(ms / 1000)`).
  Show local time via `localization.timeFormatter` / `timeScale.tickMarkFormatter`.
* Shared modules: `public/js/api.js` (`api`, `connectEvents`, `setToken`, `ApiError`, `EVENT_TYPES`; sends
  `x-dashboard-token`; `api` has one method per route, incl. `kill`, `closePosition`, `writeOffPosition`,
  `ackUnknownOrders`, `ackStateRecovery`, `resetPaper`), `public/js/format.js` (`fmt`, `esc`), `public/js/bus.js` (`createBus`).
* `main.js` (A9) builds a `ctx` object and mounts A10's panels with **dynamic imports** so a missing panel never breaks the page:
  ```js
  const ctx = {
    api, bus, fmt, esc,
    getState: () => lastSnapshot,          // EngineSnapshot | null
    getSelectedMarket: () => selectedMarket,
    toast: (message, kind = "info") => {}, // kind: "info" | "success" | "warn" | "error"
    openModal: ({ title, bodyHtml, confirmText, cancelText, onConfirm, danger }) => {}, // returns close()
    theme,                                  // { bg, panel, border, text, muted, green, red, accent, yellow, grid }
    LightweightCharts: window.LightweightCharts,
    // optional extras:
    getInfo, getActiveTab, getConnection, selectMarket(market), showTab(tab),
  };
  import("./panels/signals.js").then(m => m.mountSignals(ctx, document.getElementById("panel-signals")))
  // …same for equity (panel-equity), risk (panel-risk), backtest (backtest-root), scanner (scanner-root), settings (settings-root)
  ```
  Each A10 panel module exports exactly one `mountX(ctx, el)` function and subscribes to `ctx.bus` itself.
* Bus events: every SSE type (`snapshot`, `price`, `candle`, `decision`, `order`, `position-opened`, `position-closed`, `log`)
  plus UI events `market-selected` `{ market }`, `tab-changed` `{ tab }` (`live|backtest|scanner|settings`),
  `connection` `{ status }`, `config-changed` (EngineConfig). Panels that are hidden in an inactive tab must
  call `chart.applyOptions({ width, height })`/`resize` on `tab-changed` or use `autoSize: true`.
* Use the engine's numbers where they exist: `account.totalReturnPct` / `dayReturnPct` for returns, `equity + skimmed`
  for live equity curves, `unsellable` / `unsellableReason` for positions, `killResult.failed` after a kill.
* Container IDs in `index.html` (A9 creates them all, A10 fills its own):
  * Tabs: `#tab-live`, `#tab-backtest`, `#tab-scanner`, `#tab-settings` (nav buttons `[data-tab="live"]` etc.)
  * A9: `#header-stats`, `#bot-controls`, `#mode-banner`, `#alert-banners`, `#market-tabs`, `#chart-main`, `#chart-rsi`, `#chart-macd`, `#panel-positions`, `#panel-trades`, `#panel-log`, `#toast-root`, `#modal-root`
  * A10: `#panel-signals`, `#panel-equity`, `#panel-risk`, `#backtest-root`, `#scanner-root`, `#settings-root`
* CSS variables (defined by A9 in `base.css` on `:root`, dark trading theme; A10 must only use these):
  `--bg --panel --panel-2 --border --text --muted --green --green-bg --red --red-bg --accent --yellow --radius --gap --font --font-mono`
  (A9 also defines `--panel-3 --border-strong --grid --accent-bg --yellow-bg --text-dim --radius-sm --shadow --header-h`).
  Shared utility classes (A9): `.panel`, `.panel-title`, `.btn`, `.btn-primary`, `.btn-danger`, `.btn-ghost`, `.badge`,
  `.pos` (green text), `.neg` (red text), `.flat`, `.muted`, `.mono`, `.grid-2`, `.table` (compact data table), `.stat` / `.stat-label` / `.stat-value`, `.form-row`, `.input`, `.select`, `.spinner`.
* Must work at 1280–1920px wide; stack panels on narrow screens (≤ 900px).
* Tests: `tests/frontend/*.test.ts` run in vitest's **Node** environment (no browser, no jsdom).
  `tests/frontend/helpers.ts` loads the browser modules from `public/` by absolute path (`loadPublic`) and provides a
  fake bus (`makeBus`, same semantics as `bus.js`) and a minimal fake DOM (`fakeNode`). Pure logic
  (`backtestLogic.js`, `settingsLogic.js`, `killOutcome`, `accountReturns`, `unsellableWhy`, `api.js`) is tested
  directly; panels (`backtest`, `settings`, `signals`, `equity`, header alerts, tables) are mounted against the fakes.
  Keep new UI logic in such pure modules so it can be tested the same way.
