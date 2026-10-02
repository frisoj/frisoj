/**
 * Ronde 4 — regressietests voor de engine:
 *  - koersbewaking terwijl de bot stilstaat (alleen koersen/equity, geen beslissingen,
 *    orders of saldo-opvragingen); nooit een equity-punt tegen de instapkoers (S9);
 *  - afschrijven op VERSE gegevens (koers, live ook saldo) en nooit tijdens handmatig
 *    sluiten of de noodstop; een afgeschreven positie telt nooit als "gesloten" (E2c, E4, B5);
 *  - hysterese rond het beursminimum na een weigering "ONVERKOOPBAAR" (Bitvavo 217):
 *    geen stroom orders/meldingen bij een koers die rond €5 schommelt (A2, A3, noise_hour);
 *  - teksten: geen belofte "de bot verkoopt zodra …" als hij stilstaat of niet gearmd is;
 *    noodstop met alleen onverkoopbare posities zegt niet "sluit handmatig"; paper-herstel
 *    noemt geen Bitvavo-saldi;
 *  - kapitaallimiet: verlagen en weer verhogen verdunt niets (S12, S12b), dag-% t.o.v. het
 *    kapitaal dat echt handelt, zelfde limiet = geen storting (S10);
 *  - oud statusbestand met afgekapte startequity (ronde 2).
 */
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_RISK_CONFIG } from "../../src/core/defaults";
import type { MarketOrderRequest, OrderResult, PersistedState } from "../../src/core/types";
import { mulberry32 } from "../../src/core/util";
import { StateStore } from "../../src/engine/stateStore";
import { RiskManager } from "../../src/risk/riskManager";
import { Deferred, FakeBroker, FakeFeed, T0, openBtcPosition, setup, type Harness } from "./helpers";

const FEE = 0.0025;
/** 00:30 Amsterdam op 6 januari 2026 (de dag na T0) */
const NEXT_DAY = Date.UTC(2026, 0, 5, 23, 30);

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

async function waitFor(cond: () => boolean): Promise<void> {
  for (let i = 0; i < 1000 && !cond(); i++) await new Promise((r) => setImmediate(r));
  if (!cond()) throw new Error("waitFor: voorwaarde niet gehaald");
}

let dirs: string[] = [];
afterEach(() => {
  vi.useRealTimers();
  for (const d of dirs) rmSync(d, { recursive: true, force: true });
  dirs = [];
});
function tmp(): string {
  const d = mkdtempSync(join(tmpdir(), "engine-r4-"));
  dirs.push(d);
  return d;
}

function realHalt(h: Harness): void {
  const rm = new RiskManager({ ...DEFAULT_RISK_CONFIG }, "15m");
  h.risk.haltStatus = (a) => rm.haltStatus(a);
}

/** Alle logregels (ook die uit de begrensde snapshot gevallen zijn). */
const allLogs = (h: Harness): string[] => h.of("log").map((l) => l.message as string);
const unsellableWarns = (h: Harness) => allLogs(h).filter((m) => m.startsWith("BTC-EUR positie is onverkoopbaar"));
const againSellable = (h: Harness) => allLogs(h).filter((m) => m.startsWith("BTC-EUR is weer verkoopbaar"));

/** Live, gearmd, €6 BTC-positie (0,0001197 BTC: bij 40.000 → €4,78, bij 50.000 → €5,98). */
async function smallLivePosition(h: Harness) {
  h.engine.arm();
  h.risk.quote = 6;
  return openBtcPosition(h);
}

/**
 * Zoals Bitvavo (code 217): de beurs toetst het minimum tegen de bied-koers (0,1% onder
 * de referentie) en weigert dan met "ONVERKOOPBAAR:" (zoals de LiveBroker het doorgeeft).
 */
function bitvavo217(h: Harness): void {
  const orig = h.broker.placeMarketOrder.bind(h.broker);
  h.broker.placeMarketOrder = async (req, ref) => {
    if (req.side === "sell" && req.amount! * ref * 0.999 < 5) {
      const res = result(req, {
        status: "rejected",
        error: "ONVERKOOPBAAR: Bitvavo weigert de verkoop: de orderwaarde is volgens Bitvavo lager dan het beursminimum (code 217)",
      });
      h.broker.orders.push({ req, ref, res });
      return res;
    }
    return orig(req, ref);
  };
}

/** Zet de koers zo dat de positie `value` EUR waard is en doet één tick (15 s later). */
async function tickAtValue(h: Harness, amount: number, value: number, dt = 15_000): Promise<void> {
  h.feed.setLast("BTC-EUR", value / amount);
  h.clock.advance(dt);
  await h.engine.tick();
}

/** Nieuwe gesloten candle met een koopsignaal erop (voor een koop na een herstart). */
function nextBuyCandle(h: Harness, price: number): void {
  h.feed.append("BTC-EUR", price);
  h.clock.set(h.feed.lastTime("BTC-EUR") + 30_000);
  h.signals.buyAt.add(h.lastClosed());
}

// ───────────────────────────── 1. Koersbewaking ─────────────────────────────

describe("Koersbewaking terwijl de bot stilstaat", () => {
  it("herstelde positie: meteen een verse koers (niet de instapkoers); alleen price + snapshot — geen candles, beslissingen, orders of saldo", async () => {
    const file = join(tmp(), "state.json");
    const feed = new FakeFeed();
    for (const [m, p] of [["BTC-EUR", 50_000], ["ETH-EUR", 3_000], ["SOL-EUR", 150]] as const) feed.setSeries(m, p, T0);
    const h1 = setup({ feed, markets: ["BTC-EUR"], deps: { store: new StateStore(file) } });
    const pos = await openBtcPosition(h1);
    await h1.engine.stop();

    feed.setLast("BTC-EUR", 55_000);
    // Andere markt ingesteld; de BTC-positie blijft bewaakt. SOL doet nergens aan mee.
    const h2 = setup({ feed, clock: h1.clock, markets: ["ETH-EUR"], deps: { store: new StateStore(file) } });
    expect(h2.engine.snapshot().positions[0].currentPrice).toBe(pos.entryPrice); // nog geen koers
    const getPrice = vi.spyOn(feed, "getPrice");
    const balances = vi.spyOn(h2.broker, "getBalances");
    const orders = vi.spyOn(h2.broker, "placeMarketOrder");
    const candleCalls = feed.calls.length;
    const decideCalls = h2.signals.decide.mock.calls.length;

    await h2.engine.startPriceMonitor();
    const s = h2.engine.snapshot();
    expect(s.running).toBe(false);
    expect(s.positions[0].currentPrice).toBe(55_000);
    expect(s.prices).toEqual({ "ETH-EUR": 3_000, "BTC-EUR": 55_000 });
    expect(s.account.unrealizedPnl).toBeCloseTo(pos.amount * 55_000 * (1 - FEE) - pos.costQuote, 9);
    expect(s.account.equity).toBeCloseTo(s.account.cashQuote + pos.amount * 55_000, 9);
    expect(getPrice.mock.calls.map((c) => c[0]).sort()).toEqual(["BTC-EUR", "ETH-EUR"]);
    expect(h2.of("price")).toEqual([
      { market: "ETH-EUR", price: 3_000, time: h2.clock.t },
      { market: "BTC-EUR", price: 55_000, time: h2.clock.t },
    ]);
    expect(h2.of("snapshot").at(-1).positions[0].currentPrice).toBe(55_000);
    for (const t of ["decision", "candle", "order", "position-opened", "position-closed"] as const) {
      expect(h2.of(t)).toEqual([]);
    }
    expect(feed.calls.length).toBe(candleCalls);
    expect(h2.signals.decide.mock.calls.length).toBe(decideCalls);
    expect(balances).not.toHaveBeenCalled();
    expect(orders).not.toHaveBeenCalled();
    h2.engine.stopPriceMonitor();
  });

  it("elke pollMs opnieuw vóór de eerste Start; Start pauzeert de bewaking, Stop en de noodstop hervatten hem; stopPriceMonitor zet hem uit", async () => {
    vi.useFakeTimers();
    const h = setup({ markets: ["BTC-EUR", "ETH-EUR"] });
    const getPrice = vi.spyOn(h.feed, "getPrice");
    await h.engine.startPriceMonitor();
    expect(getPrice).toHaveBeenCalledTimes(2);
    h.feed.setLast("BTC-EUR", 51_000);
    await vi.advanceTimersByTimeAsync(15_000);
    expect(getPrice).toHaveBeenCalledTimes(4);
    expect(h.engine.snapshot().prices["BTC-EUR"]).toBe(51_000);

    await h.engine.start();
    getPrice.mockClear();
    const candles = h.feed.calls.length;
    await vi.advanceTimersByTimeAsync(45_000);
    expect(h.feed.calls.length).toBeGreaterThan(candles); // de bot tickt zelf
    expect(getPrice).not.toHaveBeenCalled(); // geen dubbele bewaking

    await h.engine.stop();
    const ticksAfterStop = h.feed.calls.length;
    await vi.advanceTimersByTimeAsync(15_000);
    expect(getPrice).toHaveBeenCalledTimes(2);
    expect(h.feed.calls.length).toBe(ticksAfterStop); // geen ticks meer

    await h.engine.start();
    await h.engine.killSwitch();
    getPrice.mockClear();
    await vi.advanceTimersByTimeAsync(15_000);
    expect(getPrice).toHaveBeenCalledTimes(2);

    h.engine.stopPriceMonitor();
    getPrice.mockClear();
    await vi.advanceTimersByTimeAsync(60_000);
    expect(getPrice).not.toHaveBeenCalled();
  });

  it("feed faalt: geen koersen, één (gedempte) waarschuwing, niets kapot", async () => {
    const h = setup();
    h.feed.getPrice = async () => {
      throw new Error("HTTP 503");
    };
    await h.engine.startPriceMonitor();
    await h.engine.startPriceMonitor();
    expect(h.engine.snapshot().prices).toEqual({});
    expect(allLogs(h).filter((m) => m.startsWith("Koersen niet ververst terwijl de bot stilstaat: HTTP 503"))).toHaveLength(1);
    h.engine.stopPriceMonitor();
  });

  it("regressie S9: herstart met een andere limiet en een open positie → geen equity-punt tegen de instapkoers; het punt komt na de eerste echte koers", async () => {
    for (const [from, to] of [
      [100, 50],
      [50, 100],
    ]) {
      const file = join(tmp(), "state.json");
      const h1 = setup({ mode: "live", startingCapital: from, deps: { store: new StateStore(file) } });
      h1.engine.arm();
      h1.risk.quote = 40;
      h1.risk.tpDist = 1e9;
      const pos = await openBtcPosition(h1);
      h1.feed.setLast("BTC-EUR", 60_000); // +20%
      h1.clock.advance(120_000);
      await h1.engine.tick();
      const before = h1.engine.snapshot().equityHistory.at(-1)!;
      const curve = before.equity + (before.skimmed ?? 0);
      expect(curve).toBeCloseTo(h1.engine.snapshot().account.equity, 9);
      await h1.engine.stop();

      h1.clock.advance(120_000);
      const h2 = setup({
        mode: "live",
        startingCapital: to,
        clock: h1.clock,
        feed: h1.feed,
        broker: h1.broker,
        deps: { store: new StateStore(file) },
      });
      const atLoad = h2.engine.snapshot();
      expect(atLoad.positions[0].currentPrice).toBe(pos.entryPrice);
      expect(atLoad.equityHistory.at(-1)).toEqual(before); // géén punt tegen de instapkoers

      await h2.engine.startPriceMonitor();
      h2.engine.stopPriceMonitor();
      const s = h2.engine.snapshot();
      const last = s.equityHistory.at(-1)!;
      expect(last.time).toBe(h1.clock.t);
      // equity + netto eruit loopt door: alleen een overboeking, geen koerssprong
      expect(last.equity + (last.skimmed ?? 0)).toBeCloseTo(curve, 9);
      expect(s.equityHistory.every((p) => Math.abs(p.equity + (p.skimmed ?? 0) - curve) < 1e-9 || p.time < pos.entryTime + 120_000)).toBe(true);
    }
  });

  it("tick: geen equity-punt zolang een positie nog geen echte koers heeft (feed faalt na een herstart)", async () => {
    const file = join(tmp(), "state.json");
    const h1 = setup({ deps: { store: new StateStore(file) } });
    h1.risk.tpDist = 1e9;
    await openBtcPosition(h1);
    h1.feed.setLast("BTC-EUR", 55_000);
    await h1.engine.stop();
    const h2 = setup({ clock: h1.clock, feed: h1.feed, deps: { store: new StateStore(file) } });
    h2.risk.tpDist = 1e9;
    const n = h2.engine.snapshot().equityHistory.length;
    h2.feed.failing.add("BTC-EUR");
    h2.clock.advance(120_000);
    await h2.engine.tick();
    expect(h2.engine.snapshot().equityHistory).toHaveLength(n);
    h2.feed.failing.delete("BTC-EUR");
    h2.clock.advance(15_000);
    await h2.engine.tick();
    const s = h2.engine.snapshot();
    expect(s.equityHistory).toHaveLength(n + 1);
    expect(s.equityHistory.at(-1)!.equity).toBeCloseTo(s.account.cashQuote + s.positions[0].amount * 55_000, 9);
  });
});

// ───────────────────────────── 2. Afschrijven op verse gegevens ─────────────────────────────

describe("Afschrijven op verse gegevens", () => {
  it("regressie B5: bot gestopt, koers in het geheugen verouderd (< €5) maar vers €5,98 → geweigerd; omgekeerd → afgeschreven tegen de verse koers", async () => {
    const h = setup();
    h.risk.quote = 6;
    h.risk.stopDist = 20_000; // geen automatische exit
    const pos = await openBtcPosition(h);
    h.feed.setLast("BTC-EUR", 40_000);
    h.clock.advance(15_000);
    await h.engine.tick();
    expect(h.engine.snapshot().positions[0].unsellable).toBe(true);

    h.feed.setLast("BTC-EUR", 50_000); // geen tick: het geheugen zegt nog €4,78
    expect(h.engine.snapshot().positions[0].unsellable).toBe(true);
    await expect(h.engine.writeOffPosition(pos.id)).rejects.toThrow(
      /^Afschrijven kan alleen voor een onverkoopbare positie .* BTC-EUR is nu ~€5,9\d waard/,
    );
    expect(h.engine.snapshot().positions[0].unsellable).toBeUndefined(); // verse koers onthouden

    h.feed.setLast("BTC-EUR", 40_000); // geen tick: het geheugen zegt nog €5,98
    expect(h.engine.snapshot().positions[0].unsellable).toBeUndefined();
    const t = await h.engine.writeOffPosition(pos.id);
    expect(t).toMatchObject({ exitReason: "write-off", exitPrice: 40_000, proceedsQuote: 0, pnlPct: -100 });
    expect(h.broker.sells()).toHaveLength(0);
  });

  it("regressie E4 (live): verouderde beschikbaarheid — vers saldo weer volledig → geweigerd; vers saldo 97% (< €5) → afgeschreven", async () => {
    const h = setup({ mode: "live", startingCapital: 50 });
    const pos = await smallLivePosition(h);
    h.broker.balances.set("BTC", pos.amount * 0.97);
    h.feed.setLast("BTC-EUR", 5.1 / pos.amount); // positie €5,10, beschikbaar €4,95
    expect(await h.engine.closePosition(pos.id)).toBeNull();
    expect(h.engine.snapshot().positions[0].unsellable).toBe(true);
    h.engine.disarm();
    h.broker.balances.set("BTC", pos.amount); // saldo weer volledig (bijv. order vrijgegeven)
    h.clock.advance(15_000);
    await h.engine.tick(); // ontwapend: geen saldo-opvraging, de weergave is nog verouderd
    const reads = vi.spyOn(h.broker, "getBalances");
    await expect(h.engine.writeOffPosition(pos.id)).rejects.toThrow(/^Afschrijven kan alleen .* ~€5,10 waard/);
    expect(reads).toHaveBeenCalledTimes(1);
    h.broker.balances.set("BTC", pos.amount * 0.97);
    const t = await h.engine.writeOffPosition(pos.id);
    expect(t.exitReason).toBe("write-off");
    expect(h.broker.sells()).toHaveLength(0);
  });

  it("verse koers of (live) saldo niet op te halen → geweigerd; coins (deels) weg of in een order → geweigerd met het advies te sluiten", async () => {
    const p = setup();
    p.risk.quote = 6;
    p.risk.stopDist = 20_000;
    const pp = await openBtcPosition(p);
    p.feed.setLast("BTC-EUR", 40_000);
    p.feed.getPrice = async () => {
      throw new Error("HTTP 503");
    };
    await expect(p.engine.writeOffPosition(pp.id)).rejects.toThrow(
      /^Afschrijven kan nu even niet: de actuele koers van BTC-EUR kon niet opgehaald worden/,
    );

    const h = setup({ mode: "live", startingCapital: 50 });
    h.risk.stopDist = 20_000;
    const pos = await smallLivePosition(h);
    h.feed.setLast("BTC-EUR", 40_000); // €4,78: onverkoopbaar
    h.broker.getBalances = async () => {
      throw new Error("rate limit");
    };
    await expect(h.engine.writeOffPosition(pos.id)).rejects.toThrow(
      /^Afschrijven kan nu even niet: het BTC-saldo op Bitvavo kon niet gecontroleerd worden/,
    );
    h.broker.getBalances = FakeBroker.prototype.getBalances.bind(h.broker);
    h.broker.balances.set("BTC", pos.amount * 0.5);
    await expect(h.engine.writeOffPosition(pos.id)).rejects.toThrow(/^Afschrijven kan nu niet: op Bitvavo staat .*Sluit de positie in plaats daarvan/);
    h.broker.balances.set("BTC", 0);
    h.broker.inOrder.set("BTC", pos.amount);
    await expect(h.engine.writeOffPosition(pos.id)).rejects.toThrow(/in een openstaande order/);
    expect(h.engine.snapshot().positions).toHaveLength(1);
    expect(h.engine.snapshot().trades).toHaveLength(0);
  });

  it("regressie (close_race): tijdens handmatig sluiten — ook als dat nog op de lock wacht — wordt afschrijven geweigerd", async () => {
    const h = setup({ mode: "live", startingCapital: 50 });
    h.risk.stopDist = 20_000;
    const pos = await smallLivePosition(h);
    h.feed.setLast("BTC-EUR", 40_000);

    // (a) sluiten wacht op GET /balance
    const gate = new Deferred();
    const orig = h.broker.getBalances.bind(h.broker);
    let gated = true;
    let waiting = false;
    h.broker.getBalances = async () => {
      if (gated) {
        gated = false;
        waiting = true;
        await gate.promise;
      }
      return orig();
    };
    const closing = h.engine.closePosition(pos.id);
    await waitFor(() => waiting);
    await expect(h.engine.writeOffPosition(pos.id)).rejects.toThrow(
      /^Afschrijven kan nu niet: BTC-EUR wordt op dit moment handmatig gesloten/,
    );
    gate.resolve();
    expect(await closing).toBeNull();
    expect(h.engine.lastCloseFailure).toBe("onverkoopbaar: waarde €4,78 < minimum €5,00");

    // (b) sluiten staat nog in de wachtrij achter een lopende tick
    const feedGate = new Deferred();
    h.feed.gate = feedGate.promise;
    h.clock.advance(15_000);
    const tick = h.engine.tick();
    const queued = h.engine.closePosition(pos.id);
    await expect(h.engine.writeOffPosition(pos.id)).rejects.toThrow(/wordt op dit moment handmatig gesloten/);
    h.feed.gate = null;
    feedGate.resolve();
    await tick;
    expect(await queued).toBeNull();

    // Daarna gewoon
    const t = await h.engine.writeOffPosition(pos.id);
    expect(t.exitReason).toBe("write-off");
    expect(h.broker.sells()).toHaveLength(0);
  });

  it("controleert opnieuw NA het ophalen van de verse gegevens: intussen gevraagd sluiten → geweigerd", async () => {
    const h = setup();
    h.risk.quote = 6;
    h.risk.stopDist = 20_000;
    const pos = await openBtcPosition(h);
    h.feed.setLast("BTC-EUR", 40_000);
    const gate = new Deferred();
    const orig = h.feed.getPrice.bind(h.feed);
    let first = true;
    h.feed.getPrice = async (m) => {
      if (first) {
        first = false;
        await gate.promise;
      }
      return orig(m);
    };
    const writingOff = h.engine.writeOffPosition(pos.id);
    const closing = h.engine.closePosition(pos.id); // wordt aangevraagd terwijl het afschrijven de koers ophaalt
    gate.resolve();
    await expect(writingOff).rejects.toThrow(/wordt op dit moment handmatig gesloten/);
    expect(await closing).toBeNull(); // €4,78: onverkoopbaar, niets verkocht
    expect(h.engine.snapshot().positions).toHaveLength(1);
    expect(h.engine.snapshot().trades).toHaveLength(0);
  });

  it("regressie E2c: afschrijven tijdens de noodstop → geweigerd; de noodstop telt de positie NIET als gesloten; daarna mag het", async () => {
    const h = setup({ mode: "live", startingCapital: 50 });
    h.risk.stopDist = 20_000;
    const pos = await smallLivePosition(h);
    h.feed.setLast("BTC-EUR", 40_000);
    const gate = new Deferred();
    const orig = h.broker.getBalances.bind(h.broker);
    let gated = true;
    let waiting = false;
    h.broker.getBalances = async () => {
      if (gated) {
        gated = false;
        waiting = true;
        await gate.promise;
      }
      return orig();
    };
    const killing = h.engine.killSwitch();
    await waitFor(() => waiting); // de noodstop controleert het saldo van de positie
    await expect(h.engine.writeOffPosition(pos.id)).rejects.toThrow(/^Afschrijven kan nu niet: de noodstop is bezig/);
    gate.resolve();
    const res = await killing;
    expect(res).toEqual({
      closed: 0,
      failed: [{ id: pos.id, market: "BTC-EUR", reason: "onverkoopbaar: waarde €4,78 < minimum €5,00" }],
    });
    const t = await h.engine.writeOffPosition(pos.id);
    expect(t.exitReason).toBe("write-off");
    expect(await h.engine.killSwitch()).toEqual({ closed: 0, failed: [] });
  });

  it("na afschrijven: closePosition van die positie → null met reden 'afgeschreven' (nooit 'gesloten')", async () => {
    const h = setup();
    h.risk.quote = 6;
    h.risk.stopDist = 20_000;
    const pos = await openBtcPosition(h);
    h.feed.setLast("BTC-EUR", 40_000);
    await h.engine.writeOffPosition(pos.id);
    expect(await h.engine.closePosition(pos.id)).toBeNull();
    expect(h.engine.lastCloseFailure).toBe("positie is afgeschreven: er is niets verkocht, de coins staan nog op je account");
    expect(h.broker.sells()).toHaveLength(0);
  });
});

// ───────────────────────────── 3. Hysterese rond €5 (Bitvavo 217) ─────────────────────────────

describe("Hysterese na een weigering 'ONVERKOOPBAAR' (Bitvavo 217)", () => {
  async function stuckAt217(): Promise<{ h: Harness; amount: number }> {
    const h = setup({ mode: "live", startingCapital: 50 });
    const pos = await smallLivePosition(h);
    bitvavo217(h);
    h.feed.setLast("BTC-EUR", 40_000); // door de stop gegapt: €4,78
    h.clock.advance(15_000);
    await h.engine.tick();
    expect(h.broker.sells()).toHaveLength(0);
    return { h, amount: pos.amount };
  }

  it("regressie noise_hour: een uur (240 ticks) ±0,3% rond €5,00 → één geweigerde order en twee meldingen (geen stroom)", async () => {
    const { h, amount } = await stuckAt217();
    const rnd = mulberry32(7);
    for (let i = 0; i < 240; i++) {
      const v = 5 * (1 + (rnd() - 0.5) * 0.006);
      await tickAtValue(h, amount, Math.min(v, 5.004));
    }
    expect(h.broker.sells()).toHaveLength(1);
    expect(h.broker.sells()[0].res.status).toBe("rejected");
    expect(unsellableWarns(h)).toHaveLength(2); // eigen minimumcontrole + eerste weigering van Bitvavo
    expect(againSellable(h)).toHaveLength(0);
    const s = h.engine.snapshot();
    expect(s.positions).toHaveLength(1);
    expect(s.account.cashQuote).toBeCloseTo(50 - s.positions[0].costQuote, 9);
  });

  it("regressie A2/A3: schommelen tussen €4,95 en €5,003 of in kleine stapjes stijgen → niet elke keer opnieuw versturen", async () => {
    const a2 = await stuckAt217();
    for (let i = 0; i < 20; i++) await tickAtValue(a2.h, a2.amount, i % 2 === 0 ? 5.003 : 4.95);
    expect(a2.h.broker.sells()).toHaveLength(1);
    expect(unsellableWarns(a2.h)).toHaveLength(2);
    expect(againSellable(a2.h)).toHaveLength(0);

    const a3 = await stuckAt217();
    let v = 5.0001;
    for (let i = 0; i < 20; i++) {
      await tickAtValue(a3.h, a3.amount, v);
      v *= 1.00005;
    }
    expect(a3.h.broker.sells()).toHaveLength(1);
  });

  it("de weigering blijft staan na een dip onder €5 (niet vervangen door de eigen controle): pas bij ≥ 1% boven de geweigerde waarde én na 5 minuten opnieuw", async () => {
    const { h, amount } = await stuckAt217();
    await tickAtValue(h, amount, 5.003); // eerste poging → 217
    const refusedAt = h.clock.t;
    expect(h.broker.sells()).toHaveLength(1);
    await tickAtValue(h, amount, 4.9); // dip: eigen controle, geen order
    let s = h.engine.snapshot();
    expect(s.positions[0].unsellableReason).toMatch(/^Onverkoopbaar: waarde €4,(89|90) < minimum €5,00\./);
    await tickAtValue(h, amount, 5.03); // < 5,003 × 1,01: de weigering geldt nog
    s = h.engine.snapshot();
    expect(h.broker.sells()).toHaveLength(1);
    expect(s.positions[0].unsellable).toBe(true);
    expect(s.positions[0].unsellableReason).toContain("code 217");
    // (niet gestart in deze test: dus geen belofte, wel de drempel van de weigering)
    expect(s.positions[0].unsellableReason).toContain("Zodra de waarde weer ≥ €5,05 is kun je hem verkopen");
    await tickAtValue(h, amount, 5.06); // ≥ 1% hoger, maar binnen 5 minuten
    expect(h.broker.sells()).toHaveLength(1);
    expect(h.engine.snapshot().positions[0].unsellable).toBeUndefined(); // niet meer onverkoopbaar …
    await expect(h.engine.writeOffPosition(h.engine.snapshot().positions[0].id)).rejects.toThrow(/^Afschrijven kan alleen/);
    h.clock.set(refusedAt + 5 * 60_000 - 15_000);
    await tickAtValue(h, amount, 5.06); // … maar de volgende automatische poging pas na 5 minuten
    expect(h.broker.sells()).toHaveLength(2);
    s = h.engine.snapshot();
    expect(s.positions).toHaveLength(0);
    expect(s.trades[0].exitReason).toBe("stop-loss");
    expect(unsellableWarns(h)).toHaveLength(2);
  });

  it("handmatig sluiten en de noodstop proberen het wél meteen (ook binnen de marge en de 5 minuten); de hoogste geweigerde waarde telt", async () => {
    const { h, amount } = await stuckAt217();
    await tickAtValue(h, amount, 5.003); // 217
    const id = h.engine.snapshot().positions[0].id;
    h.feed.setLast("BTC-EUR", 5.004 / amount);
    expect(await h.engine.closePosition(id)).toBeNull(); // meteen geprobeerd (217)
    expect(h.broker.sells()).toHaveLength(2);
    expect(h.engine.lastCloseFailure).toMatch(/^onverkoopbaar: Bitvavo weigert de verkoop/);
    h.feed.setLast("BTC-EUR", 5.005 / amount);
    const kill = await h.engine.killSwitch(); // ook meteen
    expect(h.broker.sells()).toHaveLength(3);
    expect(kill.closed).toBe(0);
    expect(kill.failed[0].reason).toMatch(/^onverkoopbaar: Bitvavo weigert/);
    // Hoogste weigering (5,005): 5,05 < 5,005 × 1,01 = 5,055 → nog steeds onverkoopbaar
    h.engine.arm();
    await h.engine.start();
    // Draait en gearmd: dan wél de belofte, met de drempel van de hoogste weigering
    expect(h.engine.snapshot().positions[0].unsellableReason).toMatch(/De bot verkoopt zodra de waarde weer ≥ €5,0[56] is/);
    h.clock.advance(10 * 60_000);
    await tickAtValue(h, amount, 5.05);
    expect(h.broker.sells()).toHaveLength(3);
    expect(h.engine.snapshot().positions[0].unsellable).toBe(true);
    await tickAtValue(h, amount, 5.06);
    expect(h.broker.sells()).toHaveLength(4);
    expect(h.engine.snapshot().positions).toHaveLength(0);
    await h.engine.stop();
  });

  it("zonder weigering: net boven €5 wordt gewoon verkocht (geen 'weer verkoopbaar' onder de 1%-marge); ≥ 1% erboven wel die melding", async () => {
    const a = setup();
    a.risk.quote = 6;
    const pa = await openBtcPosition(a);
    await tickAtValue(a, pa.amount, 4.78);
    await tickAtValue(a, pa.amount, 4.99);
    await tickAtValue(a, pa.amount, 5.01);
    expect(a.broker.sells()).toHaveLength(1);
    expect(a.engine.snapshot().positions).toHaveLength(0);
    expect(allLogs(a).filter((m) => m.startsWith("BTC-EUR positie is onverkoopbaar"))).toHaveLength(1);
    expect(allLogs(a).some((m) => m.startsWith("BTC-EUR is weer verkoopbaar"))).toBe(false);

    const b = setup();
    b.risk.quote = 6;
    const pb = await openBtcPosition(b);
    await tickAtValue(b, pb.amount, 4.78);
    await tickAtValue(b, pb.amount, 5.2);
    expect(b.engine.snapshot().positions).toHaveLength(0);
    expect(allLogs(b).some((m) => m.startsWith("BTC-EUR is weer verkoopbaar (waarde ~€5,20)"))).toBe(true);
  });
});

// ───────────────────────────── 4. Teksten ─────────────────────────────

describe("Teksten bij onverkoopbare posities, noodstop en herstel", () => {
  it("regressie B3: live ontwapend (bot draait) → geen belofte 'de bot verkoopt zodra …'", async () => {
    const h = setup({ mode: "live", startingCapital: 50 });
    const pos = await smallLivePosition(h);
    await h.engine.start();
    h.engine.disarm();
    await tickAtValue(h, pos.amount, 4.78);
    const view = h.engine.snapshot().positions[0];
    expect(view.unsellable).toBe(true);
    expect(view.unsellableReason).not.toMatch(/De bot verkoopt zodra/);
    expect(view.unsellableReason).toContain(
      "Live is niet gearmd, dus hij verkoopt de positie niet vanzelf. Zodra de waarde weer ≥ €5,00 is kun je hem verkopen (arm de bot of sluit handmatig), of schrijf hem af.",
    );
    // Handmatig sluiten (ontwapend): de melding belooft ook niets
    expect(await h.engine.closePosition(pos.id)).toBeNull();
    const warn = unsellableWarns(h).at(-1)!;
    expect(warn).not.toMatch(/De bot verkoopt zodra/);
    expect(warn).toContain("arm de bot of sluit handmatig");
    await h.engine.stop();
  });

  it("gestopt: live 'start en arm de bot', paper 'start de bot'; draaiend en gearmd: wél 'De bot verkoopt zodra …'", async () => {
    const live = setup({ mode: "live", startingCapital: 50 });
    const lp = await smallLivePosition(live);
    await tickAtValue(live, lp.amount, 4.78); // niet gestart: bot staat stil
    let reason = live.engine.snapshot().positions[0].unsellableReason!;
    expect(reason).not.toMatch(/De bot verkoopt zodra/);
    expect(reason).toContain("De bot staat stil, dus hij verkoopt de positie niet vanzelf.");
    expect(reason).toContain("(start en arm de bot, of sluit handmatig)");
    expect(unsellableWarns(live)[0]).toContain("(start en arm de bot, of sluit handmatig)");

    const paper = setup();
    paper.risk.quote = 6;
    const pp = await openBtcPosition(paper);
    await tickAtValue(paper, pp.amount, 4.78);
    reason = paper.engine.snapshot().positions[0].unsellableReason!;
    expect(reason).not.toMatch(/De bot verkoopt zodra/);
    expect(reason).toContain("De bot staat stil: zodra de waarde weer ≥ €5,00 is kun je hem verkopen (start de bot of sluit handmatig), of schrijf hem af.");

    await paper.engine.start();
    reason = paper.engine.snapshot().positions[0].unsellableReason!;
    expect(reason).toContain("De bot verkoopt zodra de waarde weer ≥ €5,00 is; je kunt de positie ook afschrijven.");
    await paper.engine.stop();
  });

  it("noodstop met alleen onverkoopbare posities: geen 'sluit handmatig' maar 'wacht tot de waarde herstelt of schrijf de positie af'; gemengd wél 'sluit handmatig'", async () => {
    const a = setup({ mode: "live", startingCapital: 50 });
    const pa = await smallLivePosition(a);
    a.feed.setLast("BTC-EUR", 4.78 / pa.amount);
    await a.engine.killSwitch();
    const onlyDust = a.engine.snapshot().logs.find((l) => l.message.startsWith("NOODSTOP: 0 positie(s) gesloten, 1 NIET gesloten"))!;
    expect(onlyDust.level).toBe("error");
    expect(onlyDust.message).not.toContain("sluit handmatig");
    expect(onlyDust.message).toContain("wacht tot de waarde herstelt of schrijf de positie af");

    const b = setup({ mode: "live", startingCapital: 50, markets: ["BTC-EUR", "ETH-EUR"] });
    b.engine.arm();
    b.risk.quote = 6;
    b.risk.stopDist = 20_000;
    await openBtcPosition(b); // BTC en ETH
    b.feed.setLast("BTC-EUR", 40_000); // BTC onverkoopbaar
    b.broker.rejectSells = 1; // ETH afgewezen
    const res = await b.engine.killSwitch();
    expect(res.failed.map((f) => f.market).sort()).toEqual(["BTC-EUR", "ETH-EUR"]);
    const mixed = b.engine.snapshot().logs.find((l) => l.message.startsWith("NOODSTOP: 0 positie(s) gesloten, 2 NIET gesloten"))!;
    expect(mixed.message).toContain("controleer je account en sluit handmatig!");
    expect(mixed.message).toContain("Onverkoopbare posities: wacht tot de waarde herstelt of schrijf ze af.");
  });

  it("paper: herstelmelding en herinnering noemen geen Bitvavo-saldi (live wel)", async () => {
    const pfile = join(tmp(), "state-paper.json");
    writeFileSync(pfile, '{"version":1,"mode":"paper","acc');
    const p1 = setup({ deps: { store: new StateStore(pfile) } });
    const first = p1.engine.snapshot().logs.find((l) => l.message.startsWith("Opgeslagen staat onbruikbaar"))!;
    expect(first.message).toContain("LEGE administratie (oefenmodus)");
    expect(first.message).not.toMatch(/Bitvavo/);
    await p1.engine.stop(); // slaat de (onbevestigde) herstelmelding op
    const p2 = setup({ deps: { store: new StateStore(pfile) } }); // nog niet bevestigd
    const reminder = p2.engine.snapshot().logs.find((l) => l.message.startsWith("Nog niet bevestigd"))!;
    expect(reminder.message).not.toMatch(/Bitvavo/);
    expect(reminder.message).toContain("bevestig de melding");

    const lfile = join(tmp(), "state-live.json");
    writeFileSync(lfile, '{"version":1,"mode":"live","acc');
    const l1 = setup({ mode: "live", startingCapital: 50, deps: { store: new StateStore(lfile) } });
    expect(l1.logs().find((m) => m.startsWith("Opgeslagen staat onbruikbaar"))).toContain("Controleer je Bitvavo-saldi");
    await l1.engine.stop();
    const l2 = setup({ mode: "live", startingCapital: 50, deps: { store: new StateStore(lfile) } });
    expect(l2.logs().find((m) => m.startsWith("Nog niet bevestigd"))).toContain("Controleer je Bitvavo-saldi");
  });
});

// ───────────────────────────── 5. Kapitaallimiet ─────────────────────────────

describe("Kapitaallimiet: verlagen en weer verhogen, dag-% t.o.v. het kapitaal dat echt handelt", () => {
  interface Live {
    h: Harness;
    file: string;
  }
  function start(limit: number, file = join(tmp(), "state-live.json")): Live {
    const h = setup({ mode: "live", startingCapital: limit, deps: { store: new StateStore(file) } });
    realHalt(h);
    h.engine.arm();
    return { h, file };
  }
  async function restart(prev: Live, limit: number, advance = 60_000, stopFirst = true): Promise<Live> {
    if (stopFirst) await prev.h.engine.stop();
    prev.h.clock.advance(advance);
    const h = setup({
      mode: "live",
      startingCapital: limit,
      clock: prev.h.clock,
      feed: prev.h.feed,
      broker: prev.h.broker,
      deps: { store: new StateStore(prev.file) },
    });
    realHalt(h);
    h.engine.arm();
    await h.engine.tick();
    return { h, file: prev.file };
  }

  it("regressie S12: 3× 100 → 50 → 100 zonder handel: ingelegd blijft €100, netto eruit 0; daarna +20% = +20% rendement", async () => {
    let l = start(100);
    await l.h.engine.tick();
    for (let i = 0; i < 3; i++) {
      l = await restart(l, 50);
      l = await restart(l, 100);
    }
    let s = l.h.engine.snapshot();
    expect(s.account.startingEquity).toBe(100);
    expect(s.account.cashQuote).toBe(100);
    expect(s.account.totalPnlQuote).toBeCloseTo(0, 9);
    expect(s.account.dayPnlQuote).toBeCloseTo(0, 9);
    expect(s.equityHistory.at(-1)!.skimmed).toBeCloseTo(0, 9);
    expect(s.equityHistory.every((p) => Math.abs(p.equity + (p.skimmed ?? 0) - 100) < 1e-9)).toBe(true);

    nextBuyCandle(l.h, 50_000);
    l.h.risk.quote = 90;
    l.h.risk.tpDist = 1e9;
    await l.h.engine.tick();
    const pos = l.h.engine.snapshot().positions[0];
    l.h.feed.setLast("BTC-EUR", 55_000);
    const t = (await l.h.engine.closePosition(pos.id))!;
    s = l.h.engine.snapshot();
    expect(s.account.startingEquity).toBe(100);
    expect(s.account.totalReturnPct).toBeCloseTo(t.pnlQuote, 9); // op €100, niet op €250
    expect(s.account.dayReturnPct).toBeCloseTo(t.pnlQuote, 9);
  });

  it("regressie S12b: verlagen en weer verhogen op dezelfde dag verdunt de dagelijkse verlieslimiet niet (-6,7% van €100 → pauze)", async () => {
    let l = start(100);
    await l.h.engine.tick();
    l = await restart(l, 50);
    l = await restart(l, 100);
    nextBuyCandle(l.h, 50_000);
    l.h.risk.quote = 90;
    l.h.risk.stopDist = 40_000;
    await l.h.engine.tick();
    const pos = l.h.engine.snapshot().positions[0];
    l.h.feed.setLast("BTC-EUR", 46_500); // -7% op €90
    await l.h.engine.closePosition(pos.id);
    await l.h.engine.tick();
    const s = l.h.engine.snapshot();
    expect(s.account.startingEquity).toBe(100);
    expect(s.account.dayReturnPct).toBeCloseTo(s.account.dayPnlQuote!, 9); // t.o.v. €100
    expect(s.account.dayReturnPct).toBeLessThan(-5);
    expect(s.halted).toMatchObject({ halted: true, dailyLimit: true });
  });

  it("na een verlaging midden op de dag telt verlies t.o.v. het nieuwe budget: -8% van €50 → pauze (5%-limiet)", async () => {
    let l = start(100);
    await l.h.engine.tick();
    l = await restart(l, 50);
    let s = l.h.engine.snapshot();
    expect(s.account.dayStartEquity).toBe(100);
    expect(s.account.dayReturnPct).toBeCloseTo(0, 9);
    nextBuyCandle(l.h, 50_000);
    l.h.risk.quote = 45;
    l.h.risk.stopDist = 40_000;
    await l.h.engine.tick();
    const pos = l.h.engine.snapshot().positions[0];
    l.h.feed.setLast("BTC-EUR", 46_000); // ~-8% van €45 + kosten ≈ -7,6% van €50
    await l.h.engine.closePosition(pos.id);
    await l.h.engine.tick();
    s = l.h.engine.snapshot();
    const loss = s.account.dayPnlQuote!;
    expect(loss).toBeLessThan(-3.5);
    expect(s.account.dayReturnPct).toBeCloseTo((loss / 50) * 100, 9); // basis: 100 − 50 teruggegaan
    expect(s.halted).toMatchObject({ halted: true, dailyLimit: true });
  });

  it("regressie S10: zelfde limiet met een negatieve cash (alsnog gevulde koop) → geen 'storting', geen nep-winst bij verkoop", async () => {
    const l = start(50);
    l.h.risk.quote = 20;
    const pos = await openBtcPosition(l.h);
    await l.h.engine.stop();
    const st = JSON.parse(readFileSync(l.file, "utf8")) as PersistedState;
    const k = 55 / st.positions[0].costQuote;
    st.positions[0].amount *= k;
    st.positions[0].costQuote = 55;
    st.positions[0].entryFeeQuote *= k;
    st.account.cashQuote = -5;
    writeFileSync(l.file, JSON.stringify(st));
    l.h.broker.balances.set("BTC", st.positions[0].amount);

    const r = await restart(l, 50, 60_000, false); // al gestopt: niet opnieuw opslaan
    let s = r.h.engine.snapshot();
    expect(s.account.cashQuote).toBe(-5);
    expect(s.account.startingEquity).toBe(50);
    expect(r.h.logs().some((m) => m.includes("storting") || m.includes("→"))).toBe(false);
    const t = (await r.h.engine.closePosition(pos.id))!;
    s = r.h.engine.snapshot();
    expect(t.pnlQuote).toBeLessThan(0); // alleen kosten
    expect(s.skimmedQuote).toBe(0);
    expect(r.h.logs().some((m) => m.includes("winst"))).toBe(false);
    expect(s.account.cashQuote).toBeCloseTo(-5 + t.proceedsQuote, 9);
    expect(s.account.totalPnlQuote).toBeCloseTo(s.account.equity - 50, 9);
  });

  it("verlaagd op dag 1, verhoogd op dag 2: teruggelegd kapitaal is geen nieuw kapitaal; de dagstorting blijft na een herstart bewaard", async () => {
    let l = start(100);
    await l.h.engine.tick();
    l = await restart(l, 50); // dag 1: €50 terug
    l.h.clock.set(NEXT_DAY);
    await l.h.engine.tick(); // dagwissel: dagstart €50
    expect(l.h.engine.snapshot().account.dayStartEquity).toBe(50);
    l = await restart(l, 100); // dag 2: €50 terug erin (geen nieuw kapitaal)
    let s = l.h.engine.snapshot();
    expect(s.account.startingEquity).toBe(100);
    expect(s.account.cashQuote).toBe(100);
    expect(s.account.totalPnlQuote).toBeCloseTo(0, 9);
    expect(s.account.dayPnlQuote).toBeCloseTo(0, 9);
    expect(s.account.dayReturnPct).toBeCloseTo(0, 9);
    expect(s.equityHistory.at(-1)!.skimmed).toBeCloseTo(0, 9);
    // Nogmaals herstarten met dezelfde limiet: de storting van vandaag blijft meetellen
    l = await restart(l, 100);
    s = l.h.engine.snapshot();
    expect(s.account.dayPnlQuote).toBeCloseTo(0, 9);
    expect(s.account.dayReturnPct).toBeCloseTo(0, 9);
    expect(s.halted.halted).toBe(false);
  });

  it("verhogen voorbij wat eerder terugging: alleen het deel erboven is nieuw ingelegd kapitaal", async () => {
    let l = start(100);
    await l.h.engine.tick();
    l = await restart(l, 50);
    l = await restart(l, 200);
    const s = l.h.engine.snapshot();
    expect(s.account.startingEquity).toBe(200);
    expect(s.account.cashQuote).toBe(200);
    expect(s.account.totalPnlQuote).toBeCloseTo(0, 9);
    expect(s.account.dayPnlQuote).toBeCloseTo(0, 9);
    expect(s.account.dayReturnPct).toBeCloseTo(0, 9);
    expect(s.equityHistory.at(-1)!.skimmed).toBeCloseTo(-100, 9);
    expect(l.h.logs().some((m) => m.startsWith("Kapitaallimiet €50,00 → €200,00: €150,00 extra kapitaal"))).toBe(true);
  });
});

// ───────────────────────────── 6. Oud statusbestand ─────────────────────────────

describe("Oud statusbestand (ronde 2) met afgekapte startequity", () => {
  function oldState(over: Partial<PersistedState> = {}): PersistedState & { skimmedToday: number } {
    const now = T0 + 60_000;
    return {
      version: 1,
      mode: "live",
      savedAt: now,
      account: {
        startingEquity: 1e-9,
        cashQuote: 50,
        equity: 50,
        dayStartEquity: 1e-9,
        dayKey: "2026-01-05",
        realizedPnl: 106.79,
        realizedPnlToday: 106.79,
        unrealizedPnl: 0,
        feesPaid: 0,
        tradesToday: 3,
        lastLossAt: {},
      },
      positions: [],
      trades: [],
      equityHistory: [{ time: now - 60_000, equity: 50, skimmed: 106.79 }],
      capitalLimitQuote: 50,
      skimmedQuote: 106.79,
      skimmedToday: 106.79,
      ...over,
    };
  }

  it("startequity ≤ 1e-6 → ingelegd = opgeslagen kapitaallimiet (en dagstart), met een waarschuwing", () => {
    const file = join(tmp(), "state-live.json");
    writeFileSync(file, JSON.stringify(oldState()));
    const h = setup({ mode: "live", startingCapital: 50, deps: { store: new StateStore(file) } });
    const a = h.engine.snapshot().account;
    expect(a.startingEquity).toBe(50);
    expect(a.dayStartEquity).toBe(50);
    expect(a.totalPnlQuote).toBeCloseTo(106.79, 9);
    expect(a.totalReturnPct).toBeCloseTo((106.79 / 50) * 100, 9);
    expect(a.dayPnlQuote).toBeCloseTo(106.79, 9);
    const warn = h.engine.snapshot().logs.find((l) => l.message.startsWith("Oud statusbestand"))!;
    expect(warn.level).toBe("warn");
    expect(warn.message).toContain("kapitaallimiet €50,00");
  });

  it("zonder opgeslagen limiet: de ingestelde limiet; een niet-afgekapt oud bestand gaat zoals voorheen (+ afgeroomd)", () => {
    const file = join(tmp(), "state-live.json");
    const st = oldState();
    delete st.capitalLimitQuote;
    writeFileSync(file, JSON.stringify(st));
    const h = setup({ mode: "live", startingCapital: 60, deps: { store: new StateStore(file) } });
    let a = h.engine.snapshot().account;
    expect(a.startingEquity).toBe(60);
    expect(h.logs().some((m) => m.includes("kapitaallimiet €60,00"))).toBe(true);
    expect(h.logs().some((m) => m.startsWith("Kapitaallimiet €"))).toBe(false); // geen rebase

    const file2 = join(tmp(), "state-live.json");
    writeFileSync(
      file2,
      JSON.stringify(oldState({ account: { ...oldState().account, startingEquity: 38, dayStartEquity: 45 }, skimmedQuote: 12 })),
    );
    const h2 = setup({ mode: "live", startingCapital: 50, deps: { store: new StateStore(file2) } });
    a = h2.engine.snapshot().account;
    expect(a.startingEquity).toBe(50);
    expect(h2.logs().some((m) => m.startsWith("Oud statusbestand"))).toBe(false);
  });
});

// ───────────────────────────── 7. Starten tijdens de noodstop ─────────────────────────────

describe("Starten tijdens de noodstop", () => {
  it("paper: start() tijdens de noodstop weigert; de noodstop eindigt gestopt; daarna mag starten weer", async () => {
    const h = setup();
    await openBtcPosition(h);
    const gate = new Deferred();
    const orig = h.broker.placeMarketOrder.bind(h.broker);
    let waiting = false;
    h.broker.placeMarketOrder = async (req, ref) => {
      waiting = true;
      await gate.promise;
      return orig(req, ref);
    };
    const killing = h.engine.killSwitch();
    await waitFor(() => waiting);
    await expect(h.engine.start()).rejects.toThrow(/^Starten geblokkeerd: noodstop bezig/);
    expect(h.engine.isRunning).toBe(false);
    gate.resolve();
    expect(await killing).toEqual({ closed: 1, failed: [] });
    expect(h.engine.isRunning).toBe(false);
    await h.engine.start();
    expect(h.engine.isRunning).toBe(true);
    await h.engine.stop();
  });
});

