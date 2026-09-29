/**
 * Equity-paneel (public/js/panels/equity.js): de curve toont equity + afgeroomde
 * winst, de baseline is het oorspronkelijke startbedrag en het rendement komt
 * van de engine. Echte module, nep-DOM en een nep-grafiekbibliotheek.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fakeNode, installBrowserGlobals, loadPublic, makeBus, type Fake } from "./helpers";

const norm = (s: string) => s.replace(/\s+/g, " ");
const T = Date.UTC(2026, 0, 5, 22, 0);

// Echte engine-uitkomst (live, limiet €50): +€3,25 winst afgeroomd bij het sluiten
const liveSkimmed = {
  mode: "live",
  account: {
    equity: 50,
    cashQuote: 50,
    startingEquity: 46.7540523690773,
    dayStartEquity: 50.06452618453865,
    totalReturnPct: 6.4918952618454,
    dayReturnPct: -0.12103847503215366,
  },
  skimmedQuote: 3.2459476309227,
  trades: [{ pnlQuote: 3.25 }],
  equityHistory: [
    { time: T, equity: 49.943890274314214, skimmed: 0 },
    { time: T + 90_000, equity: 53.31047381546135, skimmed: 0 },
    { time: T + 3_840_000, equity: 53.31047381546135, skimmed: 0 },
    { time: T + 3_930_000, equity: 50, skimmed: 3.2459476309227 },
    { time: T + 4_020_000, equity: 50, skimmed: 3.2459476309227 },
  ],
};

describe("equityFigures", () => {
  it("baseline = oorspronkelijke start (start + afgeroomd), rendement van de engine, geen nep-drawdown", async () => {
    const { equityFigures, curveValue } = await loadPublic("js/panels/equity.js");
    const f = equityFigures(liveSkimmed);
    expect(f.start).toBeCloseTo(50, 9);
    expect(f.ret).toBeCloseTo(6.4919, 3);
    expect(f.pnl).toBeCloseTo(3.2459, 3);
    expect(f.skimmed).toBeCloseTo(3.2459, 3);
    // De curve daalt niet bij het afromen: 53,31 → 53,25 (alleen de exit-fee)
    expect(curveValue(liveSkimmed.equityHistory[3])).toBeCloseTo(53.2459, 3);
    expect(f.dd).toBeGreaterThan(-0.2);
  });

  it("paper / oudere server: zelf rekenen op startingEquity", async () => {
    const { equityFigures } = await loadPublic("js/panels/equity.js");
    const f = equityFigures({ mode: "paper", account: { equity: 45, startingEquity: 50 }, equityHistory: [{ time: T, equity: 50 }] });
    expect(f.start).toBe(50);
    expect(f.ret).toBeCloseTo(-10, 9);
    expect(f.dd).toBeCloseTo(-10, 9);
    expect(f.skimmed).toBe(0);
  });
});

let env: ReturnType<typeof installBrowserGlobals>;
beforeEach(() => {
  env = installBrowserGlobals();
  (globalThis as Record<string, unknown>).getComputedStyle = () => ({ getPropertyValue: () => "" });
});
afterEach(() => {
  vi.restoreAllMocks();
  delete (globalThis as Record<string, unknown>).getComputedStyle;
  env.restore();
});

function fakeCharts() {
  const series: Fake = {
    data: [] as Fake[],
    options: [] as Fake[],
    priceLines: [] as Fake[],
    setData(d: Fake[]) {
      series.data = d;
    },
    update(p: Fake) {
      series.data.push(p);
    },
    applyOptions(o: Fake) {
      series.options.push(o);
    },
    createPriceLine(o: Fake) {
      series.priceLines.push(o);
      return o;
    },
    removePriceLine() {},
  };
  const LC = {
    BaselineSeries: "baseline",
    createChart: () => ({ addSeries: () => series, timeScale: () => ({ fitContent() {} }) }),
  };
  return { LC, series };
}

async function mount(snap: Fake) {
  const { mountEquity } = await loadPublic("js/panels/equity.js");
  const { fmt, esc } = await loadPublic("js/format.js");
  const nodes: Record<string, Fake> = {};
  const el = fakeNode({ querySelector: (sel: string) => (nodes[sel] ||= fakeNode()) });
  const { LC, series } = fakeCharts();
  const bus = makeBus();
  mountEquity({ fmt, esc, bus, theme: {}, LightweightCharts: LC, getState: () => snap }, el);
  return { nodes, series, bus };
}

describe("equity-paneel", () => {
  it("live met afromen: curve = equity + afgeroomd, baseline € 50, regel 'Afgeroomd boven limiet'", async () => {
    const p = await mount(liveSkimmed);
    expect(p.series.data.map((d: Fake) => Number(d.value.toFixed(2)))).toEqual([49.94, 53.31, 53.31, 53.25, 53.25]);
    const base = p.series.options.find((o: Fake) => o.baseValue)?.baseValue.price;
    expect(base).toBeCloseTo(50, 9);
    expect(p.series.priceLines[0].price).toBeCloseTo(50, 9);
    expect(p.nodes[".eq-ret"].textContent).toBe("+6,49%");
    expect(p.nodes[".eq-skim"].hidden).toBe(false);
    expect(norm(p.nodes[".eq-skim"].innerHTML)).toContain("Afgeroomd boven limiet: <b class=\"mono pos\">€ 3,25</b>");
    expect(norm(p.nodes[".eq-s-ret"].title)).toBe("+€ 3,25 t.o.v. start € 50,00");
  });

  it("oefenmodus: geen afroom-regel", async () => {
    const p = await mount({
      mode: "paper",
      account: { equity: 52, startingEquity: 50, totalReturnPct: 4 },
      equityHistory: [
        { time: T, equity: 50 },
        { time: T + 60_000, equity: 52 },
      ],
      trades: [],
    });
    expect(p.nodes[".eq-skim"].hidden).toBe(true);
    expect(p.nodes[".eq-ret"].textContent).toBe("+4,00%");
    expect(p.series.data.map((d: Fake) => d.value)).toEqual([50, 52]);
  });
});
