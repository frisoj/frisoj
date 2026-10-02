/**
 * Risicopaneel (public/js/panels/risk.js): dagresultaat en dagverlies-meter komen
 * van de engine (account.dayPnlQuote / dayReturnPct), zodat afgeroomde winst
 * (live, boven de kapitaallimiet) geen nep-dagverlies geeft. Echte module, nep-DOM.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fakeNode, installBrowserGlobals, loadPublic, makeBus, type Fake } from "./helpers";

const norm = (s: string) => s.replace(/\s+/g, " ");
const config = {
  risk: { dailyLossLimitPct: 5, maxTotalExposurePct: 90, maxTradesPerDay: 6, maxOpenPositions: 2, riskPerTradePct: 1.5, takerFee: 0.0025, slippagePct: 0.0005 },
};

let env: ReturnType<typeof installBrowserGlobals>;
beforeEach(() => {
  env = installBrowserGlobals();
});
afterEach(() => {
  vi.restoreAllMocks();
  env.restore();
});

async function mount(snap: Fake) {
  const { mountRisk } = await loadPublic("js/panels/risk.js");
  const { fmt, esc } = await loadPublic("js/format.js");
  const el = fakeNode();
  const bus = makeBus();
  mountRisk({ fmt, esc, bus, getState: () => snap }, el);
  return { html: () => norm(String(el.innerHTML)), bus };
}

describe("risicopaneel: dagresultaat", () => {
  it("live na afromen: engine-cijfers (−€ 0,06 / 0,1%), niet equity − dagstart (−€ 3,31 / 6,2%)", async () => {
    // Echte engine-uitkomst (ronde 3): dagwissel met open positie, daarna +€3,25 winst afgeroomd bij het sluiten
    const p = await mount({
      mode: "live",
      liveArmed: true,
      config,
      positions: [],
      halted: { halted: false },
      account: {
        equity: 50,
        cashQuote: 50,
        startingEquity: 50,
        dayStartEquity: 53.31047381546135,
        tradesToday: 0,
        feesPaid: 0.12,
        dayPnlQuote: -0.06452618453865,
        dayReturnPct: -0.12103847503215366,
      },
    });
    const html = p.html();
    expect(html).toContain('<span class="muted">Dagresultaat</span><b class="mono neg">-€ 0,06 <small>(-0,12%)</small></b>');
    expect(html).toMatch(/data-k="day"[^>]*>[\s\S]*?<div class="risk-g-val mono">0,1%<\/div>/);
    expect(html).toMatch(/<div class="risk-g" data-lv="ok" data-k="day"/);
    expect(html).not.toContain("-€ 3,31");
  });

  it("oudere server (geen engine-velden): zelf rekenen met equity − dagstart", async () => {
    const p = await mount({
      mode: "paper",
      config,
      positions: [],
      halted: { halted: false },
      account: { equity: 48, cashQuote: 48, startingEquity: 50, dayStartEquity: 50, tradesToday: 1, feesPaid: 0.1 },
    });
    const html = p.html();
    expect(html).toContain('<span class="muted">Dagresultaat</span><b class="mono neg">-€ 2,00 <small>(-4,00%)</small></b>');
    expect(html).toMatch(/data-k="day"[^>]*>[\s\S]*?<div class="risk-g-val mono">4,0%<\/div>/);
  });
});

describe("risicopaneel: dagdoel", () => {
  const withTarget = { risk: { ...config.risk, dailyProfitTargetPct: 1 } };
  const account = { equity: 50.2, cashQuote: 50.2, startingEquity: 50, dayStartEquity: 50, tradesToday: 1, feesPaid: 0.1, dayPnlQuote: 0.2, dayReturnPct: 0.4 };

  it("toont de voortgang naar het dagdoel; zonder dagdoel geen regel", async () => {
    const p = await mount({ mode: "paper", config: withTarget, positions: [], halted: { halted: false }, account });
    expect(p.html()).toContain('<span class="muted">Dagdoel</span><b class="mono risk-kv-wrap">+0,40% <small class="muted">van +1%</small></b>');
    const off = await mount({ mode: "paper", config, positions: [], halted: { halted: false }, account });
    expect(off.html()).not.toContain(">Dagdoel<");
  });

  it("gehaald: de grens is actief, de bot handelt door", async () => {
    const p = await mount({
      mode: "paper",
      config: withTarget,
      positions: [],
      halted: { halted: false },
      account: { ...account, equity: 51, dayPnlQuote: 1, dayReturnPct: 2, dayTargetReached: true },
    });
    const html = p.html();
    expect(html).toContain('<span class="muted">Dagdoel</span><b class="mono risk-kv-wrap"><span class="pos">gehaald ✓</span> <small class="muted">grens +1%</small></b>');
    expect(html).not.toContain("pn-banner-good");
  });

  it("teruggevallen tot de grens: groene melding 'Winst vastgezet' in plaats van 'Handel gepauzeerd'", async () => {
    const p = await mount({
      mode: "paper",
      config: withTarget,
      positions: [],
      halted: { halted: true, dailyTarget: true, reason: "Dagwinst vandaag vastgezet: geen nieuwe trades tot morgen" },
      account: { ...account, equity: 50.5, dayPnlQuote: 0.5, dayReturnPct: 1, dayTargetReached: true },
    });
    const html = p.html();
    expect(html).toContain('class="pn-banner pn-banner-good pn-banner-ico risk-target"');
    expect(html).toContain("<b>Winst vastgezet</b>");
    expect(html).not.toContain("Handel gepauzeerd");
    expect(html).toContain('<span class="pos">winst vastgezet ✓</span>');
  });
});


// Ronde 6: het dagdoel telt NA de geschatte verkoopkosten van de open posities (zoals de
// engine), en "open posities zijn verkocht" alleen als er echt niets meer open staat.
describe("risicopaneel: dagdoel na verkoopkosten", () => {
  const withTarget = { risk: { ...config.risk, dailyProfitTargetPct: 1 } };
  // 1 positie, koers 102,70: bruto +1,10% op de dag, maar verkopen kost 102,70 × 0,30% = € 0,31
  const pos = { id: "p1", market: "AAA-EUR", amount: 1, entryPrice: 100, currentPrice: 102.7 };
  const account = { equity: 101.1, cashQuote: -1.6, startingEquity: 100, dayStartEquity: 100, tradesToday: 1, feesPaid: 0.25, dayPnlQuote: 1.1, dayReturnPct: 1.1 };

  it("voortgang na verkoopkosten: 'Dagdoel (na kosten) +0,79% van +1%', niet het bruto '+1,10%'", async () => {
    const p = await mount({ mode: "paper", running: true, config: withTarget, positions: [pos], halted: { halted: false }, account });
    const html = p.html();
    expect(html).toContain('<span class="muted">Dagdoel <small>(na kosten)</small></span><b class="mono risk-kv-wrap">+0,79% <small class="muted">van +1%</small></b>');
    expect(html).not.toMatch(/Dagdoel.*?<\/span><b class="mono risk-kv-wrap">\+1,10%/);
    // het dagresultaat zelf blijft het bruto resultaat (incl. open posities)
    expect(html).toContain('<span class="muted">Dagresultaat</span><b class="mono pos">+€ 1,10 <small>(+1,10%)</small></b>');
  });

  it("de kosten van de engine (account.exitCostQuote) gaan voor de eigen schatting", async () => {
    const p = await mount({ mode: "paper", running: true, config: withTarget, positions: [pos], halted: { halted: false }, account: { ...account, exitCostQuote: 0.2 } });
    expect(p.html()).toContain(">+0,90% <small class=\"muted\">van +1%</small></b>");
  });

  it("netDayView: dagbasis van de engine (equity / (1 + dag-%)), ook na afromen", async () => {
    const { netDayView } = await loadPublic("js/panels/risk.js");
    // live: € 3 afgeroomd vandaag; equity 50, dag +2% → basis 50 / 1,02
    const v = netDayView({ account: { equity: 50, dayStartEquity: 52, dayReturnPct: 2, exitCostQuote: 0.1 }, positions: [], config });
    expect(v.pct).toBeCloseTo(2 - (0.1 / (50 / 1.02)) * 100, 9);
    expect(netDayView({ account: {} })).toBeNull();
    expect(netDayView(null)).toBeNull();
    // geen posities, geen kosten: gelijk aan het dag-%
    expect(netDayView({ account: { equity: 50, dayStartEquity: 50, dayReturnPct: 0.4 }, positions: [], config }).pct).toBeCloseTo(0.4, 9);
  });
});

describe("risicopaneel: 'Winst vastgezet' met posities die nog open staan", () => {
  const withTarget = { risk: { ...config.risk, dailyProfitTargetPct: 1 } };
  const halted = { halted: true, dailyTarget: true, reason: "Dagwinst teruggevallen naar +0,65% (winstgrens +1%): winst vastgezet, geen nieuwe trades tot morgen" };
  const pos = { id: "p1", market: "AAA-EUR", amount: 0.45, entryPrice: 100, currentPrice: 102 };
  const account = { equity: 100.79, cashQuote: 54.9, startingEquity: 100, dayStartEquity: 100, tradesToday: 1, feesPaid: 0.11, dayPnlQuote: 0.79, dayReturnPct: 0.79, dayTargetReached: true };
  const base = { mode: "paper", running: true, liveArmed: false, config: withTarget, halted, account };

  it("verkoop geweigerd (positie nog open): NIET 'open posities zijn verkocht', wel wat er nog open staat", async () => {
    const html = (await mount({ ...base, positions: [pos] })).html();
    expect(html).toContain("<b>Winst vastgezet</b>");
    expect(html).not.toContain("open posities zijn verkocht");
    expect(html).toContain(
      '<div class="risk-target-open">De dagwinst viel terug tot je winstgrens. Er staat nog 1 positie open. De bot probeert die te verkopen (zie Posities). Morgen gaat de bot weer verder.</div>',
    );
  });

  it("live zonder ingeschakelde live handel, of een stilstaande bot: zelf sluiten", async () => {
    const live = (await mount({ ...base, mode: "live", liveArmed: false, positions: [pos, { ...pos, id: "p2", market: "BBB-EUR" }] })).html();
    expect(live).toContain(
      "Er staan nog 2 posities open. Live handel staat uit, dus de bot verkoopt ze niet vanzelf: sluit ze bij Posities (knop Sluit) of zet live handel aan.",
    );
    const stopped = (await mount({ ...base, running: false, positions: [pos] })).html();
    expect(stopped).toContain("De bot staat stil en verkoopt die niet vanzelf: sluit die bij Posities (knop Sluit) of start de bot.");
  });

  it("alles verkocht: de oude tekst", async () => {
    const html = (await mount({ ...base, positions: [] })).html();
    expect(html).toContain('<div class="muted">De dagwinst viel terug tot je winstgrens: open posities zijn verkocht. Morgen gaat de bot weer verder.</div>');
  });

  it("een stilstaande bot belooft niet dat hij morgen vanzelf verdergaat", async () => {
    const html = (await mount({ ...base, running: false, positions: [] })).html();
    expect(html).toContain("open posities zijn verkocht. Start de bot weer als je morgen verder wilt.");
    expect(html).not.toContain("Morgen gaat de bot weer verder");
  });
});

describe("risicopaneel met een echte engine-snapshot", () => {
  async function engineHarness() {
    const { setup, I15 } = await import("../engine/helpers");
    const { RiskManager } = await import("../../src/risk/riskManager");
    const { DEFAULT_RISK_CONFIG } = await import("../../src/core/defaults");
    const h = setup({
      markets: ["AAA-EUR", "BBB-EUR"],
      startingCapital: 100,
      config: { risk: { ...DEFAULT_RISK_CONFIG, dailyProfitTargetPct: 1, maxSpreadPct: 0, takeProfitR: 5 } },
      deps: { createRisk: (cfg: Fake, interval: Fake) => new RiskManager(cfg, interval) },
    });
    const last = Math.floor(h.clock.t / I15) * I15;
    for (const m of ["AAA-EUR", "BBB-EUR"]) h.feed.setSeries(m, 100, last);
    h.signals.atr = 1;
    h.signals.buyMarkets = new Set(["AAA-EUR"]);
    h.signals.buyAt.add(h.lastClosed());
    await h.engine.tick();
    h.signals.buyMarkets = new Set();
    return h;
  }
  const snapOf = (h: Fake) => JSON.parse(JSON.stringify(h.engine.snapshot()));

  it("bruto boven het doel, na kosten eronder: het paneel laat het netto cijfer zien (zoals de engine)", async () => {
    const h = await engineHarness();
    h.feed.setLast("AAA-EUR", 102.7);
    await h.engine.tick();
    const s = snapOf(h);
    expect(s.account.dayReturnPct).toBeGreaterThan(1);
    expect(s.account.dayTargetReached).toBe(false);
    const html = (await mount(s)).html();
    const row = /<span class="muted">Dagdoel <small>\(na kosten\)<\/small><\/span><b class="mono risk-kv-wrap">([+-][\d,]+)% <small class="muted">van \+1%<\/small><\/b>/.exec(html);
    expect(row).not.toBeNull();
    expect(Number(row![1].replace(",", "."))).toBeLessThan(1);
    await h.engine.stop();
  });

  it("winst vastgezet maar de verkoop werd geweigerd: de melding zegt dat er nog een positie open staat", async () => {
    const h = await engineHarness();
    h.feed.setLast("AAA-EUR", 104);
    await h.engine.tick(); // doel gehaald → grens actief
    h.broker.rejectSells = 1000;
    h.feed.setLast("AAA-EUR", 102);
    await h.engine.tick(); // terug tot de grens → vastzetten, verkoop geweigerd
    const s = snapOf(h);
    expect(s.halted).toMatchObject({ halted: true, dailyTarget: true });
    expect(s.positions).toHaveLength(1);
    const html = (await mount(s)).html();
    expect(html).toContain("<b>Winst vastgezet</b>");
    expect(html).not.toContain("open posities zijn verkocht");
    expect(html).toContain("Er staat nog 1 positie open.");
    await h.engine.stop();
  });
});
