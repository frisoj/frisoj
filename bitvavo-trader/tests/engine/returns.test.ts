/**
 * Ronde 3 — rendementsadministratie (live kapitaallimiet):
 *  - startingEquity = ingelegd kapitaal (start + verhogingen van de limiet), nooit
 *    verlaagd door afromen en nooit afgekapt;
 *  - totalPnlQuote = equity + alles wat eruit ging (afgeroomde winst + kapitaal terug
 *    bij een lagere limiet) − ingelegd; totalReturnPct = totalPnlQuote / ingelegd;
 *  - dayPnlQuote / dayReturnPct t.o.v. de dagstart (+ stortingen vandaag); de
 *    dagelijkse verlieslimiet kijkt naar precies dat dag-%;
 *  - EquityPoint.skimmed = cumulatief netto eruit: equity + skimmed loopt door;
 *  - oudere statusbestanden (start verlaagd met het afgeroomde bedrag) laden correct.
 */
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { DEFAULT_RISK_CONFIG } from "../../src/core/defaults";
import type { AccountSnapshot, EquityPoint, PersistedState } from "../../src/core/types";
import { StateStore } from "../../src/engine/stateStore";
import { RiskManager } from "../../src/risk/riskManager";
import { T0, openBtcPosition, setup, type Harness } from "./helpers";

let dir: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "engine-returns-"));
});
afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

/** Echte rijkdom van de gebruiker binnen de bot-rekening: EUR-mutatie + coins tegen de koers. */
function wealth(h: Harness, startEur: number, limit: number): number {
  const eur = h.broker.balances.get("EUR") ?? 0;
  const btc = h.broker.balances.get("BTC") ?? 0;
  return eur - (startEur - limit) + btc * h.feed.series.get("BTC-EUR")!.at(-1)!.close;
}

/** Nieuwe gesloten candle met een koopsignaal erop. */
function nextBuyCandle(h: Harness, price: number): void {
  h.feed.append("BTC-EUR", price);
  h.clock.set(h.feed.lastTime("BTC-EUR") + 30_000);
  h.signals.buyAt.add(h.lastClosed());
}

function continuous(hist: EquityPoint[], tol: number): void {
  const total = hist.map((p) => p.equity + (p.skimmed ?? 0));
  for (let i = 1; i < total.length; i++) expect(total[i]).toBeGreaterThan(total[i - 1] - tol);
}

describe("Rendement na afromen", () => {
  it("regressie: drie trades van +80% bij limiet €50 (afgeroomd > limiet) → rendement en EUR-resultaat kloppen", async () => {
    const h = setup({ mode: "live", startingCapital: 50 });
    h.engine.arm();
    h.risk.quote = 45;
    h.risk.tpDist = 1e9;
    let price = 50_000;
    for (let i = 0; i < 3; i++) {
      if (i > 0) nextBuyCandle(h, price);
      else h.signals.buyAt.add(h.lastClosed());
      await h.engine.tick();
      const pos = h.engine.snapshot().positions[0];
      expect(pos).toBeDefined();
      price *= 1.8;
      h.feed.setLast("BTC-EUR", price);
      h.clock.advance(60_000);
      await h.engine.closePosition(pos.id);
      const s = h.engine.snapshot();
      const a = s.account;
      const w = wealth(h, 1000, 50);
      expect(a.equity).toBeCloseTo(50, 9); // alles boven de limiet is afgeroomd
      expect(a.startingEquity).toBe(50); // nooit verlaagd, nooit afgekapt
      expect(a.dayStartEquity).toBe(50);
      expect(s.skimmedQuote).toBeCloseTo(w - 50, 9);
      expect(a.totalPnlQuote).toBeCloseTo(w - 50, 9);
      expect(a.totalReturnPct).toBeCloseTo((w / 50 - 1) * 100, 9);
      expect(a.dayPnlQuote).toBeCloseTo(w - 50, 9);
      expect(a.dayReturnPct).toBeCloseTo((w / 50 - 1) * 100, 9);
      const last = s.equityHistory.at(-1)!;
      expect(last.equity + last.skimmed!).toBeCloseTo(w, 9);
    }
    const s = h.engine.snapshot();
    expect(s.skimmedQuote).toBeGreaterThan(100); // meer afgeroomd dan de limiet
    expect(s.account.totalReturnPct).toBeGreaterThan(200);
    continuous(s.equityHistory, 0.5);
  });

  it("de risk manager krijgt een dagstart waarbij zijn dag-% precies dayReturnPct is (ook na afromen)", async () => {
    const h = setup({ mode: "live", startingCapital: 50 });
    h.engine.arm();
    h.risk.quote = 25;
    h.risk.stopDist = 40_000;
    h.risk.tpDist = 40_000;
    const seen: AccountSnapshot[] = [];
    h.risk.haltStatus = (a) => {
      seen.push(a);
      return { halted: false };
    };
    const p1 = await openBtcPosition(h);
    h.feed.setLast("BTC-EUR", 60_000); // +20% → afgeroomd
    await h.engine.closePosition(p1.id);
    nextBuyCandle(h, 50_000);
    h.risk.quote = 45;
    await h.engine.tick();
    const p2 = h.engine.snapshot().positions[0];
    h.feed.setLast("BTC-EUR", 40_000); // flink verlies
    await h.engine.closePosition(p2.id);
    await h.engine.tick();
    const s = h.engine.snapshot();
    expect(s.skimmedQuote).toBeGreaterThan(4);
    const a = seen.at(-1)!;
    expect(((a.equity - a.dayStartEquity) / a.dayStartEquity) * 100).toBeCloseTo(s.account.dayReturnPct!, 9);
    // Echte RiskManager: pauze precies als het dag-% onder -5% komt
    const rm = new RiskManager({ ...DEFAULT_RISK_CONFIG }, "15m");
    const halt = rm.haltStatus(a);
    expect(s.account.dayReturnPct).toBeLessThan(-5);
    expect(halt.halted).toBe(true);
    expect(halt.dailyLimit).toBe(true);
    // dag-% = (equity + vandaag afgeroomd − dagstart) / dagstart
    expect(s.account.dayReturnPct).toBeCloseTo(((s.account.equity + s.skimmedQuote! - 50) / 50) * 100, 9);
  });

  it("paper: resultaat = equity − start, geen 'skimmed' in de equity-punten", async () => {
    const h = setup({ startingCapital: 100 });
    const pos = await openBtcPosition(h);
    h.feed.setLast("BTC-EUR", 55_000);
    const t = (await h.engine.closePosition(pos.id))!;
    const s = h.engine.snapshot();
    expect(s.account.startingEquity).toBe(100);
    expect(s.account.totalPnlQuote).toBeCloseTo(t.pnlQuote, 9);
    expect(s.account.totalReturnPct).toBeCloseTo(t.pnlQuote, 9); // op €100
    expect(s.account.dayPnlQuote).toBeCloseTo(t.pnlQuote, 9);
    expect(s.skimmedQuote).toBe(0);
    expect(s.equityHistory.every((p) => p.skimmed === undefined)).toBe(true);
  });
});

describe("Gewijzigde kapitaallimiet", () => {
  it("limiet verlaagd terwijl er meer in een positie zit: bij verkoop met winst gaat eerst het vastgezette kapitaal terug, alleen de rest is afgeroomde winst", async () => {
    const file = join(dir, "state.json");
    const h1 = setup({ mode: "live", startingCapital: 50, deps: { store: new StateStore(file) } });
    h1.engine.arm();
    h1.risk.quote = 22.5;
    h1.risk.tpDist = 1e9;
    const pos = await openBtcPosition(h1);
    await h1.engine.stop();
    const h2 = setup({
      mode: "live",
      startingCapital: 20,
      clock: h1.clock,
      broker: h1.broker,
      deps: { store: new StateStore(file) },
    });
    h2.engine.arm();
    await h2.engine.tick();
    let s = h2.engine.snapshot();
    const eqBefore = s.account.equity;
    expect(s.account.cashQuote).toBe(0);
    h2.feed.setLast("BTC-EUR", 60_000); // +20%
    const t = (await h2.engine.closePosition(pos.id))!;
    s = h2.engine.snapshot();
    const proceeds = t.proceedsQuote;
    expect(s.account.cashQuote).toBeCloseTo(20, 9);
    // 22,50 inleg > limiet 20: 2,50 kapitaal zat vast en gaat nu alsnog terug; de rest is winst
    expect(s.skimmedQuote).toBeCloseTo(proceeds - 22.5, 9);
    expect(s.skimmedQuote).toBeCloseTo(t.pnlQuote, 9);
    expect(s.account.startingEquity).toBe(50);
    expect(s.account.totalPnlQuote).toBeCloseTo(t.pnlQuote, 9);
    expect(h2.logs().some((m) => m.startsWith("Kapitaallimiet €20,00: €2,50 kapitaal gaat alsnog terug"))).toBe(true);
    expect(
      h2.logs().some((m) => m.startsWith(`Kapitaallimiet €20,00: €${t.pnlQuote.toFixed(2).replace(".", ",")} winst`)),
    ).toBe(true);
    expect(eqBefore).toBeGreaterThan(0);
    continuous(s.equityHistory, 0.2);
  });

  it("verhogen en daarna verlagen van de limiet: geen nep-winst/verlies, EquityPoint.skimmed = netto eruit, grafiek loopt door", async () => {
    const file = join(dir, "state.json");
    const h1 = setup({ mode: "live", startingCapital: 50, deps: { store: new StateStore(file) } });
    await h1.engine.tick();
    await h1.engine.stop();
    // Verhogen naar 80 (storting van 30)
    h1.clock.advance(120_000);
    const h2 = setup({
      mode: "live",
      startingCapital: 80,
      clock: h1.clock,
      broker: h1.broker,
      deps: { store: new StateStore(file) },
    });
    // Direct na het laden (nog geen tick): een nieuw punt met het nieuwe netto-eruit-bedrag
    const first = h2.engine.snapshot().equityHistory;
    expect(first.at(-1)).toEqual({ time: h1.clock.t, equity: 80, skimmed: -30 });
    expect(first.at(-2)).toMatchObject({ equity: 50, skimmed: 0 }); // oude punten ongewijzigd
    await h2.engine.tick();
    let s = h2.engine.snapshot();
    expect(s.account.startingEquity).toBe(80);
    expect(s.account.equity).toBe(80);
    expect(s.account.totalPnlQuote).toBeCloseTo(0, 9);
    expect(s.account.dayPnlQuote).toBeCloseTo(0, 9);
    expect(s.account.dayReturnPct).toBeCloseTo(0, 9);
    expect(s.equityHistory.at(-1)!.skimmed).toBeCloseTo(-30, 9);
    await h2.engine.stop();
    // Verlagen naar 30 (opname van 50)
    h1.clock.advance(120_000);
    const h3 = setup({
      mode: "live",
      startingCapital: 30,
      clock: h1.clock,
      broker: h1.broker,
      deps: { store: new StateStore(file) },
    });
    await h3.engine.tick();
    s = h3.engine.snapshot();
    expect(s.account.startingEquity).toBe(80); // ingelegd: 50 + 30
    expect(s.account.equity).toBe(30);
    expect(s.skimmedQuote).toBe(0); // opname is geen afgeroomde winst
    expect(s.account.totalPnlQuote).toBeCloseTo(0, 9);
    expect(s.account.totalReturnPct).toBeCloseTo(0, 9);
    expect(s.account.dayPnlQuote).toBeCloseTo(0, 9);
    expect(s.equityHistory.at(-1)!.skimmed).toBeCloseTo(20, 9); // 50 terug − 30 erbij
    const total = s.equityHistory.map((p) => p.equity + (p.skimmed ?? 0));
    expect(total.every((v) => Math.abs(v - 50) < 1e-9)).toBe(true);
    expect(h3.logs().some((m) => m.includes("winst"))).toBe(false);
  });
});

describe("Oudere statusbestanden", () => {
  it("bestand van vóór ronde 3 (start en dagstart verlaagd met het afgeroomde bedrag) laadt met dezelfde rendementen", async () => {
    const file = join(dir, "state-live.json");
    const now = T0 + 60_000;
    const skimmed = 12;
    const skimmedToday = 5;
    // Oud model: start 50 − 12 = 38, dagstart (60 − 5) = 55; equity 50 (alles cash)
    const state: PersistedState & { skimmedToday: number } = {
      version: 1,
      mode: "live",
      savedAt: now,
      account: {
        startingEquity: 38,
        cashQuote: 50,
        equity: 50,
        dayStartEquity: 55,
        dayKey: "2026-01-05",
        realizedPnl: 12,
        realizedPnlToday: 0,
        unrealizedPnl: 0,
        feesPaid: 0,
        tradesToday: 1,
        lastLossAt: {},
      },
      positions: [],
      trades: [],
      equityHistory: [
        { time: now - 120_000, equity: 55, skimmed: 7 },
        { time: now - 60_000, equity: 50, skimmed },
      ],
      capitalLimitQuote: 50,
      skimmedQuote: skimmed,
      skimmedToday,
    };
    writeFileSync(file, JSON.stringify(state));
    const h = setup({ mode: "live", startingCapital: 50, deps: { store: new StateStore(file) } });
    const s = h.engine.snapshot();
    const a = s.account;
    // Oud: totaal = (equity − start) / (start + afgeroomd); dag = (equity − dagstart) / (dagstart + vandaag)
    expect(a.startingEquity).toBe(50);
    expect(a.dayStartEquity).toBe(60);
    expect(a.totalReturnPct).toBeCloseTo(((50 - 38) / 50) * 100, 9);
    expect(a.dayReturnPct).toBeCloseTo(((50 - 55) / 60) * 100, 9);
    expect(a.totalPnlQuote).toBeCloseTo(12, 9);
    expect(a.dayPnlQuote).toBeCloseTo(-5, 9);
    expect(s.skimmedQuote).toBe(skimmed);
    // Oude punten blijven zoals ze waren; het volgende punt sluit aan
    expect(s.equityHistory.map((p) => p.skimmed)).toEqual([7, 12]);
    h.clock.advance(60_000);
    await h.engine.tick();
    const last = h.engine.snapshot().equityHistory.at(-1)!;
    expect(last.equity + last.skimmed!).toBeCloseTo(62, 9);
    // Na opslaan: nieuw formaat, nogmaals laden verandert niets meer
    await h.engine.stop();
    const h2 = setup({ mode: "live", startingCapital: 50, clock: h.clock, deps: { store: new StateStore(file) } });
    const a2 = h2.engine.snapshot().account;
    expect(a2.startingEquity).toBe(50);
    expect(a2.dayStartEquity).toBe(60);
    expect(a2.totalPnlQuote).toBeCloseTo(12, 9);
  });
});
