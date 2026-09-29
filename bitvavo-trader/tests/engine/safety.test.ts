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
    // afromen = opname: dag-start en start schuiven evenveel mee
    expect(s.account.dayStartEquity).toBeCloseTo(dayStart - s.skimmedQuote!, 9);
    expect(s.account.startingEquity).toBeCloseTo(50 - s.skimmedQuote!, 9);
    expect(s.account.equity - s.account.startingEquity).toBeCloseTo(trade.pnlQuote, 9);
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
    expect(s.account.startingEquity).toBe(100);
    expect(s.account.dayStartEquity).toBe(100);
    expect(h2.logs().some((m) => m.startsWith("Kapitaallimiet €20,00 → €100,00"))).toBe(true);
    await h2.engine.tick();
    s = h2.engine.snapshot();
    expect(s.halted.halted).toBe(false);
  });

  it("herstart met een LAGERE limiet telt open posities mee en pauzeert de handel niet", async () => {
    const file = join(dir, "state.json");
    const h1 = setup({ mode: "live", startingCapital: 50, deps: { store: new StateStore(file) } });
    h1.engine.arm();
    h1.risk.quote = 22.5;
    await openBtcPosition(h1);
    await h1.engine.stop();

    const h2 = setup({ mode: "live", startingCapital: 20, clock: h1.clock, deps: { store: new StateStore(file) } });
    realHalt(h2);
    await h2.engine.tick();
    const s = h2.engine.snapshot();
    expect(s.positions).toHaveLength(1);
    expect(s.account.cashQuote).toBe(0); // inleg 22,50 > limiet 20: geen cash meer
    expect(s.halted.halted).toBe(false);
    expect(s.account.startingEquity).toBeCloseTo(22.5, 9);
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
    expect(s.account.dayStartEquity).toBe(30);
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
