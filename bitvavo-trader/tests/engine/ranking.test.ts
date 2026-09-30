import { describe, expect, it } from "vitest";
import type { EnsembleDecision } from "../../src/core/types";
import { rankCandidates, relativeStrengthPct, type EntryCandidate } from "../../src/engine/ranking";

function cand(market: string, score: number, rs: number | null = null, vol: number | null = null): EntryCandidate {
  const decision: EnsembleDecision = {
    market, time: 0, price: 1, action: "buy", score, confidence: score, regime: "trend-up", atr: 1, votes: [],
  };
  return { market, decision, relStrengthPct: rs, volumeQuote24h: vol };
}

describe("rankCandidates", () => {
  it("sterkste signaal eerst", () => {
    const out = rankCandidates([cand("A-EUR", 0.4), cand("B-EUR", 0.8), cand("C-EUR", 0.6)]);
    expect(out.map((c) => c.market)).toEqual(["B-EUR", "C-EUR", "A-EUR"]);
  });

  it("bij (bijna) gelijke score: relatieve sterkte, dan volume, dan naam", () => {
    const out = rankCandidates([
      cand("A-EUR", 0.5, null, 9e6),
      cand("B-EUR", 0.51, 2, 1e6),
      cand("C-EUR", 0.49, 5, 1e6),
      cand("D-EUR", 0.5, 2, 5e6),
      cand("E-EUR", 0.5, 2, 5e6),
    ]);
    expect(out.map((c) => c.market)).toEqual(["C-EUR", "D-EUR", "E-EUR", "B-EUR", "A-EUR"]);
  });

  it("verandert de invoer niet en gaat goed om met rare scores", () => {
    const input = [cand("A-EUR", Number.NaN), cand("B-EUR", 0.4)];
    const out = rankCandidates(input);
    expect(out.map((c) => c.market)).toEqual(["B-EUR", "A-EUR"]);
    expect(input.map((c) => c.market)).toEqual(["A-EUR", "B-EUR"]);
  });
});

describe("relativeStrengthPct", () => {
  it("munt min Bitcoin, null als iets onbekend is", () => {
    expect(relativeStrengthPct(5, 2)).toBe(3);
    expect(relativeStrengthPct(-1, 2)).toBe(-3);
    expect(relativeStrengthPct(null, 2)).toBeNull();
    expect(relativeStrengthPct(1, Number.NaN)).toBeNull();
  });
});
