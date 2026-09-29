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
    expect(html).toContain('<span class="muted">Dagresultaat</span><b class="mono neg">-€ 0,06</b>');
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
    expect(html).toContain('<span class="muted">Dagresultaat</span><b class="mono neg">-€ 2,00</b>');
    expect(html).toMatch(/data-k="day"[^>]*>[\s\S]*?<div class="risk-g-val mono">4,0%<\/div>/);
  });
});
