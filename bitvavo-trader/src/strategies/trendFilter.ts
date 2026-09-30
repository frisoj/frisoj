/**
 * Trendfilter op een hogere tijdschaal ("4h" of "1d").
 *
 * Een nieuwe aankoop mag alleen als de slotkoers van de laatst GESLOTEN candle
 * boven het gemiddelde (SMA) van de laatste `period` gesloten candles ligt:
 * - marktfilter: voor Bitcoin (`MARKET_FILTER_MARKET`);
 * - muntfilter: voor de munt zelf.
 *
 * Geen blik in de toekomst: op moment `atMs` tellen alleen candles met
 * `time + INTERVAL_MS[interval] <= atMs`. Te weinig data = "onbekend" = niet
 * kopen (voor de zekerheid). Met `rejectStale` telt ook te oude data (de candle
 * die als laatste gesloten is ontbreekt, bijv. een periode zonder handel of data
 * die te vroeg stopt) als onbekend — dezelfde regel als de engine. Verkopen
 * worden nooit door dit filter tegengehouden.
 *
 * Dezelfde functies worden gebruikt door de engine (live/paper) en de backtest.
 */
import { INTERVAL_MS, type Candle, type TrendFilterConfig, type TrendFilterInterval } from "../core/types";
import { MARKET_FILTER_MARKET } from "../core/defaults";

export interface TrendState {
  /** true = slot boven het gemiddelde, false = op of eronder, null = te weinig data */
  ok: boolean | null;
  /** Slotkoers van de laatst gebruikte gesloten candle */
  close: number | null;
  sma: number | null;
  /** Openingstijd van de laatst gebruikte gesloten candle */
  candleTime: number | null;
  /** Aantal bruikbare gesloten candles (max. `period`) */
  available: number;
  /**
   * true = er is wel koersdata, maar de laatst gesloten candle is te oud (zie
   * `TrendStateOptions.rejectStale`); `ok` is dan null.
   */
  stale?: boolean;
}

export interface TrendStateOptions {
  /**
   * Te oude data telt als "onbekend" (ok: null, stale: true): de candle die op
   * `atMs` als laatste gesloten is, moet erbij zitten (zie `isTrendDataStale`).
   * Ontbreekt die (een periode zonder handel, of data die te vroeg stopt), dan
   * niet kopen — dezelfde regel als de engine (live/paper). De backtest zet dit aan.
   */
  rejectStale?: boolean;
  /**
   * Met `rejectStale`: zo lang (ms) na het sluiten mag die nieuwste candle nog
   * ontbreken als de candle ervoor er wel is (de beurs is nog niet bij). Standaard 0
   * (backtest: historische data heeft geen vertraging).
   */
  staleGraceMs?: number;
}

export interface TrendGateResult {
  allowed: boolean;
  /** Nederlandse reden als `allowed` false is */
  reason?: string;
  market?: TrendState;
  coin?: TrendState;
}

/** Het filter doet iets (minstens één vlag aan)? */
export function trendFilterActive(cfg: TrendFilterConfig | undefined | null): cfg is TrendFilterConfig {
  return !!cfg && (cfg.market === true || cfg.coin === true);
}

function validPeriod(period: number): number {
  return Number.isFinite(period) && period >= 1 ? Math.floor(period) : 1;
}

/** Hoeveel candles je minimaal moet ophalen om het filter te kunnen berekenen (met marge). */
export function trendCandlesNeeded(cfg: TrendFilterConfig): number {
  return validPeriod(cfg.period) + 5;
}

/** Hoe ver vóór het begin van een backtest je candles moet ophalen (ms, met marge). */
export function trendWarmupMs(cfg: TrendFilterConfig): number {
  return (validPeriod(cfg.period) + 3) * INTERVAL_MS[cfg.interval];
}

/**
 * Is een laatst gesloten candle met openingstijd `lastCandleTime` op `atMs` te oud?
 * Verwacht wordt de candle die als laatste vóór `atMs` sloot (openingstijd
 * `floor(atMs / ms) × ms − ms`). Alleen binnen `graceMs` na dat sluiten mag het
 * de candle daarvóór zijn (de beurs is nog niet bij); ouder = verouderd.
 * Zelfde regel als de engine (`usableTrendCandles`).
 */
export function isTrendDataStale(
  lastCandleTime: number,
  interval: TrendFilterInterval,
  atMs: number,
  graceMs = 0,
): boolean {
  const ms = INTERVAL_MS[interval];
  const expected = Math.floor(atMs / ms) * ms - ms;
  if (lastCandleTime >= expected) return false;
  const justClosed = atMs - (expected + ms) < graceMs;
  return !(justClosed && lastCandleTime >= expected - ms);
}

/**
 * Vanaf welk moment is het gemiddelde uit deze candles (oplopend) te berekenen?
 * = het sluiten van de `period`-ste candle; null als er minder dan `period` zijn.
 */
export function trendKnownFrom(candles: readonly Candle[], cfg: TrendFilterConfig): number | null {
  const n = validPeriod(cfg.period);
  if (candles.length < n) return null;
  return candles[n - 1].time + INTERVAL_MS[cfg.interval];
}

/** Index van de laatste candle die op `atMs` gesloten is, of -1. `candles` oplopend. */
function lastClosedIndex(candles: readonly Candle[], ms: number, atMs: number): number {
  let lo = 0;
  let hi = candles.length - 1;
  let found = -1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (candles[mid].time + ms <= atMs) {
      found = mid;
      lo = mid + 1;
    } else {
      hi = mid - 1;
    }
  }
  return found;
}

/**
 * Trendstatus op moment `atMs` uit candles op `interval` (oplopend gesorteerd).
 * Ongeldige candles (niet-eindige of niet-positieve slotkoers) maken de status onbekend.
 */
export function trendStateAt(
  candles: readonly Candle[],
  interval: TrendFilterInterval,
  period: number,
  atMs: number,
  opts: TrendStateOptions = {},
): TrendState {
  const n = validPeriod(period);
  const ms = INTERVAL_MS[interval];
  const last = lastClosedIndex(candles, ms, atMs);
  const available = Math.max(0, Math.min(n, last + 1));
  if (last < 0) return { ok: null, close: null, sma: null, candleTime: null, available: 0 };
  const lastCandle = candles[last];
  const close = lastCandle.close;
  if (opts.rejectStale && isTrendDataStale(lastCandle.time, interval, atMs, opts.staleGraceMs ?? 0)) {
    return { ok: null, close: null, sma: null, candleTime: lastCandle.time, available, stale: true };
  }
  if (last + 1 < n) {
    return { ok: null, close: Number.isFinite(close) ? close : null, sma: null, candleTime: lastCandle.time, available };
  }
  let sum = 0;
  for (let i = last - n + 1; i <= last; i++) {
    const c = candles[i].close;
    if (!Number.isFinite(c) || c <= 0) {
      return { ok: null, close: null, sma: null, candleTime: lastCandle.time, available };
    }
    sum += c;
  }
  const sma = sum / n;
  return { ok: close > sma, close, sma, candleTime: lastCandle.time, available };
}

/** "50 dagen" / "20 blokken van 4 uur" (de woorden van het dashboard). */
export function trendSpanLabel(interval: TrendFilterInterval, count: number): string {
  return interval === "1d" ? `${count} dagen` : `${count} blokken van 4 uur`;
}

/** De periode van het filter in gewone woorden, bijv. "50 dagen" of "20 blokken van 4 uur". */
export function trendPeriodLabel(cfg: TrendFilterConfig): string {
  return trendSpanLabel(cfg.interval, validPeriod(cfg.period));
}

const DATE_NL = new Intl.DateTimeFormat("nl-NL", {
  timeZone: "Europe/Amsterdam",
  day: "numeric",
  month: "long",
  year: "numeric",
});
const DATE_TIME_NL = new Intl.DateTimeFormat("nl-NL", {
  timeZone: "Europe/Amsterdam",
  day: "numeric",
  month: "long",
  year: "numeric",
  hour: "2-digit",
  minute: "2-digit",
});

/** Moment in gewone woorden: dag ("4 september 2026"), bij 4-uursdata met tijd (Nederlandse tijd). */
export function trendMomentNl(ms: number, interval: TrendFilterInterval): string {
  if (!Number.isFinite(ms)) return "?";
  return (interval === "1d" ? DATE_NL : DATE_TIME_NL).format(new Date(ms));
}

function fmtNum(v: number | null): string {
  if (v === null || !Number.isFinite(v)) return "?";
  const digits = v >= 100 ? 0 : v >= 1 ? 2 : 6;
  return `€${v.toLocaleString("nl-NL", { minimumFractionDigits: digits, maximumFractionDigits: digits })}`;
}

function baseOf(market: string): string {
  const i = market.indexOf("-");
  return i > 0 ? market.slice(0, i) : market;
}

/** Nederlandse zin over de status van één trend (voor dashboard en logs). */
export function describeTrend(
  who: string,
  state: TrendState | undefined,
  cfg: TrendFilterConfig,
): string {
  const avg = `gemiddelde van ${trendPeriodLabel(cfg)}`;
  if (state?.stale && state.candleTime !== null) {
    return `${who}: koersdata verouderd (laatste koers van ${trendMomentNl(state.candleTime, cfg.interval)}), ${avg} onbekend`;
  }
  if (!state || state.ok === null) {
    const have = state ? state.available : 0;
    return `${who}: te weinig koersdata voor het ${avg} (${have}/${validPeriod(cfg.period)})`;
  }
  return state.ok
    ? `${who} staat boven het ${avg} (${fmtNum(state.close)} > ${fmtNum(state.sma)})`
    : `${who} staat onder het ${avg} (${fmtNum(state.close)} ≤ ${fmtNum(state.sma)})`;
}

/**
 * Mag er op moment `atMs` een nieuwe aankoop in `coinMarket`?
 * - Filter uit (of `cfg` ontbreekt) → altijd toegestaan.
 * - Een ingeschakeld deel zonder data (`data.market` / `data.coin` ontbreekt of
 *   te kort; met `opts.rejectStale` ook: te oud) → NIET toegestaan ("onbekend" =
 *   voor de zekerheid niet kopen).
 * De reden noemt het eerste deel dat blokkeert (marktfilter vóór muntfilter).
 */
export function trendGate(
  cfg: TrendFilterConfig | undefined | null,
  data: { market?: readonly Candle[]; coin?: readonly Candle[] },
  atMs: number,
  coinMarket?: string,
  opts: TrendStateOptions = {},
): TrendGateResult {
  if (!trendFilterActive(cfg)) return { allowed: true };
  const out: TrendGateResult = { allowed: true };
  if (cfg.market) {
    const st = trendStateAt(data.market ?? [], cfg.interval, cfg.period, atMs, opts);
    out.market = st;
    if (st.ok !== true) {
      out.allowed = false;
      out.reason = `Marktfilter: ${describeTrend(`Bitcoin (${MARKET_FILTER_MARKET})`, st, cfg)} — geen nieuwe aankopen`;
      return out;
    }
  }
  if (cfg.coin) {
    const who = coinMarket ? baseOf(coinMarket) : "de munt";
    const st = trendStateAt(data.coin ?? [], cfg.interval, cfg.period, atMs, opts);
    out.coin = st;
    if (st.ok !== true) {
      out.allowed = false;
      out.reason = `Muntfilter: ${describeTrend(who, st, cfg)} — geen aankoop`;
      return out;
    }
  }
  return out;
}
