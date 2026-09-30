/** Marktbalk met veel munten (public/js/liveChart.js): welke tabs, en zoeken in "Alle munten". */
import { describe, expect, it, vi } from "vitest";
import { fakeNode, installBrowserGlobals, loadPublic, makeBus, settle } from "./helpers";

const { pickTabMarkets, filterMarketList, MAX_TABS } = await loadPublic("js/liveChart.js");

const many = Array.from({ length: 400 }, (_, i) => `C${String(i).padStart(3, "0")}-EUR`);
const cand = (market: string, rank: number, status = "candidate") => ({ market, rank, status });

describe("pickTabMarkets", () => {
  it("maximaal 12 tabs", () => {
    expect(MAX_TABS).toBe(12);
    const r = pickTabMarkets({ active: many });
    expect(r.tabs).toHaveLength(12);
    expect(r.tabs).toEqual(many.slice(0, 12));
    expect(r.hidden).toBe(388);
    expect(r.total).toBe(400);
    expect(r.extra).toEqual([]);
  });

  it("weinig markten: alles, in de volgorde van de bot (zoals vroeger), plus een losse gekozen markt", () => {
    const active = ["BTC-EUR", "ETH-EUR", "SOL-EUR"];
    expect(pickTabMarkets({ active, selected: "ETH-EUR", positions: ["SOL-EUR"] })).toEqual({
      tabs: active,
      extra: [],
      hidden: 0,
      total: 3,
    });
    expect(pickTabMarkets({ active, selected: "DOGE-EUR" })).toEqual({
      tabs: [...active, "DOGE-EUR"],
      extra: ["DOGE-EUR"],
      hidden: 0,
      total: 3,
    });
    // positie in een markt die de bot niet (meer) volgt: toch een tab (geen "extra")
    expect(pickTabMarkets({ active, positions: ["ADA-EUR"] }).tabs).toEqual([...active, "ADA-EUR"]);
  });

  it("veel markten: gekozen markt, posities, beste kansen (rank), dan de volgorde van de bot", () => {
    const radar = [
      cand("C300-EUR", 2),
      cand("C200-EUR", 1),
      cand("C250-EUR", 3, "blocked"),
      { market: "C399-EUR", rank: 1, status: "watching" }, // rank van een oude ronde: telt niet
      { market: "C398-EUR", status: "candidate" }, // zonder rank: geen voorrang
    ];
    const r = pickTabMarkets({ active: many, selected: "C150-EUR", positions: ["C100-EUR", "C101-EUR"], radar });
    expect(r.tabs).toHaveLength(12);
    // vaste weergavevolgorde: posities, kansen op rank, dan botvolgorde (de gekozen markt op zijn plek)
    expect(r.tabs).toEqual([
      "C100-EUR",
      "C101-EUR",
      "C200-EUR",
      "C300-EUR",
      "C250-EUR",
      "C000-EUR",
      "C001-EUR",
      "C002-EUR",
      "C003-EUR",
      "C004-EUR",
      "C005-EUR",
      "C150-EUR",
    ]);
    expect(r.hidden).toBe(388);
    expect(r.extra).toEqual([]);
  });

  it("een klik op een zichtbare tab verandert de set niet", () => {
    const opts = { active: many, positions: ["C100-EUR"], radar: [cand("C200-EUR", 1)] };
    const a = pickTabMarkets({ ...opts, selected: "C000-EUR" });
    const b = pickTabMarkets({ ...opts, selected: "C003-EUR" });
    expect(b.tabs).toEqual(a.tabs);
  });

  it("gekozen markt buiten de bot bij veel markten: achteraan, als extra", () => {
    const r = pickTabMarkets({ active: many, selected: "XYZ-EUR" });
    expect(r.tabs).toHaveLength(12);
    expect(r.tabs[11]).toBe("XYZ-EUR");
    expect(r.extra).toEqual(["XYZ-EUR"]);
    expect(r.tabs.slice(0, 11)).toEqual(many.slice(0, 11));
  });

  it("meer posities dan tabs: gekozen markt eerst, dan zoveel posities als passen", () => {
    const positions = many.slice(50, 70);
    const r = pickTabMarkets({ active: many, positions, selected: "C001-EUR", max: 5 });
    expect(r.tabs).toEqual(["C050-EUR", "C051-EUR", "C052-EUR", "C053-EUR", "C001-EUR"]);
  });

  it("ontdubbelt, negeert rommel en werkt zonder invoer", () => {
    expect(pickTabMarkets({ active: ["A-EUR", "A-EUR", null, "", "B-EUR"] }).tabs).toEqual(["A-EUR", "B-EUR"]);
    expect(pickTabMarkets()).toEqual({ tabs: [], extra: [], hidden: 0, total: 0 });
    expect(pickTabMarkets({ active: [], selected: "BTC-EUR" }).tabs).toEqual(["BTC-EUR"]);
  });
});

describe("filterMarketList (zoeken in Alle munten)", () => {
  const list = ["BTC-EUR", "ETH-EUR", "DOGE-EUR", "DOT-EUR", "LDO-EUR", "SOL-EUR", "WBTC-EUR"];

  it("lege zoekterm: alles in dezelfde volgorde (nieuwe lijst)", () => {
    const r = filterMarketList(list, "  ");
    expect(r).toEqual(list);
    expect(r).not.toBe(list);
  });

  it("exact symbool eerst, dan 'begint met', dan 'bevat'", () => {
    expect(filterMarketList(list, "btc")).toEqual(["BTC-EUR", "WBTC-EUR"]);
    expect(filterMarketList(list, "do")).toEqual(["DOGE-EUR", "DOT-EUR", "LDO-EUR"]);
    expect(filterMarketList(list, "dot")).toEqual(["DOT-EUR"]);
    expect(filterMarketList(list, "eth-eur")).toEqual(["ETH-EUR"]);
    expect(filterMarketList(list, "sol/eur")).toEqual(["SOL-EUR"]);
    expect(filterMarketList(list, "xyz")).toEqual([]);
    expect(filterMarketList(null, "a")).toEqual([]);
  });
});

describe("marktbalk: 24u-cijfers alleen voor zichtbare tabs", () => {
  it("met 400 munten hooguit 12 verzoeken; een nieuwe koopkans haalt alleen die tab op", async () => {
    const env = installBrowserGlobals();
    vi.spyOn(globalThis, "setInterval").mockImplementation((() => 0) as unknown as typeof setInterval);
    try {
      const { mountLiveChart } = await loadPublic("js/liveChart.js");
      const { fmt, esc } = await loadPublic("js/format.js");
      const bus = makeBus();
      const getCandles = vi.fn(async (market: string, _interval?: string, _limit?: number) => ({
        market,
        candles: [{ time: 0, open: 1, high: 2, low: 0.5, close: 1.5, volume: 10 }],
      }));
      let snap: Record<string, unknown> = {
        config: { markets: ["BTC-EUR"], interval: "15m" },
        activeMarkets: many,
        positions: [],
        prices: {},
        radar: [],
      };
      const els = Object.fromEntries(["tabsEl", "toolbarEl", "stackEl", "mainEl", "rsiEl", "macdEl"].map((k) => [k, fakeNode()]));
      // geen grafiekbibliotheek (window.LightweightCharts undefined): de marktbalk werkt toch
      mountLiveChart(
        { api: { getCandles }, bus, fmt, esc, theme: {}, getState: () => snap, getSelectedMarket: () => "C000-EUR" },
        els,
      );
      bus.emit("snapshot", snap);
      await settle();
      expect(getCandles.mock.calls.length).toBeLessThanOrEqual(12);
      expect(getCandles.mock.calls.map((c) => c[0])).toEqual(many.slice(0, 12));
      expect(getCandles.mock.calls.every((c) => c[1] === "1h")).toBe(true);

      // zelfde tabs: niets opnieuw ophalen
      bus.emit("snapshot", snap);
      await settle();
      expect(getCandles).toHaveBeenCalledTimes(12);

      // nieuwe koopkans op plek 1: alleen die markt erbij
      snap = { ...snap, radar: [{ market: "C321-EUR", rank: 1, status: "candidate" }] };
      bus.emit("snapshot", snap);
      await settle();
      expect(getCandles).toHaveBeenCalledTimes(13);
      expect(getCandles.mock.calls[12][0]).toBe("C321-EUR");
      // de balk zelf: 12 tabs, de koopkans erin
      const html = String(els.tabsEl.innerHTML);
      expect(html.match(/class="mkt-tab/g)).toHaveLength(12);
      expect(html).toContain('data-market="C321-EUR"');
      expect(html).not.toContain('data-market="C011-EUR"');
    } finally {
      vi.restoreAllMocks();
      env.restore();
    }
  });
});
