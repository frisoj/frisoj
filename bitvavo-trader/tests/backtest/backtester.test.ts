import { describe, expect, it } from "vitest";
import {
  DEFAULT_EXCHANGE_MIN_QUOTE,
  exchangeMinOrderQuote,
  runBacktestWith,
  simulate,
  effectiveSlippagePct,
  spreadFromTicker,
  withSpreadCosts,
  MAX_CHART_CANDLES,
  fmtPctNl,
  type BacktestInput,
} from "../../src/backtest/simulator";
import type { Candle, MarketInfo, RiskConfig } from "../../src/core/types";
import { EXCHANGE_MIN_ORDER_QUOTE } from "../../src/core/defaults";
import { FEE, SLIP, T0, STEP, candle, decisionsFrom, flatCandles, input, riskCfg, stubRisk, type StubRiskOptions } from "./helpers";

function marketInfo(over: Partial<MarketInfo> = {}): MarketInfo {
  return {
    market: "TEST-EUR",
    base: "TEST",
    quote: "EUR",
    status: "trading",
    minOrderQuote: 5,
    minOrderBase: 0,
    pricePrecision: 5,
    quantityDecimals: 8,
    notionalDecimals: 2,
    ...over,
  };
}

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
    // Exit check on the entry candle itself (previous candle's ATR), but the entry candle is not a
    // held candle: like the engine, candlesHeld only counts full candles after the fill.
    expect(risk.updateCalls[0].candle.time).toBe(candles[3].time);
    expect(pos.candlesHeld).toBe(0);
    expect(risk.updateCalls[1].pos.candlesHeld).toBe(1);
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
    expect(t.candlesHeld).toBe(2); // candles 4, 5 (entry candle 3 does not count; exit at the open of 6)
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
    expect(t.candlesHeld).toBe(0);
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
    // Intrabar stop on candle 4: the cooldown runs from the moment of the exit (after the open → its close).
    expect(second.account.lastLossAt["TEST-EUR"]).toBe(candles[4].time + STEP);
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
    expect(result.stuckTrades).toBe(0);
  });

  it("does not buy below the minimum order size", () => {
    const candles = flatCandles(10);
    const { result } = run(candles, "..B.......", { quote: 4 });
    expect(result.trades).toHaveLength(0);
  });

  it("does not buy below the EXCHANGE minimum, even when risk.minOrderQuote is lowered (the broker refuses it)", () => {
    const candles = flatCandles(10);
    const { result } = run(candles, "..B.......", { quote: 4 }, { risk: riskCfg({ minOrderQuote: 1 }) });
    expect(result.trades).toHaveLength(0);
    // With a market whose exchange minimum is €1, the same €4 buy is accepted.
    const info = marketInfo({ minOrderQuote: 1 });
    expect(run(candles, "..B.......", { quote: 4 }, { marketInfo: info }).result.trades).toHaveLength(1);
  });

  it("has a sane time axis", () => {
    const candles = flatCandles(3);
    expect(candles[1].time - candles[0].time).toBe(STEP);
    expect(candles[0].time).toBe(T0);
  });
});

describe("runBacktest – sells below the minimum order (€5) are refused, like the brokers do", () => {
  // €5,00 at 100 → after fee and slippage the position is worth < €5 at the entry price already.
  const amount5 = 5 / (1 + FEE) / (100 * (1 + SLIP));
  const minPrice = 5 / amount5; // ≈ 100,30: from here on the sell is accepted

  it("keeps a stopped-out €5 position open (no stops) until it is worth €5 again, then sells", () => {
    const candles = [
      ...flatCandles(4, 100), // entry at the open of candle 3
      candle(4, 100, 100.1, 84, 85), // hits the 15-point stop (≈85,05): worth ≈ €4,24 → refused
      candle(5, 85, 86, 70, 72), // far below the stop, still worth < €5
      candle(6, 72, 90, 71, 88),
      candle(7, 88, 101, 87, 100.8), // high reaches the minimum → sold at ≈100,30
      ...flatCandles(2, 100.8, 8),
    ];
    const out = run(candles, "..B.......", { quote: 5, stopDist: 15, tpDist: 50 });
    const { result, risk } = out;
    expect(result.trades).toHaveLength(1);
    const t = result.trades[0];
    expect(t.costQuote).toBeCloseTo(5, 12);
    expect(t.amount).toBeCloseTo(amount5, 12);
    // Not booked on the stop candle …
    expect(result.trades.some((x) => x.exitTime === candles[4].time)).toBe(false);
    // … but only once amount × price >= €5.
    expect(t.exitTime).toBe(candles[7].time);
    expect(t.exitReason).toBe("stop-loss");
    expect(t.exitPrice).toBeCloseTo(minPrice * (1 - SLIP), 9);
    expect(t.amount * (t.exitPrice / (1 - SLIP))).toBeGreaterThanOrEqual(5 - 1e-9);
    // While the sell is pending the risk manager is not asked again (the engine does the same).
    expect(risk.updateCalls.map((u) => u.candle.time)).toEqual([candles[3].time, candles[4].time]);
    // The position stays in the equity curve, marked at the close (drawdown becomes visible).
    expect(result.equityCurve[5].equity).toBeCloseTo(100 - 5 + amount5 * 72, 10);
    expect(result.metrics.maxDrawdownPct).toBeLessThan(-1);
    expect(t.candlesHeld).toBe(4); // candles 4, 5, 6, 7 (entry candle 3 does not count)
    expect(out.stuckTrades).toBe(1);
    expect(result.stuckTrades).toBe(1); // also in the (API) result
    expect(out.stuckAtEnd).toBe(0); // sold later after all
    expect(out.stuckCandles).toBe(3);
    expect(out.minOrderQuote).toBe(5);
    expect(t.entryReason).toMatch(/verkoop \(stop-loss\) geweigerd/);
    expect(t.entryReason).toContain("€5,00");
    expect(t.entryReason).toContain("3 candles");
  });

  it("sells a pending position at the open when the open is already worth enough", () => {
    const candles = [
      ...flatCandles(4, 100),
      candle(4, 100, 100.1, 84, 85),
      candle(5, 101, 102, 100.5, 101.5),
      ...flatCandles(2, 101.5, 6),
    ];
    const { result } = run(candles, "..B.....", { quote: 5, stopDist: 15, tpDist: 50 });
    const t = result.trades[0];
    expect(t.exitTime).toBe(candles[5].time);
    expect(t.exitReason).toBe("stop-loss");
    expect(t.exitPrice).toBeCloseTo(101 * (1 - SLIP), 12);
  });

  it("also refuses a signal exit below the minimum and retries it", () => {
    const candles = [...flatCandles(7, 100), candle(7, 100, 100.5, 99.9, 100.4), ...flatCandles(4, 100.4, 8)];
    const actions = "..B..S...B..";
    const { result, risk } = run(candles, actions, { quote: 5, stopDist: 15, tpDist: 50 });
    const t = result.trades[0];
    expect(t.exitReason).toBe("signal");
    expect(t.exitTime).toBe(candles[7].time); // not at the open of 6 (worth ≈ €4,99)
    expect(t.exitPrice).toBeCloseTo(minPrice * (1 - SLIP), 9);
    expect(t.entryReason).toMatch(/verkoop \(verkoopsignaal\) geweigerd/);
    // Intrabar sale with a loss: cooldown runs from the end of candle 7.
    expect(t.pnlQuote).toBeLessThan(0);
    const next = risk.planCalls[1];
    expect(next.now).toBe(candles[10].time);
    expect(next.account.lastLossAt["TEST-EUR"]).toBe(candles[7].time + STEP);
  });

  it("marks a position that never becomes sellable to market at the end, with a note", () => {
    const candles = [...flatCandles(4, 100), candle(4, 100, 100.1, 84, 85), ...flatCandles(5, 80, 5)];
    const out = run(candles, "..B.......", { quote: 5, stopDist: 15, tpDist: 50 });
    const t = out.result.trades[0];
    expect(t.exitReason).toBe("end-of-backtest");
    expect(t.exitTime).toBe(candles[9].time);
    expect(t.exitPrice).toBeCloseTo(80 * (1 - SLIP), 12);
    expect(t.entryReason).toMatch(/nog steeds niet verkoopbaar/);
    expect(out.stuckTrades).toBe(1);
    expect(out.result.stuckTrades).toBe(1);
    expect(out.stuckAtEnd).toBe(1); // still unsellable at the end
    expect(out.stuckCandles).toBe(5);
    expect(out.exposureCandles).toBe(7); // entry candle + 6 candles after it
  });

  it("uses the market's minimum from MarketInfo and books normal-size stops as before", () => {
    const candles = [...flatCandles(4, 100), candle(4, 100, 100.1, 84, 85), ...flatCandles(3, 85, 5)];
    const info = { market: "TEST-EUR", base: "TEST", quote: "EUR", status: "trading", minOrderQuote: 1, minOrderBase: 0, pricePrecision: 5, quantityDecimals: 8, notionalDecimals: 2 };
    const { result } = run(candles, "..B.....", { quote: 5, stopDist: 15, tpDist: 50 }, { marketInfo: info });
    expect(result.trades[0].exitTime).toBe(candles[4].time); // €4,24 >= €1 minimum: sold at the stop
    expect(result.trades[0].exitReason).toBe("stop-loss");
    const big = run(candles, "..B.....", { quote: 50, stopDist: 15, tpDist: 50 });
    expect(big.result.trades[0].exitTime).toBe(candles[4].time);
    expect(big.result.trades[0].exitPrice).toBeCloseTo((100 * (1 + SLIP) - 15) * (1 - SLIP), 12);
    expect(big.result.stuckTrades).toBe(0);
    expect(big.stuckAtEnd).toBe(0);
  });

  it("the sell minimum is the EXCHANGE minimum, never risk.minOrderQuote (like PaperBroker / LiveBroker)", () => {
    const candles = [...flatCandles(4, 100), candle(4, 100, 100.1, 84, 85), ...flatCandles(3, 85, 5)];
    const stubOpts = { quote: 8, stopDist: 15, tpDist: 50 };
    // €8 position is worth ≈ €6,79 at the stop: Bitvavo (€5) accepts that sell. A user-raised
    // risk.minOrderQuote of €10 must NOT make the backtest refuse it (no MarketInfo …).
    const raised = run(candles, "..B.....", stubOpts, { risk: riskCfg({ minOrderQuote: 10 }) });
    expect(raised.result.trades[0].exitTime).toBe(candles[4].time);
    expect(raised.result.trades[0].exitReason).toBe("stop-loss");
    expect(raised.result.stuckTrades).toBe(0);
    expect(raised.minOrderQuote).toBe(5);
    // … nor with MarketInfo (€5).
    const withInfo = run(candles, "..B.....", stubOpts, { risk: riskCfg({ minOrderQuote: 10 }), marketInfo: marketInfo() });
    expect(withInfo.result.trades[0].exitTime).toBe(candles[4].time);
    expect(withInfo.result.stuckTrades).toBe(0);

    // A user-LOWERED risk.minOrderQuote (€1) does not lower the exchange minimum: the €5 position
    // worth ≈ €4,24 at the stop is still refused, and the note names the €5 exchange minimum.
    const lowered = run(candles, "..B.....", { quote: 5, stopDist: 15, tpDist: 50 }, { risk: riskCfg({ minOrderQuote: 1 }) });
    const t = lowered.result.trades[0];
    expect(t.exitReason).toBe("end-of-backtest");
    expect(lowered.result.stuckTrades).toBe(1);
    expect(lowered.stuckAtEnd).toBe(1);
    expect(t.entryReason).toContain("minimum van €5,00");
    expect(lowered.minOrderQuote).toBe(5);
  });

  it("exchangeMinOrderQuote: MarketInfo's value when finite and > 0, otherwise Bitvavo's €5", () => {
    expect(DEFAULT_EXCHANGE_MIN_QUOTE).toBe(5);
    expect(DEFAULT_EXCHANGE_MIN_QUOTE).toBe(EXCHANGE_MIN_ORDER_QUOTE); // one constant, not a copy
    expect(exchangeMinOrderQuote(undefined)).toBe(5);
    expect(exchangeMinOrderQuote(null)).toBe(5);
    expect(exchangeMinOrderQuote(marketInfo({ minOrderQuote: 2 }))).toBe(2);
    expect(exchangeMinOrderQuote(marketInfo({ minOrderQuote: 25 }))).toBe(25);
    // 0 / missing / not finite / negative = UNKNOWN → €5, never "no minimum".
    expect(exchangeMinOrderQuote(marketInfo({ minOrderQuote: 0 }))).toBe(5);
    expect(exchangeMinOrderQuote(marketInfo({ minOrderQuote: Number.NaN }))).toBe(5);
    expect(exchangeMinOrderQuote(marketInfo({ minOrderQuote: Number.POSITIVE_INFINITY }))).toBe(5);
    expect(exchangeMinOrderQuote(marketInfo({ minOrderQuote: -1 }))).toBe(5);
    expect(exchangeMinOrderQuote({ minOrderQuote: undefined as unknown as number })).toBe(5);
  });

  it("a MarketInfo minimum of 0 (unknown) does not switch the minimum off: €5 for buys and sells", () => {
    const zero = marketInfo({ minOrderQuote: 0 });
    // Buy of €4: refused like Bitvavo does.
    const buy = run(flatCandles(10), "..B.......", { quote: 4 }, { marketInfo: zero });
    expect(buy.result.trades).toHaveLength(0);
    expect(buy.minOrderQuote).toBe(5);
    // €5 position worth ≈ €4,24 at the stop: the sell is refused (pending), not booked at the stop.
    const candles = [...flatCandles(4, 100), candle(4, 100, 100.1, 84, 85), ...flatCandles(3, 85, 5)];
    const sell = run(candles, "..B.....", { quote: 5, stopDist: 15, tpDist: 50 }, { marketInfo: zero });
    const t = sell.result.trades[0];
    expect(t.exitReason).toBe("end-of-backtest");
    expect(sell.result.stuckTrades).toBe(1);
    expect(sell.stuckAtEnd).toBe(1);
    expect(t.entryReason).toContain("minimum van €5,00");
    // Same for a negative / NaN minimum.
    for (const bad of [-1, Number.NaN]) {
      const out = run(candles, "..B.....", { quote: 5, stopDist: 15, tpDist: 50 }, { marketInfo: marketInfo({ minOrderQuote: bad }) });
      expect(out.result.stuckTrades).toBe(1);
      expect(out.minOrderQuote).toBe(5);
    }
  });
});

describe("runBacktest – held candles, time-stop and cooldown match the engine", () => {
  it("time-stop fires after N full candles after the entry candle", () => {
    const candles = flatCandles(12, 100);
    const { result } = run(candles, "..B.........", { timeStop: 3, exitOnSell: false });
    const t = result.trades[0];
    expect(t.entryTime).toBe(candles[3].time);
    expect(t.exitReason).toBe("time-stop");
    expect(t.exitTime).toBe(candles[6].time); // candles 4, 5, 6 held
    expect(t.candlesHeld).toBe(3);
    expect(result.metrics.avgCandlesHeld).toBe(3);
  });

  it("loss cooldown starts at the exit moment: close for intrabar exits, open for signal / gap exits", () => {
    // Time-stop (at the close of candle 6) → next plan sees candles[6].time + STEP.
    const flat = flatCandles(12, 100);
    const ts = run(flat, "..B...B.....", { timeStop: 3, exitOnSell: false });
    expect(ts.result.trades[0].pnlQuote).toBeLessThan(0);
    expect(ts.risk.planCalls[1].now).toBe(flat[7].time);
    expect(ts.risk.planCalls[1].account.lastLossAt["TEST-EUR"]).toBe(flat[6].time + STEP);

    // Signal exit at the open of candle 6 → candles[6].time.
    const sig = run(flat, "..B..S.B....", { quote: 50 });
    expect(sig.result.trades[0].exitTime).toBe(flat[6].time);
    expect(sig.risk.planCalls[1].account.lastLossAt["TEST-EUR"]).toBe(flat[6].time);

    // Gap below the stop: filled at the open → candles[4].time.
    const gap = [...flatCandles(4), candle(4, 95, 96, 94, 95.5), ...flatCandles(4, 95.5, 5)];
    const g = run(gap, "..B...B..", { stopDist: 2 });
    expect(g.result.trades[0].exitPrice).toBeCloseTo(95 * (1 - SLIP), 12);
    expect(g.risk.planCalls[1].account.lastLossAt["TEST-EUR"]).toBe(gap[4].time);
  });
});

describe("runBacktest – spread-aware slippage", () => {
  it("uses max(slippagePct, spread / 2) per side", () => {
    const r = riskCfg();
    expect(effectiveSlippagePct(r, 0.004)).toBeCloseTo(0.002, 15);
    expect(effectiveSlippagePct(r, 0.0004)).toBe(SLIP); // half-spread below the configured slippage
    expect(effectiveSlippagePct(r)).toBe(SLIP);
    expect(effectiveSlippagePct(r, Number.NaN)).toBe(SLIP);
    expect(effectiveSlippagePct(r, -1)).toBe(SLIP);
    const inp = input(flatCandles(3));
    expect(withSpreadCosts(inp)).toBe(inp);
    expect(withSpreadCosts({ ...inp, spreadPct: 0.004 }).risk.slippagePct).toBeCloseTo(0.002, 15);
    expect(inp.risk.slippagePct).toBe(SLIP); // not mutated
  });

  it("fills entries and exits with the half-spread and hands the same cost to the risk manager", () => {
    const candles = [...flatCandles(6, 100), candle(6, 102, 102.4, 101.7, 102.2), ...flatCandles(2, 102, 7)];
    const decisions = decisionsFrom(candles, "..B..S...");
    const seen: RiskConfig[] = [];
    // 0,4% spread is above the default spread limit (0,3%): switch the limit off, this test is about costs.
    const out = runBacktestWith(input(candles, { spreadPct: 0.004, risk: riskCfg({ maxSpreadPct: 0 }) }), {
      decide: () => decisions,
      createRisk: (cfg) => {
        seen.push(cfg);
        return stubRisk({ quote: 50 });
      },
    });
    expect(out.slippagePct).toBeCloseTo(0.002, 15);
    expect(seen[0].slippagePct).toBeCloseTo(0.002, 15);
    const t = out.result.trades[0];
    expect(t.entryPrice).toBeCloseTo(100 * 1.002, 12);
    expect(t.exitPrice).toBeCloseTo(102 * 0.998, 12);
  });

  it("derives the spread from a ticker (best effort)", () => {
    expect(spreadFromTicker({ bid: 99.9, ask: 100.1 })).toBeCloseTo(0.002, 12);
    expect(spreadFromTicker({ bid: null, ask: 100 })).toBeUndefined();
    expect(spreadFromTicker({ bid: 101, ask: 100 })).toBeUndefined();
    expect(spreadFromTicker({ bid: 0, ask: 100 })).toBeUndefined();
    expect(spreadFromTicker(undefined)).toBeUndefined();
  });
});
