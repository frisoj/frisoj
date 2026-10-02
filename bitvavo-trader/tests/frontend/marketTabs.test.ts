/** Marktbalk met veel munten (public/js/liveChart.js): welke tabs, en zoeken in "Alle munten". */
import { describe, expect, it, vi } from "vitest";
import { type Fake, fakeNode, installBrowserGlobals, loadPublic, makeBus, settle } from "./helpers";

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

// ───────────── Ronde 5: gekozen tab in beeld (UI-1) en toetsenbordfocus (UI-2) ─────────────

const { revealDelta, REVEAL_PAD } = await loadPublic("js/liveChart.js");
/** De nep-`document` van installBrowserGlobals */
const fakeDoc = (): Fake => (globalThis as unknown as { document: Fake }).document;

describe("revealDelta (hoeveel de marktbalk moet schuiven)", () => {
  const strip = { left: 10, right: 267 }; // telefoon (390 px) met de knop "Alle munten" ernaast

  it("staat de tab ruim in beeld: niet schuiven", () => {
    expect(revealDelta(strip, { left: 50, right: 200 })).toBe(0);
    expect(REVEAL_PAD).toBeGreaterThanOrEqual(32); // de vervaagde rand is 32 px
  });

  it("rechts buiten beeld: zo ver schuiven dat hij helemaal zichtbaar is (met wat ruimte als dat past)", () => {
    const tab = { left: 433, right: 633 }; // uit de review: Z250X na een keuze in de radar
    const d = revealDelta(strip, tab);
    expect(tab.left - d).toBeGreaterThanOrEqual(strip.left);
    expect(tab.right - d).toBeLessThanOrEqual(strip.right);
    // breed genoeg voor ruimte aan één kant: 257 − 200 = 57 → (57/2) px ruimte rechts
    expect(tab.right - d).toBeCloseTo(strip.right - 28.5, 5);
  });

  it("links buiten beeld: negatief (naar links schuiven)", () => {
    const d = revealDelta({ left: 16, right: 895 }, { left: -150, right: 40 });
    expect(d).toBe(-150 - 16 - REVEAL_PAD);
  });

  it("tab breder dan de balk: linkerkant in beeld houden; ongeldige invoer → 0", () => {
    const d = revealDelta({ left: 0, right: 100 }, { left: 300, right: 450 });
    expect(300 - d).toBe(0);
    expect(revealDelta(null, { left: 0, right: 1 })).toBe(0);
    expect(revealDelta({ left: 0, right: NaN }, { left: 0, right: 1 })).toBe(0);
  });
});

/**
 * Nep-marktbalk met een eenvoudige lay-out: tabs van 168 px zolang er nog geen prijs in staat
 * ("–") en 180 px met prijs, 8 px ertussen; de balk is 370 px breed zolang de knop "Alle munten"
 * verborgen is en 257 px als hij zichtbaar is (zoals gemeten op 390 px in de review).
 */
function fakeMarketBar() {
  const doc = fakeDoc();
  const allWrap = fakeNode({ hidden: true });
  const allBtn = fakeNode({
    setAttribute() {},
    focus() {
      doc.activeElement = allBtn;
    },
  });
  const popQ = fakeNode({ value: "", setAttribute() {}, removeAttribute() {}, focus() {} });
  const pop = fakeNode({ hidden: true, contains: (n: unknown) => n === popQ });
  const popList = fakeNode({ scrollTop: 0 });
  const popMeta = fakeNode();
  let scrollLeft = 0;
  let tabs: Fake[] = [];
  const LEFT = 10;
  const width = (t: Fake) => (t.price.textContent && t.price.textContent !== "–" ? 180 : 168);
  const stripWidth = () => (allWrap.hidden ? 370 : 257);
  const scrollWidth = () => tabs.reduce((s, t, i) => s + width(t) + (i ? 8 : 0), 0);
  const clamp = (v: number) => Math.max(0, Math.min(Math.max(0, scrollWidth() - stripWidth()), v));
  const tabRect = (t: Fake) => {
    let x = LEFT - scrollLeft;
    for (const o of tabs) {
      if (o === t) break;
      x += width(o) + 8;
    }
    return { left: x, right: x + width(t) };
  };
  const strip: Fake = fakeNode({
    getBoundingClientRect: () => ({ left: LEFT, right: LEFT + stripWidth() }),
    contains: (n: unknown) => tabs.includes(n as Fake),
    querySelector: (sel: string) => (sel === ".mkt-tab.active" ? tabs.find((t) => t.active) || null : null),
    querySelectorAll: (sel: string) => (sel === "[data-market]" ? tabs : []),
  });
  // (getters niet via fakeNode({...}) meegeven: die worden daar tot vaste waarden)
  Object.defineProperties(strip, {
    scrollLeft: {
      get: () => scrollLeft,
      set: (v: number) => {
        scrollLeft = clamp(v);
      },
    },
    scrollWidth: { get: scrollWidth },
    clientWidth: { get: stripWidth },
  });
  let html = "";
  Object.defineProperty(strip, "innerHTML", {
    get: () => html,
    set(v: string) {
      html = String(v);
      // Nieuwe tabs (zoals de browser ze uit de HTML zou maken)
      tabs = [...html.matchAll(/class="mkt-tab( active)?[^"]*"\s+data-market="([^"]+)"/g)].map((m) => {
        const t: Fake = fakeNode({
          active: !!m[1],
          dataset: { market: m[2] },
          price: fakeNode({ textContent: "–" }),
          focus() {
            doc.activeElement = t;
          },
        });
        const parts: Record<string, Fake> = { "[data-p]": t.price, "[data-c]": fakeNode(), "[data-s]": fakeNode(), "[data-f]": fakeNode() };
        t.querySelector = (sel: string) => parts[sel] || null;
        t.closest = (sel: string) => (sel === "[data-market]" ? t : null);
        t.getBoundingClientRect = () => tabRect(t);
        return t;
      });
    },
  });
  const parts: Record<string, Fake> = {
    "[data-strip]": strip,
    "[data-allwrap]": allWrap,
    "[data-all]": allBtn,
    "[data-all-n]": fakeNode(),
    "[data-pop]": pop,
    "[data-pop-q]": popQ,
    "[data-pop-meta]": popMeta,
    "[data-pop-list]": popList,
  };
  const tabsEl = fakeNode({ querySelector: (sel: string) => parts[sel] || null });
  return {
    tabsEl,
    strip,
    allWrap,
    allBtn,
    popQ,
    tabs: () => tabs,
    active: () => tabs.find((t) => t.active) || null,
    /** Staat de gekozen tab helemaal in beeld (met de lay-out van dit moment)? */
    activeVisible() {
      const t = tabs.find((x) => x.active);
      if (!t) return false;
      const r = tabRect(t);
      return r.left >= LEFT - 0.5 && r.right <= LEFT + stripWidth() + 0.5;
    },
  };
}

/** Nep-grafiekbibliotheek: elk veld en elke aanroep geeft weer hetzelfde nep-object (genoeg om te mounten) */
function fakeCharts() {
  const any: Fake = new Proxy(function () {}, {
    get: (_t, k) => (k === "then" || k === Symbol.iterator ? undefined : k === Symbol.toPrimitive ? () => 0 : any),
    apply: () => any,
  });
  return any; // createChart, createSeriesMarkers, LineStyle … : allemaal hetzelfde nep-object
}

/** Nep-container waarin elk gezocht element bestaat (werkbalk, grafiekvlakken) */
function looseEl(): Fake {
  const kids: Record<string, Fake> = {};
  const el: Fake = fakeNode({
    querySelector: (sel: string) => (kids[sel] ||= looseEl()),
    querySelectorAll: () => [],
    removeAttribute() {},
    getAttribute: () => null,
  });
  el.style = { setProperty() {}, removeProperty() {} };
  return el;
}

describe("marktbalk: gekozen munt in beeld en focus (ronde 5)", () => {
  async function mountBar(selected: string) {
    const env = installBrowserGlobals();
    vi.spyOn(globalThis, "setInterval").mockImplementation((() => 0) as unknown as typeof setInterval);
    Object.assign(fakeDoc(), { addEventListener() {}, removeEventListener() {} });
    const { mountLiveChart } = await loadPublic("js/liveChart.js");
    const { fmt, esc } = await loadPublic("js/format.js");
    const bus = makeBus();
    const bar = fakeMarketBar();
    const prices = Object.fromEntries(many.map((m, i) => [m, 1 + i / 1000]));
    const snap = { config: { markets: ["BTC-EUR"], interval: "15m" }, activeMarkets: many, positions: [], prices, radar: [] };
    let sel = selected;
    bus.on("market-selected", (d: unknown) => {
      sel = (d as { market: string }).market;
    });
    const els = { tabsEl: bar.tabsEl, ...Object.fromEntries(["toolbarEl", "stackEl", "mainEl", "rsiEl", "macdEl"].map((k) => [k, looseEl()])) };
    const getCandles = vi.fn(async () => ({ candles: [] }));
    mountLiveChart(
      { api: { getCandles }, bus, fmt, esc, theme: {}, getState: () => snap, getSelectedMarket: () => sel, LightweightCharts: fakeCharts() },
      els,
    );
    return { env, bus, bar, snap };
  }

  it("schuift pas na het invullen van prijzen en de knop 'Alle munten' (anders viel de tab op een telefoon buiten beeld)", async () => {
    const { env, bus, bar, snap } = await mountBar("C150-EUR");
    try {
      bus.emit("snapshot", snap);
      // de gekozen markt staat achteraan (12e tab); de knop "Alle munten" is nu zichtbaar
      expect(bar.tabs().map((t: Fake) => t.dataset.market).at(-1)).toBe("C150-EUR");
      expect(bar.allWrap.hidden).toBe(false);
      expect(bar.active().price.textContent).not.toBe("–");
      // nog niet gemeten: dat gebeurt in de volgende frame, met de uiteindelijke breedtes
      expect(bar.strip.scrollLeft).toBe(0);
      env.flushRaf();
      expect(bar.activeVisible()).toBe(true);

      // een munt kiezen die nog geen tab had (bijv. via de radar): ook die komt in beeld
      bar.strip.scrollLeft = 0;
      bus.emit("market-selected", { market: "C333-EUR" });
      env.flushRaf();
      expect(bar.active().dataset.market).toBe("C333-EUR");
      expect(bar.activeVisible()).toBe(true);

      // gekozen terwijl Live verborgen was: bij terugkeer naar Live opnieuw in beeld
      bar.strip.scrollLeft = 0;
      expect(bar.activeVisible()).toBe(false);
      bus.emit("tab-changed", { tab: "live" });
      env.flushRaf();
      expect(bar.activeVisible()).toBe(true);
    } finally {
      vi.restoreAllMocks();
      env.restore();
    }
  });

  it("Enter op een tab: de focus blijft op die tab (niet op <body>)", async () => {
    const { env, bus, bar, snap } = await mountBar("C000-EUR");
    try {
      bus.emit("snapshot", snap);
      const target = bar.tabs().find((t: Fake) => t.dataset.market === "C005-EUR");
      target.focus();
      bar.strip.fire("click", { target });
      const doc = fakeDoc();
      expect(bar.active().dataset.market).toBe("C005-EUR");
      // de balk is opnieuw getekend (nieuwe elementen); de focus staat op de nieuwe tab
      expect(bar.tabs()).not.toContain(target);
      expect(doc.activeElement).toBe(bar.active());
    } finally {
      vi.restoreAllMocks();
      env.restore();
    }
  });

  it("'Alle munten' met het toetsenbord: na Enter staat de focus op de tab van de gekozen munt", async () => {
    const { env, bus, bar, snap } = await mountBar("C000-EUR");
    try {
      bus.emit("snapshot", snap);
      bar.allBtn.fire("click", {});
      const doc = fakeDoc();
      bar.popQ.focus = () => {
        doc.activeElement = bar.popQ;
      };
      bar.popQ.focus();
      bar.popQ.value = "c20";
      bar.popQ.fire("input", {});
      bar.popQ.fire("keydown", { key: "ArrowDown", preventDefault() {} });
      bar.popQ.fire("keydown", { key: "Enter", preventDefault() {} });
      expect(bar.active().dataset.market).toBe("C201-EUR");
      expect(doc.activeElement).toBe(bar.active());
    } finally {
      vi.restoreAllMocks();
      env.restore();
    }
  });
});
