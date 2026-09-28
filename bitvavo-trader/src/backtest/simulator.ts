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
 * - stop and take-profit in one candle → the risk manager assumes the stop.
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
  Trade,
} from "../core/types";
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
  const slip = input.risk.slippagePct;
  const minOrder = input.marketInfo?.minOrderQuote ?? input.risk.minOrderQuote ?? 0;
  const dayKeys = dayKeysFor(candles);
  const loopStart = Math.max(evalStart, 1);

  let cash = initialCapital;
  let pos: Position | null = null;
  let posEntryIdx = -1;
  let posEntryScore = 0;
  let exposureCandles = 0;

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

  const closePosition = (i: number, rawPrice: number, reason: ExitReason, score: number): void => {
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
      entryReason: p.entryReason,
    });
    tradeMeta.push({ entryIdx: posEntryIdx, exitIdx: i, entryScore: posEntryScore, exitScore: score });
    realizedPnlToday += pnl;
    if (pnl < 0) lastLossAt[market] = c.time;
    pos = null;
  };

  /** Stop / take-profit / trailing / time-stop check on the full range of candle i. */
  const rangeCheck = (i: number): void => {
    const p = pos!;
    const c = candles[i];
    p.candlesHeld += 1;
    exposureCandles++;
    const upd = risk.updatePosition(p, c, decisions[i - 1].atr, true);
    if (upd.exit) {
      let px = upd.exitPrice;
      if (px === undefined || !Number.isFinite(px)) px = c.close;
      // A fill can never be outside the candle's range.
      px = Math.min(c.high, Math.max(c.low, px));
      closePosition(i, px, upd.exitReason ?? "stop-loss", decisions[i - 1].score);
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
      // Chronologically first: a sell decision from the previous close is executed at this open.
      if (risk.shouldExitOnSignal(pos, prev)) closePosition(i, c.open, "signal", prev.score);
      else rangeCheck(i);
    } else if (prev.action === "buy") {
      if (tryEntry(i, prev)) rangeCheck(i); // entry at the open → this candle's range counts
    }

    const p = pos as Position | null;
    lastEquity = cash + (p ? p.amount * c.close : 0);
    eqValues[i - evalStart] = lastEquity;
  }

  if (pos) {
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
    },
  };
}

/** runBacktest with fully resolved dependencies (no defaults from other modules). */
export function runBacktestWith(input: BacktestInput, deps: ResolvedBacktestDeps, opts?: SimulationOptions): SimulationOutput {
  const startedAt = Date.now();
  const decisions = deps.decide(input.market, input.candles, input.ensemble);
  const out = simulate(input, decisions, deps.createRisk(input.risk, input.interval), opts);
  out.result.durationMs = Date.now() - startedAt;
  return out;
}
