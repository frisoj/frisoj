/**
 * v2-validatie (PUT /api/config en backtest-verzoeken): tot 400 markten,
 * muntkeuze (universe), trendfilter en maximale spread, met de ECHTE
 * validateRiskConfig (de server-fake in helpers.ts kent alleen riskPerTradePct).
 */
import { describe, expect, it } from "vitest";
import { DEFAULT_ENGINE_CONFIG } from "../../src/core/defaults";
import type { EngineConfig } from "../../src/core/types";
import { validateRiskConfig } from "../../src/risk/riskManager";
import { HttpError } from "../../src/server/router";
import {
  mergeTrendFilter,
  mergeUniverse,
  parseBacktestRequest,
  parseOptimizeRequest,
  parseWalkForwardRequest,
  validateConfigPatch,
} from "../../src/server/validation";

const KNOWN = new Set(Array.from({ length: 450 }, (_, i) => `M${i}-EUR`).concat(["BTC-EUR", "ETH-EUR"]));

function current(): EngineConfig {
  return structuredClone(DEFAULT_ENGINE_CONFIG);
}

function patch(body: unknown, cur: EngineConfig = current()) {
  return validateConfigPatch(body, cur, { knownEurMarkets: KNOWN, validateRisk: validateRiskConfig });
}

/** Gooit een HttpError 400 en geeft de melding terug. */
function error400(fn: () => unknown): string {
  try {
    fn();
  } catch (err) {
    expect(err).toBeInstanceOf(HttpError);
    expect((err as HttpError).status).toBe(400);
    return (err as HttpError).message;
  }
  throw new Error("verwachtte een 400");
}

describe("PUT /api/config-validatie: markten (1..400)", () => {
  it("accepteert 400 markten", () => {
    const list = Array.from({ length: 400 }, (_, i) => `m${i}-eur`);
    expect(patch({ markets: list }).markets).toEqual(list.map((m) => m.toUpperCase()));
  });

  it("weigert 401 markten en een lege lijst", () => {
    const list = Array.from({ length: 401 }, (_, i) => `M${i}-EUR`);
    expect(error400(() => patch({ markets: list }))).toBe("Kies 1 tot 400 markten.");
    expect(error400(() => patch({ markets: [] }))).toBe("Kies 1 tot 400 markten.");
  });
});

describe("PUT /api/config-validatie: universe (gedeeltelijk)", () => {
  it("vult ontbrekende velden aan uit de huidige instellingen", () => {
    expect(patch({ universe: { count: 100 } }).universe).toEqual({ mode: "auto", count: 100, minVolumeEur: 250_000 });
    expect(patch({ universe: { mode: "manual" } }).universe).toEqual({ mode: "manual", count: 30, minVolumeEur: 250_000 });
    expect(patch({ universe: { minVolumeEur: 0 } }).universe?.minVolumeEur).toBe(0);
    expect(patch({ universe: { minVolumeEur: 1e12, count: 400 } }).universe).toMatchObject({ minVolumeEur: 1e12, count: 400 });
    expect(patch({ universe: {} }).universe).toEqual(DEFAULT_ENGINE_CONFIG.universe);
    // Zonder universe in het verzoek blijft het veld weg (de engine houdt de huidige)
    expect("universe" in patch({ pollMs: 10_000 })).toBe(false);
  });

  it("huidige config zonder universe telt als manual", () => {
    const cur = current();
    delete cur.universe;
    expect(patch({ universe: { count: 5 } }, cur).universe).toEqual({ mode: "manual", count: 5, minVolumeEur: 250_000 });
  });

  it.each([
    [{ mode: "alles" }, 'Muntkeuze (universe.mode) moet "manual" (zelf kiezen) of "auto" (automatisch) zijn.'],
    [{ count: 0 }, "Aantal munten (universe.count) moet tussen 1 en 400 liggen (nu: 0)."],
    [{ count: 401 }, "Aantal munten (universe.count) moet tussen 1 en 400 liggen (nu: 401)."],
    [{ count: 2.5 }, "Aantal munten (universe.count) moet een geheel getal zijn."],
    [{ count: "veel" }, "Aantal munten (universe.count) moet een getal zijn."],
    [{ minVolumeEur: -1 }, "Minimale handel per dag in euro (universe.minVolumeEur) moet tussen 0 en 1000000000000 liggen (nu: -1)."],
    [{ minVolumeEur: 2e12 }, "Minimale handel per dag in euro (universe.minVolumeEur) moet tussen 0 en 1000000000000 liggen"],
    [{ foo: 1 }, "Onbekende muntkeuze-instelling: foo."],
  ])("400 voor universe %j", (universe, msg) => {
    expect(error400(() => patch({ universe }))).toContain(msg);
  });

  it("geen object → 400", () => {
    expect(error400(() => patch({ universe: "auto" }))).toBe("universe moet een object zijn (mode, count, minVolumeEur).");
    expect(error400(() => patch({ universe: null }))).toMatch(/universe moet een object zijn/);
  });

  it("meerdere fouten in één melding", () => {
    const msg = error400(() => patch({ universe: { mode: "x", count: 0 }, pollMs: 1 }));
    expect(msg).toMatch(/pollMs/);
    expect(msg).toMatch(/universe\.mode/);
    expect(msg).toMatch(/universe\.count/);
  });

  it("mergeUniverse los", () => {
    const errors: string[] = [];
    expect(mergeUniverse({ mode: "auto" }, undefined, errors)).toEqual({ mode: "auto", count: 30, minVolumeEur: 250_000 });
    expect(errors).toEqual([]);
  });
});

describe("PUT /api/config-validatie: ensemble.trendFilter (gedeeltelijk)", () => {
  it("vult ontbrekende velden aan en laat de rest van het ensemble staan", () => {
    const out = patch({ ensemble: { trendFilter: { coin: true } } });
    expect(out.ensemble?.trendFilter).toEqual({ market: true, coin: true, interval: "1d", period: 50 });
    expect(out.ensemble?.enabled).toEqual(DEFAULT_ENGINE_CONFIG.ensemble.enabled);
    expect(out.ensemble?.buyThreshold).toBe(DEFAULT_ENGINE_CONFIG.ensemble.buyThreshold);
    expect(patch({ ensemble: { trendFilter: { market: false, interval: "4h", period: 5 } } }).ensemble?.trendFilter).toEqual({
      market: false,
      coin: false,
      interval: "4h",
      period: 5,
    });
    expect(patch({ ensemble: { trendFilter: { period: 200 } } }).ensemble?.trendFilter?.period).toBe(200);
  });

  it("huidig ensemble zonder trendFilter telt als filter uit", () => {
    const cur = current();
    delete cur.ensemble.trendFilter;
    expect(patch({ ensemble: { trendFilter: { period: 20 } } }, cur).ensemble?.trendFilter).toEqual({
      market: false,
      coin: false,
      interval: "1d",
      period: 20,
    });
    // Zonder trendFilter in het verzoek blijft hij weg
    expect(patch({ ensemble: { buyThreshold: 0.5 } }, cur).ensemble?.trendFilter).toBeUndefined();
  });

  it.each([
    [{ market: "ja" }, "Marktfilter (trendFilter.market) moet true of false zijn."],
    [{ coin: 1 }, "Muntfilter (trendFilter.coin) moet true of false zijn."],
    [{ interval: "1h" }, 'Tijdschaal van het trendfilter (trendFilter.interval) moet "4h" (4 uur) of "1d" (dag) zijn.'],
    [{ period: 4 }, "Periode van het trendfilter (trendFilter.period) moet tussen 5 en 200 liggen (nu: 4)."],
    [{ period: 201 }, "Periode van het trendfilter (trendFilter.period) moet tussen 5 en 200 liggen (nu: 201)."],
    [{ period: 20.5 }, "Periode van het trendfilter (trendFilter.period) moet een geheel getal zijn."],
    [{ drempel: 1 }, "Onbekende trendfilter-instelling: drempel."],
  ])("400 voor trendFilter %j", (trendFilter, msg) => {
    expect(error400(() => patch({ ensemble: { trendFilter } }))).toContain(msg);
  });

  it("geen object → 400", () => {
    expect(error400(() => patch({ ensemble: { trendFilter: true } }))).toBe(
      "ensemble.trendFilter moet een object zijn (market, coin, interval, period).",
    );
  });

  it("mergeTrendFilter los", () => {
    const errors: string[] = [];
    expect(mergeTrendFilter({ market: true }, undefined, errors)).toEqual({ market: true, coin: false, interval: "1d", period: 50 });
    expect(errors).toEqual([]);
  });
});

describe("PUT /api/config-validatie: risk.maxSpreadPct (0..5)", () => {
  it("accepteert 0 (uit) tot en met 5 en laat de andere risico-instellingen staan", () => {
    expect(patch({ risk: { maxSpreadPct: 0 } }).risk?.maxSpreadPct).toBe(0);
    const out = patch({ risk: { maxSpreadPct: 5 } });
    expect(out.risk?.maxSpreadPct).toBe(5);
    expect(out.risk?.stopAtrMult).toBe(DEFAULT_ENGINE_CONFIG.risk.stopAtrMult);
    expect(patch({ risk: { maxSpreadPct: "0,5" } }).risk?.maxSpreadPct).toBe(0.5);
  });

  it("weigert waarden buiten 0..5", () => {
    expect(error400(() => patch({ risk: { maxSpreadPct: 5.1 } }))).toMatch(/Max\. spread \(%\) \(maxSpreadPct\) moet tussen 0 en 5 liggen/);
    expect(error400(() => patch({ risk: { maxSpreadPct: -0.1 } }))).toMatch(/maxSpreadPct/);
    expect(error400(() => patch({ risk: { maxSpreadPct: "breed" } }))).toBe("Risico-instelling maxSpreadPct moet een getal zijn.");
  });

  it("een huidige config zonder maxSpreadPct blijft geldig bij het wijzigen van iets anders", () => {
    const cur = current();
    delete cur.risk.maxSpreadPct;
    const out = patch({ risk: { stopAtrMult: 3 } }, cur);
    expect(out.risk?.stopAtrMult).toBe(3);
    expect(out.risk?.maxSpreadPct).toBeUndefined();
  });
});

describe("backtest / optimize / walk-forward: ensemble.trendFilter", () => {
  const deps = {
    knownMarkets: KNOWN,
    current: current(),
    defaultCapital: 50,
    validateRisk: validateRiskConfig,
  };
  const base = { market: "BTC-EUR", interval: "1h", days: 30 };

  it("zonder trendFilter in het verzoek: het filter van de huidige instellingen", () => {
    expect(parseBacktestRequest(base, deps).ensemble.trendFilter).toEqual(DEFAULT_ENGINE_CONFIG.ensemble.trendFilter);
  });

  it("gedeeltelijk trendFilter (bijv. uit om te vergelijken) en maxSpreadPct", () => {
    const p = parseBacktestRequest(
      { ...base, ensemble: { trendFilter: { market: false } }, risk: { maxSpreadPct: 0 } },
      deps,
    );
    expect(p.ensemble.trendFilter).toEqual({ market: false, coin: false, interval: "1d", period: 50 });
    expect(p.risk.maxSpreadPct).toBe(0);
    const o = parseOptimizeRequest({ ...base, objective: "sharpe", ensemble: { trendFilter: { coin: true, interval: "4h" } } }, deps);
    expect(o.ensemble.trendFilter).toEqual({ market: true, coin: true, interval: "4h", period: 50 });
    const w = parseWalkForwardRequest({ ...base, objective: "sharpe", folds: 3, ensemble: { trendFilter: { period: 100 } } }, deps);
    expect(w.ensemble.trendFilter?.period).toBe(100);
  });

  it.each([
    [parseBacktestRequest, {}],
    [parseOptimizeRequest, { objective: "sharpe" }],
    [parseWalkForwardRequest, { objective: "sharpe", folds: 3 }],
  ] as const)("ongeldig trendFilter → 400 (%#)", (parse, extra) => {
    const msg = error400(() => parse({ ...base, ...extra, ensemble: { trendFilter: { period: 1, interval: "1w" } } }, deps));
    expect(msg).toMatch(/Periode van het trendfilter/);
    expect(msg).toMatch(/Tijdschaal van het trendfilter/);
  });

  it("maxSpreadPct buiten 0..5 in een backtest → 400", () => {
    expect(error400(() => parseBacktestRequest({ ...base, risk: { maxSpreadPct: 10 } }, deps))).toMatch(/maxSpreadPct/);
  });
});
