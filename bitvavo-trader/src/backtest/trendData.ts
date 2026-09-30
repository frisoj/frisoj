/**
 * Koersdata voor het trendfilter in backtests (API-routes en CLI's).
 * Laadt Bitcoin (marktfilter) en/of de munt zelf (muntfilter) op de tijdschaal
 * van het filter, vanaf `trendWarmupMs` vóór het begin, zodat het gemiddelde
 * vanaf de eerste handelscandle berekend kan worden.
 */
import type { Candle, MarketDataFeed, TrendFilterConfig } from "../core/types";
import { MARKET_FILTER_MARKET } from "../core/defaults";
import { trendFilterActive, trendWarmupMs } from "../strategies/trendFilter";

export interface TrendCandles {
  market?: Candle[];
  coin?: Candle[];
}

function message(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

/**
 * Haalt de candles op die `trendGate` nodig heeft. Een deel dat niet geladen kan
 * worden, ontbreekt in `trendCandles` (het filter blokkeert dan, voor de
 * zekerheid) en de `note` zegt waarom. Filter uit → `{}`.
 */
export async function loadTrendCandles(
  feed: Pick<MarketDataFeed, "getHistory">,
  market: string,
  tf: TrendFilterConfig | undefined | null,
  fromMs: number,
  toMs: number,
): Promise<{ trendCandles?: TrendCandles; note?: string }> {
  if (!trendFilterActive(tf)) return {};
  const start = fromMs - trendWarmupMs(tf);
  const out: TrendCandles = {};
  const notes: string[] = [];
  const load = async (m: string, label: string): Promise<Candle[] | undefined> => {
    try {
      return await feed.getHistory(m, tf.interval, start, toMs);
    } catch (err) {
      notes.push(`${label} (${m}) niet geladen: ${message(err)} — voor de zekerheid geen aankopen`);
      return undefined;
    }
  };
  if (tf.market) {
    const c = await load(MARKET_FILTER_MARKET, "Koersdata voor het marktfilter");
    if (c) out.market = c;
  }
  if (tf.coin) {
    const c = market === MARKET_FILTER_MARKET && out.market ? out.market : await load(market, "Koersdata voor het muntfilter");
    if (c) out.coin = c;
  }
  return { trendCandles: out, ...(notes.length > 0 ? { note: `Trendfilter: ${notes.join("; ")}.` } : {}) };
}
