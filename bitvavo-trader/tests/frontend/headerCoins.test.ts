/** Regel "munten + marktfilter" in de kaart Bot-status (public/js/header.js). */
import { describe, expect, it, vi } from "vitest";
import { fakeNode, loadPublic, makeBus, type Fake } from "./helpers";

const { coinsLine, mountHeader } = await loadPublic("js/header.js");
const { fmt, esc } = await loadPublic("js/format.js");

const mf = (ok: boolean | null, note = "Bitcoin staat boven zijn gemiddelde") => ({
  market: "BTC-EUR",
  ok,
  close: 1,
  sma: 1,
  interval: "1d",
  period: 50,
  checkedAt: 1,
  note,
});

describe("coinsLine", () => {
  it("aantal actieve munten en de stand van het marktfilter", () => {
    const snap = { activeMarkets: Array.from({ length: 30 }, (_, i) => `M${i}-EUR`), universe: { mode: "auto" }, marketFilter: mf(true) };
    expect(coinsLine(snap)).toMatchObject({ count: 30, auto: true, filter: "ok", text: "30 munten", filterText: "kopen mag" });
    expect(coinsLine(snap).title).toContain("automatisch gekozen");
    expect(coinsLine(snap).title).toContain("Bitcoin staat boven zijn gemiddelde");
    expect(coinsLine({ ...snap, marketFilter: mf(false) })).toMatchObject({ filter: "bad", filterText: "koopt nu niet" });
    expect(coinsLine({ ...snap, marketFilter: mf(null) })).toMatchObject({ filter: "unknown", filterText: "trend onbekend" });
  });

  it("filter uit of oudere server: alleen het aantal (config.markets)", () => {
    expect(coinsLine({ config: { markets: ["BTC-EUR"] }, marketFilter: null })).toMatchObject({
      count: 1,
      auto: false,
      filter: null,
      text: "1 munt",
    });
    expect(coinsLine({ config: { markets: ["A-EUR", "B-EUR"] } }).title).toContain("zelf gekozen");
    expect(coinsLine(null)).toBeNull();
    expect(coinsLine({ config: { markets: [] } })).toBeNull();
  });

  it("wordt in de kaart Bot-status getoond", () => {
    vi.spyOn(globalThis, "setInterval").mockImplementation((() => 0) as unknown as typeof setInterval);
    const nodes: Record<string, Fake> = {};
    const statsEl = fakeNode({ querySelector: (sel: string) => (nodes[sel] ||= fakeNode()) });
    const snap = {
      running: true,
      mode: "paper",
      account: { equity: 1, cashQuote: 1 },
      config: { pollMs: 15000, risk: {}, markets: ["BTC-EUR"] },
      activeMarkets: ["BTC-EUR", "ETH-EUR"],
      marketFilter: mf(false),
      positions: [],
      trades: [],
    };
    mountHeader({ fmt, esc, api: {}, bus: makeBus(), getState: () => snap }, { statsEl, controlsEl: null, bannerEl: null });
    const el = nodes['[data-k="bot"] [data-coins]'];
    expect(el.hidden).toBe(false);
    expect(el.innerHTML).toContain("2 munten");
    expect(el.innerHTML).toContain('class="coins-mf bad"');
    expect(el.innerHTML).toContain("koopt nu niet");
    vi.restoreAllMocks();
  });
});

// Ronde 6: een groen "✓ kopen mag" naast "winst vastgezet, geen nieuwe trades tot morgen"
describe("coinsLine: handel gepauzeerd", () => {
  const snap = { activeMarkets: ["A-EUR", "B-EUR"], universe: { mode: "auto" }, marketFilter: mf(true) };

  it("winst vastgezet of dagverlieslimiet: 'gepauzeerd' (titel: tot morgen), niet 'kopen mag'", () => {
    const target = coinsLine({ ...snap, halted: { halted: true, dailyTarget: true, reason: "winst vastgezet" } });
    expect(target).toMatchObject({ filter: "paused", filterText: "gepauzeerd" });
    expect(target.title).toContain("Winst van vandaag vastgezet: de bot koopt niets meer tot morgen.");
    const loss = coinsLine({ ...snap, halted: { halted: true, dailyLimit: true } });
    expect(loss).toMatchObject({ filter: "paused", filterText: "gepauzeerd" });
    expect(loss.title).toContain("Handel gepauzeerd: de bot koopt niets meer tot morgen.");
    const other = coinsLine({ ...snap, halted: { halted: true } });
    expect(other).toMatchObject({ filter: "paused", filterText: "gepauzeerd" });
    expect(other.title).toContain("Handel gepauzeerd: de bot koopt nu niets.");
    expect(coinsLine({ ...snap, halted: { halted: false } })).toMatchObject({ filter: "ok", filterText: "kopen mag" });
  });

  it("in de kaart: geen groen vinkje", () => {
    vi.spyOn(globalThis, "setInterval").mockImplementation((() => 0) as unknown as typeof setInterval);
    const nodes: Record<string, Fake> = {};
    const statsEl = fakeNode({ querySelector: (sel: string) => (nodes[sel] ||= fakeNode()) });
    const s = {
      running: true,
      mode: "paper",
      account: { equity: 1, cashQuote: 1 },
      config: { pollMs: 15000, risk: {}, markets: ["BTC-EUR"] },
      activeMarkets: ["BTC-EUR", "ETH-EUR"],
      marketFilter: mf(true),
      halted: { halted: true, dailyTarget: true, reason: "Dagwinst teruggevallen: winst vastgezet, geen nieuwe trades tot morgen" },
      positions: [],
      trades: [],
    };
    mountHeader({ fmt, esc, api: {}, bus: makeBus(), getState: () => s }, { statsEl, controlsEl: null, bannerEl: null });
    const el = nodes['[data-k="bot"] [data-coins]'];
    expect(el.innerHTML).toContain('<span class="coins-mf paused">gepauzeerd</span>');
    expect(el.innerHTML).not.toContain("kopen mag");
    vi.restoreAllMocks();
  });
});
