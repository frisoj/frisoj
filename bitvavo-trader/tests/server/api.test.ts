import { afterEach, describe, expect, it } from "vitest";
import { DEFAULT_ENGINE_CONFIG } from "../../src/core/defaults";
import { INTERVAL_MS, type Candle, type Interval, type Ticker24h } from "../../src/core/types";
import { BACKTEST_WARMUP_CANDLES, MIN_PERIOD_CANDLES, SPREAD_LOOKUP_TIMEOUT_MS } from "../../src/server/routes";
import { backtestWarmupCandles } from "../../src/server/warmup";
import { FakeFeed, NOW, json, makeCandles, makePosition, startTestServer, type TestServer } from "./helpers";

/** Markt die pas `count` candles geleden genoteerd werd (historie begint ná `from`). */
class RecentListingFeed extends FakeFeed {
  constructor(private readonly count: number) {
    super();
  }
  override async getHistory(m: string, interval: Interval, from: number, to: number): Promise<Candle[]> {
    this.historyCalls.push({ market: m, interval, from, to });
    return makeCandles(interval, this.count + 1, to).slice(0, -1);
  }
}

let srv: TestServer | null = null;
afterEach(async () => {
  await srv?.close();
  srv = null;
});

describe("API: basis", () => {
  it("geeft info, state en config terug", async () => {
    srv = await startTestServer();
    const info = await json(srv.base, "GET", "/api/info");
    expect(info.status).toBe(200);
    expect(info.data).toMatchObject({
      mode: "paper",
      dataSource: "simulated",
      hasApiKeys: false,
      liveArmed: false,
      capitalLimitQuote: 50,
    });
    expect(typeof info.data.version).toBe("string");

    const state = await json(srv.base, "GET", "/api/state");
    expect(state.status).toBe(200);
    expect(state.data.mode).toBe("paper");
    expect(state.headers.get("cache-control")).toBe("no-store");

    const cfg = await json(srv.base, "GET", "/api/config");
    expect(cfg.data.interval).toBe("15m");
  });

  it("404 voor onbekende API-paden, 405 voor verkeerde methode", async () => {
    srv = await startTestServer();
    const nf = await json(srv.base, "GET", "/api/bestaat-niet");
    expect(nf.status).toBe(404);
    expect(typeof nf.data.error).toBe("string");
    const na = await json(srv.base, "DELETE", "/api/config");
    expect(na.status).toBe(405);
    expect(na.headers.get("allow")).toContain("GET");
  });

  it("weigert ongeldige JSON, verkeerde content-type en te grote bodies", async () => {
    srv = await startTestServer();
    const bad = await json(srv.base, "PUT", "/api/config", "{nope", { "Content-Type": "application/json" });
    expect(bad.status).toBe(400);
    expect(bad.data.error).toMatch(/JSON/);

    const text = await json(srv.base, "PUT", "/api/config", '{"pollMs":10000}', { "Content-Type": "text/plain" });
    expect(text.status).toBe(415);

    const big = await json(srv.base, "PUT", "/api/config", { pad: "x".repeat(1024 * 1024 + 10) });
    expect(big.status).toBe(413);
  });

  it("start, stop en kill de engine", async () => {
    srv = await startTestServer();
    let r = await json(srv.base, "POST", "/api/engine/start");
    expect(r.status).toBe(200);
    expect(r.data.running).toBe(true);
    r = await json(srv.base, "POST", "/api/engine/stop");
    expect(r.data.running).toBe(false);
    r = await json(srv.base, "POST", "/api/engine/kill");
    expect(r.status).toBe(200);
    expect(srv.engine.killed).toBe(1);
  });

  it("sluit posities handmatig en geeft 404 voor onbekende id", async () => {
    srv = await startTestServer();
    srv.engine.positions = [makePosition("pos_abc")];
    const nf = await json(srv.base, "POST", "/api/positions/pos_onbekend/close");
    expect(nf.status).toBe(404);
    const ok = await json(srv.base, "POST", "/api/positions/pos_abc/close");
    expect(ok.status).toBe(200);
    expect(ok.data.exitReason).toBe("manual");
    expect(srv.engine.closed).toEqual([{ id: "pos_abc", reason: "manual" }]);
  });

  it("geeft alleen verhandelbare EUR-markten, gesorteerd", async () => {
    srv = await startTestServer();
    const r = await json(srv.base, "GET", "/api/markets");
    expect(r.status).toBe(200);
    expect(r.data.map((m: { market: string }) => m.market)).toEqual(["ADA-EUR", "BTC-EUR", "ETH-EUR", "SOL-EUR"]);
  });

  it("geeft strategieën terug", async () => {
    srv = await startTestServer();
    const r = await json(srv.base, "GET", "/api/strategies");
    expect(r.status).toBe(200);
    expect(r.data[0].id).toBe("ema-trend");
  });
});

describe("API: PUT /api/config", () => {
  it("valideert en slaat op", async () => {
    srv = await startTestServer();
    const r = await json(srv.base, "PUT", "/api/config", {
      markets: ["btc-eur", "ETH-EUR"],
      interval: "5m",
      pollMs: 10000,
      historyCandles: 400,
      risk: { riskPerTradePct: 2 },
      ensemble: { buyThreshold: 0.4, weights: { breakout: 2 }, enabled: ["ema-trend", "breakout"] },
    });
    expect(r.status).toBe(200);
    expect(r.data.markets).toEqual(["BTC-EUR", "ETH-EUR"]);
    expect(r.data.interval).toBe("5m");
    expect(r.data.risk.riskPerTradePct).toBe(2);
    // overige risk-velden blijven behouden
    expect(r.data.risk.stopAtrMult).toBe(2);
    expect(r.data.ensemble.buyThreshold).toBe(0.4);
    expect(r.data.ensemble.weights.breakout).toBe(2);
    expect(r.data.ensemble.weights["ema-trend"]).toBe(1.2);
    expect(r.data.ensemble.enabled).toEqual(["ema-trend", "breakout"]);
    expect(srv.persisted).toHaveLength(1);
    expect(srv.persisted[0].interval).toBe("5m");
  });

  it.each([
    [{ markets: ["DOGE-EUR"] }, /Onbekende/],
    [{ markets: ["XRP-EUR"] }, /niet-verhandelbare/],
    [{ markets: ["BTC-USDC"] }, /EUR/],
    [{ markets: [] }, /Kies 1 tot 400 markten/],
    [{ markets: "BTC-EUR" }, /lijst/],
    [{ interval: "3m" }, /interval/],
    [{ pollMs: 1000 }, /pollMs/],
    [{ pollMs: 400000 }, /pollMs/],
    [{ historyCandles: 50 }, /historyCandles/],
    [{ risk: { riskPerTradePct: 10 } }, /maximaal 5%/],
    [{ risk: { onbekend: 1 } }, /Onbekende risico/],
    [{ risk: { stopAtrMult: "abc" } }, /getal/],
    [{ ensemble: { buyThreshold: 0.01 } }, /Koopdrempel/],
    [{ ensemble: { sellThreshold: 0.2 } }, /Verkoopdrempel/],
    [{ ensemble: { weights: { "ema-trend": 6 } } }, /Gewicht/],
    [{ ensemble: { enabled: [] } }, /minstens één/],
    [{ ensemble: { enabled: ["magie"] } }, /Onbekende strategie/],
    [{ ensemble: { params: { "ema-trend": { bogus: 3 } } } }, /Onbekende parameter/],
    [{ foo: 1 }, /Onbekende instelling/],
  ])("400 voor %j", async (body, msg) => {
    srv = await startTestServer();
    const r = await json(srv.base, "PUT", "/api/config", body);
    expect(r.status).toBe(400);
    expect(r.data.error).toMatch(msg);
    expect(srv.persisted).toHaveLength(0);
  });

  it("400 zonder body", async () => {
    srv = await startTestServer();
    const r = await json(srv.base, "PUT", "/api/config");
    expect(r.status).toBe(400);
  });
});

describe("API: /api/candles", () => {
  it("geeft candles, indicatoren en signalen; beslissingen alleen op gesloten candles", async () => {
    srv = await startTestServer();
    srv.engine.positions = [makePosition("p1", "BTC-EUR"), makePosition("p2", "ETH-EUR")];
    const r = await json(srv.base, "GET", "/api/candles?market=BTC-EUR&interval=15m&limit=100");
    expect(r.status).toBe(200);
    expect(r.data.market).toBe("BTC-EUR");
    expect(r.data.candles).toHaveLength(100);
    expect(r.data.indicators.rsi).toHaveLength(100);
    // laatste candle is nog in vorming → 99 gesloten candles
    const call = srv.calls.runEnsemble.at(-1)!;
    expect(call.count).toBe(99);
    expect(call.lastTime + INTERVAL_MS["15m"]).toBeLessThanOrEqual(NOW);
    expect(r.data.decision.action).toBe("buy");
    expect(r.data.decision.atr).toBeNull(); // NaN → null in JSON
    expect(r.data.signals.map((s: { action: string }) => s.action)).toEqual(["sell", "buy"]);
    expect(r.data.positions.map((p: { id: string }) => p.id)).toEqual(["p1"]);
    expect(srv.feed.candleCalls.at(-1)).toEqual({ market: "BTC-EUR", interval: "15m", limit: 100 });
  });

  it("begrenst limit op 50–1000", async () => {
    srv = await startTestServer();
    const low = await json(srv.base, "GET", "/api/candles?market=BTC-EUR&interval=1h&limit=25");
    expect(low.status).toBe(200);
    expect(low.data.candles).toHaveLength(50);
    const high = await json(srv.base, "GET", "/api/candles?market=BTC-EUR&interval=1h&limit=5000");
    expect(high.status).toBe(200);
    expect(high.data.candles).toHaveLength(1000);
  });

  it("gebruikt standaard limit 300", async () => {
    srv = await startTestServer();
    const r = await json(srv.base, "GET", "/api/candles?market=ETH-EUR&interval=1h");
    expect(r.status).toBe(200);
    expect(r.data.candles).toHaveLength(300);
  });

  it.each([
    ["market=DOGE-EUR&interval=15m", /Onbekende markt/],
    ["interval=15m", /markt/],
    ["market=BTC-EUR&interval=7m", /interval/],
    ["market=BTC-EUR&interval=15m&limit=abc", /limit/],
    ["market=BTC-EUR&interval=15m&limit=0", /limit/],
    ["market=BTC-EUR&interval=15m&limit=12.5", /limit/],
  ])("400 voor %s", async (qs, msg) => {
    srv = await startTestServer();
    const r = await json(srv.base, "GET", `/api/candles?${qs}`);
    expect(r.status).toBe(400);
    expect(r.data.error).toMatch(msg);
  });
});

describe("API: /api/scanner", () => {
  it("geeft top-N EUR-markten op volume met indicatoren, en cachet", async () => {
    srv = await startTestServer();
    const r = await json(srv.base, "GET", "/api/scanner?limit=3");
    expect(r.status).toBe(200);
    expect(r.data.map((x: { market: string }) => x.market)).toEqual(["BTC-EUR", "ETH-EUR", "SOL-EUR"]);
    const row = r.data[0];
    expect(row.volatilityPct).toBeGreaterThan(0);
    expect(row.regime).toBe("trend-up");
    expect(row.action).toBe("buy");
    expect(row.rsi).toBeCloseTo(55.6, 1);
    expect(row.sparkline).toHaveLength(48);
    expect(row.spreadPct).toBeCloseTo(0.2, 3);
    expect(srv.feed.candleCalls.every((c) => c.limit === 150 && c.interval === "15m")).toBe(true);

    const before = srv.feed.tickerCalls;
    const again = await json(srv.base, "GET", "/api/scanner?limit=3");
    expect(again.data).toEqual(r.data);
    expect(srv.feed.tickerCalls).toBe(before); // uit cache
  });

  it("slaat markten over die falen en begrenst limit op 60", async () => {
    const feed = new FakeFeed();
    feed.failCandlesFor.add("ETH-EUR");
    srv = await startTestServer({ feed });
    const r = await json(srv.base, "GET", "/api/scanner?limit=500");
    expect(r.status).toBe(200);
    expect(r.data.map((x: { market: string }) => x.market)).toEqual(["BTC-EUR", "SOL-EUR", "ADA-EUR"]);
    const bad = await json(srv.base, "GET", "/api/scanner?limit=-1");
    expect(bad.status).toBe(400);
  });
});

describe("API: backtest / optimize / walk-forward", () => {
  it("draait een backtest met warmup en overrides", async () => {
    srv = await startTestServer();
    const r = await json(srv.base, "POST", "/api/backtest", {
      market: "BTC-EUR",
      interval: "15m",
      days: 14,
      ensemble: { buyThreshold: 0.5 },
      risk: { stopAtrMult: 3 },
    });
    expect(r.status).toBe(200);
    const input = srv.calls.runBacktest[0];
    expect(input.initialCapital).toBe(50);
    expect(input.ensemble.buyThreshold).toBe(0.5);
    expect(input.ensemble.sellThreshold).toBe(-0.3);
    expect(input.risk.stopAtrMult).toBe(3);
    expect(input.risk.takerFee).toBe(0.0025);
    expect(input.marketInfo?.market).toBe("BTC-EUR");
    expect(input.dataSource).toBe("simulated");
    const call = srv.feed.historyCalls[0];
    expect(call.to).toBe(NOW);
    expect(call.from).toBe(NOW - 14 * 86_400_000 - BACKTEST_WARMUP_CANDLES * INTERVAL_MS["15m"]);
    expect(input.tradeFromIndex).toBeGreaterThanOrEqual(BACKTEST_WARMUP_CANDLES - 1);
    expect(input.candles[input.tradeFromIndex!].time).toBeGreaterThanOrEqual(NOW - 14 * 86_400_000);
  });

  it("begrenst het aantal dagen per interval", async () => {
    srv = await startTestServer();
    const r = await json(srv.base, "POST", "/api/backtest", { market: "BTC-EUR", interval: "1m", days: 60, initialCapital: 100 });
    expect(r.status).toBe(200);
    const call = srv.feed.historyCalls[0];
    expect(call.from).toBe(NOW - 7 * 86_400_000 - BACKTEST_WARMUP_CANDLES * INTERVAL_MS["1m"]);
    expect(srv.calls.runBacktest[0].initialCapital).toBe(100);
  });

  it.each([
    ["/api/backtest", { interval: "15m", days: 10 }, /markt/],
    ["/api/backtest", { market: "DOGE-EUR", interval: "15m", days: 10 }, /Onbekende markt/],
    ["/api/backtest", { market: "BTC-EUR", interval: "2m", days: 10 }, /interval/],
    ["/api/backtest", { market: "BTC-EUR", interval: "15m", days: 0 }, /days/],
    ["/api/backtest", { market: "BTC-EUR", interval: "15m", days: 10, initialCapital: 1 }, /Startkapitaal/],
    ["/api/backtest", { market: "BTC-EUR", interval: "15m", days: 10, risk: { riskPerTradePct: 9 } }, /maximaal 5%/],
    ["/api/backtest", { market: "BTC-EUR", interval: "15m", days: 10, ensemble: { sellThreshold: 0.5 } }, /Verkoopdrempel/],
    ["/api/optimize", { market: "BTC-EUR", interval: "15m", days: 10, objective: "geluk" }, /objective/],
    ["/api/optimize", { market: "BTC-EUR", interval: "15m", days: 10, objective: "sharpe", maxCombos: 500 }, /maxCombos/],
    ["/api/optimize", { market: "BTC-EUR", interval: "15m", days: 10, objective: "sharpe", strategy: "x" }, /strategie/],
    ["/api/walkforward", { market: "BTC-EUR", interval: "15m", days: 10, objective: "sharpe", folds: 9, trainRatio: 0.7 }, /folds/],
    ["/api/walkforward", { market: "BTC-EUR", interval: "15m", days: 10, objective: "sharpe", folds: 1, trainRatio: 0.7 }, /folds/],
    ["/api/walkforward", { market: "BTC-EUR", interval: "15m", days: 10, objective: "sharpe", folds: 4, trainRatio: 0.95 }, /trainRatio/],
  ])("400 voor %s %j", async (path, body, msg) => {
    srv = await startTestServer();
    const r = await json(srv.base, "POST", path, body);
    expect(r.status).toBe(400);
    expect(r.data.error).toMatch(msg);
    expect(srv.feed.historyCalls).toHaveLength(0);
  });

  it("geeft opties door aan optimize en walkForward", async () => {
    srv = await startTestServer();
    const o = await json(srv.base, "POST", "/api/optimize", {
      market: "ETH-EUR",
      interval: "1h",
      days: 30,
      objective: "calmar",
      strategy: "ema-trend",
      maxCombos: 200,
    });
    expect(o.status).toBe(200);
    expect(srv.calls.optimize[0].opts).toEqual({ strategy: "ema-trend", objective: "calmar", maxCombos: 200 });
    const w = await json(srv.base, "POST", "/api/walkforward", {
      market: "ETH-EUR",
      interval: "1h",
      days: 60,
      objective: "return",
      folds: 3,
      trainRatio: 0.6,
    });
    expect(w.status).toBe(200);
    expect(srv.calls.walkForward[0].opts).toMatchObject({ objective: "return", folds: 3, trainRatio: 0.6 });
  });

  it("geeft 429 als er al een zware berekening loopt", async () => {
    const feed = new FakeFeed();
    let release!: () => void;
    feed.historyGate = new Promise<void>((r) => (release = r));
    srv = await startTestServer({ feed });
    const first = json(srv.base, "POST", "/api/backtest", { market: "BTC-EUR", interval: "15m", days: 5 });
    // wacht tot de eerste job in getHistory hangt
    for (let i = 0; i < 50 && feed.historyCalls.length === 0; i++) await new Promise((r) => setTimeout(r, 10));
    expect(feed.historyCalls).toHaveLength(1);
    const second = await json(srv.base, "POST", "/api/optimize", {
      market: "BTC-EUR",
      interval: "15m",
      days: 5,
      objective: "sharpe",
    });
    expect(second.status).toBe(429);
    expect(second.data.error).toMatch(/Er loopt al een berekening/);
    release();
    expect((await first).status).toBe(200);
    // daarna kan het weer
    const third = await json(srv.base, "POST", "/api/backtest", { market: "BTC-EUR", interval: "15m", days: 5 });
    expect(third.status).toBe(200);
  });
});

describe("API: spread uit de 24h-ticker voor backtests", () => {
  class TickerFeed extends FakeFeed {
    constructor(private readonly mode: "throw" | "no-bid" | "hang") {
      super();
    }
    override async getTickers24h(): Promise<Ticker24h[]> {
      const all = await super.getTickers24h(); // telt tickerCalls
      if (this.mode === "throw") throw new Error("Bitvavo onbereikbaar");
      if (this.mode === "hang") return new Promise<Ticker24h[]>(() => {});
      return all.map((t) => ({ ...t, bid: null }));
    }
  }

  it("backtest, optimize en walk-forward krijgen de huidige spread (fractie) mee", async () => {
    srv = await startTestServer();
    const b = await json(srv.base, "POST", "/api/backtest", { market: "BTC-EUR", interval: "1h", days: 30 });
    expect(b.status).toBe(200);
    const o = await json(srv.base, "POST", "/api/optimize", { market: "ETH-EUR", interval: "1h", days: 30, objective: "sharpe" });
    expect(o.status).toBe(200);
    const w = await json(srv.base, "POST", "/api/walkforward", {
      market: "SOL-EUR",
      interval: "1h",
      days: 60,
      objective: "return",
      folds: 3,
      trainRatio: 0.6,
    });
    expect(w.status).toBe(200);
    // FakeFeed: bid 99.9, ask 100.1 → (0.2 / 100) = 0.002
    expect(srv.calls.runBacktest[0].spreadPct).toBeCloseTo(0.002, 10);
    expect(srv.calls.optimize[0].input.spreadPct).toBeCloseTo(0.002, 10);
    expect(srv.calls.walkForward[0].input.spreadPct).toBeCloseTo(0.002, 10);
  });

  it.each(["throw", "no-bid"] as const)("ticker faalt/onbruikbaar (%s) → backtest gaat door zonder spread", async (mode) => {
    const feed = new TickerFeed(mode);
    srv = await startTestServer({ feed });
    const r = await json(srv.base, "POST", "/api/backtest", { market: "BTC-EUR", interval: "1h", days: 30 });
    expect(r.status).toBe(200);
    expect(feed.tickerCalls).toBe(1);
    expect(srv.calls.runBacktest[0].spreadPct).toBeUndefined();
    expect("spreadPct" in srv.calls.runBacktest[0]).toBe(false);
  });

  it(
    "een hangende ticker houdt de backtest niet tegen",
    async () => {
      const feed = new TickerFeed("hang");
      srv = await startTestServer({ feed });
      const t0 = Date.now();
      const r = await json(srv.base, "POST", "/api/backtest", { market: "BTC-EUR", interval: "1h", days: 30 });
      expect(r.status).toBe(200);
      expect(Date.now() - t0).toBeLessThan(SPREAD_LOOKUP_TIMEOUT_MS + 2_000);
      expect(srv.calls.runBacktest[0].spreadPct).toBeUndefined();
    },
    SPREAD_LOOKUP_TIMEOUT_MS + 5_000,
  );
});

describe("API: backtestperiode en warmup", () => {
  it.each([
    ["1d", 30],
    ["4h", 5],
    ["1h", 1],
  ])("400 als de periode te kort is (%s, %d dagen) in plaats van stilletjes te verbreden", async (interval, days) => {
    srv = await startTestServer();
    const r = await json(srv.base, "POST", "/api/backtest", { market: "BTC-EUR", interval, days });
    expect(r.status).toBe(400);
    expect(r.data.error).toMatch(/Periode te kort/);
    expect(r.data.error).toContain(`minimaal ${MIN_PERIOD_CANDLES}`);
    expect(srv.calls.runBacktest).toHaveLength(0);
  });

  it.each([
    ["1d", 31],
    ["4h", 6],
    ["1h", 2],
  ])("net lang genoeg (%s, %d dagen) → de test begint op de gevraagde periode", async (interval, days) => {
    srv = await startTestServer();
    const r = await json(srv.base, "POST", "/api/backtest", { market: "BTC-EUR", interval, days });
    expect(r.status).toBe(200);
    const input = srv.calls.runBacktest[0];
    const from = NOW - days * 86_400_000;
    const idx = input.tradeFromIndex!;
    expect(input.candles[idx].time).toBeGreaterThanOrEqual(from);
    expect(input.candles[idx - 1].time).toBeLessThan(from);
    expect(input.candles.length - idx).toBeGreaterThanOrEqual(MIN_PERIOD_CANDLES);
    expect(r.data.note).toBeUndefined();
  });

  it("recente listing: handelt nooit tijdens de warmup en meldt de ingekorte periode", async () => {
    const feed = new RecentListingFeed(200);
    srv = await startTestServer({ feed });
    const r = await json(srv.base, "POST", "/api/backtest", { market: "BTC-EUR", interval: "1h", days: 30 });
    expect(r.status).toBe(200);
    const input = srv.calls.runBacktest[0];
    const required = backtestWarmupCandles(DEFAULT_ENGINE_CONFIG.ensemble);
    expect(required).toBeGreaterThanOrEqual(101 + 1); // ema-trend (trend 100) + marge
    expect(input.tradeFromIndex).toBeGreaterThanOrEqual(required);
    expect(input.tradeFromIndex).toBe(required);
    expect(r.data.note).toMatch(/Periode ingekort/);
  });

  it("recente listing met te weinig historie na de warmup → 400", async () => {
    const feed = new RecentListingFeed(120);
    srv = await startTestServer({ feed });
    const r = await json(srv.base, "POST", "/api/backtest", { market: "BTC-EUR", interval: "1h", days: 30 });
    expect(r.status).toBe(400);
    expect(r.data.error).toMatch(/te weinig historie/);
    expect(r.data.error).toMatch(/opwarmtijd/);
    expect(srv.calls.runBacktest).toHaveLength(0);
  });

  it("haalt extra warmup op als de strategieparameters meer dan 250 candles nodig hebben", async () => {
    srv = await startTestServer();
    const r = await json(srv.base, "POST", "/api/backtest", {
      market: "BTC-EUR",
      interval: "1h",
      days: 30,
      ensemble: { params: { "ema-trend": { slow: 400 } } },
    });
    expect(r.status).toBe(200);
    const required = backtestWarmupCandles({
      ...DEFAULT_ENGINE_CONFIG.ensemble,
      params: { "ema-trend": { slow: 400 } },
    });
    expect(required).toBeGreaterThan(BACKTEST_WARMUP_CANDLES);
    const call = srv.feed.historyCalls[0];
    expect(call.from).toBe(NOW - 30 * 86_400_000 - required * INTERVAL_MS["1h"]);
    expect(srv.calls.runBacktest[0].tradeFromIndex).toBeGreaterThanOrEqual(required);
  });

  it("optimize met een strategie houdt rekening met de grootste parameters uit de zoekruimte", () => {
    const base = backtestWarmupCandles(DEFAULT_ENGINE_CONFIG.ensemble);
    const withSpace = backtestWarmupCandles(DEFAULT_ENGINE_CONFIG.ensemble, "ema-trend");
    expect(withSpace).toBeGreaterThanOrEqual(201); // trend-EMA 200 in de zoekruimte
    expect(withSpace).toBeGreaterThan(base);
  });
});

describe("API: invoerfouten zijn 400, geen 500", () => {
  it("walk-forward met te weinig candles voor de folds → 400", async () => {
    srv = await startTestServer();
    const r = await json(srv.base, "POST", "/api/walkforward", {
      market: "BTC-EUR",
      interval: "1h",
      days: 2,
      folds: 8,
      objective: "sharpe",
    });
    expect(r.status).toBe(400);
    expect(r.data.error).toMatch(/Te weinig candles voor een walk-forward met 8 folds/);
    expect(srv.calls.walkForward).toHaveLength(0);
    // en daarna is de server niet "bezet"
    const ok = await json(srv.base, "POST", "/api/backtest", { market: "BTC-EUR", interval: "1h", days: 5 });
    expect(ok.status).toBe(200);
  });

  it("extreem diep geneste JSON → 400", async () => {
    srv = await startTestServer();
    const depth = 200_000;
    const deep = `{"ensemble":{"enabled":${"[".repeat(depth)}${"]".repeat(depth)}}}`;
    const r = await json(srv.base, "PUT", "/api/config", deep, { "Content-Type": "application/json" });
    expect(r.status).toBe(400);
    expect(r.data.error).toMatch(/te diep genest/);
    const mid = `{"ensemble":{"enabled":${"[".repeat(40)}${"]".repeat(40)}}}`;
    const r2 = await json(srv.base, "PUT", "/api/config", mid, { "Content-Type": "application/json" });
    expect(r2.status).toBe(400);
    expect(srv.persisted).toHaveLength(0);
  });

  it("geneste lijsten in een strategielijst geven een nette foutmelding", async () => {
    srv = await startTestServer();
    const r = await json(srv.base, "PUT", "/api/config", { ensemble: { enabled: [[["ema-trend"]]] } });
    expect(r.status).toBe(400);
    expect(r.data.error).toMatch(/Onbekende strategie\(ën\): \[lijst\]/);
    const o = await json(srv.base, "POST", "/api/optimize", {
      market: "BTC-EUR",
      interval: "15m",
      days: 10,
      strategy: [[1]],
    });
    expect(o.status).toBe(400);
    expect(o.data.error).toMatch(/Onbekende strategie: \[lijst\]/);
  });
});

describe("API: scanner-cache", () => {
  it("een grotere scan bedient ook kleinere limits (geen extra Bitvavo-verzoeken)", async () => {
    srv = await startTestServer();
    const big = await json(srv.base, "GET", "/api/scanner?limit=4");
    expect(big.status).toBe(200);
    expect(big.data).toHaveLength(4);
    const tickers = srv.feed.tickerCalls;
    const candles = srv.feed.candleCalls.length;
    for (let n = 1; n <= 4; n++) {
      const r = await json(srv.base, "GET", `/api/scanner?limit=${n}`);
      expect(r.status).toBe(200);
      expect(r.data).toEqual(big.data.slice(0, n));
    }
    expect(srv.feed.tickerCalls).toBe(tickers);
    expect(srv.feed.candleCalls.length).toBe(candles);
  });

  it("gelijktijdige verzoeken met verschillende limits delen de grootste lopende scan", async () => {
    srv = await startTestServer();
    const first = json(srv.base, "GET", "/api/scanner?limit=4");
    // wacht tot de eerste scan loopt
    for (let i = 0; i < 100 && srv.feed.tickerCalls === 0; i++) await new Promise((r) => setTimeout(r, 2));
    const rest = await Promise.all([1, 2, 3].map((n) => json(srv!.base, "GET", `/api/scanner?limit=${n}`)));
    const all = await first;
    expect(all.data).toHaveLength(4);
    rest.forEach((r, i) => expect(r.data).toEqual(all.data.slice(0, i + 1)));
    expect(srv.feed.tickerCalls).toBe(1);
  });

  it("met een mislukte markt levert een kleinere limit dezelfde rangorde", async () => {
    const feed = new FakeFeed();
    feed.failCandlesFor.add("ETH-EUR");
    srv = await startTestServer({ feed });
    const all = await json(srv.base, "GET", "/api/scanner?limit=4");
    expect(all.data.map((x: { market: string }) => x.market)).toEqual(["BTC-EUR", "SOL-EUR", "ADA-EUR"]);
    const two = await json(srv.base, "GET", "/api/scanner?limit=2");
    expect(two.data.map((x: { market: string }) => x.market)).toEqual(["BTC-EUR"]);
  });
});
