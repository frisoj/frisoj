import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { beforeAll, describe, expect, it } from "vitest";
import { DEFAULT_ENGINE_CONFIG, MAX_MARKETS } from "../../src/core/defaults";
import { EXCLUDED_BASES } from "../../src/engine/universe";
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

describe("helpteksten", () => {
  it("minimale ordergrootte: beschrijft wat de bot echt doet (€5-minimum, verkoopbaar bij de stop)", () => {
    const f = L.RISK_GROUPS.flatMap((g: Fake) => g.fields).find((x: Fake) => x.key === "minOrderQuote");
    expect(f.help).toBe(
      "Kleinste bedrag waarmee de bot een positie opent. Bitvavo eist minimaal €5; de bot gebruikt altijd minstens dat, en maakt een positie bovendien zo groot dat hij bij de stop-loss nog boven €5 verkocht kan worden. Is de berekende positie kleiner, dan slaat de bot de trade over.",
    );
  });
});

// ── v2: munten (tot 400), automatische muntkeuze, trendfilter, spreadlimiet ──

describe("v2: standaardwaarden en ontbrekende velden", () => {
  it("de knop Standaardwaarden vult precies DEFAULT_ENGINE_CONFIG in; maximum 400 munten", () => {
    expect(L.FACTORY_DEFAULTS).toEqual(JSON.parse(JSON.stringify(DEFAULT_ENGINE_CONFIG)));
    expect(L.MAX_MARKETS).toBe(MAX_MARKETS);
    expect(L.MAX_MARKETS).toBe(400);
    expect(L.UNIVERSE_COUNT_PRESETS).toEqual([10, 30, 100, 400]);
  });

  it("een config zonder universe/trendFilter/maxSpreadPct betekent: zelf kiezen, geen trendfilter, geen spreadlimiet", () => {
    const old = cfg();
    delete old.universe;
    delete old.ensemble.trendFilter;
    delete old.risk.maxSpreadPct;
    const c = L.withDefaults(old);
    expect(c.universe.mode).toBe("manual");
    expect(L.trendFilterActive(c.ensemble.trendFilter)).toBe(false);
    expect(c.ensemble.trendFilter).toMatchObject({ market: false, coin: false, interval: "1d", period: 50 });
    expect(c.risk.maxSpreadPct).toBe(0);
    // en wat er wél staat blijft staan
    const cur = L.withDefaults(cfg());
    expect(cur.universe).toEqual(DEFAULT_ENGINE_CONFIG.universe);
    expect(cur.ensemble.trendFilter).toEqual(DEFAULT_ENGINE_CONFIG.ensemble.trendFilter);
    expect(cur.risk.maxSpreadPct).toBe(0.3);
  });
});

describe("v2: validatie", () => {
  const withMarkets = (n: number) => {
    const d = cfg();
    d.universe.mode = "manual";
    d.markets = Array.from({ length: n }, (_, i) => `M${i}-EUR`);
    return d;
  };

  it("zelf kiezen: 1 tot 400 munten", () => {
    expect(L.validateDraft(withMarkets(400), { fmt }).errors).toEqual([]);
    const r = L.validateDraft(withMarkets(401), { fmt });
    expect(r.errors).toContain("Je kunt hoogstens 400 munten kiezen (nu 401).");
    expect(r.invalid.has("markets")).toBe(true);
    expect(L.validateDraft(withMarkets(0), { fmt }).errors).toContain("Kies minstens één munt, of zet Munten op Automatisch.");
  });

  it("automatisch: een lege eigen lijst mag (die wordt dan niet opgeslagen)", () => {
    const d = withMarkets(0);
    d.universe.mode = "auto";
    expect(L.validateDraft(d, { fmt }).errors).toEqual([]);
    const base = cfg();
    expect(L.buildPatch(d, base)).toEqual({});
  });

  it("aantal munten 1..400 (heel getal) en minimaal volume ≥ 0, in de eenheden van het formulier", () => {
    const d = cfg();
    d.universe.count = 0;
    expect(L.validateDraft(d, { fmt }).errors).toContain("Aantal munten moet tussen 1 en 400 munten liggen.");
    d.universe.count = 401;
    expect(L.validateDraft(d, { fmt }).invalid.has("universe.count")).toBe(true);
    d.universe.count = 2.5;
    expect(L.validateDraft(d, { fmt }).errors).toContain("Aantal munten moet een heel getal zijn.");
    d.universe.count = 400;
    d.universe.minVolumeEur = -1;
    expect(L.validateDraft(d, { fmt }).errors).toContain("Minimaal 24u-volume moet tussen € 0 en € 1.000.000.000.000 liggen.");
    d.universe.minVolumeEur = NaN;
    expect(L.validateDraft(d, { fmt }).errors).toContain("Minimaal 24u-volume: vul een getal in.");
  });

  it("trendfilter: periode 5..200 in dagen of blokken van 4 uur; tijdschaal Dag of 4 uur", () => {
    const d = cfg();
    d.ensemble.trendFilter.period = 4;
    expect(L.validateDraft(d, { fmt }).errors).toContain("Periode van het trendfilter moet tussen 5 en 200 dagen liggen.");
    d.ensemble.trendFilter.interval = "4h";
    d.ensemble.trendFilter.period = 201;
    expect(L.validateDraft(d, { fmt }).errors).toContain("Periode van het trendfilter moet tussen 5 en 200 blokken van 4 uur liggen.");
    d.ensemble.trendFilter.period = 20;
    d.ensemble.trendFilter.interval = "1h";
    expect(L.validateDraft(d, { fmt }).errors).toEqual(["Kies voor het trendfilter de tijdschaal Dag of 4 uur."]);
  });

  it("max. spread: 0 = uit, anders 0..5 %", () => {
    const d = cfg();
    d.risk.maxSpreadPct = 0;
    expect(L.validateDraft(d, { fmt }).errors).toEqual([]);
    typeInto(d, "maxSpreadPct", "6");
    expect(L.validateDraft(d, { fmt }).errors).toContain("Max. spread moet tussen 0% en 5% liggen.");
    typeInto(d, "maxSpreadPct", "0,5");
    expect(d.risk.maxSpreadPct).toBe(0.5);
    expect(L.validateDraft(d, { fmt }).errors).toEqual([]);
    const f = L.RISK_GROUPS.flatMap((g: Fake) => g.fields).find((x: Fake) => x.key === "maxSpreadPct");
    expect(f.help).toMatch(/0 = uit/);
  });
});

describe("v2: buildPatch stuurt alleen gewijzigde velden van muntkeuze, trendfilter en spread", () => {
  it("universe: alleen de gewijzigde velden", () => {
    const base = cfg();
    const d = L.clone(base);
    d.universe.mode = "manual";
    expect(L.buildPatch(d, base)).toEqual({ universe: { mode: "manual" } });
    d.universe.mode = "auto";
    d.universe.count = 100;
    d.universe.minVolumeEur = 1_000_000;
    expect(L.buildPatch(d, base)).toEqual({ universe: { count: 100, minVolumeEur: 1_000_000 } });
  });

  it("ensemble.trendFilter: alleen de gewijzigde velden, naast andere ensemble-wijzigingen", () => {
    const base = cfg();
    const d = L.clone(base);
    d.ensemble.trendFilter.market = false;
    expect(L.buildPatch(d, base)).toEqual({ ensemble: { trendFilter: { market: false } } });
    d.ensemble.trendFilter.coin = true;
    d.ensemble.trendFilter.interval = "4h";
    d.ensemble.trendFilter.period = 20;
    d.ensemble.buyThreshold = 0.4;
    expect(L.buildPatch(d, base)).toEqual({
      ensemble: { buyThreshold: 0.4, trendFilter: { market: false, coin: true, interval: "4h", period: 20 } },
    });
  });

  it("risk.maxSpreadPct en een lange eigen lijst", () => {
    const base = cfg();
    const d = L.clone(base);
    d.risk.maxSpreadPct = 0.5;
    d.markets = Array.from({ length: 250 }, (_, i) => `M${i}-EUR`);
    const p = L.buildPatch(d, base);
    expect(p.risk).toEqual({ maxSpreadPct: 0.5 });
    expect(p.markets).toHaveLength(250);
    expect(p.universe).toBeUndefined();
  });
});

describe("v2: rebaseDraft met muntkeuze en trendfilter", () => {
  it("elders gewijzigd aantal munten wordt overgenomen, het eigen trendfilter blijft", () => {
    const base = cfg();
    const draft = L.clone(base);
    draft.ensemble.trendFilter.coin = true;
    const server = L.clone(base);
    server.universe.count = 100;
    const r = L.rebaseDraft(draft, base, server);
    expect(r.conflicts).toEqual([]);
    expect(r.draft.universe.count).toBe(100);
    expect(r.draft.ensemble.trendFilter.coin).toBe(true);
    expect(L.buildPatch(r.draft, server)).toEqual({ ensemble: { trendFilter: { coin: true } } });
  });

  it("op twee plekken een andere stand gekozen → eigen keuze houden en melden", () => {
    const base = cfg();
    const draft = L.clone(base);
    draft.universe.count = 10;
    const server = L.clone(base);
    server.universe.count = 400;
    server.ensemble.trendFilter.period = 100;
    const r = L.rebaseDraft(draft, base, server);
    expect(r.conflicts).toEqual(["universe.count"]);
    expect(r.draft.universe.count).toBe(10);
    expect(r.draft.ensemble.trendFilter.period).toBe(100);
  });
});

describe("v2: status van de muntkeuze", () => {
  const at = new Date(2026, 8, 30, 14, 5).getTime();
  const snap = (over: Fake = {}) => ({
    config: { ...cfg(), universe: { mode: "auto", count: 30, minVolumeEur: 250_000 } },
    activeMarkets: Array.from({ length: 30 }, (_, i) => `M${i}-EUR`),
    universe: { mode: "auto", count: 30, requested: 30, updatedAt: at },
    ...over,
  });

  it("automatisch: 'Nu actief: 30 munten, gekozen om 14:05'", () => {
    const s = L.universeStatus(snap(), "auto", fmt, at + 60_000);
    expect(s.text).toBe(`Nu actief: 30 munten, gekozen om ${fmt.time(at)}`);
    expect(fmt.time(at)).toBe("14:05");
    expect(s.pending).toBe("");
    expect(s.detail).toBe("");
  });

  it("minder munten dan gevraagd, een uitleg van de server en een nog niet opgeslagen wissel", () => {
    const s = L.universeStatus(
      snap({ universe: { mode: "auto", count: 42, requested: 100, updatedAt: at, note: "Automatische keuze mislukt: geen tickers." } }),
      "manual",
      fmt,
      at,
    );
    expect(s.text).toBe(`Nu actief: 42 munten, gekozen om ${fmt.time(at)}`);
    expect(s.detail).toContain("Je vroeg er 100, maar er voldoen er nu maar 42");
    expect(s.note).toBe("Automatische keuze mislukt: geen tickers.");
    expect(s.pending).toMatch(/^Nog niet opgeslagen\. Na Opslaan volgt de bot precies jouw eigen lijst\./);
  });

  it("zelf kiezen, nog geen automatische keuze, en een oudere server zonder universe", () => {
    const manual = snap({ config: { ...cfg(), universe: { mode: "manual", count: 30, minVolumeEur: 0 } }, universe: { mode: "manual", count: 3, requested: 3, updatedAt: null } });
    expect(L.universeStatus(manual, "manual", fmt).text).toBe("Nu actief: 3 zelfgekozen munten");
    expect(L.universeStatus(manual, "auto", fmt).pending).toMatch(/kiest de bot binnen een paar minuten zelf zijn munten/);
    const first = snap({ universe: { mode: "auto", count: 3, requested: 30, updatedAt: null } });
    const f = L.universeStatus(first, "auto", fmt);
    expect(f.text).toBe("Nu actief: 3 munten");
    expect(f.detail).toMatch(/eerste automatische keuze/);
    // nog geen keuze + uitleg van de server: gewone status, geen waarschuwing
    const note = "Nog geen automatische keuze gemaakt: de bot gebruikt voorlopig je eigen lijst";
    const n = L.universeStatus(snap({ universe: { mode: "auto", count: 3, requested: 30, updatedAt: null, note } }), "auto", fmt);
    expect(n).toMatchObject({ detail: note, note: "" });
    expect(L.universeStatus({ config: { markets: ["BTC-EUR"] } }, "manual", fmt).text).toBe("");
    expect(L.universeStatus(null, "auto", fmt)).toEqual({ text: "", detail: "", note: "", pending: "" });
  });
});

describe("ronde 5: mislukte automatische muntkeuze is een waarschuwing (UI-3)", () => {
  const at = new Date(2026, 8, 30, 14, 5).getTime();
  const fail =
    "Automatische muntkeuze mislukt: Bitvavo-fout bij GET /ticker/24h: fake — de bot gebruikt je eigen lijst (3 markten)";
  const snap = (universe: Fake) => ({
    config: { ...cfg(), universe: { mode: "auto", count: 30, minVolumeEur: 250_000 } },
    activeMarkets: ["BTC-EUR", "ETH-EUR", "SOL-EUR"],
    universe,
  });

  it("mislukt vóór de eerste keuze (updatedAt null): waarschuwing, geen 'zodra hij draait'", () => {
    const s = L.universeStatus(snap({ mode: "auto", count: 3, requested: 30, updatedAt: null, note: fail }), "auto", fmt, at);
    expect(s.text).toBe("Nu actief: 3 munten");
    expect(s.note).toBe(fail);
    expect(s.detail).toBe("");
  });

  it("opgeslagen keuze na een herstart: gewone status (ook met updatedAt), 'Je vroeg er …' blijft staan", () => {
    const saved = "Opgeslagen automatische keuze; de bot kiest opnieuw zodra hij draait";
    const s = L.universeStatus(snap({ mode: "auto", count: 20, requested: 30, updatedAt: at, note: saved }), "auto", fmt, at);
    expect(s.note).toBe("");
    expect(s.detail).toContain("Je vroeg er 30, maar er voldoen er nu maar 20");
    expect(s.detail).toContain(saved);
    const first = "Nog geen automatische keuze gemaakt: de bot gebruikt voorlopig je eigen lijst";
    expect(L.universeStatus(snap({ mode: "auto", count: 3, requested: 30, updatedAt: null, note: first }), "auto", fmt, at)).toMatchObject({
      detail: first,
      note: "",
    });
  });

  it("isPlainUniverseNote kent precies de twee statuszinnen van de engine", () => {
    expect(L.isPlainUniverseNote("Nog geen automatische keuze gemaakt: de bot gebruikt voorlopig je eigen lijst")).toBe(true);
    expect(L.isPlainUniverseNote("  Opgeslagen automatische keuze; de bot kiest opnieuw zodra hij draait")).toBe(true);
    expect(L.isPlainUniverseNote(fail)).toBe(false);
    expect(L.isPlainUniverseNote("Maar 12 munten voldoen aan de filters (…); gevraagd: 30")).toBe(false);
    expect(L.isPlainUniverseNote("")).toBe(false);
    expect(L.isPlainUniverseNote(undefined)).toBe(false);
  });

  it("zelfde teksten als de engine (src/engine/tradingEngine.ts)", () => {
    const src = readFileSync(resolve(dirname(fileURLToPath(import.meta.url)), "../../src/engine/tradingEngine.ts"), "utf8");
    // de statuszinnen van universeView → gewone status
    for (const lead of ["Opgeslagen automatische keuze", "Nog geen automatische keuze gemaakt"]) {
      const m = new RegExp(`"(${lead}[^"]*)"`).exec(src);
      expect(m, lead).not.toBeNull();
      expect(L.isPlainUniverseNote(m![1])).toBe(true);
    }
    // de andere uitleg (mislukt / te weinig munten) → waarschuwing
    const other = [...src.matchAll(/this\.universeNote\s*=[^;`"]*[`"]([^`"$]+)/g)].map((m) => m[1]);
    expect(other).toEqual(expect.arrayContaining(["Maar ", "Automatische muntkeuze mislukt: "]));
    for (const t of other) expect(L.isPlainUniverseNote(t), t).toBe(false);
  });
});

describe("v2: chips en 'Alle markten toevoegen'", () => {
  const many = Array.from({ length: 45 }, (_, i) => `C${String(i).padStart(2, "0")}-EUR`);

  it("boven 30 ingeklapt, uitklappen toont alles, zoeken toont alle treffers", () => {
    expect(L.chipsView(many)).toMatchObject({ hidden: 15, total: 45 });
    expect(L.chipsView(many).shown).toHaveLength(30);
    expect(L.chipsView(many, { expanded: true })).toMatchObject({ hidden: 0 });
    expect(L.chipsView(many, { expanded: true }).shown).toHaveLength(45);
    expect(L.chipsView(many, { query: "c4" }).shown).toEqual(["C40-EUR", "C41-EUR", "C42-EUR", "C43-EUR", "C44-EUR"]);
    expect(L.chipsView(many.slice(0, 30))).toMatchObject({ hidden: 0 });
  });

  it("voegt alle nog niet gekozen markten toe, nooit meer dan 400", () => {
    const all = Array.from({ length: 450 }, (_, i) => `A${i}-EUR`);
    const r = L.addAllMarkets(["A5-EUR", "X-EUR"], all);
    expect(r.markets).toHaveLength(400);
    expect(r.added).toBe(398);
    expect(r.markets.slice(0, 3)).toEqual(["A5-EUR", "X-EUR", "A0-EUR"]);
    expect(new Set(r.markets).size).toBe(400);
    expect(L.addAllMarkets(["A0-EUR"], ["A0-EUR", "A1-EUR"])).toEqual({ markets: ["A0-EUR", "A1-EUR"], added: 1 });
  });
});

describe("ronde 5: 'Alle markten toevoegen' zoals de automatische keuze (UI-6)", () => {
  it("EXCLUDED_BASES is gelijk aan die van de engine (src/engine/universe.ts)", () => {
    expect([...L.EXCLUDED_BASES].sort()).toEqual([...EXCLUDED_BASES].sort());
    expect(L.isExcludedMarket("USDC-EUR")).toBe(true);
    expect(L.isExcludedMarket("paxg-eur")).toBe(true);
    expect(L.isExcludedMarket("WBTC-EUR")).toBe(true);
    expect(L.isExcludedMarket("BTC-EUR")).toBe(false);
  });

  it("slaat stablecoins, goud en verpakte munten over; al gekozen exemplaren blijven staan", () => {
    const all = ["BTC-EUR", "USDC-EUR", "ETH-EUR", "PAXG-EUR", "WBTC-EUR", "EURC-EUR", "SOL-EUR"];
    expect(L.addAllMarkets([], all)).toEqual({ markets: ["BTC-EUR", "ETH-EUR", "SOL-EUR"], added: 3 });
    expect(L.addAllMarkets(["USDT-EUR"], all)).toEqual({ markets: ["USDT-EUR", "BTC-EUR", "ETH-EUR", "SOL-EUR"], added: 3 });
  });

  it("volgorde: meeste handel eerst, dan onbekend (populair, naam), dan te weinig handel, stablecoins achteraan", () => {
    const markets = ["AAA-EUR", "ILQ-EUR", "USDC-EUR", "ZZZ-EUR", "ETH-EUR", "BTC-EUR", "MID-EUR", "PAXG-EUR", "NEW-EUR"];
    const volumes = { "ZZZ-EUR": 9e6, "MID-EUR": 1e6, "ILQ-EUR": 20_000, "BTC-EUR": 5e8, "USDC-EUR": 5e7 };
    const order = L.orderMarketsForAdding(markets, { volumes, popular: ["BTC", "ETH"], minVolume: 250_000 });
    expect(order).toEqual(["BTC-EUR", "ZZZ-EUR", "MID-EUR", "ETH-EUR", "AAA-EUR", "NEW-EUR", "ILQ-EUR", "PAXG-EUR", "USDC-EUR"]);
    // ook met een Map; zonder minimum telt elk bekend volume; de rest op naam
    expect(L.orderMarketsForAdding(markets.slice(0, 6), { volumes: new Map([["ILQ-EUR", 5]]) })).toEqual([
      "ILQ-EUR",
      "AAA-EUR",
      "BTC-EUR",
      "ETH-EUR",
      "ZZZ-EUR",
      "USDC-EUR",
    ]);
    expect(L.orderMarketsForAdding(null)).toEqual([]);
  });

  it("met 435 markten en de 400-grens vallen de minst verhandelde munten af, niet de laatste in het alfabet", () => {
    const liquid = Array.from({ length: 420 }, (_, i) => `Z${String(i + 1).padStart(3, "0")}X-EUR`);
    const illiquid = Array.from({ length: 10 }, (_, i) => `ILQ${i + 1}-EUR`);
    const stable = ["USDC-EUR", "USDT-EUR", "EURC-EUR", "PAXG-EUR", "WBTC-EUR"];
    const volumes: Record<string, number> = {};
    liquid.forEach((m, i) => (volumes[m] = 8e8 / (i + 1)));
    illiquid.forEach((m) => (volumes[m] = 20_000));
    const all = L.orderMarketsForAdding([...stable, ...illiquid, ...liquid].sort(), { volumes, minVolume: 250_000 });
    const r = L.addAllMarkets([], all);
    expect(r.added).toBe(400);
    expect(r.markets).toEqual(liquid.slice(0, 400));
  });
});
