/**
 * SimulatedFeed: een realistische, DETERMINISTISCHE marktsimulator zodat de
 * hele app (dashboard, engine, backtests) offline werkt.
 *
 * Opbouw (consistent over alle intervallen):
 *  1. Per dag een "anker"-slotkoers per markt. Die komt uit een gemeenschappelijke
 *     marktfactor (regime-switching bull/bear/zijwaarts, GARCH-volatiliteit,
 *     dikke staarten) plus een idiosyncratisch deel per munt, met lichte
 *     mean-reversion naar een realistisch prijsniveau. Het pad wordt vanaf een
 *     vast epoch (2024-01-01) sequentieel vooruit én achteruit gegenereerd.
 *  2. Binnen elke UTC-dag een 1-minuutpad (1440 stappen) geseed op (markt, dag):
 *     intraday regimes (trend-uren vs. zijwaartse ranges), volatiliteitsclusters
 *     (GARCH + trage log-vol), sprongen/wicks, een U-vormig intraday patroon,
 *     gecorreleerd met de marktfactor. Een lineaire correctie laat de dag exact
 *     op het volgende anker eindigen.
 *  3. Elk interval = aggregatie van de 1m-candles, dus alle intervallen en
 *     getPrice zijn onderling consistent.
 *  4. "Nu" komt uit `opts.now`. Er wordt nooit toekomstige data teruggegeven: de
 *     candle in vorming aggregeert alleen de minuten tot nu (de lopende minuut
 *     via een deterministisch sub-minuutpad per seconde).
 */
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
import { EXCHANGE_MIN_ORDER_QUOTE } from "../core/defaults";
import { hashString, mulberry32 } from "../core/util";

// ─────────────────────────────── Constanten ───────────────────────────────

const MINUTE = 60_000;
const DAY = 86_400_000;
const MIN_PER_DAY = 1440;
const SQRT_MIN_PER_DAY = Math.sqrt(MIN_PER_DAY);
/** Dag 0 van het ankerpad (UTC-middernacht). */
const EPOCH = Date.UTC(2024, 0, 1);
/** Hoe ver terug (vanaf "nu") historie ondersteund wordt. */
export const SIM_MAX_HISTORY_DAYS = 1500;
/** Zelfde maximum als de Bitvavo API per request. */
const MAX_CANDLES_LIMIT = 1440;
/** Veiligheidsgrens voor het ankerpad (±~270 jaar rond het epoch). */
const MAX_ABS_DAY = 100_000;
export const DEFAULT_SIM_SEED = 20260101;

/** Mean-reversion van het log-prijsniveau per dag (houdt prijzen realistisch). */
const KAPPA = 0.012;
/** Daily GARCH(1,1) */
const D_GARCH_A = 0.1;
const D_GARCH_B = 0.85;
/** Minuut-GARCH(1,1) */
const M_GARCH_A = 0.06;
const M_GARCH_B = 0.92;
/** Trage log-volatiliteit (AR(1)) per minuut */
const LV_PHI = 0.995;
const LV_INNOV = 0.03;
const LV_VAR = (LV_INNOV * LV_INNOV) / (1 - LV_PHI * LV_PHI);

const LRU_MINUTE_DAYS = 900;
const LRU_HOUR_DAYS = 20_000;
const LRU_COMMON_DAYS = 128;
const LRU_SUBPATHS = 512;

// ─────────────────────────────── Marktprofielen ───────────────────────────────

interface MarketProfile {
  /** Typisch prijsniveau (EUR) */
  price: number;
  /** Dagelijkse volatiliteit (fractie) */
  vol: number;
  /** Typisch 24h-volume in EUR */
  volumeQuote: number;
  /** Bid/ask-spread als fractie */
  spread: number;
  quantityDecimals: number;
  /** Correlatie met de gemeenschappelijke marktfactor */
  rho: number;
}

const PROFILES: Record<string, MarketProfile> = {
  BTC: { price: 90_000, vol: 0.025, volumeQuote: 90e6, spread: 0.0002, quantityDecimals: 8, rho: 0.95 },
  ETH: { price: 3_500, vol: 0.035, volumeQuote: 45e6, spread: 0.0003, quantityDecimals: 8, rho: 0.85 },
  SOL: { price: 180, vol: 0.05, volumeQuote: 18e6, spread: 0.0005, quantityDecimals: 8, rho: 0.78 },
  XRP: { price: 2.3, vol: 0.05, volumeQuote: 30e6, spread: 0.0004, quantityDecimals: 6, rho: 0.7 },
  ADA: { price: 0.8, vol: 0.055, volumeQuote: 5e6, spread: 0.0008, quantityDecimals: 6, rho: 0.72 },
  DOGE: { price: 0.2, vol: 0.06, volumeQuote: 8e6, spread: 0.0007, quantityDecimals: 4, rho: 0.7 },
  LINK: { price: 20, vol: 0.055, volumeQuote: 3.5e6, spread: 0.0008, quantityDecimals: 6, rho: 0.72 },
  AVAX: { price: 30, vol: 0.06, volumeQuote: 2.5e6, spread: 0.001, quantityDecimals: 6, rho: 0.72 },
  DOT: { price: 6, vol: 0.055, volumeQuote: 1.8e6, spread: 0.001, quantityDecimals: 6, rho: 0.7 },
  LTC: { price: 90, vol: 0.045, volumeQuote: 2.2e6, spread: 0.0009, quantityDecimals: 8, rho: 0.7 },
  BNB: { price: 850, vol: 0.035, volumeQuote: 1.6e6, spread: 0.001, quantityDecimals: 8, rho: 0.65 },
  TRX: { price: 0.27, vol: 0.03, volumeQuote: 0.9e6, spread: 0.0012, quantityDecimals: 4, rho: 0.5 },
  SHIB: { price: 0.000012, vol: 0.06, volumeQuote: 1.8e6, spread: 0.0012, quantityDecimals: 2, rho: 0.65 },
  PEPE: { price: 0.000009, vol: 0.08, volumeQuote: 3.5e6, spread: 0.0012, quantityDecimals: 2, rho: 0.6 },
  NEAR: { price: 2.5, vol: 0.065, volumeQuote: 0.9e6, spread: 0.0018, quantityDecimals: 6, rho: 0.68 },
  ATOM: { price: 4, vol: 0.055, volumeQuote: 0.7e6, spread: 0.002, quantityDecimals: 6, rho: 0.65 },
  UNI: { price: 7, vol: 0.06, volumeQuote: 0.8e6, spread: 0.0018, quantityDecimals: 6, rho: 0.66 },
  AAVE: { price: 230, vol: 0.06, volumeQuote: 1.1e6, spread: 0.0016, quantityDecimals: 8, rho: 0.64 },
  ARB: { price: 0.35, vol: 0.07, volumeQuote: 0.8e6, spread: 0.0022, quantityDecimals: 4, rho: 0.66 },
  SUI: { price: 3, vol: 0.07, volumeQuote: 3e6, spread: 0.0012, quantityDecimals: 6, rho: 0.66 },
  XLM: { price: 0.3, vol: 0.05, volumeQuote: 1.2e6, spread: 0.0015, quantityDecimals: 4, rho: 0.62 },
  HBAR: { price: 0.18, vol: 0.065, volumeQuote: 1e6, spread: 0.0018, quantityDecimals: 4, rho: 0.62 },
  INJ: { price: 12, vol: 0.07, volumeQuote: 0.5e6, spread: 0.0025, quantityDecimals: 6, rho: 0.6 },
};

/** De standaard gesimuleerde EUR-markten (grootste eerst). */
export const SIMULATED_MARKETS: readonly string[] = Object.keys(PROFILES).map((b) => `${b}-EUR`);

const MARKET_RE = /^([A-Z0-9]{1,16})-([A-Z]{2,6})$/;

function parseMarket(market: string): { base: string; quote: string } {
  const m = typeof market === "string" ? MARKET_RE.exec(market) : null;
  if (!m) throw new Error(`Onbekende markt: ${String(market)}`);
  return { base: m[1], quote: m[2] };
}

/** Onbekende (maar geldig geformatteerde) markten krijgen een deterministisch profiel. */
function syntheticProfile(base: string): MarketProfile {
  const h = hashString(`profile|${base}`);
  const decade = (h % 500) / 100 - 2; // 10^-2 .. 10^3
  return {
    price: Math.pow(10, decade) * (1 + ((h >>> 9) % 900) / 100),
    vol: 0.05 + ((h >>> 5) % 30) / 1000,
    volumeQuote: 0.4e6 + ((h >>> 13) % 20) * 0.1e6,
    spread: 0.0025,
    quantityDecimals: 6,
    rho: 0.6,
  };
}

// ─────────────────────────────── Helpers ───────────────────────────────

const POW10_OFFSET = 40;
const POW10: number[] = Array.from({ length: 2 * POW10_OFFSET + 1 }, (_, i) => Math.pow(10, i - POW10_OFFSET));

function pow10(k: number): number {
  return POW10[k + POW10_OFFSET] ?? Math.pow(10, k);
}

// Cache van de laatst gebruikte decade [10^e, 10^(e+1)) — puur een versnelling:
// de exponent wordt altijd exact via vergelijkingen bepaald, dus het resultaat
// hangt niet af van de cache-toestand.
let decLo = 1;
let decHi = 10;
let decE = 0;

function decadeOf(v: number): number {
  if (v >= decLo && v < decHi) return decE;
  let e = Math.floor(Math.log10(v));
  if (v < pow10(e)) e--;
  else if (v >= pow10(e + 1)) e++;
  decLo = pow10(e);
  decHi = pow10(e + 1);
  decE = e;
  return e;
}

/** Rond af op 5 significante cijfers (zoals Bitvavo's pricePrecision 5). Monotoon. */
function roundSig(v: number): number {
  if (!(v > 0) || !Number.isFinite(v)) return v;
  const k = 4 - decadeOf(v);
  if (k >= 0) {
    const f = pow10(k);
    return Math.round(v * f) / f;
  }
  const p = pow10(-k);
  return Math.round(v / p) * p;
}

/** Rond af op 5 significante cijfers naar beneden (down) of boven (up). */
function roundSigDir(v: number, mode: "down" | "up"): number {
  if (!(v > 0) || !Number.isFinite(v)) return v;
  const k = 4 - decadeOf(v);
  const fn = mode === "down" ? Math.floor : Math.ceil;
  const eps = mode === "down" ? 1e-7 : -1e-7;
  if (k >= 0) {
    const f = pow10(k);
    return fn(v * f + eps) / f;
  }
  const p = pow10(-k);
  return fn(v / p + eps) * p;
}

/** Kleinste prijsstap bij 5 significante cijfers rond `v`. */
function tickOf(v: number): number {
  return pow10(decadeOf(v) - 4);
}

function roundTo(v: number, decimals: number): number {
  const f = pow10(decimals);
  return Math.round(v * f) / f;
}

function clampNum(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}

/** Kleine deterministische PRNG met normale en Student-t trekkingen. */
class Rng {
  private readonly r: () => number;
  private spare = Number.NaN;
  constructor(seed: number) {
    this.r = mulberry32(seed);
  }
  u(): number {
    return this.r();
  }
  /** (0, 1] — veilig voor log() */
  up(): number {
    return 1 - this.r();
  }
  range(a: number, b: number): number {
    return a + (b - a) * this.r();
  }
  normal(): number {
    if (this.spare === this.spare) {
      const s = this.spare;
      this.spare = Number.NaN;
      return s;
    }
    // Marsaglia polar-methode (sneller dan Box-Muller: geen goniometrie)
    let a: number;
    let b: number;
    let s: number;
    do {
      a = 2 * this.r() - 1;
      b = 2 * this.r() - 1;
      s = a * a + b * b;
    } while (s >= 1 || s === 0);
    const f = Math.sqrt((-2 * Math.log(s)) / s);
    this.spare = b * f;
    return a * f;
  }
  /**
   * Snelle dikstaartige schok met variantie 1: schaalmengsel van normalen
   * (8% kans op ×2,3), kurtosis ≈ 7,8. Gebruikt voor minuutschokken.
   */
  fat(): number {
    return this.normal() * (this.r() < 0.08 ? 2.3 : 0.7918);
  }
  /** Gestandaardiseerde Student-t met 5 vrijheidsgraden (variantie 1). */
  t5(): number {
    const n = this.normal();
    const chi = Math.max(1e-6, -2 * Math.log(this.up() * this.up()) + n * n);
    return clampNum((this.normal() / Math.sqrt(chi / 5)) * 0.7745966692414834, -8, 8);
  }
  expo(mean: number): number {
    return -Math.log(this.up()) * mean;
  }
}

class Lru<V> {
  private readonly map = new Map<string, V>();
  constructor(private readonly capacity: number) {}
  get(key: string): V | undefined {
    const v = this.map.get(key);
    if (v !== undefined) {
      this.map.delete(key);
      this.map.set(key, v);
    }
    return v;
  }
  set(key: string, value: V): void {
    this.map.delete(key);
    this.map.set(key, value);
    if (this.map.size > this.capacity) {
      const first = this.map.keys().next().value;
      if (first !== undefined) this.map.delete(first);
    }
  }
}

// Intraday seizoenspatroon: U-vorm over de UTC-dag + een bult tijdens de US-sessie.
const SEASON_VOL = new Float64Array(MIN_PER_DAY);
const SEASON_VOLUME = new Float64Array(MIN_PER_DAY);
(() => {
  let sumSq = 0;
  let sumV = 0;
  const raw = new Float64Array(MIN_PER_DAY);
  for (let i = 0; i < MIN_PER_DAY; i++) {
    const u = ((i + 0.5) / MIN_PER_DAY - 0.5) * 2;
    const hour = (i + 0.5) / 60;
    raw[i] = 0.8 + 0.35 * u * u + 0.3 * Math.exp(-(((hour - 15) / 2.5) ** 2));
    sumSq += raw[i] * raw[i];
    sumV += Math.pow(raw[i], 1.3);
  }
  const normVol = Math.sqrt(sumSq / MIN_PER_DAY);
  const normVolume = sumV / MIN_PER_DAY;
  for (let i = 0; i < MIN_PER_DAY; i++) {
    SEASON_VOL[i] = raw[i] / normVol;
    SEASON_VOLUME[i] = Math.pow(raw[i], 1.3) / normVolume;
  }
})();

// ─────────────────────────────── Dagelijkse processen ───────────────────────────────

interface DailyPoint {
  /** Genormaliseerd dagrendement (incl. regime-drift), E[x²] ≈ 1 */
  x: number;
  /** Conditionele variantie van x */
  v: number;
}

/**
 * Regime-switching proces met GARCH(1,1) en dikke staarten, in genormaliseerde
 * eenheden. `strength` schaalt de regime-drift (marktfactor 1, idiosyncratisch minder).
 */
class RegimeProcess {
  private readonly rng: Rng;
  private left = 0;
  private mu = 0;
  private vm = 1;
  private h = 1;
  private lastU = 0;
  constructor(
    seed: number,
    private readonly strength: number,
    private readonly durScale: number,
  ) {
    this.rng = new Rng(seed);
    this.h = this.rng.range(0.7, 1.3);
  }

  private newRegime(): void {
    const r = this.rng;
    const u = r.u();
    if (u < 0.42) {
      // zijwaarts
      this.mu = r.range(-0.05, 0.05);
      this.vm = r.range(0.65, 0.9);
      this.left = Math.round((4 + r.expo(10)) * this.durScale);
    } else if (u < 0.74) {
      // bull
      this.mu = r.range(0.12, 0.35);
      this.vm = r.range(0.85, 1.05);
      this.left = Math.round((6 + r.expo(16)) * this.durScale);
    } else {
      // bear
      this.mu = -r.range(0.12, 0.4);
      this.vm = r.range(1.05, 1.4);
      this.left = Math.round((5 + r.expo(12)) * this.durScale);
    }
    this.left = Math.max(2, this.left);
  }

  next(): DailyPoint {
    if (this.left <= 0) this.newRegime();
    this.left--;
    this.h = clampNum(1 - D_GARCH_A - D_GARCH_B + D_GARCH_A * this.lastU * this.lastU + D_GARCH_B * this.h, 0.25, 4);
    const z = this.rng.t5();
    const u = Math.sqrt(this.h) * z;
    this.lastU = u;
    // Zeldzame crash-/pompdag (bovenop de dikke staarten)
    let jump = 0;
    if (this.rng.u() < 0.008) jump = (this.rng.u() < 0.55 ? -1 : 1) * this.rng.range(2, 3.5);
    return { x: this.mu * this.strength + this.vm * u + jump, v: this.vm * this.vm * this.h };
  }
}

/** Proces dat vanaf dag 0 zowel vooruit als achteruit gegenereerd wordt. */
class BiSeries {
  private readonly fwd: DailyPoint[] = [];
  private readonly bwd: DailyPoint[] = [];
  private readonly pf: RegimeProcess;
  private readonly pb: RegimeProcess;
  constructor(seed: number, strength: number, durScale: number) {
    this.pf = new RegimeProcess(hashString(`${seed}|fwd`), strength, durScale);
    this.pb = new RegimeProcess(hashString(`${seed}|bwd`), strength, durScale);
  }
  /** Punt voor het rendement van dag d → d+1. */
  get(d: number): DailyPoint {
    if (d >= 0) {
      while (this.fwd.length <= d) this.fwd.push(this.pf.next());
      return this.fwd[d];
    }
    const k = -d - 1;
    while (this.bwd.length <= k) this.bwd.push(this.pb.next());
    return this.bwd[k];
  }
}

// ─────────────────────────────── Per-markt state ───────────────────────────────

interface MinuteDay {
  /** px[i] = open van minuut i, px[i+1] = close van minuut i (1441 waarden) */
  px: Float64Array;
  hi: Float64Array;
  lo: Float64Array;
  /** Volume in base */
  vol: Float64Array;
}

interface HourDay {
  o: Float64Array;
  h: Float64Array;
  l: Float64Array;
  c: Float64Array;
  v: Float64Array;
}

interface CommonDay {
  /** Gemeenschappelijke schokken per minuut (som = √1440 · x_d van de marktfactor) */
  shock: Float64Array;
  /** Gemeenschappelijke intraday trend-drift (in minuut-σ eenheden) */
  drift: Float64Array;
  /** Marktbrede sprongen (in minuut-σ eenheden, meestal 0) */
  jump: Float64Array;
}

class MarketState {
  readonly base: string;
  readonly quote: string;
  readonly profile: MarketProfile;
  readonly idio: BiSeries;
  /** fwdL[k] = log(prijs/niveau) op dag k (k ≥ 0) */
  private readonly fwdL: number[] = [0];
  /** bwdL[k] = log(prijs/niveau) op dag -k */
  private readonly bwdL: number[] = [0];
  private readonly srho: number;

  constructor(
    readonly market: string,
    seed: number,
    private readonly factor: BiSeries,
  ) {
    const { base, quote } = parseMarket(market);
    this.base = base;
    this.quote = quote;
    this.profile = PROFILES[base] ?? syntheticProfile(base);
    this.idio = new BiSeries(hashString(`${seed}|idio|${market}`), 0.5, 0.7);
    this.srho = Math.sqrt(1 - this.profile.rho * this.profile.rho);
  }

  /** Genormaliseerde schok (zonder mean-reversion) en variantie voor dag d. */
  dayShock(d: number): { x: number; v: number; c: DailyPoint; e: DailyPoint } {
    const c = this.factor.get(d);
    const e = this.idio.get(d);
    const rho = this.profile.rho;
    return { x: rho * c.x + this.srho * e.x, v: rho * rho * c.v + this.srho * this.srho * e.v, c, e };
  }

  /** Log-prijsniveau op de start (00:00 UTC) van dag d. */
  logLevel(d: number): number {
    if (d > MAX_ABS_DAY || d < -MAX_ABS_DAY) throw new Error("Datum buiten het ondersteunde simulatiebereik");
    const s = this.profile.vol;
    if (d >= 0) {
      while (this.fwdL.length <= d) {
        const k = this.fwdL.length - 1;
        const L = this.fwdL[k];
        const r = clampNum(s * this.dayShock(k).x - KAPPA * L, -0.45, 0.45);
        this.fwdL.push(L + r);
      }
      return this.fwdL[d];
    }
    while (this.bwdL.length <= -d) {
      const k = this.bwdL.length; // we berekenen L[-k] uit L[-k+1]
      const Lnext = this.bwdL[k - 1];
      const r = clampNum(s * this.dayShock(-k).x + KAPPA * Lnext, -0.45, 0.45);
      this.bwdL.push(Lnext - r);
    }
    return this.bwdL[-d];
  }

  anchorPrice(d: number): number {
    return roundSig(this.profile.price * Math.exp(this.logLevel(d)));
  }
}

// ─────────────────────────────── De feed ───────────────────────────────

export interface SimulatedFeedOptions {
  seed?: number;
  now?: () => number;
  markets?: string[];
}

function dayIndex(t: number): number {
  return Math.floor((t - EPOCH) / DAY);
}

function dayStart(d: number): number {
  return EPOCH + d * DAY;
}

function intervalMinutes(interval: Interval): number {
  const ms = INTERVAL_MS[interval];
  if (!ms) throw new Error(`Ongeldig interval: ${String(interval)}`);
  return ms / MINUTE;
}

interface PartialMinute {
  price: number;
  high: number;
  low: number;
  volume: number;
}

export class SimulatedFeed implements MarketDataFeed {
  readonly source: DataSource = "simulated";
  private readonly seed: number;
  private readonly nowFn: () => number;
  private readonly marketList: string[];
  private readonly factor: BiSeries;
  private readonly states = new Map<string, MarketState>();
  private readonly minuteCache = new Lru<MinuteDay>(LRU_MINUTE_DAYS);
  private readonly hourCache = new Lru<HourDay>(LRU_HOUR_DAYS);
  private readonly commonCache = new Lru<CommonDay>(LRU_COMMON_DAYS);
  private readonly subCache = new Lru<Float64Array>(LRU_SUBPATHS);

  constructor(opts: SimulatedFeedOptions = {}) {
    this.seed = Number.isFinite(opts.seed) ? Math.floor(opts.seed as number) : DEFAULT_SIM_SEED;
    this.nowFn = opts.now ?? (() => Date.now());
    const list = opts.markets && opts.markets.length > 0 ? opts.markets : SIMULATED_MARKETS;
    this.marketList = [...new Set(list.map((m) => String(m).trim().toUpperCase()))];
    for (const m of this.marketList) parseMarket(m);
    this.factor = new BiSeries(hashString(`${this.seed}|factor`), 1, 1);
  }

  // ─────────────── MarketDataFeed ───────────────

  async getMarkets(): Promise<MarketInfo[]> {
    return this.marketList.map((m) => this.marketInfo(m));
  }

  async getCandles(market: string, interval: Interval, limit: number): Promise<Candle[]> {
    const st = this.state(market);
    const stepMin = intervalMinutes(interval);
    const step = stepMin * MINUTE;
    const n = Math.min(MAX_CANDLES_LIMIT, Math.floor(Number(limit)));
    if (!(n >= 1)) return [];
    const now = this.nowFn();
    const formingStart = Math.floor(now / step) * step;
    let from = formingStart - (n - 1) * step;
    const minFrom = this.minSupported(now, step);
    if (from < minFrom) from = minFrom;
    const out: Candle[] = [];
    if (formingStart - step >= from) this.emitClosed(st, stepMin, from, formingStart - step, out);
    if (formingStart >= minFrom) out.push(this.formingCandle(st, stepMin, formingStart, now));
    return out;
  }

  async getHistory(market: string, interval: Interval, fromMs: number, toMs: number): Promise<Candle[]> {
    const st = this.state(market);
    const stepMin = intervalMinutes(interval);
    const step = stepMin * MINUTE;
    const now = this.nowFn();
    if (!Number.isFinite(fromMs) || !Number.isFinite(toMs)) return [];
    const first = Math.max(Math.ceil(fromMs / step) * step, this.minSupported(now, step));
    const lastClosed = Math.floor(now / step) * step - step;
    const last = Math.min(Math.floor(toMs / step) * step, lastClosed);
    const out: Candle[] = [];
    if (last >= first) this.emitClosed(st, stepMin, first, last, out);
    return out;
  }

  async getTickers24h(markets?: string[]): Promise<Ticker24h[]> {
    const list = markets ?? this.marketList;
    const now = this.nowFn();
    const out: Ticker24h[] = [];
    for (const m of list) {
      let st: MarketState;
      try {
        st = this.state(m);
      } catch {
        continue;
      }
      out.push(this.ticker(st, now));
    }
    return out;
  }

  async getPrice(market: string): Promise<number> {
    const st = this.state(market);
    return this.priceAt(st, this.nowFn());
  }

  async getOrderBook(market: string, depth = 15): Promise<OrderBook> {
    const st = this.state(market);
    const now = this.nowFn();
    const levels = clampNum(Math.floor(Number(depth) || 15), 1, 100);
    const mid = this.priceAt(st, now);
    const { bid, ask } = this.bestBidAsk(st, mid, now);
    const rng = new Rng(hashString(`${this.seed}|book|${st.market}|${Math.floor(now / 1000)}`));
    const p = st.profile;
    const qd = p.quantityDecimals;
    const minAmt = pow10(-qd);
    const size = (price: number, k: number): number => {
      const quote = (p.volumeQuote / MIN_PER_DAY) * rng.range(0.03, 0.35) * (1 + 0.3 * k) * Math.exp(0.6 * rng.normal());
      return Math.max(minAmt, roundTo(quote / price, qd));
    };
    const bids: [number, number][] = [];
    const asks: [number, number][] = [];
    let b = bid;
    let a = ask;
    for (let k = 0; k < levels; k++) {
      if (k > 0) {
        const gapB = mid * p.spread * rng.range(0.25, 1.1) * (1 + 0.1 * k);
        const gapA = mid * p.spread * rng.range(0.25, 1.1) * (1 + 0.1 * k);
        let nb = roundSigDir(b - gapB, "down");
        if (nb >= b) nb = roundSig(b - tickOf(b * 0.99999));
        let na = roundSigDir(a + gapA, "up");
        if (na <= a) na = roundSig(a + tickOf(a));
        if (!(nb > 0)) break;
        b = nb;
        a = na;
      }
      bids.push([b, size(b, k)]);
      asks.push([a, size(a, k)]);
    }
    return { market: st.market, bids, asks, timestamp: now };
  }

  // ─────────────── Markt-info & state ───────────────

  private state(market: string): MarketState {
    const key = typeof market === "string" ? market.trim().toUpperCase() : "";
    let st = this.states.get(key);
    if (!st) {
      st = new MarketState(key, this.seed, this.factor);
      this.states.set(key, st);
    }
    return st;
  }

  private marketInfo(market: string): MarketInfo {
    const st = this.state(market);
    const p = st.profile;
    const minBase = Math.max(pow10(-p.quantityDecimals), roundTo(roundSig(1 / p.price), p.quantityDecimals));
    return {
      market: st.market,
      base: st.base,
      quote: st.quote,
      status: "trading",
      minOrderQuote: EXCHANGE_MIN_ORDER_QUOTE, // €5, zoals Bitvavo
      minOrderBase: minBase,
      pricePrecision: 5,
      quantityDecimals: p.quantityDecimals,
      notionalDecimals: 2,
    };
  }

  /** Vroegst ondersteunde candle-opentijd (uitgelijnd op `step`). */
  private minSupported(now: number, step: number): number {
    return Math.ceil((now - SIM_MAX_HISTORY_DAYS * DAY) / step) * step;
  }

  // ─────────────── Generatie ───────────────

  private commonDay(d: number): CommonDay {
    const key = String(d);
    const hit = this.commonCache.get(key);
    if (hit) return hit;
    const rng = new Rng(hashString(`${this.seed}|common|${d}`));
    const c = this.factor.get(d);
    const shock = new Float64Array(MIN_PER_DAY);
    const drift = new Float64Array(MIN_PER_DAY);
    const jump = new Float64Array(MIN_PER_DAY);
    const sv = Math.sqrt(c.v);
    let sum = 0;
    for (let i = 0; i < MIN_PER_DAY; i++) {
      const z = sv * rng.fat();
      shock[i] = z;
      sum += z;
    }
    // Brownian bridge: de som van de minuutschokken = √1440 · x_d
    const adj = (SQRT_MIN_PER_DAY * c.x - sum) / MIN_PER_DAY;
    for (let i = 0; i < MIN_PER_DAY; i++) shock[i] += adj;
    // Gemeenschappelijke intraday trends
    let left = 0;
    let mu = 0;
    for (let i = 0; i < MIN_PER_DAY; i++) {
      if (left <= 0) {
        const u = rng.u();
        if (u < 0.55) {
          mu = 0;
          left = 60 + Math.round(rng.expo(150));
        } else {
          mu = (u < 0.775 ? 1 : -1) * rng.range(0.04, 0.12);
          left = 30 + Math.round(rng.expo(100));
        }
      }
      left--;
      drift[i] = mu;
      if (rng.u() < 1 / 2500) jump[i] = (rng.u() < 0.55 ? -1 : 1) * rng.range(4, 9);
    }
    const out: CommonDay = { shock, drift, jump };
    this.commonCache.set(key, out);
    return out;
  }

  private minuteDay(st: MarketState, d: number): MinuteDay {
    const key = `${st.market}|${d}`;
    const hit = this.minuteCache.get(key);
    if (hit) return hit;
    const md = this.generateDay(st, d);
    this.minuteCache.set(key, md);
    return md;
  }

  private generateDay(st: MarketState, d: number): MinuteDay {
    const p = st.profile;
    const L0 = st.logLevel(d);
    const L1 = st.logLevel(d + 1);
    const ds = st.dayShock(d);
    const rho = p.rho;
    const srho = Math.sqrt(1 - rho * rho);
    const sdW = Math.sqrt(ds.v);
    const invSdW = 1 / sdW;
    const dayVol = p.vol * sdW;
    const sm = dayVol / SQRT_MIN_PER_DAY; // σ per minuut (log)
    const common = this.commonDay(d);
    const rng = new Rng(hashString(`${this.seed}|${st.market}|${d}`));

    // Idiosyncratische schokken, gebridged naar het dagelijkse idio-rendement
    const idio = new Float64Array(MIN_PER_DAY);
    const sve = Math.sqrt(ds.e.v);
    let sum = 0;
    for (let i = 0; i < MIN_PER_DAY; i++) {
      const z = sve * rng.fat();
      idio[i] = z;
      sum += z;
    }
    const adj = (SQRT_MIN_PER_DAY * ds.e.x - sum) / MIN_PER_DAY;

    const xs = new Float64Array(MIN_PER_DAY + 1);
    const wu = new Float64Array(MIN_PER_DAY);
    const wd = new Float64Array(MIN_PER_DAY);
    const vq = new Float64Array(MIN_PER_DAY);

    const dayVolumeFactor = Math.exp(0.3 * rng.normal() - 0.045) * Math.pow(ds.v, 0.4);
    const baseVq = p.volumeQuote / MIN_PER_DAY;
    let lv = Math.sqrt(LV_VAR) * rng.normal();
    let g2 = rng.range(0.7, 1.4);
    // intraday regime
    let left = 0;
    let chop = true;
    let trendMu = 0;
    let regVm = 1;
    let theta = 0;
    let level = 0;
    let x = 0;
    const jumpScale = 0.6 + 0.5 * rho;

    for (let i = 0; i < MIN_PER_DAY; i++) {
      if (left <= 0) {
        const u = rng.u();
        if (u < 0.5) {
          chop = true;
          trendMu = 0;
          theta = rng.range(0.008, 0.035);
          level = x;
          regVm = rng.range(0.7, 0.95);
          left = 60 + Math.round(rng.expo(150));
        } else {
          chop = false;
          trendMu = (u < 0.75 ? 1 : -1) * rng.range(0.05, 0.16);
          regVm = rng.range(1, 1.25);
          left = 30 + Math.round(rng.expo(100));
        }
      }
      left--;

      const season = SEASON_VOL[i];
      lv = LV_PHI * lv + LV_INNOV * rng.normal();
      const slow = Math.exp(lv - LV_VAR);
      const g = Math.sqrt(g2);
      const loc = season * slow * g * regVm;
      const q = (rho * common.shock[i] + srho * (idio[i] + adj)) * invSdW;
      let r = sm * loc * q;
      // trend-drift (eigen + gemeenschappelijk) of mean-reversion in een range
      r += sm * season * (trendMu + rho * common.drift[i]);
      if (chop) r -= theta * (x - level);
      // sprongen
      let jumped = false;
      let jumpSize = 0;
      if (common.jump[i] !== 0) jumpSize += common.jump[i] * jumpScale;
      if (rng.u() < 1 / 1200) jumpSize += (rng.u() < 0.5 ? -1 : 1) * rng.range(3, 8);
      if (jumpSize !== 0) {
        jumped = true;
        r += sm * season * slow * jumpSize;
        g2 += rng.range(2, 5);
      }
      g2 = clampNum(1 - M_GARCH_A - M_GARCH_B + M_GARCH_A * g2 * q * q + M_GARCH_B * g2, 0.15, 12);
      x += r;
      xs[i + 1] = x;

      // wicks (in log-eenheden) en volume
      const sLoc = sm * loc;
      let up = rng.expo(0.36 * sLoc);
      let dn = rng.expo(0.36 * sLoc);
      let spike = false;
      if (rng.u() < 1 / 400) {
        spike = true;
        if (rng.u() < 0.5) up += sLoc * rng.range(2.5, 7);
        else dn += sLoc * rng.range(2.5, 7);
      }
      if (jumped) {
        if (jumpSize > 0) up += sLoc * rng.range(0.5, 2);
        else dn += sLoc * rng.range(0.5, 2);
      }
      wu[i] = up;
      wd[i] = dn;
      const activity = 0.4 + 0.75 * Math.min(Math.abs(q * g), 6);
      // rechtsscheve ruis (gemiddelde 1) × activiteit (gecorreleerd met |rendement|)
      const noise = 0.35 + rng.expo(0.65);
      let v = baseVq * SEASON_VOLUME[i] * dayVolumeFactor * noise * activity * Math.sqrt(slow);
      if (jumped) v *= rng.range(3, 6);
      if (spike) v *= rng.range(1.5, 3);
      vq[i] = v;
    }

    // Lineaire correctie zodat de dag exact op het volgende anker eindigt
    const corr = (L1 - L0 - x) / MIN_PER_DAY;
    const px = new Float64Array(MIN_PER_DAY + 1);
    const hi = new Float64Array(MIN_PER_DAY);
    const lo = new Float64Array(MIN_PER_DAY);
    const vol = new Float64Array(MIN_PER_DAY);
    const lvl = p.price;
    px[0] = st.anchorPrice(d);
    px[MIN_PER_DAY] = st.anchorPrice(d + 1);
    for (let i = 1; i < MIN_PER_DAY; i++) px[i] = roundSig(lvl * Math.exp(L0 + xs[i] + corr * i));
    for (let i = 0; i < MIN_PER_DAY; i++) {
      const o = px[i];
      const c = px[i + 1];
      const top = o > c ? o : c;
      const bot = o < c ? o : c;
      let h = roundSig(top * (1 + wu[i]));
      let l = roundSig(bot / (1 + wd[i]));
      if (h < top) h = top;
      if (l > bot) l = bot;
      if (!(l > 0)) l = bot;
      hi[i] = h;
      lo[i] = l;
      vol[i] = vq[i] / ((o + c) / 2);
    }
    return { px, hi, lo, vol };
  }

  private hourDay(st: MarketState, d: number): HourDay {
    const key = `${st.market}|${d}`;
    const hit = this.hourCache.get(key);
    if (hit) return hit;
    const md = this.minuteDay(st, d);
    const hd: HourDay = {
      o: new Float64Array(24),
      h: new Float64Array(24),
      l: new Float64Array(24),
      c: new Float64Array(24),
      v: new Float64Array(24),
    };
    for (let hr = 0; hr < 24; hr++) {
      const m0 = hr * 60;
      let h = -Infinity;
      let l = Infinity;
      let v = 0;
      for (let m = m0; m < m0 + 60; m++) {
        if (md.hi[m] > h) h = md.hi[m];
        if (md.lo[m] < l) l = md.lo[m];
        v += md.vol[m];
      }
      hd.o[hr] = md.px[m0];
      hd.c[hr] = md.px[m0 + 60];
      hd.h[hr] = h;
      hd.l[hr] = l;
      hd.v[hr] = v;
    }
    this.hourCache.set(key, hd);
    return hd;
  }

  /** Sub-minuutpad (61 punten, per seconde) voor de lopende minuut. */
  private subPath(st: MarketState, d: number, m: number): Float64Array {
    const key = `${st.market}|${d}|${m}`;
    const hit = this.subCache.get(key);
    if (hit) return hit;
    const md = this.minuteDay(st, d);
    const o = md.px[m];
    const c = md.px[m + 1];
    const H = md.hi[m];
    const L = md.lo[m];
    const rng = new Rng(hashString(`${this.seed}|sub|${st.market}|${d}|${m}`));
    let tH = 1 + Math.floor(rng.u() * 59);
    let tL = 1 + Math.floor(rng.u() * 59);
    if (tL === tH) tL = tH === 59 ? 1 : tH + 1;
    // Als de extremen gelijk zijn aan open/close, laat dan de key-points op die plek
    if (H === o) tH = 0;
    else if (H === c) tH = 60;
    if (L === o) tL = 0;
    else if (L === c) tL = 60;
    const keys: [number, number][] = [
      [0, o],
      [60, c],
    ];
    if (tH > 0 && tH < 60) keys.push([tH, H]);
    if (tL > 0 && tL < 60 && tL !== tH) keys.push([tL, L]);
    keys.sort((a, b) => a[0] - b[0]);
    const v = new Float64Array(61);
    const amp = (H - L) * 0.12;
    let ki = 0;
    for (let s = 0; s <= 60; s++) {
      while (ki < keys.length - 2 && keys[ki + 1][0] <= s) ki++;
      const [t0, p0] = keys[ki];
      const [t1, p1] = keys[ki + 1];
      if (s === t0) {
        v[s] = p0;
      } else if (s === t1) {
        v[s] = p1;
      } else {
        const f = (s - t0) / (t1 - t0);
        const noise = amp * rng.normal() * Math.sqrt(f * (1 - f)) * 2;
        v[s] = clampNum(roundSig(p0 + (p1 - p0) * f + noise), L, H);
      }
    }
    v[0] = o;
    v[60] = c;
    this.subCache.set(key, v);
    return v;
  }

  /** De lopende minuut tot tijdstip t (deterministisch per seconde). */
  private partialMinute(st: MarketState, t: number): PartialMinute {
    const d = dayIndex(t);
    const ds = dayStart(d);
    const m = Math.floor((t - ds) / MINUTE);
    const intoMs = t - ds - m * MINUTE;
    const k = Math.min(59, Math.floor(intoMs / 1000));
    const v = this.subPath(st, d, m);
    let high = v[0];
    let low = v[0];
    for (let s = 1; s <= k; s++) {
      if (v[s] > high) high = v[s];
      if (v[s] < low) low = v[s];
    }
    const md = this.minuteDay(st, d);
    return { price: v[k], high, low, volume: md.vol[m] * (intoMs / MINUTE) };
  }

  private priceAt(st: MarketState, t: number): number {
    return this.partialMinute(st, t).price;
  }

  // ─────────────── Aggregatie ───────────────

  /** Gesloten candles met opentijd in [first, last] (beide uitgelijnd op het interval). */
  private emitClosed(st: MarketState, stepMin: number, first: number, last: number, out: Candle[]): void {
    const step = stepMin * MINUTE;
    const dFirst = dayIndex(first);
    const dLast = dayIndex(last);
    for (let d = dFirst; d <= dLast; d++) {
      const ds = dayStart(d);
      const tFrom = Math.max(first, ds);
      const tTo = Math.min(last, ds + DAY - step);
      if (tTo < tFrom) continue;
      if (stepMin >= 60) {
        const hd = this.hourDay(st, d);
        const nh = stepMin / 60;
        for (let t = tFrom; t <= tTo; t += step) {
          const h0 = Math.round((t - ds) / 3_600_000);
          let h = -Infinity;
          let l = Infinity;
          let v = 0;
          for (let k = h0; k < h0 + nh; k++) {
            if (hd.h[k] > h) h = hd.h[k];
            if (hd.l[k] < l) l = hd.l[k];
            v += hd.v[k];
          }
          out.push({ time: t, open: hd.o[h0], high: h, low: l, close: hd.c[h0 + nh - 1], volume: v });
        }
      } else {
        const md = this.minuteDay(st, d);
        for (let t = tFrom; t <= tTo; t += step) {
          const m0 = Math.round((t - ds) / MINUTE);
          let h = -Infinity;
          let l = Infinity;
          let v = 0;
          for (let m = m0; m < m0 + stepMin; m++) {
            if (md.hi[m] > h) h = md.hi[m];
            if (md.lo[m] < l) l = md.lo[m];
            v += md.vol[m];
          }
          out.push({ time: t, open: md.px[m0], high: h, low: l, close: md.px[m0 + stepMin], volume: v });
        }
      }
    }
  }

  /** Candle in vorming: alleen minuten tot `now`, lopende minuut gedeeltelijk. */
  private formingCandle(st: MarketState, stepMin: number, start: number, now: number): Candle {
    const d = dayIndex(start);
    const ds = dayStart(d);
    const md = this.minuteDay(st, d);
    const m0 = Math.round((start - ds) / MINUTE);
    const mNow = Math.floor((now - ds) / MINUTE);
    let h = -Infinity;
    let l = Infinity;
    let v = 0;
    for (let m = m0; m < mNow; m++) {
      if (md.hi[m] > h) h = md.hi[m];
      if (md.lo[m] < l) l = md.lo[m];
      v += md.vol[m];
    }
    const pm = this.partialMinute(st, now);
    if (pm.high > h) h = pm.high;
    if (pm.low < l) l = pm.low;
    v += pm.volume;
    return { time: start, open: md.px[m0], high: h, low: l, close: pm.price, volume: v };
  }

  private bestBidAsk(st: MarketState, mid: number, now: number): { bid: number; ask: number } {
    const rng = new Rng(hashString(`${this.seed}|spread|${st.market}|${Math.floor(now / MINUTE)}`));
    const spread = st.profile.spread * rng.range(0.8, 1.35);
    let bid = roundSigDir(mid * (1 - spread / 2), "down");
    let ask = roundSigDir(mid * (1 + spread / 2), "up");
    if (bid >= mid) bid = roundSig(mid - tickOf(mid * 0.99999));
    if (ask <= mid) ask = roundSig(mid + tickOf(mid));
    return { bid, ask };
  }

  private ticker(st: MarketState, now: number): Ticker24h {
    const startT = now - DAY;
    const open = this.priceAt(st, startT);
    const pm = this.partialMinute(st, now);
    let high = Math.max(open, pm.high);
    let low = Math.min(open, pm.low);
    let volume = pm.volume;
    let volumeQuote = pm.volume * pm.price;
    // Volledige minuten tussen (startT, nu)
    const firstMin = Math.floor(startT / MINUTE) * MINUTE + MINUTE;
    const lastMin = Math.floor(now / MINUTE) * MINUTE - MINUTE;
    for (let d = dayIndex(firstMin); d <= dayIndex(lastMin); d++) {
      const ds = dayStart(d);
      const md = this.minuteDay(st, d);
      const mFrom = Math.max(0, Math.round((firstMin - ds) / MINUTE));
      const mTo = Math.min(MIN_PER_DAY - 1, Math.round((lastMin - ds) / MINUTE));
      for (let m = mFrom; m <= mTo; m++) {
        if (md.hi[m] > high) high = md.hi[m];
        if (md.lo[m] < low) low = md.lo[m];
        volume += md.vol[m];
        volumeQuote += md.vol[m] * ((md.px[m] + md.px[m + 1]) / 2);
      }
    }
    const last = pm.price;
    const { bid, ask } = this.bestBidAsk(st, last, now);
    return {
      market: st.market,
      last,
      open,
      high,
      low,
      volume,
      volumeQuote,
      bid,
      ask,
      changePct: open > 0 ? ((last - open) / open) * 100 : 0,
      timestamp: now,
    };
  }
}
