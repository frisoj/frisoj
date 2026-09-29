/**
 * Core bar-by-bar backtest simulation. Deliberately free of imports from the
 * strategy / risk modules: everything is injected, so this file (and its unit
 * tests) work on their own. `backtester.ts` wires in the real defaults.
 *
 * Timing (see docs/ARCHITECTURE.md "Signal timing"):
 * - decision[i] uses candles[0..i] and is executed at the OPEN of candle i+1
 *   (+ slippage, + taker fee);
 * - exits are checked on each candle's high/low, starting with the entry
 *   candle itself (the entry happened at its open);
 * - `candlesHeld` counts only full candles AFTER the fill, like the engine
 *   (which skips the entry candle): the entry candle's range is checked but
 *   not counted, so time-stop and avgCandlesHeld match the live bot;
 * - the loss cooldown runs from the exit moment: the candle's open for a
 *   signal exit, its close for an intrabar exit (stop / TP / time-stop), just
 *   like the engine, which books intrabar exits after the candle opened;
 * - stop and take-profit in one candle → the risk manager assumes the stop;
 * - an exit is only booked when the position is worth at least the EXCHANGE
 *   minimum order (MarketInfo, default €5 — never `risk.minOrderQuote`, which
 *   is a user setting for entries): Bitvavo and the brokers reject smaller
 *   sells. Otherwise the sell stays pending, exactly like the engine: no
 *   stops / signals any more, just a new attempt as soon as
 *   `amount × price >= minimum`;
 * - slippage per side is never below half the market's bid/ask spread
 *   (`spreadPct`, optional).
 */
import type {
  AccountSnapshot,
  BacktestResult,
  Candle,
  DataSource,
  EnsembleConfig,
  EnsembleDecision,
  EquityCurvePoint,
  ExitReason,
  Interval,
  MarketInfo,
  Position,
  RiskConfig,
  RiskManagerLike,
  SignalMarker,
  Ticker24h,
  Trade,
} from "../core/types";
import { INTERVAL_MS } from "../core/types";
import { dayKey } from "../core/util";
import { buyHoldFactor, computeMetrics, emptyMetrics } from "./metrics";

export interface BacktestInput {
  market: string;
  interval: Interval;
  candles: Candle[];
  initialCapital: number;
  ensemble: EnsembleConfig;
  risk: RiskConfig;
  marketInfo?: MarketInfo;
  dataSource?: DataSource;
  /** Candles before this index are indicator warmup only: no trading, not in equity curve/metrics (default 0) */
  tradeFromIndex?: number;
  /**
   * Optional bid/ask spread of the market as a fraction of the mid price
   * ((ask − bid) / mid). A market order pays about half of it per side, so the
   * backtest uses max(risk.slippagePct, spreadPct / 2) as slippage (also for
   * the risk manager's cost filter). Unknown → only risk.slippagePct.
   */
  spreadPct?: number;
}

/** Slippage per side the backtest uses: never less than half the market's bid/ask spread. */
export function effectiveSlippagePct(risk: RiskConfig, spreadPct?: number): number {
  const base = Number.isFinite(risk.slippagePct) && risk.slippagePct > 0 ? risk.slippagePct : 0;
  const half = typeof spreadPct === "number" && Number.isFinite(spreadPct) && spreadPct > 0 ? spreadPct / 2 : 0;
  return Math.max(base, half);
}

/**
 * The input with `risk.slippagePct` raised to the effective slippage, so the
 * simulation AND the risk manager (min-edge filter, break-even level) use the
 * same costs. Idempotent.
 */
export function withSpreadCosts(input: BacktestInput): BacktestInput {
  const slip = effectiveSlippagePct(input.risk, input.spreadPct);
  if (slip === input.risk.slippagePct) return input;
  return { ...input, risk: { ...input.risk, slippagePct: slip } };
}

/** Relative bid/ask spread ((ask − bid) / mid) from a 24h ticker, or undefined when unknown. */
export function spreadFromTicker(t: Pick<Ticker24h, "bid" | "ask"> | undefined | null): number | undefined {
  if (!t) return undefined;
  const { bid, ask } = t;
  if (typeof bid !== "number" || typeof ask !== "number" || !(bid > 0) || !(ask >= bid)) return undefined;
  const mid = (bid + ask) / 2;
  const s = (ask - bid) / mid;
  return Number.isFinite(s) ? s : undefined;
}

/** Bitvavo's minimum order value in EUR when there is no MarketInfo (same default as the brokers and the engine). */
export const DEFAULT_EXCHANGE_MIN_QUOTE = 5;

/**
 * The EXCHANGE minimum order value (EUR) for buys and sells: MarketInfo's
 * value, or Bitvavo's default of €5. Never `risk.minOrderQuote`: that is a
 * user setting (the risk manager uses it as an extra floor for entries); the
 * brokers refuse exactly what Bitvavo refuses, not more and not less.
 */
export function exchangeMinOrderQuote(marketInfo?: Pick<MarketInfo, "minOrderQuote"> | null): number {
  const v = marketInfo?.minOrderQuote;
  return typeof v === "number" && Number.isFinite(v) && v >= 0 ? v : DEFAULT_EXCHANGE_MIN_QUOTE;
}

export interface BacktestDeps {
  decide?: (market: string, candles: Candle[], cfg: EnsembleConfig) => EnsembleDecision[];
  createRisk?: (cfg: RiskConfig, interval: Interval) => RiskManagerLike;
}

export type ResolvedBacktestDeps = Required<BacktestDeps>;

export interface SimulationOptions {
  /** Skip chart candles + markers (used by the optimizer for speed). */
  lite?: boolean;
}

export interface SimulationOutput {
  result: BacktestResult;
  /** Number of evaluated candles during which a position was in the market. */
  exposureCandles: number;
  /** Slippage per side that was actually used (incl. half the spread). */
  slippagePct: number;
  /** Trades whose sell was first refused because the position was worth less than the minimum order (= result.stuckTrades). */
  stuckTrades: number;
  /**
   * Of those: trades that were STILL unsellable at the end of the test (booked
   * as "end-of-backtest" at the last close, which in reality is not possible).
   * The rest was sold later after all.
   */
  stuckAtEnd: number;
  /** Candles spent waiting for such a refused sell (position open, no stops). */
  stuckCandles: number;
  /** Exchange minimum order value (EUR) that was used for buys and sells. */
  minOrderQuote: number;
}

/** Max number of candles returned for the chart. */
export const MAX_CHART_CANDLES = 1500;

const dayKeyCache = new WeakMap<Candle[], string[]>();

/** dayKey per candle, cached per candles array (the optimizer re-uses the same array). */
function dayKeysFor(candles: Candle[]): string[] {
  let keys = dayKeyCache.get(candles);
  if (!keys || keys.length !== candles.length) {
    keys = candles.map((c) => dayKey(c.time));
    dayKeyCache.set(candles, keys);
  }
  return keys;
}

/** Dutch percentage, e.g. +1,8% / -0,9%. */
export function fmtPctNl(value: number, decimals = 1): string {
  const v = Number.isFinite(value) ? value : 0;
  const rounded = Number(Math.abs(v).toFixed(decimals));
  const sign = rounded === 0 ? "+" : v > 0 ? "+" : "-";
  return `${sign}${rounded.toFixed(decimals).replace(".", ",")}%`;
}

const EXIT_LABEL: Record<ExitReason, string> = {
  "stop-loss": "SL",
  "take-profit": "TP",
  "trailing-stop": "TRAIL",
  "break-even": "BE",
  signal: "SIGNAAL",
  "time-stop": "TIJD",
  manual: "HAND",
  "kill-switch": "KILL",
  "end-of-backtest": "EINDE",
};

export function exitMarkerLabel(reason: ExitReason, pnlPct: number): string {
  return `${EXIT_LABEL[reason] ?? "VERKOOP"} ${fmtPctNl(pnlPct)}`;
}

/** Tolerance for the minimum-order check (same as the paper broker). */
const MIN_ORDER_EPS = 1e-8;

const EXIT_NL: Record<ExitReason, string> = {
  "stop-loss": "stop-loss",
  "take-profit": "take-profit",
  "trailing-stop": "trailing stop",
  "break-even": "break-even-stop",
  signal: "verkoopsignaal",
  "time-stop": "tijdstop",
  manual: "handmatig",
  "kill-switch": "noodstop",
  "end-of-backtest": "einde test",
};

function eurNl(x: number): string {
  return `€${x.toFixed(2).replace(".", ",")}`;
}

/** Dutch note for a trade whose sell was refused because the position was worth less than the minimum order. */
function stuckNote(pe: { reason: ExitReason; candles: number }, minOrder: number, stillOpen: boolean): string {
  const k = pe.candles;
  const waited = `${k} ${k === 1 ? "candle" : "candles"}`;
  const head = `LET OP: verkoop (${EXIT_NL[pe.reason] ?? pe.reason}) geweigerd, positie was minder waard dan het minimum van ${eurNl(minOrder)}`;
  return stillOpen
    ? `${head}; na ${waited} wachten aan het einde van de test nog steeds niet verkoopbaar`
    : `${head}; pas na ${waited} wachten verkocht`;
}

function entryReasonOf(decision: EnsembleDecision, planReasons: string[]): string {
  const buyReasons = (decision.votes ?? []).filter((v) => v.action === "buy").map((v) => v.reason);
  const head = `Score ${decision.score.toFixed(2).replace(".", ",")}`;
  if (buyReasons.length > 0) return `${head}: ${buyReasons.join("; ")}`;
  if (planReasons.length > 0) return `${head}: ${planReasons.join("; ")}`;
  return head;
}

/** Aggregate candles into groups of `k` (OHLCV), group time = first candle's time. */
export function aggregateCandles(candles: Candle[], k: number): Candle[] {
  if (k <= 1) return candles.slice();
  const out: Candle[] = [];
  for (let s = 0; s < candles.length; s += k) {
    const e = Math.min(candles.length, s + k);
    let high = -Infinity;
    let low = Infinity;
    let volume = 0;
    for (let j = s; j < e; j++) {
      const c = candles[j];
      if (c.high > high) high = c.high;
      if (c.low < low) low = c.low;
      volume += c.volume;
    }
    out.push({ time: candles[s].time, open: candles[s].open, high, low, close: candles[e - 1].close, volume });
  }
  return out;
}

function emptyResult(input: BacktestInput, startedAt: number): SimulationOutput {
  const c = input.candles;
  return {
    exposureCandles: 0,
    slippagePct: effectiveSlippagePct(input.risk, input.spreadPct),
    stuckTrades: 0,
    stuckAtEnd: 0,
    stuckCandles: 0,
    minOrderQuote: exchangeMinOrderQuote(input.marketInfo),
    result: {
      market: input.market,
      interval: input.interval,
      dataSource: input.dataSource ?? "simulated",
      from: c.length ? c[0].time : 0,
      to: c.length ? c[c.length - 1].time : 0,
      candlesCount: 0,
      initialCapital: input.initialCapital,
      metrics: emptyMetrics(input.initialCapital),
      trades: [],
      equityCurve: [],
      candles: [],
      markers: [],
      durationMs: Date.now() - startedAt,
      stuckTrades: 0,
    },
  };
}

interface TradeMeta {
  entryIdx: number;
  exitIdx: number;
  entryScore: number;
  exitScore: number;
}

/**
 * Run the simulation on precomputed decisions (decisions[i] belongs to candles[i]).
 * Single market, at most one position at a time.
 */
export function simulate(
  input: BacktestInput,
  decisions: EnsembleDecision[],
  risk: RiskManagerLike,
  opts: SimulationOptions = {},
): SimulationOutput {
  const startedAt = Date.now();
  const { candles, market, interval, initialCapital } = input;
  const n = candles.length;
  if (decisions.length !== n) {
    throw new Error(`Backtest: ${decisions.length} beslissingen voor ${n} candles (moet gelijk zijn).`);
  }
  const evalStart = Math.max(0, Math.min(n, Math.floor(input.tradeFromIndex ?? 0)));
  if (n === 0 || evalStart >= n) return emptyResult(input, startedAt);

  const fee = input.risk.takerFee;
  const slip = effectiveSlippagePct(input.risk, input.spreadPct);
  // Exchange minimum for buys AND sells (like PaperBroker / LiveBroker), not the risk setting.
  const minOrder = exchangeMinOrderQuote(input.marketInfo);
  const intervalMs = INTERVAL_MS[interval] ?? 0;
  const dayKeys = dayKeysFor(candles);
  const loopStart = Math.max(evalStart, 1);

  let cash = initialCapital;
  // `as` keeps TS from narrowing to null: the closures below assign it.
  let pos = null as Position | null;
  let posEntryIdx = -1;
  let posEntryScore = 0;
  let exposureCandles = 0;
  /**
   * An exit the exchange would refuse (position worth less than the minimum
   * order). Like the engine's `pendingExit`: the position stays open, no more
   * stops / take-profit / signals, the sell is retried until it is big enough.
   */
  let pendingExit = null as { reason: ExitReason; score: number; candles: number } | null;
  let stuckTrades = 0;
  let stuckAtEnd = 0;
  let stuckCandles = 0;

  const trades: Trade[] = [];
  const tradeMeta: TradeMeta[] = [];
  const lastLossAt: Record<string, number> = {};
  let currentDay = dayKeys[evalStart];
  let dayStartEquity = initialCapital;
  let tradesToday = 0;
  let realizedPnlToday = 0;
  let lastEquity = initialCapital;

  const curveLen = n - evalStart;
  const eqValues = new Float64Array(curveLen);
  if (evalStart < loopStart) eqValues[0] = initialCapital; // candle 0 cannot trade (no prior decision)

  /** Would the brokers accept a sell of the whole position at this (pre-slippage) price? */
  const sellable = (p: Position, rawPrice: number): boolean =>
    !(minOrder > 0) || p.amount * rawPrice >= minOrder - MIN_ORDER_EPS;

  /**
   * Book the exit. `exitAt` = moment of the exit for the loss cooldown: the
   * candle's open for exits at the open, its close for intrabar exits (the
   * engine only notices those after the candle opened).
   */
  const closePosition = (i: number, rawPrice: number, reason: ExitReason, score: number, exitAt = candles[i].time): void => {
    const p = pos!;
    const c = candles[i];
    const fillPrice = rawPrice * (1 - slip);
    const gross = p.amount * fillPrice;
    const exitFee = gross * fee;
    const proceeds = gross - exitFee;
    cash += proceeds;
    const pnl = proceeds - p.costQuote;
    const initialRisk = (p.entryPrice - p.initialStopPrice) * p.amount;
    trades.push({
      id: `bt_${market}_${p.entryTime}`,
      market,
      entryTime: p.entryTime,
      exitTime: c.time,
      entryPrice: p.entryPrice,
      exitPrice: fillPrice,
      amount: p.amount,
      costQuote: p.costQuote,
      proceedsQuote: proceeds,
      feesQuote: p.entryFeeQuote + exitFee,
      pnlQuote: pnl,
      pnlPct: p.costQuote > 0 ? (pnl / p.costQuote) * 100 : 0,
      rMultiple: initialRisk > 0 ? pnl / initialRisk : 0,
      exitReason: reason,
      candlesHeld: p.candlesHeld,
      entryReason: pendingExit ? `${p.entryReason} · ${stuckNote(pendingExit, minOrder, reason === "end-of-backtest")}` : p.entryReason,
    });
    tradeMeta.push({ entryIdx: posEntryIdx, exitIdx: i, entryScore: posEntryScore, exitScore: score });
    realizedPnlToday += pnl;
    if (pnl < 0) lastLossAt[market] = exitAt;
    pos = null;
    pendingExit = null;
  };

  /** The sell is refused (worth < minimum order): keep the position open and retry later. */
  const refuseExit = (reason: ExitReason, score: number): void => {
    if (!pendingExit) stuckTrades++;
    pendingExit = { reason, score, candles: 0 };
  };

  /**
   * Candle i while a refused sell is pending: only retry the sell (at the open,
   * else as soon as the price reaches minimum / amount inside the candle).
   */
  const retryPendingExit = (i: number): void => {
    const p = pos!;
    const pe = pendingExit!;
    const c = candles[i];
    p.candlesHeld += 1;
    exposureCandles++;
    pe.candles++;
    stuckCandles++;
    if (sellable(p, c.open)) {
      closePosition(i, c.open, pe.reason, pe.score, c.time);
    } else if (sellable(p, c.high)) {
      const px = Math.min(c.high, Math.max(c.low, minOrder / p.amount));
      closePosition(i, px, pe.reason, pe.score, c.time + intervalMs);
    }
  };

  /**
   * Stop / take-profit / trailing / time-stop check on the full range of candle i.
   * `countHeld` = false for the entry candle: its range is checked (the entry
   * happened at its open) but, like in the engine, it is not a held candle.
   */
  const rangeCheck = (i: number, countHeld = true): void => {
    const p = pos!;
    const c = candles[i];
    if (countHeld) p.candlesHeld += 1;
    exposureCandles++;
    const upd = risk.updatePosition(p, c, decisions[i - 1].atr, true);
    if (upd.exit) {
      let px = upd.exitPrice;
      if (px === undefined || !Number.isFinite(px)) px = c.close;
      // A fill can never be outside the candle's range.
      px = Math.min(c.high, Math.max(c.low, px));
      const reason = upd.exitReason ?? "stop-loss";
      const score = decisions[i - 1].score;
      if (sellable(p, px)) {
        // A gap through the stop / take-profit fills at the open; everything else happens inside the candle.
        const atOpen = reason !== "time-stop" && px === c.open;
        closePosition(i, px, reason, score, atOpen ? c.time : c.time + intervalMs);
      } else {
        refuseExit(reason, score); // stops stay where they are: the engine no longer evaluates them
      }
    } else {
      if (Number.isFinite(upd.stopPrice)) p.stopPrice = Math.max(p.stopPrice, upd.stopPrice); // stops never go down
      if (Number.isFinite(upd.highestPrice)) p.highestPrice = Math.max(p.highestPrice, upd.highestPrice);
    }
  };

  /** Try to open a position at the open of candle i based on decision d = decisions[i-1]. */
  const tryEntry = (i: number, d: EnsembleDecision): boolean => {
    const c = candles[i];
    const account: AccountSnapshot = {
      cashQuote: cash,
      equity: cash,
      dayStartEquity,
      tradesToday,
      realizedPnlToday,
      openPositions: [],
      lastLossAt: { ...lastLossAt },
    };
    if (risk.haltStatus(account).halted) return false;
    const plan = risk.planEntry(d, account, input.marketInfo, c.time);
    if (!plan.approved) return false;
    const quote = Math.min(plan.quoteAmount, cash);
    if (!(quote > 0) || quote < minOrder) return false;
    const stopDist = plan.expectedEntryPrice - plan.stopPrice;
    if (!(stopDist > 0) || !Number.isFinite(stopDist)) return false;
    const tpDist = plan.takeProfitPrice - plan.expectedEntryPrice;

    const fill = c.open * (1 + slip);
    const entryFee = quote - quote / (1 + fee);
    const amount = (quote - entryFee) / fill;
    const stop = fill - stopDist;
    if (!(amount > 0) || !(stop > 0)) return false;
    cash -= quote;
    tradesToday++;
    pos = {
      id: `pos_${market}_${c.time}`,
      market,
      side: "long",
      entryTime: c.time,
      entryPrice: fill,
      amount,
      costQuote: quote,
      entryFeeQuote: entryFee,
      stopPrice: stop,
      initialStopPrice: stop,
      takeProfitPrice: Number.isFinite(tpDist) ? fill + tpDist : plan.takeProfitPrice,
      highestPrice: fill,
      candlesHeld: 0,
      entryReason: entryReasonOf(d, plan.reasons),
    };
    posEntryIdx = i;
    posEntryScore = d.score;
    pendingExit = null;
    return true;
  };

  for (let i = loopStart; i < n; i++) {
    const c = candles[i];
    const prev = decisions[i - 1];

    if (dayKeys[i] !== currentDay) {
      currentDay = dayKeys[i];
      dayStartEquity = lastEquity;
      tradesToday = 0;
      realizedPnlToday = 0;
    }

    if (pos) {
      if (pendingExit) {
        // Like TradingEngine.managePosition: a pending sell is only retried (no stops, TP or signals).
        retryPendingExit(i);
      } else if (risk.shouldExitOnSignal(pos, prev)) {
        // Chronologically first: a sell decision from the previous close is executed at this open.
        if (sellable(pos, c.open)) {
          closePosition(i, c.open, "signal", prev.score, c.time);
        } else {
          refuseExit("signal", prev.score);
          retryPendingExit(i); // the engine keeps retrying during this candle
        }
      } else {
        rangeCheck(i);
      }
    } else if (prev.action === "buy") {
      if (tryEntry(i, prev)) rangeCheck(i, false); // entry at the open → this candle's range is checked (not counted as held)
    }

    lastEquity = cash + (pos ? pos.amount * c.close : 0);
    eqValues[i - evalStart] = lastEquity;
  }

  if (pos) {
    // Mark-to-market at the last close (not a real sell, so no minimum-order check).
    if (pendingExit) stuckAtEnd++;
    closePosition(n - 1, candles[n - 1].close, "end-of-backtest", decisions[n - 1].score);
    eqValues[curveLen - 1] = cash;
  }

  // Equity curve + buy & hold benchmark (from the first evaluated candle's open, 1× fee in/out).
  const firstOpen = candles[evalStart].open;
  const equityCurve: EquityCurvePoint[] = new Array(curveLen);
  let peak = initialCapital;
  for (let j = 0; j < curveLen; j++) {
    const c = candles[evalStart + j];
    const eq = eqValues[j];
    if (eq > peak) peak = eq;
    equityCurve[j] = {
      time: c.time,
      equity: eq,
      benchmark: initialCapital * buyHoldFactor(firstOpen, c.close, fee),
      drawdownPct: peak > 0 ? Math.min(0, (eq / peak - 1) * 100) : 0,
    };
  }

  const evalCandles = evalStart === 0 ? candles : candles.slice(evalStart);
  const metrics = computeMetrics({
    trades,
    equityCurve,
    initialCapital,
    interval,
    candles: evalCandles,
    takerFee: fee,
    exposureCandles,
  });

  let chartCandles: Candle[] = [];
  let markers: SignalMarker[] = [];
  if (!opts.lite) {
    const k = Math.max(1, Math.ceil(evalCandles.length / MAX_CHART_CANDLES));
    chartCandles = aggregateCandles(evalCandles, k);
    const chartTime = (idx: number): number =>
      k === 1 ? candles[idx].time : candles[evalStart + Math.floor((idx - evalStart) / k) * k].time;
    trades.forEach((t, j) => {
      const meta = tradeMeta[j];
      markers.push({ time: chartTime(meta.entryIdx), action: "buy", price: t.entryPrice, score: meta.entryScore, label: "KOOP" });
      markers.push({
        time: chartTime(meta.exitIdx),
        action: "sell",
        price: t.exitPrice,
        score: meta.exitScore,
        label: exitMarkerLabel(t.exitReason, t.pnlPct),
      });
    });
    markers = markers.map((m, idx) => ({ m, idx })).sort((a, b) => a.m.time - b.m.time || a.idx - b.idx).map((x) => x.m);
  }

  return {
    exposureCandles,
    slippagePct: slip,
    stuckTrades,
    stuckAtEnd,
    stuckCandles,
    minOrderQuote: minOrder,
    result: {
      market,
      interval,
      dataSource: input.dataSource ?? "simulated",
      from: candles[evalStart].time,
      to: candles[n - 1].time,
      candlesCount: curveLen,
      initialCapital,
      metrics,
      trades,
      equityCurve,
      candles: chartCandles,
      markers,
      durationMs: Date.now() - startedAt,
      stuckTrades,
    },
  };
}

/** runBacktest with fully resolved dependencies (no defaults from other modules). */
export function runBacktestWith(input: BacktestInput, deps: ResolvedBacktestDeps, opts?: SimulationOptions): SimulationOutput {
  const startedAt = Date.now();
  const costed = withSpreadCosts(input);
  const decisions = deps.decide(costed.market, costed.candles, costed.ensemble);
  const out = simulate(costed, decisions, deps.createRisk(costed.risk, costed.interval), opts);
  out.result.durationMs = Date.now() - startedAt;
  return out;
}
