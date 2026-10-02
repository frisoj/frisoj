/**
 * v2 entry gates in the backtest (docs/ARCHITECTURE.md "v2 — Backtest"):
 * trend filter (`ensemble.trendFilter` + `input.trendCandles`) and spread limit
 * (`risk.maxSpreadPct`), counted in `result.blockedEntries`, explained in `note`.
 * Also: the optimizer and the walk-forward see the same gates.
 */
import { describe, expect, it } from "vitest";
import {
  TREND_NOT_APPLIED_NOTE,
  appendNote,
  entryGates,
  runBacktestWith,
  spreadBlockedNote,
  type BacktestInput,
} from "../../src/backtest/simulator";
import { applyParams, optimizeWith } from "../../src/backtest/optimizerCore";
import { walkForwardWith } from "../../src/backtest/walkForwardCore";
import { DEFAULT_ENSEMBLE_CONFIG } from "../../src/core/defaults";
import { INTERVAL_MS, type Candle, type RiskConfig, type TrendFilterConfig } from "../../src/core/types";
import {
  STEP,
  T0,
  decisionsFrom,
  flatCandles,
  input,
  riskCfg,
  stubOptimizerDeps,
  stubRisk,
  walkCandles,
  type StubRiskOptions,
} from "./helpers";

const DAY = INTERVAL_MS["1d"];
/** Market filter on daily candles with a 3-day average (small, so the SMA is easy to flip). */
const TF3: TrendFilterConfig = { market: true, coin: false, interval: "1d", period: 3 };
const COIN3: TrendFilterConfig = { market: false, coin: true, interval: "1d", period: 3 };
const BOTH3: TrendFilterConfig = { market: true, coin: true, interval: "1d", period: 3 };
const OFF: TrendFilterConfig = { market: false, coin: false, interval: "1d", period: 3 };

/** Daily candles with the given closes; the first one opens at `firstTime`. */
function daily(closes: number[], firstTime: number): Candle[] {
  return closes.map((c, k) => ({ time: firstTime + k * DAY, open: c, high: c, low: c, close: c, volume: 1 }));
}

/** `count` daily candles from `firstTime` with strictly falling (below SMA) or rising (above SMA) closes. */
function trendDays(count: number, dir: "down" | "up", firstTime = T0 - 10 * DAY): Candle[] {
  return daily(
    Array.from({ length: count }, (_, k) => (dir === "down" ? 10_000 - k * 10 : 1_000 + k * 10)),
    firstTime,
  );
}

const ensembleWith = (trendFilter?: TrendFilterConfig) => {
  const { trendFilter: _drop, ...rest } = DEFAULT_ENSEMBLE_CONFIG;
  return trendFilter ? { ...rest, trendFilter } : rest;
};

function riskWithout(): RiskConfig {
  const { maxSpreadPct: _drop, ...rest } = riskCfg();
  return rest;
}

/** Actions string of `n` holds with the given overrides. */
function actions(n: number, at: Record<number, "B" | "S">): string {
  return Array.from({ length: n }, (_, i) => at[i] ?? ".").join("");
}

function run(candles: Candle[], acts: string, overrides: Partial<BacktestInput> = {}, riskOpts: StubRiskOptions = {}) {
  const risk = stubRisk(riskOpts);
  const decisions = decisionsFrom(candles, acts);
  const out = runBacktestWith(input(candles, overrides), { decide: () => decisions, createRisk: () => risk });
  return { ...out, risk };
}

// 15m candles: index 96 opens exactly one day after T0 (96 × 15 min = 24 h).
const N = 200;
const candles = flatCandles(N);
const BOUNDARY = 96;

describe("trend gate — blocks exactly when Bitcoin is below its SMA at the moment of execution", () => {
  // Day -1 (closes at T0): 90 < SMA3(100, 100, 90) → below. Day 0 (closes at T0 + 1 day): 120 > SMA3(100, 90, 120) → above.
  const market = daily([100, 100, 100, 100, 90, 120], T0 - 5 * DAY);
  const acts = actions(N, { 50: "B", 94: "B", 95: "B", 97: "B", 100: "S", 150: "B", 160: "S" });

  it("skips buys executed before the flip, takes the first one executed at the flip, counts only tried buys", () => {
    expect(BOUNDARY * STEP).toBe(DAY);
    expect(candles[BOUNDARY].time).toBe(T0 + DAY);
    const { result, risk } = run(candles, acts, { ensemble: ensembleWith(TF3), trendCandles: { market } });
    // Decision 94 executes at the open of 95 (T0 + 95 × 15m < T0 + 1 day): day 0 is still open → below → blocked.
    // Decision 95 executes at the open of 96 = T0 + 1 day: day 0 has just closed → above → bought.
    expect(result.trades.map((t) => t.entryTime)).toEqual([candles[96].time, candles[151].time]);
    // 50 and 94 were blocked; 97 was not tried (position open), so it does not count.
    expect(result.blockedEntries).toEqual({ trend: 2, spread: 0 });
    // Gates come before the risk plan: only the two allowed buys reached planEntry.
    expect(risk.planCalls.map((c) => c.now)).toEqual([candles[96].time, candles[151].time]);
    expect(result.note).toBeUndefined();
  });

  it("no lookahead: a trend candle that closes after the execution moment never matters", () => {
    // Day -1 closes above its average (120 > SMA3(100, 100, 120)); day 0 (still open until T0 + 1 day) varies wildly.
    const outcomes = [50, 120, 1_000].map((day0) => {
      const m = daily([100, 100, 100, 100, 120, day0], T0 - 5 * DAY);
      const r = run(candles, actions(N, { 94: "B", 120: "S" }), { ensemble: ensembleWith(TF3), trendCandles: { market: m } });
      return { entries: r.result.trades.map((t) => t.entryTime), blocked: r.result.blockedEntries };
    });
    for (const o of outcomes) expect(o).toEqual({ entries: [candles[95].time], blocked: { trend: 0, spread: 0 } });

    // Once day 0 HAS closed (decision 95 → executed at T0 + 1 day) it does count: 50 < SMA3(100, 120, 50).
    const m50 = daily([100, 100, 100, 100, 120, 50], T0 - 5 * DAY);
    const late = run(candles, actions(N, { 95: "B", 120: "S" }), { ensemble: ensembleWith(TF3), trendCandles: { market: m50 } });
    expect(late.result.trades).toHaveLength(0);
    expect(late.result.blockedEntries).toEqual({ trend: 1, spread: 0 });
  });

  it("uses decision.time + interval, also when a trend candle is 'in progress' at that moment", () => {
    // Only the day-0 candle exists besides day -2/-1: at T0 + 50 × 15m it has started but not closed.
    const m = daily([100, 100, 100, 90, 1_000], T0 - 4 * DAY);
    const r = run(candles, actions(N, { 50: "B", 60: "S" }), { ensemble: ensembleWith(TF3), trendCandles: { market: m } });
    expect(r.result.trades).toHaveLength(0);
    expect(r.result.blockedEntries?.trend).toBe(1);
  });
});

describe("trend gate — coin filter and fail-closed", () => {
  const acts = actions(N, { 20: "B", 30: "S", 60: "B", 70: "S", 150: "B", 160: "S" });
  const up = trendDays(20, "up");
  const down = trendDays(20, "down");

  it("coin filter: the coin's own candles decide; the market part is ignored when it is off", () => {
    const blockedCoin = run(candles, acts, { ensemble: ensembleWith(COIN3), trendCandles: { market: up, coin: down } });
    expect(blockedCoin.result.trades).toHaveLength(0);
    expect(blockedCoin.result.blockedEntries).toEqual({ trend: 3, spread: 0 });

    const okCoin = run(candles, acts, { ensemble: ensembleWith(COIN3), trendCandles: { market: down, coin: up } });
    expect(okCoin.result.trades).toHaveLength(3);
    expect(okCoin.result.blockedEntries).toEqual({ trend: 0, spread: 0 });
  });

  it("market + coin: both must be above their average", () => {
    expect(run(candles, acts, { ensemble: ensembleWith(BOTH3), trendCandles: { market: up, coin: down } }).result.trades).toHaveLength(0);
    expect(run(candles, acts, { ensemble: ensembleWith(BOTH3), trendCandles: { market: down, coin: up } }).result.trades).toHaveLength(0);
    expect(run(candles, acts, { ensemble: ensembleWith(BOTH3), trendCandles: { market: up, coin: up } }).result.trades).toHaveLength(3);
  });

  it("fail-closed: a missing part, an empty object or too little data blocks every entry", () => {
    for (const trendCandles of [{ market: up }, {}, { market: up, coin: [] }]) {
      const r = run(candles, acts, { ensemble: ensembleWith(BOTH3), trendCandles });
      expect(r.result.trades).toHaveLength(0);
      expect(r.result.blockedEntries).toEqual({ trend: 3, spread: 0 });
      expect(r.result.note).toBeUndefined(); // the filter WAS applied (the loader's note explains a failed load)
    }
    // Two closed candles for a 3-candle average: unknown → no entries.
    const short = run(candles, acts, { ensemble: ensembleWith(TF3), trendCandles: { market: daily([100, 110], T0 - 2 * DAY) } });
    expect(short.result.trades).toHaveLength(0);
  });

  it("stale trend data (the newest closed trend candle is missing) counts as unknown → blocked, like the engine", () => {
    // Rising coin closes; at T0 + ~5 h the newest closed day is the one that opened at T0 − 1 day.
    // Without it (a day without trades on Bitvavo, or data that stops early) the backtest may not buy.
    const acts1 = actions(N, { 20: "B", 30: "S" });
    const endingAt = (lastOpen: number) => daily([100, 110, 120, 130, 140, 150], lastOpen - 5 * DAY);
    for (const lastOpen of [T0 - 3 * DAY, T0 - 2 * DAY]) {
      const stale = run(candles, acts1, { ensemble: ensembleWith(COIN3), trendCandles: { coin: endingAt(lastOpen) } });
      expect(stale.result.trades).toHaveLength(0);
      expect(stale.result.blockedEntries).toEqual({ trend: 1, spread: 0 });
    }
    const fresh = run(candles, acts1, { ensemble: ensembleWith(COIN3), trendCandles: { coin: endingAt(T0 - DAY) } });
    expect(fresh.result.trades).toHaveLength(1);
    // A gap in the middle: blocked while the missing day would have been the newest closed one.
    const withGap = daily([100, 110, 120, 130, 140, 150, 160], T0 - 5 * DAY).filter((c) => c.time !== T0 - DAY);
    const gapRun = run(candles, actions(N, { 20: "B", 30: "S", 150: "B", 160: "S" }), {
      ensemble: ensembleWith(COIN3),
      trendCandles: { coin: withGap },
    });
    expect(gapRun.result.trades.map((t) => t.entryTime)).toEqual([candles[151].time]);
    expect(gapRun.result.blockedEntries).toEqual({ trend: 1, spread: 0 });
    // Data that stops in the middle of the test: buys after it are blocked (market filter too).
    const stops = daily([100, 110, 120, 130, 140, 150], T0 - 5 * DAY); // newest opens at T0, closes at T0 + 1 day
    const late = run(candles, actions(N, { 20: "B", 30: "S", 150: "B", 160: "S" }), {
      ensemble: ensembleWith(TF3),
      trendCandles: { market: stops },
    });
    expect(late.result.trades.map((t) => t.entryTime)).toEqual([candles[21].time, candles[151].time]);
    const longer = flatCandles(4 * 96); // 4 days: at T0 + 3 days + x the newest trend candle (T0) is 2 days behind
    const beyond = run(longer, actions(longer.length, { 20: "B", 30: "S", 300: "B", 310: "S" }), {
      ensemble: ensembleWith(TF3),
      trendCandles: { market: stops },
    });
    expect(beyond.result.trades.map((t) => t.entryTime)).toEqual([longer[21].time]);
    expect(beyond.result.blockedEntries).toEqual({ trend: 1, spread: 0 });
  });

  it("partial data: blocks while fewer than `period` candles have closed, decides normally afterwards", () => {
    // Candles from T0 - 2 days: before T0 + 1 day only 2 have closed; from then on 3 (rising) → allowed.
    const partial = run(candles, acts, { ensemble: ensembleWith(TF3), trendCandles: { market: daily([100, 110, 120], T0 - 2 * DAY) } });
    expect(partial.result.trades.map((t) => t.entryTime)).toEqual([candles[151].time]);
    expect(partial.result.blockedEntries).toEqual({ trend: 2, spread: 0 });
  });
});

describe("trend gate — not applied without data, and no change when the filters are off", () => {
  const acts = actions(N, { 20: "B", 30: "S", 60: "B", 70: "S", 150: "B", 160: "S" });
  const down = trendDays(20, "down");

  it("filter on but no trendCandles: trades as without filter, with a Dutch note", () => {
    const base = run(candles, acts, { ensemble: ensembleWith(undefined), risk: riskWithout() });
    const noData = run(candles, acts, { ensemble: ensembleWith(TF3) });
    expect(noData.result.note).toBe(TREND_NOT_APPLIED_NOTE);
    expect(noData.result.note).toBe("Trendfilter niet toegepast: geen koersdata voor het filter.");
    expect(noData.result.trades).toEqual(base.result.trades);
    expect(noData.result.metrics).toEqual(base.result.metrics);
    // The default risk config has a spread limit (0,3%) → blockedEntries is reported, with nothing blocked.
    expect(noData.result.blockedEntries).toEqual({ trend: 0, spread: 0 });
    const noLimit = run(candles, acts, { ensemble: ensembleWith(TF3), risk: riskCfg({ maxSpreadPct: 0 }) });
    expect(noLimit.result.blockedEntries).toBeUndefined();
    expect(noLimit.result.note).toBe(TREND_NOT_APPLIED_NOTE);
  });

  it("filter off, limit 0 or missing: identical results, no blockedEntries, no note", () => {
    const spreadPct = 0.01; // 1% spread (above the default limit) — only the slippage uses it here
    const base = run(candles, acts, { ensemble: ensembleWith(undefined), risk: riskWithout(), spreadPct });
    expect(base.result.trades).toHaveLength(3);
    const variants: Partial<BacktestInput>[] = [
      { ensemble: ensembleWith(OFF), risk: riskCfg({ maxSpreadPct: 0 }), spreadPct, trendCandles: { market: down, coin: down } },
      { ensemble: ensembleWith(undefined), risk: riskWithout(), spreadPct, trendCandles: { market: down } },
      { ensemble: ensembleWith(OFF), risk: riskWithout(), spreadPct },
    ];
    for (const v of variants) {
      const r = run(candles, acts, v);
      expect(r.result.trades).toEqual(base.result.trades);
      expect(r.result.metrics).toEqual(base.result.metrics);
      expect(r.result.equityCurve).toEqual(base.result.equityCurve);
      expect(r.result.blockedEntries).toBeUndefined();
      expect(r.result.note).toBeUndefined();
    }
  });
});

describe("spread gate", () => {
  const acts = actions(N, { 20: "B", 30: "S", 60: "B", 70: "S", 150: "B", 160: "S" });
  const off = ensembleWith(OFF);

  it("a known spread above risk.maxSpreadPct blocks every entry, with a Dutch note", () => {
    const r = run(candles, acts, { ensemble: off, spreadPct: 0.0062, risk: riskCfg({ maxSpreadPct: 0.3 }) });
    expect(r.result.trades).toHaveLength(0);
    expect(r.result.blockedEntries).toEqual({ trend: 0, spread: 3 });
    expect(r.risk.planCalls).toHaveLength(0);
    expect(r.result.note).toBe("Geen aankopen: de spread van deze markt (0,62%) is groter dan je maximum (0,30%).");
  });

  it("does not block at or below the limit (no float artefacts), with an unknown spread or with limit 0", () => {
    for (const v of [
      { spreadPct: 0.003, maxSpreadPct: 0.3 }, // 0.003 × 100 = 0.30000000000000004
      { spreadPct: 0.001, maxSpreadPct: 0.3 },
      { spreadPct: undefined, maxSpreadPct: 0.3 },
      { spreadPct: Number.NaN, maxSpreadPct: 0.3 },
      { spreadPct: 0.05, maxSpreadPct: 0 },
    ]) {
      const r = run(candles, acts, { ensemble: off, spreadPct: v.spreadPct, risk: riskCfg({ maxSpreadPct: v.maxSpreadPct }) });
      expect(r.result.trades, JSON.stringify(v)).toHaveLength(3);
      expect(r.result.note).toBeUndefined();
      if (v.maxSpreadPct > 0) expect(r.result.blockedEntries).toEqual({ trend: 0, spread: 0 });
      else expect(r.result.blockedEntries).toBeUndefined();
    }
  });

  it("trend first, then spread: each blocked buy is counted once", () => {
    const market = daily([100, 100, 100, 100, 90, 120], T0 - 5 * DAY); // below until T0 + 1 day, above after
    const r = run(candles, acts, { ensemble: ensembleWith(TF3), trendCandles: { market }, spreadPct: 0.01 });
    expect(r.result.trades).toHaveLength(0);
    expect(r.result.blockedEntries).toEqual({ trend: 2, spread: 1 });
  });

  it("joins the notes when the trend filter has no data and the spread blocks", () => {
    const r = run(candles, acts, { ensemble: ensembleWith(TF3), spreadPct: 0.0031 });
    expect(r.result.note).toBe(
      "Trendfilter niet toegepast: geen koersdata voor het filter. " +
        "Geen aankopen: de spread van deze markt (0,31%) is groter dan je maximum (0,30%).",
    );
    expect(r.result.blockedEntries).toEqual({ trend: 0, spread: 3 });
  });

  it("an empty evaluation window still reports the gates", () => {
    const r = run(candles, acts, { ensemble: ensembleWith(TF3), spreadPct: 0.01, tradeFromIndex: N });
    expect(r.result.trades).toHaveLength(0);
    expect(r.result.blockedEntries).toEqual({ trend: 0, spread: 0 });
    expect(r.result.note).toContain(TREND_NOT_APPLIED_NOTE);
  });
});

describe("entry-gate helpers", () => {
  it("entryGates: what applies to an input", () => {
    const risk = riskCfg();
    expect(entryGates({ ensemble: ensembleWith(TF3), risk, trendCandles: {} })).toEqual({ trend: TF3, spreadBlocks: false, report: true });
    expect(entryGates({ ensemble: ensembleWith(TF3), risk: riskWithout() })).toEqual({
      trend: null,
      spreadBlocks: false,
      report: false,
      note: TREND_NOT_APPLIED_NOTE,
    });
    expect(entryGates({ ensemble: ensembleWith(OFF), risk, spreadPct: 0.004 }).spreadBlocks).toBe(true);
    expect(entryGates({ ensemble: ensembleWith(OFF), risk: riskCfg({ maxSpreadPct: -1 }), spreadPct: 0.004 }).report).toBe(false);
  });

  it("spreadBlockedNote shows more decimals when the rounded values would look equal", () => {
    expect(spreadBlockedNote(0.62, 0.3)).toBe("Geen aankopen: de spread van deze markt (0,62%) is groter dan je maximum (0,30%).");
    expect(spreadBlockedNote(0.3004, 0.3)).toBe("Geen aankopen: de spread van deze markt (0,3004%) is groter dan je maximum (0,3000%).");
  });

  it("spreadBlockedNote never shows two equal numbers, and never a small limit as 0,00%", () => {
    // bid 3,3283 / ask 3,3383 → 0,300003%: still equal at 4 decimals → "net groter", no contradictory numbers.
    expect(spreadBlockedNote(0.300003, 0.3)).toBe("Geen aankopen: de spread van deze markt is net groter dan je maximum (0,30%).");
    const r = run(candles, actions(N, { 20: "B", 30: "S" }), { ensemble: ensembleWith(OFF), spreadPct: (3.3383 - 3.3283) / ((3.3383 + 3.3283) / 2), risk: riskCfg({ maxSpreadPct: 0.3 }) });
    expect(r.result.trades).toHaveLength(0);
    expect(r.result.note).toBe("Geen aankopen: de spread van deze markt is net groter dan je maximum (0,30%).");
    // A limit of 0,001% (allowed: 0..5) is shown as such, not as "0,00%" (which would read as "off").
    expect(spreadBlockedNote(0.03, 0.001)).toBe("Geen aankopen: de spread van deze markt (0,030%) is groter dan je maximum (0,001%).");
    expect(spreadBlockedNote(0.0012, 0.001)).toBe("Geen aankopen: de spread van deze markt (0,0012%) is groter dan je maximum (0,0010%).");
    expect(spreadBlockedNote(0.5, 0.25)).toBe("Geen aankopen: de spread van deze markt (0,50%) is groter dan je maximum (0,25%).");
  });

  it("appendNote joins non-empty, distinct notes", () => {
    expect(appendNote(undefined, "A.", "", "B.", "A.")).toBe("A. B.");
    expect(appendNote(undefined, null)).toBeUndefined();
  });
});

// ─────────────────────────────── Optimizer + walk-forward ───────────────────────────────

const WALK = walkCandles(3000, 11); // 15m candles from T0, ~31 days
/** The trend flips from below to above its average when the day-15 candle closes (T0 + 16 days). */
const FLIP = T0 + 16 * DAY;
function flipDays(): Candle[] {
  const closes: number[] = [];
  for (let k = -10; k <= 35; k++) closes.push(k < 15 ? 1_000 - (k + 10) * 10 : 1_000 + (k - 14) * 100);
  return daily(closes, T0 - 10 * DAY);
}

describe("optimizer sees the entry gates", () => {
  const base = (over: Partial<BacktestInput> = {}) => input(WALK, { tradeFromIndex: 250, ensemble: ensembleWith(TF3), ...over });

  it("a market below its average everywhere: no combination trades, every row reports the blocked buys", () => {
    const res = optimizeWith(base({ trendCandles: { market: trendDays(50, "down") } }), { objective: "sharpe", maxCombos: 12 }, stubOptimizerDeps());
    expect(res.rows.length).toBe(12);
    for (const r of res.rows) {
      expect(r.metrics.trades).toBe(0);
      expect(r.blockedEntries!.trend).toBeGreaterThan(0);
      expect(r.blockedEntries!.spread).toBe(0);
    }
    expect(res.best).toBeNull();
    expect(res.blockedEntries).toEqual(res.rows[0].blockedEntries);
    expect(res.note).toBeUndefined();
  });

  it("every combination is gated like a plain backtest (entries only after the flip)", () => {
    const deps = stubOptimizerDeps();
    const gated = base({ trendCandles: { market: flipDays() } });
    const res = optimizeWith(gated, { objective: "return", maxCombos: 12 }, deps);
    const free = optimizeWith(base({ ensemble: ensembleWith(OFF) }), { objective: "return", maxCombos: 12 }, stubOptimizerDeps());
    const tradesGated = res.rows.reduce((s, r) => s + r.metrics.trades, 0);
    const tradesFree = free.rows.reduce((s, r) => s + r.metrics.trades, 0);
    expect(tradesGated).toBeGreaterThan(0);
    expect(tradesGated).toBeLessThan(tradesFree);
    for (const row of res.rows) {
      const single = runBacktestWith(applyParams(gated, row.params), deps, { lite: true }).result;
      expect(single.metrics).toEqual(row.metrics);
      expect(single.blockedEntries).toEqual(row.blockedEntries);
      for (const t of single.trades) expect(t.entryTime).toBeGreaterThanOrEqual(FLIP);
    }
    if (res.best) expect(res.blockedEntries).toEqual(res.best.blockedEntries);
  });

  it("carries the spread note and the 'no data' note", () => {
    const spread = optimizeWith(base({ ensemble: ensembleWith(OFF), spreadPct: 0.01 }), { objective: "sharpe", maxCombos: 4 }, stubOptimizerDeps());
    expect(spread.note).toBe("Geen aankopen: de spread van deze markt (1,00%) is groter dan je maximum (0,30%).");
    for (const r of spread.rows) expect(r.metrics.trades).toBe(0);
    expect(spread.blockedEntries!.spread).toBeGreaterThan(0);
    const noData = optimizeWith(base(), { objective: "sharpe", maxCombos: 4 }, stubOptimizerDeps());
    expect(noData.note).toBe(TREND_NOT_APPLIED_NOTE);
  });
});

describe("walk-forward sees the entry gates", () => {
  const opts = { folds: 4, trainRatio: 0.7, objective: "sharpe" as const, maxCombos: 8 };
  const base = (over: Partial<BacktestInput> = {}) => input(WALK, { tradeFromIndex: 250, ensemble: ensembleWith(TF3), ...over });

  it("passes the trend candles unchanged to every fold; blockedEntries = sum over the test runs", () => {
    const market = flipDays();
    const copy = structuredClone(market);
    const res = walkForwardWith(base({ trendCandles: { market } }), opts, stubOptimizerDeps());
    expect(market).toEqual(copy); // time based: never sliced or mutated
    expect(res.folds).toHaveLength(4);
    const sum = res.folds.reduce(
      (s, f) => ({ trend: s.trend + f.blockedEntries!.trend, spread: s.spread + f.blockedEntries!.spread }),
      { trend: 0, spread: 0 },
    );
    expect(res.blockedEntries).toEqual(sum);
    // Fold 0's test window lies completely before the flip, folds 2 and 3 completely after it.
    expect(res.folds[0].testTo).toBeLessThan(FLIP);
    expect(res.folds[0].testMetrics.trades).toBe(0);
    expect(res.folds[0].blockedEntries!.trend).toBeGreaterThan(0);
    for (const f of res.folds.slice(2)) {
      expect(f.testFrom).toBeGreaterThanOrEqual(FLIP);
      expect(f.blockedEntries!.trend).toBe(0);
    }
    expect(res.note).toBeUndefined();
  });

  it("without trend data: one note (not per fold) and the same result as without the filter", () => {
    const noData = walkForwardWith(base(), opts, stubOptimizerDeps());
    const off = walkForwardWith(base({ ensemble: ensembleWith(OFF) }), opts, stubOptimizerDeps());
    expect(noData.note).toBe(TREND_NOT_APPLIED_NOTE);
    expect(noData.oosMetrics).toEqual(off.oosMetrics);
    expect(noData.folds.map((f) => f.bestParams)).toEqual(off.folds.map((f) => f.bestParams));
    expect(noData.blockedEntries).toEqual({ trend: 0, spread: 0 }); // default spread limit → reported
  });

  it("the spread limit blocks every out-of-sample entry, summed over the folds", () => {
    const res = walkForwardWith(base({ ensemble: ensembleWith(OFF), spreadPct: 0.01 }), opts, stubOptimizerDeps());
    expect(res.oosMetrics.trades).toBe(0);
    expect(res.blockedEntries!.spread).toBe(res.folds.reduce((s, f) => s + f.blockedEntries!.spread, 0));
    expect(res.blockedEntries!.spread).toBeGreaterThan(0);
    expect(res.note).toBe("Geen aankopen: de spread van deze markt (1,00%) is groter dan je maximum (0,30%).");
  });
});
