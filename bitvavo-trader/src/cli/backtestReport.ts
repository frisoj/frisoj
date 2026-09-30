/**
 * Pure helpers voor de CLI-backtest (`backtest.ts`) en het toernooi
 * (`tournament.ts`), los gehouden zodat ze zonder netwerk of terminal getest
 * kunnen worden (het laden van de trendfilter-data krijgt de feed mee).
 */
import { MARKET_FILTER_MARKET } from "../core/defaults";
import type { Candle, EnsembleConfig, MarketDataFeed, TrendFilterConfig } from "../core/types";
import type { BlockedEntries } from "../backtest/simulator";
import { loadTrendCandles, type TrendCandles } from "../backtest/trendData";
import { describeTrend, trendFilterActive, trendStateAt } from "../strategies/trendFilter";

export interface BacktestWindow {
  /** Eerste candle van de gevraagde periode (candles.length als die er niet is) */
  firstInPeriod: number;
  /** Eerste candle waarop gehandeld wordt: nooit vóór de opwarmtijd van de strategieën */
  tradeFromIndex: number;
  /** True als de periode later begint dan gevraagd (te weinig historie vóór de periode) */
  shortened: boolean;
}

/**
 * Waar de backtest mag beginnen: bij de eerste candle van de periode, maar
 * nooit binnen de opwarmtijd (`requiredWarmup` candles, zie
 * `backtestWarmupCandles`). Zelfde regel als de server (/api/backtest): bij een
 * markt met korte historie schuift het begin op in plaats van te "handelen"
 * terwijl de strategieën nog niets kunnen zeggen.
 */
export function backtestWindow(candles: Pick<Candle, "time">[], periodStart: number, requiredWarmup: number): BacktestWindow {
  let firstInPeriod = candles.findIndex((c) => c.time >= periodStart);
  if (firstInPeriod < 0) firstInPeriod = candles.length;
  const warmup = Number.isFinite(requiredWarmup) ? Math.max(0, Math.ceil(requiredWarmup)) : 0;
  const tradeFromIndex = Math.min(candles.length, Math.max(firstInPeriod, warmup));
  return { firstInPeriod, tradeFromIndex, shortened: tradeFromIndex > firstInPeriod };
}

export interface StuckCounts {
  /** Trades waarvan de verkoop eerst geweigerd werd (waarde onder het beursminimum) */
  stuckTrades: number;
  /** Daarvan: aan het einde van de test nog steeds onverkoopbaar */
  stuckAtEnd: number;
  /** Candles dat zo'n positie open stond zonder stop-loss */
  stuckCandles: number;
  /** Beursminimum per order in EUR */
  minOrderQuote: number;
}

function eurNl(x: number): string {
  return `€${x.toFixed(2).replace(".", ",")}`;
}

function count(n: number, one: string, many: string): string {
  return `${n} ${n === 1 ? one : many}`;
}

/**
 * Nederlandse waarschuwing over verkopen die de beurs zou weigeren (positie
 * minder waard dan het beursminimum), of null als dat niet gebeurde. Maakt
 * onderscheid tussen posities die later alsnog verkocht werden en posities die
 * aan het einde van de test nog onverkoopbaar waren (die zijn in het resultaat
 * tegen de laatste slotkoers gewaardeerd, wat in werkelijkheid niet kan).
 */
export function stuckTradesWarning(c: StuckCounts): string | null {
  const total = Math.max(0, Math.floor(c.stuckTrades || 0));
  if (total === 0) return null;
  const atEnd = Math.min(total, Math.max(0, Math.floor(c.stuckAtEnd || 0)));
  const soldLater = total - atEnd;
  const min = eurNl(c.minOrderQuote);
  const parts: string[] = [];
  if (soldLater > 0) {
    parts.push(
      `Let op: bij ${count(soldLater, "trade", "trades")} weigerde de beurs eerst de verkoop: de positie was minder waard ` +
        `dan het beursminimum van ${min}. De positie bleef open zonder stop-loss tot hij weer genoeg waard was en ` +
        `werd later alsnog verkocht.`,
    );
  }
  if (atEnd > 0) {
    const subject =
      soldLater > 0
        ? `Daarnaast ${atEnd === 1 ? "was 1 positie" : `waren ${atEnd} posities`}`
        : `Let op: ${atEnd === 1 ? "1 positie was" : `${atEnd} posities waren`}`;
    parts.push(
      `${subject} aan het einde ` +
        `van de test nog steeds onverkoopbaar (minder waard dan het beursminimum van ${min}). In het resultaat ` +
        `${atEnd === 1 ? "is die" : "zijn die"} tegen de laatste slotkoers gewaardeerd, maar in werkelijkheid kun je ` +
        `pas verkopen als de waarde weer boven ${min} komt (of je schrijft de positie af).`,
    );
  }
  const candles = Math.max(0, Math.floor(c.stuckCandles || 0));
  parts.push(
    `Samen ${count(candles, "candle", "candles")} zonder stop-loss in de markt. Een grotere inleg per trade of een ` +
      `kleinere stop-afstand voorkomt dit.`,
  );
  return parts.join(" ");
}

// ─────────────────────────────── Trendfilter ───────────────────────────────

/** Het ensemble met het trendfilter uit (beide vlaggen false); zonder filter ongewijzigd. */
export function withoutTrendFilter(ensemble: EnsembleConfig): EnsembleConfig {
  const tf = ensemble.trendFilter;
  if (!tf) return ensemble;
  return { ...ensemble, trendFilter: { ...tf, market: false, coin: false } };
}

function periodText(tf: TrendFilterConfig): string {
  return tf.interval === "1d" ? `${tf.period} dagen` : `${tf.period} candles van 4 uur`;
}

/** Korte Nederlandse omschrijving van het trendfilter, bijv. voor de kop van het rapport. */
export function trendFilterLabel(tf: TrendFilterConfig | undefined | null, disabledByFlag = false): string {
  if (!trendFilterActive(tf)) return disabledByFlag ? "Trendfilter: uit (--no-trend)" : "Trendfilter: uit";
  const who: string[] = [];
  if (tf.market) who.push(`Bitcoin (${MARKET_FILTER_MARKET})`);
  if (tf.coin) who.push("de munt zelf");
  return `Trendfilter: alleen kopen als ${who.join(" en ")} boven het gemiddelde van ${periodText(tf)} staat`;
}

export interface CliTrendSetup {
  /** Het ensemble voor de backtest (met `--no-trend`: filter uit) */
  ensemble: EnsembleConfig;
  /** Voor `BacktestInput.trendCandles` (alleen als het filter aan staat) */
  trendCandles?: TrendCandles;
  /** Nederlandse uitleg als (een deel van) de data niet geladen kon worden */
  note?: string;
  /** Regels voor het rapport: het filter en de stand aan het einde van de periode */
  lines: string[];
}

/**
 * Trendfilter voor een CLI-run: met `disabled` (vlag `--no-trend`) gaat het
 * filter uit; anders worden de candles geladen met `loadTrendCandles`
 * (Bitcoin en/of de munt, vanaf ruim vóór `fromMs` = de eerste handelscandle).
 */
export async function prepareTrendFilter(
  feed: Pick<MarketDataFeed, "getHistory">,
  market: string,
  ensemble: EnsembleConfig,
  fromMs: number,
  toMs: number,
  opts: { disabled?: boolean } = {},
): Promise<CliTrendSetup> {
  if (opts.disabled) {
    const off = withoutTrendFilter(ensemble);
    return { ensemble: off, lines: [trendFilterLabel(off.trendFilter, trendFilterActive(ensemble.trendFilter))] };
  }
  const tf = ensemble.trendFilter;
  if (!trendFilterActive(tf)) return { ensemble, lines: [trendFilterLabel(tf)] };
  const { trendCandles, note } = await loadTrendCandles(feed, market, tf, fromMs, toMs);
  const lines = [trendFilterLabel(tf)];
  const coinName = market.includes("-") ? market.slice(0, market.indexOf("-")) : market;
  if (tf.market && trendCandles?.market) {
    lines.push(`Nu: ${describeTrend(`Bitcoin (${MARKET_FILTER_MARKET})`, trendStateAt(trendCandles.market, tf.interval, tf.period, toMs), tf)}`);
  }
  if (tf.coin && trendCandles?.coin) {
    lines.push(`Nu: ${describeTrend(coinName, trendStateAt(trendCandles.coin, tf.interval, tf.period, toMs), tf)}`);
  }
  return { ensemble, ...(trendCandles ? { trendCandles } : {}), ...(note ? { note } : {}), lines };
}

/** Optellen van `blockedEntries` (bijv. over markten of deelnemers); null als geen enkele er een had. */
export function sumBlockedEntries(list: (BlockedEntries | undefined | null)[]): BlockedEntries | null {
  let out: BlockedEntries | null = null;
  for (const b of list) {
    if (!b) continue;
    out ??= { trend: 0, spread: 0 };
    out.trend += b.trend;
    out.spread += b.spread;
  }
  return out;
}

/**
 * Nederlandse regel over koopsignalen die door een filter niet tot een aankoop
 * leidden, of null als het resultaat geen `blockedEntries` heeft.
 */
export function blockedEntriesText(b: BlockedEntries | undefined | null, prefix = "Koopsignalen tegengehouden"): string | null {
  if (!b) return null;
  const n = (x: number) => Math.max(0, Math.floor(Number.isFinite(x) ? x : 0));
  const trend = n(b.trend);
  const spread = n(b.spread);
  if (trend === 0 && spread === 0) return `${prefix}: geen (trendfilter 0, spreadlimiet 0).`;
  return `${prefix}: ${trend} door het trendfilter, ${spread} door de spreadlimiet.`;
}
