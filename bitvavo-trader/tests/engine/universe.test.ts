import { describe, expect, it } from "vitest";
import type { MarketInfo, Ticker24h, UniverseConfig } from "../../src/core/types";
import { EXCLUDED_BASES, SPREAD_EPS_PCT, selectUniverse, spreadAboveLimit, tickerSpreadPct } from "../../src/engine/universe";

function info(market: string, over: Partial<MarketInfo> = {}): MarketInfo {
  const [base, quote] = market.split("-");
  return {
    market, base, quote, status: "trading", minOrderQuote: 5, minOrderBase: 0,
    pricePrecision: 5, quantityDecimals: 8, notionalDecimals: 2, ...over,
  };
}

function ticker(market: string, volumeQuote: number, bid: number | null = 100, ask: number | null = 100.05): Ticker24h {
  return { market, last: 100, open: 100, high: 101, low: 99, volume: 1, volumeQuote, bid, ask, changePct: 0, timestamp: 0 };
}

const CFG: UniverseConfig = { mode: "auto", count: 3, minVolumeEur: 1000 };

describe("selectUniverse", () => {
  it("kiest de meest verhandelde EUR-markten, hoogste volume eerst", () => {
    const markets = ["BTC-EUR", "ETH-EUR", "SOL-EUR", "XRP-EUR", "ADA-EUR"].map((m) => info(m));
    const tickers = [ticker("BTC-EUR", 9e6), ticker("ETH-EUR", 5e6), ticker("SOL-EUR", 7e6), ticker("XRP-EUR", 1e6), ticker("ADA-EUR", 2e6)];
    const sel = selectUniverse(markets, tickers, CFG);
    expect(sel.markets).toEqual(["BTC-EUR", "SOL-EUR", "ETH-EUR"]);
    expect(sel.eligible).toBe(5);
    expect(sel.excluded).toEqual([]);
  });

  it("filtert stablecoins, niet-EUR, niet-handelbaar, laag volume, grote spread en ontbrekend volume", () => {
    const markets = [
      info("BTC-EUR"), info("USDC-EUR"), info("ETH-BTC"), info("LUNA-EUR", { status: "halted" }),
      info("TINY-EUR"), info("WIDE-EUR"), info("NOVOL-EUR"), info("NOBOOK-EUR"),
    ];
    const tickers = [
      ticker("BTC-EUR", 9e6), ticker("USDC-EUR", 8e6), ticker("ETH-BTC", 8e6), ticker("LUNA-EUR", 8e6),
      ticker("TINY-EUR", 500), ticker("WIDE-EUR", 5e6, 100, 101), ticker("NOBOOK-EUR", 4e6, null, null),
    ];
    const sel = selectUniverse(markets, tickers, { ...CFG, count: 10 }, 0.3);
    expect(sel.markets).toEqual(["BTC-EUR", "NOBOOK-EUR"]);
    const reasons = Object.fromEntries(sel.excluded.map((e) => [e.market, e.reason]));
    expect(reasons["USDC-EUR"]).toMatch(/stablecoin/);
    expect(reasons["TINY-EUR"]).toMatch(/te weinig handel/);
    expect(reasons["WIDE-EUR"]).toMatch(/spread te groot \(1\.00%\)/);
    expect(reasons["NOVOL-EUR"]).toMatch(/geen 24-uursvolume/);
    expect(reasons["ETH-BTC"]).toBeUndefined();
    expect(reasons["LUNA-EUR"]).toBeUndefined();
    expect(EXCLUDED_BASES.has("USDT")).toBe(true);
  });

  it("spreadlimiet 0 of ontbrekend = geen spreadfilter; aantal wordt begrensd op 1..400", () => {
    const markets = [info("WIDE-EUR"), info("BTC-EUR")];
    const tickers = [ticker("WIDE-EUR", 5e6, 100, 101), ticker("BTC-EUR", 9e6)];
    expect(selectUniverse(markets, tickers, CFG, 0).markets).toEqual(["BTC-EUR", "WIDE-EUR"]);
    expect(selectUniverse(markets, tickers, CFG).markets).toEqual(["BTC-EUR", "WIDE-EUR"]);
    expect(selectUniverse(markets, tickers, { ...CFG, count: 0 }).markets).toEqual(["BTC-EUR"]);
    expect(selectUniverse(markets, tickers, { ...CFG, count: Number.NaN }).markets).toEqual(["BTC-EUR"]);
  });

  it("dubbele markten tellen één keer; gelijk volume → op naam", () => {
    const markets = [info("B-EUR"), info("A-EUR"), info("A-EUR")];
    const tickers = [ticker("A-EUR", 1e6), ticker("B-EUR", 1e6)];
    const sel = selectUniverse(markets, tickers, { ...CFG, count: 10 });
    expect(sel.markets).toEqual(["A-EUR", "B-EUR"]);
    expect(sel.eligible).toBe(2);
  });
});

describe("tickerSpreadPct", () => {
  it("rekent de spread in % van het midden, onbekend bij ontbrekende of rare waarden", () => {
    expect(tickerSpreadPct({ bid: 99, ask: 101 })).toBeCloseTo(2, 10);
    expect(tickerSpreadPct({ bid: null, ask: 101 })).toBeNull();
    expect(tickerSpreadPct({ bid: 0, ask: 101 })).toBeNull();
    expect(tickerSpreadPct({ bid: 102, ask: 101 })).toBeNull();
  });
});

describe("spreadAboveLimit (ronde 5: zelfde grens als de backtest)", () => {
  it("precies op de limiet (ook met afrondingsruis) is niet erboven; 0 of minder = geen limiet", () => {
    const pct = tickerSpreadPct({ bid: 99.85, ask: 100.15 })!;
    expect(pct).toBeGreaterThan(0.3); // 0,30000000000001137: afrondingsruis
    expect(spreadAboveLimit(pct, 0.3)).toBe(false);
    expect(spreadAboveLimit(0.3 + 1e-6, 0.3)).toBe(true);
    expect(spreadAboveLimit(0.32, 0.3)).toBe(true);
    expect(spreadAboveLimit(5, 0)).toBe(false);
    expect(spreadAboveLimit(5, -1)).toBe(false);
    expect(spreadAboveLimit(Number.NaN, 0.3)).toBe(false);
    expect(SPREAD_EPS_PCT).toBe(1e-9);
  });

  it("selectUniverse houdt een markt met een spread precies op de limiet", () => {
    const markets = [info("AAA-EUR"), info("BBB-EUR")];
    const tickers = [ticker("AAA-EUR", 2e6, 99.85, 100.15), ticker("BBB-EUR", 1e6, 99.84, 100.16)];
    const sel = selectUniverse(markets, tickers, { ...CFG, count: 10 }, 0.3);
    expect(sel.markets).toEqual(["AAA-EUR"]);
    expect(sel.excluded).toEqual([{ market: "BBB-EUR", reason: "spread te groot (0.32%)" }]);
  });
});
