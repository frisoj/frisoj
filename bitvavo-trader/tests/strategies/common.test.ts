import { describe, expect, it } from "vitest";
import { nl, persistRun, rollingMeanSkipNaN, WARMUP_REASON, type SignalEvent } from "../../src/strategies/common";

describe("persistRun", () => {
  const events: Record<number, SignalEvent> = {
    5: { action: "buy", confidence: 0.9, reason: "koop" },
    20: { action: "buy", confidence: 0.8, reason: "koop2" },
    23: { action: "sell", confidence: 0.7, reason: "verkoop", decayBars: 2 },
  };

  it("warmup → hold, vers event, lineair verval naar floor, daarna hold", () => {
    const sigs = persistRun("ema-trend", 40, 3, {
      ready: () => true,
      event: (i) => events[i] ?? null,
      valid: () => true,
      decayBars: 6,
      floor: 0.3,
    });
    expect(sigs).toHaveLength(40);
    expect(sigs.slice(0, 3).every((s) => s.action === "hold" && s.reason === WARMUP_REASON)).toBe(true);
    expect(sigs[4]).toEqual({ strategy: "ema-trend", action: "hold", confidence: 0, reason: "Geen signaal" });
    expect(sigs[5]).toEqual({ strategy: "ema-trend", action: "buy", confidence: 0.9, reason: "koop" });
    expect(sigs[6].confidence).toBeCloseTo(0.9 - 0.6 / 6, 12);
    expect(sigs[6].reason).toBe("koop (1 candle geleden)");
    expect(sigs[8].reason).toBe("koop (3 candles geleden)");
    expect(sigs[11].confidence).toBeCloseTo(0.3, 12);
    expect(sigs[11].action).toBe("buy");
    expect(sigs[12].action).toBe("hold");
    // Tegengesteld event draait de mening meteen om, met eigen (korte) nawerking
    expect(sigs[22].action).toBe("buy");
    expect(sigs[23].action).toBe("sell");
    expect(sigs[25].action).toBe("sell");
    expect(sigs[25].confidence).toBeCloseTo(0.3, 12);
    expect(sigs[26].action).toBe("hold");
  });

  it("stopt de nawerking zodra de toestand niet meer geldig is", () => {
    const sigs = persistRun("breakout", 15, 0, {
      ready: () => true,
      event: (i) => (i === 2 ? { action: "buy", confidence: 1, reason: "x" } : null),
      valid: (i) => i < 4,
    });
    expect(sigs.map((s) => s.action).slice(0, 7)).toEqual(["hold", "hold", "buy", "buy", "hold", "hold", "hold"]);
  });

  it("niet-ready index reset de toestand", () => {
    const sigs = persistRun("breakout", 10, 0, {
      ready: (i) => i !== 4,
      event: (i) => (i === 2 ? { action: "sell", confidence: 0.8, reason: "x" } : null),
      valid: () => true,
    });
    expect(sigs[3].action).toBe("sell");
    expect(sigs[4].reason).toBe(WARMUP_REASON);
    expect(sigs[5].action).toBe("hold");
  });
});

describe("helpers", () => {
  it("nl gebruikt een decimale komma", () => {
    expect(nl(27.44, 1)).toBe("27,4");
    expect(nl(-0.4149, 2)).toBe("-0,41");
    expect(nl(Number.NaN)).toBe("–");
  });

  it("rollingMeanSkipNaN slaat een NaN-aanloop over", () => {
    const out = rollingMeanSkipNaN([NaN, NaN, 1, 2, 3, 4], 2);
    expect(out.slice(0, 3).every(Number.isNaN)).toBe(true);
    expect(out.slice(3)).toEqual([1.5, 2.5, 3.5]);
  });
});
