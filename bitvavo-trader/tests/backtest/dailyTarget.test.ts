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
    // Dag 1 haalde het dagdoel (grens aan) en zette de winst vast; hij eindigde daardoor net onder +1%,
    // maar telt wel als dag die het dagdoel haalde. Dag 2 en 3 haalden het niet.
    expect(r.dailyStats!.bestDayPct).toBeLessThan(1);
    expect(r.dailyStats!.targetDays).toBe(1);
  });

  it("dailyStats: een dag waarop de winst werd vastgezet telt als 'dagdoel gehaald' (niet als gemist)", () => {
    // Candle 5 sluit op 103 (+1,35% na kosten: grens aan), candle 6 op 102,2: terug op de grens → vastzetten.
    const c = flatCandles(N, 100);
    c[5] = candle(5, 100, 103.1, 99.9, 103);
    c[6] = candle(6, 103, 103, 102.1, 102.2);
    for (let i = 7; i < N; i++) c[i] = candle(i, 102.2, 102.3, 102.1, 102.2);
    const r = run(1, [0], c);
    expect(r.trades).toHaveLength(1);
    expect(r.trades[0]).toMatchObject({ exitReason: "daily-target" });
    expect(r.dailyStats).toMatchObject({ days: 3, targetPct: 1, targetDays: 1, winDays: 1 });
    expect(r.dailyStats!.bestDayPct).toBeLessThan(1); // eindigde onder +1%, maar haalde het doel wel
  });

  it("dailyStats: haalde de dag het doel en zakte hij daarna hard terug, dan telt hij nog steeds (één keer)", () => {
    // Grens aan op candle 5; candle 6 zakt in één keer naar 99 (onder de start): verkocht met verlies.
    const c = flatCandles(N, 100);
    c[5] = candle(5, 100, 103.1, 99.9, 103);
    c[6] = candle(6, 103, 103, 98.9, 99);
    for (let i = 7; i < N; i++) c[i] = candle(i, 99, 99.1, 98.9, 99);
    const r = run(1, [0], c);
    expect(r.trades[0]).toMatchObject({ exitReason: "daily-target" });
    expect(r.dailyStats).toMatchObject({ days: 3, targetDays: 1, winDays: 0, lossDays: 1 });
  });

  it("dailyStats: de grens ging niet aan (alleen +1% vóór kosten) → geen dagdoel-dag", () => {
    const c = flatCandles(N, 100);
    c[5] = candle(5, 100, 102.6, 99.9, 102.5);
    for (let i = 6; i < N; i++) c[i] = candle(i, 100.5, 100.6, 100.4, 100.5);
    const r = run(1, [0], c);
    expect(r.dailyStats!.targetDays).toBe(0);
  });

  it("dailyStats met dagdoel uit: alleen het dagresultaat telt (≥ +1%), geen grens", () => {
    // Zonder dagdoel wordt er niet om het dagdoel verkocht; de dag telt alleen op zijn slot.
    const r = run(0, [0, 10, 100]);
    expect(r.trades.some((t) => t.exitReason === "daily-target")).toBe(false);
    expect(r.dailyStats).toMatchObject({ days: 3, targetPct: 1 });
    // Dag 1 eindigt op ~+0,7% (50 euro in de munt, +1,5%, minus kosten): niet gehaald, en geen grens die meetelt.
    expect(r.dailyStats!.bestDayPct).toBeLessThan(1);
    expect(r.dailyStats!.targetDays).toBe(0);
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

  it("telt een dag uit reachedDays (grens ging aan) mee, ook als hij onder het doel eindigde; nooit dubbel", () => {
    const keys = ["a", "a", "b", "b", "c"];
    const eq = [100, 101.5, 100.5, 99.5, 101];
    // b eindigde op -1,97%, maar haalde het doel (grens aan); a haalde het al op het slot (+1,5%): één keer tellen
    expect(dailyStatsFrom(keys, 0, eq, 100, 1, new Set(["a", "b"]))).toMatchObject({ days: 3, targetDays: 3 });
    expect(dailyStatsFrom(keys, 0, eq, 100, 1, new Set(["b"]))).toMatchObject({ days: 3, targetDays: 3 });
    expect(dailyStatsFrom(keys, 0, eq, 100, 1, new Set())).toMatchObject({ days: 3, targetDays: 2 });
    // een dag buiten de testperiode (vóór evalStart) telt niet
    expect(dailyStatsFrom(["x", "a", "a"], 1, [100, 100.2], 100, 1, new Set(["x"]))).toMatchObject({ days: 1, targetDays: 0 });
  });
});
