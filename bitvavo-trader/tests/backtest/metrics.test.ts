import { describe, expect, it } from "vitest";
import { RATIO_CAP, buyHoldFactor, computeMetrics, maxDrawdownPct, periodsPerYear } from "../../src/backtest/metrics";
import type { EquityCurvePoint, Trade } from "../../src/core/types";
import { T0, STEP, flatCandles } from "./helpers";

function trade(pnlQuote: number, opts: Partial<Trade> = {}): Trade {
  const cost = opts.costQuote ?? 100;
  return {
    id: `t${Math.random()}`,
    market: "TEST-EUR",
    entryTime: T0,
    exitTime: T0 + STEP,
    entryPrice: 100,
    exitPrice: 100,
    amount: 1,
    costQuote: cost,
    proceedsQuote: cost + pnlQuote,
    feesQuote: 0.5,
    pnlQuote,
    pnlPct: (pnlQuote / cost) * 100,
    rMultiple: 0,
    exitReason: "signal",
    candlesHeld: 4,
    entryReason: "",
    ...opts,
  };
}

function curve(equities: number[]): EquityCurvePoint[] {
  return equities.map((equity, i) => ({ time: T0 + i * STEP, equity, benchmark: 100, drawdownPct: 0 }));
}

const base = { interval: "1h" as const, takerFee: 0.0025, exposureCandles: 0 };

describe("computeMetrics", () => {
  it("trade statistics on a known trade list", () => {
    const trades = [trade(10, { candlesHeld: 2 }), trade(-5, { candlesHeld: 4 }), trade(5, { candlesHeld: 6 }), trade(-2.5, { candlesHeld: 8 })];
    const m = computeMetrics({ ...base, trades, equityCurve: curve([110, 105, 110, 107.5]), initialCapital: 100, candles: flatCandles(4) });
    expect(m.trades).toBe(4);
    expect(m.winRatePct).toBe(50);
    expect(m.profitFactor).toBeCloseTo(15 / 7.5, 12);
    expect(m.expectancyQuote).toBeCloseTo(7.5 / 4, 12);
    expect(m.avgTradePct).toBeCloseTo((10 - 5 + 5 - 2.5) / 4, 12);
    expect(m.avgWinPct).toBeCloseTo(7.5, 12);
    expect(m.avgLossPct).toBeCloseTo(-3.75, 12);
    expect(m.bestTradePct).toBe(10);
    expect(m.worstTradePct).toBe(-5);
    expect(m.feesPaid).toBeCloseTo(2, 12);
    expect(m.avgCandlesHeld).toBe(5);
    expect(m.finalEquity).toBe(107.5);
    expect(m.totalReturnPct).toBeCloseTo(7.5, 12);
  });

  it("profit factor: 999 without losses, 0 without trades", () => {
    const noLoss = computeMetrics({ ...base, trades: [trade(3), trade(1)], equityCurve: curve([103, 104]), initialCapital: 100, candles: flatCandles(2) });
    expect(noLoss.profitFactor).toBe(RATIO_CAP);
    expect(noLoss.winRatePct).toBe(100);
    expect(noLoss.avgLossPct).toBe(0);
    const none = computeMetrics({ ...base, trades: [], equityCurve: curve([100, 100]), initialCapital: 100, candles: flatCandles(2) });
    expect(none.profitFactor).toBe(0);
    expect(none.trades).toBe(0);
    expect(none.winRatePct).toBe(0);
    expect(none.sharpe).toBe(0);
    expect(none.calmar).toBe(0);
  });

  it("max drawdown and calmar", () => {
    const m = computeMetrics({ ...base, trades: [], equityCurve: curve([110, 99, 120]), initialCapital: 100, candles: flatCandles(3) });
    expect(m.maxDrawdownPct).toBeCloseTo((99 / 110 - 1) * 100, 12);
    expect(m.calmar).toBeCloseTo(20 / Math.abs((99 / 110 - 1) * 100), 12);
    expect(maxDrawdownPct([100, 90, 95, 80, 120])).toBeCloseTo(-20, 12);
    expect(maxDrawdownPct([100, 101, 102])).toBe(0);
  });

  it("annualises Sharpe / Sortino with sqrt(candles per year) (24/7)", () => {
    expect(periodsPerYear("1h")).toBe(365 * 24);
    expect(periodsPerYear("15m")).toBe(365 * 24 * 4);
    expect(periodsPerYear("1d")).toBe(365);
    const rets = [0.01, -0.01, 0.02];
    const eq: number[] = [];
    let e = 100;
    for (const r of rets) {
      e *= 1 + r;
      eq.push(e);
    }
    const m = computeMetrics({ ...base, trades: [], equityCurve: curve(eq), initialCapital: 100, candles: flatCandles(3) });
    const mu = (0.01 - 0.01 + 0.02) / 3;
    const sd = Math.sqrt(((0.01 - mu) ** 2 + (-0.01 - mu) ** 2 + (0.02 - mu) ** 2) / 2);
    const down = Math.sqrt(0.01 ** 2 / 3);
    expect(m.sharpe).toBeCloseTo((mu / sd) * Math.sqrt(8760), 8);
    expect(m.sortino).toBeCloseTo((mu / down) * Math.sqrt(8760), 8);
  });

  it("buy & hold includes one taker fee in and out; exposure = candles in the market / total", () => {
    const candles = flatCandles(10, 100);
    candles[9] = { ...candles[9], close: 110 };
    const m = computeMetrics({ ...base, exposureCandles: 4, trades: [], equityCurve: curve(new Array(10).fill(100)), initialCapital: 100, candles });
    expect(m.buyHoldReturnPct).toBeCloseTo(((1.1 * 0.9975) / 1.0025 - 1) * 100, 12);
    expect(buyHoldFactor(100, 100, 0.0025)).toBeLessThan(1);
    expect(m.exposurePct).toBeCloseTo(40, 12);
  });

  it("never returns NaN or Infinity", () => {
    const m = computeMetrics({ ...base, trades: [trade(0)], equityCurve: [], initialCapital: 0, candles: [] });
    for (const v of Object.values(m)) expect(Number.isFinite(v)).toBe(true);
  });
});
