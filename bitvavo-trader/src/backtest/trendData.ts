/**
 * Koersdata voor het trendfilter in backtests (API-routes en CLI's).
 * Laadt Bitcoin (marktfilter) en/of de munt zelf (muntfilter) op de tijdschaal
 * van het filter, vanaf `trendWarmupMs` vóór het begin, zodat het gemiddelde
 * vanaf de eerste handelscandle berekend kan worden.
 */
import { INTERVAL_MS, type Candle, type MarketDataFeed, type TrendFilterConfig } from "../core/types";
import { MARKET_FILTER_MARKET } from "../core/defaults";
import {
  isTrendDataStale,
  trendFilterActive,
  trendKnownFrom,
  trendMomentNl,
  trendPeriodLabel,
  trendSpanLabel,
  trendWarmupMs,
} from "../strategies/trendFilter";

export interface TrendCandles {
  market?: Candle[];
  coin?: Candle[];
}

function message(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

/** Oplopend op tijd (de gate zoekt binair); al gesorteerd → hetzelfde array. */
function ascending(candles: Candle[]): Candle[] {
  for (let i = 1; i < candles.length; i++) {
    if (candles[i].time < candles[i - 1].time) return candles.slice().sort((a, b) => a.time - b.time);
  }
  return candles;
}

/**
 * Nederlandse uitleg bij geladen trenddata waardoor de test (een deel van de
 * tijd) niet koopt: niets gevonden, het gemiddelde pas later of nooit bekend,
 * data die te vroeg stopt, of gaten (perioden zonder handel). De gate blokkeert
 * dan voor de zekerheid; zonder uitleg lijkt dat op een dalende markt.
 * `what` is bijv. "Koersdata voor het muntfilter (SOL-EUR)".
 */
export function trendDataNotes(
  what: string,
  candles: readonly Candle[],
  tf: TrendFilterConfig,
  fromMs: number,
  toMs: number,
): string[] {
  if (candles.length === 0) return [`${what}: niets gevonden — voor de zekerheid geen aankopen`];
  const ms = INTERVAL_MS[tf.interval];
  const at = (t: number) => trendMomentNl(t, tf.interval);
  const avg = `het gemiddelde van ${trendPeriodLabel(tf)}`;
  const notes: string[] = [];
  const knownFrom = trendKnownFrom(candles, tf);
  if (knownFrom === null || knownFrom > toMs) {
    const closed = candles.filter((c) => c.time + ms <= toMs).length;
    notes.push(
      `${what}: maar ${trendSpanLabel(tf.interval, closed)} (vanaf ${at(candles[0].time)}), te weinig voor ${avg} ` +
        "— de test koopt niet (voor de zekerheid)",
    );
    return notes;
  }
  if (knownFrom > fromMs) {
    notes.push(
      `${what}: ${avg} is pas bekend vanaf ${at(knownFrom)} (koersdata vanaf ${at(candles[0].time)}) ` +
        "— tot dan koopt de test niet (voor de zekerheid)",
    );
  }
  // Gaten: ontbreekt er een candle, dan ziet de gate verouderde data (zelfde regel als de engine),
  // van het moment dat die candle had moeten sluiten (prev + 2 candles) tot de volgende gesloten is.
  // Alleen gaten die in de testperiode vallen tellen.
  let gaps = 0;
  let firstGap: number | null = null;
  for (let i = 1; i < candles.length; i++) {
    const prev = candles[i - 1].time;
    const next = candles[i].time;
    if (next - prev <= ms) continue;
    if (prev + 2 * ms > toMs || next + ms <= fromMs) continue;
    gaps++;
    firstGap ??= prev + ms;
  }
  if (gaps > 0 && firstGap !== null) {
    notes.push(
      `${what} heeft ${gaps === 1 ? "een gat" : `${gaps} gaten`} (geen handel, ${gaps === 1 ? "vanaf" : "het eerste vanaf"} ` +
        `${at(firstGap)}) — tijdens een gat koopt de test niet (voor de zekerheid)`,
    );
  }
  const last = candles[candles.length - 1];
  if (isTrendDataStale(last.time, tf.interval, toMs)) {
    notes.push(`${what} loopt maar tot ${at(last.time + ms)} — daarna koopt de test niet (voor de zekerheid)`);
  }
  return notes;
}

/**
 * Haalt de candles op die `trendGate` nodig heeft. Een deel dat niet geladen kan
 * worden, ontbreekt in `trendCandles` (het filter blokkeert dan, voor de
 * zekerheid) en de `note` zegt waarom; net zo als er (te) weinig, te late of
 * te oude data is. Filter uit → `{}`.
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
    let raw: Candle[];
    try {
      raw = await feed.getHistory(m, tf.interval, start, toMs);
    } catch (err) {
      notes.push(`${label} (${m}) niet geladen: ${message(err)} — voor de zekerheid geen aankopen`);
      return undefined;
    }
    const candles = ascending(Array.isArray(raw) ? raw : []);
    notes.push(...trendDataNotes(`${label} (${m})`, candles, tf, fromMs, toMs));
    return candles;
  };
  if (tf.market) {
    const c = await load(MARKET_FILTER_MARKET, "Koersdata voor het marktfilter");
    if (c) out.market = c;
  }
  if (tf.coin) {
    // De munt IS Bitcoin en het marktfilter staat aan: dezelfde data, ook als dat laden
    // mislukte (niet nog eens vragen, en niet twee keer dezelfde uitleg).
    const c =
      market === MARKET_FILTER_MARKET && tf.market ? out.market : await load(market, "Koersdata voor het muntfilter");
    if (c) out.coin = c;
  }
  return { trendCandles: out, ...(notes.length > 0 ? { note: `Trendfilter: ${notes.join("; ")}.` } : {}) };
}
