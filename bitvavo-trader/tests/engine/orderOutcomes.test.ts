import { describe, expect, it, vi } from "vitest";

vi.mock("../../src/strategies/ensemble", () => ({ runEnsemble: vi.fn(() => []) }));
vi.mock("../../src/risk/riskManager", () => ({ RiskManager: vi.fn() }));

import type { MarketOrderRequest, OrderResult } from "../../src/core/types";
import { I15, T0, openBtcPosition, setup, type Harness } from "./helpers";

const FEE = 0.0025;

function result(req: MarketOrderRequest, o: Partial<OrderResult>): OrderResult {
  return {
    orderId: "ord-x",
    clientOrderId: req.clientOrderId,
    market: req.market,
    side: req.side,
    status: "filled",
    filledAmount: 0,
    filledQuote: 0,
    avgPrice: 0,
    feeQuote: 0,
    timestamp: 0,
    ...o,
  };
}

/** Volgende candle laten sluiten met een koopsignaal erop. */
function nextBuyCandle(h: Harness): void {
  h.feed.append("BTC-EUR", 50_000);
  h.clock.set(h.feed.lastTime("BTC-EUR") + 30_000);
  h.signals.buyAt.add(h.lastClosed());
}

describe("TradingEngine — orderuitkomsten van de broker", () => {
  it("een gevulde koop met een waarschuwing in `error` opent gewoon een positie", async () => {
    const h = setup();
    h.broker.script.push((req, ref) =>
      result(req, {
        filledAmount: 0.0004,
        filledQuote: 0.0004 * ref,
        avgPrice: ref,
        feeQuote: 0.05,
        error: "Let op: slippage 0,6% hoger dan verwacht",
      }),
    );
    const pos = await openBtcPosition(h);
    expect(pos.amount).toBe(0.0004);
    expect(pos.costQuote).toBeCloseTo(20.05, 9);
    expect(h.logs().some((m) => m.startsWith("Melding bij koop BTC-EUR: Let op: slippage"))).toBe(true);
  });

  it("partiallyFilled koop → positie met alleen het gevulde deel", async () => {
    const h = setup();
    h.broker.script.push((req, ref) =>
      result(req, { status: "partiallyFilled", filledAmount: 0.0002, filledQuote: 0.0002 * ref, avgPrice: ref, feeQuote: 0.025 }),
    );
    const pos = await openBtcPosition(h);
    expect(pos.amount).toBe(0.0002);
    expect(pos.costQuote).toBeCloseTo(10.025, 9);
    const s = h.engine.snapshot();
    expect(s.account.cashQuote).toBeCloseTo(100 - 10.025, 9);
    expect(h.logs().some((m) => m.includes("niet volledig gevuld"))).toBe(true);
  });

  it("partiallyFilled verkoop → trade voor het verkochte deel, rest blijft open en wordt de volgende tick verkocht", async () => {
    const h = setup();
    const pos = await openBtcPosition(h);
    const half = pos.amount / 2;
    h.broker.script.push((req, ref) =>
      result(req, {
        status: "partiallyFilled",
        filledAmount: half,
        filledQuote: half * ref,
        avgPrice: ref,
        feeQuote: half * ref * FEE,
      }),
    );
    h.clock.advance(15_000);
    h.feed.setLast("BTC-EUR", 48_900);
    await h.engine.tick();
    let s = h.engine.snapshot();
    expect(s.trades).toHaveLength(1);
    expect(s.trades[0].amount).toBeCloseTo(half, 12);
    expect(s.trades[0].costQuote).toBeCloseTo(pos.costQuote / 2, 9);
    expect(s.positions).toHaveLength(1);
    expect(s.positions[0].amount).toBeCloseTo(half, 12);
    expect(s.positions[0].costQuote).toBeCloseTo(pos.costQuote / 2, 9);
    expect(h.logs().some((m) => m.includes("deels gevuld"))).toBe(true);

    // Volgende tick: rest wordt verkocht, ook al staat de koers weer boven de stop
    h.clock.advance(15_000);
    h.feed.setLast("BTC-EUR", 49_500);
    await h.engine.tick();
    s = h.engine.snapshot();
    expect(h.broker.sells()).toHaveLength(2);
    expect(h.broker.sells()[1].req.amount).toBeCloseTo(half, 12);
    expect(s.positions).toHaveLength(0);
    expect(s.trades).toHaveLength(2);
    expect(s.trades.every((t) => t.exitReason === "stop-loss")).toBe(true);
    const totalCost = s.trades.reduce((a, t) => a + t.costQuote, 0);
    expect(totalCost).toBeCloseTo(pos.costQuote, 9);
  });

  it("partiallyFilled verkoop met een onverkoopbaar restje (< minimum) sluit de positie", async () => {
    const h = setup();
    const pos = await openBtcPosition(h);
    const most = pos.amount * 0.9; // rest ≈ €2 < €5 minimum
    h.broker.script.push((req, ref) =>
      result(req, { status: "partiallyFilled", filledAmount: most, filledQuote: most * ref, avgPrice: ref, feeQuote: 0.01 }),
    );
    const trade = await h.engine.closePosition(pos.id);
    expect(trade!.amount).toBeCloseTo(most, 12);
    expect(trade!.costQuote).toBeCloseTo(pos.costQuote, 9);
    expect(h.engine.snapshot().positions).toHaveLength(0);
    expect(h.logs().some((m) => m.includes("te klein om te verkopen"))).toBe(true);
  });

  it("live: 'filled' verkoop van iets minder dan de positie (saldo lager) sluit alles en gebruikt filledAmount", async () => {
    const h = setup({ mode: "live", startingCapital: 50 });
    h.engine.arm();
    const pos = await openBtcPosition(h);
    const sold = pos.amount * 0.97;
    h.broker.script.push((req, ref) =>
      result(req, {
        filledAmount: sold,
        filledQuote: sold * ref,
        avgPrice: ref,
        feeQuote: sold * ref * FEE,
        error: "Verkoophoeveelheid aangepast aan beschikbaar saldo",
      }),
    );
    const trade = (await h.engine.closePosition(pos.id))!;
    expect(trade.amount).toBeCloseTo(sold, 12);
    expect(trade.proceedsQuote).toBeCloseTo(sold * 50_000 * (1 - FEE), 9);
    expect(h.engine.snapshot().positions).toHaveLength(0);
    expect(h.logs().some((m) => m.startsWith("Melding bij verkoop BTC-EUR: Verkoophoeveelheid aangepast"))).toBe(true);
  });

  it("live: koop met UITKOMST ONBEKEND → geen positie, niet opnieuw verstuurd, markt geblokkeerd tot opnieuw armen", async () => {
    const h = setup({ mode: "live", startingCapital: 50 });
    h.engine.arm();
    h.broker.script.push((req) =>
      result(req, { status: "new", error: "UITKOMST ONBEKEND: time-out bij het plaatsen, order kon niet opgezocht worden" }),
    );
    h.signals.buyAt.add(h.lastClosed());
    await h.engine.tick();
    let s = h.engine.snapshot();
    expect(s.positions).toHaveLength(0);
    expect(s.account.cashQuote).toBe(50);
    expect(s.logs.some((l) => l.level === "error" && l.message.startsWith("UITKOMST ONBEKEND bij koop BTC-EUR"))).toBe(true);
    expect(h.broker.orders).toHaveLength(1);

    // Zelfde candle: niet opnieuw. Volgende candle met koopsignaal: geblokkeerd.
    h.clock.advance(15_000);
    await h.engine.tick();
    nextBuyCandle(h);
    await h.engine.tick();
    expect(h.broker.orders).toHaveLength(1);
    expect(h.logs().some((m) => m.includes("onbekende uitkomst") && m.startsWith("Geen koop BTC-EUR"))).toBe(true);

    // Handmatige actie (opnieuw armen) heft de blokkade op
    h.engine.disarm();
    h.engine.arm();
    expect(h.logs().some((m) => m.startsWith("Blokkade na onbekende orderuitkomst opgeheven"))).toBe(true);
    nextBuyCandle(h);
    await h.engine.tick();
    expect(h.broker.buys()).toHaveLength(2);
    s = h.engine.snapshot();
    expect(s.positions).toHaveLength(1);
  });

  it("live: verkoop met UITKOMST ONBEKEND → positie blijft; is het saldo daarna weg, dan wordt hij in de administratie gesloten", async () => {
    const h = setup({ mode: "live", startingCapital: 50 });
    h.engine.arm();
    const pos = await openBtcPosition(h);
    h.broker.script.push((req) => result(req, { status: "new", error: "UITKOMST ONBEKEND: netwerkfout" }));
    h.clock.advance(15_000);
    h.feed.setLast("BTC-EUR", 48_900);
    await h.engine.tick();
    let s = h.engine.snapshot();
    expect(s.positions).toHaveLength(1);
    expect(s.logs.some((l) => l.level === "error" && l.message.startsWith("UITKOMST ONBEKEND bij verkoop BTC-EUR"))).toBe(true);
    const sellsBefore = h.broker.sells().length;

    // De verkoop bleek toch uitgevoerd: geen BTC meer op het account
    h.broker.balances.set("BTC", 0);
    h.clock.advance(15_000);
    await h.engine.tick();
    s = h.engine.snapshot();
    expect(h.broker.sells()).toHaveLength(sellsBefore); // niet opnieuw verstuurd
    expect(s.positions).toHaveLength(0);
    expect(s.trades).toHaveLength(1);
    expect(s.trades[0].amount).toBeCloseTo(pos.amount, 12);
    expect(s.trades[0].exitReason).toBe("stop-loss");
    expect(h.logs().some((m) => m.includes("staat niet meer op Bitvavo"))).toBe(true);
  });

  it("live: verkoop met UITKOMST ONBEKEND en het saldo is er nog → volgende tick opnieuw verkopen", async () => {
    const h = setup({ mode: "live", startingCapital: 50 });
    h.engine.arm();
    await openBtcPosition(h);
    h.broker.script.push((req) => result(req, { status: "new", error: "UITKOMST ONBEKEND: netwerkfout" }));
    h.clock.advance(15_000);
    h.feed.setLast("BTC-EUR", 48_900);
    await h.engine.tick();
    h.clock.advance(15_000);
    await h.engine.tick();
    const s = h.engine.snapshot();
    expect(h.broker.sells()).toHaveLength(2);
    expect(s.positions).toHaveLength(0);
    expect(s.trades[0].exitReason).toBe("stop-loss");
  });

  it("paper: een gooiende broker is gewoon een afwijzing (geen blokkade)", async () => {
    const h = setup();
    h.broker.throwOnOrder = true;
    h.signals.buyAt.add(T0 - I15);
    await h.engine.tick();
    h.broker.throwOnOrder = false;
    nextBuyCandle(h);
    await h.engine.tick();
    expect(h.engine.snapshot().positions).toHaveLength(1);
  });
});
