import { mkdtempSync, rmSync, existsSync, readdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Unit tests mogen niet afhangen van de echte strategieën / risk manager.
vi.mock("../../src/strategies/ensemble", () => ({
  runEnsemble: vi.fn(() => []),
}));
vi.mock("../../src/risk/riskManager", () => ({
  RiskManager: vi.fn(function (this: Record<string, unknown>) {
    this.planEntry = () => ({ approved: false, reasons: ["mock"], market: "", quoteAmount: 0, expectedEntryPrice: 0, stopPrice: 0, takeProfitPrice: 0, riskQuote: 0 });
    this.updatePosition = (p: { stopPrice: number; highestPrice: number }) => ({ exit: false, stopPrice: p.stopPrice, highestPrice: p.highestPrice });
    this.shouldExitOnSignal = () => false;
    this.haltStatus = () => ({ halted: false });
  }),
}));

import { runEnsemble } from "../../src/strategies/ensemble";
import { RiskManager } from "../../src/risk/riskManager";
import type { EngineConfig, EngineSnapshot, Position, Trade } from "../../src/core/types";
import { StateStore } from "../../src/engine/stateStore";
import { TradingEngine } from "../../src/engine/tradingEngine";
import {
  Clock,
  Deferred,
  FakeBroker,
  FakeFeed,
  I15,
  T0,
  openBtcPosition,
  setup,
  testConfig,
} from "./helpers";

const FEE = 0.0025;

describe("TradingEngine — entries", () => {
  it("opent precies één positie op een nieuw gesloten koop-candle (niet opnieuw bij de volgende tick)", async () => {
    const h = setup();
    const closedTime = h.lastClosed();
    expect(closedTime).toBe(T0 - I15);
    h.signals.buyAt.add(closedTime);

    await h.engine.tick();
    expect(h.broker.buys()).toHaveLength(1);
    const order = h.broker.buys()[0];
    expect(order.req).toMatchObject({ market: "BTC-EUR", side: "buy", amountQuote: 20 });
    expect(order.req.clientOrderId).toMatch(/^[0-9a-f-]{36}$/);
    expect(order.ref).toBe(50_000);
    expect(h.signals.decide).toHaveBeenCalledTimes(1);
    // strategieën krijgen alleen GESLOTEN candles
    const passed = h.signals.decide.mock.calls[0][1];
    expect(passed[passed.length - 1].time).toBe(closedTime);
    expect(h.risk.planCalls).toHaveLength(1);
    expect(h.risk.planCalls[0].market?.market).toBe("BTC-EUR");

    h.clock.advance(15_000);
    await h.engine.tick();
    h.clock.advance(15_000);
    await h.engine.tick();
    expect(h.broker.buys()).toHaveLength(1);
    expect(h.signals.decide).toHaveBeenCalledTimes(1);
    expect(h.engine.snapshot().positions).toHaveLength(1);
  });

  it("zet de positie op basis van de echte fill: stop/doel verschoven met de plan-afstanden", async () => {
    const h = setup();
    h.broker.slip = 0.001; // vult op 50.050
    const pos = await openBtcPosition(h);
    const fee = 20 - 20 / (1 + FEE);
    expect(pos.entryPrice).toBeCloseTo(50_050, 6);
    expect(pos.amount).toBeCloseTo((20 - fee) / 50_050, 12);
    expect(pos.costQuote).toBeCloseTo(20, 9);
    expect(pos.entryFeeQuote).toBeCloseTo(fee, 12);
    expect(pos.stopPrice).toBeCloseTo(49_050, 6);
    expect(pos.initialStopPrice).toBeCloseTo(49_050, 6);
    expect(pos.takeProfitPrice).toBeCloseTo(52_050, 6);
    expect(pos.highestPrice).toBeCloseTo(50_050, 6);
    expect(pos.candlesHeld).toBe(0);
    expect(pos.entryTime).toBe(h.clock.t);
    expect(pos.entryReason).toContain("EMA-trend");
    expect(pos.entryReason).toContain("Breakout");
    const tradeLog = h.engine.snapshot().logs.find((l) => l.level === "trade")!;
    expect(tradeLog.message).toMatch(/^KOOP BTC-EUR €20,00 @ 50\.050 · stop 49\.050 · doel 52\.050 \(score 0,52: EMA-trend, Breakout\)$/);
  });

  it("afgewezen kooporder → geen positie, geen cash-mutatie, waarschuwing, geen herhaling voor dezelfde candle", async () => {
    const h = setup();
    h.broker.rejectBuys = 1;
    h.signals.buyAt.add(h.lastClosed());
    await h.engine.tick();
    const s = h.engine.snapshot();
    expect(s.positions).toHaveLength(0);
    expect(s.account.cashQuote).toBe(100);
    expect(s.account.tradesToday).toBe(0);
    expect(h.of("order")[0]).toMatchObject({ status: "rejected", side: "buy" });
    expect(s.logs.some((l) => l.level === "warn" && l.message.includes("Kooporder BTC-EUR afgewezen"))).toBe(true);
    h.clock.advance(15_000);
    await h.engine.tick();
    expect(h.broker.orders).toHaveLength(1);
  });

  it("een broker die gooit wordt als afwijzing behandeld", async () => {
    const h = setup();
    h.broker.throwOnOrder = true;
    h.signals.buyAt.add(h.lastClosed());
    await h.engine.tick();
    expect(h.engine.snapshot().positions).toHaveLength(0);
    expect(h.logs().some((m) => m.includes("netwerkfout"))).toBe(true);
  });

  it("logt afwijzingsredenen van het risicoplan hooguit één keer per candle", async () => {
    const h = setup();
    h.risk.approve = false;
    h.signals.buyAt.add(h.lastClosed());
    await h.engine.tick();
    h.clock.advance(15_000);
    await h.engine.tick();
    const msgs = h.logs().filter((m) => m.startsWith("Geen koop BTC-EUR"));
    expect(msgs).toHaveLength(1);
    expect(msgs[0]).toContain("Maximum aantal trades per dag bereikt");
    expect(h.broker.orders).toHaveLength(0);
  });

  it("koopt niet als er al een positie in de markt staat", async () => {
    const h = setup();
    await openBtcPosition(h);
    h.clock.advance(I15);
    const next = h.feed.append("BTC-EUR", 50_000);
    h.signals.buyAt.add(next.time - I15);
    await h.engine.tick();
    expect(h.broker.buys()).toHaveLength(1);
    expect(h.risk.planCalls).toHaveLength(1);
  });
});

describe("TradingEngine — exits", () => {
  it("stop-loss via de actuele koers (synthetische candle) → verkoop + trade", async () => {
    const h = setup();
    const pos = await openBtcPosition(h);
    h.clock.advance(15_000);
    h.feed.setLast("BTC-EUR", 48_900);
    await h.engine.tick();
    const s = h.engine.snapshot();
    expect(s.positions).toHaveLength(0);
    expect(h.broker.sells()).toHaveLength(1);
    expect(h.broker.sells()[0].req.amount).toBe(pos.amount);
    expect(s.trades).toHaveLength(1);
    expect(s.trades[0].exitReason).toBe("stop-loss");
    const synth = h.risk.updateCalls.at(-1)!;
    expect(synth.closed).toBe(false);
    expect(synth.candle).toMatchObject({ open: 48_900, high: 48_900, low: 48_900, close: 48_900 });
    expect(s.logs.find((l) => l.level === "trade")!.message).toMatch(/^VERKOOP BTC-EUR @ 48\.900 · stop-loss · -€0,\d\d \(-2,\d%\)$/);
    expect(s.account.lastLossAt["BTC-EUR"]).toBe(h.clock.t);
  });

  it("exit-checks op gesloten candles gebruiken alleen candles vanaf de entry", async () => {
    const h = setup();
    const pos = await openBtcPosition(h); // entry op T0+1m, candle T0 is nog in vorming
    // De vormende candle had vóór de entry een dip onder de stop
    h.feed.setLast("BTC-EUR", 50_000, { low: 48_000 });
    h.clock.set(T0 + I15 + 30_000); // candle T0 is nu gesloten
    h.feed.append("BTC-EUR", 50_000);
    await h.engine.tick();
    let s = h.engine.snapshot();
    expect(s.positions).toHaveLength(1);
    expect(s.positions[0].candlesHeld).toBe(0);
    expect(h.risk.updateCalls.filter((c) => c.closed)).toHaveLength(0);

    // Candle T0+15m (volledig na de entry) sluit
    h.clock.set(T0 + 2 * I15 + 30_000);
    h.feed.setLast("BTC-EUR", 50_100, { low: 49_500, high: 50_300 });
    h.feed.append("BTC-EUR", 50_200);
    await h.engine.tick();
    s = h.engine.snapshot();
    const closedCalls = h.risk.updateCalls.filter((c) => c.closed);
    expect(closedCalls).toHaveLength(1);
    expect(closedCalls[0].candle.time).toBe(T0 + I15);
    expect(closedCalls[0].candle.time).toBeGreaterThanOrEqual(pos.entryTime);
    // candlesHeld is opgehoogd VÓÓR de aanroep
    expect(closedCalls[0].pos.candlesHeld).toBe(1);
    expect(closedCalls[0].atr).toBe(100);
    expect(s.positions[0].candlesHeld).toBe(1);
    expect(s.positions[0].highestPrice).toBe(50_300);
    // gesloten candle eerst, daarna de synthetische
    const lastTwo = h.risk.updateCalls.slice(-2);
    expect(lastTwo.map((c) => c.closed)).toEqual([true, false]);
  });

  it("een gesloten candle met een low onder de stop (na entry) triggert een exit", async () => {
    const h = setup();
    await openBtcPosition(h);
    h.clock.set(T0 + I15 + 30_000);
    h.feed.append("BTC-EUR", 50_000);
    await h.engine.tick();
    h.clock.set(T0 + 2 * I15 + 30_000);
    h.feed.setLast("BTC-EUR", 49_800, { low: 48_500 });
    h.feed.append("BTC-EUR", 49_800);
    await h.engine.tick();
    const s = h.engine.snapshot();
    expect(s.positions).toHaveLength(0);
    expect(s.trades[0].exitReason).toBe("stop-loss");
    expect(s.trades[0].candlesHeld).toBe(1);
  });

  it("verkoopsignaal op een nieuwe gesloten candle sluit de positie (reden signal)", async () => {
    const h = setup();
    await openBtcPosition(h);
    h.clock.set(T0 + I15 + 30_000);
    h.feed.setLast("BTC-EUR", 50_500);
    h.signals.sellAt.add(T0);
    h.feed.append("BTC-EUR", 50_600);
    await h.engine.tick();
    const s = h.engine.snapshot();
    expect(s.positions).toHaveLength(0);
    expect(s.trades[0].exitReason).toBe("signal");
    expect(h.broker.sells()[0].ref).toBe(50_600);
    expect(s.logs.find((l) => l.level === "trade")!.message).toContain("verkoopsignaal");
  });

  it("afgewezen verkoop → positie blijft staan en wordt de volgende tick opnieuw geprobeerd (1 poging per tick)", async () => {
    const h = setup();
    await openBtcPosition(h);
    h.broker.rejectSells = 1;
    h.clock.advance(15_000);
    h.feed.setLast("BTC-EUR", 48_900);
    await h.engine.tick();
    let s = h.engine.snapshot();
    expect(s.positions).toHaveLength(1);
    expect(h.broker.sells()).toHaveLength(1);
    expect(s.account.cashQuote).toBeCloseTo(80, 9);
    expect(s.logs.some((l) => l.level === "error" && l.message.includes("Verkoop BTC-EUR (stop-loss) mislukt"))).toBe(true);

    // koers herstelt, maar de stop is geraakt: de exit wordt alsnog uitgevoerd
    h.clock.advance(15_000);
    h.feed.setLast("BTC-EUR", 49_200);
    await h.engine.tick();
    s = h.engine.snapshot();
    expect(h.broker.sells()).toHaveLength(2);
    expect(s.positions).toHaveLength(0);
    expect(s.trades[0].exitReason).toBe("stop-loss");
  });

  it("closePosition sluit handmatig met reden manual; onbekend id → null", async () => {
    const h = setup();
    const pos = await openBtcPosition(h);
    h.feed.setLast("BTC-EUR", 51_000);
    const trade = await h.engine.closePosition(pos.id);
    expect(trade).not.toBeNull();
    expect(trade!.exitReason).toBe("manual");
    expect(trade!.exitPrice).toBe(51_000);
    expect(await h.engine.closePosition("pos_bestaatniet")).toBeNull();
    expect(h.engine.snapshot().positions).toHaveLength(0);
  });

  it("stops worden nooit verlaagd, ook niet als de risk manager dat teruggeeft", async () => {
    const h = setup();
    const pos = await openBtcPosition(h);
    h.risk.updatePosition = (p) => ({ exit: false, stopPrice: p.stopPrice - 500, highestPrice: p.highestPrice });
    h.clock.advance(15_000);
    await h.engine.tick();
    expect(h.engine.snapshot().positions[0].stopPrice).toBe(pos.stopPrice);
  });
});

describe("TradingEngine — administratie", () => {
  it("cash / equity / fees / pnl kloppen over een volledige trade", async () => {
    const h = setup();
    const pos = await openBtcPosition(h);
    const buyFee = 20 - 20 / (1 + FEE);
    const amount = (20 - buyFee) / 50_000;
    let s = h.engine.snapshot();
    expect(s.account.cashQuote).toBeCloseTo(80, 9);
    expect(s.account.feesPaid).toBeCloseTo(buyFee, 12);
    expect(s.account.tradesToday).toBe(1);
    expect(s.account.equity).toBeCloseTo(80 + amount * 50_000, 9);
    expect(s.positions[0].unrealizedPnl).toBeCloseTo(amount * 50_000 * (1 - FEE) - 20, 9);
    expect(s.account.unrealizedPnl).toBeCloseTo(amount * 50_000 * (1 - FEE) - 20, 9);

    h.clock.advance(15_000);
    h.feed.setLast("BTC-EUR", 51_000);
    await h.engine.tick();
    s = h.engine.snapshot();
    expect(s.account.equity).toBeCloseTo(80 + amount * 51_000, 9);
    expect(s.positions[0].currentPrice).toBe(51_000);
    expect(s.positions[0].unrealizedPct).toBeCloseTo(((amount * 51_000 * (1 - FEE) - 20) / 20) * 100, 9);

    const trade = (await h.engine.closePosition(pos.id))!;
    const gross = amount * 51_000;
    const sellFee = gross * FEE;
    const proceeds = gross - sellFee;
    const pnl = proceeds - 20;
    s = h.engine.snapshot();
    expect(trade.costQuote).toBeCloseTo(20, 9);
    expect(trade.proceedsQuote).toBeCloseTo(proceeds, 9);
    expect(trade.feesQuote).toBeCloseTo(buyFee + sellFee, 12);
    expect(trade.pnlQuote).toBeCloseTo(pnl, 9);
    expect(trade.pnlPct).toBeCloseTo((pnl / 20) * 100, 9);
    expect(trade.rMultiple).toBeCloseTo(pnl / (1000 * amount), 9);
    expect(trade.amount).toBeCloseTo(amount, 12);
    expect(s.account.cashQuote).toBeCloseTo(80 + proceeds, 9);
    expect(s.account.equity).toBeCloseTo(80 + proceeds, 9);
    expect(s.account.realizedPnl).toBeCloseTo(pnl, 9);
    expect(s.account.realizedPnlToday).toBeCloseTo(pnl, 9);
    expect(s.account.feesPaid).toBeCloseTo(buyFee + sellFee, 12);
    expect(s.account.unrealizedPnl).toBe(0);
    expect(s.account.lastLossAt["BTC-EUR"]).toBeUndefined();
    expect(s.trades[0].id).toBe(trade.id);
  });

  it("equityHistory: hooguit één punt per 60s, plus een punt per trade", async () => {
    const h = setup();
    await h.engine.tick();
    expect(h.engine.snapshot().equityHistory).toHaveLength(1);
    h.clock.advance(15_000);
    await h.engine.tick();
    expect(h.engine.snapshot().equityHistory).toHaveLength(1);
    h.clock.advance(60_000);
    await h.engine.tick();
    expect(h.engine.snapshot().equityHistory).toHaveLength(2);
    // koop: punt op het moment van de trade
    h.feed.append("BTC-EUR", 50_000);
    h.clock.set(h.feed.lastTime("BTC-EUR") + 5_000);
    h.signals.buyAt.add(h.lastClosed());
    await h.engine.tick();
    const pos = h.engine.snapshot().positions[0];
    expect(pos).toBeDefined();
    let eq = h.engine.snapshot().equityHistory;
    expect(eq).toHaveLength(3);
    expect(eq[2].time).toBe(pos.entryTime);
    // verkoop 1 s later: toch een extra punt (trade), terwijl een gewone tick binnen 60 s niets toevoegt
    h.clock.advance(1_000);
    await h.engine.tick();
    expect(h.engine.snapshot().equityHistory).toHaveLength(3);
    h.clock.advance(1_000);
    await h.engine.closePosition(pos.id);
    eq = h.engine.snapshot().equityHistory;
    expect(eq).toHaveLength(4);
    expect(eq[3].time).toBe(h.clock.t);
    for (let i = 1; i < eq.length; i++) expect(eq[i].time).toBeGreaterThan(eq[i - 1].time);
  });

  it("equityHistory wordt uitgedund tot maximaal 2000 punten", async () => {
    const h = setup();
    for (let i = 0; i < 2100; i++) {
      h.clock.advance(60_000);
      // equity punt per minuut; klok loopt ver vooruit, candles blijven gelijk
      (h.engine as unknown as { recordEquity(t: number, f: boolean): void }).recordEquity(h.clock.t, false);
    }
    const eq = h.engine.snapshot().equityHistory;
    expect(eq.length).toBeLessThanOrEqual(2000);
    expect(eq.length).toBeGreaterThan(900);
    expect(eq[eq.length - 1].time).toBe(h.clock.t);
  });

  it("dagwissel reset dagtellers en zet dayStartEquity op de huidige equity", async () => {
    const h = setup();
    await openBtcPosition(h);
    h.clock.advance(15_000);
    h.feed.setLast("BTC-EUR", 48_900);
    await h.engine.tick(); // verlies
    let s = h.engine.snapshot();
    expect(s.account.tradesToday).toBe(1);
    expect(s.account.realizedPnlToday).toBeLessThan(0);
    expect(s.account.dayKey).toBe("2026-01-05");

    h.clock.set(T0 + 24 * 3_600_000);
    await h.engine.tick();
    s = h.engine.snapshot();
    expect(s.account.dayKey).toBe("2026-01-06");
    expect(s.account.tradesToday).toBe(0);
    expect(s.account.realizedPnlToday).toBe(0);
    expect(s.account.dayStartEquity).toBeCloseTo(s.account.cashQuote, 9);
    expect(s.account.realizedPnl).toBeLessThan(0); // totaal blijft
    expect(s.logs.some((l) => l.message.startsWith("Nieuwe handelsdag (2026-01-06)"))).toBe(true);
  });

  it("halt blokkeert nieuwe entries (één logregel) maar exits gaan door", async () => {
    const h = setup();
    const pos = await openBtcPosition(h);
    expect(pos).toBeDefined();
    h.risk.halted = true;
    // nieuwe candle met koopsignaal in een tweede markt zou geblokkeerd moeten worden
    h.clock.set(T0 + I15 + 30_000);
    h.feed.append("BTC-EUR", 49_500);
    await h.engine.tick();
    h.clock.advance(15_000);
    h.feed.setLast("BTC-EUR", 48_000);
    await h.engine.tick();
    const s = h.engine.snapshot();
    expect(s.halted.halted).toBe(true);
    expect(s.positions).toHaveLength(0);
    expect(s.trades[0].exitReason).toBe("stop-loss");
    expect(s.logs.filter((l) => l.message.startsWith("Nieuwe trades gepauzeerd"))).toHaveLength(1);
  });

  it("halt: geen koop op een koopsignaal", async () => {
    const h = setup();
    h.risk.halted = true;
    h.signals.buyAt.add(h.lastClosed());
    await h.engine.tick();
    expect(h.broker.orders).toHaveLength(0);
    expect(h.risk.planCalls).toHaveLength(0);
    expect(h.engine.snapshot().halted).toEqual({ halted: true, reason: "Dagelijkse verlieslimiet bereikt (-5,0%)" });
    h.risk.halted = false;
    h.clock.advance(15_000);
    await h.engine.tick();
    expect(h.engine.snapshot().halted.halted).toBe(false);
    expect(h.logs().some((m) => m.startsWith("Handel hervat"))).toBe(true);
  });
});

describe("TradingEngine — live mode veiligheid", () => {
  it("live zonder arm: geen orders, wel 'zou kopen' in de log", async () => {
    const h = setup({ mode: "live", startingCapital: 50 });
    expect(h.engine.liveArmed).toBe(false);
    h.signals.buyAt.add(h.lastClosed());
    await h.engine.tick();
    expect(h.broker.orders).toHaveLength(0);
    expect(h.engine.snapshot().positions).toHaveLength(0);
    const msg = h.logs().find((m) => m.startsWith("Live mode niet gearmd: zou kopen BTC-EUR"));
    expect(msg).toBeDefined();
    expect(msg).toContain("€20,00");
    expect(h.engine.snapshot().liveArmed).toBe(false);
  });

  it("na arm() worden echte orders geplaatst; EUR-saldo wordt eerst gecontroleerd", async () => {
    const h = setup({ mode: "live", startingCapital: 50 });
    h.engine.arm();
    expect(h.engine.liveArmed).toBe(true);
    expect(h.engine.snapshot().liveArmed).toBe(true);
    expect(h.logs().some((m) => m.startsWith("LIVE GEARMD"))).toBe(true);

    // Te weinig EUR op Bitvavo → overslaan
    h.broker.balances.set("EUR", 10);
    h.signals.buyAt.add(h.lastClosed());
    await h.engine.tick();
    expect(h.broker.orders).toHaveLength(0);
    expect(h.logs().some((m) => m.startsWith("Onvoldoende EUR-saldo op Bitvavo"))).toBe(true);

    // Volgende candle, genoeg saldo → koop
    h.broker.balances.set("EUR", 1000);
    h.clock.set(T0 + I15 + 30_000);
    h.feed.append("BTC-EUR", 50_000);
    h.signals.buyAt.add(T0);
    await h.engine.tick();
    expect(h.broker.buys()).toHaveLength(1);
    expect(h.engine.snapshot().positions).toHaveLength(1);
  });

  it("kapitaallimiet: cash in live mode komt nooit boven startingCapital", async () => {
    const h = setup({ mode: "live", startingCapital: 50 });
    h.engine.arm();
    h.risk.quote = 40;
    const pos = await openBtcPosition(h);
    expect(h.engine.snapshot().account.cashQuote).toBeCloseTo(10, 9);
    h.feed.setLast("BTC-EUR", 55_000); // +10%
    const trade = (await h.engine.closePosition(pos.id))!;
    expect(trade.pnlQuote).toBeGreaterThan(3);
    const s = h.engine.snapshot();
    expect(s.account.cashQuote).toBe(50);
    expect(s.account.realizedPnl).toBeCloseTo(trade.pnlQuote, 9);
    expect(s.logs.some((l) => l.message.startsWith("Kapitaallimiet €50,00"))).toBe(true);
  });

  it("paper mode wordt niet begrensd; arm/disarm zijn no-ops in paper", async () => {
    const h = setup();
    h.engine.arm();
    expect(h.engine.liveArmed).toBe(false);
    h.engine.disarm();
    expect(h.logs().some((m) => m.includes("GEARMD") || m.includes("ontwapend"))).toBe(false);
    h.risk.quote = 40;
    const pos = await openBtcPosition(h);
    h.feed.setLast("BTC-EUR", 55_000);
    await h.engine.closePosition(pos.id);
    expect(h.engine.snapshot().account.cashQuote).toBeGreaterThan(100);
  });

  it("disarm met open positie: automatische exits worden alleen gelogd, handmatig sluiten werkt wel", async () => {
    const h = setup({ mode: "live", startingCapital: 50 });
    h.engine.arm();
    const pos = await openBtcPosition(h);
    h.engine.disarm();
    expect(h.logs().some((m) => m.startsWith("Live ontwapend") && m.includes("1 open positie"))).toBe(true);
    h.clock.advance(15_000);
    h.feed.setLast("BTC-EUR", 48_000);
    await h.engine.tick();
    h.clock.advance(15_000);
    await h.engine.tick();
    expect(h.broker.sells()).toHaveLength(0);
    expect(h.logs().filter((m) => m.startsWith("Live mode niet gearmd: zou verkopen BTC-EUR"))).toHaveLength(1);
    const trade = await h.engine.closePosition(pos.id);
    expect(trade?.exitReason).toBe("manual");
    expect(h.broker.sells()).toHaveLength(1);
  });

  it("broker- en engine-modus moeten overeenkomen", () => {
    expect(
      () =>
        new TradingEngine({
          feed: new FakeFeed(),
          broker: new FakeBroker("live"),
          mode: "paper",
          config: testConfig(),
          startingCapital: 50,
        }),
    ).toThrow(/Veiligheidsstop/);
  });

  it("resetPaper werkt alleen in paper mode", async () => {
    const live = setup({ mode: "live", startingCapital: 50 });
    expect(() => live.engine.resetPaper(50)).toThrow(/alleen in paper mode/);

    const h = setup();
    await openBtcPosition(h);
    h.engine.resetPaper(75);
    const s = h.engine.snapshot();
    expect(s.positions).toHaveLength(0);
    expect(s.trades).toHaveLength(0);
    expect(s.account.cashQuote).toBe(75);
    expect(s.account.startingEquity).toBe(75);
    expect(s.account.tradesToday).toBe(0);
    expect(s.equityHistory).toEqual([{ time: h.clock.t, equity: 75 }]);
    expect(h.broker.resetTo).toBe(75);
    expect(s.logs[0].message).toContain("Paper-account gereset");
  });
});

describe("TradingEngine — start/stop, noodstop, events", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("killSwitch sluit alle posities, stopt de bot en logt NOODSTOP", async () => {
    vi.useFakeTimers();
    const h = setup({ markets: ["BTC-EUR", "ETH-EUR"] });
    h.signals.buyAt.add(T0 - I15);
    await h.engine.start();
    expect(h.engine.snapshot().running).toBe(true);
    expect(h.engine.snapshot().positions).toHaveLength(2);
    await h.engine.killSwitch();
    const s = h.engine.snapshot();
    expect(s.running).toBe(false);
    expect(s.positions).toHaveLength(0);
    expect(s.trades.map((t) => t.exitReason)).toEqual(["kill-switch", "kill-switch"]);
    // Herschreven (ronde 3): een geslaagde noodstop werd als "error" gelogd; nu "warn"
    // (alleen echte mislukkingen zijn "error").
    expect(s.logs.find((l) => l.message.startsWith("NOODSTOP geactiveerd: 2 open positie(s)"))?.level).toBe("warn");
    expect(s.logs.find((l) => l.message.startsWith("NOODSTOP voltooid: 2 positie(s) gesloten"))?.level).toBe("warn");
    expect(s.logs.some((l) => l.level === "error")).toBe(false);
    const calls = h.feed.calls.length;
    await vi.advanceTimersByTimeAsync(120_000);
    expect(h.feed.calls.length).toBe(calls);
  });

  it("start() tickt direct en daarna elke pollMs; stop() stopt de lus", async () => {
    vi.useFakeTimers();
    const h = setup({ config: { pollMs: 1_000 } });
    await h.engine.start();
    expect(h.feed.calls).toHaveLength(1);
    expect(h.engine.snapshot().startedAt).toBe(h.clock.t);
    await vi.advanceTimersByTimeAsync(1_000);
    expect(h.feed.calls).toHaveLength(2);
    await vi.advanceTimersByTimeAsync(3_000);
    expect(h.feed.calls).toHaveLength(5);
    await h.engine.stop();
    await vi.advanceTimersByTimeAsync(10_000);
    expect(h.feed.calls).toHaveLength(5);
    expect(h.engine.snapshot().running).toBe(false);
  });

  it("geen overlappende ticks (handmatig én via de timer)", async () => {
    vi.useFakeTimers();
    const h = setup({ config: { pollMs: 1_000 } });
    const gate = new Deferred();
    h.feed.gate = gate.promise;
    const p1 = h.engine.tick();
    const p2 = h.engine.tick();
    expect(p2).toBe(p1);
    await vi.advanceTimersByTimeAsync(0);
    expect(h.feed.calls).toHaveLength(1);
    gate.resolve();
    await p1;
    h.feed.gate = null;

    await h.engine.start();
    const afterStart = h.feed.calls.length;
    const gate2 = new Deferred();
    h.feed.gate = gate2.promise;
    await vi.advanceTimersByTimeAsync(1_000); // tick begint en blijft hangen
    expect(h.feed.calls.length).toBe(afterStart + 1);
    await vi.advanceTimersByTimeAsync(10_000); // geen nieuwe tick zolang de vorige loopt
    expect(h.feed.calls.length).toBe(afterStart + 1);
    gate2.resolve();
    h.feed.gate = null;
    await vi.advanceTimersByTimeAsync(0);
    await vi.advanceTimersByTimeAsync(1_000);
    expect(h.feed.calls.length).toBe(afterStart + 2);
    await h.engine.stop();
  });

  it("fouten in feed / strategie / listeners breken de lus niet", async () => {
    vi.useFakeTimers();
    const h = setup({ markets: ["BTC-EUR", "ETH-EUR"], config: { pollMs: 1_000 } });
    h.feed.failing.add("ETH-EUR");
    h.feed.marketsFail = true;
    h.signals.throwOnce = true;
    h.engine.on("price", () => {
      throw new Error("kapotte listener");
    });
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    await h.engine.start();
    await vi.advanceTimersByTimeAsync(1_000);
    await vi.advanceTimersByTimeAsync(1_000);
    const s = h.engine.snapshot();
    expect(s.running).toBe(true);
    expect(s.logs.some((l) => l.level === "warn" && l.message.startsWith("Koersdata voor ETH-EUR niet beschikbaar"))).toBe(true);
    expect(s.logs.filter((l) => l.message.startsWith("Koersdata voor ETH-EUR")).length).toBe(1); // gedempt
    expect(s.logs.some((l) => l.level === "error" && l.message.includes("strategie kapot"))).toBe(true);
    expect(s.logs.some((l) => l.message.startsWith("Kon marktinformatie niet ophalen"))).toBe(true);
    expect(s.prices["BTC-EUR"]).toBe(50_000);
    expect(h.feed.calls.filter((c) => c.market === "BTC-EUR").length).toBe(3);
    await h.engine.stop();
    errSpy.mockRestore();
  });

  it("stuurt events met de juiste types en payloads", async () => {
    const h = setup();
    const pos = await openBtcPosition(h);
    expect(h.of("price")[0]).toEqual({ market: "BTC-EUR", price: 50_000, time: h.clock.t });
    const candle = h.of("candle")[0];
    expect(candle).toMatchObject({ market: "BTC-EUR", interval: "15m" });
    expect(candle.candle.time).toBe(T0); // de laatste (vormende) candle
    const decision = h.of("decision")[0];
    expect(decision).toMatchObject({ market: "BTC-EUR", time: T0 - I15, action: "buy" });
    expect(h.of("order")[0]).toMatchObject({ side: "buy", status: "filled", market: "BTC-EUR" });
    const opened = h.of("position-opened")[0] as Position;
    expect(opened.id).toBe(pos.id);
    const snaps = h.of("snapshot") as EngineSnapshot[];
    expect(snaps).toHaveLength(1); // precies één per tick
    expect(snaps[0].positions[0].id).toBe(pos.id);
    expect(h.of("log").some((l) => l.level === "trade" && l.message.startsWith("KOOP"))).toBe(true);

    const trade = (await h.engine.closePosition(pos.id))!;
    const closed = h.of("position-closed") as Trade[];
    expect(closed).toHaveLength(1);
    expect(closed[0].id).toBe(trade.id);
    expect(h.of("order")[1]).toMatchObject({ side: "sell" });
    // volgorde bij een tick: price → candle → decision → order → position-opened
    const order = h.events.map((e) => e.type).filter((t) => t !== "log");
    expect(order.slice(0, 6)).toEqual(["price", "candle", "decision", "order", "position-opened", "snapshot"]);
  });

  it("snapshot: trades nieuwste eerst (max 200), logs nieuwste eerst (max 150)", async () => {
    const h = setup();
    for (let i = 0; i < 3; i++) {
      const pos = await (async () => {
        h.signals.buyAt.add(h.lastClosed());
        await h.engine.tick();
        return h.engine.snapshot().positions[0];
      })();
      await h.engine.closePosition(pos.id);
      h.clock.set(h.feed.lastTime("BTC-EUR") + I15 + 1_000);
      h.feed.append("BTC-EUR", 50_000);
    }
    const s = h.engine.snapshot();
    expect(s.trades).toHaveLength(3);
    expect(s.trades[0].exitTime).toBeGreaterThanOrEqual(s.trades[2].exitTime);
    expect(s.logs[0].time).toBeGreaterThanOrEqual(s.logs[s.logs.length - 1].time);
    for (let i = 0; i < 200; i++) h.engine.updateConfig({ pollMs: 15_000 + i });
    expect(h.engine.snapshot().logs).toHaveLength(150);
  });

  it("standaard-deps: runEnsemble en RiskManager worden gebruikt als niets geïnjecteerd is", async () => {
    const feed = new FakeFeed();
    feed.setSeries("BTC-EUR", 50_000, T0);
    const clock = new Clock(T0 + 60_000);
    const engine = new TradingEngine({
      feed,
      broker: new FakeBroker("paper"),
      mode: "paper",
      config: testConfig(),
      startingCapital: 50,
      now: clock.now,
    });
    await engine.tick();
    expect(RiskManager).toHaveBeenCalled();
    expect(runEnsemble).toHaveBeenCalledWith("BTC-EUR", expect.any(Array), expect.any(Object));
  });
});

describe("TradingEngine — updateConfig", () => {
  it("merged risk/ensemble één niveau diep, maakt de risk manager opnieuw; bij marktwijziging alleen nieuwe markten direct beoordeeld", async () => {
    const h = setup();
    await h.engine.tick();
    expect(h.signals.decide).toHaveBeenCalledTimes(1);
    const snapsBefore = h.of("snapshot").length;

    const cfg = h.engine.updateConfig({
      risk: { takerFee: 0.001 },
      ensemble: { buyThreshold: 0.5 },
      markets: ["BTC-EUR", "eth-eur"],
    } as unknown as Partial<EngineConfig>);
    expect(cfg.risk.takerFee).toBe(0.001);
    expect(cfg.risk.stopAtrMult).toBe(2);
    expect(cfg.risk.maxOpenPositions).toBe(2);
    expect(cfg.ensemble.buyThreshold).toBe(0.5);
    expect(cfg.ensemble.sellThreshold).toBe(-0.3);
    expect(cfg.ensemble.enabled).toHaveLength(5);
    expect(cfg.markets).toEqual(["BTC-EUR", "ETH-EUR"]);
    expect(cfg.interval).toBe("15m");
    expect(h.createRisk).toHaveBeenCalledTimes(2);
    expect(h.createRisk.mock.calls[1][0]).toMatchObject({ takerFee: 0.001, stopAtrMult: 2 });
    expect(h.createRisk.mock.calls[1][1]).toBe("15m");
    expect(h.of("snapshot").length).toBe(snapsBefore + 1);
    expect(h.engine.snapshot().config.risk.takerFee).toBe(0.001);

    // teruggegeven config is een kopie
    cfg.risk.takerFee = 0.5;
    expect(h.engine.snapshot().config.risk.takerFee).toBe(0.001);

    // BTC-EUR (bleef in de lijst) wordt NIET opnieuw beoordeeld op dezelfde candle
    // (anders kan een al verhandeld signaal opnieuw gekocht worden); ETH-EUR (nieuw) wel.
    h.feed.setSeries("ETH-EUR", 3_000, T0);
    await h.engine.tick();
    expect(h.signals.decide.mock.calls.filter((c) => c[0] === "BTC-EUR")).toHaveLength(1);
    expect(h.signals.decide.mock.calls.filter((c) => c[0] === "ETH-EUR")).toHaveLength(1);

    // Een markt verwijderen en weer toevoegen: dan wel opnieuw beoordeeld
    h.engine.updateConfig({ markets: ["ETH-EUR"] });
    h.engine.updateConfig({ markets: ["ETH-EUR", "BTC-EUR"] });
    await h.engine.tick();
    expect(h.signals.decide.mock.calls.filter((c) => c[0] === "BTC-EUR")).toHaveLength(2);
  });

  it("zelfde koopsignaal wordt niet twee keer verhandeld na take-profit + marktwijziging (scanner/instellingen)", async () => {
    const h = setup({ markets: ["BTC-EUR"] });
    const pos = await openBtcPosition(h);
    h.clock.advance(15_000);
    h.feed.setLast("BTC-EUR", 52_100); // take-profit
    await h.engine.tick();
    expect(h.engine.snapshot().positions).toHaveLength(0);
    expect(h.engine.snapshot().trades[0].exitReason).toBe("take-profit");

    // Markt toevoegen, en ook BTC-EUR even verwijderen en terugzetten: nog steeds dezelfde candle
    h.feed.setSeries("ETH-EUR", 3_000, T0);
    h.engine.updateConfig({ markets: ["BTC-EUR", "ETH-EUR"] });
    h.engine.updateConfig({ markets: ["ETH-EUR"] });
    h.engine.updateConfig({ markets: ["ETH-EUR", "BTC-EUR"] });
    h.clock.advance(15_000);
    await h.engine.tick();
    expect(h.broker.buys()).toHaveLength(2); // BTC eenmaal + ETH (nieuw, eigen signaal op dezelfde tijd)
    expect(h.broker.buys().filter((o) => o.req.market === "BTC-EUR")).toHaveLength(1);
    expect(h.logs().some((m) => m.startsWith("Geen koop BTC-EUR: het signaal van deze candle is al verhandeld"))).toBe(true);
    expect(pos.market).toBe("BTC-EUR");
  });

  it("zonder markt/interval-wijziging blijft de evaluatie staan; ongeldige waarden gooien", async () => {
    const h = setup();
    await h.engine.tick();
    h.engine.updateConfig({ pollMs: 5_000 });
    await h.engine.tick();
    expect(h.signals.decide).toHaveBeenCalledTimes(1);
    expect(() => h.engine.updateConfig({ interval: "3m" as never })).toThrow(/Ongeldig interval/);
    expect(() => h.engine.updateConfig({ pollMs: 0 })).toThrow();
    expect(h.engine.snapshot().config.pollMs).toBe(5_000);
  });

  it("interval-wijziging reset de evaluatie en telt oude candles niet dubbel", async () => {
    const h = setup();
    await openBtcPosition(h);
    h.engine.updateConfig({ interval: "1h" });
    expect(h.createRisk.mock.calls.at(-1)![1]).toBe("1h");
    h.clock.advance(15_000);
    await h.engine.tick();
    expect(h.engine.snapshot().positions[0].candlesHeld).toBe(0);
    expect(h.feed.calls.at(-1)!.interval).toBe("1h");
  });
});

describe("TradingEngine — persistentie", () => {
  let dir: string;
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "engine-test-"));
  });
  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it("round-trip: herstart → posities, cash, trades en paper-balances hersteld; candles niet dubbel geteld", async () => {
    const file = join(dir, "nested", "state.json");
    const clock = new Clock(T0 + 60_000);
    const feed = new FakeFeed();
    feed.setSeries("BTC-EUR", 50_000, T0);
    const h1 = setup({ clock, feed, deps: { store: new StateStore(file) } });
    const pos = await openBtcPosition(h1);
    clock.set(T0 + I15 + 30_000);
    feed.append("BTC-EUR", 50_000);
    await h1.engine.tick();
    clock.set(T0 + 2 * I15 + 30_000);
    feed.append("BTC-EUR", 50_100);
    await h1.engine.tick();
    expect(h1.engine.snapshot().positions[0].candlesHeld).toBe(1);
    await h1.engine.stop();
    expect(existsSync(file)).toBe(true);
    const cash1 = h1.engine.snapshot().account.cashQuote;

    // Herstart met een nieuwe broker en store op hetzelfde bestand
    const broker2 = new FakeBroker("paper");
    const h2 = setup({ clock, feed, broker: broker2, deps: { store: new StateStore(file) } });
    const s = h2.engine.snapshot();
    expect(s.positions).toHaveLength(1);
    expect(s.positions[0].id).toBe(pos.id);
    expect(s.positions[0].stopPrice).toBe(pos.stopPrice);
    expect(s.account.cashQuote).toBeCloseTo(cash1, 9);
    expect(s.account.tradesToday).toBe(1);
    expect(broker2.restored).not.toBeNull();
    expect(broker2.restored!.find((b) => b.symbol === "EUR")!.available).toBeCloseTo(980, 9);
    expect(broker2.restored!.find((b) => b.symbol === "BTC")!.available).toBeCloseTo(pos.amount, 12);
    expect(s.logs.some((l) => l.message.startsWith("Opgeslagen staat hersteld: 1 open positie"))).toBe(true);

    await h2.engine.start();
    expect(h2.engine.snapshot().positions[0].candlesHeld).toBe(1); // niet dubbel
    clock.set(T0 + 3 * I15 + 30_000);
    feed.append("BTC-EUR", 50_100);
    await h2.engine.tick();
    expect(h2.engine.snapshot().positions[0].candlesHeld).toBe(2);
    // exit werkt na herstel (broker kent de BTC dankzij restore)
    const trade = await h2.engine.closePosition(pos.id);
    expect(trade).not.toBeNull();
    await h2.engine.stop();

    // Live engine negeert paper-staat
    const h3 = setup({ mode: "live", clock, feed, deps: { store: new StateStore(file) } });
    expect(h3.engine.snapshot().positions).toHaveLength(0);
    expect(h3.engine.snapshot().trades).toHaveLength(0);
    expect(h3.logs().some((m) => m.includes("hoort bij paper mode"))).toBe(true);
  });

  it("slaat na elke tick op (debounced) en na een trade direct", async () => {
    vi.useFakeTimers();
    try {
      const file = join(dir, "state.json");
      const store = new StateStore(file);
      const h = setup({ deps: { store } });
      await h.engine.tick();
      expect(existsSync(file)).toBe(false); // nog in debounce
      await vi.advanceTimersByTimeAsync(600);
      expect(existsSync(file)).toBe(true);
      expect(store.load()!.positions).toHaveLength(0);
      h.feed.append("BTC-EUR", 50_000);
      h.clock.set(h.feed.lastTime("BTC-EUR") + 1_000);
      h.signals.buyAt.add(h.lastClosed());
      await h.engine.tick();
      // direct na de trade weggeschreven (flush), zonder op de timer te wachten
      expect(new StateStore(file).load()!.positions).toHaveLength(1);
    } finally {
      vi.useRealTimers();
    }
  });

  it("corrupt statusbestand → verse start, bestand hernoemd naar .corrupt-*", () => {
    const file = join(dir, "state.json");
    writeFileSync(file, "{ dit is geen json");
    const h = setup({ deps: { store: new StateStore(file) } });
    const s = h.engine.snapshot();
    expect(s.positions).toHaveLength(0);
    expect(s.account.cashQuote).toBe(100);
    expect(existsSync(file)).toBe(false);
    expect(readdirSync(dir).some((f) => f.startsWith("state.json.corrupt-"))).toBe(true);
  });

  it("ongeldige posities in de opgeslagen staat worden overgeslagen", async () => {
    const file = join(dir, "state.json");
    const h1 = setup({ deps: { store: new StateStore(file) } });
    await openBtcPosition(h1);
    await h1.engine.stop();
    const store = new StateStore(file);
    const st = store.load()!;
    st.positions.push({ id: "kapot", market: "ETH-EUR" } as unknown as Position);
    store.save(st);
    store.flush();
    const h2 = setup({ deps: { store: new StateStore(file) } });
    expect(h2.engine.snapshot().positions).toHaveLength(1);
    expect(h2.logs().some((m) => m.includes("1 ongeldige positie"))).toBe(true);
  });

  it("live: herstelde cash wordt begrensd op de (nieuwe) kapitaallimiet", async () => {
    const file = join(dir, "state.json");
    const h1 = setup({ mode: "live", startingCapital: 50, deps: { store: new StateStore(file) } });
    await h1.engine.stop();
    const h2 = setup({ mode: "live", startingCapital: 30, deps: { store: new StateStore(file) } });
    expect(h2.engine.snapshot().account.cashQuote).toBe(30);
  });
});
