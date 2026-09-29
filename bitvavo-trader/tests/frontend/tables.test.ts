/**
 * Open posities (public/js/tables.js): onverkoopbare posities krijgen een badge,
 * een uitleg bij "Sluit" en een knop "Afschrijven". Echte module, nep-DOM.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fakeNode, installBrowserGlobals, loadPublic, makeBus, settle, type Fake } from "./helpers";

const norm = (s: string) => s.replace(/\s+/g, " ");
const REASON =
  "Onverkoopbaar: waarde € 4,62 is onder het minimum van € 5,00. Verkopen (ook handmatig) wordt nu geweigerd; wacht tot de waarde weer ≥ € 5,00 is of schrijf de positie af.";

const pos = (over: Fake = {}) => ({
  id: "pos_1",
  market: "SOL-EUR",
  side: "long",
  entryTime: Date.UTC(2026, 8, 29, 9, 0),
  entryPrice: 150,
  amount: 0.0333,
  costQuote: 5.02,
  entryFeeQuote: 0.0125,
  stopPrice: 140,
  initialStopPrice: 140,
  takeProfitPrice: 170,
  highestPrice: 151,
  candlesHeld: 3,
  entryReason: "test",
  currentPrice: 138.7,
  unrealizedPnl: -0.4,
  unrealizedPct: -8,
  ...over,
});

let env: ReturnType<typeof installBrowserGlobals>;
beforeEach(() => {
  env = installBrowserGlobals();
  vi.spyOn(globalThis, "setInterval").mockImplementation((() => 0) as unknown as typeof setInterval);
});
afterEach(() => {
  vi.restoreAllMocks();
  env.restore();
});

async function mount(snap: Fake, apiOver: Fake = {}) {
  const { mountTables } = await loadPublic("js/tables.js");
  const { fmt, esc } = await loadPublic("js/format.js");
  const bus = makeBus();
  const toasts: string[] = [];
  const modals: Fake[] = [];
  let state = snap;
  const api = {
    closePosition: vi.fn(async () => Promise.reject(new Error("Positie kon niet worden gesloten."))),
    writeOffPosition: vi.fn(async (id: string) => {
      state = { ...state, positions: state.positions.filter((p: Fake) => p.id !== id) };
      return { id: "trd_1", market: "SOL-EUR", pnlQuote: -5.02, pnlPct: -100 };
    }),
    getState: vi.fn(async () => state),
    ...apiOver,
  };
  const nodes: Record<string, Fake> = {};
  const positionsEl = fakeNode({ querySelector: (sel: string) => (nodes[`p${sel}`] ||= fakeNode()) });
  const tradesEl = fakeNode({ querySelector: (sel: string) => (nodes[`t${sel}`] ||= fakeNode()) });
  const ctx = {
    fmt,
    esc,
    api,
    bus,
    getState: () => state,
    toast: (m: string, k: string) => toasts.push(`${k}: ${m}`),
    openModal: (o: Fake) => {
      modals.push(o);
      return () => {};
    },
  };
  bus.on("snapshot", (s: Fake) => (state = s));
  mountTables(ctx, { positionsEl, tradesEl });
  const body = () => norm(String(nodes["p[data-pbody]"].innerHTML));
  const click = (attr: "close" | "writeoff", id: string) => {
    const target = {
      closest: (sel: string) => (sel === `[data-${attr}]` ? { dataset: { [attr]: id }, disabled: false } : null),
    };
    positionsEl.fire("click", { target });
    return modals[modals.length - 1];
  };
  return { api, bus, toasts, modals, body, click, state: () => state };
}

describe("onverkoopbare positie", () => {
  it("krijgt een badge 'Onverkoopbaar' met de reden als tooltip en een knop Afschrijven", async () => {
    const h = await mount({ mode: "live", running: true, positions: [pos({ unsellable: true, unsellableReason: REASON })], trades: [] });
    const html = h.body();
    expect(html).toMatch(/<span class="badge badge-yellow" title="Onverkoopbaar: waarde € 4,62[^"]*">Onverkoopbaar<\/span>/);
    expect(html).toContain('data-writeoff="pos_1"');
    expect(html).toContain(">Afschrijven</button>");
    // Sluit blijft, met uitleg waarom verkopen niet lukt
    expect(html).toMatch(/data-close="pos_1"[^>]*title="Verkopen lukt nu niet — Onverkoopbaar: waarde/);
  });

  it("een gewone positie heeft geen badge en geen Afschrijven", async () => {
    const h = await mount({ mode: "paper", running: true, positions: [pos({ currentPrice: 160, unrealizedPnl: 0.3 })], trades: [] });
    const html = h.body();
    expect(html).not.toContain("Onverkoopbaar");
    expect(html).not.toContain("data-writeoff");
    expect(html).toContain('title="Verkoop deze positie nu tegen marktprijs">Sluit</button>');
  });

  it("Sluit legt uit waarom verkopen nu niet lukt (proberen mag nog)", async () => {
    const h = await mount({ mode: "live", running: true, positions: [pos({ unsellable: true, unsellableReason: REASON })], trades: [] });
    const modal = h.click("close", "pos_1");
    expect(modal.title).toBe("Positie SOL-EUR sluiten?");
    expect(norm(modal.bodyHtml)).toContain("kan nu waarschijnlijk niet verkocht worden");
    expect(norm(modal.bodyHtml)).toContain("waarde € 4,62 is onder het minimum");
    expect(modal.confirmText).toBe("Toch proberen te verkopen");
    // de server weigert → fout in de modal
    await expect(modal.onConfirm()).rejects.toThrow("Positie kon niet worden gesloten.");
    expect(h.api.closePosition).toHaveBeenCalledWith("pos_1");
  });

  it("Afschrijven: gevaarlijke bevestiging met uitleg, daarna api.writeOffPosition(id)", async () => {
    const h = await mount({ mode: "live", running: true, positions: [pos({ unsellable: true, unsellableReason: REASON })], trades: [] });
    const modal = h.click("writeoff", "pos_1");
    expect(modal.danger).toBe(true);
    expect(modal.title).toBe("Positie SOL-EUR afschrijven?");
    const b = norm(modal.bodyHtml);
    expect(b).toContain("stopt met het beheren");
    expect(b).toContain("blijven op je Bitvavo-account staan");
    expect(b).toContain("€ 5,02</strong> wordt als <strong>verlies</strong> geboekt");
    expect(h.api.writeOffPosition).not.toHaveBeenCalled();
    await modal.onConfirm();
    await settle();
    expect(h.api.writeOffPosition).toHaveBeenCalledWith("pos_1");
    expect(h.toasts.some((t) => norm(t).includes("SOL-EUR afgeschreven: -€ 5,02 als verlies geboekt"))).toBe(true);
    // verse staat opgehaald en doorgegeven: positie weg
    expect(h.api.getState).toHaveBeenCalled();
    expect(h.body()).toContain("Geen open posities");
  });

  it("oefenmodus: coins blijven op het oefenaccount", async () => {
    const h = await mount({ mode: "paper", running: true, positions: [pos({ unsellable: true })], trades: [] });
    const modal = h.click("writeoff", "pos_1");
    expect(modal.bodyHtml).toContain("blijven op je oefenaccount staan");
    // zonder reden van de server: algemene uitleg
    expect(modal.bodyHtml).toContain("Bitvavo-minimum");
  });

  it("afschrijven mislukt (409) → fout in de modal, knoppen weer actief", async () => {
    const h = await mount(
      { mode: "live", running: true, positions: [pos({ unsellable: true, unsellableReason: REASON })], trades: [] },
      { writeOffPosition: vi.fn(async () => Promise.reject(new Error("Afschrijven kan nu even niet"))) },
    );
    const modal = h.click("writeoff", "pos_1");
    await expect(modal.onConfirm()).rejects.toThrow("Afschrijven kan nu even niet");
    expect(h.body()).not.toContain("disabled");
  });
});
