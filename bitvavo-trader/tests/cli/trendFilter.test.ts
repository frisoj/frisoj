/**
 * CLI's (backtest + toernooi): het trendfilter laadt zijn koersdata via
 * `loadTrendCandles`, `--no-trend` zet het uit, en de tegengehouden
 * koopsignalen komen in het rapport.
 */
import { execFile } from "node:child_process";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { describe, expect, it } from "vitest";
import { runBacktestWith } from "../../src/backtest/simulator";
import {
  blockedEntriesText,
  prepareTrendFilter,
  sumBlockedEntries,
  trendFilterLabel,
  withoutTrendFilter,
} from "../../src/cli/backtestReport";
import { PERIODS, contenders, runTournament } from "../../src/cli/tournament";
import { DEFAULT_ENSEMBLE_CONFIG, DEFAULT_TREND_FILTER } from "../../src/core/defaults";
import { INTERVAL_MS, type Candle, type Interval, type MarketDataFeed } from "../../src/core/types";
import { SimulatedFeed } from "../../src/data/simulatedFeed";
import { trendWarmupMs } from "../../src/strategies/trendFilter";
import { decisionsFrom, flatCandles, input, stubRisk } from "../backtest/helpers";

const NOW = Date.UTC(2026, 8, 29, 12);
const DAY = INTERVAL_MS["1d"];

type HistoryCall = { market: string; interval: Interval; from: number; to: number };

/** Nep-feed voor alleen `getHistory`: registreert de aanroepen, kan per markt falen. */
function fakeHistoryFeed(opts: { fail?: Set<string>; closes?: (k: number) => number } = {}) {
  const calls: HistoryCall[] = [];
  const feed: Pick<MarketDataFeed, "getHistory"> = {
    async getHistory(market, interval, from, to) {
      calls.push({ market, interval, from, to });
      if (opts.fail?.has(market)) throw new Error("verbinding weg");
      const step = INTERVAL_MS[interval];
      const out: Candle[] = [];
      for (let t = Math.ceil(from / step) * step, k = 0; t + step <= to; t += step, k++) {
        const c = opts.closes ? opts.closes(k) : 100 + k;
        out.push({ time: t, open: c, high: c, low: c, close: c, volume: 1 });
      }
      return out;
    },
  };
  return { feed, calls };
}

/** SimulatedFeed waarvan de dagcandles (trendfilter) worden vervangen door een dalende reeks, met registratie. */
class RecordingFeed extends SimulatedFeed {
  calls: HistoryCall[] = [];
  constructor(private readonly bearDaily = false) {
    super({ now: () => NOW });
  }
  override async getHistory(market: string, interval: Interval, from: number, to: number): Promise<Candle[]> {
    this.calls.push({ market, interval, from, to });
    const real = await super.getHistory(market, interval, from, to);
    if (!this.bearDaily || interval !== "1d") return real;
    return real.map((c, k) => ({ ...c, open: 1e6 - k, high: 1e6 - k, low: 1e6 - k, close: 1e6 - k }));
  }
}

describe("prepareTrendFilter (laden voor de CLI's)", () => {
  const from = NOW - 30 * DAY;

  it("laadt Bitcoin op de tijdschaal van het filter, vanaf de warmup vóór de eerste handelscandle", async () => {
    const { feed, calls } = fakeHistoryFeed();
    const setup = await prepareTrendFilter(feed, "ETH-EUR", DEFAULT_ENSEMBLE_CONFIG, from, NOW);
    expect(calls).toEqual([{ market: "BTC-EUR", interval: "1d", from: from - trendWarmupMs(DEFAULT_TREND_FILTER), to: NOW }]);
    expect(setup.ensemble).toBe(DEFAULT_ENSEMBLE_CONFIG);
    expect(setup.trendCandles?.market?.length).toBeGreaterThan(50);
    expect(setup.trendCandles?.coin).toBeUndefined();
    expect(setup.note).toBeUndefined();
    expect(setup.lines[0]).toBe("Trendfilter: alleen kopen als Bitcoin (BTC-EUR) boven het gemiddelde van 50 dagen staat");
    expect(setup.lines[1]).toMatch(/^Nu: Bitcoin \(BTC-EUR\) staat boven het gemiddelde van 50 dagen/);
  });

  it("muntfilter: laadt ook de munt zelf", async () => {
    const { feed, calls } = fakeHistoryFeed();
    const ens = { ...DEFAULT_ENSEMBLE_CONFIG, trendFilter: { market: true, coin: true, interval: "4h" as const, period: 20 } };
    const setup = await prepareTrendFilter(feed, "ETH-EUR", ens, from, NOW);
    expect(calls.map((c) => [c.market, c.interval])).toEqual([
      ["BTC-EUR", "4h"],
      ["ETH-EUR", "4h"],
    ]);
    expect(setup.trendCandles?.coin?.length).toBeGreaterThan(20);
    expect(setup.lines[0]).toBe(
      "Trendfilter: alleen kopen als Bitcoin (BTC-EUR) en de munt zelf boven het gemiddelde van 20 candles van 4 uur staat",
    );
  });

  it("--no-trend: niets laden, filter uit (origineel ongewijzigd)", async () => {
    const { feed, calls } = fakeHistoryFeed();
    const setup = await prepareTrendFilter(feed, "ETH-EUR", DEFAULT_ENSEMBLE_CONFIG, from, NOW, { disabled: true });
    expect(calls).toHaveLength(0);
    expect(setup.trendCandles).toBeUndefined();
    expect(setup.ensemble.trendFilter).toEqual({ ...DEFAULT_TREND_FILTER, market: false, coin: false });
    expect(DEFAULT_ENSEMBLE_CONFIG.trendFilter).toEqual(DEFAULT_TREND_FILTER);
    expect(setup.lines).toEqual(["Trendfilter: uit (--no-trend)"]);
  });

  it("filter uit in de instellingen: niets laden", async () => {
    const { feed, calls } = fakeHistoryFeed();
    const setup = await prepareTrendFilter(feed, "ETH-EUR", withoutTrendFilter(DEFAULT_ENSEMBLE_CONFIG), from, NOW);
    expect(calls).toHaveLength(0);
    expect(setup.trendCandles).toBeUndefined();
    expect(setup.lines).toEqual(["Trendfilter: uit"]);
  });

  it("mislukt laden: uitleg in de note en de backtest koopt niets (voor de zekerheid)", async () => {
    const { feed } = fakeHistoryFeed({ fail: new Set(["BTC-EUR"]) });
    const setup = await prepareTrendFilter(feed, "ETH-EUR", DEFAULT_ENSEMBLE_CONFIG, from, NOW);
    expect(setup.trendCandles).toEqual({});
    expect(setup.note).toMatch(/marktfilter \(BTC-EUR\) niet geladen: verbinding weg/);

    const candles = flatCandles(20);
    const decisions = decisionsFrom(candles, "..B...B...B.........");
    const res = runBacktestWith(input(candles, { ensemble: setup.ensemble, trendCandles: setup.trendCandles }), {
      decide: () => decisions,
      createRisk: () => stubRisk(),
    }).result;
    expect(res.trades).toHaveLength(0);
    expect(res.blockedEntries).toEqual({ trend: 3, spread: 0 });
  });
});

describe("rapportregels", () => {
  it("blockedEntriesText en sumBlockedEntries", () => {
    expect(blockedEntriesText(undefined)).toBeNull();
    expect(blockedEntriesText({ trend: 0, spread: 0 })).toBe("Koopsignalen tegengehouden: geen (trendfilter 0, spreadlimiet 0).");
    expect(blockedEntriesText({ trend: 12, spread: 3 })).toBe("Koopsignalen tegengehouden: 12 door het trendfilter, 3 door de spreadlimiet.");
    expect(blockedEntriesText({ trend: 1, spread: 0 }, "Out-of-sample")).toBe("Out-of-sample: 1 door het trendfilter, 0 door de spreadlimiet.");
    expect(sumBlockedEntries([undefined, null])).toBeNull();
    expect(sumBlockedEntries([{ trend: 1, spread: 2 }, undefined, { trend: 3, spread: 4 }])).toEqual({ trend: 4, spread: 6 });
  });

  it("trendFilterLabel", () => {
    expect(trendFilterLabel(undefined)).toBe("Trendfilter: uit");
    expect(trendFilterLabel({ ...DEFAULT_TREND_FILTER, market: false }, true)).toBe("Trendfilter: uit (--no-trend)");
    expect(trendFilterLabel({ market: false, coin: true, interval: "1d", period: 30 })).toBe(
      "Trendfilter: alleen kopen als de munt zelf boven het gemiddelde van 30 dagen staat",
    );
  });
});

describe("toernooi met trendfilter", () => {
  const week = PERIODS.filter((p) => p.key === "1w");

  it("laadt Bitcoin één keer (voor alle markten) en geeft elke run de trendcandles mee", async () => {
    const feed = new RecordingFeed();
    const res = await runTournament(feed, { markets: ["BTC-EUR", "ETH-EUR"], capital: 50, periods: week, walkForward: false, now: NOW });
    const daily = feed.calls.filter((c) => c.interval === "1d");
    expect(daily).toHaveLength(1);
    expect(daily[0].market).toBe("BTC-EUR");
    expect(daily[0].from).toBe(NOW - 7 * DAY - trendWarmupMs(DEFAULT_TREND_FILTER));
    expect(res.rows).toHaveLength(12);
    for (const r of res.rows) expect(r.blockedEntries).toBeDefined();
    expect(res.trendFilter).toBe(trendFilterLabel(DEFAULT_TREND_FILTER));
  });

  it("Bitcoin onder zijn gemiddelde: geen enkele deelnemer koopt; met trendFilter: false wel", async () => {
    const opts = { markets: ["ETH-EUR"], capital: 50, periods: week, walkForward: false, now: NOW };
    const bear = await runTournament(new RecordingFeed(true), opts);
    for (const r of bear.rows) expect(r.trades).toBe(0);
    expect(bear.rows.reduce((s, r) => s + r.blockedEntries!.trend, 0)).toBeGreaterThan(0);

    const feed = new RecordingFeed(true);
    const off = await runTournament(feed, { ...opts, trendFilter: false });
    expect(feed.calls.some((c) => c.interval === "1d")).toBe(false);
    expect(off.rows.reduce((s, r) => s + r.trades, 0)).toBeGreaterThan(0);
    for (const r of off.rows) expect(r.blockedEntries?.trend ?? 0).toBe(0);
    expect(off.trendFilter).toBe("Trendfilter: uit (--no-trend)");
  });

  it("walk-forward-rijen tellen de out-of-sample tegengehouden koopsignalen", async () => {
    const res = await runTournament(new RecordingFeed(true), {
      markets: ["ETH-EUR"],
      capital: 50,
      periods: [{ key: "1y", label: "1 jaar", days: 365, intervals: ["4h"], walkForwardInterval: "4h" }],
      walkForward: true,
      now: NOW,
    });
    expect(res.walkForward).toHaveLength(6);
    for (const w of res.walkForward) {
      expect(w.trades).toBe(0);
      expect(w.blockedEntries).toBeDefined();
    }
  });

  it("contenders() neemt het basis-ensemble over", () => {
    const off = withoutTrendFilter(DEFAULT_ENSEMBLE_CONFIG);
    for (const c of contenders(off)) expect(c.ensemble.trendFilter).toEqual(off.trendFilter);
    for (const c of contenders()) expect(c.ensemble.trendFilter).toEqual(DEFAULT_TREND_FILTER);
  });
});

describe("backtest-CLI (echt proces, gesimuleerde data)", () => {
  const root = fileURLToPath(new URL("../../", import.meta.url));
  const cli = (args: string[]) =>
    promisify(execFile)(process.execPath, ["--import", "tsx", "src/cli/backtest.ts", "--source", "simulated", ...args], {
      cwd: root,
      env: { ...process.env, NO_COLOR: "1" },
      timeout: 60_000,
    });

  it("toont het trendfilter en de tegengehouden koopsignalen; --no-trend zet het uit", async () => {
    const args = ["--market", "ETH-EUR", "--interval", "1h", "--days", "20"];
    const on = await cli(args);
    expect(on.stdout).toContain("Trendfilter: alleen kopen als Bitcoin (BTC-EUR) boven het gemiddelde van 50 dagen staat");
    expect(on.stdout).toMatch(/Koopsignalen tegengehouden: /);
    const off = await cli([...args, "--no-trend"]);
    expect(off.stdout).toContain("Trendfilter: uit (--no-trend)");
    expect(off.stdout).not.toContain("Trendfilter-data ophalen");
  }, 60_000);
});
