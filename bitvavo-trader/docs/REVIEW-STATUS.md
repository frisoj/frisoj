# Review-status (werk in uitvoering)

Dit bestand is de werklijst voor de volgende sessie. Zeven reviewers hebben de bot doorgelicht, elk vanuit een eigen invalshoek: geld-boekhouding, risico, eerlijkheid van de backtest, Bitvavo-API, beveiliging, dashboard en contracten. Daarna controleerden onafhankelijke agents elke bevinding door te proberen haar te weerleggen. Voor kritieke en hoge bevindingen moesten 2 van de 3 controleurs haar bevestigen. De run is gepauzeerd op verzoek van de gebruiker. **Verwijder dit bestand zodra alles is opgelost.**

> ⚠️ **Gebruik de live-modus (echt geld) nog NIET.** Er zijn bevestigde kritieke problemen in het orderpad (zie hieronder). De oefenmodus (paper trading) en de backtests zijn veilig om te gebruiken.

**Stand:** 45 unieke bevindingen · 13 bevestigd · 1 weerlegd · 1 deels geverifieerd · 30 nog niet geverifieerd. Nog niets gerepareerd.

## Overzicht

| # | Ernst | Module | Status | Bevinding |
|---|---|---|---|---|
| 0 | 🔴 kritiek | risk | BEVESTIGD | Positions sized at or near €5 can never be sold: stop-loss, manual close and kill switch all fail |
| 1 | 🟠 hoog | backtest-strategies | BEVESTIGD | Backtester books every exit, including positions under €5 that the brokers would refuse to sell |
| 2 | 🔴 kritiek | exchange-data-brokers | BEVESTIGD | LiveBroker returns still-open orders without cancelling them, and the engine treats status 'new' as a plain rejection |
| 3 | 🔴 kritiek | engine | BEVESTIGD | Unknown-outcome buy reserves no cash or position slot, and the block is lifted on re-arm/restart without checking Bitvavo |
| 4 | 🔴 kritiek | engine | BEVESTIGD | Stop and NOODSTOP do not stop an in-flight tick from placing new (real) buy orders |
| 5 | 🟡 middel | exchange-data-brokers | BEVESTIGD | After an unknown-outcome order, 'not found by clientOrderId' is reported as a normal rejection |
| 6 | 🟠 hoog | engine | BEVESTIGD | Position whose coins are gone is never closed in the ledger unless the market is flagged uncertain → a sell order every tick, forever |
| 7 | 🟠 hoog | engine | BEVESTIGD | Live: profit skimmed above the capital limit is booked as a daily loss → a winning trade halts trading |
| 8 | 🟠 hoog | engine | BEVESTIGD | Last evaluated candle is not persisted and is cleared on any market-list edit → the same buy signal is traded twice |
| 9 | 🟡 middel | engine | BEVESTIGD | Live: exit with available balance < position sells the available part and books the WHOLE position as closed |
| 10 | 🟡 middel | engine | BEVESTIGD | Capital limit only caps cash, not cash + open positions; restore ignores open positions and a raised limit has no effect |
| 11 | 🟡 middel | engine | BEVESTIGD | Corrupt or unreadable live state is silently replaced by a fresh ledger: real positions are forgotten and cash is reset to the full limit |
| 12 | 🟠 hoog | engine | weerlegd | Disarmed live mode (including after every restart) silently turns off stop-losses on real positions; stale pendingExit fires on re-arm |
| 13 | 🟠 hoog | frontend | BEVESTIGD | Noodstop reports 'alles verkocht' even when positions could not be sold; engine log promises a retry that never happens |
| 14 | 🟠 hoog | risk | deels geverifieerd (2/2 bevestigd, 3 nodig) | Break-even stop raised between candles is applied backwards to the whole closed candle |
| 15 | 🟡 middel | risk | nog niet geverifieerd | Daily loss limit does not stay in force: trading resumes the same day when open positions recover |
| 16 | 🟡 middel | risk | nog niet geverifieerd | The 'Minimale ordergrootte' (risk.minOrderQuote) setting has no effect and its help text is wrong |
| 17 | 🟡 middel | risk | nog niet geverifieerd | With a small breakEvenAtR, the break-even stop is placed above the current high, forcing an immediate exit at a net loss |
| 18 | 🟡 middel | engine | nog niet geverifieerd | Day rollover right after a restart values open positions at entry price |
| 19 | ⚪ laag | backtest-strategies | nog niet geverifieerd | Held-candle count, time-stop and cooldown are one candle off between engine and backtester; ARCHITECTURE.md contradicts itself |
| 20 | 🟡 middel | backtest-strategies | nog niet geverifieerd | Walk-forward buy & hold benchmark charges a buy+sell fee in every fold |
| 21 | 🟡 middel | frontend | nog niet geverifieerd | Backtest 'Max. drawdown' KPI quality check uses the wrong sign: every drawdown is shown as 'good' |
| 22 | 🟡 middel | engine | nog niet geverifieerd | Live engine decides on only historyCandles candles; bounds ignore strategy warmups, so ema-trend can be silently disabled live while backtests show it |
| 23 | 🟡 middel | frontend | nog niet geverifieerd | 'Pas beste instellingen toe' applies only the grid params, not the configuration the optimizer actually tested |
| 24 | 🟡 middel | backtest-strategies | nog niet geverifieerd | CLI backtest ignores the bot's saved settings, .env and DATA_DIR |
| 25 | ⚪ laag | backtest-strategies | nog niet geverifieerd | Fixed 0.05% slippage ignores the market's bid/ask spread |
| 26 | ⚪ laag | backtest-strategies | nog niet geverifieerd | Optimizer heatmap cells show the best score over all hidden parameters |
| 27 | ⚪ laag | backtest-strategies | nog niet geverifieerd | Strategies' exit signals almost never close positions; the optimizer's sellThreshold axis has no effect |
| 28 | 🟡 middel | server-config | nog niet geverifieerd | Backtest silently trades through the warmup window when history is short or the requested period is short |
| 29 | ⚪ laag | exchange-data-brokers | nog niet geverifieerd | The fee is reported as €0 when Bitvavo has not settled it yet |
| 30 | ⚪ laag | exchange-data-brokers | nog niet geverifieerd | Rounding can go UP for values with more than 15 significant digits (roundAmount/formatDecimal) |
| 31 | ⚪ laag | exchange-data-brokers | nog niet geverifieerd | Local clock (not server-corrected) decides closed candles, the permanent cache and the rate-limit reset comparison |
| 32 | 🔴 kritiek | server-config | nog niet geverifieerd | DNS-rebinding protection bypassed by any hostname starting with "127." |
| 33 | 🟠 hoog | server-config | nog niet geverifieerd | Cross-site GET requests to /api/* are accepted; a malicious page can exhaust the shared Bitvavo rate limit and block stop-loss sells |
| 34 | 🟡 middel | server-config | nog niet geverifieerd | Live mode starts on a non-loopback HOST without DASHBOARD_TOKEN (only a console warning) |
| 35 | 🟡 middel | server-config | nog niet geverifieerd | Backtest/optimize/walk-forward run synchronously on the main thread and freeze the engine, live order polling and SSE |
| 36 | 🟡 middel | server-config | nog niet geverifieerd | Shutdown force-exits after 10 s (or on a 2nd Ctrl+C / unhandled SIGHUP) even while a live order is in flight |
| 37 | 🟡 middel | server-config | nog niet geverifieerd | .env MARKETS/INTERVAL (and mode-specific risk) silently overridden once any setting is saved in the dashboard |
| 38 | ⚪ laag | server-config | nog niet geverifieerd | Risk-config fallback in main.ts keeps the invalid fee values, and PaperBroker is created before the fallback |
| 39 | ⚪ laag | server-config | nog niet geverifieerd | Strategy parameters accept any finite number and inherited property names, and these are persisted |
| 40 | ⚪ laag | server-config | nog niet geverifieerd | User-input errors from services are reported as HTTP 500 'Interne fout' with stack traces |
| 41 | 🟡 middel | frontend | nog niet geverifieerd | Settings validation shows internal units for % and second fields; following the message stores a taker fee 25× too low |
| 42 | 🟡 middel | frontend | nog niet geverifieerd | Optimizer view ignores best=null and shows a penalized combination (-1e9) as 'Beste combinatie' with an apply button |
| 43 | 🟡 middel | frontend | nog niet geverifieerd | Saving Settings with unsaved edits silently undoes config changes made elsewhere |
| 44 | ⚪ laag | frontend | nog niet geverifieerd | Signal panel never marks a decision stale after first render and keeps decisions the engine dropped |

## Details

### 0. Positions sized at or near €5 can never be sold: stop-loss, manual close and kill switch all fail

- **Ernst:** 🔴 kritiek · **Module:** `risk` · **Bestand:** `src/risk/riskManager.ts`:311 · **Status:** BEVESTIGD
- **Probleem:** Merged from 4 reports (money-ledger, risk, exchange-api, contracts). planEntry only checks that the BUY is at least the market minimum. When a position is too small it is raised to exactly ceilCents(minOrder) = €5.00, fee included (lines 308-321), and that bump is allowed even when risk reaches 2x the budget (MAX_BUMP_RISK_MULTIPLE, line 36). Risk-sized positions just above €5 (lines 299-306) are approved too. After the 0.25% taker fee and 0.05% slippage, €5.00 of coins is worth about €4.985 at the entry price. PaperBroker.sell (paperBroker.ts:178-183), LiveBroker sellProblem (liveBroker.ts:388) and Bitvavo (217) all reject sells below €5. So the position cannot be sold even at an unchanged price, and certainly not at its stop. Any position below about €5.02/(stop/entry) has the same problem. TradingEngine.exitPosition has no dust handling: it sets pendingExit and retries every tick forever (tradingEngine.ts:1020-1030). The position holds one of the 2 maxOpenPositions slots, blocks its market, counts toward exposure, and the kill switch cannot close it. README.md:84-85 promises at most 1.5% risk per trade and README.md:96 says the €5 minimum is handled, but the bump allows 2x the risk and the real loss is unbounded. A partially filled live buy below about €5 falls into the same trap.
- **Scenario:** Scratchpad scripts s1_dust.ts, minorder.ts, stuck.ts, s2_min5.ts and contracts/minorder.ts. On a €50 account with a volatile coin (ATR 6.5-8%), or with riskPerTradePct 0.5, or at €30 equity on SOL 1d with ATR 5%, the plan is approved at €5.00 ('opgehoogd naar minimum') with the stop 5-16% lower. A sell at the unchanged price is rejected: 'Orderwaarde €4,99 is kleiner dan het minimum van €5,00'. LiveBroker rejects the same order locally ('orderwaarde ca. € 4,98'). As the price falls through the stop, every tick logs a failed sell, and the position is still open at -40%. killSwitch logs 'NOODSTOP: 0 positie(s) gesloten, 1 NIET gesloten (SOL-EUR)'. In live mode real coins keep falling with no working stop, and the bot can only hold 1 other position.
- **Voorgestelde fix:** **Risk (primary fix), in src/risk/riskManager.ts planEntry, after minOrder is computed (~line 309):**

- Compute the smallest position that is still sellable at its stop, with a buffer for gaps and amount rounding:
  `const sellMin = ceilCents(minOrder * (1 + cfg.takerFee) * (entry / stop) * 1.03);`
  In this formula, entry already includes slippage. The broker's sell check is amount x ref, and amount = q/(1+fee)/entry.
- Use sellMin instead of minOrder in the size check at line 311: `if (!(q >= sellMin - 1e-9) || q <= 0)`.
- Use sellMin as the bump target instead of ceilCents(minOrder): `const bump = Math.max(sellMin, 0.01)`.
- Change MAX_BUMP_RISK_MULTIPLE to 1, so a bump never breaks the "max 1.5% risk" promise. In practice this rejects most risk-limited small entries.
- Use a Dutch rejection reason, for example: `Positie van ${eur(q)} zakt bij de stop-loss onder het Bitvavo-minimum van ${eur(minOrder)} en kan dan niet verkocht worden (minimaal ${eur(sellMin)} nodig)`.
- Update the test at tests/risk/riskManager.test.ts:185 ("hoogt op naar het minimum…") to match.

**Engine (defense in depth), in src/engine/tradingEngine.ts exitPosition, before placing the sell:**

- If `amount 

### 1. Backtester books every exit, including positions under €5 that the brokers would refuse to sell

- **Ernst:** 🟠 hoog · **Module:** `backtest-strategies` · **Bestand:** `src/backtest/simulator.ts`:205 · **Status:** BEVESTIGD
- **Probleem:** Merged from 2 reports. closePosition() (lines 205-237) and rangeCheck() (line 251) always book the exit at the stop, take-profit, time-stop or signal price, whatever the position's value. The €5 minimum is only checked at entry (line 274). A position the live or paper broker cannot sell therefore appears as a clean stop-loss in backtests, the optimizer and walk-forward. Configurations that produce such positions (wide stopAtrMult, high-ATR markets or intervals, low equity) look safer than they are, and the optimizer can select them (its grid includes stopAtrMult 3). Measured with min5.ts on 23 markets at €50 with defaults: on 1d/365 days, 65 of 167 trades were bumped to exactly €5.00 and 49 exits were worth under €5. On 4h it was 1 of 418, and on 1h/15m none. contracts/min5.out shows 50 of 2217 trades exiting below €5.
- **Scenario:** XRP-EUR 1d at €50 (or SOL 1d at €30): the entry is bumped to €5.00 with the stop 10-17% lower. The backtest reports 'stop-loss -17.4%, exit value €4.14' as executed. In paper or live the sell is rejected and the position stays open with no stop (review/stuck.ts shows -40%), while the backtest shows a capped loss.
- **Voorgestelde fix:** **In src/backtest/simulator.ts, model what the engine does with a sell it cannot place:**

1. Add `let pendingExit: { reason: ExitReason; score: number } | null = null;` next to `pos`, and reset it wherever `pos` is set to null.

2. Add a helper `const sellable = (p: Position, rawPrice: number) => !(minOrder > 0) || p.amount * rawPrice >= minOrder - 1e-8;`. It uses the pre-slippage price because PaperBroker and LiveBroker check `amount * ref`.

3. In `rangeCheck` (after clamping `px`) and in the signal-exit branch of the main loop: if `!sellable(pos, px)`, do not call `closePosition`. Instead set `pendingExit = { reason, score }` and keep the position open. In `rangeCheck`, do not update stops in that case.

4. At the top of the per-candle `if (pos)` branch, handle a pending exit first, before `shouldExitOnSignal` and `rangeCheck`:
   - Increment `pos.candlesHeld` and `exposureCandles`.
   - If `pos.amount * c.open >= minOrder`, close at `c.open`.
   - Else if `pos.amount * c.high >= minOrder`, close at `min(c.high, max(c.low, minOrder / pos.amount))`.
   - Else keep it open.
   - Use the stored reason and score. Do not evaluate stops, TP or signals while pending, the same as `Trad

### 2. LiveBroker returns still-open orders without cancelling them, and the engine treats status 'new' as a plain rejection

- **Ernst:** 🔴 kritiek · **Module:** `exchange-data-brokers` · **Bestand:** `src/broker/liveBroker.ts`:292 · **Status:** BEVESTIGD
- **Probleem:** Merged from 4 reports (money-ledger, risk, exchange-api, contracts). placeMarketOrder polls getOrder 5 × 400 ms (#pollUntilSettled, line 274). If the order is still new, awaitingTrigger or partiallyFilled after that, it is returned as-is and never cancelled; client.cancelOrder (bitvavoClient.ts:571) has no callers. A still-open order with nothing filled comes back as status 'new', filledAmount 0 with error 'Order X is geplaatst maar nog niet gevuld; controleer je Bitvavo-account' (lines 292-293). The same happens when the getOrder polls fail temporarily (lines 326-330). TradingEngine.isUnknownOutcome (tradingEngine.ts:1146-1155) only treats 'new' as unknown when the error starts with 'UITKOMST ONBEKEND', so this case goes to the rejected branch: buys at 859-867, sells at 1020-1031. Then: buys get no position, no uncertain block, and a new order on the next signal; sells get pendingExit plus another full-size sell on the next tick while the first is still open. A still-working partiallyFilled order looks the same as a final partial fill, so the engine books only the filled part and re-sells the 'remainder'.
- **Scenario:** s6_live_new.ts, openorder.test.ts, newstatus.ts: live and armed with a slow matching engine. A €22.50 market buy is still 'new' after 2 s, and the engine logs 'Kooporder afgewezen'. The order then fills, and on the next buy candle a second order is sent (POSTs=2, DELETEs=0). Only one fill is tracked: €22.50 of BTC has no stop, and the capital limit is exceeded. On the sell side, a stop-loss sell comes back 'new' and fills later. The engine then sends a new sell every tick (5 POSTs seen), with the exchange at 0 BTC and a ghost position in the ledger. If the user holds their own coins of that asset, those get sold.
- **Voorgestelde fix:** Main fix, in src/broker/liveBroker.ts placeMarketOrder, after `#pollUntilSettled`:
1. If `order.status` is still non-final (`new`, `awaitingTrigger` or `partiallyFilled`), call `try { await this.#client.cancelOrder(market, order.orderId) } catch {}`. A cancel on an order that already filled returns an error, which is fine to ignore.
2. Then re-fetch with `order = await this.#client.getOrder(market, order.orderId)`. Retry this a few times with `#sleep`.
3. If the re-fetch succeeds and the status is final, continue through the existing mapping: canceled with fills → "partiallyFilled", canceled without fills → "cancelled", which the engine correctly treats as a rejection because the order is dead.
4. If the cancel/re-fetch fails or the status is still non-final, return the current fills with `result.error = "UITKOMST ONBEKEND: order <id> is nog open/niet te controleren …"`. Use status "new" when filled is 0 and "partiallyFilled" otherwise.
5. Replace the message at lines 292-293 with that UITKOMST ONBEKEND text.
6. Update the liveBroker test that expects 5 GETs and no DELETE.

Engine safety net, in src/engine/tradingEngine.ts:
1. In `isUnknownOutcome` (1150-1154), treat every live res

### 3. Unknown-outcome buy reserves no cash or position slot, and the block is lifted on re-arm/restart without checking Bitvavo

- **Ernst:** 🔴 kritiek · **Module:** `engine` · **Bestand:** `src/engine/tradingEngine.ts`:850 · **Status:** BEVESTIGD
- **Probleem:** Merged from 2 reports. On 'UITKOMST ONBEKEND' the engine only adds the market to the in-memory `uncertain` set (lines 849-857). It does not deduct or reserve cash, records no provisional position, and does not keep the clientOrderId. The RiskManager's caps only look at ledger positions and ledger cash (riskManager.ts:227, 301-303), so other markets get the full budget again in the same tick and in later ticks. The live balance check (816-833) does not help when the Bitvavo account holds more EUR than CAPITAL_LIMIT_EUR. arm() (512) and start() (310) call clearUncertain (1467) without looking the order up, and the log tells the user the block lasts 'tot een herstart of opnieuw armen'. `uncertain` is not persisted. If the order did execute, those coins have no stop.
- **Scenario:** s7_unknown.ts: limit €50, €1000 on Bitvavo. An unknown-outcome €22.50 buy executes, then disarm/arm, then the next buy. The engine thinks €50 is deployed, but €45 is actually spent and €27.50 of engine cash is still available, so up to €72.50 can go into a €50 limit. unknown.ts: BTC comes back unknown but fills, and in the same tick ETH €22.50 and SOL €22.43 are bought, giving €67.43 spent and 3 positions (above maxOpenPositions 2). The BTC position has no stop.
- **Voorgestelde fix:** This is an engine fix, plus one small broker hook.

1. Keep a separate record for unknown buys. In tradingEngine.ts add `private unknownBuys = new Map<string, { clientOrderId: string; quote: number; at: number; stopDist: number; tpDist: number }>()`. In the unknown branch of openPosition (line 849), call `this.unknownBuys.set(market, { clientOrderId: req.clientOrderId, quote: plan.quoteAmount, at: this.nowFn(), stopDist, tpDist })`. Also include `req.clientOrderId` in the log line.

2. Pause all new entries, not just this market, while any unknown buy exists. Add to tryEntry, before planEntry:
```ts
if (this.unknownBuys.size > 0) {
  this.logRejection(market, decision.time, `Geen koop ${market}: koop met onbekende uitkomst in ${[...this.unknownBuys.keys()].join(", ")} — alle nieuwe entries gepauzeerd`);
  return;
}
```
This is the minimal change that stops the capital-limit and maxOpenPositions overrun.

3. Persist `unknownBuys` as a new optional field in PersistedState, and restore it in restoreFromStore. Do not clear it in start() or arm(); keep clearUncertain only for the sell-side `uncertain` set.

4. Resolve pending buys. Add an optional `lookupOrder?(market: string, clientOrd

### 4. Stop and NOODSTOP do not stop an in-flight tick from placing new (real) buy orders

- **Ernst:** 🔴 kritiek · **Module:** `engine` · **Bestand:** `src/engine/tradingEngine.ts`:472 · **Status:** BEVESTIGD
- **Probleem:** stop() (332) and killSwitch() (472) set running=false and then wait for the lock. runTick, processMarket, tryEntry (751) and openPosition (810) never check running or a stopping flag, and killSwitch only disarms after it has closed positions. A tick that is in flight keeps evaluating the remaining markets and places real buys after the user clicked. Demonstrated in s3_killtick.ts: the kill switch reports 0 positions, then the tick buys BTC and ETH, and the kill switch sells them again (fees lost; if either sell is rejected, a new position survives the emergency stop). In s3b_stoptick.ts, pressing Stop leads to 2 real buys and a stopped bot holding 2 positions that nothing monitors.
- **Scenario:** The user presses Stop or Noodstop while the 15 s tick is fetching candles. The tick carries on and buys €22.50 BTC and €22.44 ETH with real money, then either sells them again (fees lost) or leaves them open with no stop-loss monitoring. Meanwhile the UI shows 'Bot gestopt'.
- **Voorgestelde fix:** All changes are in src/engine/tradingEngine.ts.

1. Add `private stopGen = 0;` and `private tickGen = 0;`. Use a generation counter rather than checking `!running`: tests (and any future manual tick) call tick() without start(), and a counter keeps later ticks working normally.

2. At the top of runTick, set `this.tickGen = this.stopGen;`.

3. Make stop() and killSwitch() do `this.stopGen++` synchronously, right next to `this.running = false`, before any await.

4. In tryEntry, add as the first line:
```ts
if (this.tickGen !== this.stopGen) return;
```

5. In openPosition, directly before building the MarketOrderRequest (that is, after the live getBalances await), add:
```ts
if (this.tickGen !== this.stopGen || (this.mode === "live" && !this.armed)) {
  this.log("warn", `Koop ${market} geannuleerd: bot gestopt/ontwapend tijdens deze ronde`);
  return;
}
```

6. In killSwitch, before awaiting the lock, add:
```ts
const wasArmed = this.mode === "live" && this.armed;
this.armed = false;
```
The kill exits pass `explicit=true`, so exitPosition still sells while disarmed. Move the "NOODSTOP geactiveerd: N open positie(s)" log inside the exclusive() callback so N is counted after the in-

### 5. After an unknown-outcome order, 'not found by clientOrderId' is reported as a normal rejection

- **Ernst:** 🟡 middel · **Module:** `exchange-data-brokers` · **Bestand:** `src/broker/liveBroker.ts`:258 · **Status:** BEVESTIGD
- **Probleem:** If POST /order fails with an unknown outcome and all 5 lookups via #lookupAfterUnknownOutcome return 240, placeMarketOrder returns 'rejected' ('waarschijnlijk niet geplaatst'). The engine does not set `uncertain` and does not reconcile. The 240 answer can be a false negative: the order may still be queued after a 109 or a timeout, or the lookup may not yet be consistent. Balances are never compared before and after.
- **Scenario:** notfound.test.ts: POST throws 'socket hang up' and GET returns 240. The engine logs a rejection, and the next buy signal sends a second POST. If the first order executed, the account holds coins with no stop, plus a second position.
- **Voorgestelde fix:** Minimal fix in src/broker/liveBroker.ts, the `found.notFound` branch (lines 258-261): report the case as an unknown outcome so the engine blocks the market (buy) or checks the balance on the next tick (sell). Replace it with:

```ts
} else if (found.notFound) {
  return reject(
    `UITKOMST ONBEKEND: ${err.message}. De order (clientOrderId ${clientOrderId}) is niet teruggevonden bij Bitvavo — waarschijnlijk niet geplaatst, maar dat is niet zeker. Controleer je Bitvavo-account voordat je opnieuw handelt.`,
    "new",
  );
}
```

The message must start with "UITKOMST ONBEKEND" and status must be "new", because that is what `TradingEngine.isUnknownOutcome` checks for. Update tests/broker/liveBroker.test.ts:253-263 to expect status "new" and an error containing "UITKOMST ONBEKEND" and "niet teruggevonden".

Optional refinement (not needed for safety): snapshot the base balance before the POST (sells already read it in `#clampSellToBalance`) and read it again after notFound. If the base balance moved by at least ~50% of the expected fill, say in the message that the order was very likely executed. Keep the status "new"/UITKOMST ONBEKEND either way: an unchanged balance does not prove a

### 6. Position whose coins are gone is never closed in the ledger unless the market is flagged uncertain → a sell order every tick, forever

- **Ernst:** 🟠 hoog · **Module:** `engine` · **Bestand:** `src/engine/tradingEngine.ts`:969 · **Status:** BEVESTIGD
- **Probleem:** The 'positie staat niet meer op Bitvavo' reconciliation only runs when `this.uncertain.has(pos.market)`. In every other case where the base balance is about 0 (a late-filled sell, an unknown-outcome sell followed by a restart or re-arm, or a sale in the Bitvavo app), a full-size sell is sent every tick and rejected with 216. The position stays open, the proceeds are never credited (the budget shrinks for good), and a slot stays blocked. If rounding dust remains, the engine loops on a local 'na afronden 0' rejection instead.
- **Scenario:** A live stop-loss sell times out but did execute. The user restarts the bot, which clears `uncertain`. From then on a rejected sell goes out every 15 s (about 240 an hour), the dashboard shows a phantom position, and the €22.50 never returns to the budget.
- **Voorgestelde fix:** Make the "no longer on Bitvavo" reconciliation independent of `uncertain`. In `exitPosition` in src/engine/tradingEngine.ts (around line 969), inside the `if (known)` block:
- Replace `if (this.uncertain.has(pos.market) && held < pos.amount * 0.01)` with `if (held < pos.amount * 0.01 && balances.length > 0)`. The non-empty check keeps a transient empty /balance answer from closing a real position; keep the balances array instead of only the `.find` result.
- Log at "error" level with wording that depends on the cause: `this.uncertain.has(pos.market)` means "vermoedelijk verkocht bij de order met onbekende uitkomst", otherwise "verkocht buiten de bot of door een eerdere, laat gevulde order".
- Keep the existing estimated booking at the current price with `closeAll: true`.

This one change also fixes the manual close and the kill switch, because both go through `exitPosition`, and it covers the dust case (dust is below 1%).

Optional hardening:
1. Run the same close-at-estimate step in `reconcileLiveBalances` at startup when held < 1%.
2. In `isUnknownOutcome`, or on the "rejected" path, treat a live sell with status "new", a non-empty orderId and filledAmount 0 as pending or unknown

### 7. Live: profit skimmed above the capital limit is booked as a daily loss → a winning trade halts trading

- **Ernst:** 🟠 hoog · **Module:** `engine` · **Bestand:** `src/engine/tradingEngine.ts`:1091 · **Status:** BEVESTIGD
- **Probleem:** Merged from 2 reports. In live mode, bookExit caps cash at startingCapital and drops the excess (lines 1091-1098). dayStartEquity, which includes that profit when it was unrealized at day start (lines 589-598), is not adjusted, and neither is startingEquity. Equity then drops by the skimmed amount, haltStatus (riskManager.ts:461-469) reports a daily loss, and the equity chart and total return show a drop right after a win.
- **Scenario:** s4_caplimit.ts part B: with limit €50 and a +15% winner held over midnight, dayStartEquity is €53.31. Closing it (+€3.25 realized) leaves equity at €50.00 and the halt status 'Dagelijkse verlieslimiet bereikt (-6,2%)'. livecap.ts: two positions at +7% over midnight are sold for +€2.86, and the bot halts at -5.7% while realizedPnlToday is positive.
- **Voorgestelde fix:** Treat the skim as a withdrawal from the daily baseline. In bookExit (src/engine/tradingEngine.ts ~1091):
```ts
if (this.mode === "live" && this.account.cashQuote > this.startingCapital) {
  const excess = this.account.cashQuote - this.startingCapital;
  this.account.cashQuote = this.startingCapital;
  // Skimmed profit is a withdrawal, not a loss: move the daily baseline down too.
  this.account.dayStartEquity = Math.max(this.account.dayStartEquity - excess, 1e-9);
  this.log(...);
}
```
Apply the same adjustment in restoreFromStore (~line 1348): `const excess = account.cashQuote - this.startingCapital; account.cashQuote = this.startingCapital; account.dayStartEquity = Math.max(account.dayStartEquity - excess, 1e-9);`.

This keeps the paper-mode semantics, where intraday gains offset intraday losses. The repro would then end with dayStart ≈ 50.12 and equity 50.00, which is -0.24% (just the exit fees), so no halt. `dayStartEquity` is already persisted, so no schema change is needed.

Optional reporting follow-up: persist a cumulative `skimmedQuote`. Add it to `equity` for equityHistory and the header's total return, or subtract it from `startingEquity`, so the chart does not show a 

### 8. Last evaluated candle is not persisted and is cleared on any market-list edit → the same buy signal is traded twice

- **Ernst:** 🟠 hoog · **Module:** `engine` · **Bestand:** `src/engine/tradingEngine.ts`:435 · **Status:** BEVESTIGD
- **Probleem:** Merged from 4 reports. lastEvaluated (line 250) exists only in memory. updateConfig() clears it for every market whenever the market list or interval changes (433-437). After a restart, a Scanner '+ Toevoegen aan bot' (scanner.js:471, one click, applied at once even when live and armed), or a Settings save with a changed market list (settings.js:717), the latest closed candle of every market is evaluated again (627-661). If that candle's buy was already traded and the position has since closed, the bot buys again on the stale signal at the current price. The position may have closed via take-profit, a manual close or trailing stop in profit, or any exit when cooldown is 0. The RiskManager only blocks a repeat while a position is open or a loss cooldown is active. On restart, live is partly protected because the first unarmed tick marks the candle, but arming before Start defeats that.
- **Scenario:** s2_rebuy.ts and a frontend scratch script: SOL is bought on the 08:45 candle, take-profit hits (or the user closes it at a profit), then the user adds ETH-EUR or XRP-EUR in the scanner or settings, or restarts. The next tick logs 'KOOP SOL-EUR €22,94 @ 157,58' on the same, already used signal. In live-armed mode this is an unintended real order. In paper with 1h candles, a restart within the candle repeats the buy.
- **Voorgestelde fix:** All changes are in src/engine/tradingEngine.ts, plus one optional field in src/core/types.ts.

1. Primary guard, which alone closes both the restart and the config-edit paths because trades are already persisted. At the top of `tryEntry`, after the open-position check, add:
```ts
const candleClose = decision.time + INTERVAL_MS[this.config.interval];
if (this.positions.some(p => p.market === market && p.entryTime >= candleClose) ||
    this.trades.some(t => t.market === market && t.entryTime >= candleClose)) {
  this.logRejection(market, decision.time, `Geen koop ${market}: het signaal van deze candle is al verhandeld`);
  return;
}
```
An entry at or after the decision candle's close can only have come from that same (latest) signal.

2. In `updateConfig`, stop clearing evaluation state for markets that stay in the list:
```ts
if (intervalChanged) { this.lastEvaluated.clear(); this.rejectLogged.clear(); }
else if (marketsChanged) {
  for (const m of [...this.lastEvaluated.keys()]) if (!next.markets.includes(m)) this.lastEvaluated.delete(m);
  for (const m of [...this.rejectLogged.keys()]) if (!next.markets.includes(m)) this.rejectLogged.delete(m);
}
```
Newly added markets have no 

### 9. Live: exit with available balance < position sells the available part and books the WHOLE position as closed

- **Ernst:** 🟡 middel · **Module:** `engine` · **Bestand:** `src/engine/tradingEngine.ts`:986 · **Status:** BEVESTIGD
- **Probleem:** If the available base balance is below pos.amount by any margin, the engine sells amount = avail and sets sellsEverything = true. bookExit then uses share = 1, so the full cost basis is booked against the proceeds of a partial sale. The unsold coins drop out of the ledger (no stop), and realized PnL shows a fake loss that can trip the daily loss limit. Typical causes are coins held inOrder by an earlier sell that is still open, or a manual order.
- **Scenario:** s9_partialavail.ts: with 60% of the coins inOrder and the price at +0.2%, the trade is booked at -€13.53 (-60.1%) and the position is removed. The next tick halts on the daily loss limit.
- **Voorgestelde fix:** In `exitPosition` (`tradingEngine.ts` about 986), limit the shortcut to small shortfalls, in line with LiveBroker:

```ts
const inOrder = holding && isNum(holding.inOrder) ? holding.inOrder : 0;
if (avail > 0 && avail < amount) {
  if (avail >= amount * 0.95) {            // dust/rounding (same 5% as LiveBroker MAX_SELL_SHORTFALL)
    amount = avail; sellsEverything = true; // unchanged behaviour
  } else if (inOrder > 0) {                 // coins exist but are locked in an open order
    this.pendingExit.set(pos.id, reason);
    this.logThrottled(`sellfail:${pos.id}`, "error",
      `${pos.market}: ${fmtAmount(inOrder)} ${base} zit in een openstaande order op Bitvavo; annuleer die order of sluit handmatig — positie blijft open`,
      SELL_ERROR_THROTTLE_MS, true);
    return null;                            // don't sell, don't book
  } else {                                  // coins really gone (manual sale / partially executed unknown order)
    missing = pos.amount - avail;           // sell avail normally, book as a partial exit
    amount = avail;
  }
}
```

In the third case, do not charge the full cost against the partial proceeds. Book the missing part the way the exist

### 10. Capital limit only caps cash, not cash + open positions; restore ignores open positions and a raised limit has no effect

- **Ernst:** 🟡 middel · **Module:** `engine` · **Bestand:** `src/engine/tradingEngine.ts`:1348 · **Status:** BEVESTIGD
- **Probleem:** Merged from 2 reports. The live limit is enforced only as cash ≤ startingCapital (1091, 1348). A winner that closes while another position is open keeps its profit in cash, which gets reinvested, so the cost basis in the market can exceed CAPITAL_LIMIT_EUR. On restart with a lowered limit, cash is capped but open positions are ignored. restoreFromStore takes cash and startingEquity from the persisted state and only caps cash downwards, so raising CAPITAL_LIMIT_EUR (or PAPER_STARTING_CAPITAL) has no effect. Meanwhile AppInfo.capitalLimitQuote (routes.ts:133), the header, banner and arm modal (header.js:124, 266-273) show the new value. The paper reset modal shows the old startingEquity, while /api/paper/reset uses the new env value.
- **Scenario:** s4_caplimit.ts part A: with limit €50, cash €34.96 plus open cost €24.87 gives €59.83, and after the next buy €54.75 of positions sits against a €50 limit. caplimit.ts: first run at €20, second run at €100. The header shows 'limiet €100', but sizing, the halt and P&L all use €20.
- **Voorgestelde fix:** tradingEngine.ts (live mode only):

(1) Persist the limit. Add `capitalLimitQuote?: number` to PersistedState (types.ts) and write `this.startingCapital` into it in persistedState().

(2) In restoreFromStore, after building account and positions, when mode === "live":
```ts
const openCost = positions.reduce((s, p) => s + p.costQuote, 0);
const oldLimit = isNum(state.capitalLimitQuote) ? state.capitalLimitQuote : account.startingEquity;
const room = Math.max(0, this.startingCapital - openCost);
const target = Math.min(room, Math.max(0, account.cashQuote + (this.startingCapital - oldLimit)));
const delta = target - account.cashQuote;
if (Math.abs(delta) > 1e-9) {
  account.cashQuote = target;
  account.startingEquity += delta;
  account.dayStartEquity += delta;
  log('info', `Kapitaallimiet ${fmtEur(oldLimit)} -> ${fmtEur(this.startingCapital)}: handelsbudget ${delta > 0 ? '+' : ''}${fmtEur(delta)}`);
}
```
This replaces the current cash-only clamp. A raise then takes effect, a lower limit counts open positions, and neither creates a phantom P&L or daily-loss halt. reconcileLiveBalances can warn if the Bitvavo EUR balance is below cash.

(3) In bookExit, move the cap after the positi

### 11. Corrupt or unreadable live state is silently replaced by a fresh ledger: real positions are forgotten and cash is reset to the full limit

- **Ernst:** 🟡 middel · **Module:** `engine` · **Bestand:** `src/engine/stateStore.ts`:53 · **Status:** BEVESTIGD
- **Probleem:** StateStore.load quarantines any file that is unparsable, empty or has a schema/version mismatch, and returns null. restoreFromStore then starts fresh without logging anything. In live mode, open positions are forgotten and cash is reset to the full limit. writeAtomic (line 100) does not fsync before the rename. No pending-order intent is written before live orders.
- **Scenario:** s8_corrupt.ts: an open live position, then a truncated state file, then a restart gives 0 positions and €50 cash while the BTC is still on the exchange, and nothing is logged. The bot then spends another €50 after arming.
- **Voorgestelde fix:** Minimal fix, in src/engine/stateStore.ts and src/engine/tradingEngine.ts:

(1) Make StateStore report problems instead of hiding them.
- Add `lastLoadProblem: { reason: string; quarantinedTo?: string } | null`.
- Set it in the quarantine branch, including the target path.
- In the readFileSync catch, set `lastLoadProblem = { reason: <err message> }` and also set a private `readOnlyUntilResolved = true` flag. While that flag is set, `flush()`/`writeAtomic` refuse to write, so an unreadable-but-valid file is never overwritten by an empty ledger.

(2) In `restoreFromStore()`, when `state` is null and `store.lastLoadProblem` is set:
- Log at level "error": "Opgeslagen staat onbruikbaar (<reason>), bewaard als <quarantinedTo>. De bot begint met een LEGE administratie: open posities van vóór de herstart worden NIET bewaakt. Controleer je Bitvavo-saldi."
- In live mode, set `this.stateRecoveryPending = true` and expose it in the snapshot so the UI can show a red banner.
- Make `arm()` refuse while `stateRecoveryPending` is set: throw an Error, which the route maps to 409. Clear the flag with an explicit acknowledge call or endpoint.

(3) In `reconcileLiveBalances()`:
- Remove the early `i

### 12. Disarmed live mode (including after every restart) silently turns off stop-losses on real positions; stale pendingExit fires on re-arm

- **Ernst:** 🟠 hoog · **Module:** `engine` · **Bestand:** `src/engine/tradingEngine.ts`:942 · **Status:** weerlegd
- **Probleem:** Merged from 4 reports (money-ledger, risk, frontend, contracts/docs). While not armed, every automatic exit (stop-loss, trailing, break-even, take-profit, time-stop) is only logged as 'zou verkopen' (once per position, throttle = Infinity) and stored in pendingExit (lines 942-952). `armed` is not persisted (236), and live never autostarts (config.ts:363), so this holds after every restart too. The disarm buttons, 'Uitschakelen' in the banner (header.js:321-334) and 'Ontwapenen' in Settings (settings.js:526-536), act without confirmation and show reassuring toasts ('alleen signalen', 'geen echte orders meer'). The banner only says 'NIET gearmd'. OpenPositionView has no pendingExit field. README 112-114 and 165-167 say stops resume once the bot runs again. After re-arming, the stale pendingExit runs first (675-678) at whatever the current price is, with the old reason.
- **Scenario:** The user disarms in the evening to 'stop new trades', or restarts after a crash and clicks Start without arming. BTC falls 8-20% through the stop, and liverestart.ts shows 0 sell orders over 5 ticks. The loss grows far beyond the risk budget. A day later the price has recovered to +3% and the user re-arms; the bot sells immediately, labelled 'stop-loss'.
- **Voorgestelde fix:** Engine (minimal, src/engine/tradingEngine.ts):

(1) At line 942, gate only the discretionary signal exit and let protective exits of the bot's own positions run while the engine is running:
`if (this.mode === "live" && !this.armed && !explicit && reason === "signal") { ... }`

Stop-loss, trailing-stop, break-even, take-profit and time-stop then place the sell. It is already capped at the available base balance (lines ~966-982). Entries stay gated at line 810.

Update these to match:
- the test at tests/engine/tradingEngine.test.ts:478-495
- the messages at 528 and 1302-1306
- ARCHITECTURE.md:185, e.g. "without arm() no ENTRIES and no signal exits; protective exits of positions the bot opened are still executed"

(2) In arm(): delete pending exits that came from the not-armed gate, so stale reasons don't fire. Track them in a separate `deferredExit` set, or clear pendingExit entries whose reason === "signal". Then set `posCursor` for each position to the latest closed candle time, so the next tick re-checks the stop against the current price only.

If the maintainers want to keep "disarmed = no orders at all", the minimum is a docs + frontend fix:
- Correct README 165-167 ("in live 
- **Waarom weerlegd:** The mechanics the reviewer describes are real. I reproduced them, but the headline claim does not hold up. Stop-losses are not "silently" turned off, and this is not an unintended engine bug. It is a deliberate "unarmed = zero real orders" invariant. It is written into the contract, covered by a test, and the engine warns about it explicitly every time it matters.

1. Deliberate and documented. docs/ARCHITECTURE.md (A7) says: "In live mode without arm(), the engine evaluates everything but places NO orders." exitPosition's doc comment says only user-requested exits (explicit=true, meaning manual close or the kill switch) run while unarmed. tests/engine/tradingEngine.test.ts:480 ("disarm met open positie: automatische exits worden alleen gelogd, handmatig sluiten werkt wel") asserts exactly this, and the test passes.

2. Not silent. disarm() (tradingEngine.ts:520-532) logs a warn when positions exist: "let op: N open positie(s) worden NIET meer automatisch verkocht (stop-loss); arm opnieuw of sluit handmatig". After a restart, reconcileLiveBalances (1302-1306) logs: "Live: N open positie(s) uit de opgeslagen staat. Zolang de bot niet gearmd is worden stops NIET automatisch uitgevoer

### 13. Noodstop reports 'alles verkocht' even when positions could not be sold; engine log promises a retry that never happens

- **Ernst:** 🟠 hoog · **Module:** `frontend` · **Bestand:** `public/js/header.js`:433 · **Status:** BEVESTIGD
- **Probleem:** Merged from 3 reports. engine.killSwitch() (tradingEngine.ts:472-507) never throws. When sells fail it logs 'NIET gesloten' and still stops and disarms the bot. POST /api/engine/kill (routes.ts:255-258) returns 200 with the snapshot. The header always shows 'Noodstop uitgevoerd — alles verkocht, bot gestopt' and never checks res.positions. The per-position error log says 'nieuwe poging bij de volgende tick' (tradingEngine.ts:1026), but the bot has been stopped, so no retry happens. The kill modal shows the value (e.g. 'ca. € 4,74') without saying it cannot be sold. README 115-116 promises a full sell.
- **Scenario:** A €5 (unsellable) position is open and the user hits Noodstop. The response is 200 with 1 position still open. The UI shows two contradicting toasts: 'NOODSTOP: 0 gesloten, 1 NIET gesloten' and 'alles verkocht'. The user closes the laptop, and the position keeps losing with nothing monitoring it.
- **Voorgestelde fix:** 1. **Frontend, the main fix (public/js/header.js)**
   - Let `run()` accept `okMsg` as a function of the response: `const [msg, kind] = typeof okMsg === "function" ? okMsg(res) : [okMsg, okKind];`.
   - For the kill button, pass: `(res) => { const left = (res && Array.isArray(res.positions)) ? res.positions : []; return left.length ? [`Noodstop: bot gestopt, maar ${left.length} positie(s) NIET verkocht (${left.map(p => `${p.market} ≈ ${fmt.eur(p.amount * p.currentPrice)}`).join(", ")}) — waarde onder het Bitvavo-minimum van €5? Sluit handmatig of wacht tot de waarde weer boven €5 is.`, "error"] : ["Noodstop uitgevoerd — alles verkocht, bot gestopt", "warn"]; }`.
   - Use the same failed-list text in the kill modal so the modal stays open with the error when positions remain.

2. **Engine (src/engine/tradingEngine.ts:1026 and the unknown-outcome message around line 1011)**
   - Make the retry text conditional: show "nieuwe poging bij de volgende tick" only when `this.running` is true. Otherwise show "de bot staat stil — sluit handmatig".

3. **Optional, server-config**
   - Have `killSwitch()` return `{ closed, failed }`.
   - Have `/api/engine/kill` include `failed` in its response

### 14. Break-even stop raised between candles is applied backwards to the whole closed candle

- **Ernst:** 🟠 hoog · **Module:** `risk` · **Bestand:** `src/risk/riskManager.ts`:427 · **Status:** deels geverifieerd (2/2 bevestigd, 3 nodig)
- **Probleem:** updatePosition raises the stop to break-even on any candle, including the synthetic ticks between candles (427-429 are not gated by closedCandle, unlike trailing). At the candle close, the engine re-checks the whole candle against the already raised stop (tradingEngine.ts:683-692). If the candle's low came before the rally, the bot exits as 'break-even' even though the stop was never hit after it was raised. The backtester applies break-even only from the next candle.
- **Scenario:** breakeven.ts: the bot exits at 101.05 while the price is 101.1, above the stop. simrun.ts over 30 days: 13 of 23 break-even exits happened with the price above the stop, and there were 7 TPs. With the fix: 1 such exit and 12 TPs.
- **Voorgestelde fix:** Minimal fix, in the risk area: in src/risk/riskManager.ts:427, gate break-even the same way trailing is gated:
`if (closedCandle && cfg.breakEvenAtR > 0 && highest >= pos.entryPrice + cfg.breakEvenAtR * R) {`

Ticks still update `highestPrice` and still check the stop that is in force. The raise happens at candle close and applies from the next tick or candle on. That matches the backtester exactly.

Tests to update:
- tests/risk/riskManager.test.ts:457-460: with `closedCandle=false`, expect the stop to stay at 96. Keep the 100.6 assertion for `closedCandle=true`.
- tests/risk/riskManager.test.ts:468: pass `true` instead of `false`.

Also add an engine regression test: a candle after entry that dips, then rallies past +1R through ticks, then closes above break-even must not exit at candle close. Optionally add a note to the "Signal timing" section in docs/ARCHITECTURE.md that stop raises (break-even and trailing) only happen on closed candles.

Alternative, in the engine, if intra-candle break-even protection is wanted: in `managePosition`, remember per `pos.id` the stop that was in force when each candle opened. Pass `{...pos, stopPrice: stopAtCandleOpen}` for the closed-candle ch

### 15. Daily loss limit does not stay in force: trading resumes the same day when open positions recover

- **Ernst:** 🟡 middel · **Module:** `risk` · **Bestand:** `src/risk/riskManager.ts`:453 · **Status:** nog niet geverifieerd
- **Probleem:** haltStatus is stateless: it compares current equity (including unrealized PnL) with dayStartEquity on every tick, and the engine logs 'Handel hervat' as soon as the loss is back under the limit. The backtester does the same. The UI (settings.js:89-90, risk.js:90) promises a stop 'tot morgen'.
- **Scenario:** minsetting.ts: equity 47.40 → halted; an open position gains €0.20 → not halted, and the next buy signal trades the same day.
- **Voorgestelde fix:** Store the dayKey of the halt (haltedDayKey) in the engine and the backtester, and block entries until the day rolls over. Alternatively, also halt when realizedPnlToday ≤ -limit. Keep the UI text consistent with the chosen behaviour.

### 16. The 'Minimale ordergrootte' (risk.minOrderQuote) setting has no effect and its help text is wrong

- **Ernst:** 🟡 middel · **Module:** `risk` · **Bestand:** `src/risk/riskManager.ts`:308 · **Status:** nog niet geverifieerd
- **Probleem:** Merged from 2 reports. planEntry uses market.minOrderQuote whenever MarketInfo exists (308-309), and the simulator does the same (simulator.ts:181). The feeds always provide MarketInfo. PaperBroker is built without minOrderQuote (main.ts:144-148) and hard-codes €5. The UI setting (settings.js:67-68) is therefore ignored. Its help text, 'Kleinere orders slaat de bot over', is also wrong, because smaller orders are bumped up. The obvious workaround for the €5 trap (raising it to €6-10) silently does nothing.
- **Scenario:** With minOrderQuote set to 8 or 10, the plan is still approved at €5.00 ('opgehoogd naar minimum').
- **Voorgestelde fix:** Use max(market.minOrderQuote, cfg.minOrderQuote) in planEntry and in the simulator, and pass it to PaperBroker (updating it in setCosts). Alternatively, remove or relabel the field. Fix the help text.

### 17. With a small breakEvenAtR, the break-even stop is placed above the current high, forcing an immediate exit at a net loss

- **Ernst:** 🟡 middel · **Module:** `risk` · **Bestand:** `src/risk/riskManager.ts`:427 · **Status:** nog niet geverifieerd
- **Probleem:** The break-even raise sets stop = entry × (1 + roundTripCost) without checking that this level is below the highest or current price. When breakEvenAtR × R < roundTripCost × entry, the stop ends up above the market. validateRiskConfig allows breakEvenAtR from 0 to 5.
- **Scenario:** be_small.ts: breakEvenAtR 0.5 sets the stop to 100.60 while the high is 100.55. The next candle exits as 'break-even' with a -€0.0103 loss.
- **Voorgestelde fix:** Only raise the stop when highest ≥ beLevel plus a buffer, or cap the new stop below the close. Alternatively, have validation reject breakEvenAtR values too small to clear the fees.

### 18. Day rollover right after a restart values open positions at entry price

- **Ernst:** 🟡 middel · **Module:** `engine` · **Bestand:** `src/engine/tradingEngine.ts`:589 · **Status:** nog niet geverifieerd
- **Probleem:** After a restart `prices` is empty, so priceFor falls back to entryPrice. checkDayRollover runs before any prices load and sets dayStartEquity from entry-price values. Losses since entry then count as today's loss, and gains since entry loosen the limit.
- **Scenario:** restartday.ts: the real equity is €48.51, but the new day starts at €49.94. That uses up €1.43 of today's €2.50 allowance, and with two such positions the bot starts the day halted.
- **Voorgestelde fix:** Persist and restore the last prices, or postpone the dayStartEquity snapshot until every open-position market has a fresh price.

### 19. Held-candle count, time-stop and cooldown are one candle off between engine and backtester; ARCHITECTURE.md contradicts itself

- **Ernst:** ⚪ laag · **Module:** `backtest-strategies` · **Bestand:** `src/backtest/simulator.ts`:243 · **Status:** nog niet geverifieerd
- **Probleem:** Merged from 3 reports. The backtester counts the entry candle in candlesHeld and range-checks it (simulator.ts:240-245, 323). The engine skips candles with c.time < entryTime (tradingEngine.ts:683-686). So the time-stop fires one candle earlier in the backtest, avgCandlesHeld is inflated by 1, and the backtest catches intrabar wicks on the entry candle that the engine may not. The cooldown also differs: the backtest records lastLossAt at the exit candle's open (simulator.ts:235), while the engine uses the wall-clock exit time (tradingEngine.ts:1102). docs/ARCHITECTURE.md:42-44 states both rules.
- **Scenario:** With timeStopCandles 48, the backtest exits after 48 candles and the engine after 49. With a cooldown of 4 and a stop mid-candle i, the backtest re-enters at i+4 and the engine only at i+5.
- **Voorgestelde fix:** Pick one convention (e.g. the engine counts the entry candle when c.time + interval > entryTime, or the backtest counts it as 0), record lastLossAt consistently in both, and fix ARCHITECTURE.md.

### 20. Walk-forward buy & hold benchmark charges a buy+sell fee in every fold

- **Ernst:** 🟡 middel · **Module:** `backtest-strategies` · **Bestand:** `src/backtest/walkForwardCore.ts`:137 · **Status:** nog niet geverifieerd
- **Probleem:** Each fold's benchmark includes one buy fee and one sell fee, and the stitching compounds them (line 137 → oosMetrics.buyHoldReturnPct at 177). Buy & hold therefore pays about 0.5% × the number of folds. Both beatsBuyHold in the verdict and the UI quality badges use this understated number.
- **Scenario:** wf_bench.ts: with 8 folds, B&H is reported as +0.35% against a true +3.92%; with 20 folds, -6.29% against +3.05%. A strategy at +1.5% gets 'Robuust' when it should get 'niet beter dan buy & hold'.
- **Voorgestelde fix:** Stitch the raw price ratios and apply one entry fee and one exit fee in total. Add a test that flat prices give about -0.5% for any fold count.

### 21. Backtest 'Max. drawdown' KPI quality check uses the wrong sign: every drawdown is shown as 'good'

- **Ernst:** 🟡 middel · **Module:** `frontend` · **Bestand:** `public/js/panels/backtest.js`:638 · **Status:** nog niet geverifieerd
- **Probleem:** Merged from 3 reports. maxDrawdownPct is ≤ 0 by contract (metrics.ts), but quality('dd') tests `<= 10 ? 'good'`, so the result is always 'good'. The displayed number uses -Math.abs, which hides the bug. The walk-forward OOS KPI cards are affected too.
- **Scenario:** Drawdowns of -45%, -78.52% and -83.33% are all shown with a green ✓, next to '✕ RENDEMENT -78%'.
- **Voorgestelde fix:** const dd = Math.abs(m.maxDrawdownPct); return dd <= 10 ? 'good' : dd <= 20 ? 'warn' : 'bad'. Add a test.

### 22. Live engine decides on only historyCandles candles; bounds ignore strategy warmups, so ema-trend can be silently disabled live while backtests show it

- **Ernst:** 🟡 middel · **Module:** `engine` · **Bestand:** `src/engine/tradingEngine.ts`:605 · **Status:** nog niet geverifieerd
- **Probleem:** Merged from 2 reports. The engine runs decideFn on the last historyCandles closed candles only (605, 636). The backtester uses full history plus 250 warmup candles, and the scanner uses 150. The strategies are stateful and use SMA-seeded EMAs, and vwap resets from the start of the window. Validation (validation.ts:258, config.ts:174-178, settings.js:250) allows historyCandles ≥ 100, below ema-trend's warmup of 101 (201 with trend=200, a value the optimizer can apply). The Settings help text about EMA 200 refers to the chart, not to this. No lookahead was found.
- **Scenario:** window3.ts / warmup.ts: with historyCandles=100, ema-trend (weight 1.2) is active on 0 windows live against 132-440 at 300 or in the backtest, and there are 23 buys live against 69 in the backtest. With trend=200 and historyCandles 150: 0 active. The bot runs a different ensemble from the one the backtest validated.
- **Voorgestelde fix:** Fetch max(historyCandles, requiredWarmup + buffer ~200) candles, extended back to 00:00 UTC for VWAP. Alternatively, validate historyCandles ≥ the required warmup + margin in validateConfigPatch and readEngineOverrides. Fix the help text and add a sliding-window vs full-history test.

### 23. 'Pas beste instellingen toe' applies only the grid params, not the configuration the optimizer actually tested

- **Ernst:** 🟡 middel · **Module:** `frontend` · **Bestand:** `public/js/panels/backtest.js`:1160 · **Status:** nog niet geverifieerd
- **Probleem:** Merged from 3 reports. The optimizer request carries the lab form's enabled strategies, thresholds, stop/TP and risk (399-407), and the server force-enables the optimized strategy with weight ≥ 1 (optimizerCore.ts:107-110). paramsToPartial/confirmApply (1160-1250) PUT only row.params, and the confirm modal lists only those.
- **Scenario:** Only breakout enabled, buy 0.25, stop 3: the apply PUT sent only breakout params, and the bot ran all 5 strategies with buy 0.35 and stop 2. optapply.ts: breakout stayed disabled after applying, and the result was +1.26%/6 trades against the -0.77%/7 trades shown. The user believes the tested configuration is live.
- **Voorgestelde fix:** Build the partial from the full tested request (enabled including the forced strategy with weight > 0, thresholds, stop/TP, risk) merged with row.params, and list every change in the modal. Alternatively, have the server return the effective config per row.

### 24. CLI backtest ignores the bot's saved settings, .env and DATA_DIR

- **Ernst:** 🟡 middel · **Module:** `backtest-strategies` · **Bestand:** `src/cli/backtest.ts`:290 · **Status:** nog niet geverifieerd
- **Probleem:** Merged from 2 reports. main() always uses DEFAULT_ENGINE_CONFIG, while the bot uses loadConfig() (env + config.json). DATA_SOURCE and DATA_DIR are ignored, and the cache goes to process.cwd()/data/cache (line 278). The report never says which config it tested, while README 121-127 recommends the CLI walk-forward for checking 'je instellingen'.
- **Scenario:** A user tunes risk and thresholds in the dashboard, then runs `npm run backtest -- --walkforward`. The verdict describes the defaults. Run from another directory, the CLI also creates a stray ./data/cache there.
- **Voorgestelde fix:** Use loadConfig(process.env) for engine and dataDir, add a --defaults flag, print the tested config and its source in the report, and update the README.

### 25. Fixed 0.05% slippage ignores the market's bid/ask spread

- **Ernst:** ⚪ laag · **Module:** `backtest-strategies` · **Bestand:** `src/backtest/simulator.ts`:279 · **Status:** nog niet geverifieerd
- **Probleem:** The simulator uses one global slippagePct of 0.0005 for every market, while the app's own spreads for less liquid markets are 0.12-0.25% (half-spread 0.06-0.125%). minEdgeFeeMultiple and roundTripCostPct inherit the same underestimate.
- **Scenario:** ARB-EUR with 100 round trips books about 20% of notional less in costs than a market-order bot would pay.
- **Voorgestelde fix:** Use max(slippagePct, spread/2) per market, show the cost assumption in the report, or warn when the spread is larger than modelled.

### 26. Optimizer heatmap cells show the best score over all hidden parameters

- **Ernst:** ⚪ laag · **Module:** `backtest-strategies` · **Bestand:** `src/backtest/optimizerCore.ts`:211 · **Status:** nog niet geverifieerd
- **Probleem:** buildHeatmap stores the maximum score over 9 hidden combinations per cell, while the UI advises picking a 'breed groen gebied' as a guard against overfitting. A max aggregate makes regions look robust when only one hidden combination did well.
- **Scenario:** Cells with 1 good combination and 8 losing ones show as a broad green block.
- **Voorgestelde fix:** Aggregate with the median or mean and show the count or the fraction profitable. Alternatively, label cells as 'beste van N'.

### 27. Strategies' exit signals almost never close positions; the optimizer's sellThreshold axis has no effect

- **Ernst:** ⚪ laag · **Module:** `backtest-strategies` · **Bestand:** `src/strategies/ensemble.ts`:315 · **Status:** nog niet geverifieerd
- **Probleem:** The score is normalised over all enabled strategies, so a single exit vote reaches at most about -0.15 to -0.26 and never hits sellThreshold -0.3. The strategy descriptions promise exits that effectively do not happen, and the sellThreshold grid values produce identical results.
- **Scenario:** exits.ts: 7 of 351 trades exited on a signal. opt_rows.ts: the rows for -0.2, -0.3 and -0.45 are identical, so about 2/3 of the combination budget is wasted.
- **Voorgestelde fix:** Handle exit votes separately from the entry score (for example, exit when a strategy that contributed a buy vote emits its own exit), or normalise over non-hold votes. Otherwise, fix the descriptions and drop the grid axis.

### 28. Backtest silently trades through the warmup window when history is short or the requested period is short

- **Ernst:** 🟡 middel · **Module:** `server-config` · **Bestand:** `src/server/routes.ts`:186 · **Status:** nog niet geverifieerd
- **Probleem:** Merged from 2 reports. In loadHistory, tradeFromIndex falls back to 0 when a market's history starts after `from` (a recent listing) or when fewer than 30 candles fall inside the requested period (line 186; the CLI does the same at cli/backtest.ts:316). The equity curve and the B&H benchmark then start at candle 0, while the strategies are still in warmup, and short requests are silently widened, non-monotonically. The UI headers still show the requested days.
- **Scenario:** {interval:'4h',days:5} → 46.3 days span; {1h,days:1} → 11.3 days while {1h,days:2} → 1.9 days. A new listing that falls 30% during its first week is credited as 'beter dan buy & hold' purely because the strategies were in warmup.
- **Voorgestelde fix:** Never fall back to 0: start at the ensemble's required warmup and tell the user the period was shortened, or return a 400 ('Periode te kort…') and enforce a per-interval minimum in validation and the UI.

### 29. The fee is reported as €0 when Bitvavo has not settled it yet

- **Ernst:** ⚪ laag · **Module:** `exchange-data-brokers` · **Bestand:** `src/broker/liveBroker.ts`:113 · **Status:** nog niet geverifieerd
- **Probleem:** orderToResult adds up only the fill fees that are present. When the fills are unsettled and feePaid is 0, feeQuote stays 0 without a warning, and #needsPoll does not wait for this case. Live cash, P&L, R and the daily limit all end up optimistic.
- **Scenario:** s3_fee.ts: a filled buy with an unsettled fill gives feeQuote 0; the true fee is about €0.05.
- **Voorgestelde fix:** Estimate the fee as filledQuote × takerFee when it is unknown, and add a note or poll until settled.

### 30. Rounding can go UP for values with more than 15 significant digits (roundAmount/formatDecimal)

- **Ernst:** ⚪ laag · **Module:** `exchange-data-brokers` · **Bestand:** `src/exchange/precision.ts`:24 · **Status:** nog niet geverifieerd
- **Probleem:** snap() uses toPrecision(15), which rounds to nearest, before flooring, and formatDecimal also emits 15 significant digits. With large amounts at 8 decimals, the amount sent can be larger than the amount held.
- **Scenario:** roundAmount(12345678.123456789, 8) = 12345678.1234568 > input. A full-balance sell is rejected with 216, and the stop-loss keeps failing.
- **Voorgestelde fix:** Floor with exact decimal/BigInt arithmetic or by truncating the string. Use snap only to correct values just below an integer.

### 31. Local clock (not server-corrected) decides closed candles, the permanent cache and the rate-limit reset comparison

- **Ernst:** ⚪ laag · **Module:** `exchange-data-brokers` · **Bestand:** `src/data/bitvavoFeed.ts`:149 · **Status:** nog niet geverifieerd
- **Probleem:** BitvavoFeed and the engine use Date.now() to decide which candles are closed. The clock offset is applied only to signatures, and only when above 1 s, so never in paper mode. #respectRateLimit compares the server's resetAt with local time. A candle is cached as final right after its close.
- **Scenario:** With the PC clock 10 s fast, an incomplete candle is cached permanently and traded on. The rate-limit wait is skipped, which risks a 105 ban that also blocks stop-loss sells.
- **Voorgestelde fix:** Add client.serverNow(), synced via /time, use it everywhere, and cache only candles that closed at least a few seconds before serverNow.

### 32. DNS-rebinding protection bypassed by any hostname starting with "127."

- **Ernst:** 🔴 kritiek · **Module:** `server-config` · **Bestand:** `src/server/httpServer.ts`:66 · **Status:** nog niet geverifieerd
- **Probleem:** isLoopbackHost() accepts any Host header that starts with '127.', so a name like 127.x.attacker.example passes. The CSRF check only compares Origin with Host, which match in a rebinding attack. DASHBOARD_TOKEN is unset by default, so a rebinding page gets full API access, including arm, start, config, disarm and kill.
- **Scenario:** Tested with Host/Origin 127.attacker.example: POST /api/engine/stop returned 200; /api/live/arm and /api/engine/start returned 200 in live mode. An attacker page can read balances and place real orders.
- **Voorgestelde fix:** Match hosts exactly (localhost, [::1], strict /^127(\.\d{1,3}){3}$/). Reject cross-site Sec-Fetch-Site. Auto-generate a token in live mode, add a regression test, and fix the .env.example advice.

### 33. Cross-site GET requests to /api/* are accepted; a malicious page can exhaust the shared Bitvavo rate limit and block stop-loss sells

- **Ernst:** 🟠 hoog · **Module:** `server-config` · **Bestand:** `src/server/httpServer.ts`:139 · **Status:** nog niet geverifieerd
- **Probleem:** The Origin check only covers non-GET requests. /api/candles (no cache) and /api/scanner (the cache key includes limit) go to Bitvavo through the same client the engine and LiveBroker use. Throttling (sleeps of up to 65 s) or a 105 ban then also blocks authenticated sells.
- **Scenario:** 60 cross-site GETs to /api/scanner?limit=1..60 were all accepted and caused 1127 candle calls; on real Bitvavo that is about 1830 calls plus the ticker, well above the budget. Stop-loss sells then wait or fail for up to 15 minutes.
- **Voorgestelde fix:** Reject /api requests with a cross-site Sec-Fetch-Site or a mismatched Origin, require a custom header, normalise the scanner cache key, cache /api/candles, and give engine requests priority.

### 34. Live mode starts on a non-loopback HOST without DASHBOARD_TOKEN (only a console warning)

- **Ernst:** 🟡 middel · **Module:** `server-config` · **Bestand:** `src/main.ts`:216 · **Status:** nog niet geverifieerd
- **Probleem:** loadConfig does not refuse live mode on a non-loopback bind without a token, and there is no Host check in that case either. The API is fully open to the network.
- **Scenario:** With HOST=0.0.0.0 and live mode on café Wi-Fi, anyone can arm, start or kill with the public confirm text.
- **Voorgestelde fix:** Throw a ConfigError for live mode on a non-loopback host without a token (using the strict loopback check), or auto-generate and print a token.

### 35. Backtest/optimize/walk-forward run synchronously on the main thread and freeze the engine, live order polling and SSE

- **Ernst:** 🟡 middel · **Module:** `server-config` · **Bestand:** `src/server/routes.ts`:341 · **Status:** nog niet geverifieerd
- **Probleem:** heavy() is only a mutex. These CPU-bound calls block the event loop, which stops ticks, stop checks, LiveBroker polling, SSE and /api/engine/kill.
- **Scenario:** A walk-forward took 8.2 s, and /api/info waited 2.52 s during one. In live mode, stop-loss handling and the kill switch are delayed by that much.
- **Voorgestelde fix:** Run these jobs in a worker_threads Worker with a timeout and abort. At minimum, yield between combinations.

### 36. Shutdown force-exits after 10 s (or on a 2nd Ctrl+C / unhandled SIGHUP) even while a live order is in flight

- **Ernst:** 🟡 middel · **Module:** `server-config` · **Bestand:** `src/main.ts`:249 · **Status:** nog niet geverifieerd
- **Probleem:** The 10 s exit timer can fire during a POST or the unknown-outcome lookups, which can legitimately take longer than 10 s. No pending-order record is persisted first. SIGHUP and SIGBREAK are not handled. reconcileLiveBalances does not warn about Bitvavo coins that are missing from the ledger.
- **Scenario:** The user presses Ctrl+C during a timed-out buy and the process exits after 10 s. The buy filled, but state-live.json has no position, so the coins have no stop after a restart.
- **Voorgestelde fix:** Expose an order-in-flight flag, wait longer for it, require a third Ctrl+C, handle SIGHUP and SIGBREAK, persist a pending-order record, and warn about untracked balances at startup.

### 37. .env MARKETS/INTERVAL (and mode-specific risk) silently overridden once any setting is saved in the dashboard

- **Ernst:** 🟡 middel · **Module:** `server-config` · **Bestand:** `src/config.ts`:345 · **Status:** nog niet geverifieerd
- **Probleem:** Merged from 2 reports. PUT /api/config (routes.ts:237-238 → saveEngineOverrides) persists the complete EngineConfig on any UI action (settings save, scanner add, optimizer apply, defaults). loadConfig applies config.json after env, so later edits to MARKETS/INTERVAL in .env are ignored with no log. The same config.json is read in paper and live mode, so paper-tuned risk carries into live. README 53-54 and .env.example present both routes as equivalent.
- **Scenario:** precedence.ts: after one slider change, .env MARKETS=ADA-EUR/INTERVAL=1h (or SOL-EUR/4h) is ignored, and the bot keeps trading the old markets and interval.
- **Voorgestelde fix:** Persist only the keys the user changed, or let env win and log it. Warn at startup when config.json overrides env, document the precedence, and consider a per-mode overrides file or printing the effective live risk settings loudly.

### 38. Risk-config fallback in main.ts keeps the invalid fee values, and PaperBroker is created before the fallback

- **Ernst:** ⚪ laag · **Module:** `server-config` · **Bestand:** `src/main.ts`:172 · **Status:** nog niet geverifieerd
- **Probleem:** Merged from 2 reports. readEngineOverrides accepts any risk value ≥ 0. PaperBroker is built with engineConfig fees and slippage (144-148) before validation. The fallback resets to defaults but copies back takerFee/makerFee, including invalid ones (169-173), while the log says defaults are used. planEntry then rejects every buy. The types.ts naming note ('...Pct zijn echte procenten') contradicts slippagePct and roundTripCostPct, which are fractions.
- **Scenario:** With config.json takerFee 0.05 or 0.25, the bot never trades, every PUT risk change returns 400, and paper sells pay the invalid fee. With slippagePct 0.5, the engine uses the default but PaperBroker fills at 50% slippage.
- **Voorgestelde fix:** Validate and repair the risk block (per key, fees included) before building any broker, validate each key in readEngineOverrides, and fix the types.ts naming note.

### 39. Strategy parameters accept any finite number and inherited property names, and these are persisted

- **Ernst:** ⚪ laag · **Module:** `server-config` · **Bestand:** `src/server/validation.ts`:165 · **Status:** nog niet geverifieerd
- **Probleem:** `p in meta.defaultParams` accepts prototype names such as constructor and toString, and values are not range-checked. Both are persisted and accepted again on restart.
- **Scenario:** Setting ema-trend fast to 1e300 leaves ema-trend permanently in warmup, so it is silently disabled.
- **Voorgestelde fix:** Use Object.hasOwn, validate values against bounds derived from the strategy metadata, and apply the same check in readEngineOverrides.

### 40. User-input errors from services are reported as HTTP 500 'Interne fout' with stack traces

- **Ernst:** ⚪ laag · **Module:** `server-config` · **Bestand:** `src/server/httpServer.ts`:221 · **Status:** nog niet geverifieerd
- **Probleem:** Plain Errors thrown for foreseeable bad input (too few candles for the folds, very deeply nested JSON) become 500 responses and are logged with a stack trace.
- **Scenario:** A walk-forward with days:2 and folds:8 returns 500 'Interne fout: Te weinig candles…'.
- **Voorgestelde fix:** Validate folds up front, map a typed ValidationError to 400 without a stack trace, and cap JSON nesting depth.

### 41. Settings validation shows internal units for % and second fields; following the message stores a taker fee 25× too low

- **Ernst:** 🟡 middel · **Module:** `frontend` · **Bestand:** `public/js/panels/settings.js`:649 · **Status:** nog niet geverifieerd
- **Probleem:** validate() prints bounds in stored units (fractions, ms) next to inputs that are shown in % or seconds. Server messages use fractions too. A 0% fee is accepted without a warning.
- **Scenario:** Following 'tussen 0 en 0,01' saves takerFee 0.0001, which understates costs by about 0.5% per trade in paper trading and backtests.
- **Voorgestelde fix:** Show the bounds in display units, translate server messages, and warn when the fee is 0 or below 0.25%.

### 42. Optimizer view ignores best=null and shows a penalized combination (-1e9) as 'Beste combinatie' with an apply button

- **Ernst:** 🟡 middel · **Module:** `frontend` · **Bestand:** `public/js/panels/backtest.js`:1024 · **Status:** nog niet geverifieerd
- **Probleem:** `res.best || rows[0]` shows a penalized row as the best result. Penalized rows keep their Toepassen buttons, and when some rows are penalized, maxScore breaks the score bars.
- **Scenario:** BTC 1h over 3 days: 'BESTE COMBINATIE Sharpe -1.000.000.000' with an active apply button.
- **Voorgestelde fix:** Handle best === null with a message and no apply button, mark penalized rows 'te weinig trades', exclude them from maxScore, and disable their apply buttons.

### 43. Saving Settings with unsaved edits silently undoes config changes made elsewhere

- **Ernst:** 🟡 middel · **Module:** `frontend` · **Bestand:** `public/js/panels/settings.js`:826 · **Status:** nog niet geverifieerd
- **Probleem:** While the form has unsaved edits, it keeps the old draft and PUTs the whole draft, including params:null. Changes made elsewhere (a Scanner add, a Backtest apply, another tab) are reverted.
- **Scenario:** TRX-EUR added via the Scanner is removed silently on the next Settings save, which also triggers the lastEvaluated re-buy issue.
- **Voorgestelde fix:** PUT only the fields the user edited, or merge untouched fields into the draft and show 'elders gewijzigd'.

### 44. Signal panel never marks a decision stale after first render and keeps decisions the engine dropped

- **Ernst:** ⚪ laag · **Module:** `frontend` · **Bestand:** `public/js/panels/signals.js`:203 · **Status:** nog niet geverifieerd
- **Probleem:** The signature check returns early before the staleness chip is computed, and Object.assign never removes decisions the engine has dropped.
- **Scenario:** After an interval change, or when the feed fails for a market, an old 'KOOP' badge stays on screen indefinitely without a stale marker.
- **Voorgestelde fix:** Add the interval and a staleness bucket to the signature, re-render on a timer, and replace the decisions map from each snapshot.
