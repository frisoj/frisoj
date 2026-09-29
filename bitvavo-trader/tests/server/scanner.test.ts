import { afterEach, describe, expect, it } from "vitest";
import { DEFAULT_ENGINE_CONFIG } from "../../src/core/defaults";
import type { MarketInfo, Ticker24h } from "../../src/core/types";
import { SCANNER_DEFAULT_LIMIT, SCANNER_MAX_LIMIT, Scanner, scanSize } from "../../src/server/scanner";
import { FakeFeed, NOW, json, makeServices, startTestServer, type TestServer } from "./helpers";

/** Feed met 80 verhandelbare EUR-markten (meer dan de maximale scan van 60). */
class ManyMarketsFeed extends FakeFeed {
  readonly names = Array.from({ length: 80 }, (_v, i) => `M${String(i).padStart(2, "0")}-EUR`);

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

describe("API: /api/scanner met oplopende limits", () => {
  let srv: TestServer | null = null;
  afterEach(async () => {
    await srv?.close();
    srv = null;
  });

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
