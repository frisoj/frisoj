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
`sleep`, `mulberry32(seed)` (deterministic PRNG), `hashString(s)`. The exchange
minimum has exactly one rule, in `src/exchange/minimums.ts` (see
[Exchange minimum and pending exits](#exchange-minimum-and-pending-exits)).

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
 While the engine is NOT running, a light price monitor (startPriceMonitor)
 only refreshes prices + equity and emits "price" / "snapshot" events.
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
* While stopped (before the first Start, after Stop, after the kill switch) there
  are no ticks; the price monitor refreshes prices only (see A7). Stops and
  take-profits are NOT evaluated then.

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

* **One rule for the exchange minimum** (`src/exchange/minimums.ts`, used by
  `PaperBroker`, `LiveBroker`, the backtest simulator, the `RiskManager` and
  `BitvavoClient.markets()`; the engine's `exchangeMinimums()` applies the same
  rule inline):
  * `exchangeMinQuote(info)` = `MarketInfo.minOrderQuote` when it is finite and
    `> 0`, otherwise `EXCHANGE_MIN_ORDER_QUOTE` (€5, `src/core/defaults.ts`). A
    missing MarketInfo or a missing, NaN, 0 or negative value means **unknown**,
    never "no minimum";
  * `exchangeMinBase(info)` = `MarketInfo.minOrderBase` when finite and `> 0`,
    otherwise 0 (then only the EUR minimum counts).
* The exchange minimum applies to buys **and** sells. `risk.minOrderQuote` is a
  user setting that only adds an extra floor for entries
  (`minOrder = max(exchangeMin, risk.minOrderQuote)` in `planEntry`); it never
  lowers or replaces the exchange minimum in brokers, engine or backtest.
  `exchangeMinOrderQuote()` / `DEFAULT_EXCHANGE_MIN_QUOTE` in the simulator are
  aliases of the same rule. The dashboard mirrors it (`EXCHANGE_MIN_EUR` = 5 in
  `header.js` / `tables.js`; per-market values from `/api/markets` when valid).
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
  `pendingExit` and the position gets an unsellable record of kind `"engine"`.
  A broker rejection whose `error` starts with `"ONVERKOOPBAAR:"` (the brokers'
  own minimum check, or Bitvavo code 217/212 / a "minimum" message relayed by
  the `LiveBroker`) gives a record of kind `"broker"` with the refused position
  value. With a pending exit the engine evaluates no stops, targets or signals
  for that position and retries the sell on every tick.
* **Hysteresis** (`UNSELLABLE_HYSTERESIS` = 1.01, `REFUSAL_RETRY_MS` = 5 min), so a
  price wobbling around €5 cannot cause a stream of orders or log lines:
  * own check: the sell is sent as soon as `amount × price >= minimum`, but the
    "onverkoopbaar" episode (and the "weer verkoopbaar" log line) only ends at
    ≥ 1% above the minimum;
  * after a broker refusal the engine re-sends **automatically** only when
    `amount × price >= max(highest refused value, minimum) × 1.01`, and at most
    once per 5 minutes per position. A `"broker"` record is never replaced by an
    `"engine"` record (a dip below the minimum keeps the highest refused value);
    it is only cleared by a successful (partial) sale;
  * explicit user actions (`closePosition`, `killSwitch`) always try at once;
  * the "onverkoopbaar" message is logged once per episode (and for every
    explicit action), not every tick.
* The snapshot shows `OpenPositionView.unsellable` / `unsellableReason`,
  evaluated against the **current** price (`unsellableNow`: own check plus a
  broker refusal still in force). The reason only promises an automatic sale
  when the bot is running and (live) armed; otherwise it says what the user can
  do (start/arm the bot, close manually or write off). The user can
  `writeOffPosition(id)` (see A7).
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
| `KillResult` | `{ closed, failed[] }` | Result of the kill switch: number of positions sold and every position (or unknown buy order) that was NOT closed, with a Dutch reason (a position written off meanwhile is listed as failed, "afgeschreven: …"). |
| `AccountState` | `totalPnlQuote?`, `dayPnlQuote?`, `totalReturnPct?`, `dayReturnPct?` | Result in EUR and % computed by the engine (see [Ledger, capital limit & returns](#ledger-capital-limit--returns)): correct after skimming and after a changed capital limit. The UI always prefers them. |
| `OpenPositionView` | `unsellable?`, `unsellableReason?` | The position cannot be sold right now (below the exchange minimum, or a broker refusal still in force), with a Dutch explanation. |
| `EquityPoint` | `skimmed?` | Live: **net transfers out** of the trading budget at that point (skimmed profit + capital returned by a lower limit − capital added by a higher limit). Charts show `equity + skimmed`, so a transfer is never a jump or a dip. |
| `BacktestResult` | `note?` | Dutch explanation when the period was shortened (short history). |
| `BacktestResult` | `stuckTrades?` | Trades whose sell was first refused because the position was worth less than the minimum. |
| `Heatmap` | `best?`, `tested?`, `scored?`, `positive?` | Per cell: best score, sampled combinations, combinations with enough trades, profitable ones. `values` itself is the **median** of the scored combinations (null = not tested or too few trades). |
| `AppInfo` | `paperStartingCapital?` | Starting capital of paper mode (what `POST /api/paper/reset` resets to). |

`ExitReason` also has the member `"write-off"` (an unsellable position written off by
the user; nothing was sold). Consumers that map exit reasons must handle it
(`EXIT_REASON_LABELS` in `src/engine/format.ts`: "afgeschreven"; `public/js/format.js`:
"Afgeschreven").

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
* `src/exchange/minimums.ts` — `exchangeMinQuote(info?): number` (valid `minOrderQuote` > 0, else `EXCHANGE_MIN_ORDER_QUOTE` = 5),
  `exchangeMinBase(info?): number` (valid `minOrderBase` > 0, else 0). The single exchange-minimum rule; see
  [Exchange minimum and pending exits](#exchange-minimum-and-pending-exits).
* `src/exchange/bitvavoClient.ts` — `export class BitvavoClient`:
  ```ts
  constructor(opts?: { apiKey?: string; apiSecret?: string; baseUrl?: string; accessWindow?: number;
                       operatorId?: number; fetchImpl?: typeof fetch; now?: () => number; timeoutMs?: number;
                       maxRetries?: number; retryBaseDelayMs?: number; sleep?: (ms: number) => Promise<void>; autoTimeSync?: boolean })
  readonly hasCredentials: boolean
  rateLimitRemaining: number | null
  rateLimitFor(scope: "public" | "private"): RateLimitStatus
  time(): Promise<number>; syncTime(): Promise<number>
  markets(): Promise<MarketInfo[]>   // minOrderQuote via exchangeMinQuote: missing / ≤ 0 → 5
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
    shortfall ≤ 5%) is **not sent**: `"rejected"` with `error` starting with **`"ONVERKOOPBAAR:"`**. When Bitvavo
    itself refuses a sell as below the minimum (code 217 / 212, or — without a known code — a message about the
    minimum; never on an unknown outcome), the result is the same `"ONVERKOOPBAAR:"` rejection (the engine then
    applies its hysteresis). A buy below the minimum is a plain `"rejected"`;
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
    `exchangeMin` = `exchangeMinQuote(market)` (valid `MarketInfo.minOrderQuote` > 0, otherwise €5 — never `risk.minOrderQuote`),
    `minOrderBase` = `exchangeMinBase(market)`; `minOrder = max(exchangeMin, risk.minOrderQuote)` (the setting can only raise the entry floor);
  * a smaller risk-sized position is raised to that size ("opgehoogd naar minimum") **only** if it fits the position,
    exposure and cash caps **and** its risk stays ≤ 1× the risk budget (`MAX_BUMP_RISK_MULTIPLE = 1`); otherwise the entry is rejected.
    The risk per trade is never exceeded to reach the minimum.
* `haltStatus` returns `dailyLimit: true` for the daily loss limit (the engine then keeps the halt until the day rollover).
  It compares `account.equity` with `account.dayStartEquity`; the engine passes a day-start value chosen so that this
  percentage equals its own `dayReturnPct` (see [Ledger, capital limit & returns](#ledger-capital-limit--returns)).
* `updatePosition`: see [Stop raises](#stop-raises-riskmanagerupdateposition).
* Tests: `tests/risk/*.test.ts`.

### A5 — Backtester, metrics, optimizer, walk-forward, CLI
Each part is split into a dependency-free core (everything injected, unit-testable on its own) and a thin public
entry point that wires in the real `runEnsemble` / `RiskManager` / strategies.
* `src/backtest/metrics.ts` — `export function computeMetrics(args: { trades: Trade[]; equityCurve: EquityCurvePoint[]; initialCapital: number; interval: Interval; candles: Candle[]; takerFee: number; exposureCandles: number }): BacktestMetrics`.
* `src/backtest/simulator.ts` (core) — `BacktestInput`, `BacktestDeps`, `simulate(input, decisions, risk, opts?)`,
  `runBacktestWith(input, resolvedDeps, opts?)`, `effectiveSlippagePct`, `withSpreadCosts`, `spreadFromTicker`,
  `exchangeMinOrderQuote` (= `exchangeMinQuote`), `DEFAULT_EXCHANGE_MIN_QUOTE` (alias of `EXCHANGE_MIN_ORDER_QUOTE`, 5),
  `aggregateCandles`, `MAX_CHART_CANDLES` (1500).
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
  minOrderQuote?: number /* exchange minimum, default EXCHANGE_MIN_ORDER_QUOTE (5); invalid or ≤ 0 → 5 — never risk.minOrderQuote */;
  getMarketInfo?: (market) => MarketInfo | undefined | Promise<…> /* per-market minimums, same rule */ })` (main.ts passes no
  `getMarketInfo`: paper uses a flat €5),
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
    start(): Promise<void>                    // throws "Starten geblokkeerd: noodstop bezig …" while a kill runs
    stop(): Promise<void>; tick(): Promise<void>
    startPriceMonitor(): Promise<void>        // price refresh while stopped; refreshes once immediately (main.ts)
    stopPriceMonitor(): void                  // shutdown
    snapshot(): EngineSnapshot
    updateConfig(partial: Partial<EngineConfig>): EngineConfig
    closePosition(id: string, reason?: ExitReason): Promise<Trade | null>   // null → Dutch reason in lastCloseFailure
    killSwitch(): Promise<KillResult>
    writeOffPosition(id: string): Promise<Trade>  // async (fresh price / balance); rejects "Afschrijven kan …" when not allowed (now)
    acknowledgeUnknownOrders(): void          // user checked Bitvavo: lift the entry block
    acknowledgeStateRecovery(): void          // user checked balances after an unusable state file
    arm(): void                               // throws "Armen geblokkeerd: …" while stateRecovery is unacknowledged or a kill runs
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
  * **Ledger, capital limit & returns**: see [below](#ledger-capital-limit--returns).
  * **Stop / kill**: `stop()` and `killSwitch()` bump a stop generation synchronously; a tick requested before that
    opens no new positions any more, even halfway through.
  * **Price monitor while stopped** (`startPriceMonitor()`, called once by main.ts; `stopPriceMonitor()` on shutdown):
    while the engine is not running (before the first Start, after Stop, after the kill switch) it runs every
    `pollMs` and ONLY fetches `feed.getPrice` for the configured markets and the markets with open positions,
    updates equity / unrealised P&L, records an equity point (throttled) and emits `price` + `snapshot`. No
    decisions, no orders, no balance calls. The first refresh runs immediately, so positions restored from disk
    are not valued at entry price for long. It pauses while the engine runs (the tick does this) and skips a round
    while a tick is in flight.
  * **Equity points** (`recordEquity`): at most one per minute (forced on every booked trade), at most 2000
    (thinned, the newest kept), and **never** while an open position has no fetched price yet — such a point would
    value it at entry price forever (it is skipped; the point after a limit rebase is deferred until prices are known).
  * **Unknown buy outcome** (live): no retry and no position; ALL new entries pause (persisted `unknownOrders`)
    until `broker.lookupOrder` finds the order (the filled part is booked as a position with a stop; a partial,
    still-open fill is booked right away), Bitvavo reports it as not found (see the rule below, = not placed), or
    the user calls `acknowledgeUnknownOrders()` (coins bought by such an order are then NOT managed).
  * **Unknown sell outcome** (live): never a second sell for that position until resolved (persisted `unknownSells`),
    via `lookupOrder` (same "not found" rule), or — without it — once no coins of that asset sit in an open order.
  * **"Not found" rule** (buys and sells, time-based): a `null` from `lookupOrder` is only **counted** when the
    previous counted one is at least `pollMs / 2` ago (so a quick Stop/Start or a restart adds nothing; `nullCount`
    and `nullAt` are persisted). The order counts as not placed after ≥ `NOT_FOUND_CONFIRMATIONS` (3) counted
    observations in a row **and** at least `max(60 s, 3 × pollMs)` after the outcome became unknown (`at`). A
    lookup that throws, or an answer that is still open/unknown, resets the count. The kill switch and
    `closePosition` look orders up without counting nulls.
  * **Coins missing on Bitvavo**: only booked as sold after two observations (two ticks, or two balance reads for an
    explicit close); a missing part is booked separately; coins stuck in an open order are not sold (the exit
    stays pending) and are never booked as gone.
  * **Unsellable positions**: see [Exchange minimum and pending exits](#exchange-minimum-and-pending-exits).
  * **Write-off** (`writeOffPosition(id): Promise<Trade>`, async):
    * refused (rejects `"Afschrijven kan …"`, route → 409) while a kill runs, while a `closePosition` for that
      position is requested or running, while any broker order is in flight, or while an unknown-outcome sell for it
      is pending — checked before and again after the awaits below;
    * right before deciding it fetches a **fresh price** (`feed.getPrice`; none → refused, "probeer het zo
      opnieuw") and, live, a **fresh balance** (`broker.getBalances`; unreadable → refused; less than 95% of the
      amount available → refused with "sluit de positie in plaats daarvan", because closing updates the ledger);
    * only allowed when the position is unsellable on that fresh data (own minimum check on
      `min(amount, available)`, or a broker refusal still in force); otherwise refused with the current value
      ("… kan gewoon verkocht worden: sluit de positie");
    * books a `Trade` with `exitReason: "write-off"`, `proceedsQuote` 0, `pnlQuote = −costQuote`, `pnlPct −100`,
      `feesQuote` = entry fee, `exitPrice` = the fresh price. It is a **realised loss**: `realizedPnl` and
      `realizedPnlToday` drop by the cost and `lastLossAt[market]` is set (cool-down). Cash is unchanged and the
      coins stay on the account; equity loses the position's value, so the write-off can trip the **daily loss
      limit** (on the next halt check). `tradesToday` is not changed;
    * the id is remembered (`writtenOff`): a racing `closePosition` / `killSwitch` never reports it as sold
      (`lastCloseFailure` / `KillResult.failed`: "afgeschreven: er is niets verkocht, de coins staan nog op je account").
  * **Kill switch**: synchronously increments `killsInProgress`, stops (stop generation, timer) and disarms. While a
    kill runs, `arm()` throws "Armen geblokkeerd: noodstop bezig …", `start()` throws "Starten geblokkeerd: noodstop
    bezig …" and `writeOffPosition` is refused. Under the lock it resolves unknown buys/sells ("not found" is not
    counted), sells every position explicitly at a fresh price (fallback: last known price) and returns a `KillResult` with every position still
    open, every position written off meanwhile and every still-unknown buy order in `failed` (Dutch reasons:
    unsellable, rejected, unknown outcome, coins in an open order, afgeschreven, …). In `finally` it calls `stop()`
    and then sets `armed = false` again: **a kill always ends stopped and disarmed**, also when a sell fails or
    something throws. The error log only says "sluit handmatig" when something other than unsellable/written-off
    positions failed. After the kill the price monitor resumes.
  * **Daily loss limit** stays in force until the day rollover (persisted `haltedDayKey`), even if positions recover.
    The rollover waits for a current price of every open position.
  * **Unusable state file**: the engine starts with an empty ledger, sets `stateRecovery` (persisted) and blocks
    `arm()` until `acknowledgeStateRecovery()`, which also unblocks the store's writes. The paper-mode message does
    not mention Bitvavo balances.
  * Broker costs follow the risk settings (`broker.setCosts`) on construction, `start()` and every `updateConfig`.

#### Ledger, capital limit & returns

The engine keeps its own ledger (cash, positions) in both modes. Money moved into or out of the trading budget is a
**deposit / withdrawal, never profit or loss**.

* `account.startingEquity` = **capital given to the bot**: the paper start capital or the live `CAPITAL_LIMIT_EUR`,
  plus the fresh part of later limit raises. Skimming never lowers it.
* Live: cash + cost of open positions stays within the limit. After every booked exit, `enforceCapitalLimit` moves
  the cash above `limit − openCost` out of the budget: first as **capital returned** (`capitalReturned`,
  `returnedToday`) up to `capitalPending` (capital that was in open positions above a lowered limit), the rest as
  **skimmed profit** (`skimmedQuote`, `skimmedToday`; the dashboard's "afgeroomd"). `capitalPending` is dropped once
  no positions remain (what did not come back was a loss). Paper mode has no limit and no transfers.
* **Limit changed between runs** (`rebaseCapitalLimit` on restore, persisted `capitalLimitQuote`):
  * raise → cash grows by `delta = min(raise, max(0, room − cash))` (room = `limit − openCost`). The delta first
    re-deposits capital that went back by earlier lowerings (`capitalReturned −= min(delta, capitalReturned)`); only
    the rest is new capital (`capitalAdded +=`, `startingEquity +=`). For the day, it first cancels `returnedToday`;
    the rest is added to `addedToday`;
  * lower → the budget becomes min(new limit, what the bot has): cash drops to at most `room`, the difference is
    `capitalReturned` / `returnedToday`; cost in open positions above the new limit becomes `capitalPending`;
  * same limit → no-op (also with negative cash from a late-filled buy: that is never a deposit);
  * a lower → raise round trip therefore never dilutes the daily or total %.
* **Returns** (`updateEquity`):
  * `totalPnlQuote = equity + skimmedQuote + capitalReturned − startingEquity`;
    `totalReturnPct = totalPnlQuote / startingEquity × 100`;
  * `dayPnlQuote = equity + skimmedToday + returnedToday − addedToday − dayStartEquity`;
    `dayReturnPct = dayPnlQuote / dayBase × 100` with `dayBase = dayStartEquity + addedToday − returnedToday`
    (the capital actually traded today: a mid-day lowering shrinks the base);
  * the risk manager gets `AccountSnapshot.dayStartEquity = riskDayStartEquity()`, chosen so that its
    `(equity − E) / E` equals `dayReturnPct`: the halt uses the same % as the dashboard, and a transfer is never
    counted as a loss (skimming never trips the daily limit; a lower limit only makes an existing loss a larger %
    of the smaller budget that is actually traded);
  * `EquityPoint.skimmed` (live) = net transfers out = `skimmedQuote + capitalReturned − capitalAdded`; charts show
    `equity + skimmed`. After a rebase a new point is recorded once every open position has a real price.
  * Paper: `totalPnlQuote = equity − startingEquity`, `dayPnlQuote = equity − dayStartEquity`.

#### Persisted state

* `PersistedState` (`version: 1`): the required fields plus the optional `capitalLimitQuote`, `lastEvaluated`
  (per interval), `unknownOrders` (with `stopDist`, `tpDist`, `entryReason`, `positionId`, `bookedAmount`),
  `haltedDayKey`, `skimmedQuote`, `stateRecovery`. Engine-only extras (not in `types.ts`, older files load fine):
  `unknownSells`, `skimmedToday`, `ledgerVersion` (2 = `startingEquity` is the capital given to the bot),
  `capitalAdded` / `addedToday`, `capitalReturned` / `returnedToday`, `capitalPending`, and per unknown order
  `nullCount` / `nullAt` (not-found observations) and `bookedQuote` / `bookedFee` (part already booked). Paper mode
  also stores `paperBalances`. File: `<DATA_DIR>/state-<mode>.json`.
* A file without `ledgerVersion` (older rounds lowered start and day-start equity by the skimmed profit) is
  converted on load: `startingEquity += skimmedQuote`, `dayStartEquity += skimmedToday`. When the old value was
  clamped (≤ 1e-6, round 2), the persisted `capitalLimitQuote` (fallback: the configured limit) is used instead and
  a warning says the total return is an estimate.

#### Engine tests

* `tests/engine/*.test.ts` (use PaperBroker/SimulatedFeed if present, otherwise inline fakes; inject `decide` for deterministic behaviour;
  `round3Safety` / `round4Safety` hold the review repro scenarios as regression tests).

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
* `src/main.ts` — builds feed, broker (PaperBroker after `repairRiskConfig`, without `getMarketInfo`; LiveBroker +
  `syncAccountFees`, which copies the account's real fees into the risk config and the broker), `StateStore`,
  `TradingEngine` (+ `attachTerminalLog`), starts the price monitor (`engine.startPriceMonitor()`, one refresh right
  away), the heavy-job runner and the HTTP server; graceful shutdown via `src/server/shutdown.ts` (stops the monitor,
  the worker and the engine; live: waits up to 90 s while `engine.orderInFlight`). The temporary live-mode block
  used during the code review has been removed after the review closed (see `docs/REVIEW-STATUS.md`).
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
  `acknowledgeUnknownOrders`, `acknowledgeStateRecovery` and `writeOffPosition` optional (missing → 501), accepts a
  `writeOffPosition` that returns a `Trade` or a `Promise<Trade>` and a `killSwitch()` that returns nothing (older fakes).
* Serves `public/` statically and `/vendor/lightweight-charts.js` from
  `node_modules/lightweight-charts/dist/lightweight-charts.standalone.production.js`. Non-API paths accept only GET/HEAD.
* Security (`httpServer.ts`):
  * More than one `Host` header → 400 (counted in `req.rawHeaders`; Node would silently keep the first).
  * Binds to `127.0.0.1` by default. When bound to loopback, the `Host` header must be an exact loopback name
    (DNS-rebinding protection; missing `Host` → 400, other → 403).
  * For **every** `/api/*` request, whatever the method (GET and SSE included — the scanner and candles share the
    Bitvavo rate limit with stop-loss orders): `Sec-Fetch-Site` other than `same-origin`/`none` → 403, and an
    `Origin` of `"null"` or with a host different from the `Host` header → 403. Requests without these headers
    (curl, scripts) are allowed.
  * If `DASHBOARD_TOKEN` is set, every `/api/*` request needs header `x-dashboard-token` (or `?token=` for
    `/api/events` only), compared in constant time (missing or wrong → 401).
  * Security headers (CSP `default-src 'self'`, `frame-ancestors 'none'`, nosniff, no-referrer, …),
    `Cache-Control: no-store` on the API, JSON bodies max 1 MB (413), non-finite numbers serialized as `null`.
* API (all JSON; errors → `{ error: string }` with proper status):

  | Method | Path | Body / query | Response |
  |---|---|---|---|
  | GET | `/api/info` | | `AppInfo` |
  | GET | `/api/state` | | `EngineSnapshot` |
  | GET | `/api/events` | SSE | `ServerEvent` stream (`event: <type>`, `data: <json>`), sends a `snapshot` immediately, heartbeat comment every 15s (HEAD → 405) |
  | GET | `/api/config` | | `EngineConfig` |
  | PUT | `/api/config` | `Partial<EngineConfig>` (risk/ensemble may be partial) | `EngineConfig` (validated, persisted to `<dataDir>/config.json`; 500 if active but not saved) |
  | POST | `/api/engine/start` | | `EngineSnapshot` (409 "Starten geblokkeerd: noodstop bezig …" while a kill runs) |
  | POST | `/api/engine/stop` | | `EngineSnapshot` (the price monitor takes over) |
  | POST | `/api/engine/kill` | | `EngineSnapshot & { killResult?: KillResult }` — **200 also when positions could not be sold**; the UI shows `killResult.failed` |
  | POST | `/api/positions/:id/close` | | `Trade` (404 unknown id; 409 not closed, with the engine's Dutch `lastCloseFailure`, e.g. "onverkoopbaar: …" or "positie is afgeschreven …") |
  | POST | `/api/positions/:id/writeoff` | | `Trade` with `exitReason: "write-off"` (awaits the async engine, which fetches a fresh price and, live, a fresh balance; 404 unknown id, 409 "Afschrijven kan …" — e.g. sellable again, kill running, price/balance unavailable; 501 engine without write-off) |
  | POST | `/api/live/arm` | `{ confirm: "IK BEGRIJP HET RISICO" }` | `AppInfo` (400 in paper mode, wrong text or no API keys; 409 "Armen geblokkeerd …" while a state recovery is unacknowledged or a kill runs) |
  | POST | `/api/live/disarm` | | `AppInfo` |
  | POST | `/api/live/unknown-orders/ack` | | `EngineSnapshot` (lifts the entry block after the user checked Bitvavo; 501 if unsupported) |
  | POST | `/api/state/recovery/ack` | | `EngineSnapshot` (acknowledges an unusable state file; arming allowed again; 501 if unsupported) |
  | POST | `/api/paper/reset` | `{ startingCapital? }` (5 – 10 000 000, default `PAPER_STARTING_CAPITAL`) | `EngineSnapshot` (400 in live mode) |
  | GET | `/api/markets` | | `MarketInfo[]` (quote EUR, status trading, sorted) |
  | GET | `/api/candles` | `market, interval, limit` (limit clamped to 50–1000; unknown market → 400) | `CandlesResponse` |
  | GET | `/api/scanner` | `limit` (positive integer, default 30, max 60) | `ScannerRow[]` (top-N EUR markets by 24h volume, cached 60s) |
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
`public/js/header.js`, `public/js/tables.js`, `public/js/tradeNotify.js`, `public/js/log.js`, `public/favicon.svg`.
* `header.js` — stats, bot controls, mode banner and the **alert banners** (`#alert-banners`): "Onbekende
  orderuitkomst" (`snapshot.unknownOrders`, button "Ik heb het gecontroleerd" → `POST /api/live/unknown-orders/ack`)
  and "Opgeslagen staat was onbruikbaar" (`snapshot.stateRecovery` → `POST /api/state/recovery/ack`). Exports
  `killReport(res, fmt, minFor?, openBefore?)` / `killOutcome(…)` (structured result and Dutch toast text from the kill
  response, listing `killResult.failed`; `minFor` = exchange minimum as a number, Map or function, invalid → €5) and
  `accountReturns(snap)` (the engine's `totalPnlQuote` / `dayPnlQuote` / `totalReturnPct` / `dayReturnPct`; own
  computation only for an older server). The "Equity" card shows the start capital (paper) or the limit and the skimmed amount (live).
* `tables.js` — open positions (badge "Onverkoopbaar" from `unsellable`/`unsellableReason`, buttons "Sluit" and
  "Afschrijven" → `POST /api/positions/:id/writeoff`) and trades ("Afgeschreven" for `exitReason: "write-off"`).
  The write-off modal says the loss counts as today's realised loss (daily loss limit, market cool-down), shows a
  busy state while the server fetches a fresh price, and handles a 409 "weer verkoopbaar". Exports `unsellableWhy(p)`,
  `closeRefusalInfo(err, p, snap, fmt)` (Dutch explanation after "Toch proberen te verkopen" on a dust position; only
  promises an automatic sale when the bot runs and, live, is armed) and `writeOffRefusalInfo(err, p, fmt)`.
* `tradeNotify.js` — `closedTradeMessage(t, fmt, mode)` and `createTradeNotifier(toast, fmt, getMode)`: one toast per
  trade id, whether it arrives via SSE `position-closed` or as the response of a close / write-off.

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
* Use the engine's numbers where they exist: `account.totalPnlQuote` / `dayPnlQuote` / `totalReturnPct` /
  `dayReturnPct` for results (percentages against `startingEquity` = capital given to the bot, resp. the capital
  traded today), `equity + skimmed` per point for equity curves (`skimmed` = net transfers out, so skimming or a
  changed limit is no jump), `unsellable` / `unsellableReason` for positions, `killResult.failed` after a kill.
  The equity panel's "Max. daling" (`equityFigures` / `maxDrop` in `equity.js`) is the largest peak-to-trough drop of
  the cumulative result in EUR, and as % of `startingEquity`.
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
  (`backtestLogic.js`, `settingsLogic.js`, `killReport` / `killOutcome`, `accountReturns`, `unsellableWhy`,
  `closeRefusalInfo`, `writeOffRefusalInfo`, `tradeNotify.js`, `equityFigures`, `api.js`) is tested
  directly; panels (`backtest`, `settings`, `signals`, `equity`, header alerts, tables) are mounted against the fakes.
  Keep new UI logic in such pure modules so it can be tested the same way.

## v2 — Veel munten (tot 400), automatische muntkeuze, trendfilter, spreadlimiet, kansen-ranglijst, munten-radar

Everything in this section is **binding** for v2. Contract additions are in `src/core/types.ts` /
`src/core/defaults.ts` (all optional fields, see the JSDoc there). Pure, already tested modules (use them, do
not change their behaviour without a very good reason; if you must, update their tests):

* `src/strategies/trendFilter.ts` — `trendFilterActive(cfg)`, `trendStateAt(candles, interval, period, atMs)`,
  `trendGate(cfg, { market?, coin? }, atMs, coinMarket?)` → `{ allowed, reason?, market?, coin? }`,
  `describeTrend(who, state, cfg)`, `trendCandlesNeeded(cfg)` (= period + 5), `trendWarmupMs(cfg)` (= (period + 3) × interval).
  Only candles **closed at `atMs`** count; too little data = unknown = **not allowed** (fail-closed). The reason
  starts with `"Marktfilter: "` (Bitcoin) or `"Muntfilter: "` (the coin).
* `src/engine/universe.ts` — `selectUniverse(markets, tickers, cfg.universe, cfg.risk.maxSpreadPct)` →
  `{ markets (volume order, max count), eligible, excluded[] }`, `EXCLUDED_BASES` (stablecoins, gold, wrapped BTC/ETH),
  `tickerSpreadPct(ticker)` (% of mid, null = unknown).
* `src/engine/ranking.ts` — `rankCandidates(candidates)` (score in 0.05 buckets desc → relative strength desc →
  24h volume desc → name), `relativeStrengthPct(coinChangePct, btcChangePct)`, `EntryCandidate`.

New defaults: `DEFAULT_ENSEMBLE_CONFIG.trendFilter = DEFAULT_TREND_FILTER` (`{ market: true, coin: false, interval: "1d", period: 50 }`),
`DEFAULT_RISK_CONFIG.maxSpreadPct = 0.3` (percent), `DEFAULT_ENGINE_CONFIG.universe = DEFAULT_UNIVERSE_CONFIG`
(`{ mode: "auto", count: 30, minVolumeEur: 250_000 }`), `MAX_MARKETS = 400`, `MARKET_FILTER_MARKET = "BTC-EUR"`.
`EngineConfig.markets` stays the user's own list (1..400) in every mode. A config **without** `universe` is manual;
an ensemble **without** `trendFilter` has no trend filter; a risk config **without** `maxSpreadPct` has no spread limit.
Tests that need the old behaviour set `universe: { mode: "manual", … }` / `trendFilter: { market: false, coin: false, … }`.

### Terms

* **active markets** — manual: `config.markets` (deduplicated, in order). auto: the last successful
  `selectUniverse` result (volume order). Before the first auto selection: `PersistedState.autoUniverse.markets`
  when it is < 24 h old, otherwise `config.markets`. Markets with an open position are always *processed*
  (exits, stops) even when they are not active; only active markets may be **bought**.
* **round** — per candle of the engine interval: `roundKey = floor(now / ms) × ms − ms` (open time of the newest
  closed candle). A market is **due** when it has not been fetched for the current `roundKey`.
* **candidate** — a buy decision (`action === "buy"`) for an active market without a position, not already traded
  (same rules as today's `tryEntry` pre-checks incl. `evaluatedBeforeRestart`).
* **gates** — in this order: trend filter (`trendGate`), spread (`risk.maxSpreadPct`), then everything `tryEntry`
  already checks (halt, unknown orders, risk plan, cash…). Gates only block **new buys**; exits are never blocked.

### Engine (`src/engine/tradingEngine.ts`)

Constants (exported): `SCAN_CONCURRENCY = 4`, `SCAN_BATCH_PER_TICK = 80`, `ENTRY_ROUND_MAX_WAIT_MS = 180_000`,
`TICKERS_REFRESH_MS = 60_000`, `UNIVERSE_REFRESH_MS = 3_600_000`, `SNAPSHOT_DECISIONS_LIMIT = 40`,
`TREND_RETRY_MS = 300_000`, `FETCH_RETRY_MS = 60_000`.

`runTick(now)`, after the existing preamble (unknown orders, rollover, markets, halt):
1. **Universe** (auto only): (re)select when never selected, every `UNIVERSE_REFRESH_MS`, or after a change of
   `config.universe` / `risk.maxSpreadPct` / mode: `feed.getMarkets()` + `feed.getTickers24h()` → `selectUniverse`.
   Error or empty result → keep the previous set (or `config.markets`), `universe.note` in Dutch, throttled warn log.
   When the set changes: one info log, e.g. `Automatische muntkeuze: 30 munten (meeste handel) — erbij: A, B; eraf: C`
   (max ~8 names per list, then "+N"). Persist `autoUniverse`.
2. **Prices**: `feed.getPrices?.()` once per tick when available → `this.prices` for active + position markets.
   No per-market `"price"` events for these bulk prices (the snapshot carries them).
3. **Tickers**: `feed.getTickers24h()` at most every `TICKERS_REFRESH_MS` (radar: 24h change, volume, spread;
   ranking: relative strength vs `MARKET_FILTER_MARKET`). Failure → keep the old ones.
4. **Market filter** (when `trendFilter.market`): candles of `MARKET_FILTER_MARKET` on `trendFilter.interval`
   (`getCandles(…, trendCandlesNeeded(tf))`, keep only closed ones). Refetch when a newer candle of that interval
   has closed since the last fetch; after a failure retry at most every `TREND_RETRY_MS`. Keep `MarketFilterView`
   for the snapshot (`note` from `describeTrend`).
5. **Held markets** (open position or unknown sell): `processMarket` every tick, sequentially, exactly as today.
6. **Due active markets** (not held), in active order, at most `SCAN_BATCH_PER_TICK` per tick: fetch candles with
   at most `SCAN_CONCURRENCY` requests in parallel (**I/O only**), then process them **sequentially** (all state
   changes stay sequential, as today). Stop early when the engine is no longer running. A market is done for the
   round once fetched — also when Bitvavo has no candle for that period (illiquid coins) — or when the fetch
   failed (retry after `FETCH_RETRY_MS`, counts as done for round completion, radar `"error"`). Exception: a fetch
   within 30 s after the candle closed whose newest closed candle is older than `roundKey` gets **one** retry on a
   later tick.
7. `processMarket` no longer buys directly: a buy decision becomes a **candidate** in the pool (`market → decision`).
   Sell signals, stops, pending exits: unchanged.
8. **Opportunity round**: when no active market is due anymore (round complete), or `ENTRY_ROUND_MAX_WAIT_MS` after
   the round started, flush the pool:
   * drop candidates whose signal is too old (`now > decision.time + 2 × ms`, radar note "signaal verlopen");
   * `rankCandidates` (relative strength from the tickers: coin `changePct` − BTC `changePct`; volume from the tickers);
   * for each candidate in rank order: stop when buying is no longer possible (`!buyAllowed()`, halted, or
     `positions.length >= risk.maxOpenPositions`) — the rest stay `"candidate"` with note
     `Koopsignaal, maar geen vrije plek (max. N posities)`; otherwise apply the **trend gate**
     (`atMs = decision.time + ms`; coin candles fetched lazily per market and cached like the market filter),
     then the **spread gate** (`feed.getOrderBook(market, 1)`: spread % = (ask − bid) / mid × 100 > `maxSpreadPct`
     → blocked `Spread te groot (0,62% > 0,30%)`; book not available → blocked `Spread onbekend (orderboek niet
     opgehaald)`), then `tryEntry(market, decision, this.prices[market] ?? decision.price, now)`;
   * a rejection by a gate or by `tryEntry` → radar `"blocked"` with the Dutch reason (store the last rejection
     message per market, e.g. from `logRejection`);
   * **logging**: market-filter blocks are logged **once per round** (`Marktfilter: 5 koopsignalen genegeerd —
     Bitcoin staat onder …`), not per market; other rejections as today (deduplicated per market and candle);
   * then `scan.candidates` = number of candidates in this round, `lastRoundCompletedAt = now`, clear the pool.
   With ≤ 80 active markets the whole round (incl. entries) happens in one tick, so behaviour for small universes
   is the same as before, except that the best candidate goes first.
9. `stop()`, `killSwitch()`, `resetPaper()`, an interval change: clear the pool and the round state.

Snapshot (`snapshot()`): `activeMarkets`, `radar` (one row per active market plus position markets; status
priority: position > blocked/candidate (current round only) > error > watching > pending), `marketFilter`
(null when `trendFilter.market` is off), `universe` (`UniverseView`), `scan` (`ScanProgress`). `decisions`: all
markets when there are ≤ `SNAPSHOT_DECISIONS_LIMIT` active markets; otherwise only markets with an open position,
decisions with `action !== "hold"`, and the first `SNAPSHOT_DECISIONS_LIMIT` active markets. New public method
`decisionFor(market: string): EnsembleDecision | null` (last decision of any market). `"decision"` and `"candle"`
events: as today (only for markets whose candles were fetched this tick).

Also: `refreshPricesWhileStopped` uses `getPrices` when available (one request); otherwise only position markets
and the first 40 active markets. `reconcileLiveBalances` loops over the active markets. `updateConfig` with a
changed `universe` / `markets` / `risk.maxSpreadPct` forces a new universe selection on the next tick.

### Data feeds

`MarketDataFeed.getPrices?()` — `BitvavoFeed`: one `GET /ticker/price` without market (weight 1), concurrent
calls share one request, cached ~2 s; `SimulatedFeed`: all simulated markets. `SimulatedFeed` gets ~60 markets
(existing markets' price paths must stay **identical**) plus a stablecoin `USDC-EUR` so the auto selection can be
seen excluding it.

### Backtest

* `BacktestInput.trendCandles?: { market?: Candle[]; coin?: Candle[] }` (closed candles on `trendFilter.interval`,
  ascending, starting ≥ `trendWarmupMs(tf)` before the first trade candle). When `trendFilterActive(ensemble.trendFilter)`
  **and** `trendCandles` is given, a buy decision of candle `i−1` executed at the open of candle `i` is skipped when
  `trendGate(tf, input.trendCandles, decision.time + ms, input.market)` is not allowed. Not given → no trend filter,
  and `note` says `Trendfilter niet toegepast: geen koersdata voor het filter.`
* Spread: `risk.maxSpreadPct > 0` and `input.spreadPct × 100 > maxSpreadPct` → no entries at all, with a Dutch `note`.
* `BacktestResult.blockedEntries = { trend, spread }` (buy decisions that would otherwise have been tried).
  Present whenever the trend filter is active with data, or `maxSpreadPct > 0`.
* Optimizer and walk-forward go through `simulate`, so they get the same gates; `trendCandles` is passed along
  unchanged (time based, no slicing needed).
* `src/backtest/trendData.ts`: `loadTrendCandles(feed, market, tf, fromMs, toMs)` →
  `Promise<{ trendCandles?: { market?: Candle[]; coin?: Candle[] }; note?: string }>` — used by the API routes and the
  CLIs. Loads `MARKET_FILTER_MARKET` (when `tf.market`) and `market` (when `tf.coin`) with
  `feed.getHistory(m, tf.interval, fromMs − trendWarmupMs(tf), toMs)`; a failed load leaves that part out and adds a
  Dutch note (the gate then blocks, fail-closed, and the note says why).

### Config, validation, API

* `.env` `MARKETS`: `auto` (count 30) or `auto:N` (1..400) → `universe.mode = "auto"`; a comma list (1..400) →
  `universe.mode = "manual"` with that list; absent → defaults (auto, 30). Saved dashboard settings still win.
* Saved overrides (`config.json`) and `PUT /api/config` accept `markets` (1..400), `universe` (partial: `mode`
  "manual" | "auto", `count` integer 1..400, `minVolumeEur` 0..1e12), `ensemble.trendFilter` (partial: `market`,
  `coin` booleans, `interval` "4h" | "1d", `period` integer 5..200) and `risk.maxSpreadPct` (0..5). Backtest /
  optimize / walk-forward requests accept `ensemble.trendFilter` too. `mergeEngineConfig` merges `universe` and
  `ensemble.trendFilter` field by field.
* `GET /api/decision?market=BTC-EUR` → `{ decision: EnsembleDecision | null }` (`engine.decisionFor`).
* `loadHistory` (backtest / optimize / walk-forward) fills `input.trendCandles` via `loadTrendCandles` when the
  trend filter is active.

### Dashboard

* Wherever the UI means "the bot's markets" it uses `snapshot.activeMarkets ?? snapshot.config.markets`.
* **Munten-radar** (`public/js/panels/radar.js`, pure helpers in `public/js/panels/radarLogic.js`, container
  `#panel-radar`, own stylesheet `public/css/radar.css`): summary (number of coins, mode, buy signals,
  positions), market-filter badge, round progress, filter chips (Alles / Koopsignaal / In positie / Tegengehouden),
  search, sort (Kans / 24u % / Volume / Naam) and one tile per market (symbol, price, 24h %, score bar, status /
  rank / note). Clicking a tile selects the market. Must stay fast with 400 tiles (throttled, in-place updates).
* Live chart market bar: at most 12 tabs (selected market, position markets, best-ranked candidates, then active
  order) plus an "Alle munten (N)" button with a searchable list. Per-market extra requests (24h stats,
  sparklines) only for the visible tabs.
* Signals panel: when `snapshot.decisions[market]` is missing, fetch `GET /api/decision?market=`.
* Settings: section "Munten" (mode switch Automatisch / Zelf kiezen; auto: count 1..400 with quick buttons
  10 / 30 / 100 / 400 and minimum volume; manual: chips (collapsed above 30), search, "Alle markten toevoegen",
  "Alles wissen", counter N/400), section "Trendfilter" (Bitcoin filter, coin filter, Dag / 4 uur, period 5..200,
  plain Dutch explanation), risk field "Max. spread (%)" (0 = uit). Scanner: maximum 400; in auto mode adding a
  coin explains that the bot chooses automatically. Backtest: a "Trendfilter" toggle to compare with / without,
  and the result shows `blockedEntries`.

### v2 — changes after the round-5 review (binding, supersede the text above where they differ)

* **Tick order**: held markets (step 5) are processed **first**, right after the preamble, then steps 1–4
  (universe, bulk prices, tickers, market filter), then the scan and the opportunity round. When a tick has run
  longer than `min(pollMs, HELD_RECHECK_MS = 10 s)`, stops of open positions are re-checked after steps 1–4, after
  the scan and after the flush (one bulk-price request, or the position candles when the feed has no `getPrices`).
  A position whose candle fetch failed is still checked against the bulk price.
* **Scan time budget**: no new candle fetches after `SCAN_TIME_BUDGET_MS` (effective `min(pollMs, 10 s)`); the rest
  stays due for the next tick. Optional requests (scan candles, tickers, universe, trend candles, spread order book)
  are **fast**: no retries, 5 s timeout, no waiting on the rate limit. A rate-limited scan fetch stops the scan and
  is not an error. `BULK_RETRY_MS = 30 s` after a failed bulk-price request.
* **Rate-limit reserve for selling**: `BitvavoClient` public endpoints take an optional last argument
  `PublicRequestOptions { retries, noWait, timeoutMs, priority }`; `BitvavoFeed` methods take
  `FeedRequestOptions { fast, priority }` (other feeds ignore it; `MarketDataFeed` is unchanged). `priority` may use
  the public reserve down to `PRIVATE_RATE_LIMIT_FLOOR` (10) and is used for the fresh price of the kill switch,
  a manual close, a write-off, missing prices and held-market candles — so a stop-loss or kill switch never waits
  ~60 s for the public rate-limit reset.
* **Trend data freshness** (engine and backtest share `isTrendDataStale` / `trendGate(…, { rejectStale, staleGraceMs })`
  in `src/strategies/trendFilter.ts`): the newest trend candle may be missing only within `TREND_RETRY_MS` after it
  closed **and** only when the last fetch succeeded (engine); the backtest uses grace 0. Otherwise: no data → no buy.
  The dashboard's words for the 4-hour filter: "N blokken van 4 uur".
* **Opportunity round**: after every wait it stops when the round is no longer current (reset, interval change,
  stop/kill) and re-checks right before `tryEntry` that the market is still active; the trend-filter config is read
  per candidate.
* **Spread at the limit**: `spreadAboveLimit(pct, max)` with `SPREAD_EPS_PCT = 1e-9` (engine, universe selection and
  backtest agree); the notes never show two equal numbers.
* **Capacity warning**: when `floor(SCAN_BATCH_PER_TICK × interval / (pollMs + 3 s))` is below the number of active
  markets, `universe.note` says (in Dutch) that not every coin is evaluated every candle (also in manual mode).
* **Radar**: a buy decision without a current-round note shows as `"blocked"` with a note (e.g. after Stop → Start
  within the same candle).
* **Config**: a v1 `config.json` (markets, no `universe`) loads as **manual** with its saved list, with an info line
  at startup. In live mode the "coins the bot does not manage" check covers the auto-selected markets too.
* **Scanner**: skips `EXCLUDED_BASES` (stablecoins, gold, wrapped BTC/ETH), like the automatic selection.
