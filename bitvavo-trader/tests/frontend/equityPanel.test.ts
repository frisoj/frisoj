/**
 * Equity-paneel (public/js/panels/equity.js): de curve toont equity + wat er netto
 * uit het handelsbudget is gehaald (EquityPoint.skimmed), de baseline is
 * account.startingEquity (het kapitaal dat de bot kreeg) en winst/rendement komen
 * van de engine. Echte module, nep-DOM en een nep-grafiekbibliotheek.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fakeNode, installBrowserGlobals, loadPublic, makeBus, type Fake } from "./helpers";

const norm = (s: string) => s.replace(/\s+/g, " ");
const T = Date.UTC(2026, 0, 5, 22, 0);

// Echte engine-uitkomst (ronde 3, live, limiet €50): +€3,25 winst afgeroomd bij het sluiten.
// startingEquity blijft het ingelegde kapitaal (€50); totalPnlQuote/dayPnlQuote komen van de engine.
// (Herschreven in ronde 3: de oude fixture had de oude engine-semantiek, waarin startingEquity
// met het afgeroomde bedrag verlaagd werd en de UI het er weer bij optelde.)
const liveSkimmed = {
  mode: "live",
  account: {
    equity: 50,
    cashQuote: 50,
    startingEquity: 50,
    dayStartEquity: 53.31047381546135,
    totalPnlQuote: 3.2459476309227,
    totalReturnPct: 6.4918952618454,
    dayPnlQuote: -0.06452618453865,
    dayReturnPct: -0.12103847503215366,
  },
  skimmedQuote: 3.2459476309227,
  trades: [{ pnlQuote: 3.2459476309226964 }],
  equityHistory: [
    { time: T, equity: 49.943890274314214, skimmed: 0 },
    { time: T + 90_000, equity: 53.31047381546135, skimmed: 0 },
    { time: T + 3_840_000, equity: 53.31047381546135, skimmed: 0 },
    { time: T + 3_930_000, equity: 50, skimmed: 3.2459476309227 },
    { time: T + 4_020_000, equity: 50, skimmed: 3.2459476309227 },
  ],
};

describe("equityFigures", () => {
  it("baseline = startingEquity (kapitaal van de bot), winst en rendement van de engine, geen nep-drawdown", async () => {
    const { equityFigures, curveValue } = await loadPublic("js/panels/equity.js");
    const f = equityFigures(liveSkimmed);
    expect(f.start).toBe(50);
    expect(f.ret).toBeCloseTo(6.4919, 3);
    // equity − start = 0, maar de engine zegt +€3,25 (afgeroomde winst telt mee)
    expect(f.pnl).toBeCloseTo(3.2459, 3);
    expect(f.skimmed).toBeCloseTo(3.2459, 3);
    // De curve daalt niet bij het afromen: 53,31 → 53,25 (alleen de exit-fee)
    expect(curveValue(liveSkimmed.equityHistory[3])).toBeCloseTo(53.2459, 3);
    expect(f.dd).toBeGreaterThan(-0.2);
  });

  it("telt skimmedQuote NIET meer bij de baseline op", async () => {
    const { equityFigures } = await loadPublic("js/panels/equity.js");
    const f = equityFigures({ ...liveSkimmed, skimmedQuote: 20 });
    expect(f.start).toBe(50);
    expect(f.skimmed).toBe(20);
  });

  it("curve gebruikt point.skimmed per punt (ook negatief: netto kapitaal erbij), ontbrekend = 0", async () => {
    const { curveValue } = await loadPublic("js/panels/equity.js");
    expect(curveValue({ equity: 60, skimmed: -10 })).toBe(50);
    expect(curveValue({ equity: 48 })).toBe(48);
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
  it("live met afromen: curve = equity + skimmed, baseline € 50 (startingEquity), regel 'Afgeroomd boven limiet'", async () => {
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

// Echte engine-uitkomst (ronde 3, live): limiet €50, +€3,25 afgeroomd, daarna herstart met limiet €100.
// De storting van €50 telt mee in startingEquity (ingelegd kapitaal) en maakt skimmed (netto eruit) −46,75.
const liveRaised = {
  mode: "live",
  account: {
    startingEquity: 100,
    cashQuote: 100,
    equity: 100,
    dayStartEquity: 50,
    totalPnlQuote: 3.2459476309227,
    totalReturnPct: 3.2459476309227,
    dayPnlQuote: 3.2459476309227,
    dayReturnPct: 3.2459476309227,
  },
  skimmedQuote: 3.2459476309227,
  trades: [{ pnlQuote: 3.2459476309226964 }],
  equityHistory: [
    { time: T, equity: 49.943890274314214, skimmed: 0 },
    { time: T + 90_000, equity: 53.31047381546135, skimmed: 0 },
    { time: T + 180_000, equity: 50, skimmed: 3.2459476309227 },
    { time: T + 270_000, equity: 50, skimmed: 3.2459476309227 },
    { time: T + 390_000, equity: 100, skimmed: -46.7540523690773 },
  ],
};

describe("equity na een gewijzigde kapitaallimiet (ronde 3)", () => {
  it("verhoogde limiet: de storting is geen verlies — baseline = beginkapitaal, curve − baseline = resultaat van de engine", async () => {
    const { equityFigures, curveValue } = await loadPublic("js/panels/equity.js");
    const f = equityFigures(liveRaised);
    // rendement blijft t.o.v. het ingelegde kapitaal (startingEquity, incl. storting)
    expect(f.start).toBe(100);
    expect(f.ret).toBeCloseTo(3.2459, 3);
    expect(f.pnl).toBeCloseTo(3.2459, 3);
    // met baseline = startingEquity (€100) zou de curve (€53,25) €46,75 "verlies" tonen
    expect(f.base).toBe(50);
    const last = liveRaised.equityHistory[liveRaised.equityHistory.length - 1];
    expect(curveValue(last) - f.base).toBeCloseTo(liveRaised.account.totalPnlQuote, 2);
    expect(f.netOut).toBeCloseTo(-46.754, 3);
    // de storting geeft geen nep-drawdown
    expect(f.dd).toBeGreaterThan(-0.2);
  });

  it("paneel: stippellijn op € 50, curve loopt door, uitleg over de gewijzigde limiet", async () => {
    const p = await mount(liveRaised);
    expect(p.series.data.map((d: Fake) => Number(d.value.toFixed(2)))).toEqual([49.94, 53.31, 53.25, 53.25, 53.25]);
    expect(p.series.options.find((o: Fake) => o.baseValue)?.baseValue.price).toBe(50);
    expect(p.series.priceLines).toHaveLength(1);
    expect(p.series.priceLines[0].price).toBe(50);
    expect(p.nodes[".eq-ret"].textContent).toBe("+3,25%");
    expect(norm(p.nodes[".eq-s-ret"].title)).toBe("+€ 3,25 t.o.v. start € 100,00");
    const skim = norm(p.nodes[".eq-skim"].innerHTML);
    expect(p.nodes[".eq-skim"].hidden).toBe(false);
    expect(skim).toContain("Afgeroomd boven limiet: <b class=\"mono pos\">€ 3,25</b>");
    expect(skim).toContain("Kapitaallimiet gewijzigd");
    expect(p.nodes[".eq-skim"].classList.contains("is-note")).toBe(false);
  });

  it("verlaagde limiet zonder afromen: baseline blijft startingEquity, wel uitleg, geen afroom-regel", async () => {
    const { equityFigures } = await loadPublic("js/panels/equity.js");
    // €20 kapitaal terug buiten het budget (opname): equity 50 → 30, skimmed (netto eruit) 0 → 20
    const lowered = {
      mode: "live",
      account: { startingEquity: 50, equity: 30, cashQuote: 30, dayStartEquity: 50, totalPnlQuote: 0, totalReturnPct: 0 },
      trades: [],
      equityHistory: [
        { time: T, equity: 50, skimmed: 0 },
        { time: T + 60_000, equity: 30, skimmed: 20 },
      ],
    };
    const f = equityFigures(lowered);
    expect(f.base).toBe(50);
    expect(f.dd).toBe(0);
    const p = await mount(lowered);
    expect(p.series.priceLines[0].price).toBe(50);
    expect(p.series.data.map((d: Fake) => d.value)).toEqual([50, 50]);
    const skim = norm(p.nodes[".eq-skim"].innerHTML);
    expect(skim).toContain("Kapitaallimiet gewijzigd");
    expect(skim).not.toContain("Afgeroomd boven limiet");
    // neutrale uitleg (geen groene "winst"-melding)
    expect(p.nodes[".eq-skim"].classList.contains("is-note")).toBe(true);
  });

  it("zonder gewijzigde limiet blijft de baseline precies startingEquity (geen afrondingsruis)", async () => {
    const { equityFigures } = await loadPublic("js/panels/equity.js");
    const f = equityFigures({ ...liveSkimmed, account: { ...liveSkimmed.account, totalPnlQuote: liveSkimmed.account.totalPnlQuote + 1e-9 } });
    expect(f.base).toBe(50);
    // alleen afgeroomd (netto eruit = afgeroomde winst): geen uitleg over een gewijzigde limiet
    const p = await mount(liveSkimmed);
    expect(p.nodes[".eq-skim"].innerHTML).not.toContain("Kapitaallimiet gewijzigd");
  });
});

// Echte engine-uitkomsten (verifier ronde 3, live). De max. daling was een % van de piek van de
// curve; na een verhoogde limiet is de curve het kleine beginkapitaal + resultaat, dus
// 50 → 100 → 50 met −€ 9,40 verlies gaf −18,81% en 50 → 500 met verlies zelfs −126,96%.
// Nu: grootste daling van het resultaat in EUR, en als % van startingEquity (kapitaal van de bot).
const raiseLower = {
  mode: "live",
  account: { startingEquity: 100, equity: 50, cashQuote: 50, dayStartEquity: 50, totalPnlQuote: -9.403990024937642, totalReturnPct: -9.403990024937642 },
  skimmedQuote: 0,
  trades: [{ pnlQuote: -9.403990024937642 }],
  equityHistory: [
    { time: T, equity: 100, skimmed: -50 },
    { time: T + 900_000, equity: 99.77556109725687, skimmed: -50 },
    { time: T + 960_000, equity: 90.59600997506236, skimmed: -50 },
    { time: T + 1_020_000, equity: 50, skimmed: -9.403990024937642 },
  ],
};
const raiseThenLoss = {
  mode: "live",
  account: { startingEquity: 500, equity: 436.5516882793018, cashQuote: 436.5516882793018, dayStartEquity: 50, totalPnlQuote: -63.4483117206982, totalReturnPct: -12.689662344139641 },
  skimmedQuote: 0,
  trades: [{ pnlQuote: -45.313648379052324 }, { pnlQuote: -18.13466334164588 }],
  equityHistory: [
    { time: T, equity: 49.887780548628434, skimmed: 0 },
    { time: T + 60_000, equity: 31.86533665835412, skimmed: 0 },
    { time: T + 120_000, equity: 481.8653366583541, skimmed: -450 },
    { time: T + 1_020_000, equity: 480.7838653366584, skimmed: -450 },
    { time: T + 1_080_000, equity: 436.5516882793018, skimmed: -450 },
    { time: T + 1_200_000, equity: 436.5516882793018, skimmed: -450 },
  ],
};

describe("max. daling in EUR en als % van startingEquity (ronde 4)", () => {
  it("50 → 100 → 50 met −€ 9,40 verlies: −€ 9,40 = −9,40% van € 100 (niet −18,81%)", async () => {
    const { equityFigures } = await loadPublic("js/panels/equity.js");
    const f = equityFigures(raiseLower);
    expect(f.ddEur).toBeCloseTo(-9.404, 3);
    expect(f.dd).toBeCloseTo(-9.404, 3);
    expect(f.ddBase).toBe(100);
  });

  it("50 → verlies → 500 → verlies: −€ 63,45 = −12,69% van € 500 (niet −126,96%), binnen [−100%, 0]", async () => {
    const { equityFigures } = await loadPublic("js/panels/equity.js");
    const f = equityFigures(raiseThenLoss);
    // Herschreven (ronde 4, lead): de baseline € 50 (resultaat 0, vóór de eerste fee) is de
    // eerste piek → dal 436,55 − 450 = −13,45: daling 63,45 (eerder 63,34 vanaf het eerste
    // punt 49,89, waardoor de fee van de eerste koop ontbrak)
    expect(f.ddEur).toBeCloseTo(-63.448, 3);
    expect(f.dd).toBeCloseTo(-12.690, 3);
    expect(f.dd).toBeGreaterThanOrEqual(-100);
  });

  it("de curve blijft doorlopen bij de storting (geen sprong van € 450)", async () => {
    const p = await mount(raiseThenLoss);
    const vals = p.series.data.map((d: Fake) => Number(d.value.toFixed(2)));
    expect(vals).toEqual([49.89, 31.87, 31.87, 30.78, -13.45, -13.45]);
    expect(Math.max(...vals.slice(1).map((v: number, i: number) => Math.abs(v - vals[i])))).toBeLessThan(45);
  });

  it("paneel: waarde in EUR, % eronder, uitleg met het startkapitaal", async () => {
    const p = await mount(raiseLower);
    expect(norm(p.nodes[".eq-s-dd"].textContent)).toBe("-€ 9,40");
    expect(p.nodes[".eq-s-dd"].className).toContain("neg");
    expect(p.nodes[".eq-s-ddpct"].textContent).toBe("-9,40%");
    expect(norm(p.nodes[".eq-s-ddbox"].title)).toContain("-€ 9,40 = -9,40% van je startkapitaal (€ 100,00)");
  });

  it("zonder daling: € 0,00 en 0,00% (geen '-€ 0,00'), neutraal", async () => {
    const p = await mount({
      mode: "paper",
      account: { equity: 52, startingEquity: 50, totalReturnPct: 4 },
      equityHistory: [
        { time: T, equity: 50 },
        { time: T + 60_000, equity: 52 },
      ],
      trades: [],
    });
    expect(norm(p.nodes[".eq-s-dd"].textContent)).toBe("€ 0,00");
    expect(p.nodes[".eq-s-dd"].className).toContain("flat");
    expect(p.nodes[".eq-s-ddpct"].textContent).toBe("0,00%");
  });

  it("maxDrop: grootste daling van piek naar later dal, niet-getallen overgeslagen", async () => {
    const { maxDrop } = await loadPublic("js/panels/equity.js");
    expect(maxDrop([10, 12, 9, 11, 8, 13])).toBe(4);
    expect(maxDrop([5, 6, 7])).toBe(0);
    expect(maxDrop([NaN, 3, 1])).toBe(2);
    expect(maxDrop([])).toBe(0);
  });
});
