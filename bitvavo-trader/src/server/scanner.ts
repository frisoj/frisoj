/**
 * Marktscanner: de N EUR-markten met het hoogste 24h-volume, met per markt
 * volatiliteit (ATR%), regime, laatste ensemble-signaal, RSI en een sparkline.
 * Resultaten worden 60 seconden gecachet.
 */
import type {
  Candle,
  ChartIndicators,
  EnsembleConfig,
  EnsembleDecision,
  Interval,
  MarketDataFeed,
  Regime,
  ScannerRow,
  Ticker24h,
} from "../core/types";
import { closedCandles, hashString } from "../core/util";

export interface ScannerServices {
  chartIndicators(candles: Candle[]): ChartIndicators;
  runEnsemble(market: string, candles: Candle[], cfg: EnsembleConfig): EnsembleDecision[];
  detectRegimes(candles: Candle[]): Regime[];
}

export interface ScannerOptions {
  feed: MarketDataFeed;
  services: ScannerServices;
  now?: () => number;
  cacheMs?: number;
  candles?: number;
  concurrency?: number;
  log?: (msg: string) => void;
}

export const SCANNER_MAX_LIMIT = 60;

/** Voert `fn` uit over `items` met maximaal `limit` tegelijk; volgorde blijft behouden. */
export async function mapLimit<T, R>(items: T[], limit: number, fn: (item: T, i: number) => Promise<R>): Promise<R[]> {
  const out = new Array<R>(items.length);
  let next = 0;
  const workers = Array.from({ length: Math.max(1, Math.min(limit, items.length)) }, async () => {
    while (next < items.length) {
      const i = next++;
      out[i] = await fn(items[i], i);
    }
  });
  await Promise.all(workers);
  return out;
}

function lastFinite(values: (number | null | undefined)[]): number | null {
  for (let i = values.length - 1; i >= 0; i--) {
    const v = values[i];
    if (typeof v === "number" && Number.isFinite(v)) return v;
  }
  return null;
}

function round(v: number, digits: number): number {
  const f = 10 ** digits;
  return Math.round(v * f) / f;
}

/** Rij plus zijn plek in de volumeranglijst (vóór het overslaan van mislukte markten). */
interface RankedRow {
  rank: number;
  row: ScannerRow;
}

interface ScanResult {
  /** Voor hoeveel markten (top-N) deze scan is berekend */
  limit: number;
  rows: RankedRow[];
}

function topN(result: ScanResult, n: number): ScannerRow[] {
  return result.rows.filter((r) => r.rank < n).map((r) => r.row);
}

export class Scanner {
  // Sleutel zonder `limit`: een grotere scan bedient ook kleinere verzoeken, zodat
  // limit=1..60 niet 60 aparte scans (en Bitvavo-verzoeken) oplevert.
  private readonly cache = new Map<string, { at: number; result: ScanResult }>();
  private readonly inflight = new Map<string, { limit: number; promise: Promise<ScanResult> }>();
  private readonly now: () => number;
  private readonly cacheMs: number;
  private readonly candleCount: number;
  private readonly concurrency: number;
  private readonly log: (msg: string) => void;

  constructor(private readonly opts: ScannerOptions) {
    this.now = opts.now ?? Date.now;
    this.cacheMs = opts.cacheMs ?? 60_000;
    this.candleCount = opts.candles ?? 150;
    this.concurrency = opts.concurrency ?? 4;
    this.log = opts.log ?? ((m) => console.warn(m));
  }

  clearCache(): void {
    this.cache.clear();
  }

  async scan(limit: number, interval: Interval, ensemble: EnsembleConfig): Promise<ScannerRow[]> {
    const n = Math.max(1, Math.min(SCANNER_MAX_LIMIT, Math.floor(limit)));
    const key = `${interval}|${hashString(JSON.stringify(ensemble))}`;
    const hit = this.cache.get(key);
    if (hit && hit.result.limit >= n && this.now() - hit.at < this.cacheMs) return topN(hit.result, n);
    const running = this.inflight.get(key);
    if (running && running.limit >= n) return topN(await running.promise, n);
    const entry = {
      limit: n,
      promise: this.compute(n, interval, ensemble).then((result) => {
        const prev = this.cache.get(key);
        // Een verse, grotere scan niet overschrijven met een kleinere
        if (!prev || prev.result.limit <= result.limit || this.now() - prev.at >= this.cacheMs) {
          this.cache.set(key, { at: this.now(), result });
        }
        return result;
      }),
    };
    this.inflight.set(key, entry);
    entry.promise
      .finally(() => {
        if (this.inflight.get(key) === entry) this.inflight.delete(key);
      })
      .catch(() => undefined);
    return topN(await entry.promise, n);
  }

  private async compute(limit: number, interval: Interval, ensemble: EnsembleConfig): Promise<ScanResult> {
    const { feed } = this.opts;
    const markets = await feed.getMarkets();
    const tradable = new Set(markets.filter((m) => m.quote === "EUR" && m.status === "trading").map((m) => m.market));
    const tickers = await feed.getTickers24h();
    const top = tickers
      .filter((t) => tradable.has(t.market) && Number.isFinite(t.volumeQuote))
      .sort((a, b) => b.volumeQuote - a.volumeQuote)
      .slice(0, limit);

    let failures = 0;
    const rows = await mapLimit(top, this.concurrency, async (t, rank): Promise<RankedRow | null> => {
      try {
        return { rank, row: await this.row(t, interval, ensemble) };
      } catch (err) {
        failures++;
        this.log(`Scanner: ${t.market} overgeslagen (${(err as Error).message})`);
        return null;
      }
    });
    const ok = rows.filter((r): r is RankedRow => r !== null);
    if (ok.length === 0 && failures > 0) {
      throw new Error("De scanner kon geen enkele markt ophalen. Probeer het later opnieuw.");
    }
    return { limit, rows: ok };
  }

  private async row(t: Ticker24h, interval: Interval, ensemble: EnsembleConfig): Promise<ScannerRow> {
    const { feed, services } = this.opts;
    const raw = await feed.getCandles(t.market, interval, this.candleCount);
    const candles = closedCandles(raw, interval, this.now());
    if (candles.length === 0) throw new Error("geen candles");
    const lastClose = candles[candles.length - 1].close;
    const ind = services.chartIndicators(candles);
    const atr = lastFinite(ind.atr);
    const rsi = lastFinite(ind.rsi);
    const regimes = services.detectRegimes(candles);
    const decisions = services.runEnsemble(t.market, candles, ensemble);
    const decision = decisions.length > 0 ? decisions[decisions.length - 1] : null;
    const price = Number.isFinite(t.last) && t.last > 0 ? t.last : lastClose;
    let spreadPct: number | null = null;
    if (t.bid !== null && t.ask !== null && t.bid > 0 && t.ask > 0) {
      const mid = (t.bid + t.ask) / 2;
      spreadPct = round(((t.ask - t.bid) / mid) * 100, 4);
    }
    return {
      market: t.market,
      price,
      changePct24h: Number.isFinite(t.changePct) ? round(t.changePct, 2) : 0,
      volumeQuote24h: t.volumeQuote,
      volatilityPct: atr !== null && lastClose > 0 ? round((atr / lastClose) * 100, 3) : 0,
      spreadPct,
      regime: regimes.length > 0 ? regimes[regimes.length - 1] : "unknown",
      action: decision?.action ?? "hold",
      score: decision && Number.isFinite(decision.score) ? round(decision.score, 3) : 0,
      rsi: rsi !== null ? round(rsi, 1) : null,
      sparkline: candles.slice(-48).map((c) => c.close),
    };
  }
}
