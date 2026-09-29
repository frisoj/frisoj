import { beforeAll, describe, expect, it } from "vitest";
import { DEFAULT_ENGINE_CONFIG } from "../../src/core/defaults";
import { loadPublic, type Fake } from "./helpers";

let L: Fake;
let fmt: Fake;
beforeAll(async () => {
  L = await loadPublic("js/panels/settingsLogic.js");
  fmt = (await loadPublic("js/format.js")).fmt;
});

const cfg = () => JSON.parse(JSON.stringify(DEFAULT_ENGINE_CONFIG));

/** Wat het invoerveld opslaat: zelfde rekensom als de input-handler van settings.js */
function typeInto(draft: Fake, key: string, text: string) {
  const f = L.RISK_GROUPS.flatMap((g: Fake) => g.fields).find((x: Fake) => x.key === key);
  const n = L.parseNum(text);
  draft.risk[key] = L.round(n / (f.scale || 1), 10);
}

describe("validatie: grenzen in de eenheid van het veld", () => {
  it("taker fee: melding in %, niet als fractie", () => {
    const d = cfg();
    typeInto(d, "takerFee", "2"); // 2% → buiten 0–1%
    const { errors, invalid } = L.validateDraft(d, { fmt });
    expect(invalid.has("risk.takerFee")).toBe(true);
    expect(errors).toContain("Taker fee moet tussen 0% en 1% liggen.");
    expect(errors.join(" ")).not.toContain("0,01");
  });

  it("slippage en maker fee ook in %", () => {
    const d = cfg();
    typeInto(d, "slippagePct", "3");
    typeInto(d, "makerFee", "1,5");
    const { errors } = L.validateDraft(d, { fmt });
    expect(errors).toContain("Slippage moet tussen 0% en 2% liggen.");
    expect(errors).toContain("Maker fee moet tussen 0% en 1% liggen.");
  });

  it("verversen: in seconden", () => {
    const d = cfg();
    d.pollMs = 2000;
    expect(L.validateDraft(d, { fmt }).errors).toContain("Verversen moet tussen 5 en 300 sec liggen.");
  });

  it("trailing stop: 0 (uit) is toegestaan, en de melding zegt dat", () => {
    const d = cfg();
    d.risk.trailingAtrMult = 0;
    expect(L.validateDraft(d, { fmt }).errors).toEqual([]);
    d.risk.trailingAtrMult = 0.2;
    expect(L.validateDraft(d, { fmt }).errors).toContain("Trailing stop moet 0 (uit) of tussen 0,5 en 10 × ATR liggen.");
  });

  it("de standaardconfig is geldig", () => {
    expect(L.validateDraft(cfg(), { fmt }).errors).toEqual([]);
  });
});

describe("waarschuwing bij een te lage taker fee", () => {
  it("0,01 typen (de oude melding volgen) slaat 0,0001 op en geeft een waarschuwing", () => {
    const d = cfg();
    typeInto(d, "takerFee", "0,01");
    expect(d.risk.takerFee).toBeCloseTo(0.0001, 10);
    expect(L.feeWarnings(d.risk).join(" ")).toMatch(/lager dan Bitvavo's standaard 0,25%/);
  });
  it("0% krijgt een eigen waarschuwing; 0,25% geen", () => {
    expect(L.feeWarnings({ takerFee: 0 }).join(" ")).toMatch(/0%/);
    expect(L.feeWarnings({ takerFee: 0.0025 })).toEqual([]);
    expect(L.feeWarnings({ takerFee: 0.004 })).toEqual([]);
  });
});

describe("buildPatch: alleen eigen wijzigingen", () => {
  it("stuurt niets mee wat de gebruiker niet veranderde", () => {
    const base = cfg();
    const d = L.clone(base);
    d.pollMs = 20000;
    expect(L.buildPatch(d, base)).toEqual({ pollMs: 20000 });
  });

  it("alleen gewijzigde gewichten en risicovelden", () => {
    const base = cfg();
    const d = L.clone(base);
    d.ensemble.weights.breakout = 1.5;
    d.risk.stopAtrMult = 2.5;
    expect(L.buildPatch(d, base)).toEqual({ ensemble: { weights: { breakout: 1.5 } }, risk: { stopAtrMult: 2.5 } });
  });

  it("parameters: verwijderen alleen als ze in de basis stonden en in het concept niet", () => {
    const base = cfg();
    base.ensemble.params = { "ema-trend": { fast: 12 } };
    const d = L.clone(base);
    d.ensemble.params = {};
    expect(L.buildPatch(d, base)).toEqual({ ensemble: { params: { "ema-trend": null } } });
  });

  it("leeg concept-verschil → lege patch", () => {
    const base = cfg();
    expect(L.buildPatch(L.clone(base), base)).toEqual({});
  });
});

describe("rebaseDraft: concept overzetten op een nieuwere serverconfig", () => {
  it("neemt wijzigingen van elders over (Scanner-markt, Backtest-parameters/risico) en houdt de eigen", () => {
    const base = cfg();
    const draft = L.clone(base);
    draft.pollMs = 20000;
    const server = L.clone(base);
    server.markets = [...base.markets, "TRX-EUR"];
    server.ensemble.params = { "ema-trend": { fast: 12, slow: 26, trend: 100, adxMin: 20 } };
    server.risk.stopAtrMult = 2.5;
    const r = L.rebaseDraft(draft, base, server);
    expect(r.conflicts).toEqual([]);
    expect(r.changed).toBe(true);
    expect(r.draft.markets).toEqual(["BTC-EUR", "ETH-EUR", "SOL-EUR", "TRX-EUR"]);
    expect(r.draft.ensemble.params).toEqual(server.ensemble.params);
    expect(r.draft.risk.stopAtrMult).toBe(2.5);
    expect(r.draft.pollMs).toBe(20000);
    // en de patch daarna bevat alleen de eigen wijziging
    expect(L.buildPatch(r.draft, server)).toEqual({ pollMs: 20000 });
  });

  it("marktlijsten worden samengevoegd (hier ETH weg, elders TRX erbij)", () => {
    const base = cfg();
    const draft = L.clone(base);
    draft.markets = ["BTC-EUR", "SOL-EUR", "ADA-EUR"];
    const server = L.clone(base);
    server.markets = [...base.markets, "TRX-EUR"];
    const r = L.rebaseDraft(draft, base, server);
    expect(r.draft.markets).toEqual(["BTC-EUR", "SOL-EUR", "TRX-EUR", "ADA-EUR"]);
    expect(r.conflicts).toEqual([]);
  });

  it("op beide plekken anders gewijzigd → eigen waarde houden en melden", () => {
    const base = cfg();
    const draft = L.clone(base);
    draft.risk.stopAtrMult = 3;
    const server = L.clone(base);
    server.risk.stopAtrMult = 2.5;
    const r = L.rebaseDraft(draft, base, server);
    expect(r.draft.risk.stopAtrMult).toBe(3);
    expect(r.conflicts).toEqual(["risk.stopAtrMult"]);
  });

  it("parameters die elders verwijderd zijn verdwijnen ook uit het concept", () => {
    const base = cfg();
    base.ensemble.params = { breakout: { lookback: 30 } };
    const draft = L.clone(base);
    draft.interval = "1h";
    const server = L.clone(base);
    server.ensemble.params = {};
    const r = L.rebaseDraft(draft, base, server);
    expect(r.draft.ensemble.params).toEqual({});
    expect(r.draft.interval).toBe("1h");
  });
});
