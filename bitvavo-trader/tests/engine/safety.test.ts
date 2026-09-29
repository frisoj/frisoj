/**
 * Regressietests voor de veiligheidsfixes van de engine: Stop/noodstop tijdens
 * een lopende tick, dubbele koop op hetzelfde signaal, kapitaallimiet (cash +
 * posities, afromen is geen verlies), dagelijkse verlieslimiet die tot morgen
 * geldt, dagwissel direct na een herstart, strategie-warmup en een onbruikbaar
 * statusbestand. Gebruikt de ECHTE RiskManager.haltStatus waar het om de
 * verlieslimiet gaat.
 */
import { mkdtempSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { DEFAULT_ENGINE_CONFIG, DEFAULT_ENSEMBLE_CONFIG, DEFAULT_RISK_CONFIG } from "../../src/core/defaults";
import type { EnsembleDecision } from "../../src/core/types";
import { SimulatedFeed } from "../../src/data/simulatedFeed";
import { StateStore } from "../../src/engine/stateStore";
import { TradingEngine, candlesToFetch, requiredWarmupCandles } from "../../src/engine/tradingEngine";
import { RiskManager } from "../../src/risk/riskManager";
import { runEnsemble } from "../../src/strategies/ensemble";
import { Clock, Deferred, FakeBroker, FakeFeed, I15, T0, openBtcPosition, setup, testConfig, type Harness } from "./helpers";

/** Dagelijkse verlieslimiet via de echte RiskManager (standaard: 5%). */
function realHalt(h: Harness): void {
  const rm = new RiskManager({ ...DEFAULT_RISK_CONFIG }, "15m");
  h.risk.haltStatus = (a) => rm.haltStatus(a);
}

async function waitFor(cond: () => boolean): Promise<void> {
  for (let i = 0; i < 1000 && !cond(); i++) await new Promise((r) => setImmediate(r));
  if (!cond()) throw new Error("waitFor: voorwaarde niet gehaald");
}

/** 00:30 Amsterdam op 6 januari 2026 (de dag na T0) */
const NEXT_DAY = Date.UTC(2026, 0, 5, 23, 30);

let dir: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "engine-safety-"));
});
afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

describe("Stop / noodstop tijdens een lopende tick", () => {
  it("Stop terwijl de tick candles ophaalt: geen enkele kooporder meer", async () => {
    const h = setup({ mode: "live", startingCapital: 50, markets: ["BTC-EUR", "ETH-EUR"] });
    h.engine.arm();
    h.signals.buyAt.add(h.lastClosed());
    const gate = new Deferred();
    h.feed.gate = gate.promise;
    const tick = h.engine.tick();
    await waitFor(() => h.feed.calls.length > 0); // tick hangt in getCandles(BTC)
    const stopping = h.engine.stop();
    gate.resolve();
    h.feed.gate = null;
    await tick;
    await stopping;
    expect(h.broker.buys()).toHaveLength(0);
    expect(h.engine.snapshot().positions).toHaveLength(0);
    expect(h.engine.snapshot().running).toBe(false);

    // Een volgende (handmatige) tick werkt gewoon weer
    h.feed.append("BTC-EUR", 50_000);
    h.feed.append("ETH-EUR", 3_000);
    h.clock.set(h.feed.lastTime("BTC-EUR") + 30_000);
    h.signals.buyAt.add(h.lastClosed());
    await h.engine.tick();
    expect(h.broker.buys()).toHaveLength(2);
  });

  it("Stop tijdens de saldo-controle vlak vóór een live koop: order wordt niet verstuurd", async () => {
    const h = setup({ mode: "live", startingCapital: 50 });
    h.engine.arm();
    h.signals.buyAt.add(h.lastClosed());
    const gate = new Deferred();
    let balanceCalls = 0;
    const orig = h.broker.getBalances.bind(h.broker);
    h.broker.getBalances = async () => {
      balanceCalls++;
      await gate.promise;
      return orig();
    };
    const tick = h.engine.tick();
    await waitFor(() => balanceCalls > 0);
    const stopping = h.engine.stop();
    gate.resolve();
    await tick;
    await stopping;
    expect(h.broker.orders).toHaveLength(0);
    expect(h.logs().some((m) => m.startsWith("Koop BTC-EUR geannuleerd: bot gestopt/ontwapend"))).toBe(true);
  });

  it("Ontwapenen tijdens de saldo-controle: order wordt niet verstuurd", async () => {
    const h = setup({ mode: "live", startingCapital: 50 });
    h.engine.arm();
    h.signals.buyAt.add(h.lastClosed());
    const gate = new Deferred();
    let balanceCalls = 0;
    const orig = h.broker.getBalances.bind(h.broker);
    h.broker.getBalances = async () => {
      balanceCalls++;
      await gate.promise;
      return orig();
    };
    const tick = h.engine.tick();
    await waitFor(() => balanceCalls > 0);
    h.engine.disarm();
    gate.resolve();
    await tick;
    expect(h.broker.orders).toHaveLength(0);
  });

  it("NOODSTOP tijdens een lopende tick: geen nieuwe kopen, bestaande positie wel verkocht, ontwapend", async () => {
    const h = setup({ mode: "live", startingCapital: 50, markets: ["BTC-EUR", "ETH-EUR"] });
    h.engine.arm();
    // Eerst alleen een BTC-positie (ETH-candles liggen 5 min verschoven: geen signaal)
    h.feed.setSeries("ETH-EUR", 3_000, T0 - 5 * 60_000);
    await openBtcPosition(h);
    expect(h.broker.buys()).toHaveLength(1);

    // Nieuwe candle: ETH krijgt een koopsignaal; de tick hangt in getCandles
    h.feed.append("BTC-EUR", 50_000);
    h.feed.append("ETH-EUR", 3_000);
    h.clock.set(T0 + I15 + 30_000);
    h.signals.buyAt.add(T0 - 5 * 60_000);
    const gate = new Deferred();
    h.feed.gate = gate.promise;
    const callsBefore = h.feed.calls.length;
    const tick = h.engine.tick();
    await waitFor(() => h.feed.calls.length > callsBefore);
    const killing = h.engine.killSwitch();
    expect(h.engine.liveArmed).toBe(false); // direct ontwapend
    gate.resolve();
    h.feed.gate = null;
    await tick;
    await killing;

    expect(h.broker.buys()).toHaveLength(1); // alleen de oude BTC-koop
    expect(h.broker.sells()).toHaveLength(1);
    const s = h.engine.snapshot();
    expect(s.positions).toHaveLength(0);
    expect(s.running).toBe(false);
    expect(s.liveArmed).toBe(false);
    expect(s.trades.map((t) => t.exitReason)).toEqual(["kill-switch"]);
    expect(h.logs().some((m) => m.startsWith("NOODSTOP geactiveerd: 1 open positie"))).toBe(true);
    expect(h.logs().some((m) => m.startsWith("NOODSTOP voltooid: 1 positie(s) gesloten"))).toBe(true);
    expect(h.logs().some((m) => m === "Live mode ontwapend na de noodstop")).toBe(true);
  });

  it("een tick die nog op de lock wacht als Stop komt, koopt ook niet", async () => {
    const h = setup({ markets: ["BTC-EUR"] });
    const pos = await openBtcPosition(h);
    // Handmatig sluiten houdt de lock vast (koers ophalen hangt)
    const gate = new Deferred();
    const origPrice = h.feed.getPrice.bind(h.feed);
    h.feed.getPrice = async (m) => {
      await gate.promise;
      return origPrice(m);
    };
    const closing = h.engine.closePosition(pos.id);
    h.feed.append("BTC-EUR", 50_000);
    h.clock.set(T0 + I15 + 30_000);
    h.signals.buyAt.add(T0);
    const tick = h.engine.tick(); // wacht op de lock
    const stopping = h.engine.stop();
    gate.resolve();
    await closing;
    await tick;
    await stopping;
    expect(h.broker.buys()).toHaveLength(1);
  });
});

describe("Hetzelfde signaal niet opnieuw verhandelen na een herstart", () => {
  it("paper: koop + take-profit, herstart binnen dezelfde candle → geen tweede koop", async () => {
    const file = join(dir, "state.json");
    const clock = new Clock(T0 + 60_000);
    const feed = new FakeFeed();
    feed.setSeries("BTC-EUR", 50_000, T0);
    const h1 = setup({ clock, feed, deps: { store: new StateStore(file) } });
    await openBtcPosition(h1);
    clock.advance(15_000);
    feed.setLast("BTC-EUR", 52_100); // take-profit
    await h1.engine.tick();
    expect(h1.engine.snapshot().trades).toHaveLength(1);
    await h1.engine.stop();

    clock.advance(60_000);
    const h2 = setup({ clock, feed, deps: { store: new StateStore(file) } });
    h2.signals.buyAt.add(T0 - I15);
    await h2.engine.start();
    await h2.engine.stop();
    expect(h2.broker.buys()).toHaveLength(0);
    expect(h2.signals.decide).toHaveBeenCalled(); // wel beoordeeld (beslissing zichtbaar in de UI)
    expect(h2.engine.snapshot().decisions["BTC-EUR"]?.action).toBe("buy");
  });

  it("live: 'zou kopen' zonder arm, herstart en armen vóór start → geen koop op die oude candle", async () => {
    const file = join(dir, "state-live.json");
    const clock = new Clock(T0 + 60_000);
    const feed = new FakeFeed();
    feed.setSeries("BTC-EUR", 50_000, T0);
    const h1 = setup({ mode: "live", startingCapital: 50, clock, feed, deps: { store: new StateStore(file) } });
    h1.signals.buyAt.add(T0 - I15);
    await h1.engine.tick();
    expect(h1.logs().some((m) => m.startsWith("Live mode niet gearmd: zou kopen BTC-EUR"))).toBe(true);
    await h1.engine.stop();

    clock.advance(5 * 60_000);
    const h2 = setup({ mode: "live", startingCapital: 50, clock, feed, deps: { store: new StateStore(file) } });
    h2.signals.buyAt.add(T0 - I15);
    h2.engine.arm();
    await h2.engine.start();
    expect(h2.broker.orders).toHaveLength(0);
    expect(h2.logs().some((m) => m.includes("vóór de herstart al beoordeeld"))).toBe(true);

    // De volgende candle gewoon wel
    feed.append("BTC-EUR", 50_000);
    clock.set(T0 + I15 + 30_000);
    h2.signals.buyAt.add(T0);
    await h2.engine.tick();
    expect(h2.broker.buys()).toHaveLength(1);
    await h2.engine.stop();
  });
});

describe("Kapitaallimiet (live)", () => {
  it("afgeroomde winst telt niet als dagverlies: een winnende trade na middernacht pauzeert de handel niet", async () => {
    const h = setup({ mode: "live", startingCapital: 50 });
    realHalt(h);
    h.engine.arm();
    h.risk.quote = 22.5;
    h.risk.tpDist = 40_000;
    const pos = await openBtcPosition(h);
    // +15% op dag 1 om 22:00, positie blijft over middernacht open
    h.feed.setLast("BTC-EUR", 57_500);
    h.clock.set(Date.UTC(2026, 0, 5, 21, 0));
    await h.engine.tick();
    h.clock.set(NEXT_DAY);
    await h.engine.tick();
    let s = h.engine.snapshot();
    expect(s.account.dayKey).toBe("2026-01-06");
    const dayStart = s.account.dayStartEquity;
    expect(dayStart).toBeGreaterThan(53);

    const trade = (await h.engine.closePosition(pos.id))!;
    expect(trade.pnlQuote).toBeGreaterThan(3);
    await h.engine.tick();
    s = h.engine.snapshot();
    expect(s.account.cashQuote).toBeCloseTo(50, 9);
    expect(s.halted.halted).toBe(false);
    expect(s.skimmedQuote).toBeCloseTo(trade.proceedsQuote + 27.5 - 50, 9);
    // Herschreven (ronde 3): afromen verlaagde start- en dag-startequity (dat liep vast
    // zodra er meer afgeroomd was dan de limiet). Nu blijven ze staan en telt het
    // afgeroomde bedrag als overboeking mee in het resultaat.
    expect(s.account.dayStartEquity).toBeCloseTo(dayStart, 9);
    expect(s.account.startingEquity).toBe(50);
    expect(s.account.totalPnlQuote).toBeCloseTo(trade.pnlQuote, 9);
    expect(s.account.dayPnlQuote).toBeCloseTo(s.account.equity + s.skimmedQuote! - dayStart, 9);
    // Rendementen tellen het afgeroomde bedrag mee (geen winst of verlies door afromen)
    expect(s.account.totalReturnPct).toBeCloseTo(((s.account.equity + s.skimmedQuote! - 50) / 50) * 100, 9);
    expect(s.account.dayReturnPct).toBeCloseTo(((s.account.equity + s.skimmedQuote!) / dayStart - 1) * 100, 9);
    expect(s.account.dayReturnPct).toBeLessThan(0); // alleen de exit-fee
    expect(s.account.dayReturnPct).toBeGreaterThan(-0.3);
    // Elk equity-punt heeft het cumulatief afgeroomde bedrag: equity + afgeroomd daalt niet door het afromen
    const hist = s.equityHistory;
    expect(hist[0].skimmed).toBe(0);
    expect(hist[hist.length - 1].skimmed).toBeCloseTo(s.skimmedQuote!, 9);
    const total = hist.map((p) => p.equity + (p.skimmed ?? 0));
    for (let i = 1; i < total.length; i++) expect(total[i]).toBeGreaterThan(total[i - 1] - 0.1);
  });

  it("afromen en daarna verlies op dezelfde dag: dag-% = (equity + vandaag afgeroomd − dagstart) / dagstart, ook voor de verlieslimiet", async () => {
    const file = join(dir, "state.json");
    const h = setup({ mode: "live", startingCapital: 50, deps: { store: new StateStore(file) } });
    realHalt(h);
    h.engine.arm();
    h.risk.quote = 25;
    h.risk.stopDist = 40_000;
    h.risk.tpDist = 40_000;
    const p1 = await openBtcPosition(h);
    h.feed.setLast("BTC-EUR", 60_000); // +20%
    await h.engine.closePosition(p1.id);
    let s = h.engine.snapshot();
    const skimmed = s.skimmedQuote!;
    expect(skimmed).toBeGreaterThan(4);
    expect(s.account.cashQuote).toBeCloseTo(50, 9);
    expect(s.account.dayReturnPct).toBeCloseTo(((50 + skimmed) / 50 - 1) * 100, 9);

    // Tweede trade verliest ~€6,8 van het (afgeroomde) budget van €50
    h.risk.quote = 40;
    h.feed.append("BTC-EUR", 50_000);
    h.clock.set(h.feed.lastTime("BTC-EUR") + 30_000);
    h.signals.buyAt.add(h.lastClosed());
    await h.engine.tick();
    const p2 = h.engine.snapshot().positions[0];
    h.feed.setLast("BTC-EUR", 41_800);
    await h.engine.closePosition(p2.id);
    await h.engine.tick();
    s = h.engine.snapshot();
    const truePct = ((s.account.equity + skimmed - 50) / 50) * 100;
    expect(truePct).toBeLessThan(-3);
    expect(truePct).toBeGreaterThan(-5);
    expect(s.account.dayReturnPct).toBeCloseTo(truePct, 9);
    expect(s.account.totalReturnPct).toBeCloseTo(truePct, 9);
    // EUR-dagresultaat = wat vandaag echt gerealiseerd is (herschreven in ronde 3: was
    // equity − dagstart, toen de dagstart nog met het afgeroomde bedrag omlaag ging)
    expect(s.account.dayPnlQuote).toBeCloseTo(s.account.realizedPnlToday, 9);
    expect(s.account.dayStartEquity).toBe(50);
    expect(s.account.totalPnlQuote).toBeCloseTo(s.account.realizedPnl, 9);
    // De limiet (5%) kijkt naar hetzelfde dag-% (naar rato schalen gaf ~-5,3% → onterechte pauze)
    expect(s.halted.halted).toBe(false);
    await h.engine.stop();

    // Herstart op dezelfde dag: zelfde dag-%
    const h2 = setup({ mode: "live", startingCapital: 50, clock: h.clock, feed: h.feed, deps: { store: new StateStore(file) } });
    realHalt(h2);
    await h2.engine.tick();
    s = h2.engine.snapshot();
    expect(s.account.dayReturnPct).toBeCloseTo(truePct, 9);
    expect(s.halted.halted).toBe(false);

    // Dagwissel: het afgeroomde bedrag van gisteren telt niet meer mee voor vandaag
    h2.clock.set(NEXT_DAY);
    await h2.engine.tick();
    s = h2.engine.snapshot();
    expect(s.account.dayKey).toBe("2026-01-06");
    expect(s.account.dayReturnPct).toBeCloseTo(0, 9);
    expect(s.account.totalReturnPct).toBeCloseTo(truePct, 9);
  });

  it("cash + inleg van open posities blijft binnen de limiet als een winnaar sluit terwijl een andere positie openstaat", async () => {
    const h = setup({ mode: "live", startingCapital: 50, markets: ["BTC-EUR", "ETH-EUR"] });
    realHalt(h);
    h.engine.arm();
    h.risk.quote = 22.5;
    h.risk.tpDist = 60_000;
    await openBtcPosition(h); // koopt BTC én ETH (zelfde candle)
    let s = h.engine.snapshot();
    expect(s.positions).toHaveLength(2);
    const btc = s.positions.find((p) => p.market === "BTC-EUR")!;
    h.feed.setLast("BTC-EUR", 70_000); // +40%
    await h.engine.closePosition(btc.id);
    s = h.engine.snapshot();
    const openCost = s.positions.reduce((a, p) => a + p.costQuote, 0);
    expect(s.positions).toHaveLength(1);
    expect(s.account.cashQuote + openCost).toBeCloseTo(50, 9);
    expect(s.logs.some((l) => l.message.startsWith("Kapitaallimiet €50,00"))).toBe(true);
    await h.engine.tick();
    expect(h.engine.snapshot().halted.halted).toBe(false);
  });

  it("herstart met een HOGERE limiet geeft extra budget (zonder nep-winst of halt)", async () => {
    const file = join(dir, "state.json");
    const h1 = setup({ mode: "live", startingCapital: 20, deps: { store: new StateStore(file) } });
    await h1.engine.stop();
    const h2 = setup({ mode: "live", startingCapital: 100, deps: { store: new StateStore(file) } });
    realHalt(h2);
    let s = h2.engine.snapshot();
    expect(s.account.cashQuote).toBe(100);
    // Ingelegd kapitaal = 20 + 80 verhoging
    expect(s.account.startingEquity).toBe(100);
    // Herschreven (ronde 3): de dagstart ging mee omhoog; nu blijft hij de equity bij
    // de dagwissel en telt de storting apart (resultaat vandaag 0, niet +400%).
    expect(s.account.dayStartEquity).toBe(20);
    expect(s.account.totalPnlQuote).toBeCloseTo(0, 9);
    expect(s.account.totalReturnPct).toBeCloseTo(0, 9);
    expect(s.account.dayPnlQuote).toBeCloseTo(0, 9);
    expect(s.account.dayReturnPct).toBeCloseTo(0, 9);
    expect(h2.logs().some((m) => m.startsWith("Kapitaallimiet €20,00 → €100,00: €80,00 extra kapitaal"))).toBe(true);
    await h2.engine.tick();
    s = h2.engine.snapshot();
    expect(s.halted.halted).toBe(false);
    // Grafiek: equity + netto eruit (−80 verhoging) loopt door vanaf de oude €20
    const last = s.equityHistory[s.equityHistory.length - 1];
    expect(last.equity).toBeCloseTo(100, 9);
    expect(last.skimmed).toBeCloseTo(-80, 9);
  });

  it("herstart met een LAGERE limiet telt open posities mee en pauzeert de handel niet", async () => {
    const file = join(dir, "state.json");
    const h1 = setup({ mode: "live", startingCapital: 50, deps: { store: new StateStore(file) } });
    h1.engine.arm();
    h1.risk.quote = 22.5;
    await openBtcPosition(h1);
    await h1.engine.stop();

    const before = h1.engine.snapshot().account;
    const h2 = setup({ mode: "live", startingCapital: 20, clock: h1.clock, broker: h1.broker, deps: { store: new StateStore(file) } });
    realHalt(h2);
    await h2.engine.tick();
    let s = h2.engine.snapshot();
    expect(s.positions).toHaveLength(1);
    expect(s.account.cashQuote).toBe(0); // inleg 22,50 > limiet 20: geen cash meer
    expect(s.halted.halted).toBe(false);
    // Herschreven (ronde 3): de opname van 27,50 is geen winst of verlies. Start en
    // dag-start blijven staan (was in ronde 2: naar rato geschaald); de opname telt
    // als overboeking, zodat totaal- en dagresultaat gelijk blijven.
    expect(s.account.startingEquity).toBe(50);
    expect(s.account.dayStartEquity).toBe(50);
    expect(s.skimmedQuote).toBe(0); // kapitaal, geen afgeroomde winst
    expect(s.account.totalPnlQuote).toBeCloseTo(before.totalPnlQuote!, 9);
    expect(s.account.dayPnlQuote).toBeCloseTo(before.dayPnlQuote!, 9);
    expect(s.account.totalReturnPct).toBeCloseTo(before.totalReturnPct!, 9);
    expect(s.account.dayReturnPct).toBeCloseTo(before.dayReturnPct!, 9);
    expect(s.account.totalReturnPct).toBeLessThan(0); // alleen de instapfee
    expect(s.account.totalReturnPct).toBeGreaterThan(-0.2);
    const logsBefore = h2.logs().length;

    // De positie (inleg 22,50 > limiet 20) wordt met klein verlies verkocht: wat boven
    // de limiet uitkomt is kapitaal dat alsnog teruggaat — GEEN winst.
    h2.engine.arm();
    const trade = (await h2.engine.closePosition(s.positions[0].id))!;
    expect(trade.pnlQuote).toBeLessThan(0);
    s = h2.engine.snapshot();
    expect(s.account.cashQuote).toBeCloseTo(20, 9);
    expect(s.skimmedQuote).toBe(0);
    expect(s.account.totalPnlQuote).toBeCloseTo(trade.pnlQuote, 9);
    expect(s.account.totalReturnPct).toBeCloseTo((trade.pnlQuote / 50) * 100, 9);
    const newLogs = h2.logs().slice(0, h2.logs().length - logsBefore);
    expect(newLogs.some((m) => m.includes("kapitaal gaat alsnog terug buiten het handelsbudget"))).toBe(true);
    expect(h2.logs().some((m) => m.startsWith("Kapitaallimiet") && m.includes("winst"))).toBe(false);
    // equity + netto eruit loopt door (geen sprong door de limietwijziging of de terugboeking)
    const hist = s.equityHistory;
    expect(hist[hist.length - 1].equity + (hist[hist.length - 1].skimmed ?? 0)).toBeCloseTo(50 + trade.pnlQuote, 9);
  });

  it("herstart met een lagere limiet NA verlies: budget = min(nieuwe limiet, wat de bot heeft), dag-% niet opgeblazen", async () => {
    const file = join(dir, "state.json");
    const h1 = setup({ mode: "live", startingCapital: 100, deps: { store: new StateStore(file) } });
    h1.engine.arm();
    h1.risk.quote = 90;
    h1.risk.stopDist = 40_000;
    h1.risk.tpDist = 40_000;
    const pos = await openBtcPosition(h1);
    h1.feed.setLast("BTC-EUR", 30_000); // -40%
    await h1.engine.closePosition(pos.id);
    let s = h1.engine.snapshot();
    const cash = s.account.cashQuote; // ~63,7
    expect(cash).toBeGreaterThan(55);
    expect(cash).toBeLessThan(70);
    const dayPct = s.account.dayReturnPct!;
    await h1.engine.stop();

    const h2 = setup({ mode: "live", startingCapital: 50, clock: h1.clock, deps: { store: new StateStore(file) } });
    realHalt(h2);
    s = h2.engine.snapshot();
    // Niet het volledige verschil (50) eraf: de bot houdt min(50, ~63,7) = 50
    expect(s.account.cashQuote).toBe(50);
    expect(s.account.dayReturnPct).toBeCloseTo(dayPct, 9);
    expect(s.account.totalReturnPct).toBeCloseTo(dayPct, 9);
    // Herschreven (ronde 3): dagstart bleef niet staan maar werd geschaald (78,46); het
    // EUR-resultaat is nu het echte verlies, de ~13,73 opname telt niet mee.
    expect(s.account.dayStartEquity).toBe(100);
    expect(s.account.startingEquity).toBe(100);
    expect(s.account.totalPnlQuote).toBeCloseTo(cash - 100, 9);
    expect(s.account.dayPnlQuote).toBeCloseTo(cash - 100, 9);
    expect(s.skimmedQuote).toBe(0);
    expect(h2.logs().some((m) => m.startsWith("Kapitaallimiet €100,00 → €50,00"))).toBe(true);
    expect(h2.logs().some((m) => m.includes("winst"))).toBe(false);

    // Kleine koers-/limietverlaging na een klein verlies triggert de 5%-limiet niet
    const file2 = join(dir, "state2.json");
    const h3 = setup({ mode: "live", startingCapital: 50, deps: { store: new StateStore(file2) } });
    h3.engine.arm();
    h3.risk.quote = 40;
    h3.risk.stopDist = 40_000;
    const p3 = await openBtcPosition(h3);
    h3.feed.setLast("BTC-EUR", 48_000); // -4% op €40 → ~-3,5% van de equity
    await h3.engine.closePosition(p3.id);
    await h3.engine.stop();
    const h4 = setup({ mode: "live", startingCapital: 25, clock: h3.clock, feed: h3.feed, deps: { store: new StateStore(file2) } });
    realHalt(h4);
    await h4.engine.tick();
    s = h4.engine.snapshot();
    expect(s.account.cashQuote).toBe(25);
    expect(s.account.dayReturnPct).toBeGreaterThan(-5);
    expect(s.halted.halted).toBe(false);
  });

  it("herstart op dezelfde dag met een lagere limiet zonder posities: geen halt", async () => {
    const file = join(dir, "state.json");
    const h1 = setup({ mode: "live", startingCapital: 50, deps: { store: new StateStore(file) } });
    await h1.engine.stop();
    const h2 = setup({ mode: "live", startingCapital: 30, deps: { store: new StateStore(file) } });
    realHalt(h2);
    await h2.engine.tick();
    const s = h2.engine.snapshot();
    expect(s.account.cashQuote).toBe(30);
    // Herschreven (ronde 3): was 30 (dagstart mee omlaag); nu blijft de dagstart 50 en
    // telt de opname van 20 als overboeking: resultaat vandaag 0.
    expect(s.account.dayStartEquity).toBe(50);
    expect(s.account.dayPnlQuote).toBeCloseTo(0, 9);
    expect(s.account.dayReturnPct).toBeCloseTo(0, 9);
    expect(s.account.totalPnlQuote).toBeCloseTo(0, 9);
    expect(s.halted.halted).toBe(false);
  });
});

describe("Dagelijkse verlieslimiet geldt tot morgen", () => {
  it("herstel van open posities heft de pauze niet op; pas bij de dagwissel 'Handel hervat' (ook na een herstart)", async () => {
    const file = join(dir, "state.json");
    const clock = new Clock(T0 + 60_000);
    const feed = new FakeFeed();
    feed.setSeries("BTC-EUR", 50_000, T0);
    // ETH-candles 5 min verschoven: geen signaal op T0-15m
    feed.setSeries("ETH-EUR", 3_000, T0 - 5 * 60_000);
    const h = setup({ clock, feed, markets: ["BTC-EUR", "ETH-EUR"], deps: { store: new StateStore(file) } });
    realHalt(h);
    h.risk.quote = 60;
    h.risk.stopDist = 40_000;
    h.risk.tpDist = 40_000;
    await openBtcPosition(h);
    expect(h.broker.buys()).toHaveLength(1);

    feed.setLast("BTC-EUR", 45_000); // -10% op €60 → ~-6% van de equity
    clock.advance(15_000);
    await h.engine.tick();
    expect(h.engine.snapshot().halted.halted).toBe(true);
    expect(h.engine.snapshot().halted.reason).toMatch(/^Dagelijkse verlieslimiet bereikt/);

    feed.setLast("BTC-EUR", 49_000); // herstelt tot ~-1,4%
    clock.advance(15_000);
    await h.engine.tick();
    let s = h.engine.snapshot();
    expect(s.halted.halted).toBe(true);
    expect(s.halted.reason).toContain("eerder vandaag");
    expect(h.logs().some((m) => m.startsWith("Handel hervat"))).toBe(false);

    // Koopsignaal in ETH dezelfde dag → geen order
    feed.append("ETH-EUR", 3_000);
    clock.set(T0 + 11 * 60_000);
    h.signals.buyAt.add(T0 - 5 * 60_000);
    await h.engine.tick();
    expect(h.broker.buys()).toHaveLength(1);
    await h.engine.stop();

    // Herstart op dezelfde dag: nog steeds gepauzeerd
    const h2 = setup({ clock, feed, markets: ["BTC-EUR", "ETH-EUR"], deps: { store: new StateStore(file) } });
    realHalt(h2);
    await h2.engine.tick();
    expect(h2.engine.snapshot().halted.halted).toBe(true);

    // Dagwissel: weer handelen
    clock.set(NEXT_DAY);
    await h2.engine.tick();
    s = h2.engine.snapshot();
    expect(s.account.dayKey).toBe("2026-01-06");
    expect(s.halted.halted).toBe(false);
    expect(h2.logs().some((m) => m.startsWith("Handel hervat"))).toBe(true);
  });
});

describe("Dagwissel direct na een herstart", () => {
  it("waardeert open posities tegen de actuele koers, niet tegen de instapkoers", async () => {
    const file = join(dir, "state.json");
    const clock = new Clock(T0 + 60_000);
    const feed = new FakeFeed();
    feed.setSeries("BTC-EUR", 50_000, T0);
    const h1 = setup({ clock, feed, deps: { store: new StateStore(file) } });
    h1.risk.stopDist = 10_000;
    const pos = await openBtcPosition(h1);
    feed.setLast("BTC-EUR", 48_000);
    clock.advance(15_000);
    await h1.engine.tick();
    await h1.engine.stop();

    clock.set(Date.UTC(2026, 0, 6, 7, 0)); // 08:00 de volgende dag
    const h2 = setup({ clock, feed, deps: { store: new StateStore(file) } });
    h2.risk.stopDist = 10_000;
    await h2.engine.tick();
    const s = h2.engine.snapshot();
    expect(s.account.dayKey).toBe("2026-01-06");
    expect(s.account.dayStartEquity).toBeCloseTo(s.account.cashQuote + pos.amount * 48_000, 9);
  });

  it("zonder actuele koers wordt de dagwissel een tick uitgesteld", async () => {
    const file = join(dir, "state.json");
    const clock = new Clock(T0 + 60_000);
    const feed = new FakeFeed();
    feed.setSeries("BTC-EUR", 50_000, T0);
    const h1 = setup({ clock, feed, deps: { store: new StateStore(file) } });
    h1.risk.stopDist = 10_000;
    const pos = await openBtcPosition(h1);
    feed.setLast("BTC-EUR", 48_000);
    await h1.engine.stop();

    clock.set(Date.UTC(2026, 0, 6, 7, 0));
    const h2 = setup({ clock, feed, deps: { store: new StateStore(file) } });
    h2.risk.stopDist = 10_000;
    const origPrice = feed.getPrice.bind(feed);
    feed.getPrice = async () => {
      throw new Error("ticker down");
    };
    await h2.engine.tick(); // getCandles werkt wel en zet de koers voor de volgende tick
    expect(h2.engine.snapshot().account.dayKey).toBe("2026-01-05");
    expect(h2.logs().some((m) => m.startsWith("Dagwissel uitgesteld"))).toBe(true);
    feed.getPrice = origPrice;
    clock.advance(15_000);
    await h2.engine.tick();
    const s = h2.engine.snapshot();
    expect(s.account.dayKey).toBe("2026-01-06");
    expect(s.account.dayStartEquity).toBeCloseTo(s.account.cashQuote + pos.amount * 48_000, 9);
  });
});

describe("Warmup van de strategieën", () => {
  it("haalt genoeg candles op voor de ingeschakelde strategieën, ook bij historyCandles=100", async () => {
    const warm = requiredWarmupCandles(DEFAULT_ENSEMBLE_CONFIG);
    expect(warm).toBeGreaterThanOrEqual(101); // ema-trend met trend=100
    const trend200 = { ...DEFAULT_ENSEMBLE_CONFIG, params: { "ema-trend": { trend: 200 } } };
    expect(requiredWarmupCandles(trend200)).toBeGreaterThanOrEqual(201);
    expect(candlesToFetch({ historyCandles: 150, ensemble: trend200 })).toBeGreaterThanOrEqual(202);
    // historyCandles blijft de ondergrens; nooit meer dan Bitvavo per request levert
    expect(candlesToFetch({ historyCandles: 1000, ensemble: DEFAULT_ENSEMBLE_CONFIG })).toBe(1001);
    expect(candlesToFetch({ historyCandles: 5000, ensemble: DEFAULT_ENSEMBLE_CONFIG })).toBe(1440);

    const h = setup({ config: { historyCandles: 100 } });
    await h.engine.tick();
    expect(h.feed.calls[0].limit).toBeGreaterThanOrEqual(warm + 1);
  });

  it("met echte strategieën en historyCandles=100 stemt ema-trend live mee (niet 'Opwarmen')", async () => {
    const t = Date.UTC(2026, 5, 1, 20, 2, 0);
    const now = () => t;
    const feed = new SimulatedFeed({ seed: 7, now, markets: ["BTC-EUR"] });
    const engine = new TradingEngine({
      feed,
      broker: new FakeBroker("paper"),
      mode: "paper",
      config: testConfig({ ...DEFAULT_ENGINE_CONFIG, markets: ["BTC-EUR"], historyCandles: 100 }),
      startingCapital: 50,
      now,
      decide: runEnsemble,
    });
    const decisions: EnsembleDecision[] = [];
    engine.on("decision", (d: EnsembleDecision) => decisions.push(d));
    await engine.tick();
    expect(decisions).toHaveLength(1);
    const vote = decisions[0].votes.find((v) => v.strategy === "ema-trend");
    expect(vote).toBeDefined();
    expect(vote!.reason).not.toMatch(/^Opwarmen/);
  });
});

describe("Onbruikbaar statusbestand (live)", () => {
  it("meldt het, blokkeert armen tot bevestiging en waarschuwt voor niet-beheerde coins", async () => {
    const file = join(dir, "state-live.json");
    const h1 = setup({ mode: "live", startingCapital: 50, deps: { store: new StateStore(file) } });
    h1.engine.arm();
    const pos = await openBtcPosition(h1);
    await h1.engine.stop();
    writeFileSync(file, '{"version":1,"mode":"live","acc'); // afgebroken schrijfactie

    const broker2 = new FakeBroker("live");
    broker2.balances.set("BTC", pos.amount);
    const h2 = setup({ mode: "live", startingCapital: 50, clock: h1.clock, broker: broker2, deps: { store: new StateStore(file) } });
    let s = h2.engine.snapshot();
    expect(s.positions).toHaveLength(0);
    expect(s.stateRecovery).not.toBeNull();
    expect(s.stateRecovery!.quarantinedTo).toMatch(/state-live\.json\.corrupt-/);
    const err = s.logs.find((l) => l.level === "error" && l.message.startsWith("Opgeslagen staat onbruikbaar"));
    expect(err?.message).toContain("LEGE administratie");
    expect(readdirSync(dir).some((f) => f.startsWith("state-live.json.corrupt-"))).toBe(true);
    expect(() => h2.engine.arm()).toThrow(/Armen geblokkeerd/);
    expect(h2.engine.liveArmed).toBe(false);

    await h2.engine.start();
    expect(h2.logs().some((m) => m.includes("BTC") && m.includes("die de bot niet beheert"))).toBe(true);
    await h2.engine.stop();

    // Nog niet bevestigd → blijft ook na een herstart staan
    const h3 = setup({ mode: "live", startingCapital: 50, clock: h1.clock, deps: { store: new StateStore(file) } });
    expect(h3.engine.snapshot().stateRecovery).not.toBeNull();
    expect(() => h3.engine.arm()).toThrow(/Armen geblokkeerd/);
    h3.engine.acknowledgeStateRecovery();
    s = h3.engine.snapshot();
    expect(s.stateRecovery).toBeNull();
    h3.engine.arm();
    expect(h3.engine.liveArmed).toBe(true);
    await h3.engine.stop();
    const h4 = setup({ mode: "live", startingCapital: 50, clock: h1.clock, deps: { store: new StateStore(file) } });
    expect(h4.engine.snapshot().stateRecovery).toBeNull();
  });

  it("paper: corrupt bestand wordt ook gemeld (maar er valt niets te armen)", () => {
    const file = join(dir, "state.json");
    writeFileSync(file, "");
    const h = setup({ deps: { store: new StateStore(file) } });
    const s = h.engine.snapshot();
    expect(s.stateRecovery?.reason).toBe("bestand is leeg");
    expect(s.logs.some((l) => l.level === "error" && l.message.startsWith("Opgeslagen staat onbruikbaar (bestand is leeg)"))).toBe(
      true,
    );
  });
});
