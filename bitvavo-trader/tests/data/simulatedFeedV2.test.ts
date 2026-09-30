/**
 * v2-tests voor de SimulatedFeed: ~60 markten, stablecoin USDC-EUR, getPrices,
 * en een REGRESSIETEST die bewaakt dat de prijspaden van de oorspronkelijke 23
 * markten nooit veranderen (ook niet door het toevoegen van markten).
 */
import { describe, expect, it } from "vitest";
import { SIMULATED_MARKETS, SimulatedFeed } from "../../src/data/simulatedFeed";
import { INTERVAL_MS, type Candle, type Interval } from "../../src/core/types";
import { hashString } from "../../src/core/util";
import { DEFAULT_RISK_CONFIG, DEFAULT_UNIVERSE_CONFIG } from "../../src/core/defaults";
import { EXCLUDED_BASES, selectUniverse, tickerSpreadPct } from "../../src/engine/universe";

const DAY = 86_400_000;
const MIN = 60_000;
/** Vast "nu" van de referentiewaarden: midden in een minuut, niet op een candlegrens. */
const REF_NOW = Date.UTC(2026, 8, 28, 14, 37, 23, 500);
/** Ruim vóór het epoch van het ankerpad (2024-01-01): test het achterwaarts gegenereerde pad. */
const PAST_DAY = Date.UTC(2022, 5, 15);

/** De markten van vóór v2, in de oorspronkelijke volgorde. */
const ORIGINAL_MARKETS = [
  "BTC", "ETH", "SOL", "XRP", "ADA", "DOGE", "LINK", "AVAX", "DOT", "LTC", "BNB", "TRX", "SHIB", "PEPE",
  "NEAR", "ATOM", "UNI", "AAVE", "ARB", "SUI", "XLM", "HBAR", "INJ",
].map((b) => `${b}-EUR`);

type Row = [number, number, number, number, number, number];

interface Reference {
  price: number;
  /** getCandles(…, 2): laatste gesloten candle + de candle in vorming */
  candles: Record<"1m" | "15m" | "1h" | "4h" | "1d", Row[]>;
  /** hashString van alle OHLCV-waarden (zie `digest`) */
  digests: Record<"5m" | "15m" | "1h" | "12h" | "1d" | "1d-2023", number>;
  /** De 1d-candle van PAST_DAY */
  past: Row;
  /** last, open, high, low, volumeQuote, bid, ask */
  ticker: number[];
  /** beste bid, beste ask, 3e bid, 3e ask */
  book: [number, number][];
}

function row(c: Candle): Row {
  return [c.time, c.open, c.high, c.low, c.close, c.volume];
}

function digest(candles: Candle[]): number {
  return hashString(candles.map((c) => `${c.time},${c.open},${c.high},${c.low},${c.close},${c.volume}`).join(";"));
}

/**
 * Vastgelegd met de code van vóór v2 (23 markten), standaard-seed en seed 7.
 * NOOIT aanpassen om een test te laten slagen: een verschil betekent dat
 * bestaande prijspaden veranderd zijn, en dat mag niet.
 */
const REFERENCE: Record<string, Reference> = {
  "BTC-EUR": {
    price: 109730,
    candles: {
      "1m": [[1790606160000, 109680, 109860, 109660, 109790, 0.3856602209441576], [1790606220000, 109790, 109790, 109720, 109730, 0.07437807125024289]],
      "15m": [[1790604900000, 109580, 110020, 109500, 109750, 5.926194752108381], [1790605800000, 109750, 109860, 109480, 109730, 2.6935486014805696]],
      "1h": [[1790600400000, 108880, 110240, 108030, 109860, 40.77494744349433], [1790604000000, 109860, 110040, 109420, 109730, 13.476723421185158]],
      "4h": [[1790582400000, 111120, 111150, 110150, 110910, 70.87567066979702], [1790596800000, 110910, 111800, 108030, 109730, 83.8866890602378]],
      "1d": [[1790467200000, 109600, 113510, 109550, 110470, 688.2124019244437], [1790553600000, 110470, 112290, 108030, 109730, 308.6916207607355]],
    },
    digests: { "5m": 418868632, "15m": 3575341464, "1h": 415382258, "12h": 2511126849, "1d": 906614265, "1d-2023": 189723125 },
    past: [1655251200000, 92188, 96321, 91612, 94558, 1153.4225566075577],
    ticker: [109730, 111140, 112290, 108030, 62259174.48633199, 109710, 109750],
    book: [[109710, 0.09110912], [109750, 0.19308719], [109660, 0.32277444], [109810, 0.32408791]],
  },
  "ETH-EUR": {
    price: 4709.1,
    candles: {
      "1m": [[1790606160000, 4707.3, 4709.9, 4706.3, 4709.4, 2.2745199285779845], [1790606220000, 4709.4, 4710.4, 4709, 4709.1, 0.4875084302637006]],
      "15m": [[1790604900000, 4712.9, 4719.5, 4708.8, 4710.9, 47.358470391664866], [1790605800000, 4710.9, 4712.6, 4705.6, 4709.1, 41.30759541768236]],
      "1h": [[1790600400000, 4719.2, 4743.3, 4695.8, 4723.4, 345.47160189397727], [1790604000000, 4723.4, 4724.1, 4705.6, 4709.1, 168.38951714581256]],
      "4h": [[1790582400000, 4717, 4789.9, 4688.1, 4783.9, 929.6599595589902], [1790596800000, 4783.9, 4785.6, 4695.8, 4709.1, 831.6342200282387]],
      "1d": [[1790467200000, 4699.9, 4901.4, 4695, 4723, 11268.946565836763], [1790553600000, 4723, 4789.9, 4589.8, 4709.1, 4136.270371222438]],
    },
    digests: { "5m": 3393252572, "15m": 2235611116, "1h": 1339466698, "12h": 1625625540, "1d": 401565, "1d-2023": 3572400128 },
    past: [1655251200000, 3618.4, 3760.6, 3567.6, 3718.6, 6999.670264916181],
    ticker: [4709.1, 4771.2, 4799.5, 4589.8, 39202013.43513319, 4708.2, 4710],
    book: [[4708.2, 0.82675775], [4710, 1.72919494], [4706, 3.93276241], [4711.3, 1.93695342]],
  },
  "SOL-EUR": {
    price: 260.84,
    candles: {
      "1m": [[1790606160000, 260.32, 260.94, 259.87, 260.74, 41.749079290754935], [1790606220000, 260.74, 260.94, 260.68, 260.84, 15.351026423823411]],
      "15m": [[1790604900000, 260.7, 261.86, 260.12, 260.83, 543.3111181538975], [1790605800000, 260.83, 260.94, 259.87, 260.84, 251.91650807533574]],
      "1h": [[1790600400000, 257.83, 261.75, 256.73, 261.38, 2529.8167818971574], [1790604000000, 261.38, 262.29, 259.87, 260.84, 1544.2041171457017]],
      "4h": [[1790582400000, 256.12, 263.3, 254.32, 263.24, 7009.138518875482], [1790596800000, 263.24, 264.98, 256.73, 260.84, 6244.655874403395]],
      "1d": [[1790467200000, 257.33, 266.03, 254.43, 255.27, 45916.51364080343], [1790553600000, 255.27, 264.98, 252.4, 260.84, 27715.91512622534]],
    },
    digests: { "5m": 938079828, "15m": 2280912178, "1h": 2123108157, "12h": 2279698187, "1d": 1556060566, "1d-2023": 3520386560 },
    past: [1655251200000, 179.15, 192.42, 172.53, 187.66, 109641.34295588323],
    ticker: [260.84, 258.36, 266.03, 252.4, 11750923.335500574, 260.75, 260.93],
    book: [[260.75, 26.84778064], [260.93, 8.25735335], [260.57, 4.29048855], [261.19, 14.76150935]],
  },
  "XRP-EUR": {
    price: 2.437,
    candles: {
      "1m": [[1790606160000, 2.4269, 2.4397, 2.4252, 2.436, 10692.139342594357], [1790606220000, 2.436, 2.4389, 2.4343, 2.437, 14570.366524083955]],
      "15m": [[1790604900000, 2.4227, 2.4527, 2.4222, 2.4431, 150339.9387410539], [1790605800000, 2.4431, 2.4494, 2.4249, 2.437, 97705.49968714034]],
      "1h": [[1790600400000, 2.3921, 2.4535, 2.3725, 2.4321, 558684.5942885006], [1790604000000, 2.4321, 2.4527, 2.4213, 2.437, 393761.4192117668]],
      "4h": [[1790582400000, 2.4445, 2.4917, 2.4157, 2.4547, 2283240.22870488], [1790596800000, 2.4547, 2.466, 2.3496, 2.437, 1685026.30848406]],
      "1d": [[1790467200000, 2.4252, 2.5004, 2.3888, 2.3929, 7937705.8585235765], [1790553600000, 2.3929, 2.4917, 2.3496, 2.437, 7805412.5569153605]],
    },
    digests: { "5m": 746029665, "15m": 3231361782, "1h": 4163428082, "12h": 1723669938, "1d": 3802462061, "1d-2023": 2591024726 },
    past: [1655251200000, 2.6066, 2.7137, 2.5858, 2.7052, 8052438.776513735],
    ticker: [2.437, 2.4586, 2.4917, 2.3496, 26674940.480320446, 2.4366, 2.4374],
    book: [[2.4366, 932.578269], [2.4374, 1322.499671], [2.4344, 560.417236], [2.4395, 690.851041]],
  },
  "INJ-EUR": {
    price: 20.216,
    candles: {
      "1m": [[1790606160000, 20.257, 20.262, 20.243, 20.249, 3.8658538253817865], [1790606220000, 20.249, 20.252, 20.196, 20.216, 21.894493744363103]],
      "15m": [[1790604900000, 20.263, 20.362, 20.221, 20.248, 183.14415216222548], [1790605800000, 20.248, 20.279, 20.196, 20.216, 94.93944099657962]],
      "1h": [[1790600400000, 19.85, 20.049, 19.617, 20.047, 1036.563522540457], [1790604000000, 20.047, 20.362, 20.03, 20.216, 393.5528216170547]],
      "4h": [[1790582400000, 20.639, 20.671, 20.396, 20.659, 1729.833448742098], [1790596800000, 20.659, 20.676, 19.617, 20.216, 2170.1922923133334]],
      "1d": [[1790467200000, 22.594, 23.862, 20.838, 21.489, 12161.982906925261], [1790553600000, 21.489, 21.839, 19.617, 20.216, 8575.382896761259]],
    },
    digests: { "5m": 1726475025, "15m": 4205991564, "1h": 1252505467, "12h": 1302581413, "1d": 21721796, "1d-2023": 3335383099 },
    past: [1655251200000, 10.556, 10.998, 10.463, 10.476, 48981.86351463262],
    ticker: [20.216, 21.389, 22.108, 19.617, 304948.80770587083, 20.182, 20.25],
    book: [[20.182, 3.199481], [20.25, 0.391256], [20.127, 0.786515], [20.343, 13.188977]],
  },
  "SOL-EUR|7": {
    price: 301.8,
    candles: {
      "1m": [[1790606160000, 300.62, 301.09, 300.55, 301.05, 33.08336664067658], [1790606220000, 301.05, 301.8, 301.05, 301.8, 34.430118041323816]],
      "15m": [[1790604900000, 298.33, 300.31, 298.03, 300.13, 674.414940221517], [1790605800000, 300.13, 301.8, 299.41, 301.8, 420.837943458525]],
      "1h": [[1790600400000, 295.2, 299.22, 294.25, 296.25, 3741.465809850691], [1790604000000, 296.25, 301.8, 294.85, 301.8, 1847.2237413029743]],
      "4h": [[1790582400000, 298.37, 299.27, 292.16, 292.49, 9563.94353464064], [1790596800000, 292.49, 301.8, 290.76, 301.8, 8249.977958420319]],
      "1d": [[1790467200000, 278.52, 308.18, 277.25, 307.53, 49927.71262730854], [1790553600000, 307.53, 308.4, 290.76, 301.8, 40016.2722354621]],
    },
    digests: { "5m": 949856129, "15m": 1897844527, "1h": 2871429914, "12h": 4020833711, "1d": 3194977571, "1d-2023": 2937767382 },
    past: [1655251200000, 160.97, 166.01, 145.55, 146.13, 155359.25590060683],
    ticker: [301.8, 287.71, 308.4, 281.98, 17579132.37059358, 301.72, 301.88],
    book: [[301.72, 10.20051091], [301.88, 5.96821349], [301.45, 12.59412353], [302.06, 51.27695386]],
  },
};

async function snapshotOf(feed: SimulatedFeed, market: string): Promise<Reference> {
  const candles = {} as Reference["candles"];
  for (const iv of ["1m", "15m", "1h", "4h", "1d"] as const) candles[iv] = (await feed.getCandles(market, iv, 2)).map(row);
  const digests = {} as Reference["digests"];
  for (const iv of ["5m", "15m", "1h", "12h"] as const) digests[iv] = digest(await feed.getCandles(market, iv, 300));
  digests["1d"] = digest(await feed.getHistory(market, "1d", REF_NOW - 120 * DAY, REF_NOW));
  digests["1d-2023"] = digest(await feed.getHistory(market, "1d", Date.UTC(2023, 10, 1), Date.UTC(2023, 11, 31)));
  const [t] = await feed.getTickers24h([market]);
  const book = await feed.getOrderBook(market, 3);
  return {
    price: await feed.getPrice(market),
    candles,
    digests,
    past: row((await feed.getHistory(market, "1d", PAST_DAY, PAST_DAY))[0]),
    ticker: [t.last, t.open, t.high, t.low, t.volumeQuote, t.bid!, t.ask!],
    book: [book.bids[0], book.asks[0], book.bids[2], book.asks[2]],
  };
}

function stdev(x: number[]): number {
  const m = x.reduce((a, b) => a + b, 0) / x.length;
  return Math.sqrt(x.reduce((a, b) => a + (b - m) ** 2, 0) / x.length);
}

function logReturns(candles: Candle[]): number[] {
  return candles.slice(1).map((c, i) => Math.log(c.close / candles[i].close));
}

function correlation(a: number[], b: number[]): number {
  const ma = a.reduce((x, y) => x + y, 0) / a.length;
  const mb = b.reduce((x, y) => x + y, 0) / b.length;
  let cov = 0;
  for (let i = 0; i < a.length; i++) cov += (a[i] - ma) * (b[i] - mb);
  return cov / a.length / (stdev(a) * stdev(b));
}

describe("SimulatedFeed v2 — bestaande prijspaden blijven identiek", () => {
  it("SIMULATED_MARKETS begint met de oorspronkelijke 23 markten, in dezelfde volgorde", () => {
    expect(SIMULATED_MARKETS.slice(0, ORIGINAL_MARKETS.length)).toEqual(ORIGINAL_MARKETS);
  });

  for (const [key, ref] of Object.entries(REFERENCE)) {
    it(`${key}: prijs, candles (1m…1d), historie (ook vóór 2024), ticker en orderboek = referentie`, async () => {
      const [market, seed] = key.split("|");
      const feed = new SimulatedFeed({ now: () => REF_NOW, seed: seed === undefined ? undefined : Number(seed) });
      expect(await snapshotOf(feed, market)).toEqual(ref);
    });
  }

  it("het pad hangt niet af van de marktlijst, de volgorde of eerder opgevraagde (nieuwe) markten", async () => {
    const only = new SimulatedFeed({ now: () => REF_NOW, markets: ["INJ-EUR"] });
    const reversed = new SimulatedFeed({ now: () => REF_NOW, markets: [...SIMULATED_MARKETS].reverse() });
    const warmed = new SimulatedFeed({ now: () => REF_NOW });
    // Eerst alle nieuwe markten (en de gedeelde marktfactor) opwarmen
    for (const m of SIMULATED_MARKETS.slice(ORIGINAL_MARKETS.length)) {
      await warmed.getCandles(m, "15m", 300);
      await warmed.getCandles(m, "1d", 60);
    }
    await warmed.getTickers24h();
    await warmed.getPrices();
    for (const feed of [only, reversed, warmed]) {
      for (const market of ["INJ-EUR", "BTC-EUR"]) {
        expect(await feed.getPrice(market)).toBe(REFERENCE[market].price);
        expect(digest(await feed.getCandles(market, "15m", 300))).toBe(REFERENCE[market].digests["15m"]);
        expect(digest(await feed.getCandles(market, "1h", 300))).toBe(REFERENCE[market].digests["1h"]);
      }
    }
  });
});

describe("SimulatedFeed v2 — getPrices", () => {
  it("geeft alle markten van de feed, gelijk aan getPrice en aan de close van de candle in vorming", async () => {
    const feed = new SimulatedFeed({ now: () => REF_NOW });
    const prices = await feed.getPrices();
    expect(Object.keys(prices)).toEqual([...SIMULATED_MARKETS]);
    for (const market of SIMULATED_MARKETS) {
      expect(prices[market], market).toBe(await feed.getPrice(market));
      expect(Number.isFinite(prices[market]) && prices[market] > 0).toBe(true);
    }
    for (const market of ["BTC-EUR", "USDC-EUR", "BONK-EUR"]) {
      expect((await feed.getCandles(market, "15m", 1))[0].close).toBe(prices[market]);
    }
    expect(prices["BTC-EUR"]).toBe(REFERENCE["BTC-EUR"].price);
  });

  it("respecteert opts.markets en loopt mee met de klok", async () => {
    let now = REF_NOW;
    const feed = new SimulatedFeed({ now: () => now, markets: ["eth-eur", "SOL-EUR"] });
    expect(Object.keys(await feed.getPrices())).toEqual(["ETH-EUR", "SOL-EUR"]);
    const seen = new Set<number>();
    for (let i = 0; i < 20; i++) {
      now += 15_000;
      const p = await feed.getPrices();
      expect(p["ETH-EUR"]).toBe(await feed.getPrice("ETH-EUR"));
      seen.add(p["ETH-EUR"]);
    }
    expect(seen.size).toBeGreaterThan(3); // de prijs beweegt echt
    // Het resultaat is een verse kopie
    const a = await feed.getPrices();
    a["ETH-EUR"] = -1;
    expect((await feed.getPrices())["ETH-EUR"]).toBeGreaterThan(0);
  });

  it("is goedkoop genoeg om elke 15 s voor alle markten aan te roepen", async () => {
    let now = Date.UTC(2026, 8, 30, 9, 0, 1);
    const feed = new SimulatedFeed({ now: () => now });
    await feed.getPrices(); // eerste keer: minuutpaden van vandaag genereren
    const t0 = performance.now();
    for (let i = 0; i < 240; i++) {
      now += 15_000; // een uur aan ticks
      expect(Object.keys(await feed.getPrices()).length).toBe(SIMULATED_MARKETS.length);
    }
    expect(performance.now() - t0).toBeLessThan(1500);
  });
});

describe("SimulatedFeed v2 — nieuwe markten en stablecoin", () => {
  it("~60 markten: nieuwe markten hebben minder volume en een grotere spread dan de grote munten", async () => {
    const feed = new SimulatedFeed({ now: () => REF_NOW });
    expect(SIMULATED_MARKETS.length).toBeGreaterThanOrEqual(55);
    expect(SIMULATED_MARKETS.length).toBeLessThanOrEqual(70);
    const added = SIMULATED_MARKETS.slice(ORIGINAL_MARKETS.length).filter((m) => m !== "USDC-EUR");
    expect(added.length).toBeGreaterThanOrEqual(30);
    const tickers = new Map((await feed.getTickers24h()).map((t) => [t.market, t]));
    const big = ["BTC-EUR", "ETH-EUR", "XRP-EUR", "SOL-EUR"].map((m) => tickers.get(m)!);
    const minBigVolume = Math.min(...big.map((t) => t.volumeQuote));
    const maxBigSpread = Math.max(...big.map((t) => tickerSpreadPct(t)!));
    for (const m of added) {
      const t = tickers.get(m)!;
      expect(t, m).toBeDefined();
      expect(t.volumeQuote, m).toBeGreaterThan(0);
      expect(t.volumeQuote, m).toBeLessThan(minBigVolume);
      expect(tickerSpreadPct(t)!, m).toBeGreaterThan(maxBigSpread);
    }
    // Profielvolgorde: het blok nieuwe markten staat op typisch volume (grootste eerst)
    const vols = await Promise.all(
      added.map(async (m) => {
        const days = await feed.getHistory(m, "1d", REF_NOW - 30 * DAY, REF_NOW);
        return days.reduce((s, c) => s + c.volume * c.close, 0) / days.length;
      }),
    );
    const head = vols.slice(0, 5).reduce((a, b) => a + b, 0) / 5;
    const tail = vols.slice(-5).reduce((a, b) => a + b, 0) / 5;
    expect(head).toBeGreaterThan(tail * 3);
  });

  it("nieuwe markten: geldige OHLC op alle intervallen, prijzen met 5 significante cijfers", async () => {
    const feed = new SimulatedFeed({ now: () => REF_NOW });
    for (const market of ["BONK-EUR", "TAO-EUR", "USDC-EUR", "KAS-EUR"]) {
      for (const interval of ["1m", "15m", "1h", "4h", "1d"] as Interval[]) {
        const candles = await feed.getCandles(market, interval, 100);
        expect(candles.length).toBe(100);
        for (let i = 0; i < candles.length; i++) {
          const c = candles[i];
          expect(c.low).toBeGreaterThan(0);
          expect(c.low).toBeLessThanOrEqual(Math.min(c.open, c.close));
          expect(c.high).toBeGreaterThanOrEqual(Math.max(c.open, c.close));
          expect(c.volume).toBeGreaterThanOrEqual(0);
          for (const p of [c.open, c.high, c.low, c.close]) expect(Number(p.toPrecision(5))).toBe(p);
          if (i > 0) {
            expect(c.time - candles[i - 1].time).toBe(INTERVAL_MS[interval]);
            expect(c.open).toBe(candles[i - 1].close);
          }
        }
      }
    }
  });

  it("USDC-EUR: rond €0,92, vrijwel vlak, (bijna) los van de markt, veel volume, piepkleine spread", async () => {
    const feed = new SimulatedFeed({ now: () => REF_NOW });
    const daily = await feed.getHistory("USDC-EUR", "1d", REF_NOW - 730 * DAY, REF_NOW);
    const closes = daily.map((c) => c.close);
    expect(Math.min(...closes)).toBeGreaterThan(0.85);
    expect(Math.max(...closes)).toBeLessThan(1);
    expect(stdev(logReturns(daily))).toBeLessThan(0.005); // BTC: ~0,025
    const usdc = logReturns(await feed.getHistory("USDC-EUR", "1h", REF_NOW - 30 * DAY, REF_NOW));
    const btc = logReturns(await feed.getHistory("BTC-EUR", "1h", REF_NOW - 30 * DAY, REF_NOW));
    expect(Math.abs(correlation(usdc, btc))).toBeLessThan(0.2);
    const [t] = await feed.getTickers24h(["USDC-EUR"]);
    expect(t.volumeQuote).toBeGreaterThan(3e6);
    expect(tickerSpreadPct(t)!).toBeLessThan(0.03);
    expect(Math.abs(t.changePct)).toBeLessThan(1.5);
    const info = (await feed.getMarkets()).find((m) => m.market === "USDC-EUR")!;
    expect(info).toMatchObject({ base: "USDC", quote: "EUR", status: "trading", minOrderQuote: 5 });
  });

  it("de automatische muntkeuze slaat USDC-EUR over, ook al heeft hij veel volume", async () => {
    const feed = new SimulatedFeed({ now: () => REF_NOW });
    const tickers = await feed.getTickers24h();
    const sel = selectUniverse(await feed.getMarkets(), tickers, DEFAULT_UNIVERSE_CONFIG, DEFAULT_RISK_CONFIG.maxSpreadPct);
    expect(EXCLUDED_BASES.has("USDC")).toBe(true);
    expect(sel.markets).toHaveLength(DEFAULT_UNIVERSE_CONFIG.count);
    expect(sel.markets).not.toContain("USDC-EUR");
    expect(sel.excluded).toContainEqual({ market: "USDC-EUR", reason: "stablecoin of verpakte munt" });
    // Zonder uitsluiting zou hij bij de grootste horen
    const byVolume = [...tickers].sort((a, b) => b.volumeQuote - a.volumeQuote).map((t) => t.market);
    expect(byVolume.indexOf("USDC-EUR")).toBeLessThan(10);
    // Dunne markten vallen af op volume of spread; er blijven er ruim genoeg over
    for (const m of ["KAS-EUR", "STX-EUR", "AXS-EUR", "COMP-EUR", "EGLD-EUR", "XTZ-EUR", "THETA-EUR"]) {
      expect(sel.excluded.map((e) => e.market), m).toContain(m);
    }
    expect(sel.eligible).toBeGreaterThan(DEFAULT_UNIVERSE_CONFIG.count);
  });

  it("getMarkets, getTickers24h, getPrices en getOrderBook bevatten dezelfde markten, consistent", async () => {
    const feed = new SimulatedFeed({ now: () => REF_NOW + 7 * MIN });
    const markets = (await feed.getMarkets()).map((m) => m.market);
    const tickers = await feed.getTickers24h();
    const prices = await feed.getPrices();
    expect(markets).toEqual([...SIMULATED_MARKETS]);
    expect(tickers.map((t) => t.market)).toEqual(markets);
    expect(Object.keys(prices)).toEqual(markets);
    for (const t of tickers) {
      expect(t.last, t.market).toBe(prices[t.market]);
      const book = await feed.getOrderBook(t.market, 5);
      expect(book.market).toBe(t.market);
      expect(book.bids[0][0], t.market).toBe(t.bid);
      expect(book.asks[0][0], t.market).toBe(t.ask);
      expect(book.bids[0][0]).toBeLessThanOrEqual(t.last);
      expect(book.asks[0][0]).toBeGreaterThanOrEqual(t.last);
      for (let i = 1; i < book.bids.length; i++) {
        expect(book.bids[i][0]).toBeLessThan(book.bids[i - 1][0]);
        expect(book.asks[i][0]).toBeGreaterThan(book.asks[i - 1][0]);
      }
    }
  });
});
