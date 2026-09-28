import { describe, expect, it } from "vitest";
import { runBacktestWith, simulate, MAX_CHART_CANDLES, fmtPctNl, type BacktestInput } from "../../src/backtest/simulator";
import type { Candle } from "../../src/core/types";
import { FEE, SLIP, T0, STEP, candle, decisionsFrom, flatCandles, input, stubRisk, type StubRiskOptions } from "./helpers";

/** Run the backtest with stub deps: `actions[i]` is the decision on candle i. */
function run(candles: Candle[], actions: string, riskOpts: StubRiskOptions = {}, overrides: Partial<BacktestInput> = {}) {
  const risk = stubRisk(riskOpts);
  const decisions = decisionsFrom(candles, actions);
  const out = runBacktestWith(input(candles, overrides), {
    decide: () => decisions,
    createRisk: () => risk,
  });
  return { ...out, risk, decisions };
}

describe("runBacktest – execution timing", () => {
  it("executes a buy decision at the NEXT candle's open (not the signal candle's close)", () => {
    const candles = [
      candle(0, 100, 100.1, 99.9, 100),
      candle(1, 100, 100.1, 99.9, 100),
      candle(2, 100, 101, 99.5, 100.5), // signal candle, close 100.5
      candle(3, 101, 101.5, 100.5, 101.2), // entry at open 101
      ...flatCandles(4, 101, 4),
    ];
    const { result, risk } = run(candles, "..B.....");
    expect(result.trades).toHaveLength(1);
    const t = result.trades[0];
    expect(t.entryTime).toBe(candles[3].time);
    expect(t.entryPrice).toBeCloseTo(101 * (1 + SLIP), 12);
    expect(t.entryPrice).not.toBeCloseTo(100.5 * (1 + SLIP), 6);
    expect(risk.planCalls).toHaveLength(1);
    expect(risk.planCalls[0].now).toBe(candles[3].time);
    expect(risk.planCalls[0].decision.time).toBe(candles[2].time);
  });

  it("allows at most one position at a time", () => {
    const candles = flatCandles(20);
    const { result, risk } = run(candles, "B".repeat(20));
    expect(result.trades).toHaveLength(1);
    expect(result.trades[0].exitReason).toBe("end-of-backtest");
    expect(risk.planCalls).toHaveLength(1);
  });

  it("shifts stop / take-profit to the actual fill with the plan's distances", () => {
    const candles = [...flatCandles(3), candle(3, 103, 103.2, 102.8, 103), ...flatCandles(3, 103, 4)];
    const { risk } = run(candles, "..B....", { stopDist: 2, tpDist: 4 });
    const pos = risk.updateCalls[0].pos;
    const fill = 103 * (1 + SLIP);
    expect(pos.entryPrice).toBeCloseTo(fill, 12);
    expect(pos.initialStopPrice).toBeCloseTo(fill - 2, 12);
    expect(pos.stopPrice).toBeCloseTo(fill - 2, 12);
    expect(pos.takeProfitPrice).toBeCloseTo(fill + 4, 12);
    // Exit check on the entry candle itself, with candlesHeld already incremented and the previous candle's ATR.
    expect(risk.updateCalls[0].candle.time).toBe(candles[3].time);
    expect(pos.candlesHeld).toBe(1);
    expect(risk.updateCalls[0].atr).toBe(1);
  });
});

describe("runBacktest – fees and slippage", () => {
  it("computes entry/exit fills, fees and PnL exactly (signal exit at next open)", () => {
    const candles = [
      ...flatCandles(3, 100),
      candle(3, 101, 101.3, 100.8, 101), // entry open 101
      candle(4, 101, 101.3, 100.8, 101.5),
      candle(5, 101.5, 102, 101.2, 101.8), // sell signal on this candle
      candle(6, 102, 102.4, 101.7, 102.2), // exit at open 102
      ...flatCandles(2, 102, 7),
    ];
    const { result } = run(candles, "..B..S...", { quote: 50 });
    expect(result.trades).toHaveLength(1);
    const t = result.trades[0];

    const Q = 50;
    const entryFee = Q - Q / (1 + FEE);
    const fill = 101 * (1 + SLIP);
    const amount = (Q - entryFee) / fill;
    const exitFill = 102 * (1 - SLIP);
    const gross = amount * exitFill;
    const exitFee = gross * FEE;
    const proceeds = gross - exitFee;

    expect(t.exitReason).toBe("signal");
    expect(t.exitTime).toBe(candles[6].time);
    expect(t.costQuote).toBeCloseTo(Q, 12);
    expect(t.amount).toBeCloseTo(amount, 12);
    expect(t.entryPrice).toBeCloseTo(fill, 12);
    expect(t.exitPrice).toBeCloseTo(exitFill, 12);
    expect(t.proceedsQuote).toBeCloseTo(proceeds, 12);
    expect(t.feesQuote).toBeCloseTo(entryFee + exitFee, 12);
    expect(t.pnlQuote).toBeCloseTo(proceeds - Q, 12);
    expect(t.pnlPct).toBeCloseTo(((proceeds - Q) / Q) * 100, 10);
    expect(t.rMultiple).toBeCloseTo((proceeds - Q) / (2 * amount), 10);
    expect(t.candlesHeld).toBe(3); // candles 3, 4, 5 (exit at the open of 6)
    expect(result.metrics.finalEquity).toBeCloseTo(100 - Q + proceeds, 10);
    expect(result.metrics.feesPaid).toBeCloseTo(entryFee + exitFee, 12);
  });

  it("a round trip at an unchanged price loses exactly fees + slippage", () => {
    const candles = flatCandles(10, 100);
    const { result } = run(candles, "..B..S....", { quote: 50 });
    const t = result.trades[0];
    const amount = 50 / (1 + FEE) / (100 * (1 + SLIP));
    const proceeds = amount * 100 * (1 - SLIP) * (1 - FEE);
    expect(t.pnlQuote).toBeCloseTo(proceeds - 50, 12);
    expect(t.pnlQuote).toBeLessThan(0);
  });
});

describe("runBacktest – exits", () => {
  it("can hit the stop on the entry candle itself", () => {
    const candles = [...flatCandles(3), candle(3, 100, 100.2, 97, 97.5), ...flatCandles(3, 97.5, 4)];
    const { result } = run(candles, "..B....", { stopDist: 2 });
    const t = result.trades[0];
    const fill = 100 * (1 + SLIP);
    expect(t.exitReason).toBe("stop-loss");
    expect(t.entryTime).toBe(candles[3].time);
    expect(t.exitTime).toBe(candles[3].time);
    expect(t.exitPrice).toBeCloseTo((fill - 2) * (1 - SLIP), 12);
    expect(t.candlesHeld).toBe(1);
    expect(t.rMultiple).toBeLessThan(-1); // fees + slippage make a stop worse than -1R
  });

  it("exits at the open on a gap below the stop", () => {
    const candles = [...flatCandles(4), candle(4, 95, 96, 94, 95.5), ...flatCandles(2, 95.5, 5)];
    const { result } = run(candles, "..B....", { stopDist: 2 });
    const t = result.trades[0];
    expect(t.exitReason).toBe("stop-loss");
    expect(t.exitTime).toBe(candles[4].time);
    expect(t.exitPrice).toBeCloseTo(95 * (1 - SLIP), 12);
  });

  it("takes profit at the take-profit price", () => {
    const candles = [...flatCandles(4), candle(4, 100.2, 105, 100, 104.5), ...flatCandles(2, 104.5, 5)];
    const { result } = run(candles, "..B....", { stopDist: 2, tpDist: 4 });
    const t = result.trades[0];
    const tp = 100 * (1 + SLIP) + 4;
    expect(t.exitReason).toBe("take-profit");
    expect(t.exitPrice).toBeCloseTo(tp * (1 - SLIP), 12);
    expect(t.pnlQuote).toBeGreaterThan(0);
  });

  it("never fills outside the candle range, even if the risk manager says so", () => {
    const candles = [...flatCandles(4), candle(4, 100, 100.5, 99.5, 100), ...flatCandles(2, 100, 5)];
    const risk = stubRisk();
    risk.updatePosition = (pos) => ({ exit: true, exitReason: "stop-loss", exitPrice: 50, stopPrice: pos.stopPrice, highestPrice: pos.highestPrice });
    const decisions = decisionsFrom(candles, "..B....");
    const { result } = runBacktestWith(input(candles), { decide: () => decisions, createRisk: () => risk });
    // Exit on the entry candle (low 99.9): the absurd price 50 is clamped to the candle's low.
    expect(result.trades[0].exitPrice).toBeCloseTo(99.9 * (1 - SLIP), 12);
  });

  it("closes an open position at the last close with reason end-of-backtest", () => {
    const candles = [...flatCandles(5), candle(5, 100, 101, 99.5, 100.8)];
    const { result } = run(candles, "..B...");
    const t = result.trades[0];
    expect(t.exitReason).toBe("end-of-backtest");
    expect(t.exitTime).toBe(candles[5].time);
    expect(t.exitPrice).toBeCloseTo(100.8 * (1 - SLIP), 12);
    // Last equity point = cash after the forced close (not the gross mark-to-market).
    const last = result.equityCurve[result.equityCurve.length - 1];
    expect(last.equity).toBeCloseTo(result.metrics.finalEquity, 12);
    expect(result.metrics.finalEquity).toBeCloseTo(100 - t.costQuote + t.proceedsQuote, 10);
  });
});

describe("runBacktest – account snapshot for the risk manager", () => {
  it("tracks tradesToday, lastLossAt and dayStartEquity across a day boundary", () => {
    // 15m candles from Monday 00:00 UTC; Amsterdam day changes at 23:00 UTC (index 92).
    const n = 110;
    const candles = flatCandles(n, 100);
    candles[4] = candle(4, 100, 100.1, 90, 91); // stop-out on the second candle of the first trade
    for (let i = 5; i < n; i++) candles[i] = candle(i, 91, 91.1, 90.9, 91);
    const actions = Array.from({ length: n }, (_, i) => (i === 2 || i === 10 || i === 95 ? "B" : i === 12 || i === 97 ? "S" : ".")).join("");
    const { result, risk } = run(candles, actions, { stopDist: 2 });
    expect(result.trades).toHaveLength(3);
    const [first, second] = risk.planCalls;
    expect(first.account.tradesToday).toBe(0);
    expect(first.account.lastLossAt).toEqual({});
    expect(second.account.tradesToday).toBe(1);
    expect(second.account.lastLossAt["TEST-EUR"]).toBe(candles[4].time);
    expect(second.account.realizedPnlToday).toBeCloseTo(result.trades[0].pnlQuote, 10);
    const third = risk.planCalls[2];
    expect(third.now).toBe(candles[96].time);
    expect(third.account.tradesToday).toBe(0); // new Amsterdam day
    expect(third.account.realizedPnlToday).toBe(0);
    // dayStartEquity = equity at the close of the last candle of the previous day.
    const prevDayCloseEquity = result.equityCurve[91].equity;
    expect(third.account.dayStartEquity).toBeCloseTo(prevDayCloseEquity, 10);
  });
});

describe("runBacktest – equity curve, benchmark, tradeFromIndex", () => {
  const candles = [
    ...flatCandles(3, 100),
    candle(3, 100, 100.5, 99.5, 100),
    candle(4, 100, 103, 99.8, 102),
    candle(5, 102, 102.2, 99, 99.5),
    candle(6, 99.5, 101, 99.2, 100.5),
    candle(7, 100.5, 101, 100, 100.8),
  ];

  it("has one point per evaluated candle, marks to market at the close and drawdown <= 0", () => {
    const { result } = run(candles, "..B.....", { stopDist: 5, tpDist: 10 });
    expect(result.equityCurve).toHaveLength(candles.length);
    expect(result.candlesCount).toBe(candles.length);
    expect(result.equityCurve.map((p) => p.time)).toEqual(candles.map((c) => c.time));
    const t = result.trades[0];
    const cash = 100 - t.costQuote;
    expect(result.equityCurve[4].equity).toBeCloseTo(cash + t.amount * 102, 10);
    expect(result.equityCurve[5].equity).toBeCloseTo(cash + t.amount * 99.5, 10);
    for (const p of result.equityCurve) expect(p.drawdownPct).toBeLessThanOrEqual(0);
    const minDd = Math.min(...result.equityCurve.map((p) => p.drawdownPct));
    expect(result.metrics.maxDrawdownPct).toBeCloseTo(minDd, 10);
    expect(result.equityCurve[5].drawdownPct).toBeCloseTo(
      ((cash + t.amount * 99.5) / (cash + t.amount * 102) - 1) * 100,
      10,
    );
  });

  it("benchmark = buy & hold from the first evaluated open with one taker fee in and out", () => {
    const { result } = run(candles, "........");
    const units = 100 / (1 + FEE) / candles[0].open;
    result.equityCurve.forEach((p, j) => {
      expect(p.benchmark).toBeCloseTo(units * candles[j].close * (1 - FEE), 10);
    });
    const expected = ((candles[7].close / candles[0].open) * (1 - FEE)) / (1 + FEE) - 1;
    expect(result.metrics.buyHoldReturnPct).toBeCloseTo(expected * 100, 10);
    expect(result.metrics.totalReturnPct).toBe(0);
    expect(result.trades).toHaveLength(0);
  });

  it("respects tradeFromIndex: no trades, curve or benchmark before it", () => {
    const n = 40;
    const cs = flatCandles(n, 100);
    const { result, risk } = run(cs, "B".repeat(n), { exitOnSell: false, timeStop: 3 }, { tradeFromIndex: 10 });
    expect(result.equityCurve).toHaveLength(n - 10);
    expect(result.equityCurve[0].time).toBe(cs[10].time);
    expect(result.from).toBe(cs[10].time);
    expect(result.trades.length).toBeGreaterThan(1);
    expect(result.trades[0].entryTime).toBe(cs[10].time);
    for (const t of result.trades) expect(t.entryTime).toBeGreaterThanOrEqual(cs[10].time);
    for (const c of risk.planCalls) expect(c.now).toBeGreaterThanOrEqual(cs[10].time);
    const units = 100 / (1 + FEE) / cs[10].open;
    expect(result.equityCurve[0].benchmark).toBeCloseTo(units * cs[10].close * (1 - FEE), 10);
  });
});

describe("runBacktest – chart output", () => {
  it("builds KOOP / exit markers from actual trades with Dutch labels", () => {
    const candles = [...flatCandles(3), candle(3, 100, 100.2, 97, 97.5), ...flatCandles(3, 97.5, 4)];
    const { result } = run(candles, "..B....", { stopDist: 2 });
    expect(result.markers).toHaveLength(2);
    const [buy, sell] = result.markers;
    expect(buy).toMatchObject({ action: "buy", label: "KOOP", time: candles[3].time });
    expect(sell.action).toBe("sell");
    expect(sell.time).toBe(candles[3].time);
    expect(sell.label).toMatch(/^SL -\d+,\d%$/);
    expect(sell.label).toBe(`SL ${fmtPctNl(result.trades[0].pnlPct)}`);
  });

  it("formats Dutch percentages", () => {
    expect(fmtPctNl(1.8)).toBe("+1,8%");
    expect(fmtPctNl(-0.94)).toBe("-0,9%");
    expect(fmtPctNl(-0.01)).toBe("+0,0%");
    expect(fmtPctNl(12.345, 2)).toBe("+12,35%");
  });

  it(`downsamples to at most ${MAX_CHART_CANDLES} chart candles (OHLC aggregation)`, () => {
    const n = 3200;
    const cs = Array.from({ length: n }, (_, i) => candle(i, 100 + (i % 7), 101 + (i % 7) + (i % 3), 99 + (i % 7) - (i % 5), 100.5 + (i % 7)));
    const actions = Array.from({ length: n }, (_, i) => (i === 1000 ? "B" : i === 1100 ? "S" : ".")).join("");
    const { result } = run(cs, actions, { stopDist: 50, tpDist: 50 });
    const k = Math.ceil(n / MAX_CHART_CANDLES);
    expect(result.candles.length).toBeLessThanOrEqual(MAX_CHART_CANDLES);
    expect(result.candles).toHaveLength(Math.ceil(n / k));
    const g = result.candles[1];
    const src = cs.slice(k, 2 * k);
    expect(g.time).toBe(src[0].time);
    expect(g.open).toBe(src[0].open);
    expect(g.close).toBe(src[k - 1].close);
    expect(g.high).toBe(Math.max(...src.map((c) => c.high)));
    expect(g.low).toBe(Math.min(...src.map((c) => c.low)));
    expect(g.volume).toBeCloseTo(src.reduce((s, c) => s + c.volume, 0), 10);
    // Markers snap to an existing chart candle time.
    const times = new Set(result.candles.map((c) => c.time));
    for (const m of result.markers) expect(times.has(m.time)).toBe(true);
    expect(result.equityCurve).toHaveLength(n);
  });
});

describe("runBacktest – robustness", () => {
  it("rejects decision arrays of the wrong length", () => {
    const candles = flatCandles(5);
    expect(() => simulate(input(candles), decisionsFrom(candles.slice(1), "...."), stubRisk())).toThrow(/beslissingen/);
  });

  it("returns an empty result for empty input", () => {
    const { result } = run([], "");
    expect(result.trades).toEqual([]);
    expect(result.equityCurve).toEqual([]);
    expect(result.metrics.finalEquity).toBe(100);
  });

  it("does not buy below the minimum order size", () => {
    const candles = flatCandles(10);
    const { result } = run(candles, "..B.......", { quote: 4 });
    expect(result.trades).toHaveLength(0);
  });

  it("has a sane time axis", () => {
    const candles = flatCandles(3);
    expect(candles[1].time - candles[0].time).toBe(STEP);
    expect(candles[0].time).toBe(T0);
  });
});
