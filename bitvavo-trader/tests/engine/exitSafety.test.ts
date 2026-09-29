/**
 * Ronde 2 — veiligheid rond verkopen en orderuitkomsten:
 *  - onverkoopbare posities (waarde onder het BEURSminimum): geen order, één melding,
 *    verkopen zodra het weer kan, afschrijven (writeOffPosition);
 *  - kooporders met onbekende uitkomst: definitief = zonder "UITKOMST ONBEKEND";
 *    bekende vullingen meteen boeken;
 *  - verkooporders met onbekende uitkomst: nooit een tweede verkoop tot opgehelderd
 *    (lookupOrder, 3× "niet gevonden", of — zonder lookup — geen coins meer in een order);
 *  - vangnet status "new" zonder vulling = onbekend; meldingen als de bot stilstaat;
 *  - noodstop geeft KillResult; setCosts in beide modi; orderInFlight;
 *  - coins "weg" pas na twee ticks; candlesHeld telt door tijdens een lopende exit;
 *  - HaltStatus.dailyLimit; regressietest met de ECHTE RiskManager (break-even).
 */
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_RISK_CONFIG } from "../../src/core/defaults";
import type { MarketOrderRequest, OrderResult, RiskConfig } from "../../src/core/types";
import { StateStore } from "../../src/engine/stateStore";
import { RiskManager } from "../../src/risk/riskManager";
import { Deferred, FakeBroker, I15, T0, marketInfo, openBtcPosition, setup, type Harness } from "./helpers";

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

function lookupResult(market: string, clientOrderId: string, o: Partial<OrderResult>): OrderResult {
  return {
    orderId: "ord-l",
    clientOrderId,
    market,
    side: "sell",
    status: "filled",
    filledAmount: 0,
    filledQuote: 0,
    avgPrice: 0,
    feeQuote: 0,
    timestamp: 0,
    ...o,
  };
}

function risk(over: Partial<RiskConfig>): RiskConfig {
  return { ...DEFAULT_RISK_CONFIG, ...over };
}

/** €6 BTC-positie (0,0001197 BTC): bij 40.000 is hij €4,78 waard (< €5). */
async function smallBtcPosition(h: Harness) {
  h.risk.quote = 6;
  return openBtcPosition(h);
}

const count = (h: Harness, pred: (m: string) => boolean) => h.logs().filter(pred).length;
const dustWarn = (m: string) => m.startsWith("BTC-EUR positie is onverkoopbaar: waarde €4,78 < minimum €5,00.");

let dirs: string[] = [];
afterEach(() => {
  vi.useRealTimers();
  for (const d of dirs) rmSync(d, { recursive: true, force: true });
  dirs = [];
});
function tmp(): string {
  const d = mkdtempSync(join(tmpdir(), "engine-exit-"));
  dirs.push(d);
  return d;
}

describe("Onverkoopbare posities (waarde onder het beursminimum)", () => {
  it("stop geraakt onder €5: geen order, één melding, snapshot toont onverkoopbaar; verkoopt zodra de waarde herstelt", async () => {
    vi.useFakeTimers();
    const h = setup();
    h.risk.quote = 6;
    h.signals.buyAt.add(h.lastClosed());
    await h.engine.start(); // de bot draait: melding belooft een verkoop zodra het kan
    expect(h.engine.snapshot().positions).toHaveLength(1);

    h.clock.advance(15_000);
    h.feed.setLast("BTC-EUR", 40_000); // stop (49.000) geraakt, waarde €4,78
    await h.engine.tick();
    let s = h.engine.snapshot();
    expect(h.broker.sells()).toHaveLength(0);
    expect(s.positions).toHaveLength(1);
    expect(s.positions[0].unsellable).toBe(true);
    expect(s.positions[0].unsellableReason).toContain("waarde €4,78 < minimum €5,00");
    expect(s.positions[0].unsellableReason).toContain("afschrijven");
    const warn = s.logs.find((l) => dustWarn(l.message))!;
    expect(warn.level).toBe("warn");
    expect(warn.message).toBe(
      "BTC-EUR positie is onverkoopbaar: waarde €4,78 < minimum €5,00. De bot verkoopt zodra de waarde weer ≥ €5,00 is; je kunt hem ook afschrijven.",
    );

    // Niet elke tick opnieuw proberen of melden
    for (let i = 0; i < 4; i++) {
      h.clock.advance(15_000);
      await h.engine.tick();
    }
    expect(h.broker.sells()).toHaveLength(0);
    expect(count(h, dustWarn)).toBe(1);

    // Waarde weer boven €5 (stop is nog steeds geraakt): nu wel verkopen
    h.clock.advance(15_000);
    h.feed.setLast("BTC-EUR", 45_000);
    await h.engine.tick();
    s = h.engine.snapshot();
    expect(h.broker.sells()).toHaveLength(1);
    expect(s.positions).toHaveLength(0);
    expect(s.trades[0].exitReason).toBe("stop-loss");
    expect(h.logs().some((m) => m.startsWith("BTC-EUR is weer verkoopbaar"))).toBe(true);
    await h.engine.stop();
  });

  it("gebruikt het BEURSminimum (marktinfo, anders €5) — nooit risk.minOrderQuote", async () => {
    // risk.minOrderQuote = 1: toch geen verkoop van €4,78
    const a = setup({ config: { risk: risk({ minOrderQuote: 1 }) } });
    await smallBtcPosition(a);
    a.feed.setLast("BTC-EUR", 40_000);
    a.clock.advance(15_000);
    await a.engine.tick();
    expect(a.broker.sells()).toHaveLength(0);
    expect(a.engine.snapshot().positions[0].unsellable).toBe(true);

    // risk.minOrderQuote = 20: €5,39 wordt gewoon verkocht
    const b = setup({ config: { risk: risk({ minOrderQuote: 20 }) } });
    await smallBtcPosition(b);
    b.feed.setLast("BTC-EUR", 45_000);
    expect(b.engine.snapshot().positions[0].unsellable).toBeUndefined();
    const t = await b.engine.closePosition(b.engine.snapshot().positions[0].id);
    expect(t).not.toBeNull();
    expect(b.broker.sells()).toHaveLength(1);

    // Marktinfo met minOrderQuote 10 en minOrderBase
    const c = setup();
    c.feed.getMarkets = async () => [{ ...marketInfo("BTC-EUR"), minOrderQuote: 10 }];
    await smallBtcPosition(c);
    c.feed.setLast("BTC-EUR", 45_000);
    expect(await c.engine.closePosition(c.engine.snapshot().positions[0].id)).toBeNull();
    expect(c.broker.sells()).toHaveLength(0);
    expect(c.engine.lastCloseFailure).toBe("onverkoopbaar: waarde €5,38 < minimum €10,00");

    const d = setup();
    d.feed.getMarkets = async () => [{ ...marketInfo("BTC-EUR"), minOrderBase: 0.001 }];
    await smallBtcPosition(d);
    expect(await d.engine.closePosition(d.engine.snapshot().positions[0].id)).toBeNull();
    expect(d.broker.sells()).toHaveLength(0);
    expect(d.engine.lastCloseFailure).toMatch(/^onverkoopbaar: hoeveelheid 0,000119\d* BTC < minimum 0,001 BTC$/);
  });

  it("handmatig sluiten en noodstop: onverkoopbare positie = mislukt met reden, zonder order", async () => {
    const h = setup({ markets: ["BTC-EUR", "ETH-EUR"] });
    h.risk.quote = 6;
    h.risk.stopDist = 20_000; // geen automatische exit
    await openBtcPosition(h); // koopt BTC én ETH
    let s = h.engine.snapshot();
    expect(s.positions.map((p) => p.market)).toEqual(["BTC-EUR", "ETH-EUR"]);
    const btc = s.positions[0];
    h.feed.setLast("BTC-EUR", 40_000);

    expect(await h.engine.closePosition(btc.id)).toBeNull();
    expect(h.broker.sells()).toHaveLength(0);
    expect(h.engine.lastCloseFailure).toBe("onverkoopbaar: waarde €4,78 < minimum €5,00");
    // Expliciete actie: melding altijd (de bot staat stil)
    expect(h.logs()[0]).toBe(
      "BTC-EUR positie is onverkoopbaar: waarde €4,78 < minimum €5,00. De bot staat stil — start de bot opnieuw (dan verkoopt hij zodra de waarde weer ≥ €5,00 is) of schrijf de positie af.",
    );

    const res = await h.engine.killSwitch();
    expect(res.closed).toBe(1);
    expect(res.failed).toEqual([{ id: btc.id, market: "BTC-EUR", reason: "onverkoopbaar: waarde €4,78 < minimum €5,00" }]);
    expect(h.broker.sells().map((o) => o.req.market)).toEqual(["ETH-EUR"]);
    s = h.engine.snapshot();
    expect(s.positions.map((p) => p.market)).toEqual(["BTC-EUR"]);
    expect(h.logs().some((m) => m.startsWith("NOODSTOP: 1 positie(s) gesloten, 1 NIET gesloten (BTC-EUR: onverkoopbaar: waarde €4,78"))).toBe(
      true,
    );
  });

  it("live: onverkoopbare stop gaat niet naar de broker (ook niet gearmd)", async () => {
    const h = setup({ mode: "live", startingCapital: 50 });
    h.engine.arm();
    await smallBtcPosition(h);
    h.clock.advance(15_000);
    h.feed.setLast("BTC-EUR", 40_000);
    await h.engine.tick();
    await h.engine.tick();
    expect(h.broker.sells()).toHaveLength(0);
    expect(count(h, dustWarn)).toBe(1);
    expect(h.engine.snapshot().positions[0].unsellable).toBe(true);
  });

  it("broker weigert met ONVERKOOPBAAR: positie gemarkeerd, één melding, niet elke tick opnieuw; handmatig sluiten probeert het wel", async () => {
    // Herschreven (ronde 3): de tweede tick verstuurde de verkoop opnieuw (en werd weer
    // geweigerd); nu gaat er bij dezelfde koers geen tweede order uit.
    const h = setup();
    const pos = await openBtcPosition(h);
    const refuse = (req: MarketOrderRequest) =>
      result(req, { status: "rejected", error: "ONVERKOOPBAAR: orderwaarde ca. €4,99 is lager dan het beursminimum van €5,00 voor BTC-EUR" });
    h.broker.script.push(refuse, refuse);
    h.clock.advance(15_000);
    h.feed.setLast("BTC-EUR", 48_900);
    await h.engine.tick();
    let s = h.engine.snapshot();
    expect(h.broker.sells()).toHaveLength(1);
    expect(s.positions[0].unsellable).toBe(true);
    expect(s.positions[0].unsellableReason).toContain("orderwaarde ca. €4,99");
    expect(count(h, (m) => m.startsWith("BTC-EUR positie is onverkoopbaar: orderwaarde ca. €4,99"))).toBe(1);
    for (let i = 0; i < 3; i++) {
      h.clock.advance(15_000);
      await h.engine.tick(); // zelfde koers: niet opnieuw versturen, geen nieuwe melding
    }
    expect(h.broker.sells()).toHaveLength(1);
    expect(count(h, (m) => m.startsWith("BTC-EUR positie is onverkoopbaar"))).toBe(1);
    expect(h.engine.snapshot().positions[0].unsellable).toBe(true);
    // Handmatig sluiten verstuurt hem wel (tweede weigering) en meldt de reden
    expect(await h.engine.closePosition(pos.id)).toBeNull();
    expect(h.broker.sells()).toHaveLength(2);
    expect(h.engine.lastCloseFailure).toBe(
      "onverkoopbaar: orderwaarde ca. €4,99 is lager dan het beursminimum van €5,00 voor BTC-EUR",
    );
    expect(count(h, (m) => m.startsWith("BTC-EUR positie is onverkoopbaar"))).toBe(2);
    // Koers hoger dan bij de weigering: de volgende tick probeert het opnieuw (en het lukt)
    h.feed.setLast("BTC-EUR", 49_000);
    h.clock.advance(15_000);
    await h.engine.tick();
    s = h.engine.snapshot();
    expect(h.broker.sells()).toHaveLength(3);
    expect(s.positions).toHaveLength(0);
    expect(s.trades[0].exitReason).toBe("manual"); // de laatst gevraagde exit (handmatig sluiten)
  });
});

describe("writeOffPosition", () => {
  it("alleen voor een onverkoopbare positie; boekt de inleg als verlies, cash blijft gelijk, wordt opgeslagen", async () => {
    const file = join(tmp(), "state.json");
    const h = setup({ deps: { store: new StateStore(file) } });
    const pos = await smallBtcPosition(h);
    expect(() => h.engine.writeOffPosition(pos.id)).toThrow(/^Afschrijven kan alleen/);
    expect(() => h.engine.writeOffPosition("pos_bestaatniet")).toThrow(/niet gevonden/);

    h.feed.setLast("BTC-EUR", 40_000);
    h.clock.advance(15_000);
    h.risk.stopDist = 20_000;
    await h.engine.tick(); // koers bijwerken
    const cash = h.engine.snapshot().account.cashQuote;
    const trade = h.engine.writeOffPosition(pos.id);
    expect(trade).toMatchObject({
      market: "BTC-EUR",
      entryTime: pos.entryTime,
      entryPrice: pos.entryPrice,
      exitPrice: 40_000,
      amount: pos.amount,
      costQuote: pos.costQuote,
      proceedsQuote: 0,
      feesQuote: pos.entryFeeQuote,
      pnlQuote: -pos.costQuote,
      pnlPct: -100,
      // Herschreven (ronde 3): was "manual"; afschrijven heeft nu een eigen exit-reden.
      exitReason: "write-off",
      entryReason: `${pos.entryReason} · afgeschreven (onverkoopbaar restant blijft op je account)`,
    });
    const s = h.engine.snapshot();
    expect(s.positions).toHaveLength(0);
    expect(s.account.cashQuote).toBe(cash);
    expect(s.account.realizedPnl).toBeCloseTo(-pos.costQuote, 12);
    expect(h.broker.sells()).toHaveLength(0);
    expect(h.of("position-closed").map((t) => t.id)).toEqual([trade.id]);
    const log = s.logs.find((l) => l.message.startsWith("BTC-EUR afgeschreven"))!;
    expect(log.level).toBe("warn");
    expect(log.message).toContain("blijft op je paper-account staan");

    const h2 = setup({ clock: h.clock, deps: { store: new StateStore(file) } });
    const s2 = h2.engine.snapshot();
    expect(s2.positions).toHaveLength(0);
    expect(s2.trades.map((t) => t.id)).toEqual([trade.id]);
  });
});

describe("Kooporders met onbekende uitkomst (lookupOrder)", () => {
  it("definitief = zonder 'UITKOMST ONBEKEND': cancelled met vulling → gevulde deel wordt een positie met stop", async () => {
    const h = setup({ mode: "live", startingCapital: 50 });
    h.engine.arm();
    h.broker.script.push((req) => result(req, { status: "new", error: "UITKOMST ONBEKEND: time-out" }));
    h.signals.buyAt.add(h.lastClosed());
    await h.engine.tick();
    h.broker.lookupOrder = async (market, cid) =>
      lookupResult(market, cid, { side: "buy", status: "cancelled", filledAmount: 0.0002, filledQuote: 10, avgPrice: 50_000, feeQuote: 0.025 });
    h.clock.advance(15_000);
    await h.engine.tick();
    const s = h.engine.snapshot();
    expect(s.unknownOrders).toEqual([]);
    expect(s.positions).toHaveLength(1);
    expect(s.positions[0].amount).toBe(0.0002);
    expect(s.positions[0].stopPrice).toBeCloseTo(49_000, 6);
    expect(s.account.cashQuote).toBeCloseTo(50 - 10.025, 9);
  });

  it("nog niet afgerond maar al deels gevuld → bekende deel meteen geboekt (met stop), blokkade blijft; later bijgeboekt", async () => {
    const h = setup({ mode: "live", startingCapital: 50 });
    h.engine.arm();
    h.broker.script.push((req) => result(req, { status: "new", error: "UITKOMST ONBEKEND: time-out" }));
    h.signals.buyAt.add(h.lastClosed());
    await h.engine.tick();
    let answer = lookupResult("BTC-EUR", "", {
      side: "buy",
      status: "partiallyFilled",
      filledAmount: 0.0001,
      filledQuote: 5,
      avgPrice: 50_000,
      feeQuote: 0.0125,
      error: "UITKOMST ONBEKEND: order is nog open of niet te controleren",
    });
    h.broker.lookupOrder = async (_m, cid) => ({ ...answer, clientOrderId: cid });
    h.clock.advance(15_000);
    await h.engine.tick();
    let s = h.engine.snapshot();
    expect(s.unknownOrders).toHaveLength(1);
    expect(s.positions).toHaveLength(1);
    expect(s.positions[0].amount).toBe(0.0001);
    expect(s.positions[0].stopPrice).toBeCloseTo(49_000, 6);
    expect(h.logs().some((m) => m.startsWith("KOOP BTC-EUR alsnog deels uitgevoerd"))).toBe(true);
    // Zelfde antwoord: niets dubbel boeken
    h.clock.advance(15_000);
    await h.engine.tick();
    expect(h.engine.snapshot().positions[0].amount).toBe(0.0001);

    answer = { ...answer, status: "filled", filledAmount: 0.0004, filledQuote: 20, feeQuote: 0.05, error: undefined };
    h.clock.advance(15_000);
    await h.engine.tick();
    s = h.engine.snapshot();
    expect(s.unknownOrders).toEqual([]);
    expect(s.positions).toHaveLength(1);
    expect(s.positions[0].amount).toBeCloseTo(0.0004, 12);
    expect(s.positions[0].costQuote).toBeCloseTo(20.05, 9);
    expect(s.account.cashQuote).toBeCloseTo(50 - 20.05, 9);
    expect(h.of("position-opened")).toHaveLength(1);
  });

  it("vangnet: live status 'new' zonder vulling en zonder melding = onbekende uitkomst (geen afwijzing)", async () => {
    const h = setup({ mode: "live", startingCapital: 50 });
    h.engine.arm();
    h.broker.script.push((req) => result(req, { status: "new" }));
    h.signals.buyAt.add(h.lastClosed());
    await h.engine.tick();
    const s = h.engine.snapshot();
    expect(s.unknownOrders).toHaveLength(1);
    expect(s.logs.some((l) => l.level === "error" && l.message.startsWith("UITKOMST ONBEKEND bij koop BTC-EUR"))).toBe(true);
    expect(h.logs().some((m) => m.includes("afgewezen"))).toBe(false);
  });
});

describe("Verkooporders met onbekende uitkomst", () => {
  async function unknownSell(h: Harness, res: Partial<OrderResult> = { status: "new", error: "UITKOMST ONBEKEND: netwerkfout" }) {
    h.engine.arm();
    const pos = await openBtcPosition(h);
    h.broker.script.push((req) => result(req, res));
    h.clock.advance(15_000);
    h.feed.setLast("BTC-EUR", 48_900);
    await h.engine.tick();
    expect(h.broker.sells()).toHaveLength(1);
    return { pos, cid: h.broker.sells()[0].req.clientOrderId! };
  }

  it("met lookupOrder: geen tweede verkoop tot definitief; bekende vulling tussentijds geboekt, daarna de rest", async () => {
    const h = setup({ mode: "live", startingCapital: 50 });
    const { pos, cid } = await unknownSell(h);
    const half = pos.amount / 2;
    let mode: "throw" | "open" | "partial" | "filled" = "throw";
    const seen: string[] = [];
    h.broker.lookupOrder = async (market, id) => {
      seen.push(id);
      if (mode === "throw") throw new Error("rate limit");
      if (mode === "open") return lookupResult(market, id, { status: "new", error: "UITKOMST ONBEKEND: nog open" });
      if (mode === "partial")
        return lookupResult(market, id, {
          status: "partiallyFilled",
          filledAmount: half,
          filledQuote: half * 48_900,
          avgPrice: 48_900,
          feeQuote: half * 48_900 * FEE,
          error: "UITKOMST ONBEKEND: annuleren niet bevestigd",
        });
      return lookupResult(market, id, {
        status: "filled",
        filledAmount: pos.amount,
        filledQuote: pos.amount * 48_900,
        avgPrice: 48_900,
        feeQuote: pos.amount * 48_900 * FEE,
      });
    };
    for (const m of ["throw", "open"] as const) {
      mode = m;
      h.clock.advance(15_000);
      await h.engine.tick();
      expect(h.broker.sells()).toHaveLength(1);
      expect(h.engine.snapshot().positions[0].amount).toBe(pos.amount);
    }
    mode = "partial";
    h.clock.advance(15_000);
    await h.engine.tick();
    let s = h.engine.snapshot();
    expect(h.broker.sells()).toHaveLength(1);
    expect(s.trades).toHaveLength(1);
    expect(s.trades[0].amount).toBeCloseTo(half, 12);
    expect(s.positions[0].amount).toBeCloseTo(half, 12);
    // Nog steeds geen nieuwe verkoop
    h.clock.advance(15_000);
    await h.engine.tick();
    expect(h.broker.sells()).toHaveLength(1);
    expect(h.engine.snapshot().trades).toHaveLength(1);

    mode = "filled";
    h.clock.advance(15_000);
    await h.engine.tick();
    s = h.engine.snapshot();
    expect(h.broker.sells()).toHaveLength(1);
    expect(s.positions).toHaveLength(0);
    expect(s.trades).toHaveLength(2);
    expect(s.trades.every((t) => t.exitReason === "stop-loss")).toBe(true);
    expect(s.trades.reduce((a, t) => a + t.amount, 0)).toBeCloseTo(pos.amount, 12);
    expect(s.trades.reduce((a, t) => a + t.costQuote, 0)).toBeCloseTo(pos.costQuote, 9);
    expect(seen.every((id) => id === cid)).toBe(true);
  });

  it("met lookupOrder: 3 ticks op rij 'niet gevonden' én minstens 60 s → niet uitgevoerd, pas dan opnieuw verkopen", async () => {
    // Herschreven (ronde 3): 3 ticks op rij was genoeg; nu ook minstens max(60 s, 3 × pollMs)
    // na de verkoop (pollMs = 15 s hier, dus 60 s).
    const h = setup({ mode: "live", startingCapital: 50 });
    await unknownSell(h);
    h.broker.lookupOrder = async () => null;
    for (let i = 1; i <= 2; i++) {
      h.clock.advance(15_000);
      await h.engine.tick();
      expect(h.broker.sells()).toHaveLength(1);
      expect(h.logs().some((m) => m.includes(`nog niet gevonden bij Bitvavo (${i}/3)`))).toBe(true);
    }
    h.clock.advance(15_000);
    await h.engine.tick(); // 3× op rij, maar pas 45 s na de verkoop
    expect(h.broker.sells()).toHaveLength(1);
    expect(h.logs().some((m) => m.includes("nog niet gevonden bij Bitvavo (3× op rij; de bot concludeert pas 60 s na de order"))).toBe(true);
    h.clock.advance(15_000);
    await h.engine.tick(); // 60 s na de verkoop
    expect(h.broker.sells()).toHaveLength(2);
    expect(h.engine.snapshot().positions).toHaveLength(0);
    expect(h.logs().some((m) => m.startsWith("Verkooporder BTC-EUR met onbekende uitkomst bestaat volgens Bitvavo niet"))).toBe(true);
  });

  it("met lookupOrder: snel Stop/Start (ticks vlak na elkaar) telt 'niet gevonden' niet extra — geen tweede verkoop binnen seconden", async () => {
    const h = setup({ mode: "live", startingCapital: 50 });
    const { cid } = await unknownSell(h);
    const looked: string[] = [];
    h.broker.lookupOrder = async (_m, id) => {
      looked.push(id);
      return null;
    };
    for (let i = 0; i < 6; i++) {
      await h.engine.stop();
      h.clock.advance(500);
      h.engine.arm();
      await h.engine.start();
    }
    await h.engine.stop();
    expect(looked.length).toBeGreaterThanOrEqual(6);
    expect(looked.every((id) => id === cid)).toBe(true);
    expect(h.broker.sells()).toHaveLength(1);
    expect(h.engine.snapshot().positions).toHaveLength(1);
    // Alleen de eerste telde (pollMs/2 = 7,5 s tussen getelde waarnemingen)
    expect(h.logs().filter((m) => m.includes("nog niet gevonden bij Bitvavo ("))).toHaveLength(1);
  });

  it("zonder lookupOrder: wacht zolang er coins in een order staan, ook als er genoeg beschikbaar is (eigen coins)", async () => {
    const h = setup({ mode: "live", startingCapital: 50 });
    const { pos } = await unknownSell(h);
    // De gebruiker heeft zelf ook BTC; de onbekende order houdt nog coins vast
    h.broker.balances.set("BTC", pos.amount * 3);
    h.broker.inOrder.set("BTC", pos.amount);
    for (let i = 0; i < 3; i++) {
      h.clock.advance(15_000);
      await h.engine.tick();
    }
    expect(h.broker.sells()).toHaveLength(1);
    expect(h.engine.snapshot().positions).toHaveLength(1);
    expect(h.logs().some((m) => m.includes("zit nog in een openstaande order op Bitvavo (verkoop met onbekende uitkomst)"))).toBe(true);
    // Order is weg (niet uitgevoerd): opnieuw verkopen
    h.broker.inOrder.delete("BTC");
    h.broker.balances.set("BTC", pos.amount);
    h.clock.advance(15_000);
    await h.engine.tick();
    expect(h.broker.sells()).toHaveLength(2);
    expect(h.engine.snapshot().positions).toHaveLength(0);
  });

  it("wordt opgeslagen: na een herstart geen tweede verkoop, en de exit gaat door zodra de order niet blijkt te bestaan", async () => {
    const file = join(tmp(), "state.json");
    const h1 = setup({ mode: "live", startingCapital: 50, deps: { store: new StateStore(file) } });
    const { pos, cid } = await unknownSell(h1);
    await h1.engine.stop();

    const broker2 = new FakeBroker("live", 1000);
    broker2.balances.set("BTC", pos.amount);
    const looked: string[] = [];
    broker2.lookupOrder = async (_m, id) => {
      looked.push(id);
      return null;
    };
    const h2 = setup({ mode: "live", startingCapital: 50, clock: h1.clock, broker: broker2, deps: { store: new StateStore(file) } });
    expect(h2.logs().some((m) => m.startsWith("Verkooporder(s) met onbekende uitkomst: BTC-EUR"))).toBe(true);
    h2.engine.arm();
    h2.feed.setLast("BTC-EUR", 50_000); // koers hersteld: alleen de lopende exit kan nog verkopen
    // Herschreven (ronde 3): 3 ticks van 15 s waren genoeg; nu ook ≥ 60 s na de verkoop
    // (de herstart zelf telt niet: het tijdstip van de order is opgeslagen).
    for (let i = 0; i < 3; i++) {
      h2.clock.advance(15_000);
      await h2.engine.tick();
      expect(broker2.sells()).toHaveLength(0);
    }
    h2.clock.advance(15_000);
    await h2.engine.tick();
    expect(looked).toEqual([cid, cid, cid, cid]);
    expect(broker2.sells()).toHaveLength(1);
    const s = h2.engine.snapshot();
    expect(s.positions).toHaveLength(0);
    expect(s.trades.map((t) => t.exitReason)).toEqual(["stop-loss"]);
  });

  it("handmatig sluiten terwijl de bot stilstaat zoekt de order eerst op (geen tweede verkoop)", async () => {
    const h = setup({ mode: "live", startingCapital: 50 });
    const { pos } = await unknownSell(h);
    h.broker.lookupOrder = async () => {
      throw new Error("time-out");
    };
    expect(await h.engine.closePosition(pos.id)).toBeNull();
    expect(h.engine.lastCloseFailure).toContain("verkooporder met onbekende uitkomst");
    expect(h.broker.sells()).toHaveLength(1);

    h.broker.lookupOrder = async (market, id) =>
      lookupResult(market, id, {
        status: "filled",
        filledAmount: pos.amount,
        filledQuote: pos.amount * 48_900,
        avgPrice: 48_900,
        feeQuote: pos.amount * 48_900 * FEE,
      });
    const trade = await h.engine.closePosition(pos.id);
    expect(trade).not.toBeNull();
    expect(trade!.exitReason).toBe("stop-loss"); // de reden van de oorspronkelijke verkoop
    expect(h.broker.sells()).toHaveLength(1);
    expect(h.engine.snapshot().positions).toHaveLength(0);
    expect(h.engine.lastCloseFailure).toBeNull();
  });

  it("vangnet: verkoop met status 'new' zonder vulling en zonder melding = onbekende uitkomst", async () => {
    const h = setup({ mode: "live", startingCapital: 50 });
    await unknownSell(h, { status: "new" });
    h.broker.lookupOrder = async () => {
      throw new Error("time-out");
    };
    h.clock.advance(15_000);
    await h.engine.tick();
    expect(h.broker.sells()).toHaveLength(1);
    expect(h.engine.snapshot().logs.some((l) => l.level === "error" && l.message.startsWith("UITKOMST ONBEKEND bij verkoop BTC-EUR"))).toBe(
      true,
    );
  });
});

describe("Meldingen en noodstop als de bot stilstaat", () => {
  it("afgewezen handmatige verkoop terwijl de bot stilstaat belooft geen 'volgende tick'", async () => {
    const live = setup({ mode: "live", startingCapital: 50 });
    live.engine.arm();
    const p1 = await openBtcPosition(live);
    live.broker.rejectSells = 1;
    expect(await live.engine.closePosition(p1.id)).toBeNull();
    expect(live.engine.lastCloseFailure).toBe("verkoop afgewezen: Markt tijdelijk gesloten");
    const err = live.logs().find((m) => m.startsWith("Verkoop BTC-EUR"))!;
    expect(err).toContain("de bot staat stil — start de bot opnieuw of sluit de positie zelf op Bitvavo");
    expect(live.logs().some((m) => m.includes("volgende tick"))).toBe(false);

    const paper = setup();
    const p2 = await openBtcPosition(paper);
    paper.broker.rejectSells = 1;
    await paper.engine.closePosition(p2.id);
    expect(paper.logs().find((m) => m.startsWith("Verkoop BTC-EUR"))).toContain("de bot staat stil");
    expect(paper.logs().some((m) => m.includes("volgende tick"))).toBe(false);
  });

  it("zolang de bot draait: wel 'nieuwe poging bij de volgende tick'", async () => {
    vi.useFakeTimers();
    const h = setup();
    h.signals.buyAt.add(h.lastClosed());
    await h.engine.start();
    h.broker.rejectSells = 1;
    h.clock.advance(15_000);
    h.feed.setLast("BTC-EUR", 48_900);
    await h.engine.tick();
    expect(h.logs().some((m) => m.startsWith("Verkoop BTC-EUR (stop-loss) mislukt") && m.endsWith("nieuwe poging bij de volgende tick"))).toBe(true);
    await h.engine.stop();
  });

  it("noodstop: KillResult met gesloten aantal en redenen (onverkoopbaar, afgewezen, onbekende uitkomst); ontwapent aan begin én eind", async () => {
    const h = setup({ mode: "live", startingCapital: 100, markets: ["BTC-EUR", "ETH-EUR", "SOL-EUR"] });
    h.engine.arm();
    h.risk.quote = 6;
    h.risk.stopDist = 20_000;
    await openBtcPosition(h); // BTC, ETH en SOL (elk €6)
    let s = h.engine.snapshot();
    expect(s.positions.map((p) => p.market)).toEqual(["BTC-EUR", "ETH-EUR", "SOL-EUR"]);
    h.feed.setLast("BTC-EUR", 40_000); // onverkoopbaar
    h.broker.script.push(
      (req) => result(req, { status: "rejected", error: "Bitvavo-fout: markt gepauzeerd" }), // ETH
      (req) => result(req, { status: "new", error: "UITKOMST ONBEKEND: time-out" }), // SOL
    );
    // Herschreven (ronde 3): opnieuw armen tijdens de noodstop werd eerst toegestaan
    // (en aan het eind teruggedraaid); nu weigert arm() zolang de noodstop loopt.
    const gate = new Deferred();
    const origPrice = h.feed.getPrice.bind(h.feed);
    let priceCalls = 0;
    h.feed.getPrice = async (m) => {
      if (priceCalls++ === 0) await gate.promise;
      return origPrice(m);
    };
    const killing = h.engine.killSwitch();
    expect(h.engine.liveArmed).toBe(false);
    await new Promise((r) => setImmediate(r));
    expect(() => h.engine.arm()).toThrow(/^Armen geblokkeerd: noodstop bezig/);
    expect(h.engine.liveArmed).toBe(false);
    gate.resolve();
    const res = await killing;
    expect(h.engine.liveArmed).toBe(false);
    expect(h.logs().some((m) => m === "Live mode ontwapend na de noodstop")).toBe(true);
    expect(h.logs().some((m) => m.startsWith("LIVE GEARMD"))).toBe(true); // alleen de arm() van vóór de noodstop
    expect(h.logs().filter((m) => m.startsWith("LIVE GEARMD"))).toHaveLength(1);

    expect(res.closed).toBe(0);
    expect(res.failed.map((f) => f.market)).toEqual(["BTC-EUR", "ETH-EUR", "SOL-EUR"]);
    expect(res.failed[0].reason).toBe("onverkoopbaar: waarde €4,78 < minimum €5,00");
    expect(res.failed[1].reason).toBe("verkoop afgewezen: Bitvavo-fout: markt gepauzeerd");
    expect(res.failed[2].reason).toMatch(/^uitkomst van de verkooporder onbekend \(UITKOMST ONBEKEND: time-out\)/);
    expect(h.broker.sells().map((o) => o.req.market)).toEqual(["ETH-EUR", "SOL-EUR"]);
    s = h.engine.snapshot();
    expect(s.running).toBe(false);
    expect(s.positions).toHaveLength(3);
    // Geen beloftes over een volgende tick nu de bot stilstaat
    expect(h.logs().some((m) => m.includes("volgende tick"))).toBe(false);
    const unknownLog = h.logs().find((m) => m.startsWith("UITKOMST ONBEKEND bij verkoop SOL-EUR"))!;
    expect(unknownLog).toContain("De bot staat stil — start de bot opnieuw of sluit de positie zelf op Bitvavo.");
  });
});

describe("Kosten, lopende orders en koopcontrole", () => {
  it("setCosts wordt in beide modi aangeroepen: bij het maken, bij start en bij updateConfig", async () => {
    vi.useFakeTimers();
    for (const mode of ["paper", "live"] as const) {
      const broker = new FakeBroker(mode);
      const calls: [number, number][] = [];
      (broker as FakeBroker & { setCosts: (f: number, s: number) => void }).setCosts = (f, s) => calls.push([f, s]);
      const h = setup({ mode, broker, startingCapital: 50 });
      expect(calls).toEqual([[0.0025, 0.0005]]);
      await h.engine.start();
      expect(calls).toHaveLength(2);
      h.engine.updateConfig({ risk: { takerFee: 0.0015, slippagePct: 0.001 } as RiskConfig });
      expect(calls[calls.length - 1]).toEqual([0.0015, 0.001]);
      await h.engine.stop();
    }
  });

  it("orderInFlight is true zolang de broker een order verwerkt", async () => {
    const h = setup();
    h.signals.buyAt.add(h.lastClosed());
    const gate = new Deferred();
    const orig = h.broker.placeMarketOrder.bind(h.broker);
    let entered = false;
    h.broker.placeMarketOrder = async (req, ref) => {
      entered = true;
      await gate.promise;
      return orig(req, ref);
    };
    expect(h.engine.orderInFlight).toBe(false);
    const tick = h.engine.tick();
    for (let i = 0; i < 100 && !entered; i++) await new Promise((r) => setImmediate(r));
    expect(entered).toBe(true);
    expect(h.engine.orderInFlight).toBe(true);
    gate.resolve();
    await tick;
    expect(h.engine.orderInFlight).toBe(false);
    expect(h.engine.snapshot().positions).toHaveLength(1);
  });
});

describe("Coins 'weg' pas na twee ticks", () => {
  it("één afwijkend saldo-antwoord boekt niets; daarna gewoon verkocht", async () => {
    const h = setup({ mode: "live", startingCapital: 50 });
    h.engine.arm();
    const pos = await openBtcPosition(h);
    h.broker.balances.set("BTC", 0); // tijdelijk fout antwoord
    h.clock.advance(15_000);
    h.feed.setLast("BTC-EUR", 48_900);
    await h.engine.tick();
    expect(h.engine.snapshot().positions).toHaveLength(1);
    expect(h.broker.sells()).toHaveLength(0);

    h.broker.balances.set("BTC", pos.amount); // weer normaal
    h.clock.advance(15_000);
    await h.engine.tick();
    const s = h.engine.snapshot();
    expect(h.broker.sells()).toHaveLength(1);
    expect(s.positions).toHaveLength(0);
    expect(s.trades[0].exitReason).toBe("stop-loss");
    expect(h.logs().some((m) => m.includes("staat niet meer op Bitvavo"))).toBe(false);
  });

  it("deels weg (niet in een order): pas bij de tweede tick het ontbrekende deel boeken en de rest verkopen", async () => {
    const h = setup({ mode: "live", startingCapital: 50 });
    h.engine.arm();
    const pos = await openBtcPosition(h);
    h.broker.balances.set("BTC", pos.amount * 0.4);
    h.clock.advance(15_000);
    h.feed.setLast("BTC-EUR", 48_900);
    await h.engine.tick();
    expect(h.engine.snapshot().trades).toHaveLength(0);
    expect(h.broker.sells()).toHaveLength(0);
    h.clock.advance(15_000);
    await h.engine.tick();
    const s = h.engine.snapshot();
    expect(h.broker.sells()).toHaveLength(1);
    expect(h.broker.sells()[0].req.amount).toBeCloseTo(pos.amount * 0.4, 12);
    expect(s.positions).toHaveLength(0);
    expect(s.trades).toHaveLength(2);
  });
});

describe("candlesHeld en dagelijkse limiet", () => {
  it("candlesHeld telt door zolang een exit nog loopt (zoals de backtester)", async () => {
    const h = setup();
    await openBtcPosition(h); // entry om T0+1m, in candle T0
    h.broker.rejectSells = 3;
    h.clock.advance(15_000);
    h.feed.setLast("BTC-EUR", 48_900); // stop geraakt, verkoop afgewezen
    await h.engine.tick();
    const held = () => h.engine.snapshot().positions[0]?.candlesHeld;
    expect(held()).toBe(0);
    h.feed.append("BTC-EUR", 48_900); // candle T0 sluit (vóór de entry begonnen: telt niet)
    h.clock.set(T0 + I15 + 30_000);
    await h.engine.tick();
    expect(held()).toBe(0);
    h.feed.append("BTC-EUR", 48_900); // candle T0+15m sluit
    h.clock.set(T0 + 2 * I15 + 30_000);
    await h.engine.tick();
    expect(held()).toBe(1);
    h.feed.append("BTC-EUR", 48_900);
    h.clock.set(T0 + 3 * I15 + 30_000);
    await h.engine.tick(); // vierde poging lukt
    const s = h.engine.snapshot();
    expect(h.broker.sells()).toHaveLength(4);
    expect(s.positions).toHaveLength(0);
    expect(s.trades[0].candlesHeld).toBe(2);
  });

  it("HaltStatus.dailyLimit: true → pauze tot de dagwissel; false → niet vastgezet", async () => {
    const h = setup();
    h.risk.haltStatus = () => ({ halted: true, reason: "Dagelijkse verlieslimiet bereikt (-5,1%)", dailyLimit: true });
    await h.engine.tick();
    expect(h.engine.snapshot().halted.halted).toBe(true);
    h.risk.haltStatus = () => ({ halted: false });
    h.clock.advance(15_000);
    await h.engine.tick();
    let s = h.engine.snapshot();
    expect(s.halted).toMatchObject({ halted: true, dailyLimit: true });
    expect(s.halted.reason).toContain("eerder vandaag");
    h.clock.set(Date.UTC(2026, 0, 5, 23, 30)); // 00:30 de volgende dag
    await h.engine.tick();
    expect(h.engine.snapshot().halted.halted).toBe(false);

    // Een andere pauze (vlag false) wordt niet vastgezet, ook al is het dagverlies groot
    const g = setup();
    g.risk.quote = 60;
    g.risk.stopDist = 40_000;
    await openBtcPosition(g);
    g.feed.setLast("BTC-EUR", 44_000); // ~-7% van de equity
    g.risk.haltStatus = () => ({ halted: true, reason: "Iets anders", dailyLimit: false });
    g.clock.advance(15_000);
    await g.engine.tick();
    expect(g.engine.snapshot().halted.halted).toBe(true);
    g.risk.haltStatus = () => ({ halted: false });
    g.clock.advance(15_000);
    await g.engine.tick();
    s = g.engine.snapshot();
    expect(s.halted.halted).toBe(false);
    expect(g.logs().some((m) => m.startsWith("Handel hervat"))).toBe(true);
  });
});

describe("Regressie met de ECHTE RiskManager", () => {
  it("candle na de entry dipt, ticks rally voorbij +1R, candle sluit boven break-even → geen exit bij het sluiten", async () => {
    const h = setup({ deps: { createRisk: (cfg, interval) => new RiskManager(cfg, interval) } });
    h.signals.atr = 500; // stop = 2×ATR = 1000 onder de entry, doel = 2R
    const pos = await openBtcPosition(h);
    expect(pos.entryPrice).toBe(50_000);
    const R = pos.entryPrice - pos.initialStopPrice;
    expect(R).toBeCloseTo(1_000, 6);
    const breakEven = pos.entryPrice * (1 + 2 * DEFAULT_RISK_CONFIG.takerFee + 2 * DEFAULT_RISK_CONFIG.slippagePct);
    expect(pos.takeProfitPrice).toBeGreaterThan(51_500);

    // Nieuwe candle (na de entry): eerst een dip, dan ticks tot boven +1R
    h.feed.append("BTC-EUR", 50_000);
    h.clock.set(T0 + I15 + 10_000);
    const t1 = T0 + I15;
    const path = [
      { close: 49_400, o: { open: 50_000, high: 50_000, low: 49_400 } },
      { close: 51_300, o: { open: 50_000, high: 51_300, low: 49_400 } }, // > entry + 1R
      { close: 50_700, o: { open: 50_000, high: 51_300, low: 49_400 } },
    ];
    for (const p of path) {
      h.feed.setLast("BTC-EUR", p.close, p.o);
      h.clock.advance(60_000);
      await h.engine.tick();
      expect(h.engine.snapshot().positions).toHaveLength(1);
      // Tussentijdse ticks verhogen de stop niet
      expect(h.engine.snapshot().positions[0].stopPrice).toBe(pos.initialStopPrice);
    }
    // De candle sluit op 50.700 (boven break-even); een nieuwe candle begint
    h.feed.append("BTC-EUR", 50_700);
    h.clock.set(t1 + I15 + 5_000);
    await h.engine.tick();
    const s = h.engine.snapshot();
    expect(h.broker.sells()).toHaveLength(0);
    expect(s.positions).toHaveLength(1);
    expect(s.trades).toHaveLength(0);
    // Pas nu (op de gesloten candle) gaat de stop naar break-even
    expect(s.positions[0].stopPrice).toBeCloseTo(breakEven, 6);
    expect(s.positions[0].highestPrice).toBe(51_300);
    expect(s.positions[0].candlesHeld).toBe(1);
  });
});
