/**
 * Tabblad Wedstrijd (public/js/panels/compete.js): echte module met een nep-DOM, nep-API,
 * nep-grafiekbibliotheek en nep-timers. Weergave, verversen alleen als het tabblad én de
 * pagina zichtbaar zijn, de bulkknoppen met bevestiging, en de 404-staat.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fakeNode, installBrowserGlobals, loadPublic, makeBus, type Fake } from "./helpers";

const norm = (s: string) => s.replace(/\s+/g, " ");
const T = Date.UTC(2026, 8, 30, 10, 0, 0);

const P: Record<string, { name: string; short: string; color: string }> = {
  scalper: { name: "Snelle scalper", short: "Scalper", color: "#e0a23a" },
  trend: { name: "Trendvolger", short: "Trend", color: "#3987e5" },
  dip: { name: "Dip-koper", short: "Dip", color: "#9b6ddf" },
  allround: { name: "Allrounder", short: "Allround", color: "#2fb67c" },
};

function bot(id: string, pnl: number, fees: number, trades: number, over: Fake = {}): Fake {
  return {
    id,
    ...P[id],
    description: `Zo handelt ${id}.`,
    path: `/bot/${id}/`,
    mode: "paper",
    running: true,
    liveArmed: false,
    interval: "15m",
    startingEquity: 25,
    equity: 25 + pnl,
    totalPnlQuote: pnl,
    totalReturnPct: (pnl / 25) * 100,
    dayPnlQuote: 0,
    dayReturnPct: 0,
    feesPaid: fees,
    grossPnlQuote: pnl + fees,
    trades,
    wins: Math.ceil(trades / 2),
    losses: Math.floor(trades / 2),
    winRatePct: trades ? (Math.ceil(trades / 2) / trades) * 100 : 0,
    maxDrawdownPct: -1,
    tradesToday: 1,
    openPositions: 0,
    halted: { halted: false },
    equityHistory: [
      { time: T, value: 25 },
      { time: T + 60_000, value: 25 + pnl / 2 },
      { time: T + 120_000, value: 25 + pnl },
    ],
    ...over,
  };
}

const FOUR = () => [
  bot("scalper", -0.46, 1.21, 38, { openPositions: 1 }),
  bot("trend", 0.81, 0.18, 6),
  bot("dip", 0.12, 0.3, 11, { running: false }),
  bot("allround", -0.15, 0.42, 14),
];

function fakeCharts() {
  const created: Fake[] = [];
  const calls = { resize: [] as number[][], fit: 0 };
  const chart = {
    addSeries: (_type: unknown, opts: Fake) => {
      const s: Fake = {
        opts,
        data: [] as Fake[],
        options: [] as Fake[],
        priceLines: [] as Fake[],
        setData(d: Fake[]) {
          s.data = d;
        },
        applyOptions(o: Fake) {
          s.options.push(o);
        },
        createPriceLine(o: Fake) {
          s.priceLines.push(o);
          return o;
        },
      };
      created.push(s);
      return s;
    },
    removeSeries: vi.fn(),
    timeScale: () => ({
      fitContent: () => {
        calls.fit++;
      },
    }),
    resize: (w: number, h: number) => calls.resize.push([w, h]),
    applyOptions: vi.fn(),
    subscribeCrosshairMove: vi.fn(),
  };
  const LC = { LineSeries: "line", createChart: vi.fn(() => chart) };
  return { LC, chart, created, calls };
}

let env: ReturnType<typeof installBrowserGlobals>;
let doc: Fake;
let store: Map<string, string>;
beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(T + 600_000);
  env = installBrowserGlobals();
  const listeners: Record<string, ((e: unknown) => void)[]> = {};
  doc = {
    hidden: false,
    listeners,
    querySelector: () => ({}), // compete.css "is al geladen"
    querySelectorAll: () => [],
    createElement: () => fakeNode(),
    head: fakeNode(),
    body: fakeNode(),
    documentElement: fakeNode(),
    addEventListener: (t: string, fn: (e: unknown) => void) => (listeners[t] ||= []).push(fn),
    fire: (t: string) => (listeners[t] || []).forEach((fn) => fn({})),
  };
  (globalThis as Record<string, unknown>).document = doc;
  store = new Map();
  (globalThis as Record<string, unknown>).localStorage = {
    getItem: (k: string) => (store.has(k) ? store.get(k)! : null),
    setItem: (k: string, v: string) => store.set(k, String(v)),
    removeItem: (k: string) => store.delete(k),
  };
});
afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  env.restore();
});

type Opts = { tab?: string; bots?: Fake[] | Error; api?: Fake; info?: Fake };

async function mount(opts: Opts = {}) {
  const { mountCompete } = await loadPublic("js/panels/compete.js");
  const { fmt, esc } = await loadPublic("js/format.js");
  const nodes: Record<string, Fake> = {};
  const el = fakeNode({
    querySelector: (sel: string) =>
      (nodes[sel] ||= fakeNode(sel === '[data-cp="chart"]' ? { clientWidth: 800, clientHeight: 320 } : {})),
  });
  const bus = makeBus();
  let tab = opts.tab ?? "compete";
  let current: Fake[] | Error | undefined = opts.bots ?? FOUR();
  const api = {
    getBots: vi.fn(async () => {
      if (current instanceof Error) throw current;
      return current;
    }),
    getState: vi.fn(async () => ({ running: true, account: { equity: 25 } })),
    startAll: vi.fn(async () => ({ results: [] })),
    stopAll: vi.fn(async () => ({ results: [] })),
    killAll: vi.fn(async () => ({ results: [] })),
    ...(opts.api || {}),
  };
  const toasts: string[] = [];
  const modals: Fake[] = [];
  const charts = fakeCharts();
  const ctx = {
    api,
    bus,
    fmt,
    esc,
    theme: {},
    LightweightCharts: charts.LC,
    getActiveTab: () => tab,
    getInfo: () => opts.info ?? { bot: { id: "trend" } },
    toast: (m: string, k: string) => toasts.push(`${k}: ${norm(m)}`),
    openModal: (o: Fake) => {
      modals.push(o);
      return () => {};
    },
  };
  mountCompete(ctx, el);
  await vi.advanceTimersByTimeAsync(0);
  const html = (k: string) => norm(String(nodes[`[data-cp="${k}"]`]?.innerHTML ?? ""));
  const click = (sel: string, dataset: Fake) =>
    el.fire("click", { target: { closest: (s: string) => (s === sel ? { dataset, disabled: false } : null) } });
  return {
    el,
    nodes,
    bus,
    api,
    toasts,
    modals,
    charts,
    html,
    click,
    btn: (k: string) => nodes[`[data-cp-act="${k}"]`],
    setTab: (t: string) => {
      tab = t;
      bus.emit("tab-changed", { tab: t });
    },
    setBots: (b: Fake[] | Error) => {
      current = b;
    },
  };
}

/** Nep-modalvenster voor onConfirm(value, modalEl) */
function fakeModal() {
  const parts: Record<string, Fake> = {};
  return { parts, el: fakeNode({ querySelector: (sel: string) => (parts[sel] ||= fakeNode({ remove: vi.fn() })) }) };
}

describe("weergave", () => {
  it("ranglijst op totaal rendement, met medaille, kleur, cijfers, status en link naar het eigen dashboard", async () => {
    const p = await mount();
    const board = p.html("board");
    const order = ["Trendvolger", "Dip-koper", "Allrounder", "Snelle scalper"].map((n) => board.indexOf(n));
    expect(order.every((i, k) => i > 0 && (k === 0 || i > order[k - 1]))).toBe(true);
    expect(board).toContain('class="cp-medal gold"');
    expect(board).toContain('class="cp-medal plain"');
    expect(board).toContain('style="background:#3987e5"');
    expect(board).toContain("+€ 0,81");
    expect(board).toContain("+3,24%");
    expect(board).toContain('href="/bot/trend/#live"');
    expect(board).toContain(">Gestopt<");
    // "Hier" alleen bij de bot van dit dashboard (info.bot.id = trend)
    expect(board.match(/>Hier</g)).toHaveLength(1);
    expect(board.indexOf(">Hier<")).toBeLessThan(board.indexOf("Dip-koper"));
    expect(p.nodes['[data-cp="sub"]'].textContent).toMatch(/^4 bots · oefengeld · 3 actief · bijgewerkt /);
    expect(p.html("analysis")).toContain("Trendvolger ligt voor met +3,24% (+€ 0,81).");
    expect(p.nodes['[data-cp="lower"]'].hidden).toBe(false);
    // deelt de lijst met de botwisselaar
    expect(p.bus.emitted.some((e) => e.type === "bots" && Array.isArray((e.data as Fake).bots))).toBe(true);
  });

  it("één grafiek: een lijn per bot in de profielkleur, tijd in seconden, plus een lijn op 0", async () => {
    const p = await mount();
    const [zero, ...lines] = p.charts.created;
    expect(zero.opts.lineVisible).toBe(false);
    expect(zero.priceLines[0]).toMatchObject({ price: 0, title: "start" });
    expect(lines.map((s: Fake) => s.opts.color)).toEqual(["#e0a23a", "#3987e5", "#9b6ddf", "#2fb67c"]);
    const trend = lines[1];
    expect(trend.data.slice(0, 3).map((d: Fake) => d.time)).toEqual([T / 1000, T / 1000 + 60, T / 1000 + 120]);
    // laatste punt = "nu" met het rendement van de engine
    expect(trend.data[trend.data.length - 1].value).toBeCloseTo(3.24, 9);
    expect(p.html("legend")).toContain("Trend");
    expect(p.html("legend")).toContain("+3,24%");
    expect(p.charts.calls.resize).toContainEqual([800, 320]);
    expect(p.charts.calls.fit).toBeGreaterThan(0);
  });

  it("escapet tekst van de server en gebruikt geen onveilige kleur", async () => {
    const evil = bot("trend", 0.5, 0.1, 3, { name: '<img src=x onerror="alert(1)">', color: "red;background:url(x)" });
    const p = await mount({ bots: [evil, bot("dip", 0, 0, 0)] });
    const board = p.html("board");
    expect(board).not.toContain("<img");
    expect(board).toContain("&lt;img");
    expect(board).not.toContain("url(x)");
  });

  it("uitleg per bot openklappen (blijft open na verversen)", async () => {
    const p = await mount();
    expect(p.html("board")).toContain("Hoe handelt hij?");
    p.click("[data-cp-desc]", { cpDesc: "trend" });
    expect(p.html("board")).toContain('aria-expanded="true"');
    expect(p.html("board")).toContain("Verberg uitleg");
    await vi.advanceTimersByTimeAsync(10_000);
    expect(p.api.getBots).toHaveBeenCalledTimes(2);
    expect(p.html("board")).toContain("Verberg uitleg");
  });

  it("grafiek: keuze € (onthouden) en een lijn verbergen via de legenda", async () => {
    const p = await mount();
    p.click("[data-cp-mode]", { cpMode: "eur" });
    expect(store.get("bvt-compete-chart")).toBe("eur");
    const trend = p.charts.created[2];
    expect(trend.data[trend.data.length - 1].value).toBeCloseTo(0.81, 9);
    p.click("[data-cp-leg]", { cpLeg: "trend" });
    expect(trend.options).toContainEqual({ visible: false });
    expect(p.html("legend")).toContain("is-off");
  });

  it("tab-changed naar Wedstrijd: grafiek op maat en passend", async () => {
    const p = await mount({ tab: "live" });
    const before = p.charts.calls.fit;
    p.setTab("compete");
    await vi.advanceTimersByTimeAsync(0);
    env.flushRaf();
    expect(p.charts.calls.resize).toContainEqual([800, 320]);
    expect(p.charts.calls.fit).toBeGreaterThan(before);
  });
});

describe("verversen (elke 10 s, alleen zichtbaar)", () => {
  it("niet zolang een ander tabblad open is; wel na tab-changed; stopt als de pagina verborgen is", async () => {
    const p = await mount({ tab: "live" });
    await vi.advanceTimersByTimeAsync(60_000);
    expect(p.api.getBots).not.toHaveBeenCalled();

    p.setTab("compete");
    await vi.advanceTimersByTimeAsync(0);
    expect(p.api.getBots).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(10_000);
    expect(p.api.getBots).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(10_000);
    expect(p.api.getBots).toHaveBeenCalledTimes(3);

    doc.hidden = true;
    doc.fire("visibilitychange");
    await vi.advanceTimersByTimeAsync(40_000);
    expect(p.api.getBots).toHaveBeenCalledTimes(3);

    doc.hidden = false;
    doc.fire("visibilitychange");
    await vi.advanceTimersByTimeAsync(0);
    expect(p.api.getBots).toHaveBeenCalledTimes(4);

    p.setTab("backtest");
    await vi.advanceTimersByTimeAsync(40_000);
    expect(p.api.getBots).toHaveBeenCalledTimes(4);
  });

  it("gegevens van de botwisselaar (bus-event 'bots') tekenen het paneel zonder zelf op te halen", async () => {
    const p = await mount({ tab: "live" });
    expect(p.html("board")).toContain("Bots laden");
    p.bus.emit("bots", { bots: FOUR(), error: null, at: Date.now() });
    expect(p.html("board")).toContain("Trendvolger");
    expect(p.api.getBots).not.toHaveBeenCalled();
  });

  it("mislukte verversing na eerdere gegevens: laatste gegevens blijven, met een melding", async () => {
    const p = await mount();
    p.setBots(new Error("Failed to fetch"));
    await vi.advanceTimersByTimeAsync(10_000);
    expect(p.html("board")).toContain("Trendvolger");
    expect(p.nodes['[data-cp="note"]'].hidden).toBe(false);
    expect(p.nodes['[data-cp="note"]'].textContent).toBe("Verversen mislukt (Failed to fetch); je ziet de laatste gegevens.");
  });
});

describe("404: server zonder meerdere bots", () => {
  it("uitleg in plaats van de ranglijst; geen knoppen en geen grafiek", async () => {
    const p = await mount({ bots: Object.assign(new Error("Niet gevonden"), { status: 404 }) });
    expect(p.html("board")).toContain("De wedstrijd staat niet aan");
    expect(p.html("board")).toContain("BOTS=scalper,trend,dip,allround");
    expect(p.nodes['[data-cp="lower"]'].hidden).toBe(true);
    expect(p.nodes['[data-cp="actions"]'].hidden).toBe(true);
    expect(p.bus.emitted.some((e) => e.type === "bots" && (e.data as Fake).error?.status === 404)).toBe(true);
  });

  it("andere fout zonder gegevens: foutmelding met 'Opnieuw proberen'", async () => {
    const p = await mount({ bots: Object.assign(new Error("Serverfout"), { status: 500 }) });
    expect(p.html("board")).toContain("Kon de bots niet ophalen");
    expect(p.html("board")).toContain("data-cp-retry");
    p.setBots(FOUR());
    p.el.fire("click", { target: { closest: (s: string) => (s === "[data-cp-retry]" ? {} : null) } });
    await vi.advanceTimersByTimeAsync(0);
    expect(p.html("board")).toContain("Trendvolger");
  });
});

describe("Alles starten / stoppen / noodstop", () => {
  it("knoppen aan/uit volgens de staat van de bots", async () => {
    const p = await mount();
    expect([p.btn("start").disabled, p.btn("stop").disabled, p.btn("kill").disabled]).toEqual([false, false, false]);
    const q = await mount({ bots: FOUR().map((b) => ({ ...b, running: true })) });
    expect(q.btn("start").disabled).toBe(true);
    const r = await mount({ bots: FOUR().map((b) => ({ ...b, running: false, openPositions: 0 })) });
    expect([r.btn("start").disabled, r.btn("stop").disabled, r.btn("kill").disabled]).toEqual([false, true, true]);
  });

  it("Alles starten: eerst bevestigen, dan per bot het resultaat als melding", async () => {
    const startAll = vi.fn(async () => ({
      results: [
        { id: "scalper", ok: true },
        { id: "trend", ok: true },
        { id: "dip", ok: false, error: "Dagelijkse verlieslimiet: morgen weer" },
        { id: "allround", ok: true },
      ],
    }));
    const p = await mount({ api: { startAll } });
    p.click("[data-cp-act]", { cpAct: "start" });
    expect(p.modals).toHaveLength(1);
    expect(p.modals[0].title).toBe("Alle bots starten?");
    expect(p.modals[0].bodyHtml).toContain("Dip-koper gaat (weer) handelen");
    expect(startAll).not.toHaveBeenCalled();
    await expect(p.modals[0].onConfirm("", fakeModal().el)).resolves.toBeUndefined();
    expect(startAll).toHaveBeenCalledTimes(1);
    expect(p.api.getBots).toHaveBeenCalledTimes(2); // meteen ververst
    expect(p.api.getState).toHaveBeenCalled(); // kopbalk van dit dashboard bijgewerkt
    expect(p.toasts).toEqual(["success: Gestart: Scalper, Trend en Allround", "error: Dip: starten mislukt — Dagelijkse verlieslimiet: morgen weer"]);
  });

  it("Alles stoppen: waarschuwt voor open posities; fout van de server blijft in het venster", async () => {
    const stopAll = vi.fn(async () => {
      throw new Error("Server niet bereikbaar");
    });
    const p = await mount({ api: { stopAll } });
    p.click("[data-cp-act]", { cpAct: "stop" });
    expect(p.modals[0].title).toBe("Alle bots stoppen?");
    expect(norm(p.modals[0].bodyHtml)).toContain("Er staat nog 1 positie open");
    await expect(p.modals[0].onConfirm("", fakeModal().el)).rejects.toThrow("Server niet bereikbaar");
    expect(p.api.getBots).toHaveBeenCalledTimes(2); // echte staat opgehaald
    expect(p.toasts).toEqual([]);
    expect(p.btn("stop").disabled).toBe(false); // niet meer bezig
  });

  it("Noodstop alle bots: rood venster; deels mislukt → venster blijft open met per bot wat niet lukte", async () => {
    const killAll = vi.fn(async () => ({
      results: [
        { id: "scalper", ok: true, killResult: { closed: 0, failed: [{ id: "p1", market: "PEPE-EUR", reason: "onder het minimum" }] } },
        { id: "trend", ok: true, killResult: { closed: 0, failed: [] } },
        { id: "dip", ok: true, killResult: { closed: 0, failed: [] } },
        { id: "allround", ok: true, killResult: { closed: 0, failed: [] } },
      ],
    }));
    const p = await mount({ api: { killAll } });
    p.click("[data-cp-act]", { cpAct: "kill" });
    const m = p.modals[0];
    expect(m).toMatchObject({ title: "Noodstop alle bots", danger: true, confirmText: "Noodstop uitvoeren" });
    const modal = fakeModal();
    await expect(m.onConfirm("", modal.el)).resolves.toBe(false);
    expect(killAll).toHaveBeenCalledTimes(1);
    expect(modal.parts[".modal-head h3"].textContent).toBe("Noodstop: niet alles gelukt");
    expect(modal.parts[".modal-body"].innerHTML).toContain("PEPE-EUR: onder het minimum");
    expect(modal.parts['[data-m="ok"]'].remove).toHaveBeenCalled();
    expect(modal.parts['[data-m="cancel"]'].textContent).toBe("Sluiten");
    expect(p.toasts.some((t) => t.startsWith("error: Scalper: gestopt, maar 1 positie NIET verkocht"))).toBe(true);
    expect(p.toasts).toContain("info: Noodstop gelukt bij Trend, Dip en Allround (er stonden geen posities open)");
  });

  it("Noodstop alles gelukt: venster sluit met één melding", async () => {
    const killAll = vi.fn(async () => ({ results: FOUR().map((b) => ({ id: b.id, ok: true, killResult: { closed: 1, failed: [] } })) }));
    const p = await mount({ api: { killAll } });
    p.click("[data-cp-act]", { cpAct: "kill" });
    await expect(p.modals[0].onConfirm("", fakeModal().el)).resolves.toBeUndefined();
    expect(p.toasts).toEqual(["warn: Noodstop: alle 4 bots gestopt, alles verkocht"]);
  });
});
