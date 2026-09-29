import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";

vi.mock("../../src/strategies/ensemble", () => ({ runEnsemble: vi.fn(() => []) }));
vi.mock("../../src/risk/riskManager", () => ({ RiskManager: vi.fn() }));

import type { MarketOrderRequest, OrderResult } from "../../src/core/types";
import { StateStore } from "../../src/engine/stateStore";
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

  it("live: koop met UITKOMST ONBEKEND → geen positie, niet opnieuw verstuurd, ALLE entries geblokkeerd; opnieuw armen heft dat niet op", async () => {
    const h = setup({ mode: "live", startingCapital: 50, markets: ["BTC-EUR", "ETH-EUR"] });
    h.engine.arm();
    h.broker.script.push((req) =>
      result(req, { status: "new", error: "UITKOMST ONBEKEND: time-out bij het plaatsen, order kon niet opgezocht worden" }),
    );
    // BTC en ETH geven in dezelfde tick een koopsignaal; BTC komt eerst.
    h.signals.buyAt.add(h.lastClosed());
    await h.engine.tick();
    let s = h.engine.snapshot();
    expect(s.positions).toHaveLength(0);
    expect(s.account.cashQuote).toBe(50);
    const clientOrderId = h.broker.orders[0].req.clientOrderId!;
    const err = s.logs.find((l) => l.level === "error" && l.message.startsWith("UITKOMST ONBEKEND bij koop BTC-EUR"));
    expect(err?.message).toContain(clientOrderId);
    // ETH in dezelfde tick: NIET gekocht (het budget kan al besteed zijn)
    expect(h.broker.orders).toHaveLength(1);
    expect(h.logs().some((m) => m.startsWith("Geen koop ETH-EUR: kooporder met onbekende uitkomst in BTC-EUR"))).toBe(true);
    expect(s.unknownOrders).toEqual([{ market: "BTC-EUR", clientOrderId, quoteAmount: 20, at: h.clock.t }]);

    // Zelfde candle: niet opnieuw. Volgende candle met koopsignaal: geblokkeerd.
    h.clock.advance(15_000);
    await h.engine.tick();
    nextBuyCandle(h);
    h.feed.append("ETH-EUR", 3_000);
    await h.engine.tick();
    expect(h.broker.orders).toHaveLength(1);
    expect(h.logs().some((m) => m.includes("onbekende uitkomst") && m.startsWith("Geen koop BTC-EUR"))).toBe(true);

    // Opnieuw armen (of een herstart) is geen bewijs dat de order niet is uitgevoerd: blokkade blijft.
    h.engine.disarm();
    h.engine.arm();
    expect(h.logs().some((m) => m.startsWith("Blokkade na onbekende orderuitkomst opgeheven"))).toBe(false);
    nextBuyCandle(h);
    h.feed.append("ETH-EUR", 3_000);
    await h.engine.tick();
    expect(h.broker.orders).toHaveLength(1);

    // Pas na expliciete bevestiging door de gebruiker weer entries.
    h.engine.acknowledgeUnknownOrders();
    expect(h.logs().some((m) => m.startsWith("Blokkade na kooporder(s) met onbekende uitkomst handmatig opgeheven"))).toBe(true);
    nextBuyCandle(h);
    await h.engine.tick();
    expect(h.broker.buys().map((o) => o.req.market)).toEqual(["BTC-EUR", "BTC-EUR", "ETH-EUR"]);
    s = h.engine.snapshot();
    expect(s.positions.map((p) => p.market).sort()).toEqual(["BTC-EUR", "ETH-EUR"]);
    expect(s.unknownOrders).toEqual([]);
  });

  it("live: onbekende koop blijft na een herstart geblokkeerd (opgeslagen)", async () => {
    const dir = mkdtempSync(join(tmpdir(), "engine-unknown-"));
    try {
      const file = join(dir, "state.json");
      const h1 = setup({ mode: "live", startingCapital: 50, deps: { store: new StateStore(file) } });
      h1.engine.arm();
      h1.broker.script.push((req) => result(req, { status: "new", error: "UITKOMST ONBEKEND: netwerkfout" }));
      h1.signals.buyAt.add(h1.lastClosed());
      await h1.engine.tick();
      await h1.engine.stop();

      const h2 = setup({ mode: "live", startingCapital: 50, clock: h1.clock, deps: { store: new StateStore(file) } });
      expect(h2.engine.snapshot().unknownOrders).toHaveLength(1);
      h2.engine.arm();
      await h2.engine.start();
      nextBuyCandle(h2);
      await h2.engine.tick();
      expect(h2.broker.orders).toHaveLength(0);
      expect(h2.logs().some((m) => m.startsWith("Kooporder(s) met onbekende uitkomst: BTC-EUR"))).toBe(true);
      await h2.engine.stop();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("live: onbekende koop die bij Bitvavo gevuld blijkt wordt alsnog geboekt, met stop, en de blokkade vervalt", async () => {
    const h = setup({ mode: "live", startingCapital: 50, markets: ["BTC-EUR", "ETH-EUR"] });
    h.engine.arm();
    h.broker.script.push((req) => result(req, { status: "new", error: "UITKOMST ONBEKEND: time-out" }));
    h.signals.buyAt.add(h.lastClosed());
    await h.engine.tick();
    const id = h.broker.orders[0].req.clientOrderId!;
    const placedAt = h.clock.t;

    // Eerst nog onbekend (lookup gooit) → blokkade blijft
    h.broker.lookupOrder = async () => {
      throw new Error("time-out");
    };
    h.clock.advance(15_000);
    await h.engine.tick();
    expect(h.engine.snapshot().unknownOrders).toHaveLength(1);
    expect(h.engine.snapshot().positions).toHaveLength(0);

    // Dan gevonden: gevuld voor 20 EUR incl. fee op 50.100
    const lookups: string[] = [];
    h.broker.lookupOrder = async (market, clientOrderId) => {
      lookups.push(`${market}:${clientOrderId}`);
      const amount = 0.000398;
      return {
        orderId: "ord-late",
        clientOrderId,
        market,
        side: "buy",
        status: "filled",
        filledAmount: amount,
        filledQuote: amount * 50_100,
        avgPrice: 50_100,
        feeQuote: 0.05,
        timestamp: 0,
      };
    };
    h.clock.advance(15_000);
    await h.engine.tick();
    expect(lookups).toEqual([`BTC-EUR:${id}`]);
    const s = h.engine.snapshot();
    expect(s.unknownOrders).toEqual([]);
    expect(s.positions).toHaveLength(1);
    const pos = s.positions[0];
    expect(pos.market).toBe("BTC-EUR");
    expect(pos.amount).toBe(0.000398);
    expect(pos.entryPrice).toBe(50_100);
    expect(pos.costQuote).toBeCloseTo(0.000398 * 50_100 + 0.05, 9);
    // stop/doel met de plan-afstanden (StubRisk: 1000 / 2000) rond de echte vulprijs
    expect(pos.stopPrice).toBeCloseTo(49_100, 6);
    expect(pos.takeProfitPrice).toBeCloseTo(52_100, 6);
    expect(pos.entryTime).toBe(placedAt);
    expect(s.account.cashQuote).toBeCloseTo(50 - pos.costQuote, 9);
    expect(h.logs().some((m) => m.startsWith("KOOP BTC-EUR alsnog uitgevoerd"))).toBe(true);
    expect(h.of("position-opened")).toHaveLength(1);

    // De geboekte positie wordt bewaakt: stop-loss verkoopt hem
    h.clock.advance(15_000);
    h.feed.setLast("BTC-EUR", 49_000);
    h.broker.balances.set("BTC", 0.000398);
    await h.engine.tick();
    expect(h.broker.sells()).toHaveLength(1);
    expect(h.engine.snapshot().positions).toHaveLength(0);
  });

  it("live: onbekende koop die bij Bitvavo 3 ticks op rij niet bestaat (null) heft de blokkade op zonder positie", async () => {
    // Herschreven (ronde 2): één "niet gevonden" was genoeg; nu pas na 3 ticks op rij.
    const h = setup({ mode: "live", startingCapital: 50 });
    h.engine.arm();
    h.broker.script.push((req) => result(req, { status: "new", error: "UITKOMST ONBEKEND: time-out" }));
    h.signals.buyAt.add(h.lastClosed());
    await h.engine.tick();
    const lookups: string[] = [];
    h.broker.lookupOrder = async (_m, cid) => {
      lookups.push(cid);
      return null;
    };
    // Tick 1 en 2: nog geblokkeerd (1/3, 2/3), ook bij een nieuw koopsignaal
    nextBuyCandle(h);
    await h.engine.tick();
    expect(h.engine.snapshot().unknownOrders).toHaveLength(1);
    expect(h.broker.buys()).toHaveLength(1);
    expect(h.logs().some((m) => m.includes("nog niet gevonden bij Bitvavo (1/3)"))).toBe(true);
    h.clock.advance(15_000);
    await h.engine.tick();
    expect(h.engine.snapshot().unknownOrders).toHaveLength(1);
    expect(h.logs().some((m) => m.includes("(2/3)"))).toBe(true);
    expect(h.logs().some((m) => m.includes("bestaat volgens Bitvavo niet"))).toBe(false);
    // Tick 3: definitief niet geplaatst → blokkade weg, vóór de entries van deze tick
    nextBuyCandle(h);
    await h.engine.tick();
    const s = h.engine.snapshot();
    expect(lookups).toHaveLength(3);
    expect(s.unknownOrders).toEqual([]);
    expect(h.logs().some((m) => m.includes("bestaat volgens Bitvavo niet") && m.includes("3× op rij niet gevonden"))).toBe(true);
    expect(h.broker.buys()).toHaveLength(2);
    expect(s.positions).toHaveLength(1);
    expect(s.account.cashQuote).toBeCloseTo(30, 9);
  });

  it("live: 'niet gevonden' telt alleen op rij — een lookup-fout of open status zet de teller terug", async () => {
    const h = setup({ mode: "live", startingCapital: 50 });
    h.engine.arm();
    h.broker.script.push((req) => result(req, { status: "new", error: "UITKOMST ONBEKEND: time-out" }));
    h.signals.buyAt.add(h.lastClosed());
    await h.engine.tick();
    const answers: ("null" | "throw" | "open")[] = ["null", "null", "throw", "null", "null", "open", "null", "null", "null"];
    h.broker.lookupOrder = async (market, clientOrderId) => {
      const a = answers.shift();
      if (a === "throw") throw new Error("rate limit");
      if (a === "open")
        return { orderId: "o", clientOrderId, market, side: "buy", status: "new", filledAmount: 0, filledQuote: 0, avgPrice: 0, feeQuote: 0, timestamp: 0 };
      return null;
    };
    for (let i = 0; i < 8; i++) {
      h.clock.advance(15_000);
      await h.engine.tick();
      expect(h.engine.snapshot().unknownOrders).toHaveLength(1);
    }
    h.clock.advance(15_000);
    await h.engine.tick(); // derde null op rij
    expect(h.engine.snapshot().unknownOrders).toEqual([]);
  });

  it("live: noodstop telt 'niet gevonden' niet mee en meldt de onbekende koop als niet gesloten", async () => {
    const h = setup({ mode: "live", startingCapital: 50 });
    h.engine.arm();
    h.broker.script.push((req) => result(req, { status: "new", error: "UITKOMST ONBEKEND: time-out" }));
    h.signals.buyAt.add(h.lastClosed());
    await h.engine.tick();
    h.broker.lookupOrder = async () => null;
    const res = await h.engine.killSwitch();
    expect(res.closed).toBe(0);
    expect(res.failed).toHaveLength(1);
    expect(res.failed[0].market).toBe("BTC-EUR");
    expect(res.failed[0].reason).toContain("kooporder met onbekende uitkomst");
    expect(h.engine.snapshot().unknownOrders).toHaveLength(1);
  });

  it("live: deels gevulde koop met UITKOMST ONBEKEND → bekende deel geboekt, blokkade tot opgehelderd, later bijgeboekt", async () => {
    const h = setup({ mode: "live", startingCapital: 50, markets: ["BTC-EUR", "ETH-EUR"] });
    h.engine.arm();
    h.broker.script.push((req, ref) =>
      result(req, {
        status: "partiallyFilled",
        filledAmount: 0.0002,
        filledQuote: 0.0002 * ref,
        avgPrice: ref,
        feeQuote: 0.025,
        error: "UITKOMST ONBEKEND: order ord-x is nog open of niet te controleren",
      }),
    );
    h.signals.buyAt.add(h.lastClosed());
    await h.engine.tick();
    let s = h.engine.snapshot();
    expect(s.positions).toHaveLength(1);
    expect(s.positions[0].amount).toBe(0.0002);
    expect(s.unknownOrders).toHaveLength(1);
    expect(h.broker.orders).toHaveLength(1); // ETH niet gekocht
    const posId = s.positions[0].id;

    h.broker.lookupOrder = async (market, clientOrderId) => ({
      orderId: "ord-x",
      clientOrderId,
      market,
      side: "buy",
      status: "filled",
      filledAmount: 0.0004,
      filledQuote: 0.0004 * 50_000,
      avgPrice: 50_000,
      feeQuote: 0.05,
      timestamp: 0,
    });
    h.clock.advance(15_000);
    await h.engine.tick();
    s = h.engine.snapshot();
    expect(s.unknownOrders).toEqual([]);
    expect(s.positions).toHaveLength(1);
    expect(s.positions[0].id).toBe(posId);
    expect(s.positions[0].amount).toBeCloseTo(0.0004, 12);
    expect(s.positions[0].costQuote).toBeCloseTo(20.05, 9);
    expect(s.account.cashQuote).toBeCloseTo(50 - 20.05, 9);
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

    // De verkoop bleek toch uitgevoerd: geen BTC meer op het account.
    // Herschreven (ronde 2): pas bij de tweede waarneming (volgende tick) wordt er geboekt.
    h.broker.balances.set("BTC", 0);
    h.clock.advance(15_000);
    await h.engine.tick();
    s = h.engine.snapshot();
    expect(h.broker.sells()).toHaveLength(sellsBefore); // niet opnieuw verstuurd
    expect(s.positions).toHaveLength(1);
    expect(h.logs().some((m) => m.startsWith("BTC-EUR: er staat maar 0 van") && m.includes("op Bitvavo"))).toBe(true);
    h.clock.advance(15_000);
    await h.engine.tick();
    s = h.engine.snapshot();
    expect(h.broker.sells()).toHaveLength(sellsBefore);
    expect(s.positions).toHaveLength(0);
    expect(s.trades).toHaveLength(1);
    expect(s.trades[0].amount).toBeCloseTo(pos.amount, 12);
    expect(s.trades[0].exitReason).toBe("stop-loss");
    const msg = h.logs().find((m) => m.includes("staat niet meer op Bitvavo"));
    expect(msg).toContain("vermoedelijk verkocht bij de order met onbekende uitkomst");
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

  it("live: coins niet meer op Bitvavo (zonder eerdere onbekende uitkomst) → geen verkooporder, positie in de administratie gesloten", async () => {
    const h = setup({ mode: "live", startingCapital: 50 });
    h.engine.arm();
    const pos = await openBtcPosition(h);
    // Bijv. in de Bitvavo-app verkocht, of een eerdere verkoop die laat alsnog vulde
    h.broker.balances.set("BTC", 0);
    h.broker.balances.set("EUR", 1_000);
    h.clock.advance(15_000);
    h.feed.setLast("BTC-EUR", 48_900);
    await h.engine.tick();
    // Herschreven (ronde 2): één saldo-antwoord is niet genoeg — eerst nog een tick kijken.
    let s = h.engine.snapshot();
    expect(h.broker.sells()).toHaveLength(0);
    expect(s.positions).toHaveLength(1);
    expect(s.trades).toHaveLength(0);
    h.clock.advance(15_000);
    await h.engine.tick();
    s = h.engine.snapshot();
    expect(h.broker.sells()).toHaveLength(0);
    expect(s.positions).toHaveLength(0);
    expect(s.trades).toHaveLength(1);
    expect(s.trades[0].amount).toBeCloseTo(pos.amount, 12);
    expect(s.trades[0].exitPrice).toBe(48_900);
    const msg = s.logs.find((l) => l.message.includes("staat niet meer op Bitvavo"));
    expect(msg?.level).toBe("error");
    expect(msg?.message).toContain("verkocht buiten de bot");
    // Geen eindeloze verkooppogingen daarna
    for (let i = 0; i < 5; i++) {
      h.clock.advance(15_000);
      await h.engine.tick();
    }
    expect(h.broker.orders.filter((o) => o.req.side === "sell")).toHaveLength(0);
    s = h.engine.snapshot();
    expect(s.account.cashQuote).toBeCloseTo(30 + pos.amount * 48_900 * (1 - FEE), 9);
  });

  it("live: handmatig sluiten van een positie waarvan de coins weg zijn werkt ook (ook ontwapend)", async () => {
    const h = setup({ mode: "live", startingCapital: 50 });
    h.engine.arm();
    const pos = await openBtcPosition(h);
    h.engine.disarm();
    h.broker.balances.set("BTC", pos.amount * 0.004); // stofrestje
    const trade = await h.engine.closePosition(pos.id);
    expect(trade).not.toBeNull();
    expect(h.broker.sells()).toHaveLength(0);
    expect(h.engine.snapshot().positions).toHaveLength(0);
  });

  it("live: een leeg saldo-antwoord sluit niets af, er wordt gewoon verkocht", async () => {
    const h = setup({ mode: "live", startingCapital: 50 });
    h.engine.arm();
    const pos = await openBtcPosition(h);
    h.broker.emptyBalances = true;
    h.clock.advance(15_000);
    h.feed.setLast("BTC-EUR", 48_900);
    await h.engine.tick();
    expect(h.broker.sells()).toHaveLength(1);
    expect(h.broker.sells()[0].req.amount).toBe(pos.amount);
  });

  it("live: 40% beschikbaar en 60% in een openstaande order → niet verkopen, niet afboeken, positie blijft", async () => {
    const h = setup({ mode: "live", startingCapital: 50 });
    h.engine.arm();
    const pos = await openBtcPosition(h);
    h.broker.balances.set("BTC", pos.amount * 0.4);
    h.broker.inOrder.set("BTC", pos.amount * 0.6);
    h.clock.advance(15_000);
    h.feed.setLast("BTC-EUR", 50_100); // +0,2%
    const trade = await h.engine.closePosition(pos.id);
    expect(trade).toBeNull();
    let s = h.engine.snapshot();
    expect(h.broker.sells()).toHaveLength(0);
    expect(s.positions).toHaveLength(1);
    expect(s.positions[0].amount).toBe(pos.amount);
    expect(s.trades).toHaveLength(0);
    expect(s.account.realizedPnlToday).toBe(0);
    expect(h.logs().some((m) => m.includes("zit in een openstaande order op Bitvavo"))).toBe(true);

    // Order geannuleerd: alles weer beschikbaar → normale verkoop
    h.broker.balances.set("BTC", pos.amount);
    h.broker.inOrder.delete("BTC");
    const t2 = await h.engine.closePosition(pos.id);
    expect(t2).not.toBeNull();
    expect(h.broker.sells()).toHaveLength(1);
    expect(h.broker.sells()[0].req.amount).toBe(pos.amount);
    s = h.engine.snapshot();
    expect(s.positions).toHaveLength(0);
    expect(t2!.pnlPct).toBeGreaterThan(-1);
  });

  it("live: 40% beschikbaar en de rest echt weg → ontbrekend deel geschat geboekt, rest verkocht, geen nep-verlies", async () => {
    const h = setup({ mode: "live", startingCapital: 50 });
    h.engine.arm();
    const pos = await openBtcPosition(h);
    const avail = pos.amount * 0.4;
    h.broker.balances.set("BTC", avail);
    h.feed.setLast("BTC-EUR", 50_100); // +0,2%
    const trade = await h.engine.closePosition(pos.id);
    expect(trade).not.toBeNull();
    const s = h.engine.snapshot();
    expect(h.broker.sells()).toHaveLength(1);
    expect(h.broker.sells()[0].req.amount).toBeCloseTo(avail, 12);
    expect(s.positions).toHaveLength(0);
    expect(s.trades).toHaveLength(2);
    const totalCost = s.trades.reduce((a, t) => a + t.costQuote, 0);
    const totalAmount = s.trades.reduce((a, t) => a + t.amount, 0);
    expect(totalCost).toBeCloseTo(pos.costQuote, 9);
    expect(totalAmount).toBeCloseTo(pos.amount, 12);
    for (const t of s.trades) expect(t.pnlPct).toBeGreaterThan(-1); // alleen kosten, geen -60%
    expect(h.logs().some((m) => m.includes("het ontbrekende deel wordt geboekt"))).toBe(true);
    expect(h.logs().some((m) => m.includes("rest volgt bij de volgende tick"))).toBe(false);
  });

  it("live: iets minder saldo (afronding, < 5%) → verkoop wat er is en sluit de positie", async () => {
    const h = setup({ mode: "live", startingCapital: 50 });
    h.engine.arm();
    const pos = await openBtcPosition(h);
    h.broker.balances.set("BTC", pos.amount * 0.98);
    const trade = await h.engine.closePosition(pos.id);
    expect(trade).not.toBeNull();
    expect(h.broker.sells()[0].req.amount).toBeCloseTo(pos.amount * 0.98, 12);
    expect(h.engine.snapshot().positions).toHaveLength(0);
    expect(h.engine.snapshot().trades).toHaveLength(1);
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
