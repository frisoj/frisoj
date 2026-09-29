/**
 * Header (public/js/header.js): waarschuwingsbanners (onbekende orders,
 * herstelmelding), rendement na afromen en de reset-modal. Echte module, nep-DOM.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fakeNode, loadPublic, makeBus, settle, type Fake } from "./helpers";

/** Intl zet een harde spatie tussen € en het bedrag */
const norm = (s: string) => s.replace(/\s+/g, " ");

const base = (over: Fake = {}) => ({
  running: true,
  mode: "live",
  liveArmed: true,
  dataSource: "bitvavo",
  account: { equity: 50, cashQuote: 50, startingEquity: 50, dayStartEquity: 50 },
  config: { pollMs: 15000, risk: { minOrderQuote: 5, maxOpenPositions: 2, maxTradesPerDay: 6 } },
  positions: [],
  trades: [],
  equityHistory: [],
  ...over,
});

beforeEach(() => {
  vi.spyOn(globalThis, "setInterval").mockImplementation((() => 0) as unknown as typeof setInterval);
});
afterEach(() => vi.restoreAllMocks());

async function mount(initial: Fake, opts: { info?: Fake; api?: Fake } = {}) {
  const { mountHeader } = await loadPublic("js/header.js");
  const { fmt, esc } = await loadPublic("js/format.js");
  const bus = makeBus();
  const toasts: string[] = [];
  const modals: Fake[] = [];
  let state = initial;
  const api = {
    getState: vi.fn(async () => state),
    ackUnknownOrders: vi.fn(async () => {
      state = { ...state, unknownOrders: [] };
      return state;
    }),
    ackStateRecovery: vi.fn(async () => {
      state = { ...state, stateRecovery: null };
      return state;
    }),
    resetPaper: vi.fn(async () => state),
    ...(opts.api || {}),
  };
  // Stabiele nep-nodes per selector (statistiekkaarten, knoppen)
  const statNodes: Record<string, Fake> = {};
  const statsEl = fakeNode({ querySelector: (sel: string) => (statNodes[sel] ||= fakeNode()) });
  const buttons: Record<string, Fake> = {};
  const controlsEl = fakeNode({
    querySelector: (sel: string) => {
      const act = /data-act="(\w+)"/.exec(sel)?.[1] ?? sel;
      return (buttons[act] ||= fakeNode({ dataset: { act } }));
    },
  });
  const alertEl = fakeNode();
  const ctx = {
    fmt,
    esc,
    api,
    bus,
    getState: () => initial,
    getInfo: () => opts.info ?? null,
    toast: (m: string, k: string) => toasts.push(`${k}: ${m}`),
    openModal: (o: Fake) => {
      modals.push(o);
      return () => {};
    },
  };
  mountHeader(ctx, { statsEl, controlsEl, bannerEl: null, alertEl });
  const clickAlert = (act: string) => {
    alertEl.fire("click", { target: { closest: () => ({ dataset: { alertAct: act }, disabled: false }) } });
    return modals[modals.length - 1];
  };
  const press = (act: string) => {
    const b = controlsEl.querySelector(`[data-act="${act}"]`);
    controlsEl.fire("click", { target: { closest: () => b } });
    return modals[modals.length - 1];
  };
  const stat = (k: string, part: "v" | "s") => norm(String(statNodes[`[data-k="${k}"] [data-${part}]`]?.innerHTML ?? ""));
  return { bus, api, toasts, modals, alertEl, clickAlert, press, stat };
}

const unknownOrder = { market: "BTC-EUR", clientOrderId: "bvt-123", quoteAmount: 22.5, at: Date.UTC(2026, 8, 29, 12, 0) };

describe("banner: kooporder met onbekende uitkomst", () => {
  it("toont de amberkleurige banner met de controle-opdracht en een bevestigknop", async () => {
    const h = await mount(base({ unknownOrders: [unknownOrder] }));
    const html = norm(h.alertEl.innerHTML);
    expect(h.alertEl.hidden).toBe(false);
    expect(html).toContain('class="alert-banner warn"');
    expect(html).toContain(
      "<b>Onbekende orderuitkomst</b> — nieuwe aankopen zijn gepauzeerd. Controleer je open orders en saldo op Bitvavo.",
    );
    expect(html).toContain("BTC-EUR · € 22,50");
    expect(html).toContain('data-alert-act="ack-unknown"');
    expect(html).toContain("Ik heb het gecontroleerd");
  });

  it("bevestigen gaat via een modal naar api.ackUnknownOrders(); daarna verdwijnt de banner", async () => {
    const h = await mount(base({ unknownOrders: [unknownOrder] }));
    const modal = h.clickAlert("ack-unknown");
    expect(modal.danger).toBe(true);
    expect(modal.bodyHtml).toContain("niet door de bot beheerd");
    expect(h.api.ackUnknownOrders).not.toHaveBeenCalled();
    await modal.onConfirm();
    expect(h.api.ackUnknownOrders).toHaveBeenCalledTimes(1);
    // het antwoord (EngineSnapshot zonder unknownOrders) wordt doorgegeven → banner weg
    expect(h.bus.emitted.some((e) => e.type === "snapshot")).toBe(true);
    expect(h.alertEl.innerHTML).toBe("");
    expect(h.alertEl.hidden).toBe(true);
    expect(h.toasts.some((t) => t.startsWith("success:"))).toBe(true);
  });

  it("een mislukte bevestiging gooit (fout in de modal) en de banner blijft staan", async () => {
    const h = await mount(base({ unknownOrders: [unknownOrder] }), {
      api: { ackUnknownOrders: vi.fn(async () => Promise.reject(new Error("Niet ondersteund"))) },
    });
    const modal = h.clickAlert("ack-unknown");
    await expect(modal.onConfirm()).rejects.toThrow("Niet ondersteund");
    expect(h.alertEl.innerHTML).toContain("Onbekende orderuitkomst");
  });

  it("verdwijnt vanzelf zodra de snapshot de orders niet meer bevat", async () => {
    const h = await mount(base({ unknownOrders: [unknownOrder] }));
    expect(h.alertEl.innerHTML).toContain("Onbekende orderuitkomst");
    h.bus.emit("snapshot", base({ unknownOrders: [] }));
    expect(h.alertEl.innerHTML).toBe("");
    expect(h.alertEl.hidden).toBe(true);
  });
});

describe("banner: onbruikbare opgeslagen staat", () => {
  const rec = { reason: "JSON kapot (Unexpected end of input)", quarantinedTo: "data/state.json.corrupt-1", at: 1 };

  it("rode banner met de reden en een bevestigknop; bevestigen → api.ackStateRecovery()", async () => {
    const h = await mount(base({ stateRecovery: rec }));
    const html = norm(h.alertEl.innerHTML);
    expect(html).toContain('class="alert-banner bad"');
    expect(html).toContain("JSON kapot (Unexpected end of input)");
    expect(html).toContain("Live handel inschakelen is geblokkeerd");
    expect(html).toContain("data/state.json.corrupt-1");
    expect(html).toContain('data-alert-act="ack-recovery"');
    const modal = h.clickAlert("ack-recovery");
    expect(modal.bodyHtml).toContain("JSON kapot");
    await modal.onConfirm();
    expect(h.api.ackStateRecovery).toHaveBeenCalledTimes(1);
    expect(h.alertEl.innerHTML).toBe("");
  });

  it("beide banners tegelijk; stateRecovery null → alleen de orderbanner", async () => {
    const h = await mount(base({ stateRecovery: rec, unknownOrders: [unknownOrder] }));
    expect(h.alertEl.innerHTML).toContain('data-alert="recovery"');
    expect(h.alertEl.innerHTML).toContain('data-alert="unknown-orders"');
    h.bus.emit("snapshot", base({ stateRecovery: null, unknownOrders: [unknownOrder] }));
    expect(h.alertEl.innerHTML).not.toContain('data-alert="recovery"');
    expect(h.alertEl.innerHTML).toContain('data-alert="unknown-orders"');
  });

  it("oefenmodus: geen tekst over live armen", async () => {
    const h = await mount(base({ mode: "paper", liveArmed: false, stateRecovery: { reason: "onleesbaar", at: 1 } }));
    expect(h.alertEl.innerHTML).toContain("onleesbaar");
    expect(h.alertEl.innerHTML).not.toContain("Live handel inschakelen");
  });
});

describe("rendement na afromen (live)", () => {
  // Echte engine-uitkomst: winst van €3,25 boven de limiet van €50 afgeroomd
  const skimmed = base({
    account: {
      equity: 50,
      cashQuote: 50,
      startingEquity: 46.7540523690773,
      dayStartEquity: 50.06452618453865,
      totalReturnPct: 6.4918952618454,
      dayReturnPct: -0.12103847503215366,
    },
    skimmedQuote: 3.2459476309227,
  });

  it("accountReturns gebruikt de percentages van de engine en het oorspronkelijke startbedrag", async () => {
    const { accountReturns } = await loadPublic("js/header.js");
    const r = accountReturns(skimmed);
    expect(r.totPct).toBeCloseTo(6.4919, 3);
    expect(r.dayPct).toBeCloseTo(-0.121, 3);
    expect(r.totPnl).toBeCloseTo(3.2459, 3);
    expect(r.origStart).toBeCloseTo(50, 9);
    expect(r.skimmed).toBeCloseTo(3.2459, 3);
  });

  it("zonder engine-percentages (oudere server) wordt zelf gerekend", async () => {
    const { accountReturns } = await loadPublic("js/header.js");
    const r = accountReturns(base({ mode: "paper", account: { equity: 55, startingEquity: 50, dayStartEquity: 52 } }));
    expect(r.totPct).toBeCloseTo(10, 9);
    expect(r.dayPct).toBeCloseTo((3 / 52) * 100, 9);
    expect(r.origStart).toBe(50);
  });

  it("de kaarten tonen +6,49% t.o.v. € 50,00 (niet +6,94% t.o.v. € 46,75)", async () => {
    const h = await mount(skimmed, { info: { capitalLimitQuote: 50 } });
    expect(h.stat("total", "s")).toContain("+6,49%");
    expect(h.stat("total", "s")).toContain("t.o.v. € 50,00");
    expect(h.stat("total", "v")).toContain("+€ 3,25");
    expect(h.stat("day", "s")).toContain("-0,12%");
    expect(h.stat("equity", "s")).toContain("afgeroomd € 3,25");
  });
});

describe("Reset oefengeld", () => {
  it("noemt het startkapitaal uit /api/info, niet account.startingEquity", async () => {
    const snap = base({ mode: "paper", liveArmed: false, running: false, account: { equity: 80, startingEquity: 80, dayStartEquity: 80 } });
    const h = await mount(snap, { info: { paperStartingCapital: 50 } });
    const modal = h.press("reset");
    expect(norm(modal.bodyHtml)).toContain("€ 50,00");
    expect(norm(modal.bodyHtml)).not.toContain("€ 80,00");
    await modal.onConfirm();
    await settle();
    expect(h.api.resetPaper).toHaveBeenCalledTimes(1);
  });

  it("zonder paperStartingCapital geen (mogelijk verkeerd) bedrag", async () => {
    const snap = base({ mode: "paper", liveArmed: false, running: false, account: { equity: 80, startingEquity: 80, dayStartEquity: 80 } });
    const h = await mount(snap);
    const modal = h.press("reset");
    expect(norm(modal.bodyHtml)).not.toContain("€ 80,00");
    expect(modal.bodyHtml).toContain("startkapitaal");
  });
});
