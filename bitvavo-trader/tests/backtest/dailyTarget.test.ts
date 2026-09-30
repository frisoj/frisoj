/**
 * Dagdoel als winstgrens in de backtest (risk.dailyProfitTargetPct) en de dagtelling (result.dailyStats).
 */
import { describe, expect, it } from "vitest";
import { dailyStatsFrom, runBacktestWith } from "../../src/backtest/simulator";
import type { Candle } from "../../src/core/types";
import { dayKey } from "../../src/core/util";
import { SLIP, STEP, T0, candle, decisionsFrom, flatCandles, input, riskCfg, stubRisk } from "./helpers";

// T0 = maandag 00:00 UTC = 01:00 in Amsterdam: de dag wisselt bij candle 92 (23:00 UTC).
const N = 200;
/** Candle 5 sluit op 103 (dag > +1% na kosten: grens actief); candle 6 op `fallTo`. */
function prices(fallTo: number | null = 101.5): Candle[] {
  const c = flatCandles(N, 100);
  c[5] = candle(5, 100, 103.1, 99.9, 103);
  if (fallTo !== null) {
    c[6] = candle(6, 103, 103, fallTo - 0.1, fallTo);
    for (let i = 7; i < N; i++) c[i] = candle(i, fallTo, fallTo + 0.1, fallTo - 0.1, fallTo);
  } else {
    for (let i = 6; i < N; i++) c[i] = candle(i, 103, 103.1, 102.9, 103);
  }
  return c;
}
function acts(...buyAt: number[]): string {
  return Array.from({ length: N }, (_, i) => (buyAt.includes(i) ? "B" : ".")).join("");
}
function run(targetPct: number, buyAt: number[], candles = prices()) {
  const decisions = decisionsFrom(candles, acts(...buyAt));
  return runBacktestWith(input(candles, { risk: riskCfg({ dailyProfitTargetPct: targetPct, maxSpreadPct: 0 }) }), {
    decide: () => decisions,
    createRisk: () => stubRisk({ quote: 50, tpDist: 20 }),
  }).result;
}

describe("Dagdoel als winstgrens in de backtest", () => {
  it("grens actief na +1%; terugval → verkopen op de slotkoers en die dag niet meer kopen; de dag erna wel", () => {
    const r = run(1, [0, 10, 100]);
    expect(dayKey(T0 + 92 * STEP)).not.toBe(dayKey(T0 + 91 * STEP));
    expect(r.trades).toHaveLength(2);
    expect(r.trades[0]).toMatchObject({ exitReason: "daily-target" });
    expect(r.trades[0].exitPrice).toBeCloseTo(101.5 * (1 - SLIP), 8); // de slotkoers van candle 6, niet die van 5
    expect(r.trades[0].pnlQuote).toBeGreaterThan(0);
    // het koopsignaal van candle 10 (zelfde dag) werd genegeerd; dat van candle 100 (volgende dag) niet
    expect(r.trades[1].entryTime).toBe(T0 + 101 * STEP);
    expect(r.markers.some((m) => m.label.startsWith("DAGDOEL"))).toBe(true);
  });

  it("blijft de koers boven de grens, dan wordt er niets verkocht (doorhandelen)", () => {
    const r = run(1, [0], prices(null));
    expect(r.trades.some((t) => t.exitReason === "daily-target")).toBe(false);
  });

  it("telt pas NA verkoopkosten: +1,1% op papier maar minder na fee en slippage → grens niet actief", () => {
    const c = flatCandles(N, 100);
    c[5] = candle(5, 100, 102.6, 99.9, 102.5);
    for (let i = 6; i < N; i++) c[i] = candle(i, 100.5, 100.6, 100.4, 100.5);
    const r = run(1, [0], c);
    expect(r.trades.some((t) => t.exitReason === "daily-target")).toBe(false);
  });

  it("dagdoel 0 = uit: geen verkoop om het dagdoel", () => {
    const r = run(0, [0, 10, 100]);
    expect(r.trades.some((t) => t.exitReason === "daily-target")).toBe(false);
  });

  it("dailyStats telt de dagen", () => {
    const r = run(1, [0, 10, 100]);
    expect(r.dailyStats).toMatchObject({ days: 3, targetPct: 1 });
    expect(r.dailyStats!.bestDayPct).toBeGreaterThan(0);
    expect(r.dailyStats!.targetDays).toBe(0); // dag 1 eindigde na het vastzetten net onder +1%
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
