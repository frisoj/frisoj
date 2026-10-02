/**
 * Ronde 5 (engine): trendfilter fail-closed na een mislukte ophaalpoging, de kansenronde na
 * wijzigingen tijdens de ronde, open posities eerst en snel opgeven bij een trage beurs,
 * stop-controle op de bulkkoers, spread precies op de limiet, capaciteitswaarschuwing,
 * radar na Stop → Start en (live) coins die de bot niet beheert in de automatische muntkeuze.
 */
import { describe, expect, it, vi } from "vitest";
import { DEFAULT_ENSEMBLE_CONFIG, DEFAULT_RISK_CONFIG } from "../../src/core/defaults";
import type {
  Candle,
  EngineConfig,
  Interval,
  OrderBook,
  RadarRow,
  RiskConfig,
  TradingMode,
  TrendFilterConfig,
} from "../../src/core/types";
import { BitvavoFeed } from "../../src/data/bitvavoFeed";
import { BitvavoClient } from "../../src/exchange/bitvavoClient";
import { trendGate } from "../../src/strategies/trendFilter";
import { SCAN_BATCH_PER_TICK, SCAN_TIME_BUDGET_MS, TREND_RETRY_MS, type EngineDeps } from "../../src/engine/tradingEngine";
import { BulkFeed, Clock, Deferred, FakeFeed, I15, T0, mkCandle, setup, ticker, type Harness } from "./helpers";

const DAY = 86_400_000;
/** Middernacht UTC: hier sluit de dagcandle van 5 januari */
const DAY1 = Date.UTC(2026, 0, 6);

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
    startingCapital: 1000,
    config: { ...(o.config ?? {}), ...(o.risk ? { risk: { ...DEFAULT_RISK_CONFIG, ...o.risk } } : {}) },
  });
  h.risk.quote = 20;
  h.risk.stopDist = 5;
  h.risk.tpDist = 10;
  return h;
}

const row = (h: Harness, market: string): RadarRow => h.engine.snapshot().radar!.find((r) => r.market === market)!;
const allLogs = (h: Harness): string[] => h.of("log").map((l) => l.message as string);
const bought = (h: Harness) => h.broker.buys().map((o) => o.req.market);
const tf = (o: Partial<TrendFilterConfig> = {}): TrendFilterConfig => ({ market: true, coin: false, interval: "1d", period: 5, ...o });
const withTrend = (t: TrendFilterConfig) => ({ ensemble: { ...DEFAULT_ENSEMBLE_CONFIG, trendFilter: t } });

/** Dagcandles; de laatste opent op DAY1 (na middernacht in vorming). */
function dailyTo(feed: FakeFeed, market: string, closes: number[], lastOpen = DAY1): Candle[] {
  const list = closes.map((c, i) => mkCandle(lastOpen - (closes.length - 1 - i) * DAY, c));
  feed.intervalSeries.set(`${market}|1d`, list);
  return list;
}

/** Een gewone (niet-Bitvavo) fout van de rate limit, zoals BitvavoApiError die geeft. */
function rateLimitError(market: string): Error {
  return Object.assign(new Error(`Rate limit van Bitvavo bijna bereikt; GET /${market}/candles overgeslagen tot de reset`), {
    isRateLimit: true,
  });
}

// ───────────────────────────── EM-1: trendfilter fail-closed ─────────────────────────────

describe("Trendfilter: mislukt ophalen na het sluiten van een dagcandle = geen aankoop (zoals de backtest)", () => {
  // Bitcoin sluit om middernacht onder zijn gemiddelde (110 → 60); gisteren stond hij erboven.
  const FLIP_DOWN = [...Array(9).fill(100), 110, 60, 60];

  it("marktfilter: ophalen mislukt vlak na middernacht → geen koop, en zolang het mislukt de hele dag niet", async () => {
    const feed = new BulkFeed();
    const clock = new Clock(DAY1 - 60_000);
    feed.setSeries("AAA-EUR", 100, DAY1);
    feed.setSeries("BBB-EUR", 100, DAY1);
    const btc = dailyTo(feed, "BTC-EUR", FLIP_DOWN);
    const trend = tf();
    const h = v2(["AAA-EUR", "BBB-EUR"], { feed, clock, config: withTrend(trend) });
    h.signals.buyMarkets = new Set(["AAA-EUR"]);
    const signal = DAY1 - I15;
    h.signals.buyAt.add(signal);
    await h.engine.tick(); // 23:59: Bitcoin boven zijn gemiddelde
    expect(h.engine.snapshot().marketFilter!.ok).toBe(true);

    clock.set(DAY1 + 60_000);
    feed.failingInterval.add("BTC-EUR|1d");
    await h.engine.tick();
    expect(bought(h)).toEqual([]);
    // De backtest beslist op decision.time + interval met de gesloten dagcandle: ook geen koop.
    expect(trendGate(trend, { market: btc }, signal + I15, "AAA-EUR").allowed).toBe(false);
    const stale = "Bitcoin (BTC-EUR): koersdata niet actueel, de laatste dagcandle ontbreekt";
    expect(row(h, "AAA-EUR")).toMatchObject({
      status: "blocked",
      note: `Marktfilter: ${stale} (ophalen mislukt: HTTP 503 voor BTC-EUR) — geen nieuwe aankopen`,
    });
    // Dashboard en logboek zeggen hetzelfde: geen nieuwe aankopen.
    const mf = h.engine.snapshot().marketFilter!;
    expect(mf.ok).toBeNull();
    expect(mf.note).toBe(`${stale} — geen nieuwe aankopen (ophalen mislukt: HTTP 503 voor BTC-EUR)`);
    expect(allLogs(h)).toContain(
      "Marktfilter: koersdata van BTC-EUR niet opgehaald (HTTP 503 voor BTC-EUR) — geen nieuwe aankopen tot dat weer lukt",
    );
    expect(allLogs(h)).toContain(`Marktfilter: 1 koopsignaal genegeerd — ${stale} (ophalen mislukt: HTTP 503 voor BTC-EUR)`);

    // Uren later, nog steeds mislukt: ook een nieuw signaal wordt niet gekocht.
    const later = DAY1 + 6 * 3_600_000;
    feed.setSeries("AAA-EUR", 100, later);
    feed.setSeries("BBB-EUR", 100, later);
    h.signals.buyMarkets = new Set(["BBB-EUR"]);
    h.signals.buyAt.add(later - I15);
    clock.set(later + 30_000);
    await h.engine.tick();
    expect(bought(h)).toEqual([]);
    expect(row(h, "BBB-EUR").status).toBe("blocked");
  });

  it("gelukt ophalen maar de nieuwste dagcandle ontbreekt nog: alleen vlak na het sluiten verdragen", async () => {
    const feed = new BulkFeed();
    const clock = new Clock(DAY1 + 30_000);
    feed.setSeries("AAA-EUR", 100, DAY1);
    feed.setSeries("BBB-EUR", 100, DAY1);
    // De beurs is nog niet bij: de dagcandle die om middernacht sloot ontbreekt (Bitcoin stijgt).
    dailyTo(feed, "BTC-EUR", [100, 102, 104, 106, 108, 110, 112, 114, 116, 118], DAY1 - 2 * DAY);
    const h = v2(["AAA-EUR", "BBB-EUR"], { feed, clock, config: withTrend(tf()) });
    h.signals.buyMarkets = new Set(["AAA-EUR"]);
    h.signals.buyAt.add(DAY1 - I15); // uitgevoerd om middernacht: net gesloten
    await h.engine.tick();
    expect(bought(h)).toEqual(["AAA-EUR"]);

    // Een half uur later ontbreekt hij nog steeds: dan niet meer op de oude dag kopen.
    const t = DAY1 + 30 * 60_000;
    feed.setSeries("AAA-EUR", 100, t);
    feed.setSeries("BBB-EUR", 100, t);
    h.signals.buyMarkets = new Set(["BBB-EUR"]);
    h.signals.buyAt.add(t - I15);
    clock.set(t + 30_000);
    expect(t + 30_000 - (DAY1 + 30_000)).toBeGreaterThanOrEqual(TREND_RETRY_MS);
    await h.engine.tick();
    expect(bought(h)).toEqual(["AAA-EUR"]);
    expect(row(h, "BBB-EUR")).toMatchObject({
      status: "blocked",
      note: "Marktfilter: Bitcoin (BTC-EUR): koersdata niet actueel, de laatste dagcandle ontbreekt — geen nieuwe aankopen",
    });
  });

  it("muntfilter: dagcandles van de munt niet op te halen na het sluiten → geen koop op oude data", async () => {
    const feed = new BulkFeed();
    const clock = new Clock(DAY1 - 60_000);
    feed.setSeries("AAA-EUR", 100, DAY1 - I15, 200);
    const coin = dailyTo(feed, "AAA-EUR", FLIP_DOWN);
    const trend = tf({ market: false, coin: true });
    const h = v2(["AAA-EUR"], { feed, clock, config: withTrend(trend), risk: { maxSpreadPct: 0, maxOpenPositions: 5 } });
    h.signals.buyAt.add(DAY1 - 2 * I15);
    await h.engine.tick(); // 23:59: de munt staat boven zijn gemiddelde → gekocht (dagcandles nu gecachet)
    expect(bought(h)).toEqual(["AAA-EUR"]);
    await h.engine.closePosition(h.engine.snapshot().positions[0].id);

    feed.setSeries("AAA-EUR", 100, DAY1, 200);
    feed.failingInterval.add("AAA-EUR|1d");
    clock.set(DAY1 + 60_000);
    h.signals.buyAt.add(DAY1 - I15);
    await h.engine.tick();
    expect(bought(h)).toEqual(["AAA-EUR"]);
    expect(trendGate(trend, { coin }, DAY1, "AAA-EUR").allowed).toBe(false);
    expect(row(h, "AAA-EUR")).toMatchObject({
      status: "blocked",
      trendOk: null,
      note: "Muntfilter: AAA: koersdata niet actueel, de laatste dagcandle ontbreekt (ophalen mislukt: HTTP 503 voor AAA-EUR) — geen aankoop",
    });
  });
});

// ───────────────────────────── EM-2: wijzigingen tijdens de kansenronde ─────────────────────────────

describe("Kansenronde: wijzigingen terwijl de ronde op het orderboek wacht", () => {
  /** Drie kandidaten; de ronde wacht op het eerste orderboek tot `mutate` gedaan is. */
  async function heldRound(mutate: (h: Harness) => void, o: V2Opts = {}): Promise<Harness> {
    const h = v2(["AAA-EUR", "BBB-EUR", "CCC-EUR"], { risk: { maxSpreadPct: 0.3, maxOpenPositions: 3 }, ...o });
    h.signals.scores = new Map([
      ["AAA-EUR", 0.9],
      ["BBB-EUR", 0.7],
      ["CCC-EUR", 0.5],
    ]);
    h.signals.buyAt.add(h.lastClosed());
    const gate = new Deferred();
    const orig = h.feed.getOrderBook.bind(h.feed);
    let waiting = false;
    h.feed.getOrderBook = async (m: string, depth?: number): Promise<OrderBook> => {
      if (!waiting) {
        waiting = true;
        await gate.promise;
      }
      return orig(m, depth);
    };
    const tick = h.engine.tick();
    await vi.waitFor(() => expect(waiting).toBe(true));
    expect(h.broker.orders).toHaveLength(0);
    mutate(h);
    gate.resolve();
    await tick;
    return h;
  }

  it("paper-reset: kandidaten van vóór de reset worden niet in het nieuwe account gekocht", async () => {
    const h = await heldRound((x) => x.engine.resetPaper(500));
    expect(h.broker.orders).toHaveLength(0);
    expect(h.engine.snapshot().account.cashQuote).toBe(500);
  });

  it("ander interval: de kandidaten van het oude interval vervallen", async () => {
    const h = await heldRound((x) => x.engine.updateConfig({ interval: "1h" as Interval }));
    expect(h.broker.orders).toHaveLength(0);
  });

  it("andere marktlijst: alleen markten die nog actief zijn mogen gekocht worden", async () => {
    const h = await heldRound((x) => x.engine.updateConfig({ markets: ["ZZZ-EUR", "BBB-EUR"] }));
    expect(bought(h)).toEqual(["BBB-EUR"]);
  });

  it("trendfilter aangezet (zonder Bitcoin-data): geldt voor de rest van de ronde, ook voor de kandidaat die al bezig was", async () => {
    const h = await heldRound((x) => x.engine.updateConfig({ ensemble: { trendFilter: tf() } } as Partial<EngineConfig>));
    expect(h.broker.orders).toHaveLength(0);
    expect(row(h, "AAA-EUR").note).toMatch(/^Marktfilter: /);
  });

  it("minder plekken tijdens de ronde wordt gerespecteerd (zoals voorheen)", async () => {
    const h = await heldRound((x) =>
      x.engine.updateConfig({ risk: { ...x.engine.snapshot().config.risk, maxOpenPositions: 1 } }),
    );
    expect(bought(h)).toEqual(["AAA-EUR"]);
  });

  it("live gearmd: marktlijst gewijzigd terwijl de saldo-controle loopt → geen echte order", async () => {
    const h = v2(["AAA-EUR"], { mode: "live" });
    h.broker.balances.set("EUR", 1000);
    h.engine.arm();
    h.signals.buyAt.add(h.lastClosed());
    const gate = new Deferred();
    const origBalances = h.broker.getBalances.bind(h.broker);
    let waiting = false;
    h.broker.getBalances = async () => {
      if (!waiting) {
        waiting = true;
        await gate.promise;
      }
      return origBalances();
    };
    const tick = h.engine.tick();
    await vi.waitFor(() => expect(waiting).toBe(true));
    h.engine.updateConfig({ markets: ["ZZZ-EUR"] });
    gate.resolve();
    await tick;
    expect(h.broker.orders).toHaveLength(0);
    expect(allLogs(h)).toContain("Koop AAA-EUR geannuleerd: de bot volgt deze markt niet meer");
  });
});

// ───────────────────────────── SCALE: open posities eerst, snel opgeven ─────────────────────────────

describe("Open posities gaan voor: een trage of hangende beurs vertraagt de stop-loss niet", () => {
  /** Positie in AAA-EUR (instap 100, stop 95) via een koopsignaal. */
  async function withPosition(markets = ["AAA-EUR", "BBB-EUR"], o: V2Opts = {}): Promise<Harness> {
    const h = v2(markets, o);
    h.signals.buyMarkets = new Set(["AAA-EUR"]);
    h.signals.buyAt.add(h.lastClosed());
    await h.engine.tick();
    expect(bought(h)).toEqual(["AAA-EUR"]);
    h.signals.buyAt.clear();
    return h;
  }

  it("de candles van open posities worden als eerste opgehaald (met voorrang), vóór koersen, tickers en marktfilter", async () => {
    const h = await withPosition();
    const feed = h.feed as BulkFeed;
    const order: string[] = [];
    const getCandles = feed.getCandles.bind(feed);
    const getPrices = feed.getPrices.bind(feed);
    const getTickers = feed.getTickers24h.bind(feed);
    const reqs = new Map<string, unknown>();
    feed.getCandles = async (m: string, i: Interval, l: number, req?: unknown) => {
      order.push(`candles ${m}`);
      reqs.set(m, req);
      return getCandles(m, i, l);
    };
    feed.getPrices = async (req?: unknown) => {
      order.push("prices");
      reqs.set("prices", req);
      return getPrices();
    };
    feed.getTickers24h = async (markets?: string[], req?: unknown) => {
      order.push("tickers");
      reqs.set("tickers", req);
      void markets;
      return getTickers();
    };
    h.clock.advance(61_000);
    await h.engine.tick();
    expect(order[0]).toBe("candles AAA-EUR");
    expect(order.indexOf("prices")).toBeGreaterThan(0);
    expect(order.indexOf("tickers")).toBeGreaterThan(0);
    // Posities: snel opgeven maar met voorrang; optionele gegevens: alleen snel.
    expect(reqs.get("AAA-EUR")).toEqual({ fast: true, priority: true });
    expect(reqs.get("prices")).toEqual({ fast: true, priority: true });
    expect(reqs.get("tickers")).toEqual({ fast: true });
  });

  it("een hangend verzoek voor alle koersen houdt de stop-loss niet op", async () => {
    const h = await withPosition();
    const feed = h.feed as BulkFeed;
    const hang = new Deferred();
    const getPrices = feed.getPrices.bind(feed);
    feed.getPrices = async () => {
      await hang.promise;
      return getPrices();
    };
    feed.setLast("AAA-EUR", 90, { low: 90 }); // onder de stop (95)
    h.clock.advance(15_000);
    const tick = h.engine.tick();
    await vi.waitFor(() => expect(h.broker.sells()).toHaveLength(1));
    hang.resolve();
    await tick;
    expect(h.engine.snapshot().trades[0]).toMatchObject({ market: "AAA-EUR", exitReason: "stop-loss" });
  });

  it("candles van een positie niet op te halen → stop-controle op de verse koers van alle markten (zelfde tick)", async () => {
    const h = await withPosition();
    const feed = h.feed as BulkFeed;
    feed.failing.add("AAA-EUR");
    feed.priceOverride.set("AAA-EUR", 80);
    h.clock.advance(15_000);
    await h.engine.tick();
    expect(h.broker.sells()).toHaveLength(1);
    expect(h.engine.snapshot().positions).toHaveLength(0);
    expect(h.engine.snapshot().trades[0]).toMatchObject({ market: "AAA-EUR", exitReason: "stop-loss" });
  });

  it(`markten beoordelen stopt na het tijdsbudget (${SCAN_TIME_BUDGET_MS / 1000} s); de rest blijft voor de volgende tick`, async () => {
    const h = v2(names(200));
    const feed = h.feed;
    const getCandles = feed.getCandles.bind(feed);
    const reqs: unknown[] = [];
    feed.getCandles = async (m: string, i: Interval, l: number, req?: unknown) => {
      reqs.push(req);
      h.clock.advance(1_000); // trage beurs: elk verzoek kost een seconde
      return getCandles(m, i, l);
    };
    await h.engine.tick();
    const fetched = feed.calls.length;
    expect(fetched).toBeGreaterThanOrEqual(SCAN_TIME_BUDGET_MS / 1000);
    expect(fetched).toBeLessThan(SCAN_TIME_BUDGET_MS / 1000 + 4);
    expect(fetched).toBeLessThan(SCAN_BATCH_PER_TICK);
    expect(reqs.every((r) => JSON.stringify(r) === JSON.stringify({ fast: true }))).toBe(true);
    const s = h.engine.snapshot();
    expect(s.scan).toMatchObject({ done: fetched, total: 200 });
    expect(s.radar!.some((r) => r.status === "error")).toBe(false);
    // Volgende tick: de volgende markten
    h.clock.advance(15_000);
    await h.engine.tick();
    expect(new Set(feed.calls.map((c) => c.market)).size).toBeGreaterThan(fetched);
  });

  it("rate limit (bijna) op: de overgeslagen markten tellen niet als mislukt en komen de volgende tick", async () => {
    const markets = names(10);
    const h = v2(markets);
    const feed = h.feed;
    const getCandles = feed.getCandles.bind(feed);
    let limited = true;
    feed.getCandles = async (m: string, i: Interval, l: number) => {
      if (limited && m >= "M005-EUR") throw rateLimitError(m);
      return getCandles(m, i, l);
    };
    await h.engine.tick();
    const s = h.engine.snapshot();
    expect(s.radar!.some((r) => r.status === "error")).toBe(false);
    expect(s.scan!.done).toBe(4);
    expect(allLogs(h).filter((m) => m.startsWith("Rate limit van Bitvavo bijna bereikt"))).toEqual([
      "Rate limit van Bitvavo bijna bereikt: de bot bekijkt de overige munten zodra er weer ruimte is (open posities worden gewoon bewaakt)",
    ]);
    expect(allLogs(h).some((m) => m.startsWith("Koersdata voor"))).toBe(false);
    limited = false;
    h.clock.advance(15_000);
    await h.engine.tick();
    expect(h.engine.snapshot().scan!.done).toBe(10);
  });

  it("een lange tick (trage beurs) controleert de stops tussendoor opnieuw", async () => {
    const markets = names(60);
    const h = v2(markets);
    h.signals.buyMarkets = new Set(["M001-EUR"]);
    h.signals.buyAt.add(h.lastClosed());
    await h.engine.tick(); // alle 60 markten beoordeeld, M001 gekocht
    expect(bought(h)).toEqual(["M001-EUR"]);
    const feed = h.feed as BulkFeed;
    const getCandles = feed.getCandles.bind(feed);
    feed.getCandles = async (m: string, i: Interval, l: number) => {
      if (m !== "M001-EUR") {
        h.clock.advance(1_000);
        feed.priceOverride.set("M001-EUR", 80); // de koers zakt onder de stop terwijl de bot de rest bekijkt
      }
      return getCandles(m, i, l);
    };
    h.clock.set(T0 + I15 + 60_000); // volgende candle: alle 59 andere markten weer aan de beurt
    const before = h.clock.t;
    await h.engine.tick();
    expect(h.clock.t - before).toBeLessThan(15_000); // tijdsbudget: niet alle 59 in deze tick
    expect(h.broker.sells()).toHaveLength(1);
    expect(h.engine.snapshot().trades[0]).toMatchObject({ market: "M001-EUR", exitReason: "stop-loss" });
    expect(h.broker.sells()[0].ref).toBe(80);
  });
});

describe("Echte BitvavoClient + BitvavoFeed: bijna lege publieke reserve", () => {
  /** Nep-Bitvavo (publieke endpoints) met een instelbaar resterend budget. */
  function fakeExchange(clock: Clock) {
    const state = { remaining: 900, price: 100 };
    const paths: string[] = [];
    const candleRows = () => {
      const last = Math.floor(clock.t / I15) * I15;
      return Array.from({ length: 300 }, (_, i) => {
        const t = last - i * I15;
        const p = i === 0 ? state.price : 100;
        return [t, "100", String(Math.max(100, p)), String(Math.min(100, p)), String(p), "5"];
      });
    };
    const fetchImpl = (async (input: string | URL | Request) => {
      const url = new URL(String(input));
      paths.push(url.pathname);
      const headers = {
        "bitvavo-ratelimit-remaining": String(state.remaining),
        "bitvavo-ratelimit-resetat": String(clock.t + 60_000),
      };
      let body: unknown = [];
      if (url.pathname === "/v2/markets") {
        body = [{ market: "AAA-EUR", base: "AAA", quote: "EUR", status: "trading", minOrderInQuoteAsset: "5", pricePrecision: 5 }];
      } else if (url.pathname === "/v2/AAA-EUR/candles") {
        body = candleRows();
      } else if (url.pathname === "/v2/ticker/price") {
        body = url.searchParams.get("market")
          ? { market: "AAA-EUR", price: String(state.price) }
          : [{ market: "AAA-EUR", price: String(state.price) }];
      } else if (url.pathname === "/v2/AAA-EUR/book") {
        body = { market: "AAA-EUR", bids: [["99.99", "1"]], asks: [["100.01", "1"]] };
      }
      return new Response(JSON.stringify(body), { status: 200, headers });
    }) as typeof fetch;
    return { state, paths, fetchImpl };
  }

  it("stop-loss, handmatig sluiten en de noodstop wachten niet ~60 s op de publieke reset", async () => {
    const clock = new Clock(T0 + 60_000);
    const ex = fakeExchange(clock);
    const sleeps: number[] = [];
    const client = new BitvavoClient({
      fetchImpl: ex.fetchImpl,
      now: clock.now,
      sleep: async (ms) => {
        sleeps.push(ms);
      },
    });
    const feed = new BitvavoFeed(client, { now: clock.now });
    const h = setup({ feed: feed as unknown as FakeFeed, markets: ["AAA-EUR"], clock, startingCapital: 1000 });
    h.risk.stopDist = 5;
    h.signals.buyAt.add(Math.floor(clock.t / I15) * I15 - I15);
    await h.engine.tick();
    expect(bought(h)).toEqual(["AAA-EUR"]);

    // Iets anders op hetzelfde IP heeft het publieke budget bijna opgemaakt (30 < 50 over).
    ex.state.remaining = 30;
    await client.tickerPrice("AAA-EUR");
    expect(client.rateLimitFor("public").remaining).toBe(30);

    // Stop-loss in een tick: de positie wordt meteen gecontroleerd en verkocht, zonder te wachten.
    ex.state.price = 90;
    clock.advance(15_000);
    await h.engine.tick();
    expect(sleeps).toEqual([]);
    expect(h.engine.snapshot().trades[0]).toMatchObject({ exitReason: "stop-loss" });

    // Handmatig sluiten en de noodstop: verse koers met voorrang, niet wachten.
    ex.state.price = 100;
    h.signals.buyAt.add(Math.floor(clock.t / I15) * I15);
    ex.state.remaining = 900;
    clock.set(Math.floor(clock.t / I15) * I15 + I15 + 30_000);
    await h.engine.tick();
    expect(h.engine.snapshot().positions).toHaveLength(1);
    ex.state.remaining = 30;
    await client.tickerPrice("AAA-EUR");
    const pos = h.engine.snapshot().positions[0];
    await h.engine.closePosition(pos.id);
    expect(h.engine.snapshot().positions).toHaveLength(0);
    const kill = await h.engine.killSwitch();
    expect(kill.failed).toEqual([]);
    expect(sleeps).toEqual([]);
  });
});

// ───────────────────────────── SCALE-5: capaciteit ─────────────────────────────

describe("Te veel munten voor interval + verversen", () => {
  it("waarschuwt in de radar (universe.note) en één keer in het logboek; genoeg capaciteit → geen melding", async () => {
    const h = v2(names(400), { config: { interval: "1m" as Interval, pollMs: 15_000 } });
    const note =
      'Te veel munten voor dit interval: de bot bekijkt ongeveer 266 van de 400 munten per candle (hooguit 80 per keer verversen). Kies minder munten, een langer interval of zet "Ververs elke" lager.';
    expect(h.engine.snapshot().universe).toMatchObject({ mode: "manual", count: 400, note });
    await h.engine.tick();
    h.clock.advance(15_000);
    await h.engine.tick();
    expect(allLogs(h).filter((m) => m.startsWith("Te veel munten"))).toEqual([note]);

    h.engine.updateConfig({ pollMs: 5_000 });
    expect(h.engine.snapshot().universe!.note).toBeUndefined();
    const small = v2(names(30), { config: { interval: "1m" as Interval, pollMs: 300_000 } });
    expect(small.engine.snapshot().universe!.note).toBeUndefined();
  });
});

// ───────────────────────────── BT5-3: spread op de limiet ─────────────────────────────

describe("Spreadlimiet precies op de grens (zoals de backtest)", () => {
  it("0,30% bij een limiet van 0,30% wordt gekocht; 0,32% niet", async () => {
    const h = v2(["AAA-EUR", "BBB-EUR"], { risk: { maxSpreadPct: 0.3, maxOpenPositions: 3 } });
    h.feed.books.set("AAA-EUR", { market: "AAA-EUR", bids: [[99.85, 1]], asks: [[100.15, 1]], timestamp: 0 });
    h.feed.books.set("BBB-EUR", { market: "BBB-EUR", bids: [[99.84, 1]], asks: [[100.16, 1]], timestamp: 0 });
    h.signals.buyAt.add(h.lastClosed());
    await h.engine.tick();
    expect(bought(h)).toEqual(["AAA-EUR"]);
    expect(row(h, "BBB-EUR")).toMatchObject({ status: "blocked", note: "Spread te groot (0,32% > 0,30%)" });
  });
});

// ───────────────────────────── UI-7: radar na Stop → Start ─────────────────────────────

describe("Radar na Stop → Start in dezelfde candle", () => {
  it("een al beoordeeld koopsignaal staat als 'tegengehouden' met uitleg, niet als 'wacht'", async () => {
    const h = v2(["AAA-EUR"], { config: withTrend(tf()) });
    dailyTo(h.feed, "BTC-EUR", [200, 190, 180, 170, 160, 150, 140, 130, 120, 110, 100, 100], Math.floor(T0 / DAY) * DAY);
    h.signals.buyAt.add(h.lastClosed());
    await h.engine.tick();
    expect(row(h, "AAA-EUR")).toMatchObject({ status: "blocked", action: "buy" });
    expect(row(h, "AAA-EUR").note).toMatch(/^Marktfilter: /);
    await h.engine.stop();
    h.clock.advance(15_000);
    await h.engine.tick(); // zelfde candle: niets nieuws te beoordelen
    expect(row(h, "AAA-EUR")).toMatchObject({
      status: "blocked",
      action: "buy",
      note: "Koopsignaal al beoordeeld: de bot koopt pas weer na een nieuwe candle",
    });
  });
});

// ───────────────────────────── CFG-2: live, coins die de bot niet beheert ─────────────────────────────

describe("Live, automatische muntkeuze: coins die de bot niet beheert", () => {
  it("ook de automatisch gekozen munten worden gecontroleerd (één keer per start, één saldo-opvraging)", async () => {
    const feed = new BulkFeed();
    for (const m of ["BTC-EUR", "ETH-EUR", "C05-EUR"]) feed.setSeries(m, 100, T0);
    feed.tickers = [
      ticker("BTC-EUR", { volumeQuote: 9e6 }),
      ticker("ETH-EUR", { volumeQuote: 8e6 }),
      ticker("C05-EUR", { volumeQuote: 7e6 }),
    ];
    const h = setup({
      mode: "live",
      feed,
      markets: ["BTC-EUR"],
      config: { universe: { mode: "auto", count: 3, minVolumeEur: 0 } },
    });
    h.broker.balances.set("C05", 1); // ~€100 C05 die de bot niet beheert
    let balanceCalls = 0;
    const getBalances = h.broker.getBalances.bind(h.broker);
    h.broker.getBalances = async () => {
      balanceCalls += 1;
      return getBalances();
    };
    try {
      await h.engine.start(); // start: controle op de eigen lijst (BTC); eerste tick: muntkeuze + C05
      expect(h.engine.snapshot().activeMarkets).toEqual(["BTC-EUR", "ETH-EUR", "C05-EUR"]);
      const warned = allLogs(h).filter((m) => m.includes("die de bot niet beheert"));
      expect(warned).toEqual([
        "Er staat 1 C05 (~€100,00) op Bitvavo die de bot niet beheert (geen stop-loss). Is dat van een eerdere bot-order, verkoop het dan zelf of houd het in de gaten.",
      ]);
      expect(balanceCalls).toBe(2);
      h.clock.advance(15_000);
      await h.engine.tick();
      expect(balanceCalls).toBe(2);
    } finally {
      await h.engine.stop();
    }
  });
});

