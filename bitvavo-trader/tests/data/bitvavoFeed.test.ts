import { mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { BitvavoFeed } from "../../src/data/bitvavoFeed";
import type { BitvavoClient } from "../../src/exchange/bitvavoClient";
import { INTERVAL_MS, type Candle, type Interval, type MarketInfo, type Ticker24h } from "../../src/core/types";

const MIN = 60_000;
const DAY = 86_400_000;
const NOW = Date.UTC(2026, 8, 28, 14, 37, 23, 500);

interface CandleCall {
  market: string;
  interval: Interval;
  limit?: number;
  start?: number;
  end?: number;
}

function candleAt(t: number, step: number): Candle {
  const base = 100 + 10 * Math.sin(t / (step * 50));
  return { time: t, open: base, high: base + 1, low: base - 1, close: base + 0.5, volume: 1 + ((t / step) % 7) };
}

/**
 * Nep-client met dezelfde methodes als BitvavoClient. `candles` gedraagt zich
 * als Bitvavo: de nieuwste `limit` candles in [start, end], oplopend
 * teruggegeven, inclusief de candle in vorming.
 */
function fakeClient(opts: { now: () => number; listedAt?: number; overlap?: boolean; rateLimit?: number | null } = { now: () => NOW }) {
  const calls: CandleCall[] = [];
  const counters = { markets: 0, ticker24h: [] as (string | undefined)[], tickerPrice: 0, book: [] as unknown[] };
  const listedAt = opts.listedAt ?? -Infinity;
  const client = {
    rateLimitRemaining: opts.rateLimit === undefined ? 1000 : opts.rateLimit,
    async candles(market: string, interval: Interval, o: { limit?: number; start?: number; end?: number } = {}) {
      calls.push({ market, interval, ...o });
      const step = INTERVAL_MS[interval];
      const limit = Math.min(1440, o.limit ?? 1440);
      const lastT = Math.floor(opts.now() / step) * step;
      const endT = Math.min(o.end !== undefined ? Math.floor(o.end / step) * step : lastT, lastT);
      const startT = Math.max(o.start !== undefined ? Math.ceil(o.start / step) * step : -Infinity, listedAt);
      const out: Candle[] = [];
      for (let t = endT; t >= startT && out.length < limit; t -= step) out.push(candleAt(t, step));
      out.reverse();
      // Sommige API's leveren een overlappende candle mee: moet ontdubbeld worden
      if (opts.overlap && out.length > 0 && endT + step <= lastT) out.push(candleAt(endT + step, step));
      if (opts.overlap && out.length > 1) out.splice(1, 0, { ...out[0] });
      return out;
    },
    async markets(): Promise<MarketInfo[]> {
      counters.markets++;
      return [
        {
          market: "BTC-EUR",
          base: "BTC",
          quote: "EUR",
          status: "trading",
          minOrderQuote: 5,
          minOrderBase: 0.0001,
          pricePrecision: 5,
          quantityDecimals: 8,
          notionalDecimals: 2,
        },
      ];
    },
    async ticker24h(market?: string): Promise<Ticker24h[]> {
      counters.ticker24h.push(market);
      const all = ["BTC-EUR", "ETH-EUR", "SOL-EUR"].map((m, i) => ({
        market: m,
        last: 100 + i,
        open: 99,
        high: 110,
        low: 90,
        volume: 10,
        volumeQuote: 1000,
        bid: 99.9,
        ask: 100.1,
        changePct: 1,
        timestamp: NOW,
      }));
      return market ? all.filter((t) => t.market === market) : all;
    },
    async tickerPrice(market?: string) {
      counters.tickerPrice++;
      const all = [
        { market: "BTC-EUR", price: 91234 },
        { market: "ETH-EUR", price: 3456 },
      ];
      return market ? all.filter((p) => p.market === market) : all;
    },
    async book(market: string, depth?: number) {
      counters.book.push([market, depth]);
      return { market, bids: [[99, 1]] as [number, number][], asks: [[101, 1]] as [number, number][], timestamp: NOW };
    },
    async time() {
      return opts.now();
    },
  };
  return { client: client as unknown as BitvavoClient, raw: client, calls, counters };
}

function expectCleanHistory(candles: Candle[], interval: Interval, from: number, now: number): void {
  const step = INTERVAL_MS[interval];
  for (let i = 0; i < candles.length; i++) {
    expect(candles[i].time).toBeGreaterThanOrEqual(from);
    expect(candles[i].time + step).toBeLessThanOrEqual(now);
    if (i > 0) expect(candles[i].time - candles[i - 1].time).toBe(step);
  }
}

describe("BitvavoFeed — getHistory paginering", () => {
  it("pagineert achterwaarts met end = oudste - 1 en limit 1440 tot fromMs gedekt is", async () => {
    const { client, calls } = fakeClient({ now: () => NOW });
    const feed = new BitvavoFeed(client, { now: () => NOW });
    const from = NOW - 3 * DAY - 17 * MIN;
    const candles = await feed.getHistory("BTC-EUR", "1m", from, NOW);

    const expectedFirst = Math.ceil(from / MIN) * MIN;
    const expectedLast = Math.floor(NOW / MIN) * MIN - MIN;
    expect(candles[0].time).toBe(expectedFirst);
    expect(candles.at(-1)!.time).toBe(expectedLast);
    expect(candles.length).toBe((expectedLast - expectedFirst) / MIN + 1);
    expectCleanHistory(candles, "1m", from, NOW);

    expect(calls.length).toBeGreaterThanOrEqual(3);
    expect(calls.length).toBeLessThanOrEqual(5);
    for (const c of calls) {
      expect(c.limit).toBe(1440);
      expect(c.market).toBe("BTC-EUR");
      expect(c.interval).toBe("1m");
    }
    // elke volgende pagina eindigt vlak vóór de oudste candle van de vorige
    const pages = await Promise.all(
      calls.map((c) => fakeClient({ now: () => NOW }).raw.candles(c.market, c.interval, c)),
    );
    for (let i = 1; i < calls.length; i++) {
      if (pages[i - 1].length === 0) break;
      expect(calls[i].end).toBe(pages[i - 1][0].time - 1);
    }
  });

  it("ontdubbelt overlappende candles en geeft alleen gesloten candles", async () => {
    const { client } = fakeClient({ now: () => NOW, overlap: true });
    const feed = new BitvavoFeed(client, { now: () => NOW });
    const from = NOW - 2 * DAY;
    const candles = await feed.getHistory("ETH-EUR", "5m", from, NOW + DAY);
    const times = candles.map((c) => c.time);
    expect(new Set(times).size).toBe(times.length);
    expectCleanHistory(candles, "5m", from, NOW);
    expect(candles.at(-1)!.time).toBe(Math.floor(NOW / (5 * MIN)) * 5 * MIN - 5 * MIN);
    expect(candles.length).toBe(Math.floor((candles.at(-1)!.time - Math.ceil(from / (5 * MIN)) * 5 * MIN) / (5 * MIN)) + 1);
  });

  it("stopt netjes als de markt pas later genoteerd is", async () => {
    const listedAt = Math.floor((NOW - 1.5 * DAY) / MIN) * MIN;
    const { client, calls } = fakeClient({ now: () => NOW, listedAt });
    const feed = new BitvavoFeed(client, { now: () => NOW });
    const candles = await feed.getHistory("NEW-EUR", "1m", NOW - 30 * DAY, NOW);
    expect(candles[0].time).toBe(listedAt);
    expect(calls.length).toBeLessThanOrEqual(4);
  });

  it("respecteert toMs en geeft [] bij een leeg bereik", async () => {
    const { client } = fakeClient({ now: () => NOW });
    const feed = new BitvavoFeed(client, { now: () => NOW });
    const to = NOW - DAY;
    const candles = await feed.getHistory("BTC-EUR", "1h", NOW - 5 * DAY, to);
    expect(candles.at(-1)!.time).toBeLessThanOrEqual(to);
    expect(candles.at(-1)!.time).toBe(Math.floor(to / 3600_000) * 3600_000);
    expect(await feed.getHistory("BTC-EUR", "1h", NOW, NOW - DAY)).toEqual([]);
  });

  it("pauzeert als de rate limit bijna op is", async () => {
    const low = fakeClient({ now: () => NOW, rateLimit: 50 });
    const slowFeed = new BitvavoFeed(low.client, { now: () => NOW, rateLimitPauseMs: 40 });
    const t0 = Date.now();
    await slowFeed.getHistory("BTC-EUR", "1m", NOW - 1.5 * DAY, NOW);
    const pages = low.calls.length;
    expect(pages).toBeGreaterThanOrEqual(2);
    expect(Date.now() - t0).toBeGreaterThanOrEqual(pages * 40 - 5);

    const ok = fakeClient({ now: () => NOW, rateLimit: 900 });
    const fastFeed = new BitvavoFeed(ok.client, { now: () => NOW, rateLimitPauseMs: 5000 });
    const t1 = Date.now();
    await fastFeed.getHistory("BTC-EUR", "1m", NOW - 1.5 * DAY, NOW);
    expect(Date.now() - t1).toBeLessThan(1000);
  });
});

describe("BitvavoFeed — schijfcache", () => {
  const dirs: string[] = [];
  const tmp = (): string => {
    const d = mkdtempSync(join(tmpdir(), "bitvavo-feed-test-"));
    dirs.push(d);
    return d;
  };
  afterEach(() => {
    for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
  });

  it("slaat gesloten candles op en haalt daarna alleen het ontbrekende deel op", async () => {
    const dir = tmp();
    let now = NOW;
    const from = NOW - 20 * DAY;

    const first = fakeClient({ now: () => now });
    const feed1 = new BitvavoFeed(first.client, { now: () => now, cacheDir: dir });
    const h1 = await feed1.getHistory("BTC-EUR", "15m", from, now);
    expect(first.calls.length).toBeGreaterThanOrEqual(2);
    expect(readdirSync(dir)).toEqual(["BTC-EUR_15m.json"]);
    const file = JSON.parse(readFileSync(join(dir, "BTC-EUR_15m.json"), "utf8"));
    expect(file.candles.length).toBe(h1.length);

    // Nieuwe instantie, zelfde moment: alles uit de cache
    const second = fakeClient({ now: () => now });
    const feed2 = new BitvavoFeed(second.client, { now: () => now, cacheDir: dir });
    const h2 = await feed2.getHistory("BTC-EUR", "15m", from, now);
    expect(second.calls.length).toBe(0);
    expect(h2).toEqual(h1);

    // Twee uur later: alleen het nieuwere deel ophalen
    now = NOW + 2 * 3600_000;
    const lastCached = h1.at(-1)!.time;
    const h3 = await feed2.getHistory("BTC-EUR", "15m", from, now);
    expect(second.calls.length).toBeGreaterThanOrEqual(1);
    for (const c of second.calls) expect(c.start).toBeGreaterThan(lastCached);
    const reference = await new BitvavoFeed(fakeClient({ now: () => now }).client, { now: () => now }).getHistory(
      "BTC-EUR",
      "15m",
      from,
      now,
    );
    expect(h3).toEqual(reference);
    expect(h3.length).toBe(h1.length + 8);

    // Verder terug: alleen het oudere deel ophalen
    const third = fakeClient({ now: () => now });
    const feed3 = new BitvavoFeed(third.client, { now: () => now, cacheDir: dir });
    const olderFrom = from - 5 * DAY;
    const h4 = await feed3.getHistory("BTC-EUR", "15m", olderFrom, now);
    expect(third.calls.length).toBeGreaterThanOrEqual(1);
    // (end = laatste ontbrekende opentijd + interval - 1, zodat inclusief/exclusief `end` beide werkt)
    for (const c of third.calls) expect(c.end!).toBeLessThan(from + 15 * MIN);
    const ref4 = await new BitvavoFeed(fakeClient({ now: () => now }).client, { now: () => now }).getHistory(
      "BTC-EUR",
      "15m",
      olderFrom,
      now,
    );
    expect(h4).toEqual(ref4);

    // Een deelbereik binnen de cache: geen enkele request
    const fourth = fakeClient({ now: () => now });
    const feed4 = new BitvavoFeed(fourth.client, { now: () => now, cacheDir: dir });
    const a = Math.ceil((from + DAY) / (15 * MIN)) * 15 * MIN;
    const sub = await feed4.getHistory("BTC-EUR", "15m", a, a + DAY);
    expect(fourth.calls.length).toBe(0);
    expect(sub.length).toBe(97);
    expect(sub[0].time).toBe(a);
    expect(sub.at(-1)!.time).toBe(a + DAY);
  });

  it("negeert een corrupte cache", async () => {
    const dir = tmp();
    writeFileSync(join(dir, "ETH-EUR_1h.json"), "{ dit is geen json");
    const { client, calls } = fakeClient({ now: () => NOW });
    const feed = new BitvavoFeed(client, { now: () => NOW, cacheDir: dir });
    const h = await feed.getHistory("ETH-EUR", "1h", NOW - 3 * DAY, NOW);
    expect(calls.length).toBeGreaterThanOrEqual(1);
    expect(h.length).toBe(3 * 24 - 1);
    const saved = JSON.parse(readFileSync(join(dir, "ETH-EUR_1h.json"), "utf8"));
    expect(saved.candles.length).toBe(h.length);
  });
});

describe("BitvavoFeed — overige methodes", () => {
  it("cachet markten 1 uur", async () => {
    let now = NOW;
    const { client, counters } = fakeClient({ now: () => now });
    const feed = new BitvavoFeed(client, { now: () => now });
    expect((await feed.getMarkets())[0].market).toBe("BTC-EUR");
    await feed.getMarkets();
    now += 30 * MIN;
    await feed.getMarkets();
    expect(counters.markets).toBe(1);
    now += 31 * MIN;
    await feed.getMarkets();
    expect(counters.markets).toBe(2);
  });

  it("getCandles begrenst de limit tot 1440 en levert oplopend", async () => {
    const { client, calls } = fakeClient({ now: () => NOW });
    const feed = new BitvavoFeed(client, { now: () => NOW });
    const candles = await feed.getCandles("BTC-EUR", "15m", 5000);
    expect(calls[0].limit).toBe(1440);
    expect(candles.length).toBe(1440);
    for (let i = 1; i < candles.length; i++) expect(candles[i].time).toBeGreaterThan(candles[i - 1].time);
    // de laatste mag in vorming zijn
    expect(candles.at(-1)!.time).toBe(Math.floor(NOW / (15 * MIN)) * 15 * MIN);
    expect((await feed.getCandles("BTC-EUR", "15m", 10)).length).toBe(10);
    expect(await feed.getCandles("BTC-EUR", "15m", 0)).toEqual([]);
  });

  it("getTickers24h filtert op markten", async () => {
    const { client, counters } = fakeClient({ now: () => NOW });
    const feed = new BitvavoFeed(client, { now: () => NOW });
    expect((await feed.getTickers24h()).length).toBe(3);
    expect((await feed.getTickers24h(["SOL-EUR", "BTC-EUR", "XXX-EUR"])).map((t) => t.market).sort()).toEqual([
      "BTC-EUR",
      "SOL-EUR",
    ]);
    expect((await feed.getTickers24h(["ETH-EUR"])).map((t) => t.market)).toEqual(["ETH-EUR"]);
    expect(counters.ticker24h.at(-1)).toBe("ETH-EUR");
    expect(await feed.getTickers24h([])).toEqual([]);
  });

  it("getPrice via tickerPrice, met Nederlandse fout als er geen prijs is", async () => {
    const { client } = fakeClient({ now: () => NOW });
    const feed = new BitvavoFeed(client, { now: () => NOW });
    expect(await feed.getPrice("ETH-EUR")).toBe(3456);
    await expect(feed.getPrice("DOGE-EUR")).rejects.toThrow(/Geen actuele prijs/);
  });

  it("getOrderBook via book (met depth)", async () => {
    const { client, counters } = fakeClient({ now: () => NOW });
    const feed = new BitvavoFeed(client, { now: () => NOW });
    const book = await feed.getOrderBook("BTC-EUR", 10);
    expect(book.bids[0]).toEqual([99, 1]);
    expect(counters.book).toEqual([["BTC-EUR", 10]]);
    expect(feed.source).toBe("bitvavo");
  });
});
