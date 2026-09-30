import { describe, expect, it } from "vitest";
import { INTERVAL_MS, type Candle, type TrendFilterConfig } from "../../src/core/types";
import {
  describeTrend,
  isTrendDataStale,
  trendCandlesNeeded,
  trendFilterActive,
  trendGate,
  trendKnownFrom,
  trendPeriodLabel,
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

describe("te oude trenddata (rejectStale, dezelfde regel als de engine)", () => {
  // 10 stijgende dagkoersen; de nieuwste opent 3 dagen vóór de nieuwste gesloten dag (gat zonder handel).
  const at = T0 + 20 * DAY + 6 * 3_600_000; // midden op dag 20: dag 19 is de nieuwste gesloten dag
  const gapped = daily([100, 110, 120, 130, 140, 150, 160, 170, 180, 190]).map((c) => ({ ...c, time: c.time + 7 * DAY }));
  // laatste candle: T0 + 16 dagen = 3 dagen vóór dag 19
  const cfg: TrendFilterConfig = { market: false, coin: true, interval: "1d", period: 5 };

  it("zonder optie: oude data telt nog (zoals vroeger); met optie: onbekend en verouderd", () => {
    expect(gapped[gapped.length - 1].time).toBe(T0 + 16 * DAY);
    expect(trendStateAt(gapped, "1d", 5, at).ok).toBe(true);
    const st = trendStateAt(gapped, "1d", 5, at, { rejectStale: true });
    expect(st).toMatchObject({ ok: null, stale: true, sma: null, candleTime: T0 + 16 * DAY, available: 5 });
    const gate = trendGate(cfg, { coin: gapped }, at, "AAA-EUR", { rejectStale: true });
    expect(gate.allowed).toBe(false);
    expect(gate.reason).toBe(
      "Muntfilter: AAA: koersdata verouderd (laatste koers van 17 januari 2025), gemiddelde van 5 dagen onbekend — geen aankoop",
    );
    expect(trendGate(cfg, { coin: gapped }, at, "AAA-EUR").allowed).toBe(true);
  });

  it("de candle die als laatste gesloten is moet erbij zijn; alleen binnen de marge na het sluiten mag die ontbreken", () => {
    const upTo = (lastDay: number) => daily([100, 110, 120, 130, 140, 150]).map((c) => ({ ...c, time: c.time + (lastDay - 5) * DAY }));
    // Nieuwste gesloten dag op `at` = dag 19 (gesloten 6 uur geleden).
    expect(trendStateAt(upTo(19), "1d", 5, at, { rejectStale: true }).ok).toBe(true);
    expect(trendStateAt(upTo(18), "1d", 5, at, { rejectStale: true })).toMatchObject({ ok: null, stale: true });
    expect(trendStateAt(upTo(18), "1d", 5, at, { rejectStale: true, staleGraceMs: 7 * 3_600_000 }).ok).toBe(true);
    expect(trendStateAt(upTo(17), "1d", 5, at, { rejectStale: true, staleGraceMs: 7 * 3_600_000 })).toMatchObject({ ok: null, stale: true });
    expect(isTrendDataStale(T0 + 19 * DAY, "1d", at)).toBe(false);
    expect(isTrendDataStale(T0 + 18 * DAY, "1d", at)).toBe(true);
    expect(isTrendDataStale(T0 + 18 * DAY, "1d", at, 5 * 60_000)).toBe(true); // 6 uur na het sluiten: te laat
    expect(isTrendDataStale(T0 + 18 * DAY, "1d", T0 + 20 * DAY + 60_000, 5 * 60_000)).toBe(false); // 1 minuut na het sluiten
    // Op 4 uur: dezelfde regel per blok van 4 uur.
    const h4 = INTERVAL_MS["4h"];
    expect(isTrendDataStale(T0 - h4, "4h", T0 + 1)).toBe(false);
    expect(isTrendDataStale(T0 - 2 * h4, "4h", T0 + 1)).toBe(true);
    expect(isTrendDataStale(T0 - 2 * h4, "4h", T0 + 1, 300_000)).toBe(false);
    expect(isTrendDataStale(T0 - 3 * h4, "4h", T0 + 1, 300_000)).toBe(true);
  });

  it("verse data: de optie verandert niets", () => {
    const c = daily([10, 10, 10, 40]);
    for (const atMs of [T0 + 3 * DAY, T0 + 4 * DAY, T0 + 4 * DAY + DAY / 2]) {
      expect(trendStateAt(c, "1d", 3, atMs, { rejectStale: true })).toEqual(trendStateAt(c, "1d", 3, atMs));
    }
  });
});

describe("woorden en hulpfuncties voor uitleg", () => {
  it("4 uur heet 'blokken van 4 uur' (zoals op het dashboard), niet 'candles'", () => {
    const h4: TrendFilterConfig = { market: true, coin: false, interval: "4h", period: 20 };
    expect(trendPeriodLabel(h4)).toBe("20 blokken van 4 uur");
    expect(trendPeriodLabel({ ...h4, interval: "1d", period: 50 })).toBe("50 dagen");
    const reason = trendGate(h4, {}, T0).reason!;
    expect(reason).toBe("Marktfilter: Bitcoin (BTC-EUR): te weinig koersdata voor het gemiddelde van 20 blokken van 4 uur (0/20) — geen nieuwe aankopen");
    expect(describeTrend("SOL", undefined, h4)).not.toMatch(/candles/);
  });

  it("trendKnownFrom: het sluiten van de period-ste candle, null bij te weinig", () => {
    expect(trendKnownFrom(daily([1, 2, 3, 4]), CFG)).toBe(T0 + 3 * DAY);
    expect(trendKnownFrom(daily([1, 2]), CFG)).toBeNull();
    expect(trendKnownFrom([], CFG)).toBeNull();
  });
});
