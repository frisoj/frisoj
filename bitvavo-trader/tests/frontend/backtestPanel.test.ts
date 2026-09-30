/**
 * Stuurt het echte public/js/panels/backtest.js aan met een nep-DOM: de
 * optimalisatieweergave, "Pas beste instellingen toe" en de drawdown-KPI.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_ENGINE_CONFIG } from "../../src/core/defaults";
import { listStrategies } from "../../src/strategies";
import { fakeNode, installBrowserGlobals, loadPublic, makeBus, settle, type Fake } from "./helpers";

let env: ReturnType<typeof installBrowserGlobals>;
beforeEach(() => {
  env = installBrowserGlobals();
  const g = globalThis as Record<string, unknown>;
  (g.document as Fake).getElementById = () => fakeNode();
  g.getComputedStyle = () => ({ getPropertyValue: () => "" });
  g.ResizeObserver = class {
    observe() {}
    disconnect() {}
  };
  vi.spyOn(globalThis, "setInterval").mockImplementation((() => 0) as unknown as typeof setInterval);
});
afterEach(() => {
  vi.restoreAllMocks();
  const g = globalThis as Record<string, unknown>;
  delete g.getComputedStyle;
  delete g.ResizeObserver;
  env.restore();
});

/** Formulierwaarden zoals de gebruiker ze invult */
type Form = Record<string, string>;
const LAB: Form = {
  market: "BTC-EUR",
  interval: "1h",
  days: "30",
  capital: "50",
  buyThreshold: "0.35",
  sellThreshold: "-0.3",
  stopAtrMult: "2",
  takeProfitR: "2",
  riskPerTradePct: "1.5",
  objective: "sharpe",
  strategy: "",
  folds: "4",
  trainRatio: "0.7",
};

async function mount(opts: {
  form?: Form;
  strats?: string[];
  optimize?: Fake;
  backtest?: Fake;
  markets?: string[];
  activeMarkets?: string[];
  config?: Fake;
}) {
  const { mountBacktest } = await loadPublic("js/panels/backtest.js");
  const { fmt, esc } = await loadPublic("js/format.js");
  const form: Form = { ...LAB, ...(opts.form || {}) };
  const strats = opts.strats || [...DEFAULT_ENGINE_CONFIG.ensemble.enabled];
  let config = structuredClone(opts.config ?? DEFAULT_ENGINE_CONFIG);
  const reqs: Fake[] = [];
  const puts: Fake[] = [];
  const modals: Fake[] = [];
  const toasts: string[] = [];
  const inputs: Record<string, Fake> = {};
  const runButtons = ["optimize", "walkforward"].map((run) => fakeNode({ dataset: { run } }));
  const formEl = fakeNode({
    elements: { namedItem: (n: string) => (inputs[n] ||= fakeNode({ name: n, value: form[n] ?? "" })) },
    // Anker voor de foutmeldingen van het formulier (showFormErrors)
    querySelector: (sel: string) => (sel === ".bt-run-main" ? fakeNode({ before() {} }) : null),
    querySelectorAll: (sel: string) => {
      if (sel.startsWith('input[name="strat"]')) return strats.map((value) => ({ value }));
      if (sel.startsWith(".bt-run[data-run]")) return runButtons;
      return [];
    },
  });
  // De knoppen die het paneel van een klik-handler voorziet (uit de gerenderde HTML)
  let applyNodes: Fake[] = [];
  // Vaste nep-nodes per selector binnen het resultaat; alleen de heatmap heeft een breedte (die wordt dus getekend)
  const outNodes: Record<string, Fake> = {};
  const outEl = fakeNode({
    querySelectorAll: (sel: string) => {
      if (sel !== ".bt-apply") return [];
      const rows = [...String(outEl.innerHTML).matchAll(/class="[^"]*\bbt-apply\b[^"]*" data-row="(\w+)"/g)].map((m) => m[1]);
      applyNodes = rows.map((row) => fakeNode({ dataset: { row } }));
      return applyNodes;
    },
    querySelector: (sel: string) => (outNodes[sel] ||= fakeNode({ clientWidth: sel === ".bt-hm" ? 600 : 0, contains: () => true })),
  });
  const applyButtons = () => applyNodes;
  const nodes: Record<string, Fake> = { ".bt-form": formEl, ".bt-out": outEl };
  const el = fakeNode({ querySelector: (sel: string) => (nodes[sel] ||= fakeNode()) });
  const calls: string[] = [];
  const api = {
    getMarkets: async () => (opts.markets ?? ["BTC-EUR"]).map((market) => ({ market })),
    getStrategies: async () => listStrategies(),
    getConfig: async () => structuredClone(config),
    info: async () => ({ dataSource: "simulated" }),
    optimize: async (req: Fake) => (calls.push("optimize"), reqs.push(structuredClone(req)), structuredClone(opts.optimize)),
    backtest: async (req: Fake) => (calls.push("backtest"), reqs.push(structuredClone(req)), structuredClone(opts.backtest)),
    putConfig: async (p: Fake) => {
      puts.push(structuredClone(p));
      config = structuredClone({
        ...config,
        ...p,
        ensemble: { ...config.ensemble, ...(p.ensemble || {}), params: { ...config.ensemble.params, ...(p.ensemble?.params || {}) } },
        risk: { ...config.risk, ...(p.risk || {}) },
      });
      if (p.ensemble?.trendFilter) config.ensemble.trendFilter = { ...(config.ensemble.trendFilter || {}), ...p.ensemble.trendFilter };
      return structuredClone(config);
    },
  };
  const ctx = {
    fmt,
    esc,
    api,
    bus: makeBus(),
    theme: {},
    toast: (m: string, k: string) => toasts.push(`${k}: ${m}`),
    openModal: (o: Fake) => {
      modals.push(o);
      return () => {};
    },
    getState: () => ({ config: structuredClone(config), ...(opts.activeMarkets ? { activeMarkets: opts.activeMarkets } : {}) }),
    getSelectedMarket: () => "BTC-EUR",
  };
  mountBacktest(ctx, el);
  await settle();
  // fillSelects() zet de formulierwaarden uit de config; zet ze terug op wat de gebruiker invulde
  for (const [k, v] of Object.entries(form)) if (inputs[k]) inputs[k].value = v;
  return {
    out: outEl,
    outNodes,
    calls,
    reqs,
    inputs,
    bus: ctx.bus,
    formEl,
    puts,
    modals,
    toasts,
    applyButtons,
    async run(kind: "optimize" | "backtest") {
      if (kind === "optimize") runButtons[0].fire("click", {});
      else formEl.fire("submit", { preventDefault() {} });
      await settle();
    },
  };
}

const metrics = (over: Fake = {}) => ({
  totalReturnPct: 2,
  buyHoldReturnPct: 1,
  maxDrawdownPct: -3,
  sharpe: 1.2,
  sortino: 1.5,
  winRatePct: 55,
  avgWinPct: 1,
  avgLossPct: -0.5,
  profitFactor: 1.6,
  trades: 12,
  avgCandlesHeld: 4,
  feesPaid: 0.5,
  finalEquity: 51,
  ...over,
});
const penalized = (i: number) => ({ params: { "ensemble.buyThreshold": 0.25 + i / 100 }, score: -1e9, metrics: metrics({ trades: 0, totalReturnPct: 0 }) });

describe("optimalisatie: geen geldige combinatie", () => {
  it("toont geen afgestrafte rij als 'beste' en biedt niets aan om toe te passen", async () => {
    const res = { objective: "sharpe", rows: [penalized(0), penalized(1)], best: null, combosTested: 2, heatmap: null, durationMs: 10 };
    const p = await mount({ optimize: res });
    await p.run("optimize");
    const html = String(p.out.innerHTML);
    expect(html).toContain("Geen enkele combinatie haalde minimaal 5 trades");
    expect(html).not.toContain("1.000.000.000");
    expect(html).not.toContain('data-row="best"');
    expect(p.applyButtons()).toEqual([]);
    expect(html).toContain("te weinig trades");
  });
});

describe("optimalisatie: gemengd", () => {
  it("scorebalkjes geschaald op de geldige rijen; afgestrafte rijen zonder Toepassen", async () => {
    const good = { params: { "ensemble.buyThreshold": 0.45 }, score: 2, metrics: metrics() };
    const ok = { params: { "ensemble.buyThreshold": 0.35 }, score: 1, metrics: metrics() };
    const res = { objective: "sharpe", rows: [good, ok, penalized(0)], best: good, combosTested: 3, heatmap: null, durationMs: 10 };
    const p = await mount({ optimize: res });
    await p.run("optimize");
    const html = String(p.out.innerHTML);
    expect(html).toMatch(/style="width:100\.0%"/);
    expect(html).toMatch(/style="width:50\.0%"/);
    expect(p.applyButtons().map((b: Fake) => b.dataset.row).sort()).toEqual(["0", "1", "best"]);
  });
});

describe("Pas beste instellingen toe", () => {
  it("zet precies de geteste configuratie in de bot (lab: alleen breakout, koop 0,25, stop 3)", async () => {
    const best = { params: { "breakout.lookback": 30 }, score: 0.8, metrics: metrics() };
    const res = { objective: "sharpe", rows: [best], best, combosTested: 1, heatmap: null, durationMs: 10 };
    const p = await mount({
      optimize: res,
      form: { strategy: "breakout", buyThreshold: "0.25", stopAtrMult: "3" },
      strats: ["breakout"],
    });
    await p.run("optimize");
    const btn = p.applyButtons().find((b: Fake) => b.dataset.row === "best");
    btn.fire("click", {});
    await settle();
    const modal = p.modals[p.modals.length - 1];
    expect(modal.title).toBe("Instellingen toepassen?");
    expect(modal.bodyHtml).toContain("Strategieën aan");
    expect(modal.bodyHtml).toContain("Koopdrempel");
    await modal.onConfirm();
    expect(p.puts).toHaveLength(1);
    const put = p.puts[0];
    expect(put.ensemble.enabled).toEqual(["breakout"]);
    expect(put.ensemble.buyThreshold).toBe(0.25);
    expect(put.ensemble.sellThreshold).toBe(-0.3);
    expect(put.ensemble.params.breakout).toMatchObject({ lookback: 30 });
    expect(put.risk).toEqual({ stopAtrMult: 3, takeProfitR: 2, riskPerTradePct: 1.5 });
  });
});

describe("backtest-KPI's", () => {
  it("een drawdown van −45% krijgt geen groen vinkje", async () => {
    const bt = {
      market: "BTC-EUR",
      interval: "1h",
      initialCapital: 50,
      metrics: metrics({ maxDrawdownPct: -45, totalReturnPct: -40, finalEquity: 30 }),
      trades: [],
      equityCurve: [],
      candles: [],
      markers: [],
    };
    const p = await mount({ backtest: bt });
    await p.run("backtest");
    const html = String(p.out.innerHTML);
    const card = html.slice(html.lastIndexOf('<div class="bt-kpi"', html.indexOf("Max. drawdown")), html.indexOf("Max. drawdown"));
    expect(card).toContain('data-q="bad"');
  });
});

describe("minimale periode in het formulier", () => {
  it("1 dag op 1h (24 candles) wordt al in de browser geweigerd met een Nederlandse uitleg", async () => {
    const p = await mount({ form: { days: "1", interval: "1h" }, backtest: {} });
    await p.run("backtest");
    expect(p.calls).toEqual([]);
    expect(p.toasts[p.toasts.length - 1]).toBe(
      "warn: Periode te kort: 1 dag van 1h is maar 24 candles (minimaal 30). Kies minstens 2 dagen of een korter interval.",
    );
  });

  it("2 dagen op 1h mag wel", async () => {
    const bt = { market: "BTC-EUR", interval: "1h", initialCapital: 50, metrics: metrics(), trades: [], equityCurve: [], candles: [], markers: [] };
    const p = await mount({ form: { days: "2", interval: "1h" }, backtest: bt });
    await p.run("backtest");
    expect(p.calls).toEqual(["backtest"]);
  });
});

describe("backtest-resultaat: periode, note en vastgelopen verkopen", () => {
  const from = Date.UTC(2026, 8, 20);
  const bt = (over: Fake = {}) => ({
    market: "BTC-EUR",
    interval: "1h",
    dataSource: "bitvavo",
    from,
    to: from + (5 * 24 - 1) * 3600e3,
    candlesCount: 120,
    initialCapital: 50,
    durationMs: 10,
    metrics: metrics(),
    trades: [],
    equityCurve: [],
    candles: [],
    markers: [],
    ...over,
  });

  it("toont de echte testperiode uit from/to, de note van de server en een waarschuwing voor stuckTrades", async () => {
    const note = "Periode ingekort: NEW-EUR heeft pas historie vanaf 15 september 2026.";
    const p = await mount({ backtest: bt({ note, stuckTrades: 2 }) });
    await p.run("backtest");
    const html = String(p.out.innerHTML).replace(/\s+/g, " ");
    expect(html).toContain("20-9-2026 → 24-9-2026 (5 dagen)");
    expect(html).toContain(`<b>Periode aangepast.</b> ${note}`);
    expect(html).toContain("2 trades konden eerst niet verkocht worden.");
    expect(html).toContain("zonder werkende stop-loss");
  });

  it("zonder note en zonder stuckTrades geen extra banners", async () => {
    const p = await mount({ backtest: bt({ stuckTrades: 0 }) });
    await p.run("backtest");
    const html = String(p.out.innerHTML);
    expect(html).not.toContain("bt-note");
    expect(html).not.toContain("bt-stuck");
  });
});

describe("heatmap: mediaan en de beste combinatie", () => {
  it("ster en kader op de cel van res.best (niet op de hoogste mediaan), arcering alleen voor niet-geteste cellen", async () => {
    const tip = fakeNode({ getBoundingClientRect: () => ({ width: 100, height: 40 }) });
    const g = globalThis as Record<string, Fake>;
    g.document.getElementById = () => tip;
    Object.assign(g.window, { innerWidth: 1600, innerHeight: 900 });
    const best = {
      params: { "ensemble.buyThreshold": 0.45, "risk.stopAtrMult": 3, "risk.takeProfitR": 2 },
      score: 1.4,
      metrics: metrics(),
    };
    const heatmap = {
      xParam: "ensemble.buyThreshold",
      yParam: "risk.stopAtrMult",
      xValues: [0.35, 0.45],
      yValues: [2, 3],
      values: [
        [0.9, null],
        [null, 0.2],
      ],
      best: [
        [1.1, null],
        [null, 1.4],
      ],
      tested: [
        [4, 4],
        [0, 4],
      ],
      scored: [
        [4, 0],
        [0, 3],
      ],
      positive: [
        [4, 0],
        [0, 2],
      ],
    };
    const res = { objective: "sharpe", rows: [best], best, combosTested: 12, heatmap, durationMs: 10 };
    const p = await mount({ optimize: res });
    await p.run("optimize");
    const svg = String(p.outNodes[".bt-hm"].innerHTML).replace(/\s+/g, " ");
    const cell = (x: number, y: number) => {
      const m = new RegExp(`<g class="bt-cell ([^"]*)" data-x="${x}" data-y="${y}">(.*?)</g>`).exec(svg);
      return { cls: m?.[1] ?? "", body: m?.[2] ?? "" };
    };
    // beste combinatie (0,45 / 3) = cel (1,1), ook al heeft (0,0) de hoogste mediaan
    expect(cell(1, 1).cls).toContain("is-best");
    expect(cell(1, 1).body).toContain("★");
    expect(cell(0, 0).cls).not.toContain("is-best");
    // niet getest → gearceerd; getest maar te weinig trades → effen, met label
    expect(cell(0, 1).body).toContain("url(#bt-hatch)");
    expect(cell(1, 0).body).not.toContain("url(#bt-hatch)");
    expect(cell(1, 0).body).toContain(">te weinig trades</text>");
    // legenda
    expect(String(p.outNodes[".bt-hm-legend"].innerHTML)).toContain("kleur = mediaan over de overige parameters");
    // tooltip van cel (0,0)
    p.outNodes[".bt-hm"].fire("mousemove", {
      clientX: 10,
      clientY: 10,
      target: { closest: () => ({ dataset: { x: "0", y: "0" } }) },
    });
    expect(String(tip.innerHTML).replace(/\s+/g, " ")).toContain("Sharpe: mediaan 0,9 · beste 1,1 · 4 van 4 winstgevend (4 getest)");
    p.outNodes[".bt-hm"].fire("mousemove", {
      clientX: 10,
      clientY: 10,
      target: { closest: () => ({ dataset: { x: "1", y: "1" } }) },
    });
    expect(String(tip.innerHTML)).toContain("★ hier zit de beste combinatie");
  });
});

// ── v2: trendfilter-schakelaar, tegengehouden koopsignalen, ~400 markten ──

const flat = (h: unknown) => String(h).replace(/\s+/g, " ");
const text = (h: unknown) => flat(String(h).replace(/<[^>]+>/g, ""));
const btResult = (over: Fake = {}) => ({
  market: "BTC-EUR",
  interval: "1h",
  dataSource: "bitvavo",
  from: Date.UTC(2026, 8, 1),
  to: Date.UTC(2026, 8, 30),
  candlesCount: 700,
  initialCapital: 50,
  durationMs: 10,
  metrics: metrics(),
  trades: [],
  equityCurve: [],
  candles: [],
  markers: [],
  ...over,
});

describe("v2 Backtest-lab: trendfilter vergelijken met / zonder", () => {
  it("standaard zoals de bot (aan): het filter van de bot gaat mee in de backtest", async () => {
    const p = await mount({ backtest: btResult() });
    expect(p.inputs.trendFilter.checked).toBe(true);
    await p.run("backtest");
    expect(p.reqs[0].ensemble.trendFilter).toEqual({ market: true, coin: false, interval: "1d", period: 50 });
  });

  it("uit: ensemble.trendFilter met beide vlaggen uit (zelfde tijdschaal en periode)", async () => {
    const p = await mount({ backtest: btResult() });
    p.inputs.trendFilter.checked = false;
    await p.run("backtest");
    expect(p.reqs[0].ensemble.trendFilter).toEqual({ market: false, coin: false, interval: "1d", period: 50 });
  });

  it("bot zonder filter: schakelaar staat uit; aan = het standaard marktfilter; ook bij optimaliseren", async () => {
    const config = structuredClone(DEFAULT_ENGINE_CONFIG) as Fake;
    config.ensemble.trendFilter = { market: false, coin: false, interval: "4h", period: 30 };
    const best = { params: { "ensemble.buyThreshold": 0.45 }, score: 1, metrics: metrics() };
    const p = await mount({ config, optimize: { objective: "sharpe", rows: [best], best, combosTested: 1, heatmap: null, durationMs: 1 } });
    expect(p.inputs.trendFilter.checked).toBe(false);
    p.inputs.trendFilter.checked = true;
    await p.run("optimize");
    expect(p.reqs[0].ensemble.trendFilter).toEqual({ market: true, coin: false, interval: "4h", period: 30 });
    expect(flat(p.out.innerHTML)).toContain(">trendfilter aan</span>");
  });

  it("toont hoeveel koopsignalen het trendfilter en de spread tegenhielden", async () => {
    const p = await mount({ backtest: btResult({ blockedEntries: { trend: 12, spread: 1 } }) });
    await p.run("backtest");
    const t = text(p.out.innerHTML);
    expect(t).toContain("Filters in deze test");
    expect(t).toContain("Tegengehouden door trendfilter: 12 koopsignalen");
    expect(t).toContain("Tegengehouden door spread: 1 koopsignaal");
    expect(t).toContain("Trendfilter aan: alleen kopen als Bitcoin boven het gemiddelde van 50 dagen staat.");
    expect(t).toContain("zet het trendfilter bij de testinstellingen uit en test opnieuw");
  });

  it("zonder blockedEntries (filter uit, geen spreadlimiet): wel de stand van het filter, geen aantallen", async () => {
    const p = await mount({ backtest: btResult() });
    p.inputs.trendFilter.checked = false;
    await p.run("backtest");
    const t = text(p.out.innerHTML);
    expect(t).toContain("Trendfilter uit: de test kocht ook in een dalende markt.");
    expect(t).not.toContain("Tegengehouden door");
  });

  it("een filteruitleg van de server heet niet 'Periode aangepast.'", async () => {
    const note = "Trendfilter niet toegepast: geen koersdata voor het filter.";
    const p = await mount({ backtest: btResult({ note }) });
    await p.run("backtest");
    const html = flat(p.out.innerHTML);
    expect(html).toContain(`<b>Let op.</b> ${note}`);
    expect(html).not.toContain("Periode aangepast.");
  });

  it("toepassen met het trendfilter uit: in de bevestiging staat het, en de bot krijgt het geteste filter", async () => {
    const best = { params: { "ensemble.buyThreshold": 0.45 }, score: 1, metrics: metrics() };
    const p = await mount({ optimize: { objective: "sharpe", rows: [best], best, combosTested: 1, heatmap: null, durationMs: 1 } });
    p.inputs.trendFilter.checked = false;
    await p.run("optimize");
    p.applyButtons().find((b: Fake) => b.dataset.row === "best").fire("click", {});
    await settle();
    const modal = p.modals[p.modals.length - 1];
    const body = flat(modal.bodyHtml);
    expect(body).toContain("<td>Trendfilter</td>");
    expect(body).toContain("Bitcoin boven het gemiddelde van 50 dagen");
    expect(body).toContain("In deze test stond het trendfilter <b>uit</b>; na toepassen staat het ook in de bot <b>uit</b>.");
    await modal.onConfirm();
    expect(p.puts[0].ensemble.trendFilter).toEqual({ market: false, coin: false, interval: "1d", period: 50 });
  });
});

describe("v2 Backtest-lab: marktkeuze met ~400 markten", () => {
  // BTC-EUR = de markt die in de live grafiek geselecteerd is (getSelectedMarket)
  const all = ["BTC-EUR", ...Array.from({ length: 399 }, (_, i) => `C${String(i).padStart(3, "0")}-EUR`)];

  it("de munten die de bot nu volgt (activeMarkets) staan bovenaan; een zoekveld filtert de lijst", async () => {
    const active = ["C200-EUR", "C007-EUR", "C350-EUR"];
    const p = await mount({ markets: all, activeMarkets: active, form: { market: "C007-EUR" } });
    const sel = p.inputs.market;
    const html = flat(sel.innerHTML);
    expect(html).toMatch(/^<optgroup label="In de bot \(3\)"><option value="C200-EUR">C200-EUR<\/option><option value="C007-EUR">/);
    expect((html.match(/<option /g) || []).length).toBe(400);
    expect(p.inputs.marketSearch.hidden).toBe(false);

    p.formEl.fire("input", { target: { name: "marketSearch", value: "c35" } });
    const filtered = flat(sel.innerHTML);
    expect(filtered).toContain('<optgroup label="In de bot (3)"><option value="C350-EUR">');
    expect((filtered.match(/<option /g) || []).length).toBe(10); // C350 … C359
    expect(sel.value).toBe("C350-EUR"); // C007 past niet meer: eerste treffer

    p.formEl.fire("input", { target: { name: "marketSearch", value: "zzz" } });
    expect(flat(sel.innerHTML)).toContain('<option disabled>Geen munt met "zzz"</option>');
    expect(sel.value).toBe("C350-EUR");
  });

  it("nieuwe automatische keuze in de snapshot → groep 'In de bot' bijgewerkt, gekozen markt blijft", async () => {
    const p = await mount({ markets: all, activeMarkets: ["C001-EUR"], form: { market: "C123-EUR" } });
    p.inputs.market.value = "C123-EUR";
    p.bus.emit("snapshot", { config: structuredClone(DEFAULT_ENGINE_CONFIG), activeMarkets: ["C123-EUR", "C005-EUR"] });
    const html = flat(p.inputs.market.innerHTML);
    expect(html).toMatch(/^<optgroup label="In de bot \(2\)"><option value="C123-EUR">/);
    expect(p.inputs.market.value).toBe("C123-EUR");
  });
});
