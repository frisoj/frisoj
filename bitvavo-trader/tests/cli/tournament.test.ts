import { describe, expect, it } from "vitest";
import { SimulatedFeed } from "../../src/data/simulatedFeed";
import { PERIODS, contenders, runTournament, summarize } from "../../src/cli/tournament";

const NOW = Date.UTC(2026, 8, 29, 12);

describe("strategie-toernooi", () => {
  it("test de bot, alle 5 strategieën apart en rangschikt ze per periode", async () => {
    const feed = new SimulatedFeed({ now: () => NOW });
    const res = await runTournament(feed, {
      markets: ["BTC-EUR"],
      capital: 50,
      periods: PERIODS.filter((p) => p.key === "1w"),
      walkForward: false,
      now: NOW,
    });
    expect(contenders()).toHaveLength(6);
    expect(res.rows).toHaveLength(6);
    for (const r of res.rows) {
      expect(Number.isFinite(r.returnPct)).toBe(true);
      expect(r.pnlQuote).toBeCloseTo((r.returnPct / 100) * 50, 6);
      expect(r.days).toBeGreaterThan(6);
    }
    const { ranking, buyHoldAvgPct } = summarize(res.rows, "1w");
    expect(ranking).toHaveLength(6);
    expect(Number.isFinite(buyHoldAvgPct)).toBe(true);
    for (let i = 1; i < ranking.length; i++) expect(ranking[i - 1].avgReturnPct).toBeGreaterThanOrEqual(ranking[i].avgReturnPct);
  });

  it("walk-forward-controle levert per strategie een resultaat op ongeziene data", async () => {
    const feed = new SimulatedFeed({ now: () => NOW });
    const res = await runTournament(feed, {
      markets: ["ETH-EUR"],
      capital: 50,
      periods: [{ key: "1y", label: "1 jaar", days: 365, intervals: ["4h"], walkForwardInterval: "4h" }],
      walkForward: true,
      now: NOW,
    });
    expect(res.walkForward).toHaveLength(6);
    for (const w of res.walkForward) {
      expect(w.folds).toBeGreaterThan(0);
      expect(w.foldsProfitable).toBeLessThanOrEqual(w.folds);
      expect(w.verdict.length).toBeGreaterThan(10);
    }
  });
});
