/**
 * v2 — veel munten: automatische muntkeuze, rondes over meerdere ticks, kansen-ranglijst,
 * trendfilter (markt + munt), spreadlimiet, munten-radar en snapshot-uitbreidingen.
 * Zie docs/ARCHITECTURE.md, sectie "v2 — Veel munten".
 */
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_ENSEMBLE_CONFIG, DEFAULT_RISK_CONFIG } from "../../src/core/defaults";
import type { EngineConfig, Interval, RadarRow, RiskConfig, TradingMode, TrendFilterConfig } from "../../src/core/types";
import { StateStore } from "../../src/engine/stateStore";
import {
  ENTRY_ROUND_MAX_WAIT_MS,
  FETCH_RETRY_MS,
  SCAN_BATCH_PER_TICK,
  SCAN_CONCURRENCY,
  SNAPSHOT_DECISIONS_LIMIT,
  TICKERS_REFRESH_MS,
  TREND_RETRY_MS,
  UNIVERSE_REFRESH_MS,
  type EngineDeps,
} from "../../src/engine/tradingEngine";
import { BulkFeed, Clock, FakeFeed, I15, T0, marketInfo, setup, ticker, type Harness } from "./helpers";

const DAY = 86_400_000;
/** 5 januari 2026 00:00 UTC: de dagcandle die bij T0 nog in vorming is */
const DAY0 = Math.floor(T0 / DAY) * DAY;
/** Ronde bij de standaardklok (T0 + 1 min): de nieuwste gesloten 15m-candle */
const R0 = T0 - I15;

let dirs: string[] = [];
afterEach(() => {
  vi.useRealTimers();
  for (const d of dirs) rmSync(d, { recursive: true, force: true });
  dirs = [];
});
function tmpFile(): string {
  const d = mkdtempSync(join(tmpdir(), "engine-v2-"));
  dirs.push(d);
  return join(d, "state.json");
}

function names(n: number): string[] {
  return Array.from({ length: n }, (_, i) => `M${String(i + 1).padStart(3, "0")}-EUR`);
}

interface V2Opts {
  feed?: FakeFeed;
  config?: Partial<EngineConfig>;
  risk?: Partial<RiskConfig>;
  deps?: Partial<EngineDeps>;
  mode?: TradingMode;
  clock?: Clock;
  startingCapital?: number;
}

/** Engine met (standaard) een feed mét getPrices; elke markt zonder reeks krijgt koers 100. */
function v2(markets: string[], o: V2Opts = {}): Harness {
  const feed = o.feed ?? new BulkFeed();
  for (const m of markets) if (!feed.series.has(m)) feed.setSeries(m, 100, T0);
  const h = setup({
    feed,
    markets,
    mode: o.mode,
    clock: o.clock,
    deps: o.deps,
    startingCapital: o.startingCapital ?? 1000,
    config: { ...(o.config ?? {}), ...(o.risk ? { risk: { ...DEFAULT_RISK_CONFIG, ...o.risk } } : {}) },
  });
  h.risk.quote = 20;
  h.risk.stopDist = 5;
  h.risk.tpDist = 10;
  return h;
}

const calls = (h: Harness, market: string, interval: Interval = "15m") =>
  h.feed.calls.filter((c) => c.market === market && c.interval === interval).length;
const row = (h: Harness, market: string): RadarRow => h.engine.snapshot().radar!.find((r) => r.market === market)!;
const allLogs = (h: Harness): string[] => h.of("log").map((l) => l.message as string);
const bought = (h: Harness) => h.broker.buys().map((o) => o.req.market);

function tf(o: Partial<TrendFilterConfig> = {}): TrendFilterConfig {
  return { market: true, coin: false, interval: "1d", period: 5, ...o };
}
/** 12 dagcandles; de laatste (DAY0) is nog in vorming en telt niet mee. */
function daily(feed: FakeFeed, market: string, dir: "up" | "down", forming = 100): void {
  const closes = Array.from({ length: 11 }, (_, i) => (dir === "down" ? 200 - i * 10 : 100 + i * 10));
  feed.setIntervalSeries(market, "1d", [...closes, forming], DAY0, DAY);
}

// ───────────────────────────── Automatische muntkeuze ─────────────────────────────

describe("Automatische muntkeuze", () => {
  function autoFeed(): BulkFeed {
    const feed = new BulkFeed();
    for (const m of ["BTC-EUR", "ETH-EUR", "SOL-EUR", "XRP-EUR", "ADA-EUR"]) feed.setSeries(m, 100, T0);
    feed.extraMarkets = [marketInfo("USDC-EUR")];
    feed.tickers = [
      ticker("BTC-EUR", { volumeQuote: 9e6 }),
      ticker("ETH-EUR", { volumeQuote: 8e6 }),
      ticker("USDC-EUR", { volumeQuote: 7.5e6 }),
      ticker("SOL-EUR", { volumeQuote: 7e6 }),
      ticker("XRP-EUR", { volumeQuote: 6e6 }),
      ticker("ADA-EUR", { volumeQuote: 1e3 }),
    ];
    return feed;
  }
  const AUTO3 = { universe: { mode: "auto" as const, count: 3, minVolumeEur: 1e4 } };

  it("kiest de munten met het meeste volume (geen stablecoins), logt de wijziging en koopt alleen daarin", async () => {
    const feed = autoFeed();
    const h = v2(["ADA-EUR"], { feed, config: AUTO3 });
    h.signals.buyAt.add(h.lastClosed()); // alle markten geven een koopsignaal
    await h.engine.tick();
    const s = h.engine.snapshot();
    expect(s.activeMarkets).toEqual(["BTC-EUR", "ETH-EUR", "SOL-EUR"]);
    expect(s.config.markets).toEqual(["ADA-EUR"]); // de eigen lijst blijft staan
    expect(s.universe).toEqual({ mode: "auto", count: 3, requested: 3, updatedAt: h.clock.t, eligible: 4, excluded: 2 });
    expect(allLogs(h).filter((m) => m.startsWith("Automatische muntkeuze"))).toEqual([
      "Automatische muntkeuze: 3 munten (meeste handel) — erbij: BTC, ETH, SOL; eraf: ADA",
    ]);
    // Alleen actieve markten worden opgehaald en gekocht (max. 2 posities: de liquidste eerst)
    expect(new Set(h.feed.calls.map((c) => c.market))).toEqual(new Set(["BTC-EUR", "ETH-EUR", "SOL-EUR"]));
    expect(bought(h)).toEqual(["BTC-EUR", "ETH-EUR"]);
    expect(row(h, "SOL-EUR")).toMatchObject({
      status: "candidate",
      rank: 3,
      note: "Koopsignaal, maar geen vrije plek (max. 2 posities)",
    });
    expect(s.radar!.map((r) => r.market)).toEqual(["BTC-EUR", "ETH-EUR", "SOL-EUR"]);
  });

  it("kiest elk uur opnieuw (niet vaker); nieuwe instellingen dwingen meteen een nieuwe keuze af", async () => {
    const feed = autoFeed();
    const h = v2(["ADA-EUR"], { feed, config: AUTO3 });
    await h.engine.tick();
    const first = h.clock.t;
    feed.tickers = [...feed.tickers, ticker("XRP-EUR", { volumeQuote: 10e6 })]; // XRP nu de grootste
    h.clock.advance(30 * 60_000);
    await h.engine.tick();
    expect(h.engine.snapshot().universe!.updatedAt).toBe(first);
    expect(h.engine.snapshot().activeMarkets).toEqual(["BTC-EUR", "ETH-EUR", "SOL-EUR"]);

    h.clock.set(first + UNIVERSE_REFRESH_MS);
    await h.engine.tick();
    expect(h.engine.snapshot().activeMarkets).toEqual(["XRP-EUR", "BTC-EUR", "ETH-EUR"]);
    expect(h.engine.snapshot().universe!.updatedAt).toBe(h.clock.t);
    expect(allLogs(h).filter((m) => m.startsWith("Automatische muntkeuze")).at(-1)).toBe(
      "Automatische muntkeuze: 3 munten (meeste handel) — erbij: XRP; eraf: SOL",
    );

    // Gedeeltelijke universe-wijziging: veld voor veld samengevoegd, volgende tick opnieuw kiezen
    const cfg = h.engine.updateConfig({ universe: { count: 2 } } as unknown as Partial<EngineConfig>);
    expect(cfg.universe).toEqual({ mode: "auto", count: 2, minVolumeEur: 1e4 });
    h.clock.advance(15_000);
    await h.engine.tick();
    expect(h.engine.snapshot().activeMarkets).toEqual(["XRP-EUR", "BTC-EUR"]);
    expect(allLogs(h).some((m) => m === "Automatische muntkeuze: 2 munten (meeste handel) — eraf: ETH")).toBe(true);

    // Terug naar zelf kiezen: meteen de eigen lijst (geen tick nodig)
    h.engine.updateConfig({ universe: { mode: "manual" } } as unknown as Partial<EngineConfig>);
    expect(h.engine.snapshot().activeMarkets).toEqual(["ADA-EUR"]);
    expect(h.engine.snapshot().universe).toEqual({ mode: "manual", count: 1, requested: 1, updatedAt: null });
  });

  it("bewaart de keuze: na een herstart (< 24 uur) meteen dezelfde munten, ook als kiezen dan mislukt; ouder → eigen lijst", async () => {
    const file = tmpFile();
    const feed = autoFeed();
    const h1 = v2(["ADA-EUR"], { feed, config: AUTO3, deps: { store: new StateStore(file) } });
    await h1.engine.tick();
    const at = h1.clock.t;
    await h1.engine.stop();
    const saved = JSON.parse(readFileSync(file, "utf8"));
    expect(saved.autoUniverse).toEqual({ markets: ["BTC-EUR", "ETH-EUR", "SOL-EUR"], at });

    feed.marketsFail = true; // Bitvavo even onbereikbaar voor de marktlijst
    const h2 = v2(["ADA-EUR"], { feed, clock: h1.clock, config: AUTO3, deps: { store: new StateStore(file) } });
    let s = h2.engine.snapshot();
    expect(s.activeMarkets).toEqual(["BTC-EUR", "ETH-EUR", "SOL-EUR"]);
    expect(s.universe).toMatchObject({ mode: "auto", count: 3, requested: 3, updatedAt: at });
    expect(s.universe!.note).toMatch(/^Opgeslagen automatische keuze/);
    h2.clock.advance(60_000);
    await h2.engine.tick();
    h2.clock.advance(15_000);
    await h2.engine.tick(); // geen nieuwe poging binnen een minuut
    s = h2.engine.snapshot();
    expect(s.activeMarkets).toEqual(["BTC-EUR", "ETH-EUR", "SOL-EUR"]);
    const why = "Automatische muntkeuze mislukt: markets down — de bot gebruikt de opgeslagen keuze (3 munten)";
    expect(s.universe!.note).toBe(why);
    expect(allLogs(h2).filter((m) => m === why)).toHaveLength(1);
    expect(s.logs.find((l) => l.message === why)!.level).toBe("warn");
    await h2.engine.stop();

    // Ouder dan 24 uur: de eigen lijst tot de eerste nieuwe keuze
    const h3 = v2(["ADA-EUR"], {
      feed,
      clock: new Clock(at + 25 * 3_600_000),
      config: AUTO3,
      deps: { store: new StateStore(file) },
    });
    s = h3.engine.snapshot();
    expect(s.activeMarkets).toEqual(["ADA-EUR"]);
    expect(s.universe!.note).toMatch(/^Nog geen automatische keuze/);
  });

  it("lege keuze (niets voldoet aan de filters) → vorige set houden, met uitleg", async () => {
    const feed = autoFeed();
    const h = v2(["ADA-EUR"], { feed, config: AUTO3 });
    await h.engine.tick();
    h.engine.updateConfig({ universe: { mode: "auto", count: 3, minVolumeEur: 1e12 } });
    h.clock.advance(15_000);
    await h.engine.tick();
    const s = h.engine.snapshot();
    expect(s.activeMarkets).toEqual(["BTC-EUR", "ETH-EUR", "SOL-EUR"]);
    expect(s.universe!.note).toMatch(/^Automatische muntkeuze mislukt: geen munten die aan de filters voldoen .* de bot gebruikt de vorige keuze \(3 munten\)$/);
  });

  it("updateConfig valideert muntkeuze en trendfilter en voegt ze veld voor veld samen", () => {
    const h = v2(["AAA-EUR"]);
    expect(() => h.engine.updateConfig({ universe: { mode: "auto", count: 0, minVolumeEur: 0 } })).toThrow(/aantal munten/);
    expect(() => h.engine.updateConfig({ universe: { mode: "x" } } as unknown as Partial<EngineConfig>)).toThrow(/Ongeldige muntkeuze/);
    expect(() =>
      h.engine.updateConfig({ ensemble: { trendFilter: { period: 3 } } } as unknown as Partial<EngineConfig>),
    ).toThrow(/periode/);
    expect(() => h.engine.updateConfig({ risk: { maxSpreadPct: -1 } } as unknown as Partial<EngineConfig>)).toThrow(/spread/);
    expect(() => h.engine.updateConfig({ markets: names(401) })).toThrow(/hooguit 400/);
    expect(h.engine.snapshot().config.universe).toEqual({ mode: "manual", count: 30, minVolumeEur: 0 });
    const cfg = h.engine.updateConfig({ ensemble: { trendFilter: { coin: true } } } as unknown as Partial<EngineConfig>);
    expect(cfg.ensemble.trendFilter).toEqual({ market: false, coin: true, interval: "1d", period: 50 });
    expect(cfg.ensemble.buyThreshold).toBe(0.35);
  });
});

// ───────────────────────────── Kansenronde ─────────────────────────────

describe("Kansenronde (ranglijst)", () => {
  it("te weinig plekken: het sterkste signaal gaat voor (score, dan relatieve sterkte t.o.v. Bitcoin)", async () => {
    const m = ["AAA-EUR", "BBB-EUR", "CCC-EUR", "DDD-EUR"];
    const h = v2(m, { risk: { maxOpenPositions: 1 } });
    h.feed.tickers = [
      ticker("BBB-EUR", { changePct: 5 }),
      ticker("CCC-EUR", { changePct: 2 }),
      ticker("BTC-EUR", { changePct: 1 }),
    ];
    // BBB en CCC in hetzelfde score-stapje (0,60 / 0,61): BBB doet het beter dan Bitcoin (+4 t.o.v. +1)
    h.signals.scores = new Map([
      ["AAA-EUR", 0.4],
      ["BBB-EUR", 0.6],
      ["CCC-EUR", 0.61],
      ["DDD-EUR", 0.45],
    ]);
    h.signals.buyAt.add(h.lastClosed());
    await h.engine.tick();
    expect(bought(h)).toEqual(["BBB-EUR"]); // vóór v2 zou AAA (eerste in de lijst) gekocht zijn
    const free = "Koopsignaal, maar geen vrije plek (max. 1 positie)";
    expect(row(h, "BBB-EUR").status).toBe("position");
    expect(row(h, "CCC-EUR")).toMatchObject({ status: "candidate", rank: 2, note: free });
    expect(row(h, "DDD-EUR")).toMatchObject({ status: "candidate", rank: 3, note: free });
    expect(row(h, "AAA-EUR")).toMatchObject({ status: "candidate", rank: 4, note: free });
    expect(h.risk.planCalls.map((c) => c.market?.market)).toEqual(["BBB-EUR"]);
    expect(h.engine.snapshot().scan).toMatchObject({ done: 4, total: 4, roundStartedAt: null, lastRoundCompletedAt: h.clock.t, candidates: 4 });
  });

  it("gelijke score en sterkte: meer 24h-volume eerst", async () => {
    const h = v2(["AAA-EUR", "BBB-EUR"], { risk: { maxOpenPositions: 1 } });
    h.feed.tickers = [ticker("AAA-EUR", { volumeQuote: 1e6 }), ticker("BBB-EUR", { volumeQuote: 5e6 })];
    h.signals.buyAt.add(h.lastClosed());
    await h.engine.tick();
    expect(bought(h)).toEqual(["BBB-EUR"]);
  });

  it("afgewezen door risicobeheer → 'tegengehouden' met de reden, en de volgende kandidaat krijgt de plek", async () => {
    const h = v2(["AAA-EUR", "BBB-EUR"], { risk: { maxOpenPositions: 1 } });
    h.signals.scores.set("AAA-EUR", 0.9);
    h.signals.buyAt.add(h.lastClosed());
    const plan = h.risk.planEntry.bind(h.risk);
    h.risk.planEntry = (d, a, info, now) => {
      const p = plan(d, a, info, now);
      return d.market === "AAA-EUR" ? { ...p, approved: false, reasons: ["Cooldown na verlies"], quoteAmount: 0 } : p;
    };
    await h.engine.tick();
    expect(bought(h)).toEqual(["BBB-EUR"]);
    expect(row(h, "AAA-EUR")).toMatchObject({ status: "blocked", rank: 1, note: "Cooldown na verlies" });
    expect(allLogs(h).filter((l) => l.startsWith("Geen koop AAA-EUR (score 0,90"))).toHaveLength(1);
  });

  it("live niet gearmd: 'zou kopen' telt als plek, dus hooguit maxOpenPositions meldingen", async () => {
    const h = v2(["AAA-EUR", "BBB-EUR", "CCC-EUR"], { mode: "live" });
    h.signals.buyAt.add(h.lastClosed());
    await h.engine.tick();
    expect(h.broker.orders).toHaveLength(0);
    expect(allLogs(h).filter((l) => l.startsWith("Live mode niet gearmd: zou kopen"))).toHaveLength(2);
    expect(row(h, "AAA-EUR")).toMatchObject({ status: "blocked", note: expect.stringMatching(/^Live niet gearmd/) });
    expect(row(h, "CCC-EUR")).toMatchObject({ status: "candidate", note: "Koopsignaal, maar geen vrije plek (max. 2 posities)" });
  });

  it("verlopen koopsignaal (candle te lang geleden gesloten) wordt niet meer gekocht", async () => {
    const h = v2(["AAA-EUR", "OLD-EUR"]);
    const oldTime = T0 - 3 * I15;
    h.feed.setSeries("OLD-EUR", 100, oldTime); // nieuwste gesloten candle is 3 candles oud
    h.signals.buyMarkets = new Set(["OLD-EUR"]);
    h.signals.buyAt.add(oldTime);
    await h.engine.tick();
    expect(h.of("decision").find((d) => d.market === "OLD-EUR")).toMatchObject({ action: "buy", time: oldTime });
    expect(h.broker.orders).toHaveLength(0);
    expect(h.risk.planCalls).toHaveLength(0);
    expect(row(h, "OLD-EUR")).toMatchObject({ status: "blocked", note: expect.stringContaining("verlopen") });
  });
});

// ───────────────────────────── Rondes over meerdere ticks ─────────────────────────────

describe("Rondes: meer markten dan één batch", () => {
  it("de ronde loopt over meerdere ticks; pas als alle markten beoordeeld zijn wordt de beste gekocht", async () => {
    const markets = names(100);
    const h = v2(markets, { risk: { maxOpenPositions: 1 } });
    h.signals.buyMarkets = new Set(["M005-EUR", "M095-EUR"]);
    h.signals.scores = new Map([
      ["M005-EUR", 0.5],
      ["M095-EUR", 0.9],
    ]);
    h.signals.buyAt.add(h.lastClosed());
    await h.engine.tick();
    const t1 = h.clock.t;
    expect(new Set(h.feed.calls.map((c) => c.market))).toEqual(new Set(markets.slice(0, SCAN_BATCH_PER_TICK)));
    expect(h.broker.orders).toHaveLength(0);
    let s = h.engine.snapshot();
    expect(s.scan).toEqual({ done: 80, total: 100, roundStartedAt: t1, lastRoundCompletedAt: null, candidates: 0 });
    expect(row(h, "M005-EUR")).toMatchObject({ status: "candidate", note: "Koopsignaal: wacht tot alle munten beoordeeld zijn" });
    expect(row(h, "M090-EUR")).toMatchObject({ status: "pending", action: null });

    h.clock.advance(15_000);
    await h.engine.tick();
    expect(h.feed.calls).toHaveLength(100);
    expect(bought(h)).toEqual(["M095-EUR"]);
    s = h.engine.snapshot();
    expect(s.scan).toEqual({ done: 100, total: 100, roundStartedAt: null, lastRoundCompletedAt: h.clock.t, candidates: 2 });
    expect(row(h, "M005-EUR")).toMatchObject({ status: "candidate", rank: 2, note: "Koopsignaal, maar geen vrije plek (max. 1 positie)" });

    // Ronde klaar: alleen de positie-markt wordt nog elke tick opgehaald
    h.clock.advance(15_000);
    await h.engine.tick();
    expect(h.feed.calls).toHaveLength(101);
    expect(h.feed.calls.at(-1)!.market).toBe("M095-EUR");
  });

  it(`uiterlijk ${ENTRY_ROUND_MAX_WAIT_MS / 1000} s na het begin van de ronde wordt er toch gekocht`, async () => {
    const h = v2(names(250));
    h.signals.buyMarkets = new Set(["M010-EUR", "M245-EUR"]);
    h.signals.buyAt.add(h.lastClosed());
    await h.engine.tick(); // 80
    h.clock.advance(60_000);
    await h.engine.tick(); // 160
    expect(h.broker.orders).toHaveLength(0);
    h.clock.advance(ENTRY_ROUND_MAX_WAIT_MS - 60_000);
    await h.engine.tick(); // 240, ronde nog niet rond maar de wachttijd is voorbij
    expect(bought(h)).toEqual(["M010-EUR"]);
    expect(h.engine.snapshot().scan).toMatchObject({ done: 240, total: 250, candidates: 1 });
    h.clock.advance(15_000);
    await h.engine.tick(); // laatste 10: M245 wordt meteen verwerkt
    expect(bought(h)).toEqual(["M010-EUR", "M245-EUR"]);
    expect(h.engine.snapshot().scan).toMatchObject({ done: 250, roundStartedAt: null, candidates: 2 });
  });

  it(`haalt hooguit ${SCAN_CONCURRENCY} markten tegelijk op, maar verwerkt ze op volgorde`, async () => {
    class SlowFeed extends BulkFeed {
      inFlight = 0;
      maxInFlight = 0;
      async getCandles(market: string, interval: Interval, limit: number) {
        this.inFlight++;
        this.maxInFlight = Math.max(this.maxInFlight, this.inFlight);
        try {
          await new Promise((r) => setTimeout(r, 1 + (market.charCodeAt(3) % 3)));
          return await super.getCandles(market, interval, limit);
        } finally {
          this.inFlight--;
        }
      }
    }
    const feed = new SlowFeed();
    const markets = names(20);
    const h = v2(markets, { feed });
    await h.engine.tick();
    expect(feed.maxInFlight).toBe(SCAN_CONCURRENCY);
    expect(h.of("decision").map((d) => d.market)).toEqual(markets);
  });

  it("stop, noodstop en paper-reset wissen de kandidaten van de lopende ronde", async () => {
    for (const how of ["stop", "kill", "reset"] as const) {
      const h = v2(names(100), { risk: { maxOpenPositions: 1 } });
      h.signals.buyMarkets = new Set(["M005-EUR", "M095-EUR"]);
      h.signals.scores = new Map([
        ["M005-EUR", 0.9],
        ["M095-EUR", 0.5],
      ]);
      h.signals.buyAt.add(h.lastClosed());
      await h.engine.tick();
      expect(row(h, "M005-EUR").status).toBe("candidate");
      if (how === "stop") await h.engine.stop();
      else if (how === "kill") await h.engine.killSwitch();
      else h.engine.resetPaper(1000);
      // Het koopsignaal is al beoordeeld: "tegengehouden" met uitleg (niet "wacht" naast KOOP).
      expect(row(h, "M005-EUR")).toMatchObject({
        status: "blocked",
        action: "buy",
        note: "Koopsignaal al beoordeeld: de bot koopt pas weer na een nieuwe candle",
      });
      expect(h.engine.snapshot().scan!.roundStartedAt).toBeNull();
      h.clock.advance(15_000);
      await h.engine.tick(); // handmatige tick: de rest van de ronde
      expect(bought(h)).toEqual(["M095-EUR"]); // het oude (sterkere) signaal van M005 is vervallen
    }
  });

  it("een ander interval wist kandidaten en rondestand", async () => {
    const h = v2(names(100));
    h.signals.buyMarkets = new Set(["M005-EUR"]);
    h.signals.buyAt.add(h.lastClosed());
    await h.engine.tick();
    expect(row(h, "M005-EUR").status).toBe("candidate");
    h.engine.updateConfig({ interval: "1h" });
    const s = h.engine.snapshot();
    expect(row(h, "M005-EUR").status).toBe("pending");
    expect(s.scan).toMatchObject({ done: 0, roundStartedAt: null });
  });
});

// ───────────────────────────── Ophalen: illiquide markten, fouten ─────────────────────────────

describe("Ophalen per ronde", () => {
  it("illiquide markt zonder nieuwe candle wordt niet elke tick opnieuw opgehaald", async () => {
    const h = v2(["AAA-EUR", "ILQ-EUR"]);
    h.feed.setSeries("ILQ-EUR", 100, T0 - 3 * I15); // laatste handel 3 candles geleden
    await h.engine.tick();
    for (let i = 0; i < 3; i++) {
      h.clock.advance(15_000);
      await h.engine.tick();
    }
    expect(calls(h, "ILQ-EUR")).toBe(1);
    expect(calls(h, "AAA-EUR")).toBe(1);
    expect(row(h, "ILQ-EUR")).toMatchObject({ status: "watching", note: "Geen nieuwe candle: er wordt weinig gehandeld" });
    expect(h.engine.snapshot().scan).toMatchObject({ done: 2, total: 2 });
    // Volgende candle: weer één keer
    h.clock.set(T0 + I15 + 60_000);
    await h.engine.tick();
    h.clock.advance(15_000);
    await h.engine.tick();
    expect(calls(h, "ILQ-EUR")).toBe(2);
  });

  it("vlak na het sluiten zonder de nieuwste candle: precies één nieuwe poging in een latere tick (kopen wacht daarop)", async () => {
    const h = v2(["AAA-EUR", "LATE-EUR"], { clock: new Clock(T0 + 10_000) });
    h.feed.setSeries("LATE-EUR", 100, T0 - I15 - I15); // de candle van R0 ontbreekt nog
    h.signals.buyMarkets = new Set(["AAA-EUR"]);
    h.signals.buyAt.add(R0);
    await h.engine.tick();
    expect(calls(h, "LATE-EUR")).toBe(1);
    expect(h.broker.orders).toHaveLength(0); // ronde nog niet rond
    expect(h.engine.snapshot().scan).toMatchObject({ done: 1, total: 2, roundStartedAt: T0 + 10_000 });
    h.feed.append("LATE-EUR", 100); // de beurs heeft de candle nu wel
    h.clock.advance(15_000);
    await h.engine.tick();
    expect(calls(h, "LATE-EUR")).toBe(2);
    expect(bought(h)).toEqual(["AAA-EUR"]);
    expect(h.of("decision").filter((d) => d.market === "LATE-EUR").map((d) => d.time)).toEqual([R0 - I15, R0]);
    h.clock.advance(15_000);
    await h.engine.tick();
    expect(calls(h, "LATE-EUR")).toBe(2);

    // Blijft de candle ontbreken, dan telt de ene extra poging en is de markt klaar
    const g = v2(["AAA-EUR", "LATE-EUR"], { clock: new Clock(T0 + 10_000) });
    g.feed.setSeries("LATE-EUR", 100, T0 - 2 * I15);
    await g.engine.tick();
    g.clock.advance(15_000);
    await g.engine.tick();
    g.clock.advance(15_000);
    await g.engine.tick();
    expect(calls(g, "LATE-EUR")).toBe(2);
    expect(g.engine.snapshot().scan).toMatchObject({ done: 2, roundStartedAt: null });
  });

  it(`mislukt ophalen: radar 'error', telt als klaar voor de ronde, nieuwe poging pas na ${FETCH_RETRY_MS / 1000} s`, async () => {
    const h = v2(["AAA-EUR", "BAD-EUR"]);
    h.feed.failing.add("BAD-EUR");
    h.signals.buyMarkets = new Set(["AAA-EUR"]);
    h.signals.buyAt.add(h.lastClosed());
    const t0 = h.clock.t;
    await h.engine.tick();
    expect(bought(h)).toEqual(["AAA-EUR"]);
    expect(row(h, "BAD-EUR")).toMatchObject({ status: "error", note: "Koersdata ophalen mislukt: HTTP 503 voor BAD-EUR" });
    expect(allLogs(h).filter((m) => m.startsWith("Koersdata voor BAD-EUR niet beschikbaar"))).toHaveLength(1);
    h.clock.advance(15_000);
    await h.engine.tick();
    expect(calls(h, "BAD-EUR")).toBe(1);
    h.feed.failing.delete("BAD-EUR");
    h.clock.set(t0 + FETCH_RETRY_MS);
    await h.engine.tick();
    expect(calls(h, "BAD-EUR")).toBe(2);
    expect(row(h, "BAD-EUR").status).toBe("watching");
  });

  it("veel mislukte markten: één samenvattende logregel in plaats van een regel per markt", async () => {
    const markets = names(10);
    const h = v2(markets);
    for (const m of markets) h.feed.failing.add(m);
    await h.engine.tick();
    const lines = allLogs(h).filter((m) => m.startsWith("Koersdata voor"));
    expect(lines).toEqual([
      "Koersdata voor 10 markten niet beschikbaar (M001-EUR, M002-EUR, M003-EUR, M004-EUR, M005-EUR, M006-EUR, M007-EUR, M008-EUR +2): " +
        "HTTP 503 voor M001-EUR — de bot probeert die markten over ongeveer een minuut opnieuw",
    ]);
    expect(h.engine.snapshot().radar!.every((r) => r.status === "error")).toBe(true);
  });
});

// ───────────────────────────── Trendfilter ─────────────────────────────

describe("Marktfilter (Bitcoin boven zijn gemiddelde)", () => {
  it("Bitcoin eronder: geen aankopen, één logregel per ronde (niet per markt); de vormende dagcandle telt niet", async () => {
    const h = v2(["AAA-EUR", "BBB-EUR"], { config: { ensemble: { ...DEFAULT_ENSEMBLE_CONFIG, trendFilter: tf() } } });
    daily(h.feed, "BTC-EUR", "down", 1_000_000); // vandaag (nog open) een enorme stijging: telt niet
    h.signals.buyAt.add(h.lastClosed());
    await h.engine.tick();
    expect(h.broker.orders).toHaveLength(0);
    expect(h.risk.planCalls).toHaveLength(0);
    expect(h.feed.bookCalls).toHaveLength(0);
    const filterLogs = () => allLogs(h).filter((m) => m.startsWith("Marktfilter"));
    expect(filterLogs()).toHaveLength(1);
    expect(filterLogs()[0]).toMatch(
      /^Marktfilter: 2 koopsignalen genegeerd — Bitcoin \(BTC-EUR\) staat onder het gemiddelde van 5 dagen \(€100 ≤ €120\)$/,
    );
    expect(allLogs(h).some((m) => m.startsWith("Geen koop"))).toBe(false);
    expect(row(h, "AAA-EUR")).toMatchObject({ status: "blocked", rank: 1 });
    expect(row(h, "AAA-EUR").note).toMatch(/^Marktfilter: Bitcoin \(BTC-EUR\) staat onder/);
    expect(h.engine.snapshot().marketFilter).toEqual({
      market: "BTC-EUR",
      ok: false,
      close: 100,
      sma: 120,
      interval: "1d",
      period: 5,
      checkedAt: h.clock.t,
      note: "Bitcoin (BTC-EUR) staat onder het gemiddelde van 5 dagen (€100 ≤ €120) — geen nieuwe aankopen",
    });

    // Zelfde ronde: geen nieuwe melding en de dagcandles worden niet opnieuw opgehaald
    h.clock.advance(15_000);
    await h.engine.tick();
    expect(filterLogs()).toHaveLength(1);
    expect(calls(h, "BTC-EUR", "1d")).toBe(1);

    // Volgende ronde met weer koopsignalen: één nieuwe melding
    h.feed.append("AAA-EUR", 100);
    h.feed.append("BBB-EUR", 100);
    h.clock.set(T0 + I15 + 60_000);
    h.signals.buyAt.add(T0);
    await h.engine.tick();
    expect(filterLogs()).toHaveLength(2);
    expect(h.broker.orders).toHaveLength(0);
    expect(calls(h, "BTC-EUR", "1d")).toBe(1); // zelfde dag: geen nieuwe dagcandle
  });

  it("Bitcoin erboven: kopen mag", async () => {
    const h = v2(["AAA-EUR"], { config: { ensemble: { ...DEFAULT_ENSEMBLE_CONFIG, trendFilter: tf() } } });
    daily(h.feed, "BTC-EUR", "up");
    h.signals.buyAt.add(h.lastClosed());
    await h.engine.tick();
    expect(bought(h)).toEqual(["AAA-EUR"]);
    const mf = h.engine.snapshot().marketFilter!;
    expect(mf).toMatchObject({ ok: true, close: 200, sma: 180 });
    expect(mf.note).toMatch(/staat boven het gemiddelde van 5 dagen .* — nieuwe aankopen toegestaan$/);
    expect(allLogs(h).some((m) => m.startsWith("Marktfilter"))).toBe(false);
  });

  it(`Bitcoin-candles niet op te halen → geen aankopen (voor de zekerheid); nieuwe poging pas na ${TREND_RETRY_MS / 60_000} minuten`, async () => {
    const h = v2(["AAA-EUR"], { config: { ensemble: { ...DEFAULT_ENSEMBLE_CONFIG, trendFilter: tf() } } });
    daily(h.feed, "BTC-EUR", "up");
    h.feed.failingInterval.add("BTC-EUR|1d");
    h.signals.buyAt.add(h.lastClosed());
    const t0 = h.clock.t;
    expect(h.engine.snapshot().marketFilter).toMatchObject({ ok: null, checkedAt: null });
    await h.engine.tick();
    expect(h.broker.orders).toHaveLength(0);
    const mf = h.engine.snapshot().marketFilter!;
    expect(mf).toMatchObject({ ok: null, close: null, sma: null, checkedAt: null });
    expect(mf.note).toContain("ophalen mislukt: HTTP 503 voor BTC-EUR");
    expect(allLogs(h)).toContain(
      "Marktfilter: koersdata van BTC-EUR niet opgehaald (HTTP 503 voor BTC-EUR) — geen nieuwe aankopen tot dat weer lukt",
    );
    expect(allLogs(h)).toContain(
      "Marktfilter: 1 koopsignaal genegeerd — Bitcoin (BTC-EUR): te weinig koersdata voor het gemiddelde van 5 dagen (0/5)",
    );
    h.clock.advance(60_000);
    await h.engine.tick();
    expect(calls(h, "BTC-EUR", "1d")).toBe(1);

    h.feed.failingInterval.clear();
    h.clock.set(t0 + TREND_RETRY_MS);
    await h.engine.tick();
    expect(calls(h, "BTC-EUR", "1d")).toBe(2);
    expect(h.engine.snapshot().marketFilter!.ok).toBe(true);
    // Het signaal van deze ronde is al beoordeeld; de volgende ronde koopt wel
    h.feed.append("AAA-EUR", 100);
    h.clock.set(T0 + I15 + 60_000);
    h.signals.buyAt.add(T0);
    await h.engine.tick();
    expect(bought(h)).toEqual(["AAA-EUR"]);
  });

  it("filter uit → marketFilter null en geen dagcandles", async () => {
    const h = v2(["AAA-EUR"]);
    await h.engine.tick();
    expect(h.engine.snapshot().marketFilter).toBeNull();
    expect(h.feed.calls.some((c) => c.interval === "1d")).toBe(false);
  });
});

describe("Muntfilter (de munt zelf boven zijn gemiddelde)", () => {
  it("blokkeert alleen munten onder hun gemiddelde; dagcandles alleen voor koopkandidaten", async () => {
    const h = v2(["AAA-EUR", "BBB-EUR", "CCC-EUR"], {
      config: { ensemble: { ...DEFAULT_ENSEMBLE_CONFIG, trendFilter: tf({ market: false, coin: true }) } },
    });
    daily(h.feed, "AAA-EUR", "down");
    daily(h.feed, "BBB-EUR", "up");
    daily(h.feed, "CCC-EUR", "up");
    h.signals.buyMarkets = new Set(["AAA-EUR", "BBB-EUR"]);
    h.signals.buyAt.add(h.lastClosed());
    await h.engine.tick();
    expect(bought(h)).toEqual(["BBB-EUR"]);
    expect(allLogs(h)).toContain(
      "Geen koop AAA-EUR: Muntfilter: AAA staat onder het gemiddelde van 5 dagen (€100 ≤ €120) — geen aankoop",
    );
    expect(row(h, "AAA-EUR")).toMatchObject({ status: "blocked", trendOk: false });
    expect(row(h, "AAA-EUR").note).toMatch(/^Muntfilter: AAA staat onder/);
    expect(row(h, "BBB-EUR")).toMatchObject({ status: "position", trendOk: true });
    expect(row(h, "CCC-EUR")).toMatchObject({ status: "watching", trendOk: null });
    expect(h.feed.calls.filter((c) => c.interval === "1d").map((c) => c.market).sort()).toEqual(["AAA-EUR", "BBB-EUR"]);
    expect(h.engine.snapshot().marketFilter).toBeNull();
  });
});

// ───────────────────────────── Spreadlimiet ─────────────────────────────

describe("Spreadlimiet", () => {
  it("te grote spread of geen orderboek → tegengehouden; anders gekocht (orderboek met diepte 1)", async () => {
    const h = v2(["AAA-EUR", "BBB-EUR", "CCC-EUR"], { risk: { maxOpenPositions: 3 } });
    h.feed.books.set("AAA-EUR", { market: "AAA-EUR", bids: [[100, 1]], asks: [[100.62, 1]], timestamp: 0 });
    h.feed.bookFail.add("BBB-EUR");
    h.signals.buyAt.add(h.lastClosed());
    await h.engine.tick();
    expect(bought(h)).toEqual(["CCC-EUR"]);
    expect(row(h, "AAA-EUR")).toMatchObject({ status: "blocked", note: "Spread te groot (0,62% > 0,30%)" });
    expect(row(h, "BBB-EUR")).toMatchObject({ status: "blocked", note: "Spread onbekend (orderboek niet opgehaald)" });
    expect(allLogs(h)).toContain("Geen koop AAA-EUR: Spread te groot (0,62% > 0,30%)");
    expect(allLogs(h)).toContain("Geen koop BBB-EUR: Spread onbekend (orderboek niet opgehaald)");
    expect(h.feed.bookCalls.map((c) => c.depth)).toEqual([1, 1, 1]);
    expect(h.risk.planCalls.map((c) => c.market?.market)).toEqual(["CCC-EUR"]);
  });

  it("een spread net boven de limiet toont geen twee gelijke getallen", async () => {
    const h = v2(["AAA-EUR"]);
    // (100.3009 − 100) / 100.15045 ≈ 0,3004% bij een limiet van 0,30%
    h.feed.books.set("AAA-EUR", { market: "AAA-EUR", bids: [[100, 1]], asks: [[100.3009, 1]], timestamp: 0 });
    h.signals.buyAt.add(h.lastClosed());
    await h.engine.tick();
    expect(bought(h)).toEqual([]);
    expect(row(h, "AAA-EUR")).toMatchObject({ status: "blocked", note: "Spread te groot (0,3004% > 0,3000%)" });
  });

  it("maxSpreadPct 0 of ontbrekend = geen limiet (geen orderboek nodig)", async () => {
    for (const risk of [{ ...DEFAULT_RISK_CONFIG, maxSpreadPct: 0 }, (({ maxSpreadPct: _x, ...r }) => r)(DEFAULT_RISK_CONFIG)]) {
      const h = v2(["AAA-EUR"], { config: { risk } });
      h.feed.bookFail.add("AAA-EUR");
      h.signals.buyAt.add(h.lastClosed());
      await h.engine.tick();
      expect(bought(h)).toEqual(["AAA-EUR"]);
      expect(h.feed.bookCalls).toHaveLength(0);
    }
  });
});

// ───────────────────────────── Alleen actieve markten kopen ─────────────────────────────

describe("Markten die niet (meer) actief zijn", () => {
  it("een positie in een niet-actieve markt wordt elke tick bewaakt (stop-loss werkt), maar er wordt niet opnieuw gekocht", async () => {
    const h = v2(["AAA-EUR", "BBB-EUR"]);
    h.signals.buyMarkets = new Set(["AAA-EUR"]);
    h.signals.buyAt.add(h.lastClosed());
    await h.engine.tick();
    expect(bought(h)).toEqual(["AAA-EUR"]);
    h.engine.updateConfig({ markets: ["BBB-EUR"] });
    let s = h.engine.snapshot();
    expect(s.activeMarkets).toEqual(["BBB-EUR"]);
    expect(s.radar!.map((r) => [r.market, r.status])).toEqual([
      ["BBB-EUR", "watching"],
      ["AAA-EUR", "position"],
    ]);
    const before = calls(h, "AAA-EUR");
    h.clock.advance(15_000);
    await h.engine.tick();
    expect(calls(h, "AAA-EUR")).toBe(before + 1); // positie-markt: elke tick
    h.feed.setLast("AAA-EUR", 94); // onder de stop (95)
    h.clock.advance(15_000);
    await h.engine.tick();
    s = h.engine.snapshot();
    expect(s.positions).toHaveLength(0);
    expect(s.trades[0]).toMatchObject({ market: "AAA-EUR", exitReason: "stop-loss" });

    // Nieuwe candle met koopsignaal in AAA: niet actief → niet opgehaald en niet gekocht
    h.feed.append("AAA-EUR", 100);
    h.feed.append("BBB-EUR", 100);
    h.clock.set(T0 + I15 + 60_000);
    h.signals.buyAt.add(T0);
    const n = calls(h, "AAA-EUR");
    await h.engine.tick();
    expect(calls(h, "AAA-EUR")).toBe(n);
    expect(bought(h)).toEqual(["AAA-EUR"]);
    expect(h.engine.snapshot().radar!.map((r) => r.market)).toEqual(["BBB-EUR"]);
  });

  it("stop-loss en koopsignaal in dezelfde tick: alleen de actieve markt wordt opnieuw gekocht", async () => {
    const h = v2(["AAA-EUR", "BBB-EUR"]);
    h.signals.buyAt.add(h.lastClosed());
    await h.engine.tick();
    expect(bought(h)).toEqual(["AAA-EUR", "BBB-EUR"]);
    h.engine.updateConfig({ markets: ["BBB-EUR"] }); // AAA niet meer actief, wel een positie
    // Nieuwe candle: beide onder de stop (95) én een nieuw koopsignaal
    h.feed.append("AAA-EUR", 94);
    h.feed.append("BBB-EUR", 94);
    h.clock.set(T0 + I15 + 60_000);
    h.signals.buyAt.add(T0);
    await h.engine.tick();
    const s = h.engine.snapshot();
    expect(s.trades.map((t) => [t.market, t.exitReason]).sort()).toEqual([
      ["AAA-EUR", "stop-loss"],
      ["BBB-EUR", "stop-loss"],
    ]);
    expect(h.of("decision").filter((d) => d.time === T0).map((d) => [d.market, d.action])).toEqual([
      ["BBB-EUR", "buy"],
      ["AAA-EUR", "buy"],
    ]);
    expect(bought(h)).toEqual(["AAA-EUR", "BBB-EUR", "BBB-EUR"]); // AAA niet opnieuw
    expect(s.positions.map((p) => p.market)).toEqual(["BBB-EUR"]);
  });
});

// ───────────────────────────── Snapshot ─────────────────────────────

describe("Snapshot: radar, universe, scan, beslissingen", () => {
  it("radar-rijen met status-prioriteit, rang en Nederlandse uitleg; universe en scan", async () => {
    const m = ["POS-EUR", "CAN-EUR", "BLK-EUR", "ERR-EUR", "WAT-EUR"];
    const h = v2(m, { risk: { maxOpenPositions: 1 } });
    h.feed.tickers = [ticker("POS-EUR", { changePct: 3, volumeQuote: 5e6, bid: 99.9, ask: 100.1 }), ticker("BTC-EUR", { changePct: 1 })];
    h.feed.books.set("BLK-EUR", { market: "BLK-EUR", bids: [[100, 1]], asks: [[101, 1]], timestamp: 0 });
    h.feed.failing.add("ERR-EUR");
    h.signals.buyMarkets = new Set(["POS-EUR", "CAN-EUR", "BLK-EUR"]);
    h.signals.scores = new Map([
      ["BLK-EUR", 0.9],
      ["POS-EUR", 0.8],
      ["CAN-EUR", 0.5],
    ]);
    h.signals.buyAt.add(h.lastClosed());
    await h.engine.tick();
    h.engine.updateConfig({ markets: [...m, "PEN-EUR"] });
    h.feed.setSeries("PEN-EUR", 100, T0);
    const s = h.engine.snapshot();
    expect(s.activeMarkets).toEqual([...m, "PEN-EUR"]);
    expect(s.radar!.map((r) => [r.market, r.status, r.rank ?? null])).toEqual([
      ["POS-EUR", "position", null],
      ["CAN-EUR", "candidate", 3],
      ["BLK-EUR", "blocked", 1],
      ["ERR-EUR", "error", null],
      ["WAT-EUR", "watching", null],
      ["PEN-EUR", "pending", null],
    ]);
    const pos = s.radar![0];
    expect(pos).toEqual({
      market: "POS-EUR",
      price: 100,
      changePct24h: 3,
      volumeQuote24h: 5e6,
      spreadPct: expect.closeTo(0.2, 9),
      action: "buy",
      score: 0.8,
      regime: "trend-up",
      evaluatedAt: R0,
      trendOk: null,
      status: "position",
    });
    expect(row(h, "BLK-EUR").note).toBe("Spread te groot (1,00% > 0,30%)");
    expect(row(h, "CAN-EUR").note).toBe("Koopsignaal, maar geen vrije plek (max. 1 positie)");
    expect(row(h, "ERR-EUR").note).toBe("Koersdata ophalen mislukt: HTTP 503 voor ERR-EUR");
    expect(row(h, "WAT-EUR")).toMatchObject({ action: "hold", score: 0, changePct24h: null, volumeQuote24h: null, spreadPct: null });
    expect(row(h, "WAT-EUR").note).toBeUndefined();
    expect(row(h, "PEN-EUR")).toMatchObject({ price: null, action: null, score: null, regime: null, evaluatedAt: null });
    expect(s.universe).toEqual({ mode: "manual", count: 6, requested: 6, updatedAt: null });
    expect(s.scan).toEqual({ done: 5, total: 6, roundStartedAt: null, lastRoundCompletedAt: h.clock.t, candidates: 3 });
    expect(s.marketFilter).toBeNull();

    // Blocked/candidate gelden alleen voor de ronde waarin ze ontstonden
    for (const mk of [...m, "PEN-EUR"]) if (mk !== "ERR-EUR") h.feed.append(mk, 100);
    h.clock.set(T0 + I15 + 60_000);
    await h.engine.tick();
    expect(row(h, "BLK-EUR")).toMatchObject({ status: "watching", action: "hold" });
    expect(row(h, "CAN-EUR").status).toBe("watching");
    expect(row(h, "BLK-EUR").rank).toBeUndefined();
    expect(row(h, "PEN-EUR").status).toBe("watching");
  });

  it(`beslissingen: bij meer dan ${SNAPSHOT_DECISIONS_LIMIT} actieve markten alleen de eerste ${SNAPSHOT_DECISIONS_LIMIT}, posities en niet-'hold'; decisionFor geeft elke markt`, async () => {
    const markets = names(45);
    const h = v2(markets);
    h.signals.buyMarkets = new Set(["M044-EUR"]);
    h.signals.buyAt.add(h.lastClosed());
    await h.engine.tick();
    let keys = Object.keys(h.engine.snapshot().decisions).sort();
    expect(keys).toEqual([...markets.slice(0, 40), "M044-EUR"].sort());
    expect(h.engine.decisionFor("M045-EUR")).toMatchObject({ market: "M045-EUR", action: "hold", time: R0 });
    expect(h.engine.decisionFor("m045-eur")).toMatchObject({ market: "M045-EUR" });
    expect(h.engine.decisionFor("XXX-EUR")).toBeNull();
    expect(h.engine.decisionFor("constructor")).toBeNull();
    // Kopie: de engine-staat verandert niet mee
    h.engine.decisionFor("M045-EUR")!.action = "buy";
    expect(h.engine.decisionFor("M045-EUR")!.action).toBe("hold");

    // Volgende candle: M044 staat in positie met een 'hold' → blijft in de snapshot
    for (const m of markets) h.feed.append(m, 100);
    h.clock.set(T0 + I15 + 60_000);
    await h.engine.tick();
    keys = Object.keys(h.engine.snapshot().decisions).sort();
    expect(keys).toEqual([...markets.slice(0, 40), "M044-EUR"].sort());
    expect(h.engine.snapshot().decisions["M044-EUR"]).toMatchObject({ action: "hold", time: T0 });
  });
});

// ───────────────────────────── Koersen en tickers ─────────────────────────────

describe("Koersen (getPrices) en 24h-tickers", () => {
  it("getPrices: één verzoek per tick voor alle koersen, zonder 'price'-events en zonder candles op te halen", async () => {
    const h = v2(["AAA-EUR", "BBB-EUR"]);
    const feed = h.feed as BulkFeed;
    await h.engine.tick();
    expect(feed.priceCalls).toBe(1);
    const candleCalls = h.feed.calls.length;
    const priceEvents = h.of("price").length;
    feed.priceOverride.set("BBB-EUR", 123);
    h.clock.advance(15_000);
    await h.engine.tick();
    expect(feed.priceCalls).toBe(2);
    expect(h.feed.calls.length).toBe(candleCalls);
    expect(h.of("price").length).toBe(priceEvents);
    expect(h.engine.snapshot().prices["BBB-EUR"]).toBe(123);
    expect(row(h, "BBB-EUR").price).toBe(123);

    // getPrices mislukt: laatst bekende koersen blijven, één waarschuwing
    feed.pricesFail = true;
    h.clock.advance(15_000);
    await h.engine.tick();
    h.clock.advance(15_000);
    await h.engine.tick();
    expect(h.engine.snapshot().prices["BBB-EUR"]).toBe(123);
    expect(allLogs(h).filter((m) => m.startsWith("Koersen van alle markten niet opgehaald"))).toHaveLength(1);
  });

  it("koersbewaking terwijl de bot stilstaat: met getPrices één verzoek (geen getPrice); 'price'-events alleen voor posities", async () => {
    const h = v2(["AAA-EUR", "BBB-EUR"]);
    const feed = h.feed as BulkFeed;
    h.signals.buyMarkets = new Set(["AAA-EUR"]);
    h.signals.buyAt.add(h.lastClosed());
    await h.engine.tick();
    expect(bought(h)).toEqual(["AAA-EUR"]);
    const getPrice = vi.spyOn(feed, "getPrice");
    feed.priceOverride.set("AAA-EUR", 101);
    feed.priceOverride.set("BBB-EUR", 99);
    const before = h.of("price").length;
    const pricesBefore = feed.priceCalls;
    await h.engine.startPriceMonitor();
    h.engine.stopPriceMonitor();
    expect(getPrice).not.toHaveBeenCalled();
    expect(feed.priceCalls).toBe(pricesBefore + 1);
    expect(h.of("price").slice(before)).toEqual([{ market: "AAA-EUR", price: 101, time: h.clock.t }]);
    expect(h.engine.snapshot().prices).toMatchObject({ "AAA-EUR": 101, "BBB-EUR": 99 });
    expect(h.engine.snapshot().positions[0].currentPrice).toBe(101);
  });

  it("zonder getPrices werkt alles ook (koersen via candles); de koersbewaking vraagt alleen de eerste 40 markten + posities op", async () => {
    const feed = new FakeFeed();
    const markets = names(45);
    const h = v2(markets, { feed });
    expect("getPrices" in feed).toBe(false);
    await h.engine.tick();
    expect(Object.keys(h.engine.snapshot().prices)).toHaveLength(45);
    const getPrice = vi.spyOn(feed, "getPrice");
    await h.engine.startPriceMonitor();
    h.engine.stopPriceMonitor();
    expect(getPrice.mock.calls.map((c) => c[0])).toEqual(markets.slice(0, 40));
  });

  it(`tickers hooguit elke ${TICKERS_REFRESH_MS / 1000} s; mislukt → de vorige blijven`, async () => {
    const h = v2(["AAA-EUR"]);
    h.feed.tickers = [ticker("AAA-EUR", { changePct: 4, volumeQuote: 2e6 })];
    await h.engine.tick();
    expect(h.feed.tickerCalls).toBe(1);
    expect(row(h, "AAA-EUR")).toMatchObject({ changePct24h: 4, volumeQuote24h: 2e6 });
    h.clock.advance(30_000);
    await h.engine.tick();
    expect(h.feed.tickerCalls).toBe(1);
    h.feed.tickersFail = true;
    h.clock.advance(30_000);
    await h.engine.tick();
    expect(h.feed.tickerCalls).toBe(2);
    expect(row(h, "AAA-EUR")).toMatchObject({ changePct24h: 4, volumeQuote24h: 2e6 });
    expect(allLogs(h).filter((m) => m.startsWith("24-uursgegevens van de markten niet opgehaald"))).toHaveLength(1);
  });
});
