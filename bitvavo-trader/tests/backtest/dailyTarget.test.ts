/**
 * Dagdoel in de backtest (risk.dailyProfitTargetPct) en de dagtelling (result.dailyStats).
 */
import { describe, expect, it } from "vitest";
import { dailyStatsFrom, runBacktestWith } from "../../src/backtest/simulator";
import type { Candle } from "../../src/core/types";
import { dayKey } from "../../src/core/util";
import { SLIP, STEP, T0, candle, decisionsFrom, flatCandles, input, riskCfg, stubRisk } from "./helpers";

// T0 = maandag 00:00 UTC = 01:00 in Amsterdam: de dag wisselt bij candle 92 (23:00 UTC).
const N = 200;
function prices(): Candle[] {
  const c = flatCandles(N);
  c[5] = candle(5, 100, 103.1, 99.9, 103); // de dag staat na deze candle > +1%, ook na verkoopkosten
  return c;
}
function acts(...buyAt: number[]): string {
  return Array.from({ length: N }, (_, i) => (buyAt.includes(i) ? "B" : ".")).join("");
}
function run(targetPct: number, buyAt: number[]) {
  const candles = prices();
  const decisions = decisionsFrom(candles, acts(...buyAt));
  return runBacktestWith(input(candles, { risk: riskCfg({ dailyProfitTargetPct: targetPct, maxSpreadPct: 0 }) }), {
    decide: () => decisions,
    createRisk: () => stubRisk({ quote: 50 }),
  }).result;
}

describe("Dagdoel in de backtest", () => {
  it("verkoopt op de slotkoers zodra de dag het doel haalt en koopt die dag niet meer; de dag erna wel", () => {
    const r = run(1, [0, 10, 100]);
    expect(dayKey(T0 + 92 * STEP)).not.toBe(dayKey(T0 + 91 * STEP));
    expect(r.trades).toHaveLength(2);
    expect(r.trades[0]).toMatchObject({ exitReason: "daily-target" });
    expect(r.trades[0].exitPrice).toBeCloseTo(103 * (1 - SLIP), 8);
    expect(r.trades[0].pnlQuote).toBeGreaterThan(0);
    // het koopsignaal van candle 10 (zelfde dag) werd genegeerd; dat van candle 100 (volgende dag) niet
    expect(r.trades[1].entryTime).toBe(T0 + 101 * STEP);
    expect(r.markers.some((m) => m.label.startsWith("DAGDOEL"))).toBe(true);
  });

  it("telt pas NA verkoopkosten: +1,1% op papier maar minder na fee en slippage → niet verkopen", () => {
    const candles = prices();
    candles[5] = candle(5, 100, 102.6, 99.9, 102.5);
    const decisions = decisionsFrom(candles, acts(0));
    const r = runBacktestWith(input(candles, { risk: riskCfg({ dailyProfitTargetPct: 1, maxSpreadPct: 0 }) }), {
      decide: () => decisions,
      createRisk: () => stubRisk({ quote: 50 }),
    }).result;
    expect(r.trades.some((t) => t.exitReason === "daily-target")).toBe(false);
  });

  it("dagdoel 0 = uit: geen verkoop om het dagdoel", () => {
    const r = run(0, [0, 10, 100]);
    expect(r.trades.some((t) => t.exitReason === "daily-target")).toBe(false);
  });

  it("dailyStats telt de dagen met ≥ doel, winst en verlies", () => {
    const r = run(1, [0, 10, 100]);
    expect(r.dailyStats).toMatchObject({ days: 3, targetPct: 1, targetDays: 1, winDays: 1 });
    expect(r.dailyStats!.bestDayPct).toBeGreaterThan(1);
  });
});

describe("dailyStatsFrom", () => {
  it("rekent per dag tegen het eind van de vorige dag; zonder dagdoel telt +1%", () => {
    const keys = ["a", "a", "b", "b", "c"];
    const eq = [100, 101.5, 100.5, 99.5, 101];
    const s = dailyStatsFrom(keys, 0, eq, 100, 1);
    expect(s.days).toBe(3);
    expect(s.targetDays).toBe(2); // +1,5% en +1,51%
    expect(s.winDays).toBe(2);
    expect(s.lossDays).toBe(1);
    expect(s.bestDayPct).toBeCloseTo(((101 / 99.5) - 1) * 100, 10);
    expect(s.worstDayPct).toBeCloseTo(((99.5 / 101.5) - 1) * 100, 10);
    expect(s.avgDayPct).toBeCloseTo((1.5 + (99.5 / 101.5 - 1) * 100 + (101 / 99.5 - 1) * 100) / 3, 10);
    // evalStart schuift de dagsleutels op
    expect(dailyStatsFrom(["x", "a", "a"], 1, [100, 102], 100, 1)).toMatchObject({ days: 1, targetDays: 1 });
    expect(dailyStatsFrom([], 0, [], 100, 1)).toMatchObject({ days: 0, avgDayPct: 0 });
  });
});
