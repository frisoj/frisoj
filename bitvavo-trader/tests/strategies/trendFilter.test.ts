import { describe, expect, it } from "vitest";
import { INTERVAL_MS, type Candle, type TrendFilterConfig } from "../../src/core/types";
import {
  trendCandlesNeeded,
  trendFilterActive,
  trendGate,
  trendStateAt,
  trendWarmupMs,
} from "../../src/strategies/trendFilter";

const DAY = INTERVAL_MS["1d"];
const T0 = Date.UTC(2025, 0, 1);

function daily(closes: number[]): Candle[] {
  return closes.map((c, i) => ({ time: T0 + i * DAY, open: c, high: c, low: c, close: c, volume: 1 }));
}

const CFG: TrendFilterConfig = { market: true, coin: false, interval: "1d", period: 3 };

describe("trendStateAt", () => {
  it("gebruikt alleen candles die op het moment gesloten zijn (geen lookahead)", () => {
    const c = daily([10, 10, 10, 40]);
    // Op het einde van dag 2 (index 2 gesloten): SMA(10,10,10)=10, slot 10 → niet erboven
    const atDay3Open = T0 + 3 * DAY;
    expect(trendStateAt(c, "1d", 3, atDay3Open)).toMatchObject({ ok: false, close: 10, sma: 10, candleTime: T0 + 2 * DAY });
    // Midden in dag 3 is candle 3 (slot 40) nog niet gesloten
    expect(trendStateAt(c, "1d", 3, atDay3Open + DAY / 2).ok).toBe(false);
    // Na het sluiten van dag 3: SMA(10,10,40)=20, slot 40 → erboven
    expect(trendStateAt(c, "1d", 3, T0 + 4 * DAY)).toMatchObject({ ok: true, close: 40, sma: 20 });
  });

  it("te weinig candles of ongeldige koers → onbekend", () => {
    expect(trendStateAt(daily([10, 11]), "1d", 3, T0 + 5 * DAY)).toMatchObject({ ok: null, available: 2 });
    expect(trendStateAt([], "1d", 3, T0 + 5 * DAY)).toMatchObject({ ok: null, available: 0 });
    expect(trendStateAt(daily([10, 11, 12]), "1d", 3, T0)).toMatchObject({ ok: null, available: 0 });
    expect(trendStateAt(daily([10, Number.NaN, 12]), "1d", 3, T0 + 5 * DAY).ok).toBeNull();
    expect(trendStateAt(daily([10, 0, 12]), "1d", 3, T0 + 5 * DAY).ok).toBeNull();
  });

  it("slot precies op het gemiddelde telt niet als erboven", () => {
    expect(trendStateAt(daily([9, 10, 11, 10]), "1d", 3, T0 + 4 * DAY).ok).toBe(false);
  });

  it("werkt ook op 4-uurscandles", () => {
    const h4 = INTERVAL_MS["4h"];
    const c: Candle[] = [1, 2, 3, 4].map((v, i) => ({ time: T0 + i * h4, open: v, high: v, low: v, close: v, volume: 1 }));
    expect(trendStateAt(c, "4h", 3, T0 + 4 * h4)).toMatchObject({ ok: true, close: 4, sma: 3 });
    expect(trendStateAt(c, "4h", 3, T0 + 4 * h4 - 1)).toMatchObject({ ok: true, close: 3, sma: 2 });
  });
});

describe("trendGate", () => {
  const up = daily([10, 11, 12, 13, 14]);
  const down = daily([14, 13, 12, 11, 10]);
  const at = T0 + 5 * DAY;

  it("uit of zonder config: altijd toegestaan", () => {
    expect(trendGate(undefined, {}, at).allowed).toBe(true);
    expect(trendGate({ ...CFG, market: false, coin: false }, {}, at).allowed).toBe(true);
    expect(trendFilterActive(undefined)).toBe(false);
    expect(trendFilterActive(CFG)).toBe(true);
  });

  it("marktfilter blokkeert als Bitcoin onder het gemiddelde staat of data ontbreekt", () => {
    expect(trendGate(CFG, { market: up }, at).allowed).toBe(true);
    const blocked = trendGate(CFG, { market: down }, at);
    expect(blocked.allowed).toBe(false);
    expect(blocked.reason).toMatch(/^Marktfilter: Bitcoin \(BTC-EUR\) staat onder het gemiddelde van 3 dagen/);
    const missing = trendGate(CFG, {}, at);
    expect(missing.allowed).toBe(false);
    expect(missing.reason).toMatch(/te weinig koersdata/);
  });

  it("muntfilter kijkt naar de munt zelf; marktfilter gaat voor", () => {
    const both: TrendFilterConfig = { ...CFG, coin: true };
    expect(trendGate(both, { market: up, coin: up }, at, "SOL-EUR").allowed).toBe(true);
    const coinDown = trendGate(both, { market: up, coin: down }, at, "SOL-EUR");
    expect(coinDown.allowed).toBe(false);
    expect(coinDown.reason).toMatch(/^Muntfilter: SOL staat onder/);
    expect(trendGate(both, { market: down, coin: down }, at, "SOL-EUR").reason).toMatch(/^Marktfilter/);
    const onlyCoin: TrendFilterConfig = { ...CFG, market: false, coin: true };
    expect(trendGate(onlyCoin, { market: down, coin: up }, at, "SOL-EUR").allowed).toBe(true);
  });

  it("hulpfuncties voor het ophalen van genoeg candles", () => {
    expect(trendCandlesNeeded({ ...CFG, period: 50 })).toBe(55);
    expect(trendWarmupMs({ ...CFG, period: 50 })).toBe(53 * DAY);
  });
});
