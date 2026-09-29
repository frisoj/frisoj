import { afterEach, describe, expect, it } from "vitest";
import { DEFAULT_ENGINE_CONFIG } from "../../src/core/defaults";
import type { Candle, Interval, MarketInfo, Ticker24h } from "../../src/core/types";
import { SCANNER_DEFAULT_LIMIT, SCANNER_MAX_LIMIT, Scanner, scanSize } from "../../src/server/scanner";
import { FakeFeed, NOW, json, makeServices, startTestServer, type TestServer } from "./helpers";

/** Feed met `count` (standaard 80, meer dan de maximale scan van 60) verhandelbare EUR-markten. */
class ManyMarketsFeed extends FakeFeed {
  readonly names: string[];

  constructor(count = 80) {
    super();
    this.names = Array.from({ length: count }, (_v, i) => `M${String(i).padStart(2, "0")}-EUR`);
  }

  override async getMarkets(): Promise<MarketInfo[]> {
    this.marketsCalls++;
    return this.names.map((m) => ({
      market: m,
      base: m.split("-")[0],
      quote: "EUR",
      status: "trading",
      minOrderQuote: 5,
      minOrderBase: 0.0001,
      pricePrecision: 5,
      quantityDecimals: 8,
      notionalDecimals: 2,
    }));
  }
  override async getTickers24h(): Promise<Ticker24h[]> {
    this.tickerCalls++;
    // M00 heeft het hoogste volume, M79 het laagste
    return this.names.map((m, i) => ({
      market: m,
      last: 10,
      open: 10,
      high: 11,
      low: 9,
      volume: 1000 - i,
      volumeQuote: (1000 - i) * 10,
      bid: 9.99,
      ask: 10.01,
      changePct: 0,
      timestamp: NOW,
    }));
  }
}

let srv: TestServer | null = null;
afterEach(async () => {
  await srv?.close();
  srv = null;
});

function makeScanner(feed: FakeFeed, clock: { now: number }) {
  const { services } = makeServices();
  return new Scanner({ feed, services, now: () => clock.now, cacheMs: 60_000, log: () => {} });
}

const ENS = DEFAULT_ENGINE_CONFIG.ensemble;

describe("Scanner: vaste scangrootte per cachevenster", () => {
  it("scanSize: 30 tot en met 30, daarboven 60", () => {
    expect(scanSize(1)).toBe(SCANNER_DEFAULT_LIMIT);
    expect(scanSize(30)).toBe(30);
    expect(scanSize(31)).toBe(SCANNER_MAX_LIMIT);
    expect(scanSize(60)).toBe(60);
  });

  it("oplopende limits 1..60 kosten hooguit twee scans in plaats van één per limit", async () => {
    const feed = new ManyMarketsFeed();
    const clock = { now: NOW };
    const scanner = makeScanner(feed, clock);
    const full = await scanner.scan(60, "15m", ENS);
    expect(full.map((r) => r.market)).toEqual(feed.names.slice(0, 60));
    feed.tickerCalls = 0;
    feed.candleCalls = [];
    scanner.clearCache();

    for (let n = 1; n <= 60; n++) {
      const rows = await scanner.scan(n, "15m", ENS);
      expect(rows.map((r) => r.market)).toEqual(feed.names.slice(0, n));
    }
    // Eén scan van 30 (limits 1..30) en één van 60 (31..60); vóór de fix was dit 60 scans.
    expect(feed.tickerCalls).toBe(2);
    expect(feed.candleCalls).toHaveLength(30 + 60);

    // Hetzelfde nog eens binnen het cachevenster: helemaal geen feed-verzoeken meer.
    for (let n = 60; n >= 1; n--) await scanner.scan(n, "15m", ENS);
    for (let n = 1; n <= 60; n++) await scanner.scan(n, "15m", ENS);
    expect(feed.tickerCalls).toBe(2);
    expect(feed.candleCalls).toHaveLength(90);
  });

  it("limits tot 30 (zoals het dashboard) delen één scan van 30 markten", async () => {
    const feed = new ManyMarketsFeed();
    const clock = { now: NOW };
    const scanner = makeScanner(feed, clock);
    for (let n = 1; n <= 30; n++) await scanner.scan(n, "15m", ENS);
    expect(feed.tickerCalls).toBe(1);
    expect(feed.candleCalls).toHaveLength(30);
  });

  it("na het cachevenster wordt er één keer opnieuw gescand", async () => {
    const feed = new ManyMarketsFeed();
    const clock = { now: NOW };
    const scanner = makeScanner(feed, clock);
    await scanner.scan(10, "15m", ENS);
    await scanner.scan(20, "15m", ENS);
    expect(feed.tickerCalls).toBe(1);
    clock.now += 60_000;
    for (let n = 1; n <= 30; n++) await scanner.scan(n, "15m", ENS);
    expect(feed.tickerCalls).toBe(2);
    expect(feed.candleCalls).toHaveLength(60);
  });

  it("met minder dan 30 markten bedient de eerste scan ook grotere limits", async () => {
    const feed = new FakeFeed(); // 4 verhandelbare EUR-markten
    const clock = { now: NOW };
    const scanner = makeScanner(feed, clock);
    for (let n = 1; n <= 60; n++) await scanner.scan(n, "15m", ENS);
    expect(feed.tickerCalls).toBe(1);
    expect(feed.candleCalls).toHaveLength(4);
    expect((await scanner.scan(60, "15m", ENS)).map((r) => r.market)).toEqual(["BTC-EUR", "ETH-EUR", "SOL-EUR", "ADA-EUR"]);
  });

  it("gelijktijdige oplopende limits starten hooguit twee scans", async () => {
    const feed = new ManyMarketsFeed();
    const clock = { now: NOW };
    const scanner = makeScanner(feed, clock);
    const all = await Promise.all(Array.from({ length: 60 }, (_v, i) => scanner.scan(i + 1, "15m", ENS)));
    all.forEach((rows, i) => expect(rows).toHaveLength(i + 1));
    expect(feed.tickerCalls).toBeLessThanOrEqual(2);
    expect(feed.candleCalls.length).toBeLessThanOrEqual(90);
  });
});

/** Feed waarvan getCandles wacht op een poort; telt hoeveel candle-verzoeken er tegelijk lopen. */
class GatedFeed extends ManyMarketsFeed {
  private release: (() => void) | null = null;
  private gate: Promise<void> | null = null;
  active = 0;
  maxActive = 0;
  failInterval: string | null = null;

  close(): void {
    this.gate ??= new Promise<void>((resolve) => (this.release = resolve));
  }
  open(): void {
    this.release?.();
    this.gate = null;
    this.release = null;
  }
  override async getCandles(m: string, interval: Interval, limit: number): Promise<Candle[]> {
    this.active++;
    this.maxActive = Math.max(this.maxActive, this.active);
    try {
      if (this.gate) await this.gate;
      if (interval === this.failInterval) {
        this.candleCalls.push({ market: m, interval, limit });
        throw new Error("netwerkfout");
      }
      return await super.getCandles(m, interval, limit);
    } finally {
      this.active--;
    }
  }
}

const settle = () => new Promise((r) => setTimeout(r, 20));

describe("Scanner: complete = alle beschikbare markten gescand", () => {
  it("precies 30 EUR-markten: limit 31..60 gebruikt de scan van 30 (geen nieuwe scan)", async () => {
    const feed = new ManyMarketsFeed(30);
    const clock = { now: NOW };
    const scanner = makeScanner(feed, clock);
    expect(await scanner.scan(30, "15m", ENS)).toHaveLength(30);
    for (const n of [31, 45, 60]) {
      const rows = await scanner.scan(n, "15m", ENS);
      expect(rows.map((r) => r.market)).toEqual(feed.names);
    }
    expect(feed.tickerCalls).toBe(1);
    expect(feed.candleCalls).toHaveLength(30);
  });

  it("precies 60 EUR-markten: de scan van 60 is compleet", async () => {
    const feed = new ManyMarketsFeed(60);
    const scanner = makeScanner(feed, { now: NOW });
    expect(await scanner.scan(60, "15m", ENS)).toHaveLength(60);
    expect(await scanner.scan(10, "15m", ENS)).toHaveLength(10);
    expect(feed.tickerCalls).toBe(1);
  });

  it("31 EUR-markten: limit 31 heeft wél een nieuwe (grotere) scan nodig", async () => {
    const feed = new ManyMarketsFeed(31);
    const scanner = makeScanner(feed, { now: NOW });
    expect(await scanner.scan(30, "15m", ENS)).toHaveLength(30);
    const rows = await scanner.scan(31, "15m", ENS);
    expect(rows.map((r) => r.market)).toEqual(feed.names);
    expect(feed.tickerCalls).toBe(2);
    expect(feed.candleCalls).toHaveLength(30 + 31);
    // Die scan van 31 is compleet: daarna geen verzoeken meer
    await scanner.scan(60, "15m", ENS);
    expect(feed.tickerCalls).toBe(2);
  });

  it("API: precies 30 markten → ?limit=30 en daarna ?limit=31 kosten één scan", async () => {
    const feed = new ManyMarketsFeed(30);
    srv = await startTestServer({ feed });
    const a = await json(srv.base, "GET", "/api/scanner?limit=30");
    const b = await json(srv.base, "GET", "/api/scanner?limit=31");
    expect(a.status).toBe(200);
    expect(b.status).toBe(200);
    expect(b.data).toHaveLength(30);
    expect(feed.tickerCalls).toBe(1);
    expect(feed.candleCalls).toHaveLength(30);
  });
});

describe("Scanner: hooguit één scan tegelijk", () => {
  it("een grotere limit wacht op de lopende (kleinere) scan in plaats van parallel te scannen", async () => {
    const feed = new GatedFeed();
    const scanner = makeScanner(feed, { now: NOW });
    feed.close();
    const small = scanner.scan(10, "15m", ENS);
    await settle();
    const big = scanner.scan(40, "15m", ENS);
    const again = scanner.scan(50, "15m", ENS);
    await settle();
    // Alleen de eerste scan loopt (vóór de fix startte limit=40 meteen een tweede scan)
    expect(feed.tickerCalls).toBe(1);
    feed.open();
    const [s, b, a] = await Promise.all([small, big, again]);
    expect(s).toHaveLength(10);
    expect(b.map((r) => r.market)).toEqual(feed.names.slice(0, 40));
    expect(a).toHaveLength(50);
    // Eén scan van 30 en daarna één (gedeelde) scan van 60, nooit tegelijk
    expect(feed.tickerCalls).toBe(2);
    expect(feed.candleCalls).toHaveLength(30 + 60);
    expect(feed.maxActive).toBeLessThanOrEqual(4);
  });

  it("gelijktijdige verzoeken met dezelfde grootte delen één scan", async () => {
    const feed = new GatedFeed();
    const scanner = makeScanner(feed, { now: NOW });
    feed.close();
    const all = Array.from({ length: 10 }, (_v, i) => scanner.scan(i + 1, "15m", ENS));
    await settle();
    feed.open();
    const rows = await Promise.all(all);
    rows.forEach((r, i) => expect(r).toHaveLength(i + 1));
    expect(feed.tickerCalls).toBe(1);
    expect(feed.candleCalls).toHaveLength(30);
  });

  it("een kleine lopende scan die alle markten omvat, bedient ook de wachtende grotere limit", async () => {
    const feed = new GatedFeed(20);
    const scanner = makeScanner(feed, { now: NOW });
    feed.close();
    const small = scanner.scan(5, "15m", ENS);
    await settle();
    const big = scanner.scan(60, "15m", ENS);
    await settle();
    feed.open();
    expect(await small).toHaveLength(5);
    expect((await big).map((r) => r.market)).toEqual(feed.names);
    expect(feed.tickerCalls).toBe(1);
    expect(feed.candleCalls).toHaveLength(20);
  });

  it("andere instellingen (interval) wachten ook op de lopende scan", async () => {
    const feed = new GatedFeed();
    const scanner = makeScanner(feed, { now: NOW });
    feed.close();
    const a = scanner.scan(10, "15m", ENS);
    await settle();
    const b = scanner.scan(10, "1h", ENS);
    await settle();
    expect(feed.tickerCalls).toBe(1);
    expect(feed.candleCalls.every((c) => c.interval === "15m")).toBe(true);
    feed.open();
    expect(await a).toHaveLength(10);
    expect(await b).toHaveLength(10);
    expect(feed.tickerCalls).toBe(2);
    expect(feed.maxActive).toBeLessThanOrEqual(4);
  });

  it("een mislukte lopende scan laat een wachtend verzoek met andere instellingen niet mislukken", async () => {
    const feed = new GatedFeed();
    feed.failInterval = "15m";
    const scanner = makeScanner(feed, { now: NOW });
    feed.close();
    const failing = scanner.scan(10, "15m", ENS);
    const failingShared = scanner.scan(20, "15m", ENS);
    await settle();
    const other = scanner.scan(10, "1h", ENS);
    await settle();
    feed.open();
    await expect(failing).rejects.toThrow(/geen enkele markt/);
    await expect(failingShared).rejects.toThrow(/geen enkele markt/);
    expect(await other).toHaveLength(10);
    // Na de fout kan dezelfde scan gewoon opnieuw geprobeerd worden
    feed.failInterval = null;
    expect(await scanner.scan(10, "15m", ENS)).toHaveLength(10);
  });
});

describe("API: /api/scanner met oplopende limits", () => {
  it("?limit=1..60 → hooguit twee scans (feed-verzoeken geteld)", async () => {
    const feed = new ManyMarketsFeed();
    srv = await startTestServer({ feed });
    for (let n = 1; n <= 60; n++) {
      const r = await json(srv.base, "GET", `/api/scanner?limit=${n}`);
      expect(r.status).toBe(200);
      expect(r.data).toHaveLength(n);
    }
    expect(feed.tickerCalls).toBe(2);
    expect(feed.candleCalls).toHaveLength(90);
  });
});
