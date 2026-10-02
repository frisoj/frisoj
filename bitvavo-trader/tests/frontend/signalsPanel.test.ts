/** Stuurt het echte public/js/panels/signals.js aan met een nep-DOM. */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fakeNode, installBrowserGlobals, loadPublic, makeBus, settle, type Fake } from "./helpers";

const T0 = Date.UTC(2026, 8, 29, 10, 50);
const config15 = { interval: "15m", markets: ["BTC-EUR"], ensemble: { buyThreshold: 0.35, sellThreshold: -0.3, weights: {} } };
const dec = {
  market: "BTC-EUR",
  time: Date.UTC(2026, 8, 29, 10, 30),
  score: 0.6,
  action: "buy",
  regime: "trend-up",
  confidence: 0.7,
  price: 60000,
  atr: 100,
  votes: [],
};

let env: ReturnType<typeof installBrowserGlobals>;
let now = T0;
let intervals: (() => void)[] = [];
beforeEach(() => {
  env = installBrowserGlobals();
  now = T0;
  vi.spyOn(Date, "now").mockImplementation(() => now);
  intervals = [];
  vi.spyOn(globalThis, "setInterval").mockImplementation(((fn: () => void) => {
    intervals.push(fn);
    return 0;
  }) as unknown as typeof setInterval);
});
afterEach(() => {
  vi.restoreAllMocks();
  env.restore();
});

async function mount(snap: Fake, apiOver: Fake = {}) {
  const { mountSignals } = await loadPublic("js/panels/signals.js");
  const { fmt, esc } = await loadPublic("js/format.js");
  const nodes = new Map<string, Fake>();
  const el = fakeNode({
    querySelector: (sel: string) => {
      if (!nodes.has(sel)) nodes.set(sel, fakeNode());
      return nodes.get(sel);
    },
  });
  const bus = makeBus();
  const ctx = {
    fmt,
    esc,
    bus,
    api: { getStrategies: () => new Promise(() => {}), ...apiOver },
    getState: () => snap,
    getSelectedMarket: () => "BTC-EUR",
  };
  mountSignals(ctx, el);
  return {
    bus,
    el,
    q: (sel: string) => el.querySelector(sel),
    time: () => el.querySelector(".sig-time").innerHTML as string,
    action: () => el.querySelector(".sig-action-txt").textContent as string,
  };
}

describe("signaalpaneel: verouderde en vervallen beslissingen", () => {
  it("markeert een beslissing als verouderd bij een latere snapshot met dezelfde beslissing", async () => {
    const p = await mount({ config: config15, decisions: { "BTC-EUR": dec } });
    expect(p.action()).toBe("KOOP");
    expect(p.time()).not.toContain("verouderd");

    now += 2 * 3600e3; // feed faalt: 2 uur geen nieuwe beslissing, wel snapshots per tick
    p.bus.emit("snapshot", { config: config15, decisions: { "BTC-EUR": dec } });
    env.flushRaf();
    expect(p.time()).toContain("verouderd");
  });

  it("markeert hem ook zonder nieuwe events (bot gestopt) via de periodieke hercontrole", async () => {
    const p = await mount({ config: config15, decisions: { "BTC-EUR": dec } });
    expect(p.time()).not.toContain("verouderd");
    now += 2 * 3600e3;
    expect(intervals.length).toBeGreaterThan(0);
    for (const fn of intervals) fn();
    env.flushRaf();
    expect(p.time()).toContain("verouderd");
  });

  it("verwijdert beslissingen die de engine niet meer heeft (bijv. na een intervalwissel)", async () => {
    const p = await mount({ config: config15, decisions: { "BTC-EUR": dec } });
    expect(p.action()).toBe("KOOP");
    const config1h = { ...config15, interval: "1h" };
    p.bus.emit("config-changed", config1h);
    p.bus.emit("snapshot", { config: config1h, decisions: {} });
    env.flushRaf();
    expect(p.action()).toBe("GEEN DATA");
  });

  it("een nieuwe beslissing via het decision-event wordt nog steeds getoond", async () => {
    const p = await mount({ config: config15, decisions: {} });
    expect(p.action()).toBe("GEEN DATA");
    p.bus.emit("decision", { ...dec, action: "sell", score: -0.5 });
    env.flushRaf();
    expect(p.action()).toBe("VERKOOP");
  });
});

describe("signaalpaneel: markt die niet in de bot zit", () => {
  const votesHtml = (p: Awaited<ReturnType<typeof mount>>) => String(p.q(".sig-votes").innerHTML);

  it("zegt dat de markt niet in de bot zit (i.p.v. 'wacht op de volgende candle')", async () => {
    const p = await mount({ config: config15, decisions: { "BTC-EUR": dec } });
    p.bus.emit("market-selected", { market: "DOGE-EUR" });
    env.flushRaf();
    expect(p.action()).toBe("GEEN DATA");
    expect(votesHtml(p)).toContain("Deze markt zit niet in de bot — voeg hem toe via Scanner of Instellingen");
    expect(votesHtml(p)).not.toContain("wacht op de volgende candle");
  });

  it("een markt in de bot zonder beslissing wacht nog wel op de volgende candle", async () => {
    const p = await mount({ config: { ...config15, markets: ["BTC-EUR", "ETH-EUR"] }, decisions: {} });
    p.bus.emit("market-selected", { market: "ETH-EUR" });
    env.flushRaf();
    expect(votesHtml(p)).toContain("wacht op de volgende candle");
    expect(votesHtml(p)).not.toContain("zit niet in de bot");
  });

  it("na toevoegen aan de bot (config-changed) verdwijnt de melding", async () => {
    const p = await mount({ config: config15, decisions: {} });
    p.bus.emit("market-selected", { market: "ETH-EUR" });
    env.flushRaf();
    expect(votesHtml(p)).toContain("zit niet in de bot");
    p.bus.emit("config-changed", { ...config15, markets: ["BTC-EUR", "ETH-EUR"] });
    env.flushRaf();
    expect(votesHtml(p)).not.toContain("zit niet in de bot");
    p.bus.emit("decision", { ...dec, market: "ETH-EUR", action: "sell", score: -0.5 });
    env.flushRaf();
    expect(p.action()).toBe("VERKOOP");
  });
});

describe("signaalpaneel: exit-score", () => {
  it("toont de exit-score als tweede markering op de meter en als waarde", async () => {
    // score dicht bij 0 (veel WACHT), maar de strategieën met een mening zeggen samen VERKOOP
    const p = await mount({ config: config15, decisions: { "BTC-EUR": { ...dec, score: -0.12, exitScore: -0.45, action: "sell" } } });
    expect(p.q(".sig-exit").style.display).toBe("");
    expect(p.q(".sig-exit").style.transform).toBe(`rotate(${((-0.45 + 1) / 2) * 180}deg)`);
    expect(p.q(".sig-exit-mark").dataset.a).toBe("sell");
    expect(p.q(".sig-exit-row").hidden).toBe(false);
    expect(p.q(".sig-exit-val").textContent).toBe("-0,45");
    // de wijzer blijft de gewone score
    expect(p.q(".sig-ptr").style.transform).toBe(`rotate(${((-0.12 + 1) / 2) * 180}deg)`);
  });

  it("boven de verkoopdrempel: markering neutraal", async () => {
    const p = await mount({ config: config15, decisions: { "BTC-EUR": { ...dec, exitScore: 0.6 } } });
    expect(p.q(".sig-exit-mark").dataset.a).toBe("hold");
    expect(p.q(".sig-exit-val").textContent).toBe("+0,60");
  });

  it("zonder exitScore (oudere server) geen tweede markering", async () => {
    const p = await mount({ config: config15, decisions: { "BTC-EUR": dec } });
    expect(p.q(".sig-exit").style.display).toBe("none");
    expect(p.q(".sig-exit-row").hidden).toBe(true);
  });

  it("een gewijzigde exit-score in een nieuwe beslissing wordt opnieuw getekend", async () => {
    const p = await mount({ config: config15, decisions: { "BTC-EUR": { ...dec, exitScore: 0.2 } } });
    p.bus.emit("decision", { ...dec, exitScore: -0.5 });
    env.flushRaf();
    expect(p.q(".sig-exit-val").textContent).toBe("-0,50");
  });

  it("de uitleg noemt de exit-score van de strategieën mét een mening", async () => {
    const p = await mount({ config: config15, decisions: {} });
    const help = String(p.el.innerHTML).replace(/\s+/g, " ");
    expect(help).toContain("Verkopen gaat op de <b>exit-score</b>");
    expect(help).toContain("alléén de strategieën die wél een mening hebben");
    expect(help).toContain("onder de verkoopdrempel");
  });
});

describe("signaalpaneel: veel munten (v2) — ontbrekende beslissing ophalen", () => {
  const many = Array.from({ length: 50 }, (_, i) => `M${String(i).padStart(2, "0")}-EUR`);
  const v2Snap = (decisions: Fake = {}, extra: Fake = {}) => ({
    config: { ...config15, markets: ["BTC-EUR"], universe: { mode: "auto", count: 50, minVolumeEur: 0 } },
    activeMarkets: many,
    positions: [],
    decisions,
    ...extra,
  });
  const decFor = (market: string, over: Fake = {}) => ({ ...dec, market, ...over });
  const votesHtml = (p: Awaited<ReturnType<typeof mount>>) => String(p.q(".sig-votes").innerHTML);
  const ApiErr = (status: number) => Object.assign(new Error("Onbekende route"), { status });

  it("haalt de beslissing op met GET /api/decision en toont hem", async () => {
    const getDecision = vi.fn(async (m: string) => ({ decision: decFor(m, { action: "buy", score: 0.55 }) }));
    const p = await mount(v2Snap(), { getDecision });
    p.bus.emit("market-selected", { market: "M45-EUR" });
    env.flushRaf();
    expect(getDecision).toHaveBeenCalledWith("M45-EUR");
    expect(p.action()).toBe("GEEN DATA");
    expect(votesHtml(p)).toContain("ophalen");
    await settle();
    env.flushRaf();
    expect(p.action()).toBe("KOOP");
  });

  it("houdt een opgehaalde beslissing vast als de volgende snapshot hem niet bevat (> 40 munten)", async () => {
    const getDecision = vi.fn(async (m: string) => ({ decision: decFor(m) }));
    const p = await mount(v2Snap(), { getDecision });
    p.bus.emit("market-selected", { market: "M45-EUR" });
    env.flushRaf();
    await settle();
    env.flushRaf();
    expect(p.action()).toBe("KOOP");
    p.bus.emit("snapshot", v2Snap({ "M00-EUR": decFor("M00-EUR") }));
    env.flushRaf();
    expect(p.action()).toBe("KOOP");
    expect(getDecision).toHaveBeenCalledTimes(1);
    // en blijft bij met de decision-events
    p.bus.emit("decision", decFor("M45-EUR", { action: "sell", score: -0.5, time: dec.time + 900_000 }));
    env.flushRaf();
    expect(p.action()).toBe("VERKOOP");
    // een markt die de bot niet meer volgt vervalt wel
    p.bus.emit("snapshot", v2Snap({}, { activeMarkets: many.filter((m) => m !== "M45-EUR") }));
    env.flushRaf();
    expect(p.action()).toBe("GEEN DATA");
  });

  it("null = nog niet beoordeeld: vriendelijke tekst, niet meteen opnieuw vragen", async () => {
    const getDecision = vi.fn(async () => ({ decision: null }));
    const p = await mount(v2Snap(), { getDecision });
    p.bus.emit("market-selected", { market: "M45-EUR" });
    env.flushRaf();
    await settle();
    env.flushRaf();
    expect(p.action()).toBe("GEEN DATA");
    expect(votesHtml(p)).toContain("M45-EUR is nog niet beoordeeld");
    expect(votesHtml(p)).toContain("wacht op de volgende candle");
    for (let i = 0; i < 3; i++) {
      p.bus.emit("snapshot", v2Snap());
      env.flushRaf();
    }
    expect(getDecision).toHaveBeenCalledTimes(1);
    // na een minuut wel opnieuw
    now += 61_000;
    p.bus.emit("snapshot", v2Snap());
    env.flushRaf();
    expect(getDecision).toHaveBeenCalledTimes(2);
  });

  it("radar meldt dat de markt beoordeeld is → meteen opnieuw vragen (na minstens 10 s)", async () => {
    let answer: Fake = { decision: null };
    const getDecision = vi.fn(async () => answer);
    const p = await mount(v2Snap(), { getDecision });
    p.bus.emit("market-selected", { market: "M45-EUR" });
    env.flushRaf();
    await settle();
    answer = { decision: decFor("M45-EUR", { action: "sell", score: -0.4 }) };
    now += 12_000;
    p.bus.emit("snapshot", v2Snap({}, { radar: [{ market: "M45-EUR", status: "watching", evaluatedAt: dec.time }] }));
    await settle();
    env.flushRaf();
    expect(getDecision).toHaveBeenCalledTimes(2);
    expect(p.action()).toBe("VERKOOP");
  });

  it("oudere server zonder /api/decision (404): standaardtekst en niet blijven proberen", async () => {
    const getDecision = vi.fn(async () => {
      throw ApiErr(404);
    });
    const p = await mount(v2Snap(), { getDecision });
    p.bus.emit("market-selected", { market: "M45-EUR" });
    env.flushRaf();
    await settle();
    env.flushRaf();
    expect(votesHtml(p)).toContain("Nog geen beslissing voor M45-EUR");
    p.bus.emit("market-selected", { market: "M46-EUR" });
    env.flushRaf();
    now += 120_000;
    p.bus.emit("snapshot", v2Snap());
    env.flushRaf();
    expect(getDecision).toHaveBeenCalledTimes(1);
  });

  it("automatische muntkeuze: markt buiten de keuze → uitleg dat de bot zelf kiest, niets ophalen", async () => {
    const getDecision = vi.fn(async () => ({ decision: null }));
    const p = await mount(v2Snap(), { getDecision });
    p.bus.emit("market-selected", { market: "DOGE-EUR" });
    env.flushRaf();
    expect(votesHtml(p)).toContain("de bot kiest zelf de munten");
    expect(getDecision).not.toHaveBeenCalled();
  });

  it("markt met een open positie buiten de actieve munten telt als 'in de bot'", async () => {
    const getDecision = vi.fn(async (m: string) => ({ decision: decFor(m) }));
    const p = await mount(v2Snap({}, { positions: [{ market: "OLD-EUR" }] }), { getDecision });
    p.bus.emit("market-selected", { market: "OLD-EUR" });
    env.flushRaf();
    await settle();
    env.flushRaf();
    expect(getDecision).toHaveBeenCalledWith("OLD-EUR");
    expect(p.action()).toBe("KOOP");
  });
});
