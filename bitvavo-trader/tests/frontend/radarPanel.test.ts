/** Stuurt het echte public/js/panels/radar.js aan met een nep-DOM (400 munten). */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { loadPublic, makeBus } from "./helpers";
import { createdCount, miniNode, resetCreated, type MiniNode } from "./miniDom";

const N = 400;
const MARKETS = Array.from({ length: N }, (_, i) => `M${String(i).padStart(3, "0")}-EUR`);

function radarRow(m: string, i: number) {
  let status = "watching";
  let rank: number | undefined;
  let note: string | undefined;
  if (i < 2) status = "position";
  else if (i < 6) {
    status = "candidate";
    rank = 6 - i; // M005 = #1 … M002 = #4
  } else if (i < 9) {
    status = "blocked";
    note = "Spread te groot (0,62% > 0,30%)";
  } else if (i >= 390) status = "pending";
  return {
    market: m,
    price: 100 + i,
    changePct24h: ((i % 21) - 10) / 2,
    volumeQuote24h: 1e9 / (i + 1),
    spreadPct: 0.1,
    action: status === "candidate" || status === "blocked" ? "buy" : "hold",
    score: status === "pending" ? null : status === "candidate" || status === "blocked" ? 0.5 : ((i % 11) - 5) / 10,
    regime: "range",
    evaluatedAt: status === "pending" ? null : 1,
    trendOk: null,
    status,
    ...(rank ? { rank } : {}),
    ...(note ? { note } : {}),
  };
}

function makeSnap(over: Record<string, unknown> = {}) {
  const radar = MARKETS.map(radarRow);
  return {
    running: true,
    config: { markets: ["M000-EUR"], interval: "15m", universe: { mode: "auto", count: N, minVolumeEur: 0 } },
    activeMarkets: MARKETS,
    positions: [{ market: "M000-EUR" }, { market: "M001-EUR" }],
    prices: Object.fromEntries(MARKETS.map((m, i) => [m, 100 + i])),
    decisions: {},
    radar,
    marketFilter: { market: "BTC-EUR", ok: true, close: 2, sma: 1, interval: "1d", period: 50, checkedAt: 1, note: "Bitcoin staat boven zijn gemiddelde." },
    universe: { mode: "auto", count: N, requested: N, updatedAt: 1 },
    scan: { done: 280, total: N, roundStartedAt: 1, lastRoundCompletedAt: null, candidates: 4 },
    ...over,
  };
}

let store: Map<string, string>;
const saved: Record<string, unknown> = {};
beforeEach(() => {
  vi.useFakeTimers();
  resetCreated();
  store = new Map();
  const g = globalThis as Record<string, unknown>;
  for (const k of ["document", "localStorage", "window"]) saved[k] = g[k];
  g.document = {
    createElement: (tag: string) => miniNode(tag),
    querySelector: () => ({}), // radar.css "is al geladen"
    head: miniNode("head"),
    hidden: false,
    addEventListener() {},
    getElementById: () => null,
  };
  g.window = { addEventListener() {} };
  g.localStorage = {
    getItem: (k: string) => (store.has(k) ? store.get(k)! : null),
    setItem: (k: string, v: string) => store.set(k, String(v)),
    removeItem: (k: string) => store.delete(k),
  };
});
afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  const g = globalThis as Record<string, unknown>;
  for (const [k, v] of Object.entries(saved)) {
    if (v === undefined) delete g[k];
    else g[k] = v;
  }
});

async function mount(initial: unknown, opts: { tab?: string; selected?: string } = {}) {
  const { mountRadar } = await loadPublic("js/panels/radar.js");
  const { fmt, esc } = await loadPublic("js/format.js");
  const parts = new Map<string, MiniNode>();
  const el = miniNode("section");
  el.querySelector = (sel: string) => {
    if (!parts.has(sel)) parts.set(sel, miniNode("div"));
    return parts.get(sel);
  };
  const bus = makeBus();
  let state = initial;
  let tab = opts.tab ?? "live";
  const selected: string[] = [];
  const ctx = {
    fmt,
    esc,
    bus,
    api: {},
    getState: () => state,
    getSelectedMarket: () => opts.selected ?? null,
    getActiveTab: () => tab,
    selectMarket: (m: string) => {
      selected.push(m);
      bus.emit("market-selected", { market: m });
    },
  };
  mountRadar(ctx, el);
  const part = (sel: string) => el.querySelector(sel);
  const grid = part('[data-rd="grid"]');
  const tiles = () => grid.children as MiniNode[];
  const order = () => tiles().map((t) => t.dataset.market as string);
  /** tekstdelen van een tegel: [symbool, 24u, prijs, score, icoon, statustekst] */
  const texts = (t: MiniNode) => {
    const [top, mid, , st] = t.children;
    return [top.children[0], top.children[1], mid.children[0], mid.children[1], st.children[0], st.children[1]].map(
      (n: MiniNode) => n.textContent as string,
    );
  };
  return {
    bus,
    el,
    part,
    grid,
    tiles,
    order,
    texts,
    selected,
    setState: (s: unknown) => {
      state = s;
    },
    setTab: (t: string) => {
      tab = t;
    },
    tileOf: (m: string) => tiles().find((t) => t.dataset.market === m),
  };
}

describe("munten-radar: 400 munten", () => {
  it("toont één tegel per munt, beste kans eerst, met samenvatting, marktfilter, ronde en tellers", async () => {
    const p = await mount(makeSnap());
    expect(p.tiles()).toHaveLength(N);
    // Kans: #1..#4, dan tegengehouden, dan posities
    expect(p.order().slice(0, 9)).toEqual([
      "M005-EUR",
      "M004-EUR",
      "M003-EUR",
      "M002-EUR",
      "M006-EUR",
      "M007-EUR",
      "M008-EUR",
      // posities: hoogste score eerst (M001 −0,4 vóór M000 −0,5)
      "M001-EUR",
      "M000-EUR",
    ]);
    expect(p.texts(p.tiles()[0])).toEqual(["M005", "-2,5%", "105,00", "+0,50", "#1", "beste kans"]);
    expect(p.tiles()[0].dataset.status).toBe("candidate");
    expect(p.texts(p.tileOf("M006-EUR"))[5]).toBe("Tegengehouden");
    expect(p.tileOf("M006-EUR").title).toContain("Spread te groot");
    expect(p.tileOf("M006-EUR").dataset.note).toBe("1");
    expect(p.texts(p.tileOf("M000-EUR"))[4]).toBe("●");
    // laatste tegels: nog niet bekeken
    expect(p.tiles()[N - 1].dataset.status).toBe("pending");

    expect(p.part('[data-rd="summary"]').textContent).toBe("400 munten gevolgd (automatisch) · 7 koopsignalen · 2 posities");
    expect(p.part('[data-rd="count"]').textContent).toBe("400");
    const mf = p.part('[data-rd="mf"]');
    expect(mf.hidden).toBe(false);
    expect(mf.dataset.kind).toBe("ok");
    expect(mf.textContent).toBe("✓ Bitcoin boven gemiddelde van 50 dagen — kopen mag");
    expect(mf.title).toContain("Bitcoin staat boven zijn gemiddelde.");
    expect(p.part('[data-rd="roundtxt"]').textContent).toBe("Ronde: 280 van 400 munten bekeken");
    expect(p.part('[data-rd="roundbar"]').style.width).toBe("70.0%");
    expect(p.part('[data-n="all"]').textContent).toBe("400");
    expect(p.part('[data-n="buy"]').textContent).toBe("7");
    expect(p.part('[data-n="position"]').textContent).toBe("2");
    expect(p.part('[data-n="blocked"]').textContent).toBe("3");
    expect(p.part('[data-rd="note"]').hidden).toBe(true);
  });

  it("scorebalk: vanuit het midden, kleur volgt de kant", async () => {
    const p = await mount(makeSnap());
    const fillOf = (m: string) => p.tileOf(m).children[2].children[0];
    // M005 = kandidaat, score +0,5
    expect(fillOf("M005-EUR").style).toMatchObject({ left: "50.0%", width: "25.0%" });
    expect(fillOf("M005-EUR").style.background).toMatch(/^rgb\(/);
    // M010: score (10 % 11 − 5) / 10 = +0,5; M011: (0 − 5)/10 = −0,5 → links van het midden
    expect(fillOf("M011-EUR").style).toMatchObject({ left: "25.0%", width: "25.0%" });
    expect(fillOf("M011-EUR").style.background).not.toBe(fillOf("M010-EUR").style.background);
  });

  it("werkt tegels bij op hun plek (geen nieuwe elementen) en tekent hooguit één keer per seconde", async () => {
    const p = await mount(makeSnap());
    const before = [...p.tiles()];
    const made = createdCount();
    const tile = p.tileOf("M200-EUR");
    expect(p.texts(tile)[2]).toBe("300,00");

    // twee snapshots vlak na elkaar (gemount op t=0): niets vóór t=1000, dan alleen de laatste
    vi.advanceTimersByTime(200);
    p.setState(makeSnap({ prices: { ...makeSnap().prices, "M200-EUR": 111 } }));
    p.bus.emit("snapshot", {});
    vi.advanceTimersByTime(300);
    p.setState(makeSnap({ prices: { ...makeSnap().prices, "M200-EUR": 123.5 } }));
    p.bus.emit("snapshot", {});
    p.bus.emit("price", { market: "M200-EUR", price: 123.5 });
    vi.advanceTimersByTime(400); // t = 900
    expect(p.texts(tile)[2]).toBe("300,00");
    vi.advanceTimersByTime(100); // t = 1000
    expect(p.texts(tile)[2]).toBe("123,50");
    expect(vi.getTimerCount()).toBe(0);

    // dezelfde elementen, in dezelfde volgorde, geen enkel nieuw element
    expect(p.tiles()).toHaveLength(N);
    expect(p.tiles().every((t: MiniNode, i: number) => t === before[i])).toBe(true);
    expect(createdCount()).toBe(made);
  });

  it("een munt die verdwijnt verliest zijn tegel; een nieuwe krijgt er één", async () => {
    const p = await mount(makeSnap());
    const snap = makeSnap();
    snap.radar = snap.radar.filter((r) => r.market !== "M300-EUR");
    snap.radar.push({ ...radarRow("NEW-EUR", 250) });
    p.setState(snap);
    p.bus.emit("snapshot", snap);
    vi.advanceTimersByTime(1000);
    expect(p.tileOf("M300-EUR")).toBeUndefined();
    expect(p.tileOf("NEW-EUR")).toBeDefined();
    expect(p.tiles()).toHaveLength(N);
  });

  it("filterknoppen, zoeken en sorteren (sortering wordt onthouden)", async () => {
    const p = await mount(makeSnap());
    const chips = p.part('[data-rd="chips"]');
    const clickChip = (f: string) => chips.fire("click", { target: { closest: () => ({ dataset: { f } }) } });

    clickChip("buy");
    expect(p.order()).toEqual(["M005-EUR", "M004-EUR", "M003-EUR", "M002-EUR", "M006-EUR", "M007-EUR", "M008-EUR"]);
    expect(p.part('[data-f="buy"]').getAttribute("aria-pressed")).toBe("true");
    expect(p.part('[data-f="all"]').getAttribute("aria-pressed")).toBe("false");
    clickChip("position");
    expect(p.order()).toEqual(["M001-EUR", "M000-EUR"]);
    clickChip("blocked");
    expect(p.order()).toEqual(["M006-EUR", "M007-EUR", "M008-EUR"]);
    clickChip("all");
    expect(p.tiles()).toHaveLength(N);

    const search = p.part('[data-rd="search"]');
    search.value = "m12";
    search.fire("input");
    expect(p.order()).toHaveLength(10); // M120..M129
    search.value = "zzz";
    search.fire("input");
    expect(p.tiles()).toHaveLength(0);
    expect(p.part('[data-rd="empty"]').hidden).toBe(false);
    expect(p.part('[data-rd="empty"]').textContent).toContain("Geen munt gevonden");
    search.value = "";
    search.fire("keydown", { key: "Escape" });
    search.value = "";
    search.fire("input");
    expect(p.tiles()).toHaveLength(N);
    expect(p.part('[data-rd="empty"]').hidden).toBe(true);

    const sort = p.part('[data-rd="sort"]');
    sort.value = "volume";
    sort.fire("change");
    expect(p.order().slice(0, 3)).toEqual(["M000-EUR", "M001-EUR", "M002-EUR"]);
    sort.value = "name";
    sort.fire("change");
    expect(p.order().slice(0, 2)).toEqual(["M000-EUR", "M001-EUR"]);
    expect(store.get("bvt-radar-sort")).toBe("name");
    sort.value = "change";
    sort.fire("change");
    expect(p.tileOf(p.order()[0]).children[0].children[1].textContent).toBe("+5,0%");
  });

  it("klik op een tegel kiest de markt en toont de uitleg (ook op de telefoon)", async () => {
    const p = await mount(makeSnap(), { selected: "M000-EUR" });
    expect(p.tileOf("M000-EUR").classList.contains("sel")).toBe(true);
    const tile = p.tileOf("M007-EUR");
    // klik op een kind van de tegel (het symbool) → closest("[data-market]") = de tegel
    p.grid.fire("click", { target: tile.children[0].children[0] });
    expect(p.selected).toEqual(["M007-EUR"]);
    expect(tile.classList.contains("sel")).toBe(true);
    expect(tile.getAttribute("aria-pressed")).toBe("true");
    expect(p.tileOf("M000-EUR").classList.contains("sel")).toBe(false);
    const detail = p.part('[data-rd="detail"]');
    expect(detail.hidden).toBe(false);
    expect(detail.innerHTML).toContain("M007-EUR");
    expect(detail.innerHTML).toContain("Tegengehouden");
    expect(detail.innerHTML).toContain("Spread te groot (0,62% &gt; 0,30%)");

    // gekozen via een ander paneel (bus)
    p.bus.emit("market-selected", { market: "M003-EUR" });
    expect(p.tileOf("M003-EUR").classList.contains("sel")).toBe(true);
    expect(tile.classList.contains("sel")).toBe(false);
    expect(detail.innerHTML).toContain("M003-EUR");
  });

  it("inklappen: onthouden, geen tegelwerk zolang ingeklapt, bij uitklappen weer bij", async () => {
    const p = await mount(makeSnap());
    const toggle = p.part('[data-rd="toggle"]');
    toggle.fire("click");
    expect(store.get("bvt-radar-collapsed")).toBe("1");
    expect(p.part('[data-rd="body"]').hidden).toBe(true);
    expect(p.el.classList.contains("is-collapsed")).toBe(true);
    expect(toggle.getAttribute("aria-expanded")).toBe("false");

    const tile = p.tileOf("M200-EUR");
    p.setState(makeSnap({ prices: { ...makeSnap().prices, "M200-EUR": 7 } }));
    p.bus.emit("snapshot", {});
    vi.advanceTimersByTime(1000);
    expect(p.texts(tile)[2]).toBe("300,00"); // niet bijgewerkt
    // samenvatting wel
    expect(p.part('[data-rd="summary"]').textContent).toContain("400 munten gevolgd");

    toggle.fire("click");
    expect(store.get("bvt-radar-collapsed")).toBe("0");
    expect(p.part('[data-rd="body"]').hidden).toBe(false);
    expect(p.texts(tile)[2]).toBe("7,000");
  });

  it("start ingeklapt als dat onthouden is", async () => {
    store.set("bvt-radar-collapsed", "1");
    const p = await mount(makeSnap());
    expect(p.part('[data-rd="body"]').hidden).toBe(true);
    expect(p.tiles()).toHaveLength(0);
  });

  it("tekent niet zolang een andere tab open is; bij terugkeer naar Live wel", async () => {
    const p = await mount(makeSnap(), { tab: "backtest" });
    expect(p.tiles()).toHaveLength(0);
    p.bus.emit("snapshot", {});
    vi.advanceTimersByTime(2000);
    expect(p.tiles()).toHaveLength(0);
    p.setTab("live");
    p.bus.emit("tab-changed", { tab: "live" });
    vi.advanceTimersByTime(1000);
    expect(p.tiles()).toHaveLength(N);
  });
});

describe("munten-radar: oudere server (geen snapshot.radar)", () => {
  const oldSnap = () => ({
    running: true,
    config: { markets: ["BTC-EUR", "ETH-EUR", "SOL-EUR"], interval: "15m" },
    positions: [{ market: "SOL-EUR", currentPrice: 150 }],
    prices: { "BTC-EUR": 60000, "ETH-EUR": 3000 },
    decisions: {
      "BTC-EUR": { market: "BTC-EUR", time: 1, price: 60000, action: "buy", score: 0.5, regime: "trend-up" },
    },
  });

  it("bouwt de tegels uit markten, beslissingen en prijzen, met een vriendelijke melding", async () => {
    const p = await mount(oldSnap());
    expect(p.order()).toEqual(["BTC-EUR", "SOL-EUR", "ETH-EUR"]);
    expect(p.tileOf("BTC-EUR").dataset.status).toBe("candidate");
    expect(p.tileOf("SOL-EUR").dataset.status).toBe("position");
    expect(p.tileOf("ETH-EUR").dataset.status).toBe("pending");
    const note = p.part('[data-rd="note"]');
    expect(note.hidden).toBe(false);
    expect(note.textContent).toContain("Eenvoudige weergave");
    expect(p.part('[data-rd="mf"]').hidden).toBe(true); // geen marketFilter-veld
    expect(p.part('[data-rd="round"]').hidden).toBe(true);
    expect(p.part('[data-rd="summary"]').textContent).toBe("3 munten gevolgd (zelf gekozen) · 1 koopsignaal · 1 positie");
  });

  it("een beslissing via SSE werkt de tegel bij", async () => {
    const p = await mount(oldSnap());
    p.bus.emit("decision", { market: "ETH-EUR", time: 2, price: 3000, action: "sell", score: -0.6, regime: "range" });
    vi.advanceTimersByTime(1000);
    expect(p.tileOf("ETH-EUR").dataset.status).toBe("watching");
    expect(p.texts(p.tileOf("ETH-EUR"))[3]).toBe("-0,60");
  });

  it("geen snapshot: laadtekst, geen fout", async () => {
    const p = await mount(null);
    expect(p.tiles()).toHaveLength(0);
    expect(p.part('[data-rd="summary"]').textContent).toBe("Munten laden…");
    expect(p.part('[data-rd="empty"]').textContent).toBe("Munten laden…");
  });
});

describe("ronde 5: uitleg van de muntkeuze (zelfde indeling als Instellingen)", () => {
  it("mislukt = waarschuwing; 'nog geen keuze' en 'opgeslagen keuze' = gewone uitleg", async () => {
    const fail = "Automatische muntkeuze mislukt: fake — de bot gebruikt je eigen lijst (3 markten)";
    const p = await mount(makeSnap({ universe: { mode: "auto", count: N, requested: N, updatedAt: null, note: fail } }));
    const note = p.part('[data-rd="note"]');
    expect(note.hidden).toBe(false);
    expect(note.textContent).toBe(fail);
    expect(note.dataset.kind).toBe("warn");

    for (const plain of [
      "Nog geen automatische keuze gemaakt: de bot gebruikt voorlopig je eigen lijst",
      "Opgeslagen automatische keuze; de bot kiest opnieuw zodra hij draait",
    ]) {
      p.setState(makeSnap({ universe: { mode: "auto", count: N, requested: N, updatedAt: null, note: plain } }));
      p.bus.emit("snapshot", makeSnap({ universe: { mode: "auto", count: N, requested: N, updatedAt: null, note: plain } }));
      vi.advanceTimersByTime(1000);
      expect(note.textContent).toBe(plain);
      expect(note.dataset.kind).toBe("info");
    }
  });
});
