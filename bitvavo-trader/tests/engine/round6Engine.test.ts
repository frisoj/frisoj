/**
 * Ronde 6 (engine): de winstgrens en de verlieslimiet na een herstart (nooit vastzetten op een
 * koers die nog niet bekend is, nooit tegen de grens van gisteren), een verhoogd dagdoel, een
 * dagdoel-verkoop die over de dagwissel heen bleef staan, de dagwissel van een stilstaande bot
 * en de stop-controle op de verse koers als de candles iets ouder zijn (gedeelde feed).
 */
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { DEFAULT_RISK_CONFIG } from "../../src/core/defaults";
import type { Interval, RiskConfig } from "../../src/core/types";
import { BitvavoFeed } from "../../src/data/bitvavoFeed";
import { StateStore } from "../../src/engine/stateStore";
import { BitvavoClient } from "../../src/exchange/bitvavoClient";
import { RiskManager } from "../../src/risk/riskManager";
import { BulkFeed, Clock, Deferred, FakeBroker, FakeFeed, I15, T0, setup, type Harness } from "./helpers";

const DAY = 86_400_000;
let dirs: string[] = [];
afterEach(() => {
  for (const d of dirs) rmSync(d, { recursive: true, force: true });
  dirs = [];
});

function stateFile(): string {
  const d = mkdtempSync(join(tmpdir(), "engine-r6-"));
  dirs.push(d);
  return join(d, "state.json");
}

/** Echte risk manager met dagdoel `target`; AAA-EUR en BBB-EUR op koers 100, ATR 1. */
function harness(
  target: number,
  o: { store?: StateStore; clock?: Clock; mode?: "paper" | "live"; risk?: Partial<RiskConfig>; broker?: FakeBroker } = {},
): Harness {
  const h = setup({
    markets: ["AAA-EUR", "BBB-EUR"],
    startingCapital: 100,
    clock: o.clock,
    mode: o.mode,
    broker: o.broker,
    config: {
      // Koersdoel ver weg (5R), zodat de koersbewegingen in deze tests het niet raken
      risk: { ...DEFAULT_RISK_CONFIG, dailyProfitTargetPct: target, maxSpreadPct: 0, takeProfitR: 5, ...(o.risk ?? {}) } as RiskConfig,
    },
    deps: {
      createRisk: (cfg: RiskConfig, interval: Interval) => new RiskManager(cfg, interval),
      ...(o.store ? { store: o.store } : {}),
    },
  });
  const last = Math.floor(h.clock.t / I15) * I15;
  h.feed.setSeries("AAA-EUR", 100, last);
  h.feed.setSeries("BBB-EUR", 100, last);
  h.signals.atr = 1;
  return h;
}

async function buy(h: Harness, market: string): Promise<void> {
  h.signals.buyMarkets = new Set([market]);
  h.signals.buyAt.add(h.lastClosed());
  await h.engine.tick();
}

/** Koers van `market` (candles én losse koers) onbereikbaar tot `restore()`. */
function priceDown(h: Harness, market: string): { restore: () => void } {
  const orig = h.feed.getPrice.bind(h.feed);
  h.feed.failing.add(market);
  h.feed.getPrice = async (m: string) => {
    if (m === market) throw new Error("timeout");
    return orig(m);
  };
  return {
    restore: () => {
      h.feed.failing.delete(market);
      h.feed.getPrice = orig;
    },
  };
}

const dailyTargetTrades = (h: Harness) => h.engine.snapshot().trades.filter((t) => t.exitReason === "daily-target");

describe("Winstgrens en verlieslimiet na een herstart: nooit op een onbekende koers", () => {
  it("eerste tick zonder koers van de positie: niet vastzetten, niets verkopen; met de koers terug gewoon doorhandelen", async () => {
    const file = stateFile();
    const h1 = harness(1, { store: new StateStore(file) });
    await buy(h1, "AAA-EUR");
    h1.feed.setLast("AAA-EUR", 104); // ruim boven +1% na kosten: grens actief
    await h1.engine.tick();
    expect(h1.engine.snapshot().account.dayTargetReached).toBe(true);
    await h1.engine.stop();

    // Herstart; de beurs geeft even geen koers voor AAA-EUR (candles en losse koers)
    const h2 = harness(1, { store: new StateStore(file), clock: h1.clock });
    h2.feed.setLast("AAA-EUR", 104);
    const down = priceDown(h2, "AAA-EUR");
    await h2.engine.tick();
    let s = h2.engine.snapshot();
    // Tegen de instapkoers lijkt de dag onder de grens: wel voorzichtig (geen aankopen), niet vastgezet
    expect(s.positions).toHaveLength(1);
    expect(s.halted.halted).toBe(true);
    expect(s.halted.dailyTarget).toBeUndefined();
    expect(s.halted.reason).toMatch(/^Dagresultaat nog onbekend: nog geen actuele koers voor AAA-EUR/);
    expect(h2.logs().some((m) => m.startsWith("Dagwinst teruggevallen"))).toBe(false);

    down.restore();
    await h2.engine.tick();
    s = h2.engine.snapshot();
    expect(dailyTargetTrades(h2)).toHaveLength(0);
    expect(s.positions).toHaveLength(1);
    expect(s.halted.halted).toBe(false);
    expect(s.account.dayTargetReached).toBe(true);
    await h2.engine.stop();
    expect(JSON.parse(readFileSync(file, "utf8")).targetDayKey).toBeUndefined();
  });

  it("verlieslimiet: een positie van een eerdere dag zonder koers telt niet als verlies (niet de hele dag gepauzeerd)", async () => {
    const file = stateFile();
    const risk = { takeProfitR: 10, timeStopCandles: 0 }; // koersdoel op 120, geen tijdstop
    const h1 = harness(0, { store: new StateStore(file), risk });
    await buy(h1, "AAA-EUR");
    h1.feed.setLast("AAA-EUR", 112);
    await h1.engine.tick();
    // De volgende dag staat AAA nog 12% boven de instap: de dag begint met die waarde
    h1.clock.advance(DAY);
    const last = Math.floor(h1.clock.t / I15) * I15;
    h1.feed.setSeries("AAA-EUR", 112, last);
    h1.feed.setSeries("BBB-EUR", 100, last);
    await h1.engine.tick();
    let s = h1.engine.snapshot();
    expect(s.positions).toHaveLength(1);
    expect(s.account.dayKey).toBe("2026-01-06");
    expect(s.account.dayReturnPct).toBeCloseTo(0, 6);
    await h1.engine.stop();

    // Herstart op dezelfde dag, koers even onbekend: tegen de instapkoers (100) lijkt het een flink dagverlies
    const h2 = harness(0, { store: new StateStore(file), clock: h1.clock, risk: { ...risk, dailyLossLimitPct: 3 } });
    h2.feed.setSeries("AAA-EUR", 112, last);
    const down = priceDown(h2, "AAA-EUR");
    expect(h2.engine.snapshot().account.dayReturnPct).toBeLessThan(-3);
    await h2.engine.tick();
    s = h2.engine.snapshot();
    expect(s.halted.halted).toBe(true);
    expect(s.halted.dailyLimit).toBe(false);
    expect(s.halted.reason).toMatch(/^Dagresultaat nog onbekend/);

    down.restore();
    await h2.engine.tick();
    s = h2.engine.snapshot();
    expect(s.account.dayReturnPct).toBeCloseTo(0, 6);
    expect(s.halted.halted).toBe(false);
    expect(h2.logs().some((m) => m.includes("verlieslimiet"))).toBe(false);
    await h2.engine.stop();
    expect(JSON.parse(readFileSync(file, "utf8")).haltedDayKey).toBeUndefined();
  });

  it("herstart de volgende ochtend met uitgestelde dagwissel: niet verkopen tegen de winstgrens van gisteren", async () => {
    const file = stateFile();
    const h1 = harness(1, { store: new StateStore(file) });
    await buy(h1, "AAA-EUR");
    h1.feed.setLast("AAA-EUR", 104);
    await h1.engine.tick();
    expect(h1.engine.snapshot().account.dayTargetReached).toBe(true);
    await h1.engine.stop();

    const clock = new Clock(h1.clock.t + DAY);
    const h2 = harness(1, { store: new StateStore(file), clock });
    // Vandaag iets onder de grens van gisteren; de losse koers faalt (dagwissel uitgesteld), de candles niet
    h2.feed.setSeries("AAA-EUR", 102.3, Math.floor(clock.t / I15) * I15);
    const orig = h2.feed.getPrice.bind(h2.feed);
    h2.feed.getPrice = async (m: string) => {
      if (m === "AAA-EUR") throw new Error("429 rate limit");
      return orig(m);
    };
    await h2.engine.tick();
    let s = h2.engine.snapshot();
    expect(s.account.dayKey).toBe("2026-01-05"); // uitgesteld (bestaand gedrag)
    expect(dailyTargetTrades(h2)).toHaveLength(0);
    expect(s.positions).toHaveLength(1);
    expect(s.halted.dailyTarget).toBeUndefined();
    expect(h2.logs().some((m) => m.startsWith("Dagwinst teruggevallen"))).toBe(false);

    h2.feed.getPrice = orig;
    clock.advance(15_000);
    await h2.engine.tick();
    s = h2.engine.snapshot();
    expect(s.account.dayKey).toBe("2026-01-06");
    expect(dailyTargetTrades(h2)).toHaveLength(0);
    expect(s.positions).toHaveLength(1);
    expect(s.halted.halted).toBe(false);
    expect(s.account.dayTargetReached).toBe(false);
  });

  it("koersbewaking die pas na Start klaar is: een positie zonder koers krijgt die echte koers toch", async () => {
    const file = stateFile();
    const h1 = harness(1, { store: new StateStore(file) });
    await buy(h1, "AAA-EUR");
    h1.feed.setLast("AAA-EUR", 104);
    await h1.engine.tick();
    await h1.engine.stop();

    const h2 = harness(1, { store: new StateStore(file), clock: h1.clock });
    h2.feed.setLast("AAA-EUR", 104);
    const gate = new Deferred();
    const orig = h2.feed.getPrice.bind(h2.feed);
    h2.feed.getPrice = async (m: string) => {
      await gate.promise;
      return orig(m);
    };
    const monitor = h2.engine.startPriceMonitor(); // wacht op de (trage) koers
    h2.feed.failing.add("AAA-EUR"); // de tick krijgt zelf geen candles
    await h2.engine.start();
    h2.engine.stopPriceMonitor();
    expect(h2.engine.snapshot().positions[0].currentPrice).toBe(h2.engine.snapshot().positions[0].entryPrice);
    gate.resolve();
    await monitor;
    const s = h2.engine.snapshot();
    expect(s.prices["AAA-EUR"]).toBe(104);
    expect(s.positions[0].currentPrice).toBe(104);
    expect(dailyTargetTrades(h2)).toHaveLength(0);
    await h2.engine.stop();
  });
});

describe("Dagdoel verhogen terwijl de winstgrens al actief is", () => {
  it("verkoopt niet en zet niets vast; de grens gaat pas weer aan bij het nieuwe doel (ook na een herstart)", async () => {
    const file = stateFile();
    const h = harness(1, { store: new StateStore(file) });
    await buy(h, "AAA-EUR");
    h.feed.setLast("AAA-EUR", 104); // ~+1,6% na kosten
    await h.engine.tick();
    expect(h.engine.snapshot().account.dayTargetReached).toBe(true);

    const risk = h.engine.snapshot().config.risk;
    h.engine.updateConfig({ risk: { ...risk, dailyProfitTargetPct: 3 } });
    expect(h.engine.snapshot().account.dayTargetReached).toBe(false);
    expect(h.logs().some((m) => m.startsWith("Dagdoel verhoogd naar +3%"))).toBe(true);
    // Meteen opgeslagen: een herstart brengt de oude grens niet terug
    expect(JSON.parse(readFileSync(file, "utf8")).targetArmedDayKey).toBeUndefined();

    await h.engine.tick(); // koers onveranderd
    let s = h.engine.snapshot();
    expect(dailyTargetTrades(h)).toHaveLength(0);
    expect(s.positions).toHaveLength(1);
    expect(s.halted.halted).toBe(false);
    expect(s.account.dayTargetReached).toBe(false);

    // Het nieuwe doel gehaald → grens weer aan; terugval → vastzetten
    h.feed.setLast("AAA-EUR", 109); // koersdoel ligt op 110
    await h.engine.tick();
    expect(h.engine.snapshot().positions).toHaveLength(1);
    expect(h.engine.snapshot().account.dayTargetReached).toBe(true);
    // Verlagen houdt de grens aan (het lagere doel is vandaag al gehaald)
    h.engine.updateConfig({ risk: { ...h.engine.snapshot().config.risk, dailyProfitTargetPct: 2 } });
    expect(h.engine.snapshot().account.dayTargetReached).toBe(true);
    h.feed.setLast("AAA-EUR", 103);
    await h.engine.tick();
    s = h.engine.snapshot();
    expect(s.halted).toMatchObject({ halted: true, dailyTarget: true });
    expect(dailyTargetTrades(h)).toHaveLength(1);
  });
});

describe("Een dagdoel-verkoop die niet lukte vervalt bij de dagwissel", () => {
  it("paper: geweigerde verkoop van gisteren gebeurt vandaag niet als 'dagdoel'; de positie wordt weer gewoon bewaakt", async () => {
    const h = harness(1);
    await buy(h, "AAA-EUR");
    h.feed.setLast("AAA-EUR", 104);
    await h.engine.tick();
    h.broker.rejectSells = 1000; // elke verkoop geweigerd (bijv. markt in onderhoud)
    h.feed.setLast("AAA-EUR", 102);
    await h.engine.tick();
    expect(h.engine.snapshot().halted).toMatchObject({ halted: true, dailyTarget: true });
    expect(h.broker.sells().length).toBeGreaterThan(0);

    // Vandaag (boven de stops) is het doel niet gehaald
    h.clock.advance(DAY);
    const last = Math.floor(h.clock.t / I15) * I15;
    h.feed.setSeries("AAA-EUR", 103, last);
    h.feed.setSeries("BBB-EUR", 100, last);
    await h.engine.tick(); // dagwissel
    let s = h.engine.snapshot();
    expect(s.account.dayKey).toBe("2026-01-06");
    expect(s.halted.halted).toBe(false);
    expect(h.logs().some((m) => m.startsWith("Verkoop om de winst van gisteren vast te zetten vervalt voor AAA-EUR"))).toBe(true);

    h.broker.rejectSells = 0;
    const sellsBefore = h.broker.sells().length;
    await h.engine.tick();
    s = h.engine.snapshot();
    expect(h.broker.sells()).toHaveLength(sellsBefore);
    expect(s.positions).toHaveLength(1);
    expect(dailyTargetTrades(h)).toHaveLength(0);
  });

  it("live: 'zou verkopen' van gisteren (niet gearmd) stuurt na armen vandaag geen echte order", async () => {
    const h = harness(1, { mode: "live" });
    h.engine.arm();
    await buy(h, "AAA-EUR");
    h.feed.setLast("AAA-EUR", 104);
    await h.engine.tick();
    h.engine.disarm();
    h.feed.setLast("AAA-EUR", 102);
    await h.engine.tick(); // grens geraakt → zou verkopen
    expect(h.engine.snapshot().halted).toMatchObject({ halted: true, dailyTarget: true });
    expect(h.broker.sells()).toHaveLength(0);

    h.clock.advance(DAY);
    const last = Math.floor(h.clock.t / I15) * I15;
    h.feed.setSeries("AAA-EUR", 103, last); // boven de stops; vandaag is het doel niet gehaald
    h.feed.setSeries("BBB-EUR", 100, last);
    await h.engine.tick();
    expect(h.engine.snapshot().account.dayKey).toBe("2026-01-06");
    expect(h.engine.snapshot().account.dayTargetReached).toBe(false);
    h.engine.arm();
    await h.engine.tick();
    expect(h.broker.sells()).toHaveLength(0);
    expect(dailyTargetTrades(h)).toHaveLength(0);
    expect(h.engine.snapshot().positions).toHaveLength(1);
  });
});

describe("Stilstaande bot: dagwissel via de koersbewaking", () => {
  it("na 'winst vastgezet' en Stop toont de bot de volgende dag geen cijfers en pauze van gisteren", async () => {
    const h = harness(1);
    await buy(h, "AAA-EUR");
    h.feed.setLast("AAA-EUR", 104);
    await h.engine.tick();
    h.feed.setLast("AAA-EUR", 102);
    await h.engine.tick(); // vastgezet en verkocht
    let s = h.engine.snapshot();
    expect(s.halted).toMatchObject({ halted: true, dailyTarget: true });
    expect(s.account.tradesToday).toBeGreaterThan(0);
    await h.engine.stop();

    h.clock.advance(DAY);
    await h.engine.startPriceMonitor();
    h.engine.stopPriceMonitor();
    s = h.engine.snapshot();
    expect(s.running).toBe(false);
    expect(s.account.dayKey).toBe("2026-01-06");
    expect(s.account.tradesToday).toBe(0);
    expect(s.account.dayPnlQuote).toBeCloseTo(0, 9);
    expect(s.halted.halted).toBe(false);
    expect(s.account.dayTargetReached).toBe(false);
  });
});

describe("Stop-controle op de verse koers van alle markten", () => {
  it("candles iets ouder (koers nog boven de stop), verse koers eronder → in dezelfde tick verkocht", async () => {
    const feed = new BulkFeed();
    feed.setSeries("AAA-EUR", 100, T0);
    const h = setup({ feed, markets: ["AAA-EUR"], startingCapital: 1000 });
    h.risk.stopDist = 5;
    h.risk.tpDist = 50;
    h.signals.buyAt.add(h.lastClosed());
    await h.engine.tick();
    expect(h.engine.snapshot().positions).toHaveLength(1);

    feed.priceOverride.set("AAA-EUR", 80); // de candles tonen nog 100
    h.clock.advance(15_000);
    await h.engine.tick();
    expect(h.broker.sells()).toHaveLength(1);
    expect(h.engine.snapshot().trades[0]).toMatchObject({ market: "AAA-EUR", exitReason: "stop-loss" });
  });

  it("een verkoop die deze tick al geprobeerd is, wordt niet nog eens geprobeerd", async () => {
    const feed = new BulkFeed();
    feed.setSeries("AAA-EUR", 100, T0);
    const h = setup({ feed, markets: ["AAA-EUR"], startingCapital: 1000 });
    h.risk.stopDist = 5;
    h.signals.buyAt.add(h.lastClosed());
    await h.engine.tick();
    h.broker.rejectSells = 1000;
    feed.setLast("AAA-EUR", 90, { low: 90 });
    h.clock.advance(15_000);
    await h.engine.tick();
    expect(h.broker.sells()).toHaveLength(1);
  });

  it("gedeelde BitvavoFeed: een andere bot haalde vlak vóór de crash candles op → de stop gaat toch direct", async () => {
    // Nep-Bitvavo (publieke endpoints); de koers van AAA-EUR hangt af van de klok.
    const T = Math.floor((T0 + 3 * I15) / I15) * I15; // sluiting van een 15m-candle
    const clock = new Clock(T - 60_000);
    let crashFrom = Number.POSITIVE_INFINITY;
    const px = () => (clock.t >= crashFrom ? 85 : 100);
    const fetchImpl = (async (input: string | URL | Request) => {
      const url = new URL(String(input));
      const headers = { "bitvavo-ratelimit-remaining": "900", "bitvavo-ratelimit-resetat": String(clock.t + 60_000) };
      let body: unknown = [];
      if (url.pathname === "/v2/markets") {
        body = [{ market: "AAA-EUR", base: "AAA", quote: "EUR", status: "trading", minOrderInQuoteAsset: "5", pricePrecision: 5 }];
      } else if (url.pathname === "/v2/AAA-EUR/candles") {
        const last = Math.floor(clock.t / I15) * I15;
        body = Array.from({ length: 300 }, (_, i) => {
          const t = last - i * I15;
          const p = i === 0 ? px() : 100;
          return [t, "100", "100", String(p), String(p), "5"];
        });
      } else if (url.pathname === "/v2/ticker/price") {
        body = url.searchParams.get("market")
          ? { market: "AAA-EUR", price: String(px()) }
          : [{ market: "AAA-EUR", price: String(px()) }];
      } else if (url.pathname === "/v2/AAA-EUR/book") {
        body = { market: "AAA-EUR", bids: [["99.99", "1"]], asks: [["100.01", "1"]] };
      }
      return new Response(JSON.stringify(body), { status: 200, headers });
    }) as typeof fetch;
    const client = new BitvavoClient({ fetchImpl, now: clock.now, sleep: async () => {} });
    const shared = new BitvavoFeed(client, { now: clock.now }) as unknown as FakeFeed;
    const mk = () => {
      const h = setup({ feed: shared, markets: ["AAA-EUR"], clock, startingCapital: 1000 });
      h.risk.stopDist = 5; // stop op 95
      h.risk.tpDist = 50;
      return h;
    };
    const a = mk(); // "paper"-bot
    const b = mk(); // de bot met de stop die moet gaan
    a.signals.buyAt.add(T - 2 * I15);
    b.signals.buyAt.add(T - 2 * I15);
    await a.engine.tick();
    await b.engine.tick();
    expect(a.engine.snapshot().positions).toHaveLength(1);
    expect(b.engine.snapshot().positions).toHaveLength(1);

    clock.set(T - 3_000);
    await a.engine.tick(); // haalt de candles op (nog 100)
    crashFrom = T - 2_000; // crash naar 85 (onder de stop van 95)
    clock.set(T + 1_000);
    await b.engine.tick();
    expect(b.broker.sells()).toHaveLength(1);
    expect(b.engine.snapshot().trades[0]).toMatchObject({ exitReason: "stop-loss" });
  });
});
