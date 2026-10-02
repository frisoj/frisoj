import {
  INTERVAL_MS,
  type BacktestMetrics,
  type Candle,
  type EquityCurvePoint,
  type Interval,
  type Trade,
} from "../core/types";

/** Cap for ratios that would otherwise be Infinity (no losses / no downside). */
export const RATIO_CAP = 999;

const YEAR_MS = 365 * 24 * 60 * 60 * 1000;

/** Number of candles per year; crypto trades 24/7, so no 252-day convention. */
export function periodsPerYear(interval: Interval): number {
  return YEAR_MS / INTERVAL_MS[interval];
}

/**
 * Growth factor of buy & hold: buy at `firstOpen` paying one taker fee
 * (fee = Q - Q/(1+f), like a market buy with amountQuote), sell at
 * `lastClose` paying one taker fee on the proceeds.
 */
export function buyHoldFactor(firstOpen: number, lastClose: number, takerFee: number): number {
  if (!(firstOpen > 0) || !Number.isFinite(lastClose)) return 1;
  return ((lastClose / firstOpen) * (1 - takerFee)) / (1 + takerFee);
}

/** Buy & hold return in % over `candles` (first open → last close, 1× fee in and out). */
export function buyHoldReturnPct(candles: Candle[], takerFee: number): number {
  if (candles.length === 0) return 0;
  return (buyHoldFactor(candles[0].open, candles[candles.length - 1].close, takerFee) - 1) * 100;
}

/** Largest peak-to-trough decline in % (<= 0). The first value is the starting peak. */
export function maxDrawdownPct(equities: number[]): number {
  let peak = -Infinity;
  let worst = 0;
  for (const e of equities) {
    if (e > peak) peak = e;
    if (peak > 0) {
      const dd = (e / peak - 1) * 100;
      if (dd < worst) worst = dd;
    }
  }
  return worst;
}

function finite(v: number, fallback = 0): number {
  return Number.isFinite(v) ? v : fallback;
}

function mean(values: number[]): number {
  if (values.length === 0) return 0;
  let s = 0;
  for (const v of values) s += v;
  return s / values.length;
}

export function emptyMetrics(initialCapital: number): BacktestMetrics {
  return {
    finalEquity: initialCapital,
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

/**
 * Performance statistics of a backtest.
 *
 * - Returns are per-candle equity returns (the equity curve is prefixed with
 *   `initialCapital`), annualised with sqrt(candles per year).
 * - `buyHoldReturnPct` is computed from `candles` (first open → last close,
 *   one taker fee in and out). Callers that stitch non-contiguous periods
 *   (walk-forward) override it with their compounded benchmark.
 * - `exposurePct` = exposureCandles / number of evaluated candles.
 */
export function computeMetrics(args: {
  trades: Trade[];
  equityCurve: EquityCurvePoint[];
  initialCapital: number;
  interval: Interval;
  candles: Candle[];
  takerFee: number;
  exposureCandles: number;
}): BacktestMetrics {
  const { trades, equityCurve, initialCapital, interval, candles, takerFee, exposureCandles } = args;
  const m = emptyMetrics(initialCapital);

  const equities: number[] = [initialCapital];
  for (const p of equityCurve) equities.push(p.equity);

  m.finalEquity = equities[equities.length - 1];
  m.totalReturnPct = initialCapital > 0 ? (m.finalEquity / initialCapital - 1) * 100 : 0;
  m.buyHoldReturnPct = buyHoldReturnPct(candles, takerFee);
  m.maxDrawdownPct = maxDrawdownPct(equities);

  // Sharpe / Sortino on per-candle returns (risk-free rate 0).
  const rets: number[] = [];
  for (let i = 1; i < equities.length; i++) {
    const prev = equities[i - 1];
    if (prev > 0) rets.push(equities[i] / prev - 1);
  }
  if (rets.length >= 2) {
    const ann = Math.sqrt(periodsPerYear(interval));
    const mu = mean(rets);
    let varSum = 0;
    let downSum = 0;
    for (const r of rets) {
      varSum += (r - mu) * (r - mu);
      if (r < 0) downSum += r * r;
    }
    const sd = Math.sqrt(varSum / (rets.length - 1));
    const downDev = Math.sqrt(downSum / rets.length);
    m.sharpe = sd > 1e-15 ? (mu / sd) * ann : 0;
    if (downDev > 1e-15) m.sortino = (mu / downDev) * ann;
    else m.sortino = mu > 0 ? RATIO_CAP : 0;
    m.sharpe = Math.max(-RATIO_CAP, Math.min(RATIO_CAP, m.sharpe));
    m.sortino = Math.max(-RATIO_CAP, Math.min(RATIO_CAP, m.sortino));
  }
  m.calmar = m.maxDrawdownPct < 0 ? m.totalReturnPct / Math.abs(m.maxDrawdownPct) : 0;

  // Trade statistics.
  m.trades = trades.length;
  if (trades.length > 0) {
    let grossWin = 0;
    let grossLoss = 0;
    let wins = 0;
    let winPctSum = 0;
    let losses = 0;
    let lossPctSum = 0;
    let pctSum = 0;
    let pnlSum = 0;
    let fees = 0;
    let held = 0;
    let best = -Infinity;
    let worst = Infinity;
    for (const t of trades) {
      pctSum += t.pnlPct;
      pnlSum += t.pnlQuote;
      fees += t.feesQuote;
      held += t.candlesHeld;
      if (t.pnlPct > best) best = t.pnlPct;
      if (t.pnlPct < worst) worst = t.pnlPct;
      if (t.pnlQuote > 0) {
        wins++;
        grossWin += t.pnlQuote;
        winPctSum += t.pnlPct;
      } else if (t.pnlQuote < 0) {
        losses++;
        grossLoss += -t.pnlQuote;
        lossPctSum += t.pnlPct;
      }
    }
    const n = trades.length;
    m.winRatePct = (wins / n) * 100;
    m.profitFactor = grossLoss > 0 ? Math.min(RATIO_CAP, grossWin / grossLoss) : grossWin > 0 ? RATIO_CAP : 0;
    m.avgTradePct = pctSum / n;
    m.avgWinPct = wins > 0 ? winPctSum / wins : 0;
    m.avgLossPct = losses > 0 ? lossPctSum / losses : 0;
    m.expectancyQuote = pnlSum / n;
    m.feesPaid = fees;
    m.bestTradePct = best;
    m.worstTradePct = worst;
    m.avgCandlesHeld = held / n;
  }

  const total = candles.length > 0 ? candles.length : equityCurve.length;
  m.exposurePct = total > 0 ? Math.min(100, (exposureCandles / total) * 100) : 0;

  // Never leak NaN/Infinity into JSON.
  for (const key of Object.keys(m) as (keyof BacktestMetrics)[]) {
    m[key] = finite(m[key], key === "finalEquity" ? initialCapital : 0);
  }
  return m;
}
