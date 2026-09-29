/** Stuurt het echte public/js/panels/signals.js aan met een nep-DOM. */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fakeNode, installBrowserGlobals, loadPublic, makeBus, type Fake } from "./helpers";

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

async function mount(snap: Fake) {
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
    api: { getStrategies: () => new Promise(() => {}) },
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
