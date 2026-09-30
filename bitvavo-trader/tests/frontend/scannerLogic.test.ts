/**
 * Marktscanner (v2), pure logica (scannerLogic.js): "toevoegen aan de bot" bij
 * tot 400 munten en bij de automatische muntkeuze.
 */
import { beforeAll, describe, expect, it } from "vitest";
import { DEFAULT_ENGINE_CONFIG, MAX_MARKETS } from "../../src/core/defaults";
import { loadPublic, type Fake } from "./helpers";

let L: Fake;
beforeAll(async () => {
  L = await loadPublic("js/panels/scannerLogic.js");
});

const names = (n: number) => Array.from({ length: n }, (_, i) => `M${String(i).padStart(3, "0")}-EUR`);
const autoCfg = (over: Fake = {}) => ({
  ...structuredClone(DEFAULT_ENGINE_CONFIG),
  universe: { mode: "auto", count: 30, minVolumeEur: 250_000 },
  ...over,
});
const manualCfg = (markets: string[]) => ({
  ...structuredClone(DEFAULT_ENGINE_CONFIG),
  markets,
  universe: { mode: "manual", count: 30, minVolumeEur: 250_000 },
});

describe("scannerLogic", () => {
  it("maximum = MAX_MARKETS uit src/core/defaults.ts (400)", () => {
    expect(L.MAX_MARKETS).toBe(MAX_MARKETS);
    expect(L.MAX_MARKETS).toBe(400);
  });

  it("de munten van de bot: snapshot.activeMarkets ?? snapshot.config.markets", () => {
    expect(L.botMarketsOf({ activeMarkets: ["A-EUR", "B-EUR", "A-EUR"], config: { markets: ["C-EUR"] } })).toEqual(["A-EUR", "B-EUR"]);
    expect(L.botMarketsOf({ config: { markets: ["C-EUR"] } })).toEqual(["C-EUR"]);
    expect(L.botMarketsOf(null, { markets: ["D-EUR"] })).toEqual(["D-EUR"]);
    expect(L.botMarketsOf(null, null)).toEqual([]);
  });

  it("zelf kiezen: toevoegen tot 400 munten", () => {
    const cfg = manualCfg(names(399));
    const plan = L.addPlan("XRP-EUR", { snapshot: { config: cfg, activeMarkets: cfg.markets }, config: cfg });
    expect(plan.kind).toBe("add");
    expect(L.planPatch(plan)).toEqual({ markets: [...names(399), "XRP-EUR"] });
    const full = manualCfg(names(400));
    expect(L.addPlan("XRP-EUR", { config: full }).kind).toBe("full");
    expect(L.addPlan("M001-EUR", { config: full }).kind).toBe("in-bot");
    expect(L.planPatch(L.addPlan("M001-EUR", { config: full }))).toBeNull();
  });

  it("automatisch: overschakelen naar Zelf kiezen met de munten die de bot nu volgt plus deze", () => {
    const cfg = autoCfg();
    const snap = { config: cfg, activeMarkets: names(30) };
    const plan = L.addPlan("XRP-EUR", { snapshot: snap, config: cfg });
    expect(plan).toMatchObject({ kind: "switch", auto: true, count: 30 });
    expect(L.planPatch(plan)).toEqual({ universe: { mode: "manual" }, markets: [...names(30), "XRP-EUR"] });
    // de eigen lijst (config.markets) telt hier niet: de bot volgt de automatische keuze
    expect(plan.markets).not.toContain("SOL-EUR");
    expect(L.addPlan("M003-EUR", { snapshot: snap, config: cfg }).kind).toBe("in-bot");
    // al 400 actief → niets meer bij
    expect(L.addPlan("XRP-EUR", { snapshot: { config: cfg, activeMarkets: names(400) }, config: cfg }).kind).toBe("full");
    // oudere snapshot zonder activeMarkets → de eigen lijst
    expect(L.planPatch(L.addPlan("XRP-EUR", { snapshot: { config: cfg }, config: cfg }))).toEqual({
      universe: { mode: "manual" },
      markets: ["BTC-EUR", "ETH-EUR", "SOL-EUR", "XRP-EUR"],
    });
  });
});
