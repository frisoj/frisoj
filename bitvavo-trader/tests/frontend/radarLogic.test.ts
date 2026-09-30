/** Pure hulpfuncties van de Munten-radar (public/js/panels/radarLogic.js). */
import { describe, expect, it } from "vitest";
import { loadPublic } from "./helpers";

const L = await loadPublic("js/panels/radarLogic.js");
const { fmt } = await loadPublic("js/format.js");

type Row = Record<string, unknown>;
const row = (market: string, extra: Row = {}): Row => ({
  market,
  price: 1,
  changePct24h: null,
  volumeQuote24h: null,
  spreadPct: null,
  action: "hold",
  score: 0,
  regime: "range",
  evaluatedAt: 1,
  trendOk: null,
  status: "watching",
  ...extra,
});

const rows: Row[] = [
  row("BTC-EUR", { status: "position", score: 0.1, changePct24h: 1.5, volumeQuote24h: 9e8 }),
  row("ETH-EUR", { status: "candidate", rank: 2, score: 0.5, changePct24h: -2, volumeQuote24h: 5e8 }),
  row("SOL-EUR", { status: "candidate", rank: 1, score: 0.42, changePct24h: 8, volumeQuote24h: 3e8 }),
  row("DOGE-EUR", { status: "blocked", score: 0.6, note: "Spread te groot (0,62% > 0,30%)", changePct24h: 3, volumeQuote24h: 1e8 }),
  row("ADA-EUR", { status: "watching", score: 0.2, changePct24h: null, volumeQuote24h: 2e8 }),
  row("XRP-EUR", { status: "watching", score: -0.4, action: "sell", changePct24h: -5, volumeQuote24h: null }),
  row("LINK-EUR", { status: "pending", score: null, action: null }),
  row("DOT-EUR", { status: "error", score: null, action: null, note: "Koersdata ophalen mislukt" }),
];
const markets = (list: Row[]) => list.map((r) => r.market);

describe("status", () => {
  it("statusOf: geldige status blijft, ontbrekende volgt de actie", () => {
    expect(L.statusOf(row("A", { status: "blocked" }))).toBe("blocked");
    expect(L.statusOf({ market: "A", action: "buy" })).toBe("candidate");
    expect(L.statusOf({ market: "A", action: "sell" })).toBe("watching");
    expect(L.statusOf({ market: "A", action: "hold" })).toBe("watching");
    expect(L.statusOf({ market: "A", status: "raar", action: null })).toBe("pending");
    expect(L.statusOf(null)).toBe("pending");
  });

  it("statusView: icoon en tekst per status, rank bij koopkandidaten", () => {
    expect(L.statusView(row("A", { status: "position" }))).toMatchObject({ icon: "●", text: "In positie", tone: "accent" });
    expect(L.statusView(row("A", { status: "candidate", rank: 1 }))).toMatchObject({ icon: "#1", text: "beste kans", rank: 1 });
    expect(L.statusView(row("A", { status: "candidate", rank: 3 }))).toMatchObject({ icon: "#3", text: "koopkans", rank: 3 });
    expect(L.statusView(row("A", { status: "candidate" }))).toMatchObject({ icon: "▲", text: "Koopsignaal", rank: null });
    expect(L.statusView(row("A", { status: "blocked" }))).toMatchObject({ icon: "⛔", text: "Tegengehouden", tone: "red" });
    expect(L.statusView(row("A", { status: "watching" }))).toMatchObject({ text: "Wacht" });
    expect(L.statusView(row("A", { status: "pending" }))).toMatchObject({ text: "Nog niet bekeken" });
    expect(L.statusView(row("A", { status: "error" }))).toMatchObject({ icon: "⚠", text: "Geen data" });
    // rank 0 of onzin telt niet
    expect(L.statusView(row("A", { status: "candidate", rank: 0 })).rank).toBeNull();
  });

  it("rowNote: uitleg van de engine, anders een standaardtekst (niet bij wacht/koop)", () => {
    expect(L.rowNote(rows[3])).toBe("Spread te groot (0,62% > 0,30%)");
    expect(L.rowNote(row("A", { status: "pending" }))).toContain("nog niet bekeken");
    expect(L.rowNote(row("A", { status: "watching" }))).toBe("");
    expect(L.rowNote(row("A", { status: "candidate", rank: 1 }))).toBe("");
  });

  it("rowTitle: markt, status, score, 24u, volume, spread en uitleg", () => {
    const t = L.rowTitle(
      row("DOGE-EUR", { status: "blocked", score: 0.52, changePct24h: 2.5, volumeQuote24h: 1_200_000, spreadPct: 0.62, note: "Spread te groot" }),
    );
    expect(t).toContain("DOGE-EUR · Tegengehouden · score +0,52 · 24u +2,50%");
    expect(t).toContain("spread 0,62%");
    expect(t).toMatch(/volume € 1,2\s?mln/);
    expect(t.endsWith("— Spread te groot")).toBe(true);
    expect(L.rowTitle(row("SOL-EUR", { status: "candidate", rank: 1, score: 0.4 }))).toContain("Koopsignaal #1");
    // muntfilter
    expect(L.rowTitle(row("A-EUR", { trendOk: false }))).toContain("munt onder gemiddelde");
    expect(L.coinTrendText(row("A-EUR", { trendOk: true }))).toBe("munt boven gemiddelde");
    expect(L.coinTrendText(row("A-EUR", { trendOk: null }))).toBe("");
  });
});

describe("filteren en zoeken", () => {
  it("filters: Koopsignaal = kandidaten + tegengehouden, In positie, Tegengehouden", () => {
    expect(markets(L.filterRows(rows, "all"))).toEqual(markets(rows));
    expect(markets(L.filterRows(rows, "buy"))).toEqual(["ETH-EUR", "SOL-EUR", "DOGE-EUR"]);
    expect(markets(L.filterRows(rows, "position"))).toEqual(["BTC-EUR"]);
    expect(markets(L.filterRows(rows, "blocked"))).toEqual(["DOGE-EUR"]);
    expect(L.filterRows(null, "all")).toEqual([]);
  });

  it("zoeken: hoofdletterongevoelig, op symbool of hele markt", () => {
    expect(markets(L.filterRows(rows, "all", "btc"))).toEqual(["BTC-EUR"]);
    expect(markets(L.filterRows(rows, "all", " Doge "))).toEqual(["DOGE-EUR"]);
    expect(markets(L.filterRows(rows, "all", "eth-eur"))).toEqual(["ETH-EUR"]);
    expect(markets(L.filterRows(rows, "all", "sol/eur"))).toEqual(["SOL-EUR"]);
    expect(markets(L.filterRows(rows, "all", "o"))).toEqual(["SOL-EUR", "DOGE-EUR", "DOT-EUR"]);
    expect(L.filterRows(rows, "all", "zzz")).toEqual([]);
    // filter én zoekterm samen
    expect(markets(L.filterRows(rows, "buy", "e"))).toEqual(["ETH-EUR", "SOL-EUR", "DOGE-EUR"]);
    expect(markets(L.filterRows(rows, "buy", "do"))).toEqual(["DOGE-EUR"]);
    expect(L.matchesQuery("BTC-EUR", "")).toBe(true);
  });

  it("radarCounts: aantallen per filterknop en status", () => {
    expect(L.radarCounts(rows)).toMatchObject({
      all: 8,
      total: 8,
      buy: 3,
      position: 1,
      blocked: 1,
      candidate: 2,
      watching: 2,
      pending: 1,
      error: 1,
    });
    expect(L.radarCounts([])).toMatchObject({ all: 0, buy: 0 });
  });
});

describe("sorteren", () => {
  it("Kans: koopkandidaten op plek, dan tegengehouden, posities, wachtend (hoogste score), nog niet bekeken, fouten", () => {
    expect(markets(L.sortRows(rows, "chance"))).toEqual([
      "SOL-EUR",
      "ETH-EUR",
      "DOGE-EUR",
      "BTC-EUR",
      "ADA-EUR",
      "XRP-EUR",
      "LINK-EUR",
      "DOT-EUR",
    ]);
  });

  it("Kans: kandidaten zonder plek na die mét plek, dan op score", () => {
    const list = [
      row("A-EUR", { status: "candidate", score: 0.9 }),
      row("B-EUR", { status: "candidate", score: 0.4, rank: 2 }),
      row("C-EUR", { status: "candidate", score: 0.5 }),
    ];
    expect(markets(L.sortRows(list, "chance"))).toEqual(["B-EUR", "A-EUR", "C-EUR"]);
  });

  it("24u %: hoog → laag, zonder cijfer achteraan", () => {
    const s = markets(L.sortRows(rows, "change"));
    expect(s.slice(0, 6)).toEqual(["SOL-EUR", "DOGE-EUR", "BTC-EUR", "ETH-EUR", "XRP-EUR", "ADA-EUR"]);
  });

  it("Volume: hoog → laag, zonder volume achteraan (op naam)", () => {
    expect(markets(L.sortRows(rows, "volume"))).toEqual([
      "BTC-EUR",
      "ETH-EUR",
      "SOL-EUR",
      "ADA-EUR",
      "DOGE-EUR",
      "DOT-EUR",
      "LINK-EUR",
      "XRP-EUR",
    ]);
  });

  it("Naam: A → Z; sorteren verandert de invoer niet", () => {
    const before = markets(rows);
    expect(markets(L.sortRows(rows, "name"))).toEqual([
      "ADA-EUR",
      "BTC-EUR",
      "DOGE-EUR",
      "DOT-EUR",
      "ETH-EUR",
      "LINK-EUR",
      "SOL-EUR",
      "XRP-EUR",
    ]);
    expect(markets(rows)).toEqual(before);
  });

  it("visibleRows: filter + zoekterm + sortering", () => {
    expect(markets(L.visibleRows(rows, { filter: "buy", query: "", sort: "chance" }))).toEqual(["SOL-EUR", "ETH-EUR", "DOGE-EUR"]);
    expect(markets(L.visibleRows(rows, { filter: "all", query: "e", sort: "name" }))).toEqual(
      markets(rows)
        .filter((m) => String(m).includes("E"))
        .sort(),
    );
  });
});

describe("score → kleur en balk", () => {
  it("kleurschaal: −1 = rood, 0 = grijs, +1 = groen (themakleuren); begrensd", () => {
    expect(L.scoreColor(1)).toBe("rgb(30, 197, 128)");
    expect(L.scoreColor(-1)).toBe("rgb(242, 73, 92)");
    expect(L.scoreColor(0)).toBe("rgb(126, 136, 157)");
    expect(L.scoreColor(5)).toBe(L.scoreColor(1));
    expect(L.scoreColor(-7)).toBe(L.scoreColor(-1));
    for (const bad of [null, undefined, NaN, "x", Infinity]) expect(L.scoreColor(bad)).toBe("rgb(126, 136, 157)");
  });

  it("kleurschaal: kopen wordt groener, verkopen roder naarmate de score groter is", () => {
    const g = (s: number) => Number(/rgb\((\d+), (\d+), (\d+)\)/.exec(L.scoreColor(s))![2]);
    const r = (s: number) => Number(/rgb\((\d+), (\d+), (\d+)\)/.exec(L.scoreColor(s))![1]);
    expect(g(0.2)).toBeGreaterThan(g(0));
    expect(g(0.6)).toBeGreaterThan(g(0.2));
    expect(r(-0.2)).toBeGreaterThan(r(0));
    expect(r(-0.6)).toBeGreaterThan(r(-0.2));
    // een kleine score is al duidelijk gekleurd (niet bijna grijs)
    expect(g(0.1) - g(0)).toBeGreaterThan(10);
  });

  it("balk vanuit het midden: rechts = kopen, links = verkopen, begrensd op de halve balk", () => {
    expect(L.scoreBar(0.5)).toEqual({ left: 50, width: 25, side: "buy" });
    expect(L.scoreBar(-0.5)).toEqual({ left: 25, width: 25, side: "sell" });
    expect(L.scoreBar(3)).toEqual({ left: 50, width: 50, side: "buy" });
    expect(L.scoreBar(-3)).toEqual({ left: 0, width: 50, side: "sell" });
    expect(L.scoreBar(0)).toEqual({ left: 50, width: 0, side: "none" });
    expect(L.scoreBar(null)).toEqual({ left: 50, width: 0, side: "none" });
  });

  it("scoreText", () => {
    expect(L.scoreText(0.523)).toBe("+0,52");
    expect(L.scoreText(-0.3)).toBe("-0,30");
    expect(L.scoreText(0)).toBe("0,00");
    expect(L.scoreText(2)).toBe("+1,00");
    expect(L.scoreText(null)).toBe("–");
  });
});

describe("teksten", () => {
  it("samenvatting zoals op het scherm", () => {
    expect(L.summaryText({ count: 30, mode: "auto", buy: 4, positions: 1 })).toBe(
      "30 munten gevolgd (automatisch) · 4 koopsignalen · 1 positie",
    );
    expect(L.summaryText({ count: 1, mode: "manual", buy: 1, positions: 2 })).toBe(
      "1 munt gevolgd (zelf gekozen) · 1 koopsignaal · 2 posities",
    );
    expect(L.summaryText({ count: 3, buy: 0, positions: 0 })).toBe("3 munten gevolgd · geen koopsignalen · geen posities");
  });

  it("samenvatting van een snapshot: actieve markten, modus en posities", () => {
    const snap = {
      activeMarkets: ["BTC-EUR", "ETH-EUR", "SOL-EUR"],
      universe: { mode: "auto", count: 3, requested: 30, updatedAt: 1 },
      config: { markets: ["BTC-EUR"] },
      positions: [{ market: "BTC-EUR" }],
    };
    expect(L.snapshotSummary(snap, rows)).toBe("3 munten gevolgd (automatisch) · 3 koopsignalen · 1 positie");
    // oudere server: geen universe → zelf gekozen, config.markets
    expect(L.snapshotSummary({ config: { markets: ["A-EUR", "B-EUR"] }, positions: [] }, [])).toBe(
      "2 munten gevolgd (zelf gekozen) · geen koopsignalen · geen posities",
    );
    expect(L.universeMode({ config: { universe: { mode: "auto" } } })).toBe("auto");
  });

  it("marktfilter-badge: groen / rood / onbekend / uit / oudere server", () => {
    const mf = { market: "BTC-EUR", close: 1, sma: 1, interval: "1d", period: 50, checkedAt: 1, note: "Bitcoin staat boven …" };
    expect(L.marketFilterBadge({ ...mf, ok: true })).toEqual({
      kind: "ok",
      icon: "✓",
      text: "Bitcoin boven gemiddelde van 50 dagen — kopen mag",
      note: "Bitcoin staat boven …",
    });
    expect(L.marketFilterBadge({ ...mf, ok: false, note: "" })).toMatchObject({
      kind: "bad",
      text: "Bitcoin onder gemiddelde van 50 dagen — de bot koopt nu niet",
    });
    expect(L.marketFilterBadge({ ...mf, ok: false, note: "" }).note).toContain("Verkopen en stops gaan gewoon door");
    expect(L.marketFilterBadge({ ...mf, ok: null })).toMatchObject({ kind: "unknown", text: "Bitcoin-trend onbekend — de bot koopt nu niet" });
    expect(L.marketFilterBadge({ ...mf, ok: true, interval: "4h", period: 50 }).text).toBe(
      "Bitcoin boven gemiddelde van 200 uur — kopen mag",
    );
    expect(L.marketFilterBadge(null)).toMatchObject({ kind: "off", text: "Marktfilter uit" });
    expect(L.marketFilterBadge(undefined)).toBeNull();
  });

  it("trendPeriodText", () => {
    expect(L.trendPeriodText("1d", 50)).toBe("50 dagen");
    expect(L.trendPeriodText("1d", 1)).toBe("1 dag");
    expect(L.trendPeriodText("4h", 30)).toBe("120 uur");
  });

  it("ronde-voortgang", () => {
    expect(L.roundView({ done: 280, total: 400, roundStartedAt: 1, lastRoundCompletedAt: null, candidates: 0 })).toEqual({
      text: "Ronde: 280 van 400 munten bekeken",
      pct: 70,
      busy: true,
    });
    const at = new Date(2026, 8, 30, 14, 32).getTime();
    const done = L.roundView({ done: 400, total: 400, roundStartedAt: null, lastRoundCompletedAt: at, candidates: 4 });
    expect(done).toEqual({ text: `Ronde klaar: alle 400 munten bekeken (${fmt.time(at)})`, pct: 100, busy: false });
    expect(L.roundView({ done: 500, total: 400 }).text).toBe("Ronde klaar: alle 400 munten bekeken");
    expect(L.roundView({ done: 3, total: 400 }, false)).toMatchObject({ pct: null, busy: false });
    expect(L.roundView({ done: 3, total: 400 }, false).text).toContain("Bot staat stil");
    expect(L.roundView(undefined)).toBeNull();
    expect(L.roundView({ done: 0, total: 0 })).toBeNull();
  });
});

describe("rijen: radar of terugval", () => {
  it("radarData gebruikt snapshot.radar (zonder dubbele markten)", () => {
    const snap = { radar: [rows[0], rows[1], { ...rows[0] }, null, { price: 1 }], config: { markets: [] } };
    const res = L.radarData(snap);
    expect(res.fallback).toBe(false);
    expect(markets(res.rows)).toEqual(["BTC-EUR", "ETH-EUR"]);
  });

  it("zonder snapshot.radar: rijen uit actieve markten + posities, beslissingen en prijzen", () => {
    const snap = {
      config: { markets: ["X-EUR"] },
      activeMarkets: ["BTC-EUR", "ETH-EUR", "SOL-EUR", "ETH-EUR"],
      positions: [{ market: "ADA-EUR", currentPrice: 0.5 }],
      decisions: {
        "BTC-EUR": { market: "BTC-EUR", time: 100, price: 60000, action: "buy", score: 0.5, regime: "trend-up" },
        "ETH-EUR": { market: "ETH-EUR", time: 100, price: 3000, action: "sell", score: -0.4, regime: "range" },
      },
      prices: { "BTC-EUR": 61000 },
    };
    const { rows: fr, fallback } = L.radarData(snap);
    expect(fallback).toBe(true);
    expect(markets(fr)).toEqual(["BTC-EUR", "ETH-EUR", "SOL-EUR", "ADA-EUR"]);
    expect(fr[0]).toMatchObject({ status: "candidate", price: 61000, score: 0.5, action: "buy", evaluatedAt: 100, changePct24h: null });
    expect(fr[1]).toMatchObject({ status: "watching", price: 3000, score: -0.4 });
    expect(fr[2]).toMatchObject({ status: "pending", price: null, score: null, action: null });
    expect(fr[3]).toMatchObject({ status: "position", price: 0.5 });
  });

  it("terugval zonder activeMarkets (oudere server): config.markets", () => {
    const fr = L.fallbackRows({ config: { markets: ["A-EUR", "B-EUR"] }, decisions: {}, prices: {} });
    expect(markets(fr)).toEqual(["A-EUR", "B-EUR"]);
    expect(fr.every((r: Row) => r.status === "pending")).toBe(true);
  });

  it("terugval: nieuwere beslissing via SSE wint", () => {
    const snap = {
      config: { markets: ["A-EUR"] },
      decisions: { "A-EUR": { market: "A-EUR", time: 100, price: 1, action: "hold", score: 0 } },
    };
    const live = { "A-EUR": { market: "A-EUR", time: 200, price: 2, action: "buy", score: 0.7 } };
    expect(L.fallbackRows(snap, live)[0]).toMatchObject({ status: "candidate", score: 0.7, price: 2 });
    const older = { "A-EUR": { market: "A-EUR", time: 50, price: 2, action: "buy", score: 0.7 } };
    expect(L.fallbackRows(snap, older)[0]).toMatchObject({ status: "watching", score: 0 });
  });

  it("geen snapshot → geen rijen, geen terugvalmelding", () => {
    expect(L.radarData(null)).toEqual({ rows: [], fallback: false });
  });

  it("rowPrice: live prijs uit de snapshot, anders die van de rij", () => {
    expect(L.rowPrice(rows[0], { "BTC-EUR": 5 })).toBe(5);
    expect(L.rowPrice(rows[0], {})).toBe(1);
    expect(L.rowPrice(row("A", { price: null }), null)).toBeNull();
  });

  it("rowSig verandert als iets zichtbaars verandert", () => {
    const a = rows[1];
    expect(L.rowSig(a)).toBe(L.rowSig({ ...a }));
    expect(L.rowSig(a)).not.toBe(L.rowSig({ ...a, score: 0.51 }));
    expect(L.rowSig(a)).not.toBe(L.rowSig({ ...a, rank: 3 }));
    expect(L.rowSig(a)).not.toBe(L.rowSig({ ...a, note: "x" }));
    expect(L.rowSig(a, 1)).not.toBe(L.rowSig(a, 2));
  });

  it("baseOf en volumeText", () => {
    expect(L.baseOf("BTC-EUR")).toBe("BTC");
    expect(L.baseOf("WEIRD")).toBe("WEIRD");
    expect(L.volumeText(1_200_000)).toMatch(/^€ 1,2\s?mln\.?$/);
    expect(L.volumeText(null)).toBe("–");
  });
});

describe("botMarkets (format.js)", () => {
  it("activeMarkets ?? config.markets; nieuwere handmatige config geldt meteen", async () => {
    const { botMarkets } = await loadPublic("js/format.js");
    expect(botMarkets({ activeMarkets: ["A"], config: { markets: ["B"] } })).toEqual(["A"]);
    expect(botMarkets({ config: { markets: ["B", "B", "C"] } })).toEqual(["B", "C"]);
    expect(botMarkets(null)).toEqual([]);
    // "config-changed" met zelf gekozen munten: die lijst, niet de (oude) activeMarkets
    expect(botMarkets({ activeMarkets: ["A"], config: { markets: ["A"] } }, { markets: ["A", "D"] })).toEqual(["A", "D"]);
    // automatisch: de keuze van de bot blijft gelden
    expect(botMarkets({ activeMarkets: ["A"] }, { markets: ["Z"], universe: { mode: "auto" } })).toEqual(["A"]);
  });
});
