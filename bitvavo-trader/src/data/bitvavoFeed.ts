/**
 * BitvavoFeed: marktdata via de Bitvavo REST API (via BitvavoClient).
 *
 * - `getMarkets` wordt 1 uur gecachet.
 * - `getHistory` pagineert achterwaarts (`end = oudste - 1`, limit 1440), ontdubbelt,
 *   sorteert oplopend en geeft ALLEEN gesloten candles terug. Bij een bijna
 *   uitgeputte (publieke) rate limit wordt kort gepauzeerd.
 * - Optionele schijfcache (`cacheDir/<markt>_<interval>.json`) met gesloten
 *   candles: alleen het ontbrekende nieuwere (en eventueel oudere) deel wordt
 *   opgehaald.
 * - `getTickers24h` wordt ~30 s gecachet. Een verse lijst van ALLE markten
 *   (gewicht 25 bij Bitvavo) wordt ook voor gefilterde verzoeken gebruikt; één
 *   losse markt (gewicht 1) wordt apart opgehaald en gecachet.
 * - `getPrices` haalt de prijs van ALLE markten op in één `GET /ticker/price`
 *   zonder markt (gewicht 1). Gelijktijdige aanroepen delen één verzoek en het
 *   resultaat wordt ~2 s hergebruikt. Fouten worden niet gecachet en gaan door
 *   naar de aanroeper.
 */
import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { BitvavoClient } from "../exchange/bitvavoClient";
import {
  INTERVAL_MS,
  type Candle,
  type DataSource,
  type Interval,
  type MarketDataFeed,
  type MarketInfo,
  type OrderBook,
  type Ticker24h,
} from "../core/types";
import { isClosedCandle, sleep } from "../core/util";

const MARKETS_TTL_MS = 3_600_000;
/** 24h-tickers veranderen langzaam: 30 s hergebruiken spaart rate-limit gewicht (alle markten = 25). */
const TICKERS_TTL_MS = 30_000;
/** Prijzen van alle markten: kort hergebruiken, zodat gelijktijdige vragers (engine, server) één verzoek delen. */
const PRICES_TTL_MS = 2_000;
const PAGE_LIMIT = 1440;
const LOW_RATE_LIMIT = 100;
const VERY_LOW_RATE_LIMIT = 20;
/** Harde grens tegen eindeloze paginering */
const MAX_PAGES = 2000;
/** Is het gat tussen cache en verzoek groter dan dit aantal candles, dan niet overbruggen. */
const MAX_GAP_CANDLES = 5 * PAGE_LIMIT;
const CACHE_VERSION = 1;

export interface BitvavoFeedOptions {
  /** Map voor de schijfcache met gesloten candles (optioneel). */
  cacheDir?: string;
  now?: () => number;
  /** Pauze (ms) als het publieke rate-limitbudget van de client < 100 is (standaard 1000). */
  rateLimitPauseMs?: number;
}

type CandleRow = [number, number, number, number, number, number];

interface CacheFile {
  version: number;
  market: string;
  interval: Interval;
  /** Gedekt bereik (opentijden) waarvoor alle gesloten candles in `candles` staan */
  from: number;
  to: number;
  candles: CandleRow[];
}

interface CacheData {
  from: number;
  to: number;
  candles: Candle[];
}

function isValidCandle(c: unknown): c is Candle {
  if (!c || typeof c !== "object") return false;
  const k = c as Candle;
  return (
    Number.isFinite(k.time) &&
    Number.isFinite(k.open) &&
    Number.isFinite(k.high) &&
    Number.isFinite(k.low) &&
    Number.isFinite(k.close) &&
    Number.isFinite(k.volume)
  );
}

/** Ontdubbel op tijd (laatste wint) en sorteer oplopend. */
function dedupeSort(candles: Iterable<Candle>): Candle[] {
  const byTime = new Map<number, Candle>();
  for (const c of candles) if (isValidCandle(c)) byTime.set(c.time, c);
  return [...byTime.values()].sort((a, b) => a.time - b.time);
}

/** Kopieën, zodat een aanroeper die de lijst of een ticker aanpast de cache niet verandert. */
function copyTickers(list: readonly Ticker24h[]): Ticker24h[] {
  return list.map((t) => ({ ...t }));
}

function intervalMs(interval: Interval): number {
  const ms = INTERVAL_MS[interval];
  if (!ms) throw new Error(`Ongeldig interval: ${String(interval)}`);
  return ms;
}

export class BitvavoFeed implements MarketDataFeed {
  readonly source: DataSource = "bitvavo";
  private readonly nowFn: () => number;
  private readonly cacheDir?: string;
  private readonly pauseMs: number;
  private marketsCache: { at: number; data: MarketInfo[] } | null = null;
  private marketsInflight: Promise<MarketInfo[]> | null = null;
  /** Laatste lijst met 24h-tickers van ALLE markten */
  private tickersAll: { at: number; data: Ticker24h[] } | null = null;
  private tickersAllInflight: Promise<Ticker24h[]> | null = null;
  /** Losse 24h-tickers (verzoeken voor één markt) */
  private readonly tickerOne = new Map<string, { at: number; data: Ticker24h[] }>();
  /** Laatste prijzen van ALLE markten (markt → prijs) */
  private pricesAll: { at: number; data: Record<string, number> } | null = null;
  private pricesInflight: Promise<Record<string, number>> | null = null;
  private readonly locks = new Map<string, Promise<unknown>>();

  constructor(
    private readonly client: BitvavoClient,
    opts: BitvavoFeedOptions = {},
  ) {
    this.nowFn = opts.now ?? (() => Date.now());
    this.cacheDir = opts.cacheDir;
    this.pauseMs = Math.max(0, opts.rateLimitPauseMs ?? 1000);
  }

  // ─────────────── Markten ───────────────

  async getMarkets(): Promise<MarketInfo[]> {
    const now = this.nowFn();
    if (this.marketsCache && now - this.marketsCache.at < MARKETS_TTL_MS) return [...this.marketsCache.data];
    if (!this.marketsInflight) {
      this.marketsInflight = (async () => {
        try {
          const data = await this.client.markets();
          this.marketsCache = { at: this.nowFn(), data };
          return data;
        } finally {
          this.marketsInflight = null;
        }
      })();
    }
    try {
      return [...(await this.marketsInflight)];
    } catch (err) {
      // Liever verouderde markten dan niets
      if (this.marketsCache) return [...this.marketsCache.data];
      throw err;
    }
  }

  // ─────────────── Candles ───────────────

  async getCandles(market: string, interval: Interval, limit: number): Promise<Candle[]> {
    intervalMs(interval);
    const n = Math.min(PAGE_LIMIT, Math.floor(Number(limit)));
    if (!(n >= 1)) return [];
    const candles = await this.client.candles(market, interval, { limit: n });
    const sorted = dedupeSort(candles ?? []);
    return sorted.length > n ? sorted.slice(sorted.length - n) : sorted;
  }

  async getHistory(market: string, interval: Interval, fromMs: number, toMs: number): Promise<Candle[]> {
    const step = intervalMs(interval);
    if (!Number.isFinite(fromMs) || !Number.isFinite(toMs)) return [];
    const now = this.nowFn();
    const from = Math.ceil(fromMs);
    // Opentijd van de laatste gesloten candle
    const lastClosed = Math.floor(now / step) * step - step;
    const to = Math.min(Math.floor(toMs), lastClosed);
    if (to < from) return [];

    const candles = this.cacheDir
      ? await this.withLock(`${market}|${interval}`, () => this.historyWithCache(market, interval, from, to, now))
      : await this.fetchRange(market, interval, from, to);
    return candles.filter((c) => c.time >= from && c.time <= to && isClosedCandle(c, interval, now));
  }

  /**
   * Haalt alle candles met opentijd in [from, to] op door achterwaarts te
   * pagineren. `end` wordt zo gekozen dat de candle op `to` er altijd bij zit,
   * ongeacht of de API `end` inclusief of exclusief behandelt.
   */
  private async fetchRange(market: string, interval: Interval, from: number, to: number): Promise<Candle[]> {
    const step = intervalMs(interval);
    const byTime = new Map<number, Candle>();
    let end = to + step - 1;
    for (let page = 0; page < MAX_PAGES; page++) {
      await this.respectRateLimit();
      const batch = await this.client.candles(market, interval, { limit: PAGE_LIMIT, start: from, end });
      if (!batch || batch.length === 0) break;
      let oldest = Infinity;
      for (const c of batch) {
        if (!isValidCandle(c)) continue;
        if (c.time < oldest) oldest = c.time;
        if (c.time >= from && c.time <= to) byTime.set(c.time, c);
      }
      if (!Number.isFinite(oldest) || oldest <= from) break;
      const nextEnd = oldest - 1;
      if (nextEnd >= end) break; // geen voortgang: stoppen i.p.v. eindeloos herhalen
      end = nextEnd;
    }
    return dedupeSort(byTime.values());
  }

  private async respectRateLimit(): Promise<void> {
    const remaining = this.publicRateLimitRemaining();
    if (typeof remaining !== "number" || !Number.isFinite(remaining)) return;
    if (remaining < VERY_LOW_RATE_LIMIT) await sleep(this.pauseMs * 5);
    else if (remaining < LOW_RATE_LIMIT) await sleep(this.pauseMs);
  }

  /**
   * Resterend budget voor PUBLIEKE verzoeken (de feed doet alleen publieke
   * verzoeken; het private budget van orders/saldo telt hier niet mee).
   */
  private publicRateLimitRemaining(): number | null {
    const client = this.client as Partial<Pick<BitvavoClient, "rateLimitFor">> & Pick<BitvavoClient, "rateLimitRemaining">;
    if (typeof client.rateLimitFor === "function") return client.rateLimitFor("public").remaining;
    return client.rateLimitRemaining;
  }

  // ─────────────── Schijfcache ───────────────

  private async historyWithCache(
    market: string,
    interval: Interval,
    from: number,
    to: number,
    now: number,
  ): Promise<Candle[]> {
    const step = intervalMs(interval);
    const file = this.cacheFile(market, interval);
    const cache = this.readCache(file, market, interval);

    if (!cache) {
      const fresh = await this.fetchRange(market, interval, from, to);
      this.writeCache(file, market, interval, { from, to, candles: this.onlyClosed(fresh, interval, now) });
      return fresh;
    }

    const gapNewer = (from - cache.to) / step;
    const gapOlder = (cache.from - to) / step;
    if (gapNewer > MAX_GAP_CANDLES) {
      // Cache is te oud om te overbruggen: vervang hem door het nieuwe bereik
      const fresh = await this.fetchRange(market, interval, from, to);
      this.writeCache(file, market, interval, { from, to, candles: this.onlyClosed(fresh, interval, now) });
      return fresh;
    }
    if (gapOlder > MAX_GAP_CANDLES) {
      // Ver vóór de cache: los ophalen, cache ongemoeid laten
      return this.fetchRange(market, interval, from, to);
    }

    let merged = cache.candles;
    let newFrom = cache.from;
    let newTo = cache.to;
    let changed = false;
    if (from < cache.from) {
      const older = await this.fetchRange(market, interval, from, cache.from - 1);
      merged = older.concat(merged);
      newFrom = from;
      changed = true;
    }
    if (to > cache.to) {
      const newer = await this.fetchRange(market, interval, cache.to + 1, to);
      merged = merged.concat(newer);
      newTo = to;
      changed = true;
    }
    if (changed) {
      merged = this.onlyClosed(dedupeSort(merged), interval, now);
      this.writeCache(file, market, interval, { from: newFrom, to: newTo, candles: merged });
    }
    return merged;
  }

  private onlyClosed(candles: Candle[], interval: Interval, now: number): Candle[] {
    return candles.filter((c) => isClosedCandle(c, interval, now));
  }

  private cacheFile(market: string, interval: Interval): string {
    const safe = `${market}_${interval}`.replace(/[^A-Za-z0-9_-]/g, "_");
    return join(this.cacheDir as string, `${safe}.json`);
  }

  private readCache(file: string, market: string, interval: Interval): CacheData | null {
    try {
      const raw = JSON.parse(readFileSync(file, "utf8")) as Partial<CacheFile>;
      if (
        raw.version !== CACHE_VERSION ||
        raw.market !== market ||
        raw.interval !== interval ||
        !Number.isFinite(raw.from) ||
        !Number.isFinite(raw.to) ||
        !Array.isArray(raw.candles)
      ) {
        return null;
      }
      const candles: Candle[] = [];
      for (const r of raw.candles) {
        if (!Array.isArray(r) || r.length < 6) continue;
        const c: Candle = { time: r[0], open: r[1], high: r[2], low: r[3], close: r[4], volume: r[5] };
        if (isValidCandle(c)) candles.push(c);
      }
      return { from: raw.from as number, to: raw.to as number, candles: dedupeSort(candles) };
    } catch {
      return null; // geen of corrupte cache → opnieuw ophalen
    }
  }

  private writeCache(file: string, market: string, interval: Interval, data: CacheData): void {
    try {
      mkdirSync(this.cacheDir as string, { recursive: true });
      const body: CacheFile = {
        version: CACHE_VERSION,
        market,
        interval,
        from: data.from,
        to: data.to,
        candles: data.candles.map((c) => [c.time, c.open, c.high, c.low, c.close, c.volume]),
      };
      const tmp = `${file}.${process.pid}.${Date.now()}.tmp`;
      writeFileSync(tmp, JSON.stringify(body));
      renameSync(tmp, file);
    } catch {
      // Cache is optioneel: schrijffouten negeren
    }
  }

  private async withLock<T>(key: string, fn: () => Promise<T>): Promise<T> {
    const prev = this.locks.get(key) ?? Promise.resolve();
    const run = prev.then(fn, fn);
    const tail = run.catch(() => undefined);
    this.locks.set(key, tail);
    try {
      return await run;
    } finally {
      if (this.locks.get(key) === tail) this.locks.delete(key);
    }
  }

  // ─────────────── Tickers, prijs, orderboek ───────────────

  async getTickers24h(markets?: string[]): Promise<Ticker24h[]> {
    if (markets && markets.length === 0) return [];
    const now = this.nowFn();
    const fresh = (entry: { at: number } | null | undefined): boolean =>
      !!entry && now - entry.at >= 0 && now - entry.at < TICKERS_TTL_MS;
    let all: Ticker24h[];
    if (fresh(this.tickersAll)) {
      all = this.tickersAll!.data;
    } else if (markets && markets.length === 1) {
      const market = markets[0];
      const cached = this.tickerOne.get(market);
      if (fresh(cached)) return copyTickers(cached!.data);
      const one = (await this.client.ticker24h(market)).filter((t) => t.market === market);
      this.tickerOne.set(market, { at: this.nowFn(), data: one });
      return copyTickers(one);
    } else {
      all = await this.fetchAllTickers();
    }
    if (!markets) return copyTickers(all);
    const wanted = new Set(markets);
    return copyTickers(all.filter((t) => wanted.has(t.market)));
  }

  /** Alle 24h-tickers; gelijktijdige verzoeken delen één API-call. */
  private async fetchAllTickers(): Promise<Ticker24h[]> {
    if (!this.tickersAllInflight) {
      this.tickersAllInflight = (async () => {
        try {
          const data = await this.client.ticker24h();
          this.tickersAll = { at: this.nowFn(), data };
          this.tickerOne.clear(); // de volledige lijst is nu de meest actuele bron
          return data;
        } finally {
          this.tickersAllInflight = null;
        }
      })();
    }
    return this.tickersAllInflight;
  }

  async getPrice(market: string): Promise<number> {
    const list = await this.client.tickerPrice(market);
    const hit = list.find((p) => p.market === market) ?? (list.length === 1 ? list[0] : undefined);
    if (!hit || !Number.isFinite(hit.price) || hit.price <= 0) {
      throw new Error(`Geen actuele prijs beschikbaar voor ${market}`);
    }
    return hit.price;
  }

  /**
   * Actuele prijs van ALLE markten in één verzoek (`GET /ticker/price` zonder
   * markt, gewicht 1). Alleen eindige prijzen > 0. Gelijktijdige aanroepen delen
   * één verzoek; het resultaat wordt ~2 s hergebruikt (klok van de feed). Een
   * fout wordt niet gecachet en gaat door naar de aanroeper.
   */
  async getPrices(): Promise<Record<string, number>> {
    const now = this.nowFn();
    const cached = this.pricesAll;
    if (cached && now - cached.at >= 0 && now - cached.at < PRICES_TTL_MS) return { ...cached.data };
    if (!this.pricesInflight) {
      this.pricesInflight = (async () => {
        try {
          const list = await this.client.tickerPrice();
          const data: Record<string, number> = {};
          for (const p of Array.isArray(list) ? list : []) {
            if (!p || typeof p.market !== "string" || p.market === "") continue;
            const price = p.price;
            if (typeof price === "number" && Number.isFinite(price) && price > 0) data[p.market] = price;
          }
          this.pricesAll = { at: this.nowFn(), data };
          return data;
        } finally {
          this.pricesInflight = null;
        }
      })();
    }
    // Kopie: een aanroeper die het resultaat aanpast, verandert de cache niet.
    return { ...(await this.pricesInflight) };
  }

  async getOrderBook(market: string, depth?: number): Promise<OrderBook> {
    return this.client.book(market, depth);
  }
}
