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
