import { describe, expect, it } from "vitest";
import type { Regime } from "../../src/core/types";
import { mulberry32 } from "../../src/core/util";
import { detectRegimes } from "../../src/strategies/regime";
import { candlesFromCloses, driftCloses, rangeCloses, syntheticSeries } from "./fixtures";

function share(regimes: Regime[], from: number, r: Regime): number {
  const part = regimes.slice(from);
  return part.filter((x) => x === r).length / part.length;
}

describe("detectRegimes", () => {
  it("zelfde lengte, 'unknown' tijdens warmup, daarna bekend", () => {
    const { candles } = syntheticSeries({ n: 400, seed: 5 });
    const r = detectRegimes(candles);
    expect(r).toHaveLength(400);
    expect(r.slice(0, 50).every((x) => x === "unknown")).toBe(true);
    expect(r.slice(80).every((x) => x !== "unknown")).toBe(true);
    expect(detectRegimes([])).toEqual([]);
    expect(detectRegimes(candles.slice(0, 10))).toEqual(new Array(10).fill("unknown"));
  });

  it("herkent een stijgende trend", () => {
    const candles = candlesFromCloses(driftCloses(300, 100, 0.25, 0.15, 1), { wickPct: 0.002 });
    expect(share(detectRegimes(candles), 100, "trend-up")).toBeGreaterThan(0.7);
  });

  it("herkent een dalende trend", () => {
    const candles = candlesFromCloses(driftCloses(300, 100, -0.25, 0.15, 2), { wickPct: 0.002 });
    expect(share(detectRegimes(candles), 100, "trend-down")).toBeGreaterThan(0.7);
  });

  it("herkent een vlakke markt als range", () => {
    const candles = candlesFromCloses(rangeCloses(300, 100, 0.3, 0.15, 3), { wickPct: 0.002 });
    const r = detectRegimes(candles);
    expect(share(r, 100, "range")).toBeGreaterThan(0.7);
    expect(share(r, 100, "trend-up") + share(r, 100, "trend-down")).toBeLessThan(0.2);
  });

  it("markeert een plotselinge volatiliteitsexplosie als volatile", () => {
    const calm = rangeCloses(200, 100, 0.2, 0.1, 4);
    const z = mulberry32(9);
    const wild: number[] = [];
    let p = calm[calm.length - 1];
    for (let i = 0; i < 20; i++) {
      p *= 1 + (z() < 0.5 ? -1 : 1) * (0.015 + 0.01 * z());
      wild.push(p);
    }
    const candles = candlesFromCloses([...calm, ...wild], { wickPct: 0.002 });
    const r = detectRegimes(candles);
    expect(r.slice(205, 220).filter((x) => x === "volatile").length).toBeGreaterThan(5);
    expect(r.slice(100, 200).filter((x) => x === "volatile").length).toBeLessThan(10);
  });

  it("volgt het gesimuleerde regime redelijk (synthetische data)", () => {
    const { candles, regimes: truth } = syntheticSeries({ n: 6000, seed: 17 });
    const r = detectRegimes(candles);
    let upHits = 0;
    let upTotal = 0;
    let downAsUp = 0;
    let downTotal = 0;
    for (let i = 200; i < candles.length; i++) {
      if (truth[i] === "up") {
        upTotal++;
        if (r[i] === "trend-up") upHits++;
      }
      if (truth[i] === "down") {
        downTotal++;
        if (r[i] === "trend-up") downAsUp++;
      }
    }
    // Detectie is vertraagd en ruisgevoelig, maar moet duidelijk beter dan toeval zijn
    expect(upHits / upTotal).toBeGreaterThan(0.25);
    expect(downAsUp / downTotal).toBeLessThan(0.1);
  });

  it("heeft GEEN lookahead", () => {
    const { candles } = syntheticSeries({ n: 800, seed: 23 });
    const full = detectRegimes(candles);
    const rand = mulberry32(3);
    for (let j = 0; j < 30; j++) {
      const k = 1 + Math.floor(rand() * candles.length);
      expect(detectRegimes(candles.slice(0, k))[k - 1], `k=${k}`).toBe(full[k - 1]);
    }
  });
});
