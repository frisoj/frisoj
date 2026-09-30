/**
 * v2-API: tot 400 markten, muntkeuze (universe), trendfilter, max. spread,
 * GET /api/decision en trendfilter-koersdata voor backtest/optimize/walk-forward.
 */
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { DEFAULT_ENGINE_CONFIG, MARKET_FILTER_MARKET } from "../../src/core/defaults";
import {
  INTERVAL_MS,
  type Candle,
  type EngineConfig,
  type EngineSnapshot,
  type EnsembleDecision,
  type Interval,
  type MarketInfo,
} from "../../src/core/types";
import { trendWarmupMs } from "../../src/strategies/trendFilter";
import { FakeEngine, FakeFeed, MARKETS, NOW, json, makeCandles, makeServices, startTestServer, type TestServer } from "./helpers";

let srv: TestServer | null = null;
afterEach(async () => {
  await srv?.close();
  srv = null;
});

const DAY = INTERVAL_MS["1d"];

/** Engine-fake die bijhoudt wat updateConfig kreeg en decisionFor ondersteunt. */
class V2Engine extends FakeEngine {
  updates: Partial<EngineConfig>[] = [];
  decisions: Record<string, EnsembleDecision> = {};
  decisionForCalls: string[] = [];
  override updateConfig(partial: Partial<EngineConfig>): EngineConfig {
    this.updates.push(structuredClone(partial));
    return super.updateConfig(partial);
  }
  decisionFor(market: string): EnsembleDecision | null {
    this.decisionForCalls.push(market);
    return this.decisions[market] ?? null;
  }
}

function decision(market: string, over: Partial<EnsembleDecision> = {}): EnsembleDecision {
  return {
    market,
    time: NOW - 2 * INTERVAL_MS["15m"],
    price: 1.23,
    action: "buy",
    score: 0.42,
    confidence: 0.6,
    regime: "trend-up",
    atr: Number.NaN,
    votes: [],
    ...over,
  };
}

function eurMarket(m: string): MarketInfo {
  return {
    market: m,
    base: m.split("-")[0],
    quote: "EUR",
    status: "trading",
    minOrderQuote: 5,
    minOrderBase: 0.0001,
    pricePrecision: 5,
    quantityDecimals: 8,
    notionalDecimals: 2,
  };
}

/** Feed met 450 extra verhandelbare EUR-markten. */
class ManyMarketsFeed extends FakeFeed {
  override async getMarkets(): Promise<MarketInfo[]> {
    this.marketsCalls++;
    return [...MARKETS, ...Array.from({ length: 450 }, (_, i) => eurMarket(`M${i}-EUR`))];
  }
}

/** Feed waarvan de historie op de tijdschaal van het trendfilter (1d) mislukt. */
class TrendFailFeed extends FakeFeed {
  override async getHistory(m: string, interval: Interval, from: number, to: number): Promise<Candle[]> {
    if (interval === "1d") {
      this.historyCalls.push({ market: m, interval, from, to });
      throw new Error("Bitvavo antwoordt niet");
    }
    return super.getHistory(m, interval, from, to);
  }
}

/** Recente listing (korte historie) voor de backtest-markt; de trendfilter-historie mislukt. */
class RecentListingTrendFailFeed extends TrendFailFeed {
  override async getHistory(m: string, interval: Interval, from: number, to: number): Promise<Candle[]> {
    if (interval === "1d") return super.getHistory(m, interval, from, to);
    this.historyCalls.push({ market: m, interval, from, to });
    return makeCandles(interval, 201, to).slice(0, -1);
  }
}

describe("PUT /api/config (v2)", () => {
  it("universe, trendFilter en maxSpreadPct gaan (volledig samengevoegd) naar de engine en worden opgeslagen", async () => {
    const engine = new V2Engine();
    srv = await startTestServer({ engine });
    const r = await json(srv.base, "PUT", "/api/config", {
      universe: { count: 100 },
      ensemble: { trendFilter: { coin: true, period: 20 } },
      risk: { maxSpreadPct: 0.5 },
    });
    expect(r.status).toBe(200);
    expect(engine.updates).toHaveLength(1);
    const u = engine.updates[0];
    expect(u.universe).toEqual({ mode: "auto", count: 100, minVolumeEur: 250_000 });
    expect(u.ensemble?.trendFilter).toEqual({ market: true, coin: true, interval: "1d", period: 20 });
    expect(u.ensemble?.enabled).toEqual(DEFAULT_ENGINE_CONFIG.ensemble.enabled);
    expect(u.risk?.maxSpreadPct).toBe(0.5);
    expect(u.risk?.stopAtrMult).toBe(DEFAULT_ENGINE_CONFIG.risk.stopAtrMult);
    expect(r.data.universe).toEqual(u.universe);
    expect(r.data.ensemble.trendFilter).toEqual(u.ensemble?.trendFilter);
    expect(r.data.risk.maxSpreadPct).toBe(0.5);
    expect(srv.persisted).toHaveLength(1);
    expect(srv.persisted[0].universe).toEqual(u.universe);
    expect(srv.persisted[0].ensemble.trendFilter).toEqual(u.ensemble?.trendFilter);
    expect(srv.persisted[0].risk.maxSpreadPct).toBe(0.5);

    // Tweede wijziging bouwt voort op de nieuwe waarden
    const r2 = await json(srv.base, "PUT", "/api/config", { universe: { mode: "manual" }, ensemble: { trendFilter: { market: false } } });
    expect(r2.status).toBe(200);
    expect(r2.data.universe).toEqual({ mode: "manual", count: 100, minVolumeEur: 250_000 });
    expect(r2.data.ensemble.trendFilter).toEqual({ market: false, coin: true, interval: "1d", period: 20 });
  });

  it("met de echte opslag (saveEngineOverrides) staan universe, trendFilter en maxSpreadPct in config.json", async () => {
    srv = await startTestServer({ deps: { persistConfig: undefined } });
    const r = await json(srv.base, "PUT", "/api/config", {
      universe: { mode: "auto", count: 250, minVolumeEur: 1_000_000 },
      ensemble: { trendFilter: { interval: "4h" } },
      risk: { maxSpreadPct: 0 },
    });
    expect(r.status).toBe(200);
    const file = join(srv.config.dataDir, "config.json");
    expect(existsSync(file)).toBe(true);
    const saved = JSON.parse(readFileSync(file, "utf8"));
    expect(saved.universe).toEqual({ mode: "auto", count: 250, minVolumeEur: 1_000_000 });
    expect(saved.ensemble.trendFilter).toEqual({ market: true, coin: false, interval: "4h", period: 50 });
    expect(saved.risk.maxSpreadPct).toBe(0);
  });

  it("tot 400 markten; 401 → 400 'Kies 1 tot 400 markten.'", async () => {
    srv = await startTestServer({ feed: new ManyMarketsFeed() });
    const list = Array.from({ length: 400 }, (_, i) => `M${i}-EUR`);
    const ok = await json(srv.base, "PUT", "/api/config", { markets: list });
    expect(ok.status).toBe(200);
    expect(ok.data.markets).toEqual(list);
    const tooMany = await json(srv.base, "PUT", "/api/config", { markets: [...list, "M400-EUR"] });
    expect(tooMany.status).toBe(400);
    expect(tooMany.data.error).toBe("Kies 1 tot 400 markten.");
    expect(srv.persisted).toHaveLength(1);
  });

  it.each([
    [{ universe: { mode: "alles" } }, /Muntkeuze \(universe\.mode\)/],
    [{ universe: { count: 401 } }, /Aantal munten \(universe\.count\) moet tussen 1 en 400 liggen/],
    [{ universe: { minVolumeEur: -5 } }, /universe\.minVolumeEur/],
    [{ universe: { foo: 1 } }, /Onbekende muntkeuze-instelling: foo/],
    [{ ensemble: { trendFilter: { interval: "1h" } } }, /Tijdschaal van het trendfilter/],
    [{ ensemble: { trendFilter: { period: 300 } } }, /Periode van het trendfilter \(trendFilter\.period\) moet tussen 5 en 200 liggen/],
    [{ ensemble: { trendFilter: { market: "ja" } } }, /Marktfilter \(trendFilter\.market\)/],
    [{ ensemble: { trendFilter: "aan" } }, /ensemble\.trendFilter moet een object zijn/],
    [{ risk: { maxSpreadPct: "breed" } }, /maxSpreadPct moet een getal zijn/],
  ])("400 voor %j (niets opgeslagen, engine niet gewijzigd)", async (body, msg) => {
    const engine = new V2Engine();
    srv = await startTestServer({ engine });
    const r = await json(srv.base, "PUT", "/api/config", body);
    expect(r.status).toBe(400);
    expect(r.data.error).toMatch(msg);
    expect(engine.updates).toHaveLength(0);
    expect(srv.persisted).toHaveLength(0);
  });
});

describe("GET /api/decision", () => {
  it("geeft de laatste beslissing van de engine (ook als de snapshot hem weglaat)", async () => {
    const engine = new V2Engine();
    engine.decisions["M123-EUR"] = decision("M123-EUR");
    srv = await startTestServer({ engine });
    const r = await json(srv.base, "GET", "/api/decision?market=m123-eur");
    expect(r.status).toBe(200);
    expect(r.data.decision).toMatchObject({ market: "M123-EUR", action: "buy", score: 0.42, price: 1.23 });
    expect(r.data.decision.atr).toBeNull(); // NaN → null in JSON
    expect(engine.decisionForCalls).toEqual(["M123-EUR"]);
    expect(r.headers.get("cache-control")).toBe("no-store");
  });

  it("geen beslissing (nog niet beoordeeld of onbekend) → { decision: null }", async () => {
    const engine = new V2Engine();
    srv = await startTestServer({ engine });
    const r = await json(srv.base, "GET", "/api/decision?market=ADA-EUR");
    expect(r.status).toBe(200);
    expect(r.data).toEqual({ decision: null });
  });

  it("engine zonder decisionFor: valt terug op snapshot.decisions", async () => {
    const engine = new FakeEngine();
    const snap = engine.snapshot.bind(engine);
    engine.snapshot = (): EngineSnapshot => ({ ...snap(), decisions: { "ETH-EUR": decision("ETH-EUR", { action: "hold" }) } });
    srv = await startTestServer({ engine });
    const r = await json(srv.base, "GET", "/api/decision?market=ETH-EUR");
    expect(r.status).toBe(200);
    expect(r.data.decision.action).toBe("hold");
    const none = await json(srv.base, "GET", "/api/decision?market=SOL-EUR");
    expect(none.data).toEqual({ decision: null });
  });

  it.each(["", "?market=", "?market=BTC", "?market=BTC-EUR;x", "?market=%3Cscript%3E-EUR", `?market=${"A".repeat(30)}-EUR`])(
    "400 voor ongeldige markt (%s)",
    async (qs) => {
      const engine = new V2Engine();
      srv = await startTestServer({ engine });
      const r = await json(srv.base, "GET", `/api/decision${qs}`);
      expect(r.status).toBe(400);
      expect(r.data.error).toBe("Geef een geldige markt op, bijv. BTC-EUR.");
      expect(engine.decisionForCalls).toEqual([]);
    },
  );

  it("alleen GET", async () => {
    srv = await startTestServer();
    const r = await json(srv.base, "POST", "/api/decision?market=BTC-EUR");
    expect(r.status).toBe(405);
  });
});

describe("backtest / optimize / walk-forward: koersdata voor het trendfilter", () => {
  it("standaard (marktfilter aan, dag, 50): Bitcoin-dagcandles vanaf ruim vóór de eerste handelscandle", async () => {
    srv = await startTestServer();
    const r = await json(srv.base, "POST", "/api/backtest", { market: "ETH-EUR", interval: "1h", days: 30 });
    expect(r.status).toBe(200);
    const input = srv.calls.runBacktest[0];
    // De gewone historie blijft de eerste aanvraag
    expect(srv.feed.historyCalls[0]).toMatchObject({ market: "ETH-EUR", interval: "1h", to: NOW });
    const trendCalls = srv.feed.historyCalls.filter((c) => c.interval === "1d");
    expect(trendCalls).toHaveLength(1);
    const tf = DEFAULT_ENGINE_CONFIG.ensemble.trendFilter!;
    const firstTrade = input.candles[input.tradeFromIndex!].time;
    expect(trendCalls[0]).toEqual({ market: MARKET_FILTER_MARKET, interval: "1d", from: firstTrade - trendWarmupMs(tf), to: NOW });
    expect(trendWarmupMs(tf)).toBe(53 * DAY);
    expect(input.ensemble.trendFilter).toEqual(tf);
    expect(input.trendCandles).toBeDefined();
    expect(input.trendCandles!.market!.length).toBeGreaterThan(50);
    expect(input.trendCandles!.market!.every((c) => c.time + DAY <= NOW)).toBe(true);
    expect(input.trendCandles!.coin).toBeUndefined();
    expect(r.data.note).toBeUndefined();
  });

  it("muntfilter aan: ook de munt zelf op de tijdschaal van het filter", async () => {
    srv = await startTestServer();
    const r = await json(srv.base, "POST", "/api/backtest", {
      market: "SOL-EUR",
      interval: "1h",
      days: 30,
      ensemble: { trendFilter: { coin: true, interval: "4h", period: 20 } },
    });
    expect(r.status).toBe(200);
    const trendCalls = srv.feed.historyCalls.filter((c) => c.interval === "4h");
    expect(trendCalls.map((c) => c.market)).toEqual([MARKET_FILTER_MARKET, "SOL-EUR"]);
    const input = srv.calls.runBacktest[0];
    const firstTrade = input.candles[input.tradeFromIndex!].time;
    expect(trendCalls[0].from).toBe(firstTrade - 23 * INTERVAL_MS["4h"]);
    expect(input.trendCandles!.market!.length).toBeGreaterThan(0);
    expect(input.trendCandles!.coin!.length).toBeGreaterThan(0);
  });

  it("filter uit in het verzoek (vergelijken zonder): geen extra koersdata, geen trendCandles", async () => {
    srv = await startTestServer();
    const r = await json(srv.base, "POST", "/api/backtest", {
      market: "BTC-EUR",
      interval: "1h",
      days: 30,
      ensemble: { trendFilter: { market: false, coin: false } },
    });
    expect(r.status).toBe(200);
    expect(srv.feed.historyCalls).toHaveLength(1);
    expect("trendCandles" in srv.calls.runBacktest[0]).toBe(false);
    expect(srv.calls.runBacktest[0].ensemble.trendFilter).toEqual({ market: false, coin: false, interval: "1d", period: 50 });
  });

  it("filter uit in de instellingen van de bot: backtest zonder trendCandles", async () => {
    const engine = new FakeEngine();
    engine.config.ensemble.trendFilter = { market: false, coin: false, interval: "1d", period: 50 };
    srv = await startTestServer({ engine });
    const r = await json(srv.base, "POST", "/api/backtest", { market: "BTC-EUR", interval: "1h", days: 30 });
    expect(r.status).toBe(200);
    expect(srv.calls.runBacktest[0].trendCandles).toBeUndefined();
    expect(srv.feed.historyCalls).toHaveLength(1);
  });

  it("laden mislukt: backtest gaat door (filter blokkeert voor de zekerheid) en de note zegt waarom", async () => {
    const feed = new TrendFailFeed();
    srv = await startTestServer({ feed });
    const r = await json(srv.base, "POST", "/api/backtest", { market: "ETH-EUR", interval: "1h", days: 30 });
    expect(r.status).toBe(200);
    expect(srv.calls.runBacktest[0].trendCandles).toEqual({});
    expect(r.data.note).toBe(
      "Trendfilter: Koersdata voor het marktfilter (BTC-EUR) niet geladen: Bitvavo antwoordt niet — voor de zekerheid geen aankopen.",
    );
  });

  it("de trendfilter-note komt achter 'Periode ingekort'", async () => {
    const feed = new RecentListingTrendFailFeed();
    srv = await startTestServer({ feed });
    const r = await json(srv.base, "POST", "/api/backtest", { market: "BTC-EUR", interval: "1h", days: 30 });
    expect(r.status).toBe(200);
    expect(r.data.note).toMatch(/^Periode ingekort: .* Trendfilter: Koersdata voor het marktfilter \(BTC-EUR\) niet geladen/);
    // Het trendfilter begint bij de eerste handelscandle (na de warmup), niet bij het begin van de periode
    const input = srv.calls.runBacktest[0];
    const trendCall = feed.historyCalls.find((c) => c.interval === "1d")!;
    expect(trendCall.from).toBe(input.candles[input.tradeFromIndex!].time - 53 * DAY);
  });

  it("een eigen note van de berekening blijft behouden (achter de note van het ophalen)", async () => {
    const { services } = makeServices();
    const base = services.runBacktest.bind(services);
    services.runBacktest = async (input) => ({ ...(await base(input)), note: "Spread te groot: geen aankopen." });
    srv = await startTestServer({ feed: new TrendFailFeed(), deps: { services } });
    const r = await json(srv.base, "POST", "/api/backtest", { market: "ETH-EUR", interval: "1h", days: 30 });
    expect(r.status).toBe(200);
    expect(r.data.note).toMatch(/^Trendfilter: Koersdata voor het marktfilter .* geen aankopen\. Spread te groot: geen aankopen\.$/);

    // Zonder note van het ophalen: de eigen note ongewijzigd
    await srv.close();
    srv = await startTestServer({ deps: { services } });
    const plain = await json(srv.base, "POST", "/api/backtest", { market: "ETH-EUR", interval: "1h", days: 30 });
    expect(plain.data.note).toBe("Spread te groot: geen aankopen.");
  });

  it("optimize en walk-forward krijgen dezelfde trendCandles mee", async () => {
    srv = await startTestServer();
    const o = await json(srv.base, "POST", "/api/optimize", { market: "ETH-EUR", interval: "1h", days: 30, objective: "sharpe" });
    expect(o.status).toBe(200);
    const w = await json(srv.base, "POST", "/api/walkforward", {
      market: "SOL-EUR",
      interval: "1h",
      days: 60,
      objective: "return",
      folds: 3,
      trainRatio: 0.6,
      ensemble: { trendFilter: { coin: true } },
    });
    expect(w.status).toBe(200);
    expect(srv.calls.optimize[0].input.trendCandles?.market?.length).toBeGreaterThan(50);
    expect(srv.calls.optimize[0].input.trendCandles?.coin).toBeUndefined();
    expect(srv.calls.walkForward[0].input.trendCandles?.market?.length).toBeGreaterThan(50);
    expect(srv.calls.walkForward[0].input.trendCandles?.coin?.length).toBeGreaterThan(50);
    expect(srv.calls.walkForward[0].input.ensemble.trendFilter?.coin).toBe(true);
  });

  it("de backtest-markt is Bitcoin met muntfilter: Bitcoin wordt maar één keer opgehaald", async () => {
    srv = await startTestServer();
    const r = await json(srv.base, "POST", "/api/backtest", {
      market: "BTC-EUR",
      interval: "1h",
      days: 30,
      ensemble: { trendFilter: { coin: true } },
    });
    expect(r.status).toBe(200);
    expect(srv.feed.historyCalls.filter((c) => c.interval === "1d")).toHaveLength(1);
    const tc = srv.calls.runBacktest[0].trendCandles!;
    expect(tc.coin).toBe(tc.market);
  });
});
