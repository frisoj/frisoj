/**
 * Bitvavo REST v2-client (https://api.bitvavo.com/v2).
 *
 * - Publieke endpoints werken zonder API-sleutel; private endpoints worden
 *   ondertekend (HMAC-SHA256, zie signing.ts).
 * - Rate limit: `bitvavo-ratelimit-*` headers worden APART bijgehouden voor
 *   publieke verzoeken (zonder sleutel) en private (ondertekende) verzoeken,
 *   net als de ban (code 105) en de backoff na een 429/103. Publieke verzoeken
 *   wachten al tot `resetat` als er minder dan 50 weight over is; private
 *   verzoeken (orders, saldo) mogen doorgaan tot er minder dan 10 over is. Zo
 *   blijft er altijd budget over om een stop-loss te verkopen, ook als het
 *   ophalen van koersen het budget opmaakt of een publieke ban oploopt.
 * - GET-verzoeken worden max. 2× herhaald bij netwerkfouten/5xx/429.
 *   POST /order wordt NOOIT automatisch herhaald (risico op dubbele order).
 * - Alle fouten zijn `BitvavoApiError` met een Nederlandse melding.
 */
import type {
  Balance,
  Candle,
  Interval,
  MarketInfo,
  OrderBook,
  Side,
  Ticker24h,
} from "../core/types";
import { BitvavoApiError, formatBitvavoHttpError } from "./errors";
import { formatDecimal } from "./precision";
import { signRequest } from "./signing";

export const BITVAVO_BASE_URL = "https://api.bitvavo.com/v2";
export const MAX_CANDLES_PER_REQUEST = 1440;

export type BitvavoOrderStatus =
  | "new"
  | "awaitingTrigger"
  | "canceled"
  | "canceledAuction"
  | "canceledSelfTradePrevention"
  | "canceledIOC"
  | "canceledFOK"
  | "canceledMarketProtection"
  | "canceledPostOnly"
  | "filled"
  | "partiallyFilled"
  | "expired"
  | "rejected"
  // Onbekende toekomstige statussen blijven als string behouden.
  | (string & {});

export interface BitvavoFill {
  id: string;
  timestamp: number;
  amount: number;
  price: number;
  taker: boolean;
  /** Fee van deze fill; undefined zolang de fill nog niet "settled" is */
  fee?: number;
  feeCurrency?: string;
  settled: boolean;
}

/** Bitvavo-order met numerieke velden als getallen (ontbrekend → undefined of 0). */
export interface BitvavoOrder {
  orderId: string;
  clientOrderId?: string;
  market: string;
  created: number;
  updated: number;
  status: BitvavoOrderStatus;
  side: Side;
  orderType: string;
  amount?: number;
  amountRemaining?: number;
  price?: number;
  amountQuote?: number;
  amountQuoteRemaining?: number;
  onHold?: number;
  onHoldCurrency?: string;
  filledAmount: number;
  filledAmountQuote: number;
  feePaid: number;
  feeCurrency?: string;
  fills: BitvavoFill[];
  timeInForce?: string;
  postOnly?: boolean;
}

export interface PlaceOrderParams {
  market: string;
  side: Side;
  orderType: "market" | "limit";
  amount?: number;
  amountQuote?: number;
  price?: number;
  clientOrderId?: string;
  timeInForce?: "GTC" | "IOC" | "FOK";
  postOnly?: boolean;
}

export interface BitvavoClientOptions {
  apiKey?: string;
  apiSecret?: string;
  baseUrl?: string;
  /** Bitvavo-Access-Window in ms (default 10000) */
  accessWindow?: number;
  /** Identificeert deze bot bij Bitvavo; verplicht bij orders plaatsen/annuleren (default 1) */
  operatorId?: number;
  fetchImpl?: typeof fetch;
  now?: () => number;
  /** Timeout per verzoek in ms (default 10000) */
  timeoutMs?: number;
  // ── Extra (optioneel, buiten het contract) ──
  /** Aantal herhalingen voor GET-verzoeken (default 2) */
  maxRetries?: number;
  /** Basis-wachttijd voor backoff in ms (default 500) */
  retryBaseDelayMs?: number;
  /** Injecteerbare sleep (tests) */
  sleep?: (ms: number) => Promise<void>;
  /** Klokverschil corrigeren via GET /time vóór het eerste private verzoek (default true) */
  autoTimeSync?: boolean;
}

type Query = Record<string, string | number | boolean | undefined | null>;

/** Soort verzoek voor de rate-limitadministratie: zonder sleutel of ondertekend. */
export type RateLimitScope = "public" | "private";

export interface RateLimitStatus {
  /** Laatst gemelde resterende weight (header) voor deze soort verzoeken, of null */
  remaining: number | null;
  /** Tijdstip (ms) waarop de teller reset, of null */
  resetAt: number | null;
  /** Geblokkeerd (code 105) tot dit tijdstip (ms), of null */
  bannedUntil: number | null;
}

interface RequestOptions {
  query?: Query;
  body?: Record<string, unknown>;
  auth?: boolean;
  /** Overschrijft het aantal herhalingen (alleen GET wordt ooit herhaald) */
  retries?: number;
  /** Niet wachten op de rate limit maar meteen een "rate-limit"-fout gooien */
  noWait?: boolean;
}

/** Publieke verzoeken wachten tot de reset als er minder dan dit over is (reserve voor private verzoeken). */
export const PUBLIC_RATE_LIMIT_RESERVE = 50;
/** Private (ondertekende) verzoeken wachten pas tot de reset als er minder dan dit over is. */
export const PRIVATE_RATE_LIMIT_FLOOR = 10;
const MAX_RATE_LIMIT_WAIT_MS = 65_000;
const CLOCK_SKEW_THRESHOLD_MS = 1000;

const defaultSleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

// ─────────────────────────────── Parse-helpers ───────────────────────────────

function num(v: unknown): number {
  if (typeof v === "number") return v;
  if (typeof v === "string" && v.trim() !== "") return Number(v);
  return Number.NaN;
}

function numOr(v: unknown, fallback: number): number {
  const n = num(v);
  return Number.isFinite(n) ? n : fallback;
}

function optNum(v: unknown): number | undefined {
  const n = num(v);
  return Number.isFinite(n) ? n : undefined;
}

function nullableNum(v: unknown): number | null {
  const n = num(v);
  return Number.isFinite(n) ? n : null;
}

function str(v: unknown): string | undefined {
  return typeof v === "string" && v !== "" ? v : undefined;
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

/** Bitvavo geeft soms één object en soms een array terug. */
function asArray(data: unknown): Record<string, unknown>[] {
  if (Array.isArray(data)) return data.filter(isRecord);
  if (isRecord(data)) return [data];
  return [];
}

/** Normaliseert een timestamp naar ms (sommige endpoints geven µs/ns). */
function toMs(v: unknown, fallback: number): number {
  let t = num(v);
  if (!Number.isFinite(t) || t <= 0) return fallback;
  while (t > 1e14) t /= 1000;
  return Math.round(t);
}

export function parseMarket(raw: Record<string, unknown>): MarketInfo | null {
  const market = str(raw.market);
  if (!market) return null;
  const [baseFromName, quoteFromName] = market.split("-");
  const tick = optNum(raw.tickSize);
  const info: MarketInfo = {
    market,
    base: str(raw.base) ?? baseFromName ?? "",
    quote: str(raw.quote) ?? quoteFromName ?? "",
    status: str(raw.status) ?? "unknown",
    minOrderQuote: Math.max(0, numOr(raw.minOrderInQuoteAsset, 0)),
    minOrderBase: Math.max(0, numOr(raw.minOrderInBaseAsset, 0)),
    pricePrecision: Math.max(1, Math.trunc(numOr(raw.pricePrecision, 5))),
    quantityDecimals: Math.max(0, Math.trunc(numOr(raw.quantityDecimals, 8))),
    notionalDecimals: Math.max(0, Math.trunc(numOr(raw.notionalDecimals, 2))),
  };
  if (tick !== undefined && tick > 0) info.tickSize = tick;
  return info;
}

export function parseCandles(data: unknown): Candle[] {
  if (!Array.isArray(data)) return [];
  const byTime = new Map<number, Candle>();
  for (const row of data) {
    if (!Array.isArray(row) || row.length < 6) continue;
    const c: Candle = {
      time: num(row[0]),
      open: num(row[1]),
      high: num(row[2]),
      low: num(row[3]),
      close: num(row[4]),
      volume: num(row[5]),
    };
    if (
      !Number.isFinite(c.time) ||
      !Number.isFinite(c.open) ||
      !Number.isFinite(c.high) ||
      !Number.isFinite(c.low) ||
      !Number.isFinite(c.close)
    ) {
      continue;
    }
    if (!Number.isFinite(c.volume)) c.volume = 0;
    byTime.set(c.time, c);
  }
  return [...byTime.values()].sort((a, b) => a.time - b.time);
}

export function parseTicker24h(raw: Record<string, unknown>, now: number): Ticker24h | null {
  const market = str(raw.market);
  if (!market) return null;
  const last = numOr(raw.last, 0);
  const open = numOr(raw.open, 0);
  const bid = nullableNum(raw.bid);
  const ask = nullableNum(raw.ask);
  return {
    market,
    last,
    open,
    high: numOr(raw.high, 0),
    low: numOr(raw.low, 0),
    volume: numOr(raw.volume, 0),
    volumeQuote: numOr(raw.volumeQuote, 0),
    bid: bid !== null && bid > 0 ? bid : null,
    ask: ask !== null && ask > 0 ? ask : null,
    changePct: open > 0 && last > 0 ? ((last - open) / open) * 100 : 0,
    timestamp: toMs(raw.timestamp, now),
  };
}

function parseLevels(v: unknown): [number, number][] {
  if (!Array.isArray(v)) return [];
  const out: [number, number][] = [];
  for (const lvl of v) {
    if (!Array.isArray(lvl) || lvl.length < 2) continue;
    const p = num(lvl[0]);
    const s = num(lvl[1]);
    if (Number.isFinite(p) && Number.isFinite(s) && p > 0 && s > 0) out.push([p, s]);
  }
  return out;
}

export function parseFill(raw: Record<string, unknown>): BitvavoFill | null {
  const amount = num(raw.amount);
  const price = num(raw.price);
  if (!Number.isFinite(amount) || !Number.isFinite(price)) return null;
  const fill: BitvavoFill = {
    id: str(raw.id) ?? "",
    timestamp: numOr(raw.timestamp, 0),
    amount,
    price,
    taker: raw.taker === true || raw.taker === "true",
    settled: raw.settled === true || raw.settled === "true",
  };
  const fee = optNum(raw.fee);
  if (fee !== undefined) fill.fee = fee;
  const feeCurrency = str(raw.feeCurrency);
  if (feeCurrency) fill.feeCurrency = feeCurrency;
  return fill;
}

export function parseOrder(raw: Record<string, unknown>): BitvavoOrder {
  const fills = Array.isArray(raw.fills)
    ? raw.fills.filter(isRecord).map(parseFill).filter((f): f is BitvavoFill => f !== null)
    : [];
  const side = raw.side === "sell" ? "sell" : "buy";
  const order: BitvavoOrder = {
    orderId: str(raw.orderId) ?? "",
    market: str(raw.market) ?? "",
    created: numOr(raw.created, 0),
    updated: numOr(raw.updated, numOr(raw.created, 0)),
    status: str(raw.status) ?? "new",
    side,
    orderType: str(raw.orderType) ?? "",
    filledAmount: numOr(raw.filledAmount, 0),
    filledAmountQuote: numOr(raw.filledAmountQuote, 0),
    feePaid: numOr(raw.feePaid, 0),
    fills,
  };
  const optionalNums = [
    "amount",
    "amountRemaining",
    "price",
    "amountQuote",
    "amountQuoteRemaining",
    "onHold",
  ] as const;
  for (const k of optionalNums) {
    const v = optNum(raw[k]);
    if (v !== undefined) order[k] = v;
  }
  const clientOrderId = str(raw.clientOrderId);
  if (clientOrderId) order.clientOrderId = clientOrderId;
  const onHoldCurrency = str(raw.onHoldCurrency);
  if (onHoldCurrency) order.onHoldCurrency = onHoldCurrency;
  const feeCurrency = str(raw.feeCurrency);
  if (feeCurrency) order.feeCurrency = feeCurrency;
  const tif = str(raw.timeInForce);
  if (tif) order.timeInForce = tif;
  if (typeof raw.postOnly === "boolean") order.postOnly = raw.postOnly;
  return order;
}

function positiveFinite(v: number | undefined): v is number {
  return typeof v === "number" && Number.isFinite(v) && v > 0;
}

// ─────────────────────────────── Client ───────────────────────────────

export class BitvavoClient {
  readonly hasCredentials: boolean;
  /**
   * Laatst bekende resterende rate-limit weight (header van het laatste
   * antwoord, publiek of privé), of null als onbekend. Per soort: `rateLimitFor`.
   */
  rateLimitRemaining: number | null = null;
  /** Tijdstip (ms) waarop de rate-limit teller reset (laatste antwoord), of null */
  rateLimitResetAt: number | null = null;
  /** Correctie (ms) die bij de lokale klok opgeteld wordt voor timestamps */
  clockOffsetMs = 0;
  readonly operatorId: number;

  readonly #apiKey: string;
  readonly #apiSecret: string;
  readonly #baseUrl: string;
  /** Pad-prefix van de base-URL (bijv. "/v2"), onderdeel van de handtekening */
  readonly #pathPrefix: string;
  readonly #accessWindow: number;
  readonly #fetch: typeof fetch;
  readonly #now: () => number;
  readonly #timeoutMs: number;
  readonly #maxRetries: number;
  readonly #retryBaseDelayMs: number;
  readonly #sleep: (ms: number) => Promise<void>;
  readonly #autoTimeSync: boolean;
  #timeSynced = false;
  #timeSyncFailedAt = 0;
  /** Rate-limit/ban/backoff-toestand, apart voor publieke en private verzoeken */
  readonly #limits: Record<RateLimitScope, { remaining: number | null; resetAt: number | null; bannedUntil: number }> = {
    public: { remaining: null, resetAt: null, bannedUntil: 0 },
    private: { remaining: null, resetAt: null, bannedUntil: 0 },
  };

  constructor(opts: BitvavoClientOptions = {}) {
    this.#apiKey = (opts.apiKey ?? "").trim();
    this.#apiSecret = (opts.apiSecret ?? "").trim();
    this.hasCredentials = this.#apiKey !== "" && this.#apiSecret !== "";
    const base = (opts.baseUrl ?? BITVAVO_BASE_URL).replace(/\/+$/, "");
    this.#baseUrl = base;
    let prefix = "/v2";
    try {
      prefix = new URL(base).pathname.replace(/\/+$/, "");
    } catch {
      // ongeldige base-URL: fetch faalt later met een duidelijke fout
    }
    this.#pathPrefix = prefix;
    this.#accessWindow = positiveFinite(opts.accessWindow) ? Math.round(opts.accessWindow) : 10_000;
    const op = opts.operatorId ?? 1;
    this.operatorId = Number.isSafeInteger(op) && op > 0 ? op : 1;
    this.#fetch = opts.fetchImpl ?? ((...args: Parameters<typeof fetch>) => fetch(...args));
    this.#now = opts.now ?? Date.now;
    this.#timeoutMs = positiveFinite(opts.timeoutMs) ? opts.timeoutMs : 10_000;
    this.#maxRetries = Math.max(0, Math.trunc(opts.maxRetries ?? 2));
    this.#retryBaseDelayMs = Math.max(0, opts.retryBaseDelayMs ?? 500);
    this.#sleep = opts.sleep ?? defaultSleep;
    this.#autoTimeSync = opts.autoTimeSync ?? true;
  }

  /** Rate-limitstatus voor publieke (zonder sleutel) of private (ondertekende) verzoeken. */
  rateLimitFor(scope: RateLimitScope): RateLimitStatus {
    const st = this.#limits[scope];
    return {
      remaining: st.remaining,
      resetAt: st.resetAt,
      bannedUntil: st.bannedUntil > this.#now() ? st.bannedUntil : null,
    };
  }

  // ─────────────── Publieke endpoints ───────────────

  /** Servertijd van Bitvavo in ms. */
  async time(): Promise<number> {
    return this.#serverTime(false);
  }

  async #serverTime(noWait: boolean): Promise<number> {
    const data = await this.#request<unknown>("GET", "/time", { retries: 0, noWait });
    const t = isRecord(data) ? num(data.time) : Number.NaN;
    if (!Number.isFinite(t)) {
      throw new BitvavoApiError("Bitvavo gaf een ongeldige servertijd terug", 200, null, {
        kind: "invalid-response",
        method: "GET",
        endpoint: "/time",
      });
    }
    return t;
  }

  /**
   * Meet het verschil tussen de lokale klok en de Bitvavo-klok en corrigeert
   * timestamps als het verschil groter is dan 1 seconde. Geeft de offset (ms).
   */
  async syncTime(): Promise<number> {
    return this.#syncTime(false);
  }

  async #syncTime(noWait: boolean): Promise<number> {
    const t0 = this.#now();
    const server = await this.#serverTime(noWait);
    const t1 = this.#now();
    const offset = server - (t0 + t1) / 2;
    this.clockOffsetMs = Math.abs(offset) > CLOCK_SKEW_THRESHOLD_MS ? Math.round(offset) : 0;
    this.#timeSynced = true;
    return offset;
  }

  async markets(): Promise<MarketInfo[]> {
    const data = await this.#request<unknown>("GET", "/markets");
    return asArray(data)
      .map(parseMarket)
      .filter((m): m is MarketInfo => m !== null);
  }

  /** Candles OPLOPEND op tijd (Bitvavo geeft nieuwste eerst). Max 1440 per verzoek. */
  async candles(
    market: string,
    interval: Interval,
    opts: { limit?: number; start?: number; end?: number } = {},
  ): Promise<Candle[]> {
    const limit =
      opts.limit === undefined
        ? undefined
        : Math.min(MAX_CANDLES_PER_REQUEST, Math.max(1, Math.trunc(opts.limit)));
    const data = await this.#request<unknown>("GET", `/${encodeURIComponent(market)}/candles`, {
      query: {
        interval,
        limit,
        start: opts.start !== undefined ? Math.trunc(opts.start) : undefined,
        end: opts.end !== undefined ? Math.trunc(opts.end) : undefined,
      },
    });
    return parseCandles(data);
  }

  async ticker24h(market?: string): Promise<Ticker24h[]> {
    const data = await this.#request<unknown>("GET", "/ticker/24h", { query: { market } });
    const now = this.#now();
    return asArray(data)
      .map((r) => parseTicker24h(r, now))
      .filter((t): t is Ticker24h => t !== null);
  }

  /** Laatste prijs per markt (markten zonder geldige prijs worden weggelaten). */
  async tickerPrice(market?: string): Promise<{ market: string; price: number }[]> {
    const data = await this.#request<unknown>("GET", "/ticker/price", { query: { market } });
    const out: { market: string; price: number }[] = [];
    for (const r of asArray(data)) {
      const m = str(r.market);
      const price = num(r.price);
      if (m && Number.isFinite(price) && price > 0) out.push({ market: m, price });
    }
    return out;
  }

  async book(market: string, depth?: number): Promise<OrderBook> {
    const data = await this.#request<unknown>("GET", `/${encodeURIComponent(market)}/book`, {
      query: { depth: depth !== undefined ? Math.max(1, Math.trunc(depth)) : undefined },
    });
    const raw = isRecord(data) ? data : {};
    const bids = parseLevels(raw.bids).sort((a, b) => b[0] - a[0]);
    const asks = parseLevels(raw.asks).sort((a, b) => a[0] - b[0]);
    return {
      market: str(raw.market) ?? market,
      bids,
      asks,
      timestamp: toMs(raw.timestamp, this.#now()),
    };
  }

  // ─────────────── Private endpoints ───────────────

  async balance(): Promise<Balance[]> {
    const data = await this.#request<unknown>("GET", "/balance", { auth: true });
    const out: Balance[] = [];
    for (const r of asArray(data)) {
      const symbol = str(r.symbol);
      if (!symbol) continue;
      out.push({
        symbol,
        available: Math.max(0, numOr(r.available, 0)),
        inOrder: Math.max(0, numOr(r.inOrder, 0)),
      });
    }
    return out;
  }

  async account(): Promise<{ takerFee: number; makerFee: number; volume: number }> {
    const data = await this.#request<unknown>("GET", "/account", { auth: true });
    const fees = isRecord(data) && isRecord(data.fees) ? data.fees : {};
    return {
      takerFee: numOr(fees.taker, 0.0025),
      makerFee: numOr(fees.maker, 0.0015),
      volume: numOr(fees.volume, 0),
    };
  }

  /**
   * Plaatst een order. Wordt NOOIT automatisch herhaald: bij een fout met
   * `err.outcomeUnknown === true` moet de aanroeper de order opzoeken via
   * `getOrderByClientId` voordat hij iets anders doet.
   */
  async placeOrder(p: PlaceOrderParams): Promise<BitvavoOrder> {
    const invalid = (msg: string) =>
      new BitvavoApiError(`Order niet verstuurd: ${msg}`, 0, null, {
        kind: "validation",
        method: "POST",
        endpoint: "/order",
      });
    if (!p || typeof p.market !== "string" || !/^[A-Z0-9]+-[A-Z0-9]+$/i.test(p.market)) {
      throw invalid(`ongeldige markt "${p?.market}"`);
    }
    if (p.side !== "buy" && p.side !== "sell") throw invalid(`ongeldige kant "${p.side}"`);
    if (p.orderType !== "market" && p.orderType !== "limit") {
      throw invalid(`ongeldig ordertype "${p.orderType}"`);
    }
    const hasAmount = p.amount !== undefined;
    const hasQuote = p.amountQuote !== undefined;
    if (hasAmount && !positiveFinite(p.amount)) throw invalid(`ongeldige hoeveelheid ${p.amount}`);
    if (hasQuote && !positiveFinite(p.amountQuote)) throw invalid(`ongeldig bedrag ${p.amountQuote}`);
    if (p.price !== undefined && !positiveFinite(p.price)) throw invalid(`ongeldige prijs ${p.price}`);
    if (p.orderType === "market") {
      if (hasAmount === hasQuote) throw invalid("geef bij een market order óf amount óf amountQuote op");
      if (p.price !== undefined) throw invalid("een market order heeft geen prijs");
    } else {
      if (!hasAmount || p.price === undefined) throw invalid("een limit order vereist amount en price");
      if (hasQuote) throw invalid("een limit order gebruikt geen amountQuote");
    }

    const body: Record<string, unknown> = {
      market: p.market,
      side: p.side,
      orderType: p.orderType,
    };
    if (hasAmount) body.amount = formatDecimal(p.amount as number, 15);
    if (hasQuote) body.amountQuote = formatDecimal(p.amountQuote as number, 15);
    if (p.price !== undefined) body.price = formatDecimal(p.price, 15);
    for (const k of ["amount", "amountQuote", "price"] as const) {
      if (body[k] === "0") throw invalid(`${k} is te klein`);
    }
    if (p.clientOrderId) body.clientOrderId = p.clientOrderId;
    if (p.timeInForce) body.timeInForce = p.timeInForce;
    if (p.postOnly !== undefined) body.postOnly = p.postOnly;
    body.operatorId = this.operatorId; // MOET een JSON-getal zijn
    body.responseRequired = true;

    const data = await this.#request<unknown>("POST", "/order", { body, auth: true, retries: 0 });
    return this.#expectOrder(data, "POST", "/order");
  }

  async getOrder(market: string, orderId: string): Promise<BitvavoOrder> {
    const data = await this.#request<unknown>("GET", "/order", {
      query: { market, orderId },
      auth: true,
    });
    return this.#expectOrder(data, "GET", "/order");
  }

  /** Zoekt een order op via de eigen clientOrderId (na een netwerkfout bij plaatsen). */
  async getOrderByClientId(market: string, clientOrderId: string): Promise<BitvavoOrder> {
    const data = await this.#request<unknown>("GET", "/order", {
      query: { market, clientOrderId },
      auth: true,
    });
    return this.#expectOrder(data, "GET", "/order");
  }

  async cancelOrder(market: string, orderId: string): Promise<void> {
    await this.#request<unknown>("DELETE", "/order", {
      query: { market, orderId, operatorId: this.operatorId },
      auth: true,
      retries: 0,
    });
  }

  async openOrders(market?: string): Promise<BitvavoOrder[]> {
    const data = await this.#request<unknown>("GET", "/ordersOpen", { query: { market }, auth: true });
    return asArray(data).map(parseOrder);
  }

  // ─────────────── Intern ───────────────

  #expectOrder(data: unknown, method: string, endpoint: string): BitvavoOrder {
    if (!isRecord(data) || !str(data.orderId)) {
      throw new BitvavoApiError(
        `Bitvavo gaf een onverwacht antwoord op ${method} ${endpoint} (geen orderId)`,
        200,
        null,
        { kind: "invalid-response", method, endpoint },
      );
    }
    return parseOrder(data);
  }

  #buildQuery(query?: Query): string {
    if (!query) return "";
    const params = new URLSearchParams();
    for (const [k, v] of Object.entries(query)) {
      if (v === undefined || v === null || v === "") continue;
      params.append(k, String(v));
    }
    const s = params.toString();
    return s ? `?${s}` : "";
  }

  #updateRateLimit(res: Response, scope: RateLimitScope): void {
    const headers = res.headers;
    if (!headers || typeof headers.get !== "function") return;
    const st = this.#limits[scope];
    const remaining = num(headers.get("bitvavo-ratelimit-remaining"));
    if (Number.isFinite(remaining)) {
      this.rateLimitRemaining = remaining;
      st.remaining = remaining;
    }
    const resetAt = num(headers.get("bitvavo-ratelimit-resetat"));
    if (Number.isFinite(resetAt) && resetAt > 0) {
      this.rateLimitResetAt = resetAt;
      st.resetAt = resetAt;
    }
  }

  /**
   * Wacht (of weigert) voordat een verzoek verstuurd wordt:
   * - Ban (105): private verzoeken worden alleen door een ban op private
   *   verzoeken tegengehouden; publieke verzoeken door elke ban (niet riskeren
   *   dat een ban op hetzelfde IP verlengd wordt).
   * - Budget: publieke verzoeken wachten tot de reset bij < 50 resterend (ook als
   *   het laatst gemelde private budget zo laag is: reserve voor orders);
   *   private verzoeken pas bij < 10 resterend van hun eigen budget.
   */
  async #respectRateLimit(method: string, endpoint: string, scope: RateLimitScope, noWait = false): Promise<void> {
    const now = this.#now();
    const bannedUntil =
      scope === "private"
        ? this.#limits.private.bannedUntil
        : Math.max(this.#limits.public.bannedUntil, this.#limits.private.bannedUntil);
    if (bannedUntil > now) {
      const sec = Math.ceil((bannedUntil - now) / 1000);
      throw new BitvavoApiError(
        `Bitvavo heeft ons tijdelijk geblokkeerd wegens te veel verzoeken; nog ${sec} s wachten`,
        0,
        105,
        { kind: "rate-limit", method, endpoint },
      );
    }
    const floor = scope === "private" ? PRIVATE_RATE_LIMIT_FLOOR : PUBLIC_RATE_LIMIT_RESERVE;
    const checked: RateLimitScope[] = scope === "private" ? ["private"] : ["public", "private"];
    let waitUntil = 0;
    const low: RateLimitScope[] = [];
    for (const s of checked) {
      const st = this.#limits[s];
      if (st.remaining !== null && st.remaining < floor && st.resetAt !== null && st.resetAt > now) {
        waitUntil = Math.max(waitUntil, st.resetAt);
        low.push(s);
      }
    }
    if (low.length === 0) return;
    if (noWait) {
      throw new BitvavoApiError(
        `Rate limit van Bitvavo bijna bereikt; ${method} ${endpoint} overgeslagen tot de reset`,
        0,
        null,
        { kind: "rate-limit", method, endpoint },
      );
    }
    await this.#sleep(Math.min(MAX_RATE_LIMIT_WAIT_MS, waitUntil - now + 50));
    // De eerstvolgende response zet de echte waarde weer.
    for (const s of low) this.#limits[s].remaining = null;
    this.rateLimitRemaining = null;
  }

  async #maybeSyncTime(): Promise<void> {
    if (!this.#autoTimeSync || this.#timeSynced) return;
    const now = this.#now();
    if (this.#timeSyncFailedAt && now - this.#timeSyncFailedAt < 60_000) return;
    try {
      // /time is een publiek verzoek: niet laten wachten op de publieke reserve
      // (dat zou de order vertragen); lukt het nu niet, dan de lokale klok.
      await this.#syncTime(true);
    } catch {
      // Niet fataal: we gebruiken de lokale klok en proberen het later opnieuw.
      this.#timeSyncFailedAt = now || 1;
    }
  }

  async #request<T>(method: "GET" | "POST" | "DELETE", endpoint: string, opts: RequestOptions = {}): Promise<T> {
    const retries = method === "GET" ? Math.max(0, opts.retries ?? this.#maxRetries) : 0;
    const scope: RateLimitScope = opts.auth ? "private" : "public";
    let attempt = 0;
    for (;;) {
      try {
        return await this.#requestOnce<T>(method, endpoint, opts);
      } catch (err) {
        if (!(err instanceof BitvavoApiError)) throw err;
        if (err.errorCode === 304 || err.errorCode === 302) {
          // Timestamp buiten het access window: klok opnieuw synchroniseren.
          this.#timeSynced = false;
          this.#timeSyncFailedAt = 0;
        }
        const clockError = (err.errorCode === 304 || err.errorCode === 302) && method === "GET";
        if (attempt >= retries || !(err.retryable || clockError)) throw err;
        attempt++;
        let delay = this.#retryBaseDelayMs * 2 ** (attempt - 1);
        const resetAt = this.#limits[scope].resetAt;
        if (err.isRateLimit && resetAt !== null) {
          const untilReset = resetAt - this.#now();
          if (untilReset > 0) delay = Math.max(delay, Math.min(MAX_RATE_LIMIT_WAIT_MS, untilReset + 50));
        }
        await this.#sleep(delay);
      }
    }
  }

  async #requestOnce<T>(method: "GET" | "POST" | "DELETE", endpoint: string, opts: RequestOptions): Promise<T> {
    if (opts.auth && !this.hasCredentials) {
      throw new BitvavoApiError(
        "Geen Bitvavo API-sleutel/secret ingesteld; stel BITVAVO_API_KEY en BITVAVO_API_SECRET in",
        0,
        null,
        { kind: "config", method, endpoint },
      );
    }
    const scope: RateLimitScope = opts.auth ? "private" : "public";
    await this.#respectRateLimit(method, endpoint, scope, opts.noWait);
    if (opts.auth) await this.#maybeSyncTime();

    const queryString = this.#buildQuery(opts.query);
    const url = `${this.#baseUrl}${endpoint}${queryString}`;
    const bodyString = opts.body !== undefined ? JSON.stringify(opts.body) : "";
    const headers: Record<string, string> = {
      "Content-Type": "application/json",
      Accept: "application/json",
    };
    if (opts.auth) {
      const timestamp = Math.round(this.#now() + this.clockOffsetMs);
      headers["Bitvavo-Access-Key"] = this.#apiKey;
      headers["Bitvavo-Access-Signature"] = signRequest(
        this.#apiSecret,
        timestamp,
        method,
        `${this.#pathPrefix}${endpoint}${queryString}`,
        bodyString,
      );
      headers["Bitvavo-Access-Timestamp"] = String(timestamp);
      headers["Bitvavo-Access-Window"] = String(this.#accessWindow);
    }

    const controller = new AbortController();
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      controller.abort();
    }, this.#timeoutMs);

    let res: Response;
    let text: string;
    try {
      res = await this.#fetch(url, {
        method,
        headers,
        body: method === "GET" ? undefined : bodyString || undefined,
        signal: controller.signal,
      });
      text = await res.text();
    } catch (cause) {
      if (timedOut) {
        throw new BitvavoApiError(
          `Geen antwoord van Bitvavo binnen ${Math.round(this.#timeoutMs / 1000)} s bij ${method} ${endpoint} (timeout)`,
          0,
          null,
          { kind: "timeout", method, endpoint, cause },
        );
      }
      const reason = cause instanceof Error ? cause.message : String(cause);
      throw new BitvavoApiError(
        `Kan Bitvavo niet bereiken bij ${method} ${endpoint} (netwerkfout: ${reason})`,
        0,
        null,
        { kind: "network", method, endpoint, cause },
      );
    } finally {
      clearTimeout(timer);
    }

    this.#updateRateLimit(res, scope);

    let data: unknown = null;
    let parseFailed = false;
    if (text.trim() !== "") {
      try {
        data = JSON.parse(text);
      } catch {
        parseFailed = true;
      }
    }

    const errorCode = isRecord(data) ? nullableNum(data.errorCode) : null;
    if (!res.ok || errorCode !== null) {
      const bitvavoMessage =
        isRecord(data) && typeof data.error === "string"
          ? data.error
          : parseFailed
            ? text.slice(0, 200)
            : null;
      const status = res.status || 0;
      if (errorCode === 105) this.#registerBan(bitvavoMessage, scope);
      else if (errorCode === 103 || (status === 429 && errorCode !== 104)) {
        // Budget op (backoff voor alleen deze soort verzoeken): tot de reset wachten.
        // (104 = alleen te veel nieuwe orders; saldo/annuleren mogen dan gewoon door.)
        this.#limits[scope].remaining = 0;
      }
      throw new BitvavoApiError(
        formatBitvavoHttpError(method, endpoint, status, errorCode, bitvavoMessage),
        status,
        errorCode,
        { kind: "http", bitvavoMessage, method, endpoint },
      );
    }

    if (parseFailed) {
      throw new BitvavoApiError(
        `Bitvavo gaf een onleesbaar antwoord bij ${method} ${endpoint} (geen geldige JSON)`,
        res.status,
        null,
        { kind: "invalid-response", method, endpoint },
      );
    }
    return data as T;
  }

  #registerBan(message: string | null, scope: RateLimitScope): void {
    const now = this.#now();
    const m = message?.match(/(\d{12,})/);
    let until = m ? Number(m[1]) : Number.NaN;
    if (!Number.isFinite(until) || until <= now) until = now + 60_000;
    this.#limits[scope].bannedUntil = Math.min(until, now + 15 * 60_000);
  }
}
