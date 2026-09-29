/**
 * Ronde 3 — regressietests voor de engine:
 *  - "onverkoopbaar" wordt altijd tegen de ACTUELE koers bepaald (snapshot én
 *    writeOffPosition), ook ontwapend na noodstop + Start en tijdens een tick die op
 *    het saldo wacht; een broker-weigering ("ONVERKOOPBAAR:") wordt niet elke tick
 *    opnieuw verstuurd;
 *  - "niet gevonden" bij orders met onbekende uitkomst is ook tijdsgebonden
 *    (≥ pollMs/2 tussen getelde waarnemingen, ≥ max(60 s, 3 × pollMs) in totaal);
 *  - late extra vullingen worden tegen hun EIGEN prijs en fee geboekt;
 *  - noodstop: armen geblokkeerd zolang hij loopt, eindigt altijd ontwapend, logniveaus;
 *  - expliciete verkopen melden hun eigen mislukking (eigen throttle);
 *  - ongeldige MarketInfo.minOrderQuote = onbekend → €5.
 */
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type { MarketOrderRequest, OrderResult } from "../../src/core/types";
import { StateStore } from "../../src/engine/stateStore";
import { Clock, Deferred, FakeBroker, FakeFeed, T0, marketInfo, openBtcPosition, setup, type Harness } from "./helpers";

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

function order(market: string, clientOrderId: string, side: "buy" | "sell", o: Partial<OrderResult>): OrderResult {
  return {
    orderId: "ord-l",
    clientOrderId,
    market,
    side,
    status: "filled",
    filledAmount: 0,
    filledQuote: 0,
    avgPrice: 0,
    feeQuote: 0,
    timestamp: 0,
    ...o,
  };
}

async function waitFor(cond: () => boolean): Promise<void> {
  for (let i = 0; i < 1000 && !cond(); i++) await new Promise((r) => setImmediate(r));
  if (!cond()) throw new Error("waitFor: voorwaarde niet gehaald");
}

let dirs: string[] = [];
afterEach(() => {
  for (const d of dirs) rmSync(d, { recursive: true, force: true });
  dirs = [];
});
function tmp(): string {
  const d = mkdtempSync(join(tmpdir(), "engine-r3-"));
  dirs.push(d);
  return d;
}

/** Live, gearmd, €6 BTC-positie (0,0001197 BTC: bij 40.000 → €4,78, bij 50.000 → €5,98). */
async function smallLivePosition(h: Harness) {
  h.engine.arm();
  h.risk.quote = 6;
  return openBtcPosition(h);
}

describe("Onverkoopbaar = altijd tegen de actuele koers", () => {
  it("regressie: noodstop (onverkoopbaar) → Start ontwapend → koers herstelt: snapshot niet meer onverkoopbaar, afschrijven geweigerd", async () => {
    const h = setup({ mode: "live", startingCapital: 50 });
    const pos = await smallLivePosition(h);
    h.clock.advance(15_000);
    h.feed.setLast("BTC-EUR", 40_000); // stop geraakt, €4,78
    await h.engine.tick();
    expect(h.engine.snapshot().positions[0].unsellable).toBe(true);
    const kill = await h.engine.killSwitch();
    expect(kill.failed).toEqual([
      { id: pos.id, market: "BTC-EUR", reason: "onverkoopbaar: waarde €4,78 < minimum €5,00" },
    ]);

    await h.engine.start(); // niet gearmd: automatische exits gaan niet door
    h.feed.setLast("BTC-EUR", 50_000); // €5,98
    for (let i = 0; i < 3; i++) {
      h.clock.advance(15_000);
      await h.engine.tick();
    }
    let s = h.engine.snapshot();
    expect(s.liveArmed).toBe(false);
    expect(h.broker.sells()).toHaveLength(0);
    expect(s.positions[0].currentPrice).toBe(50_000);
    expect(s.positions[0].unsellable).toBeUndefined();
    expect(s.positions[0].unsellableReason).toBeUndefined();
    await expect(h.engine.writeOffPosition(pos.id)).rejects.toThrow(/^Afschrijven kan alleen voor een onverkoopbare positie/);
    expect(h.engine.snapshot().positions).toHaveLength(1);
    expect(h.engine.snapshot().trades).toHaveLength(0);

    // Weer onder het minimum: dan wél onverkoopbaar (weer tegen de actuele koers)
    h.feed.setLast("BTC-EUR", 40_000);
    h.clock.advance(15_000);
    await h.engine.tick();
    s = h.engine.snapshot();
    expect(s.positions[0].unsellable).toBe(true);
    expect(s.positions[0].unsellableReason).toContain("waarde €4,78 < minimum €5,00");
    const t = await h.engine.writeOffPosition(pos.id);
    expect(t.exitReason).toBe("write-off");
    await h.engine.stop();
  });

  it("afschrijven terwijl een tick op het saldo wacht: de nieuwe koers telt (geweigerd), daarna gewoon verkocht", async () => {
    const h = setup({ mode: "live", startingCapital: 50 });
    const pos = await smallLivePosition(h);
    h.clock.advance(15_000);
    h.feed.setLast("BTC-EUR", 40_000);
    await h.engine.tick();
    expect(h.engine.snapshot().positions[0].unsellable).toBe(true);

    h.feed.setLast("BTC-EUR", 50_000);
    const gate = new Deferred();
    const orig = h.broker.getBalances.bind(h.broker);
    let waiting = false;
    // Alleen de tick blijft hangen; het afschrijven haalt (ronde 4) zelf een vers saldo op.
    h.broker.getBalances = async () => {
      if (!waiting) {
        waiting = true;
        await gate.promise;
      }
      return orig();
    };
    h.clock.advance(15_000);
    const tick = h.engine.tick();
    await waitFor(() => waiting); // koers al bijgewerkt, tick wacht op GET /balance
    expect(h.engine.snapshot().positions[0].unsellable).toBeUndefined();
    await expect(h.engine.writeOffPosition(pos.id)).rejects.toThrow(/^Afschrijven kan alleen/);
    gate.resolve();
    await tick;
    const s = h.engine.snapshot();
    expect(h.broker.sells()).toHaveLength(1);
    expect(s.positions).toHaveLength(0);
    expect(s.trades.map((t) => t.exitReason)).toEqual(["stop-loss"]);
  });

  it("broker-weigering ('ONVERKOOPBAAR:', bijv. Bitvavo 217) geldt alleen zolang de positie niet meer waard is dan toen", async () => {
    const h = setup({ mode: "live", startingCapital: 50 });
    h.engine.arm();
    const pos = await openBtcPosition(h); // €20
    h.broker.script.push((req) =>
      result(req, { status: "rejected", error: "ONVERKOOPBAAR: Bitvavo weigert: orderwaarde onder het minimum (217)" }),
    );
    h.clock.advance(15_000);
    h.feed.setLast("BTC-EUR", 48_900); // stop
    await h.engine.tick();
    let s = h.engine.snapshot();
    expect(h.broker.sells()).toHaveLength(1);
    expect(s.positions[0].unsellable).toBe(true);
    expect(s.positions[0].unsellableReason).toContain("orderwaarde onder het minimum (217)");

    // Gearmd, zelfde of lagere koers: niet elke tick opnieuw versturen
    for (const px of [48_900, 48_500, 48_900]) {
      h.feed.setLast("BTC-EUR", px);
      h.clock.advance(15_000);
      await h.engine.tick();
    }
    expect(h.broker.sells()).toHaveLength(1);
    expect(h.logs().filter((m) => m.startsWith("BTC-EUR positie is onverkoopbaar"))).toHaveLength(1);

    // Ontwapend (tick werkt alleen de koers bij): hoger dan bij de weigering → niet onverkoopbaar
    h.engine.disarm();
    h.feed.setLast("BTC-EUR", 49_500);
    h.clock.advance(15_000);
    await h.engine.tick();
    s = h.engine.snapshot();
    expect(h.broker.sells()).toHaveLength(1);
    expect(s.positions[0].unsellable).toBeUndefined();
    await expect(h.engine.writeOffPosition(pos.id)).rejects.toThrow(/^Afschrijven kan alleen/);

    // Lager dan bij de weigering → weer onverkoopbaar, afschrijven mag
    h.feed.setLast("BTC-EUR", 48_800);
    h.clock.advance(15_000);
    await h.engine.tick();
    s = h.engine.snapshot();
    expect(s.positions[0].unsellable).toBe(true);
    const t = await h.engine.writeOffPosition(pos.id);
    expect(t).toMatchObject({ exitReason: "write-off", pnlPct: -100, proceedsQuote: 0 });
    expect(h.engine.snapshot().positions).toHaveLength(0);
  });

  it("gearmd: na een broker-weigering pas opnieuw bij ≥ 1% meer waarde dan de (hoogste) weigering, hooguit 1× per 5 minuten", async () => {
    // Herschreven (ronde 4): hier verstuurde de bot al opnieuw bij +0,1% (48.950) en
    // daarna bij 49.000 — bij een koers die rond het minimum schommelt elke paar ticks
    // een geweigerde order. Nu met hysterese (1%) en hooguit één poging per 5 minuten.
    const h = setup({ mode: "live", startingCapital: 50 });
    h.engine.arm();
    await openBtcPosition(h);
    const refuse = (req: MarketOrderRequest) => result(req, { status: "rejected", error: "ONVERKOOPBAAR: te klein" });
    h.broker.script.push(refuse, refuse);
    h.clock.advance(15_000);
    h.feed.setLast("BTC-EUR", 48_900);
    await h.engine.tick();
    const firstRefusal = h.clock.t;
    expect(h.broker.sells()).toHaveLength(1);
    for (const px of [48_950, 49_000, 49_300]) {
      h.feed.setLast("BTC-EUR", px); // < 48.900 × 1,01: niet opnieuw
      h.clock.advance(15_000);
      await h.engine.tick();
    }
    expect(h.broker.sells()).toHaveLength(1);
    h.feed.setLast("BTC-EUR", 49_400); // ≥ 1% hoger, maar binnen 5 minuten na de weigering
    h.clock.advance(15_000);
    await h.engine.tick();
    expect(h.broker.sells()).toHaveLength(1);
    h.clock.set(firstRefusal + 5 * 60_000);
    await h.engine.tick(); // nu één nieuwe poging (weer geweigerd, bij 49.400)
    expect(h.broker.sells()).toHaveLength(2);
    const secondRefusal = h.clock.t;
    h.feed.setLast("BTC-EUR", 49_800); // < 49.400 × 1,01 (de hoogste weigering telt)
    h.clock.set(secondRefusal + 6 * 60_000);
    await h.engine.tick();
    expect(h.broker.sells()).toHaveLength(2);
    h.feed.setLast("BTC-EUR", 49_900); // ≥ 49.894 en > 5 minuten: nu lukt het
    h.clock.advance(15_000);
    await h.engine.tick();
    expect(h.broker.sells()).toHaveLength(3);
    expect(h.engine.snapshot().positions).toHaveLength(0);
    expect(h.logs().filter((m) => m.startsWith("BTC-EUR positie is onverkoopbaar"))).toHaveLength(1);
  });

  it("paper: broker weigert met ONVERKOOPBAAR → geen nieuwe order elke tick", async () => {
    const h = setup();
    await openBtcPosition(h);
    h.broker.script.push((req) =>
      result(req, { status: "rejected", error: "ONVERKOOPBAAR: orderwaarde €4,99 is kleiner dan het beursminimum" }),
    );
    h.clock.advance(15_000);
    h.feed.setLast("BTC-EUR", 48_900);
    for (let i = 0; i < 4; i++) {
      await h.engine.tick();
      h.clock.advance(15_000);
    }
    expect(h.broker.sells()).toHaveLength(1);
    expect(h.engine.snapshot().positions[0].unsellable).toBe(true);
  });
});

describe("Onverkoopbaar met een iets lager saldo op Bitvavo (fee in de munt)", () => {
  it("97% beschikbaar: onverkoopbaar zolang dát deel < €5 is, ook als de hele positie ≥ €5 is; tegen de actuele koers", async () => {
    const h = setup({ mode: "live", startingCapital: 50 });
    const pos = await smallLivePosition(h);
    h.broker.balances.set("BTC", pos.amount * 0.97);
    h.feed.setLast("BTC-EUR", 5.1 / pos.amount); // positie €5,10, beschikbaar €4,95
    expect(await h.engine.closePosition(pos.id)).toBeNull();
    expect(h.broker.sells()).toHaveLength(0);
    expect(h.engine.lastCloseFailure).toMatch(/^onverkoopbaar: waarde €4,9\d < minimum €5,00$/);
    let s = h.engine.snapshot();
    expect(s.positions[0].unsellable).toBe(true);
    // Koers stijgt (ontwapend: de tick verkoopt niet, maar werkt de koers bij): beschikbaar deel ≥ €5
    h.engine.disarm();
    h.feed.setLast("BTC-EUR", 5.3 / pos.amount);
    h.clock.advance(15_000);
    await h.engine.tick();
    s = h.engine.snapshot();
    expect(s.positions[0].unsellable).toBeUndefined();
    await expect(h.engine.writeOffPosition(pos.id)).rejects.toThrow(/^Afschrijven kan alleen/);
  });
});

describe("MarketInfo.minOrderQuote ontbreekt / ongeldig / ≤ 0 → beursminimum €5", () => {
  for (const bad of [0, -1, Number.NaN, undefined]) {
    it(`minOrderQuote = ${String(bad)}: een positie van €4,78 is onverkoopbaar (geen order)`, async () => {
      const h = setup();
      h.feed.getMarkets = async () => [{ ...marketInfo("BTC-EUR"), minOrderQuote: bad as unknown as number }];
      h.risk.quote = 6;
      const pos = await openBtcPosition(h);
      h.feed.setLast("BTC-EUR", 40_000);
      expect(await h.engine.closePosition(pos.id)).toBeNull();
      expect(h.broker.sells()).toHaveLength(0);
      expect(h.engine.lastCloseFailure).toBe("onverkoopbaar: waarde €4,78 < minimum €5,00");
      expect(h.engine.snapshot().positions[0].unsellable).toBe(true);
    });
  }
});

describe("'Niet gevonden' bij onbekende orders is ook tijdsgebonden", () => {
  it("onbekende koop: snel Stop/Start en herstarten tellen niet; pas na ≥ max(60 s, 3 × pollMs) en 3 getelde waarnemingen vervalt de blokkade", async () => {
    const file = join(tmp(), "state.json");
    const clock = new Clock(T0 + 60_000);
    const feed = new FakeFeed();
    feed.setSeries("BTC-EUR", 50_000, T0);
    const broker = new FakeBroker("live", 1000);
    const deps = () => ({ store: new StateStore(file, { debounceMs: 0 }) });
    const cfg = { pollMs: 30_000 }; // min. 90 s, 15 s tussen getelde waarnemingen
    const h1 = setup({ mode: "live", startingCapital: 50, clock, feed, broker, config: cfg, deps: deps() });
    h1.engine.arm();
    broker.script.push((req) => result(req, { status: "new", error: "UITKOMST ONBEKEND: time-out" }));
    h1.signals.buyAt.add(h1.lastClosed());
    await h1.engine.tick();
    expect(h1.engine.snapshot().unknownOrders).toHaveLength(1);
    const at = clock.t;
    let lookups = 0;
    broker.lookupOrder = async () => {
      lookups++;
      return null;
    };
    for (let i = 0; i < 4; i++) {
      clock.advance(1_000);
      await h1.engine.stop();
      h1.engine.arm();
      await h1.engine.start();
    }
    await h1.engine.stop();

    // Herstart (nieuw proces) en weer snel Stop/Start
    const h2 = setup({ mode: "live", startingCapital: 50, clock, feed, broker, config: cfg, deps: deps() });
    expect(h2.engine.snapshot().unknownOrders).toHaveLength(1);
    for (let i = 0; i < 3; i++) {
      clock.advance(1_000);
      h2.engine.arm();
      await h2.engine.start();
      await h2.engine.stop();
    }
    expect(lookups).toBe(7);
    expect(h2.engine.snapshot().unknownOrders).toHaveLength(1);
    const counted = () =>
      [...h1.logs(), ...h2.logs()].filter((m) => m.includes("nog niet gevonden bij Bitvavo (")).length;
    expect(counted()).toBe(1); // alleen de eerste waarneming telde

    // Gewone ticks om de 15 s (= pollMs/2): tellen wel, maar pas na 90 s is het definitief
    h2.engine.arm();
    const states: number[] = [];
    while (clock.t - at < 120_000) {
      clock.advance(15_000);
      await h2.engine.tick();
      states.push(h2.engine.snapshot().unknownOrders!.length);
      if (states[states.length - 1] === 0) break;
    }
    expect(clock.t - at).toBeGreaterThanOrEqual(90_000);
    expect(clock.t - at).toBeLessThan(90_000 + 15_000);
    expect(states.slice(0, -1).every((n) => n === 1)).toBe(true);
    expect(h2.logs().some((m) => m.includes("3× op rij; de bot concludeert pas 90 s na de order"))).toBe(true);
    expect(
      h2.logs().some((m) => m.startsWith("Kooporder BTC-EUR met onbekende uitkomst bestaat volgens Bitvavo niet")),
    ).toBe(true);
  });

  it("de minimale wachttijd schaalt mee met pollMs (3 × pollMs als dat langer is dan 60 s)", async () => {
    const h = setup({ mode: "live", startingCapital: 50, config: { pollMs: 60_000 } });
    h.engine.arm();
    h.broker.script.push((req) => result(req, { status: "new", error: "UITKOMST ONBEKEND: time-out" }));
    h.signals.buyAt.add(h.lastClosed());
    await h.engine.tick();
    const at = h.clock.t;
    h.broker.lookupOrder = async () => null;
    for (let i = 1; i <= 5; i++) {
      h.clock.advance(30_000); // precies pollMs/2
      await h.engine.tick();
      expect(h.engine.snapshot().unknownOrders).toHaveLength(1); // 30..150 s < 180 s
    }
    h.clock.advance(30_000);
    await h.engine.tick();
    expect(h.clock.t - at).toBe(180_000);
    expect(h.engine.snapshot().unknownOrders).toEqual([]);
  });

  it("onbekende verkoop: 'niet gevonden' telt niet binnen pollMs/2; de telling (met tijdstip) overleeft een herstart", async () => {
    const file = join(tmp(), "state.json");
    const h1 = setup({ mode: "live", startingCapital: 50, deps: { store: new StateStore(file, { debounceMs: 0 }) } });
    h1.engine.arm();
    const pos = await openBtcPosition(h1);
    h1.broker.script.push((req) => result(req, { status: "new", error: "UITKOMST ONBEKEND: netwerkfout" }));
    h1.clock.advance(15_000);
    h1.feed.setLast("BTC-EUR", 48_900);
    await h1.engine.tick();
    expect(h1.broker.sells()).toHaveLength(1);
    h1.broker.lookupOrder = async () => null;
    h1.clock.advance(10_000);
    await h1.engine.tick(); // 1/3
    h1.clock.advance(5_000);
    await h1.engine.tick(); // te snel (5 s < 7,5 s): telt niet
    expect(h1.logs().filter((m) => m.includes("nog niet gevonden bij Bitvavo ("))).toHaveLength(1);
    await h1.engine.stop();

    const broker2 = new FakeBroker("live", 1000);
    broker2.balances.set("BTC", pos.amount);
    broker2.lookupOrder = async () => null;
    const h2 = setup({
      mode: "live",
      startingCapital: 50,
      clock: h1.clock,
      feed: h1.feed,
      broker: broker2,
      deps: { store: new StateStore(file) },
    });
    h2.engine.arm();
    h2.clock.advance(1_000);
    await h2.engine.tick(); // 6 s na de getelde: telt niet
    expect(h2.logs().some((m) => m.includes("nog niet gevonden bij Bitvavo ("))).toBe(false);
    h2.clock.advance(15_000);
    await h2.engine.tick(); // 2/3
    expect(h2.logs().some((m) => m.includes("(2/3)"))).toBe(true);
    h2.clock.advance(15_000);
    await h2.engine.tick(); // 3× op rij, maar pas 46 s na de verkoop
    expect(broker2.sells()).toHaveLength(0);
    h2.clock.advance(15_000);
    await h2.engine.tick(); // 61 s na de verkoop → definitief niet uitgevoerd, opnieuw verkopen
    expect(broker2.sells()).toHaveLength(1);
    expect(h2.engine.snapshot().positions).toHaveLength(0);
  });
});

describe("Late extra vullingen: alleen het nieuwe deel, tegen zijn eigen prijs", () => {
  it("regressie S5d: 60% gevuld @ 50.000, door de stop verkocht, daarna 40% @ 48.000 → nieuwe positie @ 48.000 (niet het ordergemiddelde)", async () => {
    const h = setup({ mode: "live", startingCapital: 50 });
    h.engine.arm();
    const a1 = 0.00024; // 60% van 0,0004
    const f1 = a1 * 50_000 * FEE;
    h.broker.script.push((req) =>
      result(req, {
        status: "partiallyFilled",
        filledAmount: a1,
        filledQuote: a1 * 50_000,
        avgPrice: 50_000,
        feeQuote: f1,
        error: "UITKOMST ONBEKEND: order nog open, annuleren niet bevestigd",
      }),
    );
    h.signals.buyAt.add(h.lastClosed());
    await h.engine.tick();
    let s = h.engine.snapshot();
    expect(s.positions).toHaveLength(1);
    expect(s.positions[0].amount).toBe(a1);
    const cid = h.broker.buys()[0].req.clientOrderId!;
    h.broker.balances.set("BTC", a1);

    // Nog open (lookup gooit); koers daalt: stop verkoopt het geboekte deel
    h.broker.lookupOrder = async () => {
      throw new Error("rate limit");
    };
    h.clock.advance(15_000);
    h.feed.setLast("BTC-EUR", 48_000);
    await h.engine.tick();
    s = h.engine.snapshot();
    expect(s.positions).toHaveLength(0);
    expect(s.trades).toHaveLength(1);
    expect(s.unknownOrders).toHaveLength(1);

    // De order vult de rest (40%) @ 48.000 en is nu klaar
    const a2 = 0.00016;
    const f2 = a2 * 48_000 * FEE;
    const totalQuote = a1 * 50_000 + a2 * 48_000;
    h.broker.lookupOrder = async (market, id) =>
      order(market, id, "buy", {
        status: "filled",
        filledAmount: a1 + a2,
        filledQuote: totalQuote,
        avgPrice: totalQuote / (a1 + a2), // 49.200
        feeQuote: f1 + f2,
      });
    h.broker.balances.set("BTC", a2);
    h.clock.advance(15_000);
    await h.engine.tick();
    s = h.engine.snapshot();
    expect(s.unknownOrders).toEqual([]);
    expect(s.positions).toHaveLength(1);
    const p = s.positions[0];
    expect(p.amount).toBeCloseTo(a2, 15);
    expect(p.entryPrice).toBeCloseTo(48_000, 6);
    expect(p.costQuote).toBeCloseTo(a2 * 48_000 + f2, 9);
    expect(p.entryFeeQuote).toBeCloseTo(f2, 12);
    expect(p.stopPrice).toBeCloseTo(47_000, 6); // stopDist 1000 t.o.v. 48.000
    expect(p.takeProfitPrice).toBeCloseTo(50_000, 6); // tpDist 2000
    // Administratie = wat er echt is uitgegeven
    const spent = a1 * 50_000 + f1 + a2 * 48_000 + f2;
    const received = s.trades[0].proceedsQuote;
    expect(50 - s.account.cashQuote).toBeCloseTo(spent - received, 9);
    expect(h.logs().some((m) => m.includes("KOOP BTC-EUR alsnog uitgevoerd") && m.includes("@ 48.000"))).toBe(true);
    expect(cid).toBeTruthy();
  });

  it("extra vulling bij een nog open positie: gewogen instapprijs met de prijs van alleen het nieuwe deel", async () => {
    const h = setup({ mode: "live", startingCapital: 50, markets: ["BTC-EUR"] });
    h.engine.arm();
    const a1 = 0.0002;
    h.broker.script.push((req) =>
      result(req, {
        status: "partiallyFilled",
        filledAmount: a1,
        filledQuote: a1 * 50_000,
        avgPrice: 50_000,
        feeQuote: 0.025,
        error: "UITKOMST ONBEKEND: order nog open",
      }),
    );
    h.signals.buyAt.add(h.lastClosed());
    await h.engine.tick();
    const a2 = 0.0001;
    h.broker.lookupOrder = async (market, id) =>
      order(market, id, "buy", {
        status: "cancelled",
        filledAmount: a1 + a2,
        filledQuote: a1 * 50_000 + a2 * 50_300,
        avgPrice: (a1 * 50_000 + a2 * 50_300) / (a1 + a2),
        feeQuote: 0.025 + 0.0125,
      });
    h.clock.advance(15_000);
    await h.engine.tick();
    const p = h.engine.snapshot().positions[0];
    expect(p.amount).toBeCloseTo(a1 + a2, 15);
    expect(p.entryPrice).toBeCloseTo((a1 * 50_000 + a2 * 50_300) / (a1 + a2), 6);
    expect(p.costQuote).toBeCloseTo(a1 * 50_000 + 0.025 + a2 * 50_300 + 0.0125, 9);
    expect(p.entryFeeQuote).toBeCloseTo(0.0375, 12);
    expect(p.stopPrice).toBe(49_000); // stop van de bestaande positie blijft
  });

  it("verkoop met onbekende uitkomst: het later gevulde deel wordt tegen zijn eigen prijs en fee geboekt", async () => {
    const h = setup({ mode: "live", startingCapital: 50 });
    h.engine.arm();
    const pos = await openBtcPosition(h);
    const half = pos.amount / 2;
    const fee1 = half * 48_900 * FEE;
    h.broker.script.push((req) =>
      result(req, {
        status: "partiallyFilled",
        filledAmount: half,
        filledQuote: half * 48_900,
        avgPrice: 48_900,
        feeQuote: fee1,
        error: "UITKOMST ONBEKEND: annuleren niet bevestigd",
      }),
    );
    h.clock.advance(15_000);
    h.feed.setLast("BTC-EUR", 48_900);
    await h.engine.tick();
    let s = h.engine.snapshot();
    expect(s.trades).toHaveLength(1);
    expect(s.positions[0].amount).toBeCloseTo(half, 15);
    const fee2 = half * 48_000 * FEE;
    h.broker.lookupOrder = async (market, id) =>
      order(market, id, "sell", {
        status: "filled",
        filledAmount: pos.amount,
        filledQuote: half * 48_900 + half * 48_000,
        avgPrice: 48_450,
        feeQuote: fee1 + fee2,
      });
    h.clock.advance(15_000);
    await h.engine.tick();
    s = h.engine.snapshot();
    expect(s.positions).toHaveLength(0);
    expect(h.broker.sells()).toHaveLength(1);
    const [second, first] = s.trades;
    expect(first.exitPrice).toBe(48_900);
    expect(second.exitPrice).toBeCloseTo(48_000, 6);
    expect(second.amount).toBeCloseTo(half, 15);
    expect(second.proceedsQuote).toBeCloseTo(half * 48_000 - fee2, 9);
    expect(s.trades.reduce((a, t) => a + t.proceedsQuote, 0)).toBeCloseTo(pos.amount * 48_450 - fee1 - fee2, 9);
  });
});

describe("Noodstop: armen geblokkeerd, altijd ontwapend, logniveaus", () => {
  it("Start + arm tijdens de noodstop: start() en arm() weigeren ('… geblokkeerd: noodstop bezig'), de noodstop eindigt ontwapend en gestopt; daarna mag armen weer", async () => {
    const h = setup({ mode: "live", startingCapital: 50, markets: ["BTC-EUR", "ETH-EUR"] });
    h.engine.arm();
    h.risk.quote = 20;
    await openBtcPosition(h); // BTC en ETH
    expect(h.engine.snapshot().positions).toHaveLength(2);
    const gates: (() => void)[] = [];
    const orig = h.broker.placeMarketOrder.bind(h.broker);
    h.broker.placeMarketOrder = async (req, ref) => {
      await new Promise<void>((r) => gates.push(r));
      return orig(req, ref);
    };
    const killing = h.engine.killSwitch();
    await waitFor(() => gates.length === 1); // noodstop verkoopt BTC
    // Herschreven (ronde 4): Start werd hier geaccepteerd (en pas door de noodstop weer
    // teruggedraaid); nu weigert start() zelf, zodat een noodstop nooit met een draaiende bot eindigt.
    await expect(h.engine.start()).rejects.toThrow(/^Starten geblokkeerd: noodstop bezig/);
    expect(() => h.engine.arm()).toThrow(/^Armen geblokkeerd: noodstop bezig/);
    expect(h.engine.liveArmed).toBe(false);
    gates.shift()!();
    await waitFor(() => gates.length === 1);
    expect(() => h.engine.arm()).toThrow(/^Armen geblokkeerd: noodstop bezig/);
    await expect(h.engine.start()).rejects.toThrow(/^Starten geblokkeerd: noodstop bezig/);
    gates.shift()!();
    const res = await killing;
    expect(res).toEqual({ closed: 2, failed: [] });
    const s = h.engine.snapshot();
    expect(s.liveArmed).toBe(false);
    expect(s.running).toBe(false);
    expect(h.logs().filter((m) => m.startsWith("LIVE GEARMD"))).toHaveLength(1); // alleen vóór de noodstop
    // Na de noodstop mag armen weer (bewuste keuze van de gebruiker)
    h.engine.arm();
    expect(h.engine.liveArmed).toBe(true);
  });

  it("geslaagde noodstop (ook zonder posities) wordt als 'warn' gelogd, een mislukte als 'error'", async () => {
    const a = setup({ mode: "live", startingCapital: 50 });
    a.engine.arm();
    const r0 = await a.engine.killSwitch();
    expect(r0).toEqual({ closed: 0, failed: [] });
    let logs = a.engine.snapshot().logs;
    expect(logs.find((l) => l.message.startsWith("NOODSTOP geactiveerd: 0 open positie(s)"))?.level).toBe("warn");
    expect(logs.find((l) => l.message.startsWith("NOODSTOP voltooid: 0 positie(s) gesloten"))?.level).toBe("warn");
    expect(logs.some((l) => l.level === "error")).toBe(false);

    const b = setup({ mode: "live", startingCapital: 50 });
    b.engine.arm();
    await openBtcPosition(b);
    b.broker.rejectSells = 1;
    const r1 = await b.engine.killSwitch();
    expect(r1.failed).toHaveLength(1);
    logs = b.engine.snapshot().logs;
    expect(logs.find((l) => l.message.startsWith("NOODSTOP geactiveerd"))?.level).toBe("warn");
    expect(logs.find((l) => l.message.startsWith("NOODSTOP: 0 positie(s) gesloten, 1 NIET gesloten"))?.level).toBe(
      "error",
    );
    expect(logs.find((l) => l.message.startsWith("Verkoop BTC-EUR (noodstop) mislukt"))?.level).toBe("error");
    expect(b.engine.liveArmed).toBe(false);
  });
});

describe("Expliciete verkopen melden hun eigen mislukking", () => {
  it("automatische poging logt (hooguit 1× per minuut), handmatig sluiten binnen die minuut logt tóch zijn eigen fout", async () => {
    const h = setup();
    await openBtcPosition(h);
    h.broker.rejectSells = 4;
    h.clock.advance(15_000);
    h.feed.setLast("BTC-EUR", 48_900);
    await h.engine.tick(); // stop-loss afgewezen → gelogd
    h.clock.advance(10_000);
    await h.engine.tick(); // tweede automatische poging binnen 60 s → niet opnieuw gelogd
    const auto = (m: string) => m.startsWith("Verkoop BTC-EUR (stop-loss) mislukt");
    expect(h.logs().filter(auto)).toHaveLength(1);
    h.clock.advance(5_000);
    const pos = h.engine.snapshot().positions[0];
    expect(await h.engine.closePosition(pos.id)).toBeNull();
    expect(h.engine.lastCloseFailure).toBe("verkoop afgewezen: Markt tijdelijk gesloten");
    const manual = (m: string) => m.startsWith("Verkoop BTC-EUR (handmatig) mislukt: Markt tijdelijk gesloten");
    expect(h.logs().filter(manual)).toHaveLength(1);
    // Nog een keer handmatig: weer gemeld
    h.clock.advance(1_000);
    expect(await h.engine.closePosition(pos.id)).toBeNull();
    expect(h.logs().filter(manual)).toHaveLength(2);
    // Automatisch (met de reden van de handmatige poging) binnen de minuut: niet gemeld
    const before = h.logs().length;
    h.clock.advance(1_000);
    await h.engine.tick();
    expect(
      h
        .logs()
        .slice(0, h.logs().length - before)
        .some((m) => m.includes("mislukt")),
    ).toBe(false);
  });

  it("handmatig sluiten tijdens een lopende verkoop met onbekende uitkomst meldt dat elke keer", async () => {
    const h = setup({ mode: "live", startingCapital: 50 });
    h.engine.arm();
    await openBtcPosition(h);
    h.broker.script.push((req) => result(req, { status: "new", error: "UITKOMST ONBEKEND: netwerkfout" }));
    h.clock.advance(15_000);
    h.feed.setLast("BTC-EUR", 48_900);
    await h.engine.tick();
    h.broker.lookupOrder = async () => {
      throw new Error("rate limit");
    };
    h.clock.advance(15_000);
    await h.engine.tick(); // automatisch: melding "er loopt nog een verkooporder …"
    const wait = (m: string) => m.includes("er loopt nog een verkooporder met onbekende uitkomst");
    const n = h.logs().filter(wait).length;
    expect(n).toBe(1);
    const pos = h.engine.snapshot().positions[0];
    for (let i = 1; i <= 2; i++) {
      h.clock.advance(1_000);
      expect(await h.engine.closePosition(pos.id)).toBeNull();
      expect(h.logs().filter(wait)).toHaveLength(n + i);
    }
    expect(h.broker.sells()).toHaveLength(1);
  });
});
