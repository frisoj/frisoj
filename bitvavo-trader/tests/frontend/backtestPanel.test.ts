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

async function mount(opts: { form?: Form; strats?: string[]; optimize?: Fake; backtest?: Fake }) {
  const { mountBacktest } = await loadPublic("js/panels/backtest.js");
  const { fmt, esc } = await loadPublic("js/format.js");
  const form: Form = { ...LAB, ...(opts.form || {}) };
  const strats = opts.strats || [...DEFAULT_ENGINE_CONFIG.ensemble.enabled];
  let config = structuredClone(DEFAULT_ENGINE_CONFIG);
  const puts: Fake[] = [];
  const modals: Fake[] = [];
  const toasts: string[] = [];
  const inputs: Record<string, Fake> = {};
  const runButtons = ["optimize", "walkforward"].map((run) => fakeNode({ dataset: { run } }));
  const formEl = fakeNode({
    elements: { namedItem: (n: string) => (inputs[n] ||= fakeNode({ name: n, value: form[n] ?? "" })) },
    querySelectorAll: (sel: string) => {
      if (sel.startsWith('input[name="strat"]')) return strats.map((value) => ({ value }));
      if (sel.startsWith(".bt-run[data-run]")) return runButtons;
      return [];
    },
  });
  // De knoppen die het paneel van een klik-handler voorziet (uit de gerenderde HTML)
  let applyNodes: Fake[] = [];
  const outEl = fakeNode({
    querySelectorAll: (sel: string) => {
      if (sel !== ".bt-apply") return [];
      const rows = [...String(outEl.innerHTML).matchAll(/class="[^"]*\bbt-apply\b[^"]*" data-row="(\w+)"/g)].map((m) => m[1]);
      applyNodes = rows.map((row) => fakeNode({ dataset: { row } }));
      return applyNodes;
    },
    querySelector: () => fakeNode({ clientWidth: 0 }),
  });
  const applyButtons = () => applyNodes;
  const nodes: Record<string, Fake> = { ".bt-form": formEl, ".bt-out": outEl };
  const el = fakeNode({ querySelector: (sel: string) => (nodes[sel] ||= fakeNode()) });
  const api = {
    getMarkets: async () => [{ market: "BTC-EUR" }],
    getStrategies: async () => listStrategies(),
    getConfig: async () => structuredClone(config),
    info: async () => ({ dataSource: "simulated" }),
    optimize: async () => structuredClone(opts.optimize),
    backtest: async () => structuredClone(opts.backtest),
    putConfig: async (p: Fake) => {
      puts.push(structuredClone(p));
      config = structuredClone({
        ...config,
        ...p,
        ensemble: { ...config.ensemble, ...(p.ensemble || {}), params: { ...config.ensemble.params, ...(p.ensemble?.params || {}) } },
        risk: { ...config.risk, ...(p.risk || {}) },
      });
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
    getState: () => ({ config: structuredClone(config) }),
    getSelectedMarket: () => "BTC-EUR",
  };
  mountBacktest(ctx, el);
  await settle();
  // fillSelects() zet de formulierwaarden uit de config; zet ze terug op wat de gebruiker invulde
  for (const [k, v] of Object.entries(form)) if (inputs[k]) inputs[k].value = v;
  return {
    out: outEl,
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
