import { describe, expect, it } from "vitest";
import { BOT_PROFILES, DEFAULT_BOT_IDS, getProfile, profileEngineConfig } from "../../src/bots/profiles";
import { DEFAULT_ENGINE_CONFIG } from "../../src/core/defaults";
import { INTERVALS, STRATEGY_IDS } from "../../src/core/types";
import { validateRiskConfig } from "../../src/risk/riskManager";

describe("Bot-profielen", () => {
  it("vier verschillende bots met unieke id's, namen en kleuren", () => {
    expect(DEFAULT_BOT_IDS).toEqual(["scalper", "trend", "dip", "allround"]);
    expect(new Set(BOT_PROFILES.map((p) => p.name)).size).toBe(4);
    expect(new Set(BOT_PROFILES.map((p) => p.color)).size).toBe(4);
    for (const p of BOT_PROFILES) {
      expect(p.id).toMatch(/^[a-z][a-z0-9-]{1,20}$/);
      expect(p.color).toMatch(/^#[0-9a-f]{6}$/i);
      expect(p.description.length).toBeGreaterThan(40);
    }
    expect(getProfile("trend")?.name).toBe("Trendvolger");
    expect(getProfile("bestaat-niet")).toBeUndefined();
  });

  it("elke profielconfig is geldig en verschilt echt van de andere", () => {
    const cfgs = BOT_PROFILES.map((p) => profileEngineConfig(p));
    for (const c of cfgs) {
      expect(validateRiskConfig(c.risk)).toEqual({ ok: true, errors: [] });
      expect((INTERVALS as readonly string[]).includes(c.interval)).toBe(true);
      expect(c.ensemble.enabled.length).toBeGreaterThan(0);
      for (const id of c.ensemble.enabled) {
        expect(STRATEGY_IDS).toContain(id);
        expect(c.ensemble.weights[id]).toBeGreaterThan(0);
      }
      expect(c.universe?.mode).toBe("auto");
      expect(c.risk.dailyProfitTargetPct).toBe(DEFAULT_ENGINE_CONFIG.risk.dailyProfitTargetPct);
    }
    const sig = cfgs.map((c) => JSON.stringify([c.interval, c.ensemble.enabled, c.risk.stopAtrMult, c.risk.takeProfitR]));
    expect(new Set(sig).size).toBe(4);
    // Profielen veranderen de standaardconfig niet
    expect(DEFAULT_ENGINE_CONFIG.interval).toBe("15m");
    expect(DEFAULT_ENGINE_CONFIG.risk.stopAtrMult).toBe(2);
  });

  it("de scalper heeft alleen zijn eigen gewichten; de allrounder houdt alle strategieën", () => {
    const s = profileEngineConfig(getProfile("scalper")!);
    expect(Object.keys(s.ensemble.weights).sort()).toEqual(["breakout", "ema-trend", "macd-momentum", "vwap-reversion"]);
    expect(s.ensemble.trendFilter).toMatchObject({ market: false, coin: false });
    const a = profileEngineConfig(getProfile("allround")!);
    expect(a.ensemble.enabled).toEqual(DEFAULT_ENGINE_CONFIG.ensemble.enabled);
    expect(a.risk.stopAtrMult).toBe(1.5);
    expect(a.risk.maxTradesPerDay).toBe(20);
  });
});
