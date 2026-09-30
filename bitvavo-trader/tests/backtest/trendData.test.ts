/**
 * `loadTrendCandles` (koersdata voor het trendfilter in backtests): het filter
 * blokkeert voor de zekerheid als data ontbreekt, te laat begint, te vroeg stopt
 * of gaten heeft — en de `note` zegt dan waarom (anders lijkt het op een dalende
 * markt). Bitcoin met markt- én muntfilter wordt één keer geladen.
 */
import { describe, expect, it } from "vitest";
import { loadTrendCandles, trendDataNotes } from "../../src/backtest/trendData";
import { runBacktestWith } from "../../src/backtest/simulator";
import { DEFAULT_ENSEMBLE_CONFIG } from "../../src/core/defaults";
import { INTERVAL_MS, type Candle, type Interval, type MarketDataFeed, type TrendFilterConfig } from "../../src/core/types";
import { trendWarmupMs } from "../../src/strategies/trendFilter";
import { decisionsFrom, flatCandles, input, stubRisk, T0 } from "./helpers";

const DAY = INTERVAL_MS["1d"];
const NOW = Date.UTC(2026, 8, 28, 12, 7);
const FROM = NOW - 60 * DAY;
const COIN50: TrendFilterConfig = { market: false, coin: true, interval: "1d", period: 50 };
const MARKET50: TrendFilterConfig = { market: true, coin: false, interval: "1d", period: 50 };
const BOTH50: TrendFilterConfig = { market: true, coin: true, interval: "1d", period: 50 };

type Shape = { firstDay?: number; lastDay?: number; missing?: (t: number) => boolean; fail?: boolean };

/** Nep-feed: gesloten candles op het gevraagde interval, per markt te beperken (listing, einde, gaten, fout). */
function feedWith(shapes: Record<string, Shape> = {}) {
  const calls: string[] = [];
  const feed: Pick<MarketDataFeed, "getHistory"> = {
    async getHistory(market: string, interval: Interval, from: number, to: number) {
      calls.push(`${market}|${interval}`);
      const s = shapes[market] ?? {};
      if (s.fail) throw new Error("Bitvavo antwoordt niet");
      const step = INTERVAL_MS[interval];
      const out: Candle[] = [];
      for (let t = Math.ceil(from / step) * step, k = 0; t + step <= to; t += step, k++) {
        if (s.firstDay !== undefined && t < s.firstDay) continue;
        if (s.lastDay !== undefined && t > s.lastDay) continue;
        if (s.missing?.(t)) continue;
        const c = 100 + k;
        out.push({ time: t, open: c, high: c, low: c, close: c, volume: 1 });
      }
      return out;
    },
  };
  return { feed, calls };
}

const dayStart = (ms: number) => Math.floor(ms / DAY) * DAY;

describe("loadTrendCandles — uitleg bij data waardoor de test niet koopt", () => {
  it("volledige data: geen note", async () => {
    const { feed } = feedWith();
    const r = await loadTrendCandles(feed, "ETH-EUR", BOTH50, FROM, NOW);
    expect(r.note).toBeUndefined();
    expect(r.trendCandles?.market?.length).toBeGreaterThan(100);
    expect(r.trendCandles?.coin?.length).toBeGreaterThan(100);
  });

  it("lege data (geen fout): note in plaats van stilletjes 'tegengehouden door het trendfilter'", async () => {
    const empty: Pick<MarketDataFeed, "getHistory"> = { getHistory: async () => [] };
    const r = await loadTrendCandles(empty, "ETH-EUR", BOTH50, FROM, NOW);
    expect(r.trendCandles).toEqual({ market: [], coin: [] });
    expect(r.note).toBe(
      "Trendfilter: Koersdata voor het marktfilter (BTC-EUR): niets gevonden — voor de zekerheid geen aankopen; " +
        "Koersdata voor het muntfilter (ETH-EUR): niets gevonden — voor de zekerheid geen aankopen.",
    );
  });

  it("nieuwe munt: het gemiddelde is pas later bekend → note met de datum; de gate blokkeert tot dan", async () => {
    const listed = dayStart(NOW - 75 * DAY); // 15 juli 2026
    const { feed } = feedWith({ "SOL-EUR": { firstDay: listed } });
    const r = await loadTrendCandles(feed, "SOL-EUR", COIN50, FROM, NOW);
    const knownFrom = listed + 50 * DAY;
    expect(knownFrom).toBeGreaterThan(FROM);
    expect(r.note).toBe(
      "Trendfilter: Koersdata voor het muntfilter (SOL-EUR): het gemiddelde van 50 dagen is pas bekend vanaf 3 september 2026 " +
        "(koersdata vanaf 15 juli 2026) — tot dan koopt de test niet (voor de zekerheid).",
    );
    expect(new Date(knownFrom).toISOString().slice(0, 10)).toBe("2026-09-03");
  });

  it("te weinig data voor het gemiddelde in de hele periode", async () => {
    const { feed } = feedWith({ "NEW-EUR": { firstDay: dayStart(NOW - 20 * DAY) } });
    const r = await loadTrendCandles(feed, "NEW-EUR", COIN50, FROM, NOW);
    expect(r.note).toBe(
      "Trendfilter: Koersdata voor het muntfilter (NEW-EUR): maar 20 dagen (vanaf 8 september 2026), " +
        "te weinig voor het gemiddelde van 50 dagen — de test koopt niet (voor de zekerheid).",
    );
  });

  it("data die te vroeg stopt, en gaten (geen handel) in de testperiode", async () => {
    const stop = await loadTrendCandles(feedWith({ "BTC-EUR": { lastDay: dayStart(NOW - 10 * DAY) } }).feed, "ETH-EUR", MARKET50, FROM, NOW);
    expect(stop.note).toBe(
      "Trendfilter: Koersdata voor het marktfilter (BTC-EUR) loopt maar tot 19 september 2026 — daarna koopt de test niet (voor de zekerheid).",
    );
    const gapStart = dayStart(NOW - 30 * DAY);
    const missing = (t: number) => t >= gapStart && t < gapStart + 3 * DAY;
    const gap = await loadTrendCandles(feedWith({ "AAA-EUR": { missing } }).feed, "AAA-EUR", COIN50, FROM, NOW);
    expect(gap.note).toBe(
      "Trendfilter: Koersdata voor het muntfilter (AAA-EUR) heeft een gat (geen handel, vanaf 29 augustus 2026) " +
        "— tijdens een gat koopt de test niet (voor de zekerheid).",
    );
    // Ook één ontbrekende dag is een gat: de gate blokkeert dan (net als de engine).
    const one = await loadTrendCandles(
      feedWith({ "AAA-EUR": { missing: (t) => t === gapStart || t === gapStart + 10 * DAY } }).feed,
      "AAA-EUR",
      COIN50,
      FROM,
      NOW,
    );
    expect(one.note).toBe(
      "Trendfilter: Koersdata voor het muntfilter (AAA-EUR) heeft 2 gaten (geen handel, het eerste vanaf 29 augustus 2026) " +
        "— tijdens een gat koopt de test niet (voor de zekerheid).",
    );
    // Een gat dat vóór het begin van de test al voorbij is, doet er niet toe (de gate ziet het nooit).
    const early = dayStart(NOW) - 100 * DAY;
    const before = await loadTrendCandles(
      feedWith({ "AAA-EUR": { missing: (t) => t >= early && t < early + 2 * DAY } }).feed,
      "AAA-EUR",
      COIN50,
      FROM,
      NOW,
    );
    expect(before.trendCandles!.coin!.some((c, i, a) => i > 0 && c.time - a[i - 1].time > 2 * DAY)).toBe(true);
    expect(before.note).toBeUndefined();
    expect(trendDataNotes("X", [], COIN50, FROM, NOW)).toEqual(["X: niets gevonden — voor de zekerheid geen aankopen"]);
  });

  it("4-uursdata: tijd erbij, 'blokken van 4 uur' in plaats van 'candles'", async () => {
    const tf: TrendFilterConfig = { market: false, coin: true, interval: "4h", period: 20 };
    const from = NOW - 10 * DAY;
    const listed = Math.floor((from - 2 * DAY) / INTERVAL_MS["4h"]) * INTERVAL_MS["4h"];
    const r = await loadTrendCandles(feedWith({ "SOL-EUR": { firstDay: listed } }).feed, "SOL-EUR", tf, from, NOW);
    expect(r.note).toMatch(/het gemiddelde van 20 blokken van 4 uur is pas bekend vanaf \d+ september 2026 om \d\d:\d\d/);
    expect(r.note).not.toMatch(/candles/);
  });

  it("ongesorteerde data wordt gesorteerd (de gate zoekt binair)", async () => {
    const { feed } = feedWith();
    const shuffled: Pick<MarketDataFeed, "getHistory"> = {
      getHistory: async (...a) => (await feed.getHistory(...a)).reverse(),
    };
    const r = await loadTrendCandles(shuffled, "ETH-EUR", MARKET50, FROM, NOW);
    const times = r.trendCandles!.market!.map((c) => c.time);
    expect(times).toEqual([...times].sort((a, b) => a - b));
    expect(r.note).toBeUndefined();
  });
});

describe("loadTrendCandles — Bitcoin met markt- én muntfilter", () => {
  it("mislukt laden: één verzoek en één uitleg", async () => {
    const { feed, calls } = feedWith({ "BTC-EUR": { fail: true } });
    const r = await loadTrendCandles(feed, "BTC-EUR", BOTH50, FROM, NOW);
    expect(calls).toEqual(["BTC-EUR|1d"]);
    expect(r.trendCandles).toEqual({});
    expect(r.note).toBe(
      "Trendfilter: Koersdata voor het marktfilter (BTC-EUR) niet geladen: Bitvavo antwoordt niet — voor de zekerheid geen aankopen.",
    );
  });

  it("gelukt: één verzoek, de munt gebruikt dezelfde candles", async () => {
    const { feed, calls } = feedWith();
    const r = await loadTrendCandles(feed, "BTC-EUR", BOTH50, FROM, NOW);
    expect(calls).toEqual(["BTC-EUR|1d"]);
    expect(r.trendCandles!.coin).toBe(r.trendCandles!.market);
    expect(r.note).toBeUndefined();
  });

  it("alleen het muntfilter op BTC-EUR: gewoon laden als munt", async () => {
    const { feed, calls } = feedWith({ "BTC-EUR": { fail: true } });
    const r = await loadTrendCandles(feed, "BTC-EUR", COIN50, FROM, NOW);
    expect(calls).toEqual(["BTC-EUR|1d"]);
    expect(r.note).toMatch(/^Trendfilter: Koersdata voor het muntfilter \(BTC-EUR\) niet geladen/);
  });
});

describe("backtest met data van een nieuwe munt (loader + simulatie)", () => {
  it("koopt pas als het gemiddelde bekend is; de note legt de tegengehouden koopsignalen uit", async () => {
    // 15m-candles vanaf T0 (4 dagen); de munt heeft dagkoersen vanaf 2 dagen vóór T0, gemiddelde van 3 dagen.
    const tf: TrendFilterConfig = { market: false, coin: true, interval: "1d", period: 3 };
    const candles = flatCandles(4 * 96);
    const to = candles[candles.length - 1].time;
    const { feed } = feedWith({ "TEST-EUR": { firstDay: T0 - 2 * DAY } });
    const { trendCandles, note } = await loadTrendCandles(feed, "TEST-EUR", tf, T0, to + 15 * 60_000);
    expect(trendCandles!.coin![0].time).toBe(T0 - 2 * DAY);
    expect(trendCandles!.coin![0].time).toBeGreaterThan(T0 - trendWarmupMs(tf));
    expect(note).toMatch(/het gemiddelde van 3 dagen is pas bekend vanaf 7 januari 2025/);
    const acts = Array.from({ length: candles.length }, (_, i) => (i === 10 ? "B" : i === 20 ? "S" : i === 150 ? "B" : i === 160 ? "S" : ".")).join("");
    const res = runBacktestWith(
      input(candles, { ensemble: { ...DEFAULT_ENSEMBLE_CONFIG, trendFilter: tf }, trendCandles }),
      { decide: () => decisionsFrom(candles, acts), createRisk: () => stubRisk() },
    ).result;
    // Koop 10 valt vóór het sluiten van de derde dagcandle (T0 + 1 dag) → tegengehouden; koop 150 erna → gekocht.
    expect(res.blockedEntries?.trend).toBe(1);
    expect(res.trades.map((t) => t.entryTime)).toEqual([candles[151].time]);
  });
});
