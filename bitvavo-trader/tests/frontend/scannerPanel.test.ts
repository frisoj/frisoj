/**
 * Stuurt het echte public/js/panels/scanner.js aan met een nep-DOM (v2): in de
 * automatische muntkeuze legt "toevoegen" uit dat de bot zelf kiest en biedt het
 * overschakelen naar "Zelf kiezen" aan (met bevestiging).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_ENGINE_CONFIG } from "../../src/core/defaults";
import { fakeNode, installBrowserGlobals, loadPublic, makeBus, settle, type Fake } from "./helpers";

const names = (n: number) => Array.from({ length: n }, (_, i) => `M${String(i).padStart(3, "0")}-EUR`);
const autoCfg = (over: Fake = {}) => ({
  ...structuredClone(DEFAULT_ENGINE_CONFIG),
  universe: { mode: "auto", count: 30, minVolumeEur: 250_000 },
  ...over,
});
const manualCfg = (markets: string[]) => ({
  ...structuredClone(DEFAULT_ENGINE_CONFIG),
  markets,
  universe: { mode: "manual", count: 30, minVolumeEur: 250_000 },
});

let env: ReturnType<typeof installBrowserGlobals>;
beforeEach(() => {
  env = installBrowserGlobals();
  const g = globalThis as Record<string, Fake>;
  g.document.addEventListener = () => {};
  g.document.getElementById = () => fakeNode({ getBoundingClientRect: () => ({ width: 10, height: 10 }) });
  g.document.visibilityState = "visible";
  g.location = { hash: "" };
  g.window.innerHeight = 900;
  g.window.innerWidth = 1600;
  g.ResizeObserver = class {
    observe() {}
    disconnect() {}
  };
  vi.spyOn(globalThis, "setInterval").mockImplementation((() => 0) as unknown as typeof setInterval);
});
afterEach(() => {
  vi.restoreAllMocks();
  const g = globalThis as Record<string, unknown>;
  delete g.ResizeObserver;
  delete g.location;
  env.restore();
});

const row = (market: string) => ({
  market,
  price: 1,
  changePct24h: 2,
  volumeQuote24h: 1e6,
  volatilityPct: 1,
  spreadPct: 0.1,
  regime: "trend-up",
  action: "buy",
  score: 0.5,
  rsi: 55,
  sparkline: [1, 2, 3],
});

async function mountScannerPanel(snapshot: Fake) {
  const { mountScanner } = await loadPublic("js/panels/scanner.js");
  const { fmt, esc } = await loadPublic("js/format.js");
  let config = structuredClone(snapshot.config);
  const puts: Fake[] = [];
  const toasts: string[] = [];
  const modals: Fake[] = [];
  const nodes: Record<string, Fake> = {};
  const pop = fakeNode({ hidden: true, offsetWidth: 300, offsetHeight: 200, querySelector: () => null });
  nodes[".sc-pop"] = pop;
  const el = fakeNode({
    clientWidth: 1200,
    getBoundingClientRect: () => ({ left: 0, top: 0, bottom: 800, width: 1200 }),
    contains: () => true,
    querySelector: (sel: string) => (nodes[sel] ||= fakeNode()),
  });
  const bus = makeBus();
  const api = {
    getScanner: async () => [row("XRP-EUR"), row("M001-EUR")],
    getConfig: async () => structuredClone(config),
    putConfig: async (p: Fake) => {
      puts.push(structuredClone(p));
      config = { ...config, ...p, universe: { ...config.universe, ...(p.universe || {}) } };
      return structuredClone(config);
    },
  };
  const ctx = {
    fmt,
    esc,
    api,
    bus,
    toast: (m: string, k: string) => toasts.push(`${k}: ${m}`),
    openModal: (o: Fake) => (modals.push(o), () => {}),
    getState: () => snapshot,
    getActiveTab: () => "scanner",
  };
  mountScanner(ctx, el);
  bus.emit("tab-changed", { tab: "scanner" });
  await settle();
  /** Klik op een rij (opent het popover) en daarna op een actieknop in het popover */
  const openRow = (market: string) => {
    const anchor = fakeNode({ dataset: { market }, getBoundingClientRect: () => ({ left: 10, top: 10, bottom: 30, width: 200 }) });
    el.fire("click", { target: { closest: (sel: string) => (sel === "[data-market]" ? anchor : null) } });
  };
  const popAction = (act: string) =>
    el.fire("click", { target: { closest: (sel: string) => (sel === ".sc-pop [data-act]" ? { dataset: { act } } : null) } });
  return { el, pop, puts, toasts, modals, bus, openRow, popAction, body: nodes[".sc-body"] };
}

describe("Scanner-paneel (v2)", () => {
  it("automatisch: uitleg in het popover; na bevestigen Zelf kiezen met de actieve munten plus deze", async () => {
    const snap = { config: autoCfg(), activeMarkets: names(30) };
    const p = await mountScannerPanel(snap);
    // "in bot" volgt de actieve munten, niet de eigen lijst
    expect(String(p.body.innerHTML)).toMatch(/data-market="M001-EUR"[\s\S]*?in bot/);
    expect(String(p.body.innerHTML)).toContain("De bot kiest zijn munten nu automatisch");

    p.openRow("XRP-EUR");
    const html = String(p.pop.innerHTML).replace(/\s+/g, " ");
    expect(html).toMatch(/data-act="switch" title="Schakelt over naar Zelf kiezen \(je krijgt eerst een bevestiging\)">\+ Toevoegen…<\/button>/);
    expect(html).toContain("De bot kiest zijn munten nu <b>automatisch</b>");
    expect(html).toContain("de bot houdt de 30 munten die hij nu volgt en krijgt XRP-EUR erbij");

    p.popAction("switch");
    await settle();
    const modal = p.modals[p.modals.length - 1];
    expect(modal.title).toBe("Zelf munten kiezen?");
    expect(modal.confirmText).toBe("Overschakelen en XRP-EUR toevoegen");
    expect(String(modal.bodyHtml)).toContain("Terug naar automatisch kan altijd bij <strong>Instellingen → Munten</strong>");
    expect(p.puts).toEqual([]); // pas na bevestigen

    await modal.onConfirm();
    expect(p.puts).toEqual([{ universe: { mode: "manual" }, markets: [...names(30), "XRP-EUR"] }]);
    expect(p.bus.emitted.some((e) => e.type === "config-changed")).toBe(true);
    expect(p.toasts.some((t) => t.startsWith("success: Je kiest nu zelf de munten: 31 munten"))).toBe(true);
  });

  it("zelf kiezen: gewoon toevoegen (limiet 400), zonder overschakelen", async () => {
    const cfg = manualCfg(names(10));
    const p = await mountScannerPanel({ config: cfg, activeMarkets: cfg.markets });
    p.openRow("XRP-EUR");
    expect(String(p.pop.innerHTML)).toContain("(10/400 munten)");
    p.popAction("add");
    await settle();
    expect(p.modals).toEqual([]);
    expect(p.puts).toEqual([{ markets: [...names(10), "XRP-EUR"] }]);
  });
});
