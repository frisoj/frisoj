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
  const tbody = () => norm(String(nodes["t[data-tbody]"].innerHTML));
  const click = (attr: "close" | "writeoff", id: string) => {
    const target = {
      closest: (sel: string) => (sel === `[data-${attr}]` ? { dataset: { [attr]: id }, disabled: false } : null),
    };
    positionsEl.fire("click", { target });
    return modals[modals.length - 1];
  };
  return { api, bus, ctx: ctx as Fake, toasts, modals, body, tbody, click, nodes, state: () => state };
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

describe("open posities: compacte tabel (ronde 3)", () => {
  it("7 kolommen: koers+entry, inzet+hoeveelheid en stop/doel onder de balk samengevoegd; actiekolom sticky", async () => {
    const h = await mount({ mode: "live", running: true, positions: [pos({ unsellable: true, unsellableReason: REASON })], trades: [] });
    const html = h.body();
    const ths = html.match(/<th[\s>]/g) || [];
    expect(ths).toHaveLength(7);
    expect(html).toContain('class="table responsive pos-table"');
    expect(html).toContain(">Koers / entry</th>");
    expect(html).toContain(">Inzet / aantal</th>");
    // koers (live bijgewerkt via data-price) met entry eronder
    expect(html).toMatch(/<span class="price-cell" data-price="pos_1">138,70<\/span><small[^>]*>in 150,00<\/small>/);
    // inzet met hoeveelheid + munt eronder
    expect(html).toMatch(/<span>€ 5,02<\/span><small[^>]*>0,0333 SOL<\/small>/);
    // stop (rood) en doel (groen) als getal onder de balk
    expect(html).toMatch(/<span class="lbl l neg"[^>]*>140,00<\/span><span class="lbl r pos"[^>]*>170,00<\/span>/);
    // knoppen in de sticky actiekolom
    expect(html).toMatch(/<td class="full col-act" data-label=""><div class="pos-actions"><button[^>]*data-close="pos_1"/);
    expect(html).toContain('<th class="col-act">');
    expect(html).toContain("data-since");
  });

  it("een meegeschoven stop krijgt ↑ in het stop-label", async () => {
    const h = await mount({ mode: "paper", running: true, positions: [pos({ stopPrice: 152, currentPrice: 160, unrealizedPnl: 0.3 })], trades: [] });
    expect(h.body()).toMatch(/<span class="lbl l neg" title="Stop is meegeschoven \(trailing\/break-even\)">152,00 ↑<\/span>/);
  });
});

describe("afgeschreven trade in 'Laatste trades'", () => {
  const writeOff = {
    id: "trd_wo",
    market: "SOL-EUR",
    entryTime: Date.UTC(2026, 8, 29, 8, 0),
    exitTime: Date.UTC(2026, 8, 29, 12, 0),
    entryPrice: 150,
    exitPrice: 138.7,
    amount: 0.0333,
    costQuote: 5.02,
    proceedsQuote: 0,
    feesQuote: 0.0125,
    pnlQuote: -5.02,
    pnlPct: -100,
    rMultiple: -5,
    exitReason: "write-off",
    candlesHeld: 16,
    entryReason: "test · afgeschreven (onverkoopbaar restant blijft op je account)",
  };
  const tradesHtml = (h: Awaited<ReturnType<typeof mount>>) => h.tbody();

  it("toont 'Afgeschreven' en '—' in plaats van een exitprijs", async () => {
    const h = await mount({ mode: "live", running: true, positions: [], trades: [writeOff] });
    const html = tradesHtml(h);
    expect(html).toContain(">Afgeschreven</span>");
    expect(html).toMatch(/150,00 <span class="muted">→<\/span> <span class="muted" title="[^"]*niets verkocht[^"]*">—<\/span>/);
    expect(html).not.toContain("138,70");
    expect(html).toContain('class="reason-pill neg"');
  });

  it("een gewone trade houdt zijn exitprijs", async () => {
    const h = await mount({ mode: "live", running: true, positions: [], trades: [{ ...writeOff, exitReason: "stop-loss", pnlPct: -7.5, pnlQuote: -0.38 }] });
    expect(tradesHtml(h)).toContain("150,00 <span class=\"muted\">→</span> 138,70");
    expect(tradesHtml(h)).toContain(">Stop-loss</span>");
  });
});

describe("één toast per gesloten trade (gedeelde notifier met het SSE-event)", () => {
  const trade = { id: "trd_9", market: "SOL-EUR", pnlQuote: 0.12, pnlPct: 2.4, exitReason: "manual" };

  async function withNotifier(apiOver: Fake, mode = "paper") {
    const { createTradeNotifier } = await loadPublic("js/tradeNotify.js");
    const { fmt } = await loadPublic("js/format.js");
    const h = await mount({ mode, running: true, positions: [pos({ currentPrice: 160, unrealizedPnl: 0.3 })], trades: [] }, apiOver);
    return { h, createTradeNotifier, fmt };
  }

  it("SSE-event eerst, daarna het API-antwoord → één toast", async () => {
    let bus: Fake;
    const { h, createTradeNotifier, fmt } = await withNotifier({
      closePosition: vi.fn(async () => {
        bus.emit("position-closed", { ...trade }); // server stuurt het event vóór het HTTP-antwoord
        return { ...trade };
      }),
    });
    bus = h.bus;
    const shown: string[] = [];
    const notify = createTradeNotifier((m: string, k: string) => shown.push(norm(`${k}: ${m}`)), fmt, () => "paper");
    h.bus.on("position-closed", notify); // zoals main.js
    h.ctx.notifyTradeClosed = notify;
    const modal = h.click("close", "pos_1");
    await modal.onConfirm();
    expect(shown).toEqual(["success: Oefen-verkoop: SOL-EUR +€ 0,12 (+2,40%) · Handmatig"]);
    expect(h.toasts).toEqual([]);
  });

  it("API-antwoord eerst, daarna het SSE-event → één toast", async () => {
    const { h, createTradeNotifier, fmt } = await withNotifier({ closePosition: vi.fn(async () => ({ ...trade })) });
    const shown: string[] = [];
    const notify = createTradeNotifier((m: string, k: string) => shown.push(norm(`${k}: ${m}`)), fmt, () => "paper");
    h.bus.on("position-closed", notify);
    h.ctx.notifyTradeClosed = notify;
    await h.click("close", "pos_1").onConfirm();
    h.bus.emit("position-closed", { ...trade });
    expect(shown).toHaveLength(1);
    expect(h.toasts).toEqual([]);
  });

  it("afschrijven → één toast 'Afgeschreven: <markt> …'", async () => {
    const wo = { id: "trd_wo", market: "SOL-EUR", pnlQuote: -5.02, pnlPct: -100, exitReason: "write-off" };
    const { createTradeNotifier, fmt } = await withNotifier({});
    let bus: Fake;
    const h = await mount(
      { mode: "live", running: true, positions: [pos({ unsellable: true, unsellableReason: REASON })], trades: [] },
      {
        writeOffPosition: vi.fn(async () => {
          bus.emit("position-closed", { ...wo }); // SSE-event vóór het HTTP-antwoord
          return { ...wo };
        }),
      },
    );
    bus = h.bus;
    const shown: string[] = [];
    const notify = createTradeNotifier((m: string, k: string) => shown.push(norm(`${k}: ${m}`)), fmt, () => "live");
    h.bus.on("position-closed", notify);
    h.ctx.notifyTradeClosed = notify;
    await h.click("writeoff", "pos_1").onConfirm();
    expect(shown).toEqual(["warn: Afgeschreven: SOL-EUR -€ 5,02 als verlies geboekt — de coins blijven op je Bitvavo-account"]);
    expect(h.toasts).toEqual([]);
  });
});

describe("open posities: scroll-hint (ronde 3)", () => {
  it("tabel breder dan het paneel → zichtbare hint en schaduw op de actiekolom; past hij, dan weg", async () => {
    const h = await mount({ mode: "paper", running: true, positions: [pos()], trades: [] });
    const wrap = h.nodes["p[data-pbody]"];
    const cue = h.nodes["p[data-pcue]"];
    wrap.scrollWidth = 820;
    wrap.clientWidth = 600;
    h.bus.emit("snapshot", h.state());
    expect(cue.hidden).toBe(false);
    expect(wrap.classList.contains("is-scrollx")).toBe(true);
    wrap.scrollWidth = 600;
    h.bus.emit("snapshot", h.state());
    expect(cue.hidden).toBe(true);
    expect(wrap.classList.contains("is-scrollx")).toBe(false);
  });

  it("ook zonder nieuwe snapshot: bij een andere paneelbreedte (ResizeObserver) wordt de hint bijgewerkt", async () => {
    const observed: { cb: () => void; el: unknown }[] = [];
    const g = globalThis as Record<string, unknown>;
    g.ResizeObserver = class {
      constructor(private cb: () => void) {}
      observe(el: unknown) {
        observed.push({ cb: this.cb, el });
      }
    };
    try {
      const h = await mount({ mode: "paper", running: true, positions: [pos()], trades: [] });
      const wrap = h.nodes["p[data-pbody]"];
      expect(observed.map((o) => o.el)).toContain(wrap);
      expect(h.nodes["p[data-pcue]"].hidden).toBe(true);
      wrap.scrollWidth = 900;
      wrap.clientWidth = 500;
      observed.forEach((o) => o.cb());
      expect(h.nodes["p[data-pcue]"].hidden).toBe(false);
    } finally {
      delete g.ResizeObserver;
    }
  });
});
