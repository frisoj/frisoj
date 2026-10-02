import { describe, expect, it } from "vitest";
import { SIMULATED_MARKETS, SIM_MAX_HISTORY_DAYS, SimulatedFeed } from "../../src/data/simulatedFeed";
import { INTERVALS, INTERVAL_MS, type Candle, type Interval } from "../../src/core/types";
import { isClosedCandle } from "../../src/core/util";

const DAY = 86_400_000;
const MIN = 60_000;
/** Vast "nu": midden in een minuut, niet op een candlegrens. */
const NOW = Date.UTC(2026, 8, 28, 14, 37, 23, 500);

function feedAt(now: number, seed?: number): SimulatedFeed {
  return new SimulatedFeed({ now: () => now, seed });
}

function aggregate(parts: Candle[]): Omit<Candle, "time"> {
  let high = -Infinity;
  let low = Infinity;
  let volume = 0;
  for (const c of parts) {
    if (c.high > high) high = c.high;
    if (c.low < low) low = c.low;
    volume += c.volume;
  }
  return { open: parts[0].open, high, low, close: parts[parts.length - 1].close, volume };
}

function expectValidOhlc(candles: Candle[]): void {
  for (const c of candles) {
    expect(c.low).toBeGreaterThan(0);
    expect(c.low).toBeLessThanOrEqual(Math.min(c.open, c.close));
    expect(c.high).toBeGreaterThanOrEqual(Math.max(c.open, c.close));
    expect(c.volume).toBeGreaterThanOrEqual(0);
    for (const v of [c.open, c.high, c.low, c.close, c.volume]) expect(Number.isFinite(v)).toBe(true);
  }
}

function logReturns(candles: Candle[]): number[] {
  return candles.slice(1).map((c, i) => Math.log(c.close / candles[i].close));
}

function stdev(x: number[]): number {
  const m = x.reduce((a, b) => a + b, 0) / x.length;
  return Math.sqrt(x.reduce((a, b) => a + (b - m) ** 2, 0) / x.length);
}

function autocorr(x: number[], lag: number): number {
  const m = x.reduce((a, b) => a + b, 0) / x.length;
  let num = 0;
  let den = 0;
  for (let i = 0; i < x.length; i++) {
    den += (x[i] - m) ** 2;
    if (i >= lag) num += (x[i] - m) * (x[i - lag] - m);
  }
  return num / den;
}

describe("SimulatedFeed — markten", () => {
  it("levert ~60 EUR-markten met realistische MarketInfo", async () => {
    const markets = await feedAt(NOW).getMarkets();
    expect(markets.length).toBeGreaterThanOrEqual(55);
    const names = markets.map((m) => m.market);
    expect(new Set(names).size).toBe(names.length);
    for (const m of ["BTC-EUR", "ETH-EUR", "SOL-EUR", "XRP-EUR", "ADA-EUR", "DOGE-EUR", "PEPE-EUR", "SUI-EUR", "USDC-EUR", "BONK-EUR", "TAO-EUR"]) {
      expect(names).toContain(m);
    }
    for (const m of markets) {
      expect(m.quote).toBe("EUR");
      expect(m.market).toBe(`${m.base}-EUR`);
      expect(m.status).toBe("trading");
      expect(m.minOrderQuote).toBe(5);
      expect(m.pricePrecision).toBe(5);
      expect(m.notionalDecimals).toBe(2);
      expect(m.quantityDecimals).toBeGreaterThanOrEqual(0);
      expect(m.minOrderBase).toBeGreaterThan(0);
    }
    expect(SIMULATED_MARKETS.length).toBe(markets.length);
  });

  it("respecteert opts.markets", async () => {
    const feed = new SimulatedFeed({ now: () => NOW, markets: ["BTC-EUR", "ETH-EUR"] });
    expect((await feed.getMarkets()).map((m) => m.market)).toEqual(["BTC-EUR", "ETH-EUR"]);
    expect((await feed.getTickers24h()).map((t) => t.market)).toEqual(["BTC-EUR", "ETH-EUR"]);
  });

  it("heeft realistische prijsniveaus", async () => {
    const feed = feedAt(NOW);
    const bands: Record<string, [number, number]> = {
      "BTC-EUR": [40_000, 200_000],
      "ETH-EUR": [1_400, 9_000],
      "SOL-EUR": [60, 550],
      "XRP-EUR": [0.8, 7],
      "DOGE-EUR": [0.06, 0.7],
      "PEPE-EUR": [0.000002, 0.00004],
    };
    for (const [m, [lo, hi]] of Object.entries(bands)) {
      const p = await feed.getPrice(m);
      expect(p, m).toBeGreaterThan(lo);
      expect(p, m).toBeLessThan(hi);
    }
  });

  it("ondersteunt ook onbekende (geldig geformatteerde) markten deterministisch", async () => {
    const a = await feedAt(NOW).getPrice("FOO-EUR");
    expect(Number.isFinite(a) && a > 0).toBe(true);
    expect(await feedAt(NOW).getPrice("foo-eur")).toBe(a);
    expect(await feedAt(NOW, 5).getPrice("FOO-EUR")).not.toBe(a);
  });

  it("gooit een Nederlandse fout bij een ongeldige markt of interval", async () => {
    const feed = feedAt(NOW);
    await expect(feed.getCandles("geen markt", "15m", 10)).rejects.toThrow(/Onbekende markt/);
    await expect(feed.getPrice("")).rejects.toThrow(/Onbekende markt/);
    await expect(feed.getCandles("BTC-EUR", "3m" as Interval, 10)).rejects.toThrow(/Ongeldig interval/);
  });
});

describe("SimulatedFeed — determinisme", () => {
  it("zelfde seed → identieke historie, andere seed → andere historie", async () => {
    const from = NOW - 10 * DAY;
    const a = await feedAt(NOW, 7).getHistory("ETH-EUR", "15m", from, NOW);
    const b = await feedAt(NOW, 7).getHistory("ETH-EUR", "15m", from, NOW);
    const c = await feedAt(NOW, 8).getHistory("ETH-EUR", "15m", from, NOW);
    expect(a.length).toBe(10 * 96 - 1); // de candle in vorming telt niet mee
    expect(b).toEqual(a);
    expect(c.length).toBe(a.length);
    expect(c.map((x) => x.close)).not.toEqual(a.map((x) => x.close));
  });

  it("resultaat hangt niet af van de volgorde van opvragen (cache-onafhankelijk)", async () => {
    const f1 = feedAt(NOW, 3);
    const f2 = feedAt(NOW, 3);
    // f2 warmt eerst andere markten/perioden op
    await f2.getHistory("SOL-EUR", "1h", NOW - 40 * DAY, NOW);
    await f2.getTickers24h();
    await f2.getHistory("BTC-EUR", "1d", NOW - 300 * DAY, NOW);
    const a = await f1.getHistory("BTC-EUR", "5m", NOW - 3 * DAY, NOW - DAY);
    const b = await f2.getHistory("BTC-EUR", "5m", NOW - 3 * DAY, NOW - DAY);
    expect(b).toEqual(a);
    expect(await f2.getCandles("BTC-EUR", "1m", 30)).toEqual(await f1.getCandles("BTC-EUR", "1m", 30));
  });

  it("historie verandert niet als de tijd verstrijkt", async () => {
    let now = NOW;
    const feed = new SimulatedFeed({ now: () => now });
    const before = await feed.getHistory("SOL-EUR", "15m", NOW - 2 * DAY, NOW);
    now = NOW + 5 * 3600_000;
    const after = await feed.getHistory("SOL-EUR", "15m", NOW - 2 * DAY, NOW);
    // de candle die om NOW nog in vorming was, is er nu gesloten bij gekomen
    expect(after.length).toBe(before.length + 1);
    expect(after.slice(0, before.length)).toEqual(before);
  });
});

describe("SimulatedFeed — geen toekomstdata", () => {
  it("laatste candle ≤ nu, alleen de laatste is in vorming, close == getPrice", async () => {
    const feed = feedAt(NOW);
    const price = await feed.getPrice("BTC-EUR");
    for (const interval of INTERVALS) {
      const step = INTERVAL_MS[interval];
      const candles = await feed.getCandles("BTC-EUR", interval, 50);
      expect(candles.length, interval).toBe(50);
      const last = candles[candles.length - 1];
      expect(last.time).toBeLessThanOrEqual(NOW);
      expect(last.time).toBe(Math.floor(NOW / step) * step);
      expect(isClosedCandle(last, interval, NOW)).toBe(false);
      for (const c of candles.slice(0, -1)) expect(isClosedCandle(c, interval, NOW)).toBe(true);
      expect(last.close, interval).toBe(price);
      expect(last.high).toBeGreaterThanOrEqual(price);
      expect(last.low).toBeLessThanOrEqual(price);
      for (let i = 1; i < candles.length; i++) expect(candles[i].time - candles[i - 1].time).toBe(step);
    }
  });

  it("getHistory geeft alleen gesloten candles, ook als toMs in de toekomst ligt", async () => {
    const feed = feedAt(NOW);
    for (const interval of ["1m", "15m", "4h", "1d"] as Interval[]) {
      const step = INTERVAL_MS[interval];
      const hist = await feed.getHistory("ETH-EUR", interval, NOW - 20 * DAY, NOW + 10 * DAY);
      expect(hist.length).toBeGreaterThan(0);
      const last = hist[hist.length - 1];
      expect(last.time + step).toBeLessThanOrEqual(NOW);
      expect(last.time).toBe(Math.floor(NOW / step) * step - step);
      for (let i = 1; i < hist.length; i++) expect(hist[i].time).toBeGreaterThan(hist[i - 1].time);
    }
  });

  it("de candle in vorming groeit consistent mee en wordt daarna definitief", async () => {
    let now = Date.UTC(2026, 8, 28, 14, 30, 0, 0) + 5 * MIN + 10_000; // 5m10s in een 15m-candle
    const feed = new SimulatedFeed({ now: () => now });
    const early = (await feed.getCandles("XRP-EUR", "15m", 3)).at(-1)!;
    now += 4 * MIN;
    const later = (await feed.getCandles("XRP-EUR", "15m", 3)).at(-1)!;
    expect(later.time).toBe(early.time);
    expect(later.open).toBe(early.open);
    expect(later.high).toBeGreaterThanOrEqual(early.high);
    expect(later.low).toBeLessThanOrEqual(early.low);
    expect(later.volume).toBeGreaterThanOrEqual(early.volume);
    now = early.time + 15 * MIN + 1;
    const closed = (await feed.getHistory("XRP-EUR", "15m", early.time, early.time)).at(-1)!;
    expect(closed.time).toBe(early.time);
    expect(closed.high).toBeGreaterThanOrEqual(later.high);
    expect(closed.low).toBeLessThanOrEqual(later.low);
    // precies op de grens: nieuwe candle met open=high=low=close en volume 0
    now = early.time + 15 * MIN;
    const fresh = (await feed.getCandles("XRP-EUR", "15m", 2)).at(-1)!;
    expect(fresh.time).toBe(now);
    expect(fresh.open).toBe(closed.close);
    expect([fresh.high, fresh.low, fresh.close]).toEqual([fresh.open, fresh.open, fresh.open]);
    expect(fresh.volume).toBe(0);
    expect(await feed.getPrice("XRP-EUR")).toBe(closed.close);
  });
});

describe("SimulatedFeed — consistentie tussen intervallen", () => {
  const feed = feedAt(NOW, 11);
  const from = Date.UTC(2026, 8, 20);
  const to = Date.UTC(2026, 8, 22) - 1;

  it("een 15m-candle is exact de aggregatie van zijn 15 × 1m-candles", async () => {
    const m1 = await feed.getHistory("SOL-EUR", "1m", from, to);
    const m15 = await feed.getHistory("SOL-EUR", "15m", from, to);
    expect(m1.length).toBe(2 * 1440);
    expect(m15.length).toBe(2 * 96);
    m15.forEach((c, i) => {
      const parts = m1.slice(i * 15, i * 15 + 15);
      expect(parts[0].time).toBe(c.time);
      expect({ time: c.time, ...aggregate(parts) }).toEqual(c);
    });
  });

  it("1h = 60 × 1m, 4h = 4 × 1h en 1d = 24 × 1h", async () => {
    const m1 = await feed.getHistory("BTC-EUR", "1m", from, to);
    const h1 = await feed.getHistory("BTC-EUR", "1h", from, to);
    const h4 = await feed.getHistory("BTC-EUR", "4h", from, to);
    const d1 = await feed.getHistory("BTC-EUR", "1d", from, to);
    expect(h1.length).toBe(48);
    h1.forEach((c, i) => expect({ time: c.time, ...aggregate(m1.slice(i * 60, i * 60 + 60)) }).toEqual(c));
    h4.forEach((c, i) => {
      const agg = aggregate(h1.slice(i * 4, i * 4 + 4));
      expect([c.open, c.high, c.low, c.close]).toEqual([agg.open, agg.high, agg.low, agg.close]);
      expect(c.volume).toBeCloseTo(agg.volume, 9);
    });
    expect(d1.length).toBe(2);
    d1.forEach((c, i) => {
      const agg = aggregate(h1.slice(i * 24, i * 24 + 24));
      expect([c.open, c.high, c.low, c.close]).toEqual([agg.open, agg.high, agg.low, agg.close]);
      expect(c.volume / agg.volume).toBeCloseTo(1, 12);
    });
  });

  it("de 15m-candle in vorming = aggregatie van de 1m-candles tot nu", async () => {
    const f = feedAt(NOW, 11);
    const m15 = (await f.getCandles("ADA-EUR", "15m", 1))[0];
    const minutes = (await f.getCandles("ADA-EUR", "1m", 30)).filter((c) => c.time >= m15.time);
    expect(minutes.length).toBe(Math.floor((NOW - m15.time) / MIN) + 1);
    const agg = aggregate(minutes);
    expect([m15.open, m15.high, m15.low, m15.close]).toEqual([agg.open, agg.high, agg.low, agg.close]);
    expect(m15.volume).toBeCloseTo(agg.volume, 9);
  });

  it("getCandles en getHistory leveren dezelfde gesloten candles", async () => {
    const f = feedAt(NOW, 11);
    for (const interval of ["1m", "15m", "1h", "4h", "1d"] as Interval[]) {
      const recent = await f.getCandles("ETH-EUR", interval, 120);
      const closed = recent.slice(0, -1);
      const hist = await f.getHistory("ETH-EUR", interval, closed[0].time, NOW);
      expect(hist, interval).toEqual(closed);
    }
  });

  it("candles sluiten naadloos op elkaar aan (open = vorige close)", async () => {
    const m1 = await feed.getHistory("DOGE-EUR", "1m", from, to);
    for (let i = 1; i < m1.length; i++) expect(m1[i].open).toBe(m1[i - 1].close);
  });
});

describe("SimulatedFeed — OHLC en realisme", () => {
  it("OHLC is geldig voor alle intervallen en diverse markten", async () => {
    const feed = feedAt(NOW);
    for (const market of ["BTC-EUR", "PEPE-EUR", "TRX-EUR", "AAVE-EUR"]) {
      for (const interval of INTERVALS) {
        const candles = await feed.getCandles(market, interval, 200);
        expect(candles.length).toBe(200);
        expectValidOhlc(candles);
      }
    }
    expectValidOhlc(await feed.getHistory("SHIB-EUR", "1m", NOW - 2 * DAY, NOW));
  });

  it("prijzen hebben maximaal 5 significante cijfers", async () => {
    const candles = await feedAt(NOW).getCandles("ETH-EUR", "1m", 300);
    for (const c of candles) {
      for (const p of [c.open, c.high, c.low, c.close]) expect(Number(p.toPrecision(5))).toBe(p);
    }
  });

  it("BTC-EUR dagrendementen hebben een realistische volatiliteit", async () => {
    for (const seed of [1, 2, 3]) {
      const daily = await feedAt(NOW, seed).getHistory("BTC-EUR", "1d", NOW - 201 * DAY, NOW);
      expect(daily.length).toBe(200);
      const sd = stdev(logReturns(daily));
      expect(sd).toBeGreaterThan(0.012);
      expect(sd).toBeLessThan(0.045);
    }
    // Alts zijn volatieler dan BTC
    const f = feedAt(NOW);
    const btc = stdev(logReturns(await f.getHistory("BTC-EUR", "1d", NOW - 301 * DAY, NOW)));
    const sol = stdev(logReturns(await f.getHistory("SOL-EUR", "1d", NOW - 301 * DAY, NOW)));
    expect(sol).toBeGreaterThan(btc * 1.3);
  });

  it("vertoont volatiliteitsclustering en dikke staarten", async () => {
    const feed = feedAt(NOW);
    const hourly = await feed.getHistory("ETH-EUR", "1h", NOW - 90 * DAY, NOW);
    const r = logReturns(hourly);
    const abs = r.map(Math.abs);
    expect(autocorr(abs, 1)).toBeGreaterThan(0.05);
    const avgLag = [1, 2, 3, 4, 5].reduce((s, l) => s + autocorr(abs, l), 0) / 5;
    expect(avgLag).toBeGreaterThan(0.02);
    const sd = stdev(r);
    const m = r.reduce((a, b) => a + b, 0) / r.length;
    const kurt = r.reduce((a, b) => a + (b - m) ** 4, 0) / r.length / sd ** 4;
    expect(kurt).toBeGreaterThan(3.5);
    // Op dagniveau (langere reeks): |r| positief gecorreleerd
    const daily = await feed.getHistory("BTC-EUR", "1d", NOW - 700 * DAY, NOW);
    const dabs = logReturns(daily).map(Math.abs);
    const dAvg = [1, 2, 3, 4, 5].reduce((s, l) => s + autocorr(dabs, l), 0) / 5;
    expect(dAvg).toBeGreaterThan(0);
  });

  it("markten zijn onderling gecorreleerd (marktfactor)", async () => {
    const feed = feedAt(NOW);
    const btc = logReturns(await feed.getHistory("BTC-EUR", "1h", NOW - 30 * DAY, NOW));
    const eth = logReturns(await feed.getHistory("ETH-EUR", "1h", NOW - 30 * DAY, NOW));
    const mb = btc.reduce((a, b) => a + b, 0) / btc.length;
    const me = eth.reduce((a, b) => a + b, 0) / eth.length;
    let cov = 0;
    for (let i = 0; i < btc.length; i++) cov += (btc[i] - mb) * (eth[i] - me);
    const corr = cov / btc.length / (stdev(btc) * stdev(eth));
    expect(corr).toBeGreaterThan(0.3);
  });

  it("getHistory is snel: 90 dagen 15m binnen een seconde", async () => {
    const feed = feedAt(NOW, 99);
    const t0 = performance.now();
    const candles = await feed.getHistory("LINK-EUR", "15m", NOW - 90 * DAY, NOW);
    const ms = performance.now() - t0;
    expect(candles.length).toBe(90 * 96 - 1);
    expect(ms).toBeLessThan(1000);
    // tweede keer uit de cache
    const t1 = performance.now();
    await feed.getHistory("LINK-EUR", "15m", NOW - 90 * DAY, NOW);
    expect(performance.now() - t1).toBeLessThan(200);
  });

  it("begrenst het bereik en de limit", async () => {
    const feed = feedAt(NOW);
    const hist = await feed.getHistory("BTC-EUR", "1d", NOW - 5000 * DAY, NOW);
    expect(hist.length).toBeLessThanOrEqual(SIM_MAX_HISTORY_DAYS);
    expect(hist[0].time).toBeGreaterThanOrEqual(NOW - SIM_MAX_HISTORY_DAYS * DAY);
    expect((await feed.getCandles("BTC-EUR", "1m", 5000)).length).toBe(1440);
    expect(await feed.getCandles("BTC-EUR", "1m", 0)).toEqual([]);
    expect(await feed.getHistory("BTC-EUR", "1h", NOW, NOW - DAY)).toEqual([]);
  });
});

describe("SimulatedFeed — tickers en orderboek", () => {
  it("24h-tickers zijn consistent met de candles", async () => {
    const feed = feedAt(NOW);
    const tickers = await feed.getTickers24h();
    expect(tickers.length).toBe(SIMULATED_MARKETS.length);
    for (const t of tickers) {
      expect(t.timestamp).toBe(NOW);
      expect(t.last).toBe(await feed.getPrice(t.market));
      expect(t.low).toBeLessThanOrEqual(Math.min(t.last, t.open));
      expect(t.high).toBeGreaterThanOrEqual(Math.max(t.last, t.open));
      expect(t.volume).toBeGreaterThan(0);
      expect(t.volumeQuote).toBeGreaterThan(0);
      expect(t.volumeQuote / t.volume).toBeGreaterThan(t.low * 0.999);
      expect(t.volumeQuote / t.volume).toBeLessThan(t.high * 1.001);
      expect(t.changePct).toBeCloseTo(((t.last - t.open) / t.open) * 100, 9);
      expect(t.bid!).toBeLessThan(t.ask!);
      expect(t.bid!).toBeLessThanOrEqual(t.last);
      expect(t.ask!).toBeGreaterThanOrEqual(t.last);
      const spreadPct = ((t.ask! - t.bid!) / t.last) * 100;
      expect(spreadPct).toBeGreaterThanOrEqual(0.01);
      // v2: een paar dunne markten (KAS, STX) hebben bewust een spread van ~0,3–0,55%
      expect(spreadPct).toBeLessThanOrEqual(0.6);
    }
    const btc = tickers.find((t) => t.market === "BTC-EUR")!;
    const inj = tickers.find((t) => t.market === "INJ-EUR")!;
    expect(btc.volumeQuote).toBeGreaterThan(inj.volumeQuote);
    // open = koers precies 24 uur geleden
    const minuteAgo = await feedAt(NOW - DAY).getPrice("BTC-EUR");
    expect(btc.open).toBe(minuteAgo);
    // filteren op markten
    const some = await feed.getTickers24h(["ETH-EUR", "SOL-EUR"]);
    expect(some.map((t) => t.market)).toEqual(["ETH-EUR", "SOL-EUR"]);
  });

  it("orderboek: ~15 niveaus, gesorteerd, rond de middenkoers en gelijk aan ticker bid/ask", async () => {
    const feed = feedAt(NOW);
    for (const market of ["BTC-EUR", "DOGE-EUR", "PEPE-EUR"]) {
      const book = await feed.getOrderBook(market);
      const price = await feed.getPrice(market);
      const [ticker] = await feed.getTickers24h([market]);
      expect(book.market).toBe(market);
      expect(book.bids.length).toBe(15);
      expect(book.asks.length).toBe(15);
      expect(book.bids[0][0]).toBe(ticker.bid);
      expect(book.asks[0][0]).toBe(ticker.ask);
      expect(book.bids[0][0]).toBeLessThan(book.asks[0][0]);
      expect(book.bids[0][0]).toBeLessThanOrEqual(price);
      expect(book.asks[0][0]).toBeGreaterThanOrEqual(price);
      for (let i = 1; i < 15; i++) {
        expect(book.bids[i][0]).toBeLessThan(book.bids[i - 1][0]);
        expect(book.asks[i][0]).toBeGreaterThan(book.asks[i - 1][0]);
      }
      for (const [p, a] of [...book.bids, ...book.asks]) {
        expect(p).toBeGreaterThan(0);
        expect(a).toBeGreaterThan(0);
      }
      expect(book.bids[14][0]).toBeGreaterThan(price * 0.9);
      expect(book.asks[14][0]).toBeLessThan(price * 1.1);
    }
    expect((await feed.getOrderBook("ETH-EUR", 5)).bids.length).toBe(5);
  });
});
