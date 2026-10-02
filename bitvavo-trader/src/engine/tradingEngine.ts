/**
 * TradingEngine: de "hartslag" van de bot.
 *
 * Per tick (elke `config.pollMs`):
 *  1. dagwissel (dagtellers resetten),
 *  2. per markt candles ophalen → "price" + "candle" events,
 *  3. open posities bewaken (nieuwe GESLOTEN candles sinds entry + de actuele
 *     koers als synthetische candle) → exits,
 *  4. bij een NIEUWE gesloten candle: ensemble-beslissing → "decision" event,
 *     verkoopsignaal-exit of (risk-goedgekeurde) entry,
 *  5. equity bijwerken, "snapshot" event, staat opslaan.
 *
 * De engine houdt in beide modi een eigen administratie (cash, posities). In
 * live mode blijft cash + inleg van open posities binnen de kapitaallimiet
 * (`startingCapital`; afgeroomde winst en kapitaal dat terugging bij een lagere
 * limiet zijn opnames, geen verlies: resultaat = equity + alles wat eruit ging −
 * ingelegd kapitaal) en worden er pas echte orders geplaatst na `arm()`.
 *
 * Veiligheid:
 *  - Stop/noodstop hogen `stopGen` op: een lopende tick opent daarna geen posities meer.
 *    Tijdens een noodstop zijn armen, starten en afschrijven geblokkeerd; hij eindigt
 *    altijd ontwapend en gestopt.
 *  - Staat de bot stil, dan ververst een lichte koersbewaking (`startPriceMonitor`,
 *    aangezet door main.ts) alleen koersen en equity — geen beslissingen of orders.
 *    Een equity-punt wordt nooit vastgelegd zolang een open positie nog geen echte koers heeft.
 *  - Een live koop met onbekende uitkomst pauzeert ALLE nieuwe entries (opgeslagen)
 *    tot `broker.lookupOrder` (optioneel) hem terugvindt, Bitvavo hem 3 ticks op rij
 *    niet kent én er genoeg tijd verstreken is (≥ max(60 s, 3 × pollMs)), of de
 *    gebruiker `acknowledgeUnknownOrders()` aanroept.
 *  - Een live verkoop met onbekende uitkomst wordt ook onthouden (opgeslagen): voor
 *    die positie gaat er geen tweede verkooporder uit tot de uitkomst bekend is.
 *  - Een verkoop onder het beursminimum wordt niet verstuurd; na een weigering
 *    "ONVERKOOPBAAR" van de broker (bijv. Bitvavo 217) pas automatisch opnieuw bij ≥ 1%
 *    meer waarde en hooguit één keer per 5 minuten (handmatig sluiten/noodstop: meteen).
 *    De positie is dan "onverkoopbaar" (zichtbaar in de snapshot, bepaald tegen de
 *    actuele koers) tot de waarde herstelt, of de gebruiker hem afschrijft
 *    (`writeOffPosition`, beslist op een verse koers en — live — een vers saldo).
 *  - Coins die niet meer op Bitvavo staan worden pas na twee waarnemingen (twee
 *    ticks, of bij handmatig sluiten twee saldo-opvragingen) als gesloten geboekt.
 *  - Per markt wordt dezelfde candle niet twee keer verhandeld (ook niet na een
 *    herstart of een gewijzigde marktlijst).
 *  - De dagelijkse verlieslimiet geldt tot de dagwissel.
 *  - Een onbruikbaar statusbestand blokkeert armen tot `acknowledgeStateRecovery()`.
 *
 * v2 — veel munten (tot 400, zie docs/ARCHITECTURE.md "v2"):
 *  - Actieve markten: zelfgekozen lijst, of (auto) elk uur de meest verhandelde munten
 *    (`selectUniverse`); alleen actieve markten mogen gekocht worden. Markten met een
 *    positie worden altijd elke tick verwerkt (exits, stops).
 *  - Per candle van het interval is er een "ronde": elke actieve markt wordt één keer
 *    beoordeeld (hooguit `SCAN_BATCH_PER_TICK` per tick, candles parallel ophalen maar
 *    alles daarna op volgorde verwerken). Koopsignalen worden kandidaten; als de ronde
 *    rond is (of na `ENTRY_ROUND_MAX_WAIT_MS`) gaan de sterkste eerst, langs het
 *    trendfilter en de spreadlimiet, en dan door de bestaande `tryEntry`.
 *  - Koersen van alle markten komen (als de feed het kan) uit één verzoek (`getPrices`).
 *  - Open posities gaan voor: hun candles worden elke tick als eerste opgehaald (met
 *    voorrang op de publieke rate limit), optionele gegevens (muntkeuze, tickers,
 *    marktfilter, markten beoordelen, orderboek) geven snel op en wachten nooit op de
 *    rate limit, het beoordelen van markten heeft een tijdsbudget per tick, en duurt een
 *    tick toch lang, dan worden de stops tussendoor opnieuw gecontroleerd.
 */
import { randomUUID } from "node:crypto";
import { EventEmitter } from "node:events";
import {
  INTERVALS,
  INTERVAL_MS,
  type AccountSnapshot,
  type AccountState,
  type Balance,
  type Broker,
  type Candle,
  type EngineConfig,
  type EngineSnapshot,
  type EnsembleConfig,
  type EnsembleDecision,
  type EntryPlan,
  type EquityPoint,
  type ExitReason,
  type HaltStatus,
  type Interval,
  type KillResult,
  type LogEntry,
  type LogLevel,
  type MarketDataFeed,
  type MarketFilterView,
  type MarketInfo,
  type MarketOrderRequest,
  type OpenPositionView,
  type OrderBook,
  type OrderResult,
  type PersistedState,
  type Position,
  type PositionUpdate,
  type RadarRow,
  type RadarStatus,
  type RiskConfig,
  type RiskManagerLike,
  type ScanProgress,
  type ServerEvent,
  type ServerEventType,
  type Ticker24h,
  type Trade,
  type TradingMode,
  type TrendFilterConfig,
  type UniverseConfig,
  type UniverseView,
  TREND_FILTER_INTERVALS,
} from "../core/types";
import {
  DEFAULT_TREND_FILTER,
  DEFAULT_UNIVERSE_CONFIG,
  EXCHANGE_MIN_ORDER_QUOTE,
  MARKET_FILTER_MARKET,
  MAX_MARKETS,
} from "../core/defaults";
import { closedCandles, dayKey, newId } from "../core/util";
import type { FeedRequestOptions } from "../data/bitvavoFeed";
import { roundAmount } from "../exchange/precision";
import { RiskManager } from "../risk/riskManager";
import { runEnsemble } from "../strategies/ensemble";
import { getStrategy, isStrategyId, resolveParams } from "../strategies/registry";
import {
  describeTrend,
  trendCandlesNeeded,
  trendFilterActive,
  trendGate,
  trendStateAt,
  type TrendGateResult,
} from "../strategies/trendFilter";
import {
  decisionSummary,
  entryReasonText,
  errorMessage,
  EXIT_REASON_LABELS,
  exitReasonLabel,
  fmtAmount,
  fmtEur,
  fmtNameList,
  fmtPct2,
  fmtPrice,
  fmtSignedEur,
  fmtSignedPct,
} from "./format";
import { rankCandidates, relativeStrengthPct, type EntryCandidate } from "./ranking";
import type { StateStore } from "./stateStore";
import { selectUniverse, spreadAboveLimit, tickerSpreadPct, type UniverseSelection } from "./universe";

export type DecideFn = (market: string, candles: Candle[], cfg: EnsembleConfig) => EnsembleDecision[];
export type CreateRiskFn = (cfg: RiskConfig, interval: Interval) => RiskManagerLike;

export interface EngineDeps {
  feed: MarketDataFeed;
  broker: Broker;
  config: EngineConfig;
  mode: TradingMode;
  store?: StateStore;
  now?: () => number;
  /** paper: startkapitaal; live: kapitaallimiet in EUR */
  startingCapital: number;
  decide?: DecideFn;
  createRisk?: CreateRiskFn;
}

type EventPayloads = { [E in ServerEvent as E["type"]]: E["data"] };

const MAX_LOGS = 150;
const MAX_TRADES_KEPT = 1000;
const MAX_TRADES_SNAPSHOT = 200;
const MAX_EQUITY_POINTS = 2000;
const EQUITY_POINT_MS = 60_000;
const MARKETS_REFRESH_MS = 60 * 60_000;
const WARN_THROTTLE_MS = 5 * 60_000;
const SELL_ERROR_THROTTLE_MS = 60_000;
const MIN_POLL_MS = 10;
/** Regimedetectie: EMA50 + helling over 10 candles / ATR-gemiddelde over 50 */
const REGIME_WARMUP_CANDLES = 64;
/** Extra candles boven de warmup zodat EMA's/ADX (SMA-gestart) uitgeconvergeerd zijn */
const WARMUP_BUFFER_CANDLES = 150;
/** Bitvavo levert hooguit 1440 candles per request */
const MAX_FETCH_CANDLES = 1440;
/** Aandeel van de positie dat op Bitvavo moet staan; daaronder is de positie "weg" */
const GONE_FRACTION = 0.01;
/** Zelfde marge als LiveBroker: tot 5% minder saldo = afronding/fee, verkoop wat er is */
const MAX_SELL_SHORTFALL = 0.05;
/** Zo vaak op rij (in verschillende ticks) moet Bitvavo een order met onbekende uitkomst "niet kennen" */
const NOT_FOUND_CONFIRMATIONS = 3;
/**
 * En minstens zo lang (ms) na het moment dat de uitkomst onbekend werd (of 3 × pollMs
 * als dat langer is): snel Stop/Start of herstarten mag die conclusie niet versnellen.
 */
const NOT_FOUND_MIN_WAIT_MS = 60_000;
/** Voorvoegsel waarmee de brokers een verkoop onder het beursminimum weigeren */
const UNSELLABLE_PREFIX = "ONVERKOOPBAAR";
/**
 * Hysterese rond het beursminimum: na een weigering "ONVERKOOPBAAR" (bijv. Bitvavo 217)
 * verstuurt de bot een verkoop pas automatisch opnieuw als de positie minstens 1% meer
 * waard is dan max(geweigerde waarde, minimum); "weer verkoopbaar" geldt pas bij ≥ 1%
 * boven het minimum. Zo geeft een koers die rond €5 schommelt geen stroom orders/meldingen.
 */
const UNSELLABLE_HYSTERESIS = 1.01;
/** Na een weigering "ONVERKOOPBAAR" hooguit één automatische nieuwe poging per 5 minuten per positie */
const REFUSAL_RETRY_MS = 5 * 60_000;
/** Versie van de rendementsadministratie in het statusbestand (2 = startequity = ingelegd kapitaal) */
const LEDGER_VERSION = 2;
/** Oudere bestanden (ronde 2) kapten start- en dag-startequity af op 1e-9 */
const OLD_LEDGER_CLAMP = 1e-6;
/** Reden in KillResult / lastCloseFailure voor een positie die intussen is afgeschreven */
const WRITTEN_OFF_REASON = "afgeschreven: er is niets verkocht, de coins staan nog op je account";

// ── v2: veel munten ──
/** Zoveel candle-verzoeken tegelijk (alleen het ophalen; verwerken gaat op volgorde) */
export const SCAN_CONCURRENCY = 4;
/** Hooguit zoveel markten (zonder positie) per tick beoordelen */
export const SCAN_BATCH_PER_TICK = 80;
/** Uiterlijk zo lang na het begin van een ronde worden de kandidaten tóch verwerkt */
export const ENTRY_ROUND_MAX_WAIT_MS = 180_000;
/** 24h-tickers (24u-verandering, volume, spread) hooguit zo vaak ophalen */
export const TICKERS_REFRESH_MS = 60_000;
/** Automatische muntkeuze zo vaak opnieuw maken */
export const UNIVERSE_REFRESH_MS = 3_600_000;
/** Boven zoveel actieve markten bevat de snapshot niet meer álle beslissingen */
export const SNAPSHOT_DECISIONS_LIMIT = 40;
/** Trendcandles (marktfilter / muntfilter): na een mislukte poging hooguit zo vaak opnieuw */
export const TREND_RETRY_MS = 300_000;
/** Candles van een markt ophalen mislukt: pas na zo lang opnieuw proberen */
export const FETCH_RETRY_MS = 60_000;
/**
 * Zonder `feed.getPrices` (één verzoek voor alle koersen) houdt de bot de koersen van
 * zoveel actieve markten per tick vers via hun candles (zoals vóór v2), net als de
 * koersbewaking terwijl de bot stilstaat.
 */
const PRICE_FALLBACK_MARKETS = 40;
/** Opgehaald binnen zoveel ms na het sluiten van de candle zonder die candle: één nieuwe poging */
const LATE_CANDLE_WINDOW_MS = 30_000;
/** Opgeslagen automatische muntkeuze bij een herstart alleen gebruiken als hij jonger is dan dit */
const AUTO_UNIVERSE_MAX_AGE_MS = 24 * 3_600_000;
/** Zoveel mislukte markten per tick nog afzonderlijk melden; daarboven één samenvattende regel */
const FEED_LOG_DETAIL_MAX = 3;
/**
 * Het beoordelen van markten start geen nieuwe candle-verzoeken meer als het al zo lang
 * (ms, of korter: pollMs) bezig is: de rest komt de volgende tick (trage beurs, veel munten).
 */
export const SCAN_TIME_BUDGET_MS = 10_000;
/**
 * Duurt een tick langer dan dit (ms, of korter: pollMs), dan controleert de bot de stops van
 * open posities tussendoor opnieuw (één verzoek voor alle koersen), zodat een trage beurs of
 * veel munten de stop-loss niet vertragen.
 */
export const HELD_RECHECK_MS = 10_000;
/** Koersen van alle markten ophalen mislukt: pas na zo lang (ms) opnieuw (de posities gebruiken dan hun candles) */
export const BULK_RETRY_MS = 30_000;
/** Geschatte duur (ms) van een tick met veel munten, voor de waarschuwing "te veel munten voor dit interval" */
const EST_TICK_MS = 3_000;
/**
 * Optionele gegevens (markten beoordelen, tickers, muntkeuze, trendfilter, spread): snel
 * opgeven (BitvavoFeed: geen herhalingen, korte timeout, niet wachten op de rate limit).
 * Andere feeds negeren dit extra argument.
 */
const FAST: FeedRequestOptions = { fast: true };
/** Koersen en candles van open posities: ook snel, maar mag een deel van de publieke reserve gebruiken. */
const POSITION: FeedRequestOptions = { fast: true, priority: true };
/** Trendfilter zonder instellingen = uit */
const NO_TREND_FILTER: TrendFilterConfig = {
  market: false,
  coin: false,
  interval: DEFAULT_TREND_FILTER.interval,
  period: DEFAULT_TREND_FILTER.period,
};
/** Basis bij een gedeeltelijke `universe` terwijl er nog geen was (= zelf kiezen) */
const MANUAL_UNIVERSE: UniverseConfig = {
  mode: "manual",
  count: DEFAULT_UNIVERSE_CONFIG.count,
  minVolumeEur: DEFAULT_UNIVERSE_CONFIG.minVolumeEur,
};

/** "Niet gevonden"-waarnemingen bij Bitvavo voor een order met onbekende uitkomst */
interface NotFoundTrack {
  /** Zo vaak op rij (in verschillende ticks) meldde Bitvavo dat de order niet bestaat */
  nullCount?: number;
  /** Tijdstip van de laatst meegetelde "niet gevonden" */
  nullAt?: number;
}
/** Wat er van een (deels) gevulde order al geboekt is (cumulatief, zoals de beurs het meldt) */
interface BookedFill {
  /** Gevulde hoeveelheid base */
  bookedAmount?: number;
  /** Bruto EUR van dat deel (excl. fee) */
  bookedQuote?: number;
  /** Fee van dat deel */
  bookedFee?: number;
}
/** Kooporder met onbekende uitkomst (+ engine-eigen velden) */
type UnknownBuy = NonNullable<PersistedState["unknownOrders"]>[number] & NotFoundTrack & BookedFill;
/** Verkooporder met onbekende uitkomst: voor deze positie gaat er geen tweede verkoop uit. */
interface UnknownSell extends NotFoundTrack, BookedFill {
  clientOrderId: string;
  positionId: string;
  market: string;
  /** Gevraagde hoeveelheid base */
  amount: number;
  /** Exit-reden waarmee een (alsnog) gevulde verkoop geboekt wordt */
  reason: ExitReason;
  at: number;
}
/** Het nieuwe (nog niet geboekte) deel van een order, plus de cumulatieve totalen */
interface FillIncrement {
  amount: number;
  /** Bruto EUR van het nieuwe deel */
  quote: number;
  fee: number;
  /** Prijs van het nieuwe deel (bruto / hoeveelheid) */
  price: number;
  totalAmount: number;
  totalQuote: number;
  totalFee: number;
}
/**
 * Opgeslagen staat met engine-eigen extra velden. types.ts blijft ongewijzigd;
 * oudere bestanden zonder deze velden laden gewoon.
 */
type PersistedStateExt = PersistedState & {
  unknownSells?: UnknownSell[];
  /** Live: vandaag (account.dayKey) afgeroomde winst — voor het dagrendement */
  skimmedToday?: number;
  /**
   * {@link LEDGER_VERSION}. Ontbreekt bij oudere bestanden: die verlaagden
   * start- en dag-startequity met het afgeroomde bedrag.
   */
  ledgerVersion?: number;
  /** Live: kapitaal erbij door een hogere limiet (na de start), totaal en vandaag */
  capitalAdded?: number;
  addedToday?: number;
  /** Live: kapitaal teruggegaan door een lagere limiet, totaal en vandaag */
  capitalReturned?: number;
  returnedToday?: number;
  /** Live: kapitaal dat bij een lagere limiet nog in open posities vastzat */
  capitalPending?: number;
};
type StateRecovery = NonNullable<PersistedState["stateRecovery"]>;
/**
 * Een positie die (nu) niet verkocht kan worden, zodat dat één keer per episode
 * gemeld wordt en een weigering van de broker onthouden blijft.
 * "engine" = eigen minimumcontrole; "broker" = de broker weigerde met "ONVERKOOPBAAR".
 */
interface UnsellableRec {
  kind: "engine" | "broker";
  reason: string;
  /** Hoeveelheid die bij de laatste poging echt verkocht kon worden (live: saldo kan iets lager zijn) */
  amount?: number;
  /** broker: hoogste positiewaarde waarbij de broker weigerde */
  value?: number;
  /** broker: tijdstip van de laatste weigering (voor hooguit één automatische poging per 5 minuten) */
  at?: number;
}
/** Wat de laatste saldo-opvraging over één munt zegt */
interface Holding {
  avail: number;
  inOrder: number;
  held: number;
}

/** Resultaat van candles ophalen voor één markt (gooit nooit) */
type CandleFetch =
  | { market: string; interval: Interval; ok: true; candles: Candle[] }
  | {
      market: string;
      interval: Interval;
      ok: false;
      error: string;
      /** Overgeslagen wegens de rate limit (niet verstuurd of 429): niet als mislukt tellen */
      rateLimited?: boolean;
    };

/**
 * De feed met het optionele laatste argument {@link FeedRequestOptions} (BitvavoFeed).
 * Andere feeds negeren dat extra argument.
 */
interface FeedWithOptions {
  getMarkets(req?: FeedRequestOptions): Promise<MarketInfo[]>;
  getCandles(market: string, interval: Interval, limit: number, req?: FeedRequestOptions): Promise<Candle[]>;
  getTickers24h(markets?: string[], req?: FeedRequestOptions): Promise<Ticker24h[]>;
  getPrice(market: string, req?: FeedRequestOptions): Promise<number>;
  getOrderBook(market: string, depth?: number, req?: FeedRequestOptions): Promise<OrderBook>;
  getPrices?(req?: FeedRequestOptions): Promise<Record<string, number>>;
}

/** Weigerde de beurs (of de client vooraf) het verzoek wegens de rate limit? */
function isRateLimited(err: unknown): boolean {
  return !!err && typeof err === "object" && (err as { isRateLimit?: unknown }).isRateLimit === true;
}

/** Per markt: wanneer (voor welke ronde) de candles voor het laatst zijn opgehaald */
interface ScanState {
  interval: Interval;
  /** Ronde (openingstijd van de nieuwste gesloten candle) waarvoor opgehaald */
  round: number;
  /** ok = klaar voor deze ronde; retry = nog één poging (candle ontbrak vlak na het sluiten); error = mislukt */
  status: "ok" | "retry" | "error";
  /** Tijdstip van de laatste poging */
  at: number;
  /** Tick van de laatste poging (een nieuwe poging pas in een latere tick) */
  seq: number;
  /** De ene extra poging voor `round` is al gebruikt */
  retried: boolean;
  /** De nieuwste gesloten candle was ouder dan de ronde (weinig handel) */
  stale: boolean;
  error?: string;
}

/** De lopende ronde (per candle van het engine-interval) */
interface RoundState {
  key: number;
  startedAt: number;
  completedAt: number | null;
  /** Aantal koopkandidaten dat in deze ronde is ontstaan */
  candidates: number;
  /** Marktfilter-blokkades van deze ronde al gelogd */
  filterLogged: boolean;
}

/** Radar-status uit de kansenronde (geldt alleen voor die ronde) */
interface RoundNote {
  round: number;
  status: "candidate" | "blocked";
  note?: string;
  rank?: number;
}

/** Gecachete trendcandles (marktfilter of muntfilter) */
interface TrendCache {
  /** `${interval}|${period}`: bij andere instellingen opnieuw ophalen */
  key: string;
  /** Gesloten candles op het moment van ophalen, oplopend */
  candles: Candle[];
  /** Laatste gelukte ophaalmoment */
  fetchedAt: number | null;
  /** Laatste poging (gelukt of niet) */
  attemptAt: number | null;
  /** Fout van de laatste poging (null = gelukt) */
  error: string | null;
}

/** Laatste gelukte automatische muntkeuze */
interface AutoSelection {
  markets: string[];
  at: number;
  /** Instellingen waarmee gekozen is (bij een wijziging opnieuw kiezen) */
  key: string;
  eligible: number;
  excluded: number;
}

/** Hoe een koopkandidaat afliep in `tryEntry` */
type EntryOutcome = "opened" | "would-buy" | "unknown" | "rejected";

function isNum(v: unknown): v is number {
  return typeof v === "number" && Number.isFinite(v);
}

function sameSet(a: readonly string[], b: readonly string[]): boolean {
  if (a.length !== b.length) return false;
  const s = new Set(a);
  return b.every((m) => s.has(m));
}

function uniq(list: readonly string[]): string[] {
  return [...new Set(list)];
}

/** Beschikbaar + in orders van één munt in een saldolijst (0 als hij ontbreekt). */
function heldIn(balances: readonly Balance[], base: string): number {
  const b = balances.find((x) => x.symbol === base);
  if (!b) return 0;
  return (isNum(b.available) ? b.available : 0) + (isNum(b.inOrder) ? b.inOrder : 0);
}

function trendKey(tf: TrendFilterConfig): string {
  return `${tf.interval}|${tf.period}`;
}

/**
 * Voert `fn` uit voor elk item met hooguit `limit` tegelijk (alleen I/O). Stopt met
 * nieuwe items zodra `keepGoing()` false is; niet gestarte items blijven `undefined`.
 * `fn` mag niet gooien.
 */
async function mapLimit<T, R>(
  items: readonly T[],
  limit: number,
  keepGoing: () => boolean,
  fn: (item: T) => Promise<R>,
): Promise<(R | undefined)[]> {
  const out: (R | undefined)[] = new Array(items.length).fill(undefined);
  let next = 0;
  const worker = async (): Promise<void> => {
    while (next < items.length && keepGoing()) {
      const i = next++;
      out[i] = await fn(items[i]);
    }
  };
  const n = Math.max(1, Math.min(limit, items.length));
  await Promise.all(Array.from({ length: n }, worker));
  return out;
}

/** Gooit een Nederlandse fout bij een ongeldige muntkeuze-instelling (ontbreken = zelf kiezen). */
function validateUniverse(u: UniverseConfig | undefined): void {
  if (u === undefined || u === null) return;
  if (typeof u !== "object") throw new Error("Ongeldige instelling voor de muntkeuze");
  if (u.mode !== "manual" && u.mode !== "auto") {
    throw new Error(`Ongeldige muntkeuze: ${String(u.mode)} (kies "manual" of "auto")`);
  }
  if (!Number.isInteger(u.count) || u.count < 1 || u.count > MAX_MARKETS) {
    throw new Error(`Het aantal munten moet een geheel getal van 1 tot en met ${MAX_MARKETS} zijn`);
  }
  if (!isNum(u.minVolumeEur) || u.minVolumeEur < 0) {
    throw new Error("Het minimale 24-uursvolume moet 0 of een positief bedrag in EUR zijn");
  }
}

/** Gooit een Nederlandse fout bij een ongeldig trendfilter (ontbreken = geen filter). */
function validateTrendFilter(tf: TrendFilterConfig | undefined): void {
  if (tf === undefined || tf === null) return;
  if (typeof tf !== "object") throw new Error("Ongeldige instelling voor het trendfilter");
  if (typeof tf.market !== "boolean" || typeof tf.coin !== "boolean") {
    throw new Error("Trendfilter: marktfilter en muntfilter moeten aan of uit staan");
  }
  if (!TREND_FILTER_INTERVALS.includes(tf.interval)) {
    throw new Error(`Trendfilter: ongeldige tijdschaal ${String(tf.interval)} (kies 4h of 1d)`);
  }
  if (!Number.isInteger(tf.period) || tf.period < 5 || tf.period > 200) {
    throw new Error("Trendfilter: de periode moet een geheel getal van 5 tot en met 200 zijn");
  }
}

/** "Geen koop BTC-EUR (score …): reden" → "Reden" (korte uitleg voor de munten-radar). */
function shortRejection(message: string): string {
  const s = message.replace(/^Geen koop \S+(?: \([^)]*\))?:\s*/, "").trim();
  return s ? s.charAt(0).toUpperCase() + s.slice(1) : message;
}

function cloneConfig(cfg: EngineConfig): EngineConfig {
  return structuredClone(cfg);
}

function sameList(a: readonly string[], b: readonly string[]): boolean {
  return a.length === b.length && a.every((v, i) => v === b[i]);
}

function splitMarket(market: string, info?: MarketInfo): { base: string; quote: string } {
  if (info?.base && info?.quote) return { base: info.base, quote: info.quote };
  const [base = market, quote = "EUR"] = market.split("-");
  return { base, quote };
}

/** Alleen geldige candles, oplopend op tijd, zonder dubbele tijden. */
function sanitizeCandles(candles: unknown): Candle[] {
  if (!Array.isArray(candles)) return [];
  const ok = (candles as Candle[]).filter(
    (c) =>
      c &&
      isNum(c.time) &&
      isNum(c.open) &&
      isNum(c.high) &&
      isNum(c.low) &&
      isNum(c.close) &&
      c.close > 0,
  );
  let sorted = true;
  for (let i = 1; i < ok.length; i++) {
    if (ok[i].time <= ok[i - 1].time) {
      sorted = false;
      break;
    }
  }
  if (sorted) return ok;
  const byTime = new Map<number, Candle>();
  for (const c of ok) byTime.set(c.time, c);
  return [...byTime.values()].sort((a, b) => a.time - b.time);
}

/**
 * Aantal gesloten candles dat de ingeschakelde strategieën (plus regimedetectie)
 * nodig hebben voordat ze iets anders dan "hold" kunnen geven.
 */
export function requiredWarmupCandles(ens: EnsembleConfig | undefined): number {
  let w = REGIME_WARMUP_CANDLES;
  const enabled = Array.isArray(ens?.enabled) ? ens.enabled : [];
  for (const id of enabled) {
    if (!isStrategyId(id)) continue;
    try {
      const n = getStrategy(id).warmup(resolveParams(id, ens?.params?.[id]));
      if (isNum(n) && n > w) w = n;
    } catch {
      // onbekende parameters: dan geldt het minimum
    }
  }
  return Math.ceil(w);
}

/**
 * `limit` voor getCandles per tick: genoeg gesloten candles voor de warmup van
 * de ingeschakelde strategieën (plus buffer), met historyCandles als
 * ondergrens, plus 1 voor de candle die nog in vorming is.
 */
export function candlesToFetch(cfg: Pick<EngineConfig, "historyCandles" | "ensemble">): number {
  const need = Math.max(cfg.historyCandles, requiredWarmupCandles(cfg.ensemble) + WARMUP_BUFFER_CANDLES);
  return Math.min(MAX_FETCH_CANDLES, need + 1);
}

function freshAccount(startingCapital: number, now: number): AccountState {
  return {
    startingEquity: startingCapital,
    cashQuote: startingCapital,
    equity: startingCapital,
    dayStartEquity: startingCapital,
    dayKey: dayKey(now),
    realizedPnl: 0,
    realizedPnlToday: 0,
    unrealizedPnl: 0,
    feesPaid: 0,
    tradesToday: 0,
    lastLossAt: {},
  };
}

function sanitizeAccount(raw: unknown, fallback: AccountState): AccountState {
  const out: AccountState = { ...fallback, lastLossAt: {} };
  if (!raw || typeof raw !== "object") return out;
  const r = raw as Record<string, unknown>;
  const numKeys = [
    "startingEquity",
    "cashQuote",
    "equity",
    "dayStartEquity",
    "realizedPnl",
    "realizedPnlToday",
    "unrealizedPnl",
    "feesPaid",
    "tradesToday",
  ] as const;
  for (const k of numKeys) {
    if (isNum(r[k])) out[k] = r[k] as number;
  }
  if (typeof r.dayKey === "string" && r.dayKey) out.dayKey = r.dayKey;
  if (r.lastLossAt && typeof r.lastLossAt === "object") {
    for (const [m, t] of Object.entries(r.lastLossAt as Record<string, unknown>)) {
      if (isNum(t)) out.lastLossAt[m] = t;
    }
  }
  return out;
}

function normalizePosition(raw: unknown): Position | null {
  if (!raw || typeof raw !== "object") return null;
  const p = raw as Partial<Position>;
  if (typeof p.id !== "string" || !p.id || typeof p.market !== "string" || !p.market) return null;
  if (!isNum(p.entryPrice) || p.entryPrice <= 0) return null;
  if (!isNum(p.amount) || p.amount <= 0) return null;
  if (!isNum(p.entryTime)) return null;
  if (!isNum(p.stopPrice) || !isNum(p.takeProfitPrice)) return null;
  const costQuote = isNum(p.costQuote) && p.costQuote > 0 ? p.costQuote : p.entryPrice * p.amount;
  return {
    id: p.id,
    market: p.market,
    side: "long",
    entryTime: p.entryTime,
    entryPrice: p.entryPrice,
    amount: p.amount,
    costQuote,
    entryFeeQuote: isNum(p.entryFeeQuote) ? p.entryFeeQuote : 0,
    stopPrice: p.stopPrice,
    initialStopPrice: isNum(p.initialStopPrice) ? p.initialStopPrice : p.stopPrice,
    takeProfitPrice: p.takeProfitPrice,
    highestPrice: isNum(p.highestPrice) ? p.highestPrice : p.entryPrice,
    candlesHeld: isNum(p.candlesHeld) && p.candlesHeld >= 0 ? Math.floor(p.candlesHeld) : 0,
    entryReason: typeof p.entryReason === "string" ? p.entryReason : "",
    ...(typeof p.orderId === "string" ? { orderId: p.orderId } : {}),
  };
}

/** Opgeslagen "al geboekt"-velden van een order met onbekende uitkomst (alleen geldige). */
function bookedFill(raw: BookedFill): BookedFill {
  return {
    ...(isNum(raw.bookedAmount) ? { bookedAmount: raw.bookedAmount } : {}),
    ...(isNum(raw.bookedQuote) ? { bookedQuote: raw.bookedQuote } : {}),
    ...(isNum(raw.bookedFee) ? { bookedFee: raw.bookedFee } : {}),
  };
}

/** Opgeslagen "niet gevonden"-telling van een order met onbekende uitkomst (alleen geldige). */
function notFoundTrack(raw: NotFoundTrack): NotFoundTrack {
  return {
    ...(isNum(raw.nullCount) && raw.nullCount > 0 ? { nullCount: Math.floor(raw.nullCount) } : {}),
    ...(isNum(raw.nullAt) ? { nullAt: raw.nullAt } : {}),
  };
}

export class TradingEngine extends EventEmitter {
  readonly mode: TradingMode;
  private readonly feed: MarketDataFeed;
  private readonly broker: Broker;
  private readonly store: StateStore | undefined;
  private readonly nowFn: () => number;
  private readonly decideFn: DecideFn;
  private readonly createRiskFn: CreateRiskFn;

  private startingCapital: number;
  private config: EngineConfig;
  private risk: RiskManagerLike;
  private account: AccountState;
  private positions: Position[] = [];
  /** Chronologisch (oudste eerst) */
  private trades: Trade[] = [];
  private equityHistory: EquityPoint[] = [];
  private decisions: Record<string, EnsembleDecision> = {};
  private prices: Record<string, number> = {};
  /** Chronologisch (oudste eerst) */
  private logs: LogEntry[] = [];
  private halted: HaltStatus = { halted: false };

  private running = false;
  private armed = false;
  private startedAt: number | null = null;
  private lastTickAt: number | null = null;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private tickInFlight: Promise<void> | null = null;
  /** Serialiseert alle state-muterende async operaties (tick, close, kill). */
  private lockChain: Promise<unknown> = Promise.resolve();
  /** Wordt opgehoogd bij resetPaper; lopende orders van vóór de reset worden genegeerd. */
  private epoch = 0;
  private restored = false;

  private marketInfo = new Map<string, MarketInfo>();
  private marketsFetchedAt: number | null = null;
  /** market → openingstijd van de laatst geëvalueerde gesloten candle */
  private lastEvaluated = new Map<string, number>();
  private lastAtr = new Map<string, number>();
  /** positie-id → openingstijd van de laatst verwerkte gesloten candle */
  private posCursor = new Map<string, number>();
  /** positie-id → exit-reden die nog uitgevoerd moet worden (bijv. na een afgewezen verkoop) */
  private pendingExit = new Map<string, ExitReason>();
  /** market → candle-tijd waarvoor de afwijzingsredenen al gelogd zijn */
  private rejectLogged = new Map<string, number>();
  private throttle = new Map<string, { message: string; at: number }>();
  /**
   * Live VERKOOPorders met onbekende uitkomst (clientOrderId → gegevens). Zolang
   * een positie er één heeft, gaat er voor die positie geen nieuwe verkoop uit
   * (anders kan de bot twee keer verkopen, bijv. eigen coins van de gebruiker).
   * Wordt opgeslagen; opgehelderd via `broker.lookupOrder` of — zonder lookup —
   * zodra Bitvavo geen coins van die munt meer in een openstaande order heeft.
   */
  private unknownSells = new Map<string, UnknownSell>();
  /**
   * positie-id → laatst gemelde reden waarom een verkoop niet kon (onder het
   * beursminimum), zodat de melding één keer per episode gelogd wordt, niet elke tick.
   * "engine" = eigen controle, met de hoeveelheid die echt verkocht kon worden
   * (`amount`: live kan het saldo op Bitvavo iets lager zijn dan de positie);
   * "broker" = de broker weigerde met "ONVERKOOPBAAR" bij (hoogste) positiewaarde
   * `value`. Een weigering van de broker blijft staan als de waarde intussen onder het
   * minimum duikt; hij verdwijnt pas bij een gelukte verkoop (zie {@link UNSELLABLE_HYSTERESIS}).
   * Of een positie NU onverkoopbaar is, wordt altijd tegen de actuele koers bepaald
   * ({@link unsellableNow}).
   */
  private unsellable = new Map<string, UnsellableRec>();
  /**
   * positie-id → tick waarin de coins voor het eerst (deels) weg leken. Pas bij
   * een tweede waarneming in een latere tick wordt er geboekt.
   */
  private vanishedSeen = new Map<string, { seq: number; afterUnknownSell: boolean }>();
  /** Volgnummer van de huidige tick (voor waarnemingen "in twee ticks") */
  private tickSeq = 0;
  /** Reden waarom de laatste exitPosition-aanroep de positie niet (volledig) sloot */
  private exitFailure: string | null = null;
  /** Aantal lopende broker.placeMarketOrder-aanroepen */
  private ordersInFlight = 0;
  /** Was de bot actief toen de lopende tick werd aangevraagd? (dan moet hij dat blijven om te kopen) */
  private tickWhileRunning = false;
  /**
   * Live KOOPorders met onbekende uitkomst (clientOrderId → gegevens). Zolang er
   * één is, worden er nergens nieuwe posities geopend: het geld kan al besteed
   * zijn. Wordt opgeslagen; alleen opgeheven als Bitvavo de order teruggeeft
   * (lookupOrder) of als de gebruiker het expliciet bevestigt.
   */
  private unknownBuys = new Map<string, UnknownBuy>();
  /** market → laatst geëvalueerde candle van vóór een herstart (daarop geen nieuwe entry) */
  private evaluatedBeforeRestart = new Map<string, number>();
  /** Dag waarop de dagelijkse verlieslimiet geraakt is: tot de dagwissel geen nieuwe trades */
  private haltedDayKey: string | null = null;
  /** Dag waarop de dagwinst is vastgezet (winstgrens geraakt): tot de dagwissel geen nieuwe aankopen */
  private targetDayKey: string | null = null;
  /** Dag waarop het dagdoel gehaald is: vanaf dan bewaakt de bot de winstgrens */
  private targetArmedDayKey: string | null = null;
  /**
   * Live: cumulatief boven de kapitaallimiet gehouden WINST ("afgeroomd"). Samen met
   * `capitalReturned` = alles wat netto uit het handelsbudget is gegaan; ingelegd
   * kapitaal = `account.startingEquity` (startkapitaal + verhogingen van de limiet).
   */
  private skimmedQuote = 0;
  /** Live: deel van `skimmedQuote` dat vandaag (sinds de dagwissel) is afgeroomd */
  private skimmedToday = 0;
  /** Live: kapitaal dat door een VERLAAGDE limiet uit het budget terugging (geen winst) */
  private capitalReturned = 0;
  /** Live: deel van `capitalReturned` van vandaag */
  private returnedToday = 0;
  /** Live: kapitaal dat na de start bij het budget kwam door een HOGERE limiet */
  private capitalAdded = 0;
  /** Live: deel van `capitalAdded` van vandaag */
  private addedToday = 0;
  /**
   * Live: kapitaal dat bij een verlaagde limiet in open posities vastzat (inleg boven
   * de nieuwe limiet) en bij de verkoop alsnog terug moet — als kapitaal, niet als winst.
   */
  private capitalPending = 0;
  /** Aantal lopende noodstops: zolang > 0 zijn armen, starten en afschrijven geblokkeerd */
  private killsInProgress = 0;
  /** positie-id → aantal lopende (of wachtende) closePosition-aanroepen: dan geen afschrijving */
  private closing = new Map<string, number>();
  /** Posities die afgeschreven zijn (nooit als "gesloten" tellen bij sluiten/noodstop) */
  private writtenOff = new Set<string>();
  /** Koersbewaking terwijl de bot stilstaat (zie {@link startPriceMonitor}) */
  private monitorEnabled = false;
  private monitorTimer: ReturnType<typeof setTimeout> | null = null;
  private monitorRun: Promise<void> | null = null;
  /**
   * Na een gewijzigde kapitaallimiet bij het laden: equity-punt vastleggen zodra
   * elke open positie een echte koers heeft (niet tegen de instapkoers).
   */
  private pendingRebasePoint = false;
  /** Reden waarom de laatste closePosition-aanroep de positie niet (volledig) sloot */
  private closeFailure: string | null = null;
  /** Opgeslagen staat was onbruikbaar: wacht op bevestiging (live: armen geblokkeerd) */
  private stateRecovery: StateRecovery | null = null;
  /**
   * Stop-generatie: stop()/killSwitch() hogen hem op. Een tick die vóór de stop
   * is aangevraagd (tickGen ≠ stopGen) opent geen nieuwe posities meer.
   */
  private stopGen = 0;
  private tickGen = 0;
  private paperBalances: Balance[] | undefined;

  // ── v2: actieve markten, rondes, kansen ──
  /** Laatste gelukte automatische muntkeuze (deze run) */
  private autoSel: AutoSelection | null = null;
  /** Automatische muntkeuze uit het statusbestand (gebruikt tot de eerste eigen keuze, als < 24 uur oud) */
  private persistedAuto: { markets: string[]; at: number } | null = null;
  /** Nieuwe muntkeuze afgedwongen (gewijzigde instellingen) */
  private universeDirty = false;
  private universeAttemptAt: number | null = null;
  private universeNote: string | undefined;
  /** Cache van de actieve lijst bij "zelf kiezen" (per `config.markets`-array) */
  private manualCache: { src: string[]; list: string[] } | null = null;
  private activeSetCache: { list: string[]; set: Set<string> } | null = null;
  /** 24h-tickers per markt (radar, ranglijst) */
  private tickers = new Map<string, Ticker24h>();
  private tickersAt: number | null = null;
  /** Marktfilter: candles van MARKET_FILTER_MARKET op het trendfilter-interval */
  private marketTrend: TrendCache | null = null;
  /** Muntfilter: trendcandles per munt (alleen opgehaald voor koopkandidaten) */
  private coinTrend = new Map<string, TrendCache>();
  /** market → wanneer de candles voor het laatst zijn opgehaald */
  private scanState = new Map<string, ScanState>();
  private round: RoundState | null = null;
  /** Koopkandidaten van de lopende ronde: market → beslissing */
  private pool = new Map<string, EnsembleDecision>();
  /** market → radar-status uit de kansenronde */
  private roundNotes = new Map<string, RoundNote>();
  /** market → laatste reden waarom een koop niet doorging (korte tekst voor de radar) */
  private entryRejection = new Map<string, string>();
  private lastRoundCompletedAt: number | null = null;
  private lastRoundCandidates = 0;
  /** Laatste stop-controle van de open posities (tijdens een tick) */
  private heldCheckedAt: number | null = null;
  /** Laatste mislukte poging om alle koersen op te halen (daarna even niet opnieuw) */
  private bulkFailedAt: number | null = null;
  /** Live: markten die deze run al gecontroleerd zijn op coins die de bot niet beheert (null = nog niet gestart) */
  private unmanagedChecked: Set<string> | null = null;
  /** Live: saldo-opvraging daarvoor mislukt → niet vóór dit tijdstip opnieuw */
  private unmanagedRetryAt: number | null = null;

  constructor(deps: EngineDeps) {
    super();
    if (!deps || !deps.feed || !deps.broker || !deps.config) {
      throw new Error("TradingEngine: feed, broker en config zijn verplicht");
    }
    if (deps.mode !== "paper" && deps.mode !== "live") {
      throw new Error(`Onbekende handelsmodus: ${String(deps.mode)}`);
    }
    if (deps.broker.mode !== deps.mode) {
      throw new Error(
        `Veiligheidsstop: broker-modus (${deps.broker.mode}) komt niet overeen met engine-modus (${deps.mode})`,
      );
    }
    if (!isNum(deps.startingCapital) || deps.startingCapital <= 0) {
      throw new Error(
        deps.mode === "live"
          ? "De kapitaallimiet moet een positief bedrag in EUR zijn"
          : "Het startkapitaal moet een positief bedrag in EUR zijn",
      );
    }
    this.mode = deps.mode;
    this.feed = deps.feed;
    this.broker = deps.broker;
    this.store = deps.store;
    this.nowFn = deps.now ?? (() => Date.now());
    this.decideFn = deps.decide ?? runEnsemble;
    this.createRiskFn = deps.createRisk ?? ((cfg, interval) => new RiskManager(cfg, interval));
    this.startingCapital = deps.startingCapital;
    this.config = cloneConfig(deps.config);
    this.risk = this.createRiskFn(this.config.risk, this.config.interval);
    this.account = freshAccount(this.startingCapital, this.nowFn());
    this.restoreFromStore();
    this.applyBrokerCosts(this.config.risk);
  }

  // ───────────────────────────── Publieke API ─────────────────────────────

  get liveArmed(): boolean {
    return this.mode === "live" && this.armed;
  }

  get isRunning(): boolean {
    return this.running;
  }

  /** True zolang er een order bij de broker loopt (voor een nette afsluiting). */
  get orderInFlight(): boolean {
    return this.ordersInFlight > 0;
  }

  /**
   * Nederlandse reden waarom de laatste `closePosition` de positie niet
   * (volledig) sloot (bijv. onverkoopbaar, afgewezen, uitkomst onbekend), of
   * null als dat wel lukte.
   */
  get lastCloseFailure(): string | null {
    return this.closeFailure;
  }

  async start(): Promise<void> {
    // Een noodstop eindigt altijd met een stilstaande bot: tijdens de noodstop niet starten.
    if (this.killsInProgress > 0) {
      throw new Error(
        "Starten geblokkeerd: noodstop bezig. Wacht tot de noodstop klaar is (de bot eindigt gestopt) en start daarna opnieuw als je dat wilt.",
      );
    }
    if (this.running) return;
    this.restoreFromStore();
    this.applyBrokerCosts(this.config.risk);
    this.running = true;
    // De tick ververst de koersen nu zelf.
    this.clearMonitorTimer();
    this.startedAt = this.nowFn();
    const modeText = this.mode === "live" ? "LIVE" : "paper";
    this.log("info", `Bot gestart (${modeText}, ${this.config.interval}, ${this.marketsDescription()})`);
    if (this.mode === "live" && !this.armed) {
      this.log(
        "warn",
        `Live mode is nog NIET gearmd: de bot evalueert alles maar plaatst geen echte orders tot je hem armt (limiet ${fmtEur(this.startingCapital)})`,
      );
    }
    if (this.unknownBuys.size > 0) this.logUnknownBuysBlocking();
    if (this.unknownSells.size > 0) this.logUnknownSellsPending();
    await this.loadMarkets(true);
    if (this.mode === "live") await this.reconcileLiveBalances();
    // stop()/killSwitch() kan intussen aangeroepen zijn: dan geen tick meer.
    if (!this.running) return;
    await this.tick();
    this.scheduleNext();
  }

  async stop(): Promise<void> {
    const wasRunning = this.running;
    this.running = false;
    // Synchroon (vóór elke await): een lopende tick opent hierna geen posities meer.
    this.stopGen++;
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
    // Wacht tot lopende operaties klaar zijn, zodat de opgeslagen staat definitief is.
    await this.exclusive(async () => {
      // Koopkandidaten en de lopende ronde vervallen (na een herstart begint een nieuwe ronde).
      this.resetRoundState(false);
      await this.persist(true);
    });
    if (wasRunning) this.log("info", "Bot gestopt");
    this.emitSnapshot();
    // Stilstaand: koersen blijven ververst (als main.ts de bewaking aanzette).
    this.scheduleMonitor();
  }

  /**
   * Koersbewaking terwijl de bot NIET draait (vóór de eerste Start, na Stop en na de
   * noodstop): elke pollMs alleen de koersen van de ingestelde markten en van markten
   * met open posities verversen (via de feed), equity/ongerealiseerd resultaat bijwerken
   * en "price" + "snapshot" sturen. Geen beslissingen, geen orders, geen saldo-opvragingen.
   * Ververst meteen één keer, zodat herstelde posities niet (lang) tegen de instapkoers
   * gewaardeerd worden. Zolang de bot draait doet de tick dit en pauzeert de bewaking.
   */
  startPriceMonitor(): Promise<void> {
    this.monitorEnabled = true;
    return this.refreshPricesWhileStopped().finally(() => this.scheduleMonitor());
  }

  /** Zet de koersbewaking uit (bijv. bij het afsluiten). */
  stopPriceMonitor(): void {
    this.monitorEnabled = false;
    this.clearMonitorTimer();
  }

  /** Eén evaluatieronde. Overlappende aanroepen delen dezelfde lopende tick. */
  tick(): Promise<void> {
    if (this.tickInFlight) return this.tickInFlight;
    // Generatie bij het AANVRAGEN: een tick die nog op de lock wacht als de
    // gebruiker op Stop drukt, opent daarna ook geen posities meer.
    const gen = this.stopGen;
    const wasRunning = this.running;
    const p = this.exclusive(async () => {
      this.tickGen = gen;
      this.tickWhileRunning = wasRunning;
      try {
        await this.runTick();
      } catch (err) {
        this.log("error", `Fout tijdens tick: ${errorMessage(err)}`);
      }
      try {
        await this.afterTick();
      } catch (err) {
        this.log("error", `Fout na tick: ${errorMessage(err)}`);
      }
    }).finally(() => {
      if (this.tickInFlight === p) this.tickInFlight = null;
    });
    this.tickInFlight = p;
    return p;
  }

  snapshot(): EngineSnapshot {
    this.updateEquity();
    const now = this.nowFn();
    const active = this.activeMarkets(now);
    return {
      running: this.running,
      mode: this.mode,
      dataSource: this.feed.source,
      liveArmed: this.liveArmed,
      startedAt: this.startedAt,
      lastTickAt: this.lastTickAt,
      config: cloneConfig(this.config),
      account: {
        ...this.account,
        lastLossAt: { ...this.account.lastLossAt },
        dayTargetReached: this.targetArmedDayKey !== null && this.targetArmedDayKey === this.account.dayKey,
      },
      positions: this.positions.map((p) => this.positionView(p)),
      trades: this.trades
        .slice(-MAX_TRADES_SNAPSHOT)
        .reverse()
        .map((t) => ({ ...t })),
      equityHistory: this.equityHistory.map((e) => ({ ...e })),
      decisions: this.snapshotDecisions(active),
      prices: { ...this.prices },
      halted: { ...this.halted },
      logs: this.logs
        .slice(-MAX_LOGS)
        .reverse()
        .map((l) => ({ ...l })),
      unknownOrders: [...this.unknownBuys.values()].map((u) => ({
        market: u.market,
        clientOrderId: u.clientOrderId,
        quoteAmount: u.quoteAmount,
        at: u.at,
      })),
      stateRecovery: this.stateRecovery ? { ...this.stateRecovery } : null,
      skimmedQuote: this.skimmedQuote,
      activeMarkets: [...active],
      radar: this.radarRows(active, now),
      marketFilter: this.marketFilterView(now),
      universe: this.universeView(active, now),
      scan: this.scanProgress(active, now),
    };
  }

  /**
   * Alleen-lezen: alle gesloten trades die de engine bewaart (tot {@link MAX_TRADES_KEPT}
   * = 1000, de oudste vallen daarna af), oudste eerst, als kopieën. De snapshot toont
   * alleen de laatste 200; de bot-wedstrijd telt winst/verlies over deze hele lijst.
   */
  allTrades(): Trade[] {
    return this.trades.map((t) => ({ ...t }));
  }

  /**
   * Laatste beslissing van een markt (ook als die niet in de snapshot staat, bijv. bij
   * meer dan {@link SNAPSHOT_DECISIONS_LIMIT} actieve markten), of null.
   */
  decisionFor(market: string): EnsembleDecision | null {
    if (typeof market !== "string") return null;
    for (const key of [market, market.trim().toUpperCase()]) {
      if (Object.hasOwn(this.decisions, key)) return { ...this.decisions[key] };
    }
    return null;
  }

  updateConfig(partial: Partial<EngineConfig>): EngineConfig {
    const prev = this.config;
    const p: Partial<EngineConfig> = partial ?? {};
    const prevActive = this.activeMarkets();
    // universe en ensemble.trendFilter mogen gedeeltelijk zijn: veld voor veld samenvoegen.
    const ensemble: EnsembleConfig = { ...prev.ensemble, ...(p.ensemble ?? {}) };
    const tfPatch = p.ensemble?.trendFilter;
    if (tfPatch && typeof tfPatch === "object") {
      ensemble.trendFilter = { ...(prev.ensemble.trendFilter ?? NO_TREND_FILTER), ...tfPatch };
    }
    const next = cloneConfig({
      ...prev,
      ...p,
      risk: { ...prev.risk, ...(p.risk ?? {}) },
      ensemble,
      ...(p.universe && typeof p.universe === "object"
        ? { universe: { ...(prev.universe ?? MANUAL_UNIVERSE), ...p.universe } }
        : {}),
    });
    if (!INTERVALS.includes(next.interval)) {
      throw new Error(`Ongeldig interval: ${String(next.interval)}`);
    }
    if (!Array.isArray(next.markets) || next.markets.some((m) => typeof m !== "string" || !m.trim())) {
      throw new Error("Ongeldige lijst met markten");
    }
    next.markets = [...new Set(next.markets.map((m) => m.trim().toUpperCase()))];
    if (next.markets.length > MAX_MARKETS) {
      throw new Error(`Te veel markten: hooguit ${MAX_MARKETS}`);
    }
    if (!isNum(next.pollMs) || next.pollMs <= 0) {
      throw new Error("Het poll-interval (pollMs) moet een positief getal zijn");
    }
    if (!Number.isInteger(next.historyCandles) || next.historyCandles < 2) {
      throw new Error("historyCandles moet een geheel getal van minimaal 2 zijn");
    }
    validateUniverse(next.universe);
    validateTrendFilter(next.ensemble.trendFilter);
    const spread = next.risk.maxSpreadPct;
    if (spread !== undefined && !(isNum(spread) && spread >= 0)) {
      throw new Error("De maximale spread (maxSpreadPct) moet 0 of een positief percentage zijn");
    }
    // Eerst de nieuwe risk manager maken: gooit hij, dan blijft de oude config actief.
    const risk = this.createRiskFn(next.risk, next.interval);

    const intervalChanged = prev.interval !== next.interval;
    const pollChanged = prev.pollMs !== next.pollMs;
    const universeChanged =
      JSON.stringify(prev.universe ?? null) !== JSON.stringify(next.universe ?? null) ||
      !sameList(prev.markets, next.markets) ||
      prev.risk.maxSpreadPct !== next.risk.maxSpreadPct;
    this.config = next;
    this.risk = risk;
    // Broker (paper én live) rekent met dezelfde kosten als de risk manager.
    this.applyBrokerCosts(next.risk);
    // Gewijzigde muntkeuze-instellingen (of lijst / spreadlimiet): volgende tick opnieuw kiezen.
    if (universeChanged) this.universeDirty = true;
    const nextActive = this.activeMarkets();

    if (intervalChanged) {
      this.lastEvaluated.clear();
      this.evaluatedBeforeRestart.clear();
      this.rejectLogged.clear();
      this.lastAtr.clear();
      this.decisions = {};
      // Alleen candles in het nieuwe interval die vanaf nu sluiten tellen nog mee.
      const cursor = this.nowFn() - INTERVAL_MS[next.interval];
      for (const pos of this.positions) this.posCursor.set(pos.id, cursor);
      // Rondes horen bij het interval: kandidaten en rondestand vervallen.
      this.resetRoundState(true);
    } else if (!sameList(prevActive, nextActive)) {
      // Markten die blijven houden hun evaluatie: anders wordt de laatste (al
      // verhandelde) candle opnieuw beoordeeld en kan dezelfde koop herhaald worden.
      // Nieuwe markten hebben nog niets en worden direct beoordeeld.
      this.dropInactive(nextActive);
    }

    const changed = Object.keys(p).filter((k) => k in prev || k === "universe");
    this.log("info", `Instellingen bijgewerkt${changed.length ? ` (${changed.join(", ")})` : ""}`);
    this.onTargetChanged(prev.risk.dailyProfitTargetPct, next.risk.dailyProfitTargetPct);
    if (pollChanged && this.running && this.timer) this.scheduleNext();
    if (pollChanged && this.monitorTimer) this.scheduleMonitor();
    this.emitSnapshot();
    return cloneConfig(next);
  }

  closePosition(id: string, reason: ExitReason = "manual"): Promise<Trade | null> {
    // Vanaf de aanvraag (ook terwijl hij op de lock wacht): deze positie niet afschrijven.
    this.closing.set(id, (this.closing.get(id) ?? 0) + 1);
    return this.exclusive(async () => {
      this.closeFailure = null;
      const pos = this.positions.find((p) => p.id === id);
      if (!pos) {
        if (this.writtenOff.has(id)) {
          this.closeFailure = `positie is ${WRITTEN_OFF_REASON}`;
          this.log("warn", `Positie ${id} niet gesloten: hij is ${WRITTEN_OFF_REASON}`);
          return null;
        }
        this.closeFailure = "positie niet gevonden (al gesloten?)";
        this.log("warn", `Positie ${id} niet gevonden (al gesloten?)`);
        return null;
      }
      // Loopt er nog een verkoop met onbekende uitkomst, dan eerst opzoeken: de bot
      // kan stilstaan (dan helpt geen tick) en een tweede verkoop mag er niet uit.
      let resolved: Trade | null = null;
      if (this.unknownSellFor(pos.id) && this.lookupFn()) {
        const booked = await this.resolveUnknownSells(false);
        resolved = booked.filter((t) => t.market === pos.market).pop() ?? null;
      }
      let trade: Trade | null = null;
      if (this.positions.includes(pos)) {
        const price = await this.freshPrice(pos.market);
        trade = await this.exitPosition(pos, reason, price, true);
        if (this.positions.includes(pos)) {
          this.closeFailure = this.exitFailure ?? "verkoop mislukt (zie het logboek)";
        }
      }
      if (!trade && !resolved && !this.positions.includes(pos)) {
        // Weg zonder verkoop: nooit als "gesloten" melden.
        this.closeFailure = this.writtenOff.has(pos.id)
          ? `positie is intussen ${WRITTEN_OFF_REASON}`
          : "positie staat niet meer in de administratie (zie het logboek)";
      }
      this.updateEquity();
      this.emitSnapshot();
      return trade ?? resolved;
    }).finally(() => {
      const n = (this.closing.get(id) ?? 1) - 1;
      if (n > 0) this.closing.set(id, n);
      else this.closing.delete(id);
    });
  }

  /**
   * Noodstop: bot stilzetten, ontwapenen en alle posities verkopen. Geeft terug
   * hoeveel posities gesloten zijn en welke NIET (met Nederlandse reden, bijv.
   * onverkoopbaar, afgewezen of uitkomst onbekend). Zolang de noodstop loopt is
   * armen geblokkeerd, en hij eindigt altijd ontwapend.
   */
  async killSwitch(): Promise<KillResult> {
    // Eerst de lus stilzetten zodat er geen nieuwe entries meer komen, ook niet
    // in een tick die nu nog loopt (stopGen) — en direct ontwapenen: de
    // noodstop-verkopen zelf zijn expliciet en gaan ook ontwapend door.
    this.killsInProgress++;
    this.running = false;
    this.stopGen++;
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
    const wasArmed = this.mode === "live" && this.armed;
    this.armed = false;
    const failed: KillResult["failed"] = [];
    let closed = 0;
    try {
      try {
        await this.exclusive(async () => {
          // Eerst ophelderen wat er met orders van onbekende uitkomst gebeurd is: een
          // alsnog gevulde koop wordt zo een positie die hieronder verkocht wordt.
          // ("Niet gevonden" telt hier niet mee voor de 3 waarnemingen.)
          if (this.unknownBuys.size > 0) await this.resolveUnknownBuys(false);
          if (this.unknownSells.size > 0) await this.resolveUnknownSells(false);
          // Pas tellen als een lopende tick klaar is.
          this.log(
            "warn",
            `NOODSTOP geactiveerd: ${this.positions.length} open positie(s) worden gesloten en de bot stopt`,
          );
          for (const pos of [...this.positions]) {
            if (!this.positions.includes(pos)) {
              // Intussen afgeschreven: er is niets verkocht, dus niet "gesloten".
              if (this.writtenOff.has(pos.id)) failed.push({ id: pos.id, market: pos.market, reason: WRITTEN_OFF_REASON });
              continue;
            }
            try {
              const price = await this.freshPrice(pos.market);
              await this.exitPosition(pos, "kill-switch", price, true);
            } catch (err) {
              this.exitFailure = `verkoop mislukt: ${errorMessage(err)}`;
              this.log("error", `NOODSTOP: verkoop ${pos.market} mislukt: ${errorMessage(err)}`);
            }
            if (this.positions.includes(pos)) {
              failed.push({
                id: pos.id,
                market: pos.market,
                reason: this.exitFailure ?? "verkoop mislukt (zie het logboek)",
              });
            } else if (this.writtenOff.has(pos.id)) {
              failed.push({ id: pos.id, market: pos.market, reason: WRITTEN_OFF_REASON });
            } else {
              closed++;
            }
          }
          for (const u of this.unknownBuys.values()) {
            failed.push({
              id: u.clientOrderId,
              market: u.market,
              reason:
                "kooporder met onbekende uitkomst: als die toch is uitgevoerd, staan de gekochte coins nog op je Bitvavo-account (niet verkocht)",
            });
          }
        });
      } finally {
        if (wasArmed) this.log("warn", "Live mode ontwapend na de noodstop");
        await this.stop();
      }
    } finally {
      // Altijd ontwapend eindigen (ook als er tijdens de noodstop iets misging):
      // opnieuw controleren NA de laatste stop().
      this.armed = false;
      this.killsInProgress--;
    }
    if (failed.length) {
      this.log(
        "error",
        `NOODSTOP: ${closed} positie(s) gesloten, ${failed.length} NIET gesloten (${failed
          .map((f) => `${f.market}: ${f.reason}`)
          .join("; ")}) — ${this.killAdvice(failed)}`,
      );
    } else {
      this.log("warn", `NOODSTOP voltooid: ${closed} positie(s) gesloten, bot gestopt`);
    }
    this.emitSnapshot();
    return { closed, failed: failed.map((f) => ({ ...f })) };
  }

  /** Vervolg in de noodstop-foutmelding, afhankelijk van WAT er niet gesloten kon worden. */
  private killAdvice(failed: KillResult["failed"]): string {
    const unsellable = failed.filter((f) => f.reason.startsWith("onverkoopbaar")).length;
    const writtenOff = failed.filter((f) => f.reason === WRITTEN_OFF_REASON).length;
    if (failed.length > unsellable + writtenOff) {
      return (
        "controleer je account en sluit handmatig!" +
        (unsellable > 0 ? " Onverkoopbare posities: wacht tot de waarde herstelt of schrijf ze af." : "")
      );
    }
    if (unsellable > 0) {
      return "deze positie(s) liggen onder het beursminimum en kunnen nu niet verkocht worden: wacht tot de waarde herstelt of schrijf de positie af";
    }
    return "afgeschreven posities zijn niet verkocht: de coins staan nog op je account";
  }

  /**
   * Schrijft een ONVERKOOPBARE positie (waarde onder het beursminimum) af: de
   * bot beheert hem niet meer en boekt de volledige inleg als verlies. De coins
   * blijven op het account staan; de cash verandert niet. Vlak voor de beslissing
   * haalt de bot een verse koers op (en live: een vers saldo): een positie die
   * daarmee verkocht kan worden, wordt nooit afgeschreven. Geweigerd ("Afschrijven
   * kan …") zolang er voor deze positie een handmatige verkoop of een noodstop loopt,
   * er een order bij de broker loopt of een verkoop met onbekende uitkomst openstaat.
   */
  async writeOffPosition(id: string): Promise<Trade> {
    const pos = this.positions.find((p) => p.id === id);
    if (!pos) throw new Error(`Positie ${id} niet gevonden (al gesloten?)`);
    this.assertWriteOffAllowed(pos);
    const { base } = splitMarket(pos.market, this.marketInfo.get(pos.market));
    // Verse gegevens (tijdens deze awaits kan er van alles gebeuren: daarna opnieuw controleren).
    const price = await this.fetchPrice(pos.market);
    const holding = this.mode === "live" ? await this.readHolding(base) : null;
    if (!this.positions.includes(pos)) throw new Error(`Positie ${id} niet gevonden (al gesloten?)`);
    this.assertWriteOffAllowed(pos);
    if (price === null) {
      throw new Error(
        `Afschrijven kan nu even niet: de actuele koers van ${pos.market} kon niet opgehaald worden. Probeer het zo opnieuw.`,
      );
    }
    let sellable = pos.amount;
    if (this.mode === "live") {
      if (!holding) {
        throw new Error(
          `Afschrijven kan nu even niet: het ${base}-saldo op Bitvavo kon niet gecontroleerd worden. Probeer het zo opnieuw.`,
        );
      }
      // (Deels) weg of vast in een openstaande order: dan beslist sluiten (dat werkt de administratie bij).
      if (holding.avail < pos.amount * (1 - MAX_SELL_SHORTFALL)) {
        throw new Error(
          `Afschrijven kan nu niet: op Bitvavo staat ${fmtAmount(holding.avail)} ${base} beschikbaar` +
            (holding.inOrder > 0 ? ` (en ${fmtAmount(holding.inOrder)} in een openstaande order)` : "") +
            ` van de ${fmtAmount(pos.amount)} ${base} van deze positie. Sluit de positie in plaats daarvan: dan werkt de bot de administratie bij.`,
        );
      }
      // Zelfde regel als bij verkopen: tot 5% minder saldo = verkoop wat er is.
      sellable = Math.min(pos.amount, holding.avail);
    }
    const dust = this.dustReason(pos.market, sellable, price) ?? this.brokerRefusal(pos, price);
    if (!dust) {
      throw new Error(
        `Afschrijven kan alleen voor een onverkoopbare positie (waarde onder het beursminimum). ` +
          `${pos.market} is nu ~${fmtEur(sellable * price)} waard en kan gewoon verkocht worden: sluit de positie in plaats daarvan.`,
      );
    }
    const now = this.nowFn();
    const pnl = -pos.costQuote;
    const initialRisk = (pos.entryPrice - pos.initialStopPrice) * pos.amount;
    const trade: Trade = {
      id: newId("trd"),
      market: pos.market,
      entryTime: pos.entryTime,
      exitTime: now,
      entryPrice: pos.entryPrice,
      exitPrice: price,
      amount: pos.amount,
      costQuote: pos.costQuote,
      proceedsQuote: 0,
      feesQuote: pos.entryFeeQuote,
      pnlQuote: pnl,
      pnlPct: -100,
      rMultiple: initialRisk > 0 ? pnl / initialRisk : 0,
      exitReason: "write-off",
      candlesHeld: pos.candlesHeld,
      entryReason: `${pos.entryReason} · afgeschreven (onverkoopbaar restant blijft op je account)`,
    };
    this.account.realizedPnl += pnl;
    this.account.realizedPnlToday += pnl;
    if (pnl < 0) this.account.lastLossAt[pos.market] = now;
    this.trades.push(trade);
    if (this.trades.length > MAX_TRADES_KEPT) this.trades.splice(0, this.trades.length - MAX_TRADES_KEPT);
    this.writtenOff.add(pos.id);
    this.forgetPosition(pos);
    this.settleCapitalPending();
    this.updateEquity();
    this.recordEquity(now, true);
    this.emitEvent("position-closed", { ...trade });
    this.log(
      "warn",
      `${pos.market} afgeschreven (${dust}): ${fmtAmount(pos.amount)} ${base} blijft op je ${this.mode === "live" ? "Bitvavo-account" : "paper-account"} staan ` +
        `maar wordt niet meer door de bot beheerd; ${fmtSignedEur(pnl)} als verlies geboekt`,
    );
    this.persistSync(true);
    this.emitSnapshot();
    return { ...trade };
  }

  /** Gooit "Afschrijven kan nu (even) niet …" als er voor deze positie een verkoop loopt. */
  private assertWriteOffAllowed(pos: Position): void {
    if (this.killsInProgress > 0) {
      throw new Error(
        "Afschrijven kan nu niet: de noodstop is bezig en probeert alle posities te verkopen. Wacht tot hij klaar is en probeer het daarna opnieuw.",
      );
    }
    if (this.closing.has(pos.id)) {
      throw new Error(
        `Afschrijven kan nu niet: ${pos.market} wordt op dit moment handmatig gesloten. Wacht tot dat klaar is en probeer het daarna opnieuw.`,
      );
    }
    if (this.ordersInFlight > 0) {
      throw new Error("Afschrijven kan nu even niet: er loopt nog een order bij de broker. Probeer het zo opnieuw.");
    }
    if (this.unknownSellFor(pos.id)) {
      throw new Error(
        `Afschrijven kan nu niet: voor ${pos.market} loopt een verkooporder met onbekende uitkomst. Wacht tot die is opgehelderd.`,
      );
    }
  }

  arm(): void {
    if (this.mode !== "live") return;
    if (this.killsInProgress > 0) {
      throw new Error(
        "Armen geblokkeerd: noodstop bezig. Wacht tot de noodstop klaar is (de bot eindigt ontwapend) en arm daarna opnieuw als je dat wilt.",
      );
    }
    if (this.armed) return;
    if (this.stateRecovery) {
      throw new Error(
        `Armen geblokkeerd: de opgeslagen staat was bij het starten onbruikbaar (${this.stateRecovery.reason}) en de bot begon met een lege administratie. ` +
          "Controleer eerst je Bitvavo-saldi (open posities van vóór de herstart worden niet bewaakt) en bevestig dat daarna.",
      );
    }
    this.armed = true;
    // Orders met onbekende uitkomst (koop én verkoop) blijven staan tot ze opgehelderd zijn.
    this.log(
      "warn",
      `LIVE GEARMD: de bot plaatst nu ECHTE orders op Bitvavo (kapitaallimiet ${fmtEur(this.startingCapital)})`,
    );
    if (this.unknownBuys.size > 0) this.logUnknownBuysBlocking();
    if (this.unknownSells.size > 0) this.logUnknownSellsPending();
    this.emitSnapshot();
  }

  /**
   * De gebruiker heeft zijn Bitvavo-account zelf gecontroleerd na een kooporder
   * met onbekende uitkomst: blokkade op nieuwe entries opheffen. Eventueel
   * alsnog gekochte coins worden NIET door de bot beheerd (geen stop-loss).
   */
  acknowledgeUnknownOrders(): void {
    if (this.unknownBuys.size === 0) return;
    const list = [...this.unknownBuys.values()].map((u) => `${u.market} (${u.clientOrderId})`).join(", ");
    this.unknownBuys.clear();
    this.log(
      "warn",
      `Blokkade na kooporder(s) met onbekende uitkomst handmatig opgeheven: ${list}. ` +
        "Als zo'n order toch is uitgevoerd, beheert de bot die coins NIET (geen stop-loss) — verkoop ze zelf op Bitvavo.",
    );
    this.persistSync(true);
    this.emitSnapshot();
  }

  /**
   * De gebruiker bevestigt dat hij zijn saldi gecontroleerd heeft nadat de
   * opgeslagen staat onbruikbaar was: armen mag weer en de (lege) administratie
   * mag het oude bestand overschrijven.
   */
  acknowledgeStateRecovery(): void {
    const store = this.store as (StateStore & { unblockWrites?: () => void }) | undefined;
    if (store && typeof store.unblockWrites === "function") store.unblockWrites();
    if (!this.stateRecovery) return;
    this.stateRecovery = null;
    this.log("info", "Herstelmelding bevestigd: de bot gaat verder met de huidige administratie");
    this.persistSync(true);
    this.emitSnapshot();
  }

  disarm(): void {
    if (this.mode !== "live" || !this.armed) return;
    this.armed = false;
    const n = this.positions.length;
    this.log(
      "warn",
      `Live ontwapend: er worden geen echte orders meer geplaatst` +
        (n > 0
          ? ` — let op: ${n} open positie(s) worden NIET meer automatisch verkocht (stop-loss); arm opnieuw of sluit handmatig`
          : ""),
    );
    this.emitSnapshot();
  }

  resetPaper(startingCapital: number): void {
    if (this.mode !== "paper") {
      throw new Error("Resetten kan alleen in paper mode (in live mode is het account echt geld)");
    }
    if (!isNum(startingCapital) || startingCapital <= 0) {
      throw new Error("Het startkapitaal moet een positief bedrag in EUR zijn");
    }
    this.epoch++;
    const now = this.nowFn();
    this.startingCapital = startingCapital;
    this.positions = [];
    this.trades = [];
    this.haltedDayKey = null;
    this.targetDayKey = null;
    this.targetArmedDayKey = null;
    this.skimmedQuote = 0;
    this.skimmedToday = 0;
    this.capitalReturned = 0;
    this.returnedToday = 0;
    this.capitalAdded = 0;
    this.addedToday = 0;
    this.capitalPending = 0;
    this.pendingExit.clear();
    this.posCursor.clear();
    this.rejectLogged.clear();
    this.unsellable.clear();
    this.vanishedSeen.clear();
    this.writtenOff.clear();
    this.pendingRebasePoint = false;
    // Koopkandidaten van vóór de reset niet meer kopen.
    this.resetRoundState(false);
    this.account = freshAccount(startingCapital, now);
    this.equityHistory = [{ time: now, equity: startingCapital }];
    this.halted = { halted: false };
    const b = this.broker as Broker & { reset?: (startingQuote: number) => void };
    if (typeof b.reset === "function") b.reset(startingCapital);
    this.paperBalances = [{ symbol: "EUR", available: startingCapital, inOrder: 0 }];
    this.log("info", `Paper-account gereset: startkapitaal ${fmtEur(startingCapital)}, alle posities en trades gewist`);
    this.persistSync(true);
    this.emitSnapshot();
  }

  // ───────────────────────────── Tick-logica ─────────────────────────────

  private async runTick(): Promise<void> {
    const now = this.nowFn();
    this.lastTickAt = now;
    this.tickSeq++;
    if (this.unknownBuys.size > 0) await this.resolveUnknownBuys(true);
    if (this.unknownSells.size > 0) await this.resolveUnknownSells(true);
    if (dayKey(now) !== this.account.dayKey) await this.loadMissingPrices();
    this.checkDayRollover(now);
    await this.loadMarkets(false);
    this.refreshHalt();

    // 5. Eerst de markten met een positie (of een verkoop met onbekende uitkomst): elke tick,
    // op volgorde, vóór alle optionele v2-gegevens hieronder — die mogen de stop-loss nooit
    // vertragen (bijv. een beurs die op één verzoek blijft hangen).
    const unchecked = await this.processHeld(this.activeMarkets(now), now);

    // 1–4: muntkeuze, koersen, tickers, marktfilter. Elke stap vangt zijn eigen fouten.
    await this.refreshUniverse(now);
    const active = this.activeMarkets(now);
    // Te veel munten voor interval + verversen: één keer melden (de radar toont het ook).
    const capacity = this.capacityNote(active.length);
    if (capacity) this.logThrottled("capacity", "warn", capacity, Number.POSITIVE_INFINITY);
    else this.throttle.delete("capacity");
    const bulk = await this.refreshBulkPrices(active);
    // Stop-controle met de verse koers van net, voor ELKE positie: candles kunnen iets ouder
    // zijn (vlak vóór het sluiten van een candle opgehaald, of gedeeld met een andere bot) en
    // een oudere koers mag een geraakte stop nooit verbergen. Posities waarvan de candles niet
    // opgehaald konden worden ("unchecked") krijgen zo hun enige controle. Een verkoop die al
    // loopt (pendingExit) is deze tick bij de candles al geprobeerd: niet nog eens.
    if (bulk && this.positions.length > 0) {
      const retry = new Set(unchecked);
      await this.checkHeldAtPrices(
        uniq(this.positions.map((p) => p.market)),
        bulk,
        now,
        (pos) => retry.has(pos.market) || !this.pendingExit.has(pos.id),
      );
    }
    // Dagdoel / winstgrens (met de koersen van net).
    await this.safeLockInDailyTarget();
    // Live: nieuw gekozen munten ook controleren op coins die de bot niet beheert.
    if (this.mode === "live" && this.tickWhileRunning) await this.checkUnmanagedNew(active, now);
    await this.refreshTickers(now);
    await this.refreshMarketFilter(now);
    const round = await this.beginRound(now);
    const held = this.heldMarkets(active);
    await this.recheckHeld();

    // 6. Actieve markten die voor deze ronde nog beoordeeld moeten worden.
    try {
      await this.scanDueMarkets(active, new Set(held), now, round);
    } catch (err) {
      this.log("error", `Fout bij het beoordelen van de markten: ${errorMessage(err)}`);
    }
    await this.recheckHeld();

    // 8. Kansenronde: de beste koopkandidaten eerst.
    try {
      await this.maybeFlushRound(active, now, round);
    } catch (err) {
      this.log("error", `Fout in de kansenronde: ${errorMessage(err)}`);
    }
    await this.recheckHeld();
    await this.safeLockInDailyTarget();
  }

  /** De dagdoel-stap mag nooit de rest van een tick (stops, exits, kansenronde) blokkeren. */
  private async safeLockInDailyTarget(): Promise<void> {
    try {
      await this.lockInDailyTarget();
    } catch (err) {
      this.logThrottled("daily-target", "error", `Dagdoel-controle mislukt: ${errorMessage(err)}`);
    }
  }

  /**
   * Dagdoel / winstgrens (risk.dailyProfitTargetPct):
   * 1. haalt de dagwinst (na verkoopkosten) het doel, dan wordt de winstgrens actief
   *    en handelt de bot gewoon door;
   * 2. valt de dagwinst daarna terug tot de grens, dan geeft de risk manager een
   *    dagdoel-halt en worden de open posities verkocht om de winst vast te zetten.
   *    Nieuwe aankopen blokkeert die halt zelf (tot de dagwissel). Een verkoop die niet
   *    lukt (onverkoopbaar, live niet gearmd…) blijft als openstaande verkoop staan en
   *    wordt elke tick opnieuw geprobeerd.
   */
  private async lockInDailyTarget(): Promise<void> {
    // Zelfde voorwaarde als voor kopen: niet meer als de gebruiker intussen op Stop/Noodstop drukte.
    if (!this.buyAllowed()) return;
    // Dagwissel uitgesteld (nog geen koers bij het begin van de tick): de koersen van vandaag
    // nooit tegen de winstgrens van gisteren afzetten.
    if (dayKey(this.nowFn()) !== this.account.dayKey) return;
    this.updateEquity();
    this.checkTargetReached();
    const h = this.refreshHalt();
    if (!h.halted || h.dailyTarget !== true) return;
    for (const pos of [...this.positions]) {
      if (!this.buyAllowed()) return;
      if (!this.positions.includes(pos) || this.pendingExit.has(pos.id)) continue;
      const price = this.prices[pos.market];
      if (!isNum(price) || price <= 0) continue;
      await this.exitPosition(pos, "daily-target", price, false);
    }
  }

  /**
   * Dagdoel VERHOOGD (of aangezet) terwijl de winstgrens van vandaag al actief was: het nieuwe
   * doel is nog niet gehaald, dus de grens gaat weer uit tot de dagwinst het nieuwe doel haalt
   * (anders zou de bot meteen alles verkopen, want de dagwinst ligt onder het nieuwe doel).
   * Verlagen houdt de grens actief (het lagere doel is vandaag al gehaald). Al vastgezette
   * winst blijft tot morgen vastgezet.
   */
  private onTargetChanged(before: number | undefined, after: number | undefined): void {
    const prevTarget = isNum(before) && before > 0 ? before : 0;
    const nextTarget = isNum(after) && after > 0 ? after : 0;
    if (!(nextTarget > prevTarget)) return;
    const day = this.account.dayKey;
    if (this.targetArmedDayKey !== day || this.targetDayKey === day) return;
    this.targetArmedDayKey = null;
    const t = Number.isInteger(nextTarget) ? String(nextTarget) : nextTarget.toFixed(2).replace(".", ",");
    this.log(
      "info",
      `Dagdoel verhoogd naar +${t}%: de winstgrens van vandaag staat weer uit en gaat pas aan als de dagwinst +${t}% haalt`,
    );
    this.persistSync(true);
  }

  /** Dagdoel vandaag voor het eerst gehaald (na verkoopkosten)? Dan de winstgrens activeren. */
  private checkTargetReached(): void {
    const target = this.config.risk.dailyProfitTargetPct;
    if (!isNum(target) || target <= 0) return;
    const day = this.account.dayKey;
    if (this.targetArmedDayKey === day || this.targetDayKey === day || !this.pricesKnown()) return;
    // Zelfde berekening als RiskManager.netDayPct: resultaat van vandaag na verkoopkosten.
    const dayStart = this.riskDayStartEquity();
    const equity = this.account.equity;
    if (!isNum(dayStart) || dayStart <= 0 || !isNum(equity)) return;
    const net = ((equity - this.exitCostEstimate() - dayStart) / dayStart) * 100;
    if (!isNum(net) || net < target - 1e-9) return;
    this.targetArmedDayKey = day;
    const t = Number.isInteger(target) ? String(target) : target.toFixed(2).replace(".", ",");
    this.log(
      "info",
      `Dagdoel gehaald: ${fmtPct2(net).replace(/^(?!-)/, "+")} vandaag. De bot handelt door; zakt de dagwinst terug naar +${t}%, ` +
        "dan verkoopt hij alles om de winst vast te zetten en stopt hij tot morgen.",
    );
  }

  /**
   * 5. Markten met een positie of een verkoop met onbekende uitkomst verwerken (candles →
   * stops, exits). Geeft de positie-markten terug waarvan de candles nu niet opgehaald konden
   * worden (die krijgen een stop-controle op alleen de koers, zie {@link checkHeldAtPrices}).
   */
  private async processHeld(active: readonly string[], now: number): Promise<string[]> {
    const unchecked: string[] = [];
    for (const market of this.heldMarkets(active)) {
      let checked = false;
      try {
        checked = await this.processMarket(market, now);
      } catch (err) {
        this.log("error", `Fout bij verwerken van ${market}: ${errorMessage(err)}`);
      }
      if (!checked && this.positions.some((p) => p.market === market)) unchecked.push(market);
    }
    this.heldCheckedAt = this.nowFn();
    return unchecked;
  }

  /**
   * Stop-controle met alleen een actuele koers (de synthetische candle uit managePosition,
   * zonder gesloten candles): voor posities waarvan de candles niet opgehaald konden worden,
   * en tussendoor in een lange tick.
   */
  private async checkHeldAtPrices(
    markets: readonly string[],
    prices: Record<string, number>,
    now: number,
    include: (pos: Position) => boolean = () => true,
  ): Promise<void> {
    for (const market of markets) {
      const price = Object.hasOwn(prices, market) ? prices[market] : undefined;
      if (!isNum(price) || price <= 0) continue;
      for (const pos of this.positions.filter((p) => p.market === market && include(p))) {
        try {
          await this.managePosition(pos, [], new Map(), price, now);
        } catch (err) {
          this.log("error", `Fout bij het bewaken van ${market}: ${errorMessage(err)}`);
        }
      }
    }
  }

  /** Na zoveel ms in een tick de stops opnieuw controleren (pollMs, hooguit {@link HELD_RECHECK_MS}). */
  private heldRecheckMs(): number {
    return Math.max(1_000, Math.min(this.config.pollMs, HELD_RECHECK_MS));
  }

  /**
   * Duurt de tick lang (trage beurs, veel munten, orders), dan de open posities tussendoor
   * opnieuw bewaken: met één verzoek voor alle koersen (stop op de actuele koers), of zonder
   * `getPrices` via hun candles.
   */
  private async recheckHeld(): Promise<void> {
    if (this.positions.length === 0) return;
    const now = this.nowFn();
    if (this.heldCheckedAt !== null && now - this.heldCheckedAt < this.heldRecheckMs()) return;
    const markets = uniq(this.positions.map((p) => p.market));
    try {
      let all: Record<string, number> | null = null;
      if (this.hasBulkPrices() && !this.bulkInBackoff(now)) {
        try {
          all = await this.io.getPrices!(POSITION);
          this.bulkFailedAt = null;
        } catch {
          this.bulkFailedAt = this.nowFn();
        }
      }
      if (all && typeof all === "object") {
        for (const m of markets) {
          const p = Object.hasOwn(all, m) ? all[m] : undefined;
          if (isNum(p) && p > 0) this.prices[m] = p;
        }
        await this.checkHeldAtPrices(markets, all, this.nowFn());
      } else {
        // Geen koersen van alle markten: dan via de candles van die markten (zoals aan het begin van de tick).
        for (const m of markets) await this.processMarket(m, this.nowFn());
      }
    } catch (err) {
      this.logThrottled("recheck", "warn", `Tussentijdse stop-controle mislukt: ${errorMessage(err)} — de volgende tick probeert het opnieuw`);
    } finally {
      this.heldCheckedAt = this.nowFn();
    }
  }

  /** Mislukte het ophalen van alle koersen kort geleden? Dan even niet opnieuw (trage of hangende beurs). */
  private bulkInBackoff(now: number): boolean {
    return this.bulkFailedAt !== null && now - this.bulkFailedAt >= 0 && now - this.bulkFailedAt < BULK_RETRY_MS;
  }

  /** De feed, met het optionele laatste argument voor verzoek-opties (zie {@link FeedWithOptions}). */
  private get io(): FeedWithOptions {
    return this.feed as unknown as FeedWithOptions;
  }

  private async afterTick(): Promise<void> {
    this.updateEquity();
    this.flushRebasePoint();
    this.recordEquity(this.nowFn(), false);
    this.refreshHalt();
    await this.persist(false);
    this.emitSnapshot();
  }

  // ───────────────────────────── v2: actieve markten ─────────────────────────────

  /** "Zelf kiezen": config.markets zonder dubbele (gecachet per lijst). */
  private manualMarkets(): string[] {
    const src = this.config.markets;
    if (this.manualCache?.src === src) return this.manualCache.list;
    const list = uniq(Array.isArray(src) ? src.filter((m) => typeof m === "string" && m.length > 0) : []);
    this.manualCache = { src, list };
    return list;
  }

  /** Geldige opgeslagen automatische keuze (< 24 uur oud), of null. */
  private usablePersistedAuto(now: number): { markets: string[]; at: number } | null {
    const p = this.persistedAuto;
    if (!p) return null;
    const age = now - p.at;
    return age < AUTO_UNIVERSE_MAX_AGE_MS && age > -5 * 60_000 ? p : null;
  }

  /**
   * De markten die de bot nu volgt (en mag kopen). Zelf kiezen: config.markets.
   * Automatisch: de laatste gelukte keuze; daarvóór de opgeslagen keuze (als die < 24 uur
   * oud is), anders config.markets.
   */
  private activeMarkets(now = this.nowFn()): string[] {
    const u = this.config.universe;
    if (u && u.mode === "auto") {
      if (this.autoSel) return this.autoSel.markets;
      const p = this.usablePersistedAuto(now);
      if (p) return p.markets;
    }
    return this.manualMarkets();
  }

  private isActive(market: string): boolean {
    const list = this.activeMarkets();
    if (this.activeSetCache?.list !== list) this.activeSetCache = { list, set: new Set(list) };
    return this.activeSetCache.set.has(market);
  }

  /** Markten met een open positie of een verkoop met onbekende uitkomst (actieve volgorde eerst). */
  private heldMarkets(active: readonly string[]): string[] {
    const held = new Set([...this.positions.map((p) => p.market), ...[...this.unknownSells.values()].map((u) => u.market)]);
    return uniq([...active.filter((m) => held.has(m)), ...held]);
  }

  /** Korte omschrijving voor de startmelding. */
  private marketsDescription(): string {
    const u = this.config.universe;
    if (u && u.mode === "auto") return `automatische muntkeuze: ${u.count} munten`;
    const list = this.manualMarkets();
    if (list.length === 0) return "markten: geen";
    return list.length <= 10 ? `markten: ${list.join(", ")}` : `${list.length} markten`;
  }

  /**
   * Per-markt-toestand opruimen voor markten die niet meer actief zijn (markten met een
   * positie houden hun evaluatie: die worden gewoon verder bewaakt).
   */
  private dropInactive(active: readonly string[]): void {
    const keep = new Set([...active, ...this.heldMarkets([])]);
    for (const map of [
      this.lastEvaluated,
      this.evaluatedBeforeRestart,
      this.rejectLogged,
      this.scanState,
      this.roundNotes,
      this.pool,
      this.coinTrend,
      this.entryRejection,
    ] as Map<string, unknown>[]) {
      for (const m of [...map.keys()]) if (!keep.has(m)) map.delete(m);
    }
    for (const m of Object.keys(this.decisions)) {
      if (!keep.has(m)) delete this.decisions[m];
    }
  }

  /** Kandidaten en rondestand wissen (stop, noodstop, reset, ander interval). */
  private resetRoundState(clearScan: boolean): void {
    this.pool.clear();
    this.roundNotes.clear();
    this.round = null;
    if (clearScan) this.scanState.clear();
  }

  private universeKey(): string {
    const u = this.config.universe;
    return JSON.stringify([u?.mode ?? "manual", u?.count ?? null, u?.minVolumeEur ?? null, this.config.risk.maxSpreadPct ?? null]);
  }

  /**
   * 1. Automatische muntkeuze (alleen "auto"): als er nog geen keuze is, elk uur, of na
   * gewijzigde instellingen. Mislukt of leeg → vorige set houden, met uitleg.
   */
  private async refreshUniverse(now: number): Promise<void> {
    const u = this.config.universe;
    if (!u || u.mode !== "auto") {
      this.universeNote = undefined;
      return;
    }
    const sel = this.autoSel;
    const stale = !sel || sel.key !== this.universeKey() || now - sel.at >= UNIVERSE_REFRESH_MS;
    if (!this.universeDirty && !stale) return;
    // Na een mislukte poging niet elke tick opnieuw (wel meteen na gewijzigde instellingen).
    if (!this.universeDirty && this.universeAttemptAt !== null && now - this.universeAttemptAt < FETCH_RETRY_MS) return;
    this.universeDirty = false;
    this.universeAttemptAt = now;
    const prevActive = this.activeMarkets(now);
    const [mRes, tRes] = await Promise.allSettled([this.io.getMarkets(FAST), this.io.getTickers24h(undefined, FAST)]);
    if (tRes.status === "rejected") {
      // De tickers zijn net geprobeerd: stap 3 hoeft deze tick niet nóg eens te wachten.
      this.tickersAt = now;
      this.logThrottled(
        "tickers",
        "warn",
        `24-uursgegevens van de markten niet opgehaald: ${errorMessage(tRes.reason)} — de bot gebruikt de vorige`,
      );
    }
    if (mRes.status === "rejected" || tRes.status === "rejected") {
      this.universeFailed(errorMessage(mRes.status === "rejected" ? mRes.reason : (tRes as PromiseRejectedResult).reason), now);
      return;
    }
    const markets = mRes.value;
    const tickers = tRes.value;
    if (Array.isArray(tickers) && tickers.length > 0) this.setTickers(tickers, now);
    // Instellingen kunnen tijdens het ophalen veranderd zijn: met de huidige kiezen.
    const cfg = this.config.universe;
    if (!cfg || cfg.mode !== "auto") return;
    let selection: UniverseSelection;
    try {
      selection = selectUniverse(
        Array.isArray(markets) ? markets : [],
        Array.isArray(tickers) ? tickers : [],
        cfg,
        this.config.risk.maxSpreadPct,
      );
    } catch (err) {
      this.universeFailed(errorMessage(err), now);
      return;
    }
    if (selection.markets.length === 0) {
      this.universeFailed(`geen munten die aan de filters voldoen (${this.universeFilterText(cfg)})`, now);
      return;
    }
    this.autoSel = {
      markets: selection.markets,
      at: now,
      key: this.universeKey(),
      eligible: selection.eligible,
      excluded: selection.excluded.length,
    };
    this.universeNote =
      selection.markets.length < cfg.count
        ? `Maar ${selection.markets.length} munten voldoen aan de filters (${this.universeFilterText(cfg)}); gevraagd: ${cfg.count}`
        : undefined;
    this.throttle.delete("universe");
    const next = selection.markets;
    if (!sameSet(prevActive, next)) {
      const before = new Set(prevActive);
      const after = new Set(next);
      const added = next.filter((m) => !before.has(m)).map((m) => this.baseName(m));
      const removed = prevActive.filter((m) => !after.has(m)).map((m) => this.baseName(m));
      this.log(
        "info",
        `Automatische muntkeuze: ${next.length} munten (meeste handel)` +
          (added.length ? ` — erbij: ${fmtNameList(added)}` : "") +
          (removed.length ? `${added.length ? ";" : " —"} eraf: ${fmtNameList(removed)}` : ""),
      );
      this.dropInactive(next);
    }
  }

  private universeFilterText(cfg: UniverseConfig): string {
    const spread = this.config.risk.maxSpreadPct;
    return (
      `minimaal ${fmtEur(cfg.minVolumeEur)} handel per 24 uur` +
      (isNum(spread) && spread > 0 ? `, spread hooguit ${fmtPct2(spread)}` : "") +
      ", geen stablecoins"
    );
  }

  private universeFailed(why: string, now: number): void {
    const p = this.usablePersistedAuto(now);
    const fallback = this.autoSel
      ? `de vorige keuze (${this.autoSel.markets.length} munten)`
      : p
        ? `de opgeslagen keuze (${p.markets.length} munten)`
        : `je eigen lijst (${this.manualMarkets().length} ${this.manualMarkets().length === 1 ? "markt" : "markten"})`;
    this.universeNote = `Automatische muntkeuze mislukt: ${why} — de bot gebruikt ${fallback}`;
    this.logThrottled("universe", "warn", this.universeNote);
  }

  private baseName(market: string): string {
    return splitMarket(market, this.marketInfo.get(market)).base;
  }

  /** Is er één verzoek voor alle koersen (`feed.getPrices`)? */
  private hasBulkPrices(): boolean {
    return typeof this.feed.getPrices === "function";
  }

  /**
   * 2. Koersen van alle actieve markten en posities in één verzoek (als de feed dat kan).
   * Geen "price"-event per markt: de snapshot draagt ze. Geeft de verse koersen terug
   * (null = niet opgehaald).
   */
  private async refreshBulkPrices(active: readonly string[]): Promise<Record<string, number> | null> {
    if (!this.hasBulkPrices()) return null;
    // Kort geleden mislukt (bijv. een hangend verzoek): niet elke tick opnieuw laten wachten.
    if (this.bulkInBackoff(this.nowFn())) return null;
    let all: Record<string, number>;
    try {
      // Met open posities is dit ook de terugval voor hun stop-controle.
      all = await this.io.getPrices!(this.positions.length > 0 ? POSITION : FAST);
      this.bulkFailedAt = null;
    } catch (err) {
      this.bulkFailedAt = this.nowFn();
      this.logThrottled(
        "prices",
        "warn",
        `Koersen van alle markten niet opgehaald: ${errorMessage(err)} — de bot gebruikt de laatst bekende koersen`,
      );
      return null;
    }
    if (!all || typeof all !== "object") return null;
    for (const m of uniq([...active, ...this.positions.map((p) => p.market)])) {
      if (!Object.hasOwn(all, m)) continue;
      const price = all[m];
      if (isNum(price) && price > 0) this.prices[m] = price;
    }
    return all;
  }

  private setTickers(list: readonly Ticker24h[], now: number): void {
    const map = new Map<string, Ticker24h>();
    for (const t of list) if (t && typeof t.market === "string") map.set(t.market, t);
    if (map.size > 0) this.tickers = map;
    this.tickersAt = now;
  }

  /** 3. 24h-tickers hooguit elke {@link TICKERS_REFRESH_MS}; mislukt → de oude houden. */
  private async refreshTickers(now: number): Promise<void> {
    if (this.tickersAt !== null && now - this.tickersAt < TICKERS_REFRESH_MS) return;
    this.tickersAt = now;
    try {
      const list = await this.io.getTickers24h(undefined, FAST);
      if (Array.isArray(list) && list.length > 0) this.setTickers(list, now);
    } catch (err) {
      this.logThrottled(
        "tickers",
        "warn",
        `24-uursgegevens van de markten niet opgehaald: ${errorMessage(err)} — de bot gebruikt de vorige`,
      );
    }
  }

  // ───────────────────────────── v2: trendfilter ─────────────────────────────

  /** Moeten deze trendcandles (opnieuw) opgehaald worden? */
  private trendNeedsFetch(cache: TrendCache | null | undefined, tf: TrendFilterConfig, now: number): boolean {
    if (!cache || cache.key !== trendKey(tf)) return true;
    // Na een mislukte poging hooguit elke TREND_RETRY_MS opnieuw.
    if (cache.error !== null && cache.attemptAt !== null && now - cache.attemptAt < TREND_RETRY_MS) return false;
    if (cache.fetchedAt === null) return true;
    const ms = INTERVAL_MS[tf.interval];
    if (!isNum(ms)) return false;
    const newestClose = Math.floor(now / ms) * ms;
    // Sinds het laatste ophalen is er een nieuwe candle gesloten.
    if (cache.fetchedAt < newestClose) return true;
    // De nieuwste candle ontbrak nog (beurs nog niet bij): hooguit elke TREND_RETRY_MS opnieuw.
    const last = cache.candles[cache.candles.length - 1];
    const stale = !last || last.time < newestClose - ms;
    return stale && cache.attemptAt !== null && now - cache.attemptAt >= TREND_RETRY_MS;
  }

  private async loadTrendCandles(
    market: string,
    tf: TrendFilterConfig,
    now: number,
    prev: TrendCache | null | undefined,
  ): Promise<TrendCache> {
    const key = trendKey(tf);
    try {
      const raw = await this.io.getCandles(market, tf.interval, trendCandlesNeeded(tf), FAST);
      const candles = closedCandles(sanitizeCandles(raw), tf.interval, now);
      return { key, candles, fetchedAt: now, attemptAt: now, error: null };
    } catch (err) {
      const same = prev && prev.key === key ? prev : null;
      return {
        key,
        candles: same ? same.candles : [],
        fetchedAt: same ? same.fetchedAt : null,
        attemptAt: now,
        error: errorMessage(err),
      };
    }
  }

  /**
   * Trendcandles die op `atMs` bruikbaar zijn. Ze moeten de candle bevatten die op `atMs`
   * als laatste gesloten is (zoals in de backtest). Alleen vlak na het sluiten (binnen
   * {@link TREND_RETRY_MS}) mag die nog ontbreken, en alleen als het laatste ophalen gelukt
   * is (de beurs was nog niet bij). Mislukt ophalen of oudere data telt als "geen data" —
   * dan blokkeert het filter (voor de zekerheid niet kopen).
   */
  private usableTrendCandles(cache: TrendCache | null | undefined, tf: TrendFilterConfig, atMs: number): Candle[] {
    if (!cache || cache.key !== trendKey(tf)) return [];
    const ms = INTERVAL_MS[tf.interval];
    const last = cache.candles[cache.candles.length - 1];
    if (!last || !isNum(ms)) return [];
    const expected = Math.floor(atMs / ms) * ms - ms;
    if (last.time >= expected) return cache.candles;
    const justClosed = atMs - (expected + ms) < TREND_RETRY_MS;
    return last.time >= expected - ms && justClosed && cache.error === null ? cache.candles : [];
  }

  /**
   * Uitleg als er wel trendcandles zijn, maar niet de nieuwste die op `atMs` gesloten is
   * (bijv. ophalen mislukt na het sluiten), anders null.
   */
  private staleTrendText(who: string, cache: TrendCache | null | undefined, tf: TrendFilterConfig, atMs: number): string | null {
    if (!cache || cache.key !== trendKey(tf) || cache.candles.length === 0) return null;
    if (this.usableTrendCandles(cache, tf, atMs).length > 0) return null;
    return `${who}: koersdata niet actueel, ${tf.interval === "1d" ? "de laatste dagcandle" : "het laatste blok van 4 uur"} ontbreekt`;
  }

  /** 4. Marktfilter: Bitcoin-candles verversen als er een nieuwe candle gesloten is. */
  private async refreshMarketFilter(now: number): Promise<void> {
    const tf = this.config.ensemble.trendFilter;
    if (!tf || tf.market !== true) return;
    try {
      if (!this.trendNeedsFetch(this.marketTrend, tf, now)) return;
      this.marketTrend = await this.loadTrendCandles(MARKET_FILTER_MARKET, tf, now, this.marketTrend);
      if (this.marketTrend.error !== null) {
        this.logThrottled(
          "marketfilter",
          "warn",
          `Marktfilter: koersdata van ${MARKET_FILTER_MARKET} niet opgehaald (${this.marketTrend.error}) — geen nieuwe aankopen tot dat weer lukt`,
        );
      } else {
        this.throttle.delete("marketfilter");
      }
    } catch (err) {
      this.logThrottled("marketfilter", "warn", `Marktfilter bijwerken mislukt: ${errorMessage(err)}`);
    }
  }

  /** Trendcandles van een munt voor het muntfilter (lui opgehaald en gecachet). */
  private async coinTrendCache(market: string, tf: TrendFilterConfig, now: number): Promise<TrendCache | null> {
    if (market === MARKET_FILTER_MARKET && tf.market) return this.marketTrend;
    const prev = this.coinTrend.get(market);
    if (!this.trendNeedsFetch(prev, tf, now)) return prev ?? null;
    const next = await this.loadTrendCandles(market, tf, now, prev);
    this.coinTrend.set(market, next);
    return next;
  }

  /** Trendfilter voor een koop in `market` die op `atMs` uitgevoerd zou worden. */
  private async trendGateFor(market: string, tf: TrendFilterConfig, atMs: number, now: number): Promise<TrendGateResult> {
    const data: { market?: Candle[]; coin?: Candle[] } = {};
    const withError = (cache: TrendCache | null | undefined): string =>
      cache && cache.error !== null ? ` (ophalen mislukt: ${cache.error})` : "";
    if (tf.market) {
      data.market = this.usableTrendCandles(this.marketTrend, tf, atMs);
      // Blokkeert het marktfilter al, dan de munt niet ophalen.
      const first = trendGate({ ...tf, coin: false }, data, atMs, market);
      if (!first.allowed) {
        const stale = this.staleTrendText(`Bitcoin (${MARKET_FILTER_MARKET})`, this.marketTrend, tf, atMs);
        if (stale) return { ...first, reason: `Marktfilter: ${stale}${withError(this.marketTrend)} — geen nieuwe aankopen` };
      }
      if (!first.allowed || !tf.coin) return first;
    }
    let coinCache: TrendCache | null = null;
    if (tf.coin) {
      coinCache = await this.coinTrendCache(market, tf, now);
      data.coin = this.usableTrendCandles(coinCache, tf, atMs);
    }
    const gate = trendGate(tf, data, atMs, market);
    if (!gate.allowed && tf.coin && gate.reason?.startsWith("Muntfilter")) {
      const stale = this.staleTrendText(this.baseName(market), coinCache, tf, atMs);
      if (stale) return { ...gate, reason: `Muntfilter: ${stale}${withError(coinCache)} — geen aankoop` };
    }
    return gate;
  }

  /** Spreadlimiet: reden om NIET te kopen, of null. Geen limiet ingesteld → null. */
  private async spreadBlock(market: string): Promise<string | null> {
    const max = this.config.risk.maxSpreadPct;
    if (!isNum(max) || max <= 0) return null;
    const unknown = "Spread onbekend (orderboek niet opgehaald)";
    let book: OrderBook;
    try {
      book = await this.io.getOrderBook(market, 1, FAST);
    } catch {
      return unknown;
    }
    const bid = book?.bids?.[0]?.[0];
    const ask = book?.asks?.[0]?.[0];
    if (!isNum(bid) || !isNum(ask) || bid <= 0 || ask <= 0 || ask < bid) return unknown;
    const spread = ((ask - bid) / ((ask + bid) / 2)) * 100;
    if (!spreadAboveLimit(spread, max)) return null;
    // Zelfde afronding zou "0,30% > 0,30%" geven: dan meer decimalen tonen
    for (let d = 2; d <= 4; d++) {
      const a = spread.toLocaleString("nl-NL", { minimumFractionDigits: d, maximumFractionDigits: d });
      const b = max.toLocaleString("nl-NL", { minimumFractionDigits: d, maximumFractionDigits: d });
      if (a !== b) return `Spread te groot (${a}% > ${b}%)`;
    }
    return `Spread te groot (net boven je maximum van ${fmtPct2(max)})`;
  }

  // ───────────────────────────── v2: rondes ─────────────────────────────

  /** Openingstijd van de nieuwste gesloten candle op `now` (= de ronde). */
  private roundKeyAt(now: number, interval: Interval = this.config.interval): number {
    const ms = INTERVAL_MS[interval];
    return Math.floor(now / ms) * ms - ms;
  }

  /**
   * Begint zo nodig een nieuwe ronde. Kandidaten van een eerdere ronde die nog niet
   * verwerkt zijn, gaan eerst nog door de kansenronde (meestal zijn ze dan verlopen).
   */
  private async beginRound(now: number): Promise<RoundState> {
    const key = this.roundKeyAt(now);
    const cur = this.round;
    if (cur && cur.key === key) return cur;
    if (this.pool.size > 0) {
      if (cur) {
        try {
          await this.flushRound(now, cur);
        } catch (err) {
          this.log("error", `Fout in de kansenronde: ${errorMessage(err)}`);
        }
      }
      this.pool.clear();
    }
    const round: RoundState = { key, startedAt: now, completedAt: null, candidates: 0, filterLogged: false };
    this.round = round;
    return round;
  }

  /** Moet deze markt (nu) opgehaald worden voor ronde `key`? */
  private needsFetch(market: string, key: number, now: number): boolean {
    const s = this.scanState.get(market);
    if (!s || s.interval !== this.config.interval) return true;
    if (s.status === "error") return now - s.at >= FETCH_RETRY_MS;
    if (s.round !== key) return true;
    if (s.status === "retry") return s.seq < this.tickSeq;
    return false;
  }

  /** Telt deze markt als "klaar" voor ronde `key`? (Mislukt telt ook, tot de nieuwe poging.) */
  private doneForRound(market: string, key: number, now: number): boolean {
    const s = this.scanState.get(market);
    if (!s || s.interval !== this.config.interval) return false;
    if (s.status === "error") return s.round === key || now - s.at < FETCH_RETRY_MS;
    return s.round === key && s.status !== "retry";
  }

  private inFetchBackoff(market: string, now: number): boolean {
    const s = this.scanState.get(market);
    return !!s && s.interval === this.config.interval && s.status === "error" && now - s.at < FETCH_RETRY_MS;
  }

  /** Legt vast dat de candles van een markt zijn opgehaald (of dat dat mislukte). */
  private markFetched(
    market: string,
    now: number,
    interval: Interval,
    res: { ok: true; newestClosed: number | undefined } | { ok: false; error: string },
  ): void {
    const ms = INTERVAL_MS[interval];
    const key = this.roundKeyAt(now, interval);
    const prev = this.scanState.get(market);
    const retried = !!prev && prev.interval === interval && prev.round === key && prev.retried;
    const base = { interval, round: key, at: now, seq: this.tickSeq, retried };
    if (!res.ok) {
      this.scanState.set(market, { ...base, status: "error", stale: false, error: res.error });
      return;
    }
    const stale = res.newestClosed === undefined || res.newestClosed < key;
    // Vlak na het sluiten had de beurs de candle misschien nog niet: één nieuwe poging.
    if (stale && !retried && now - (key + ms) < LATE_CANDLE_WINDOW_MS) {
      this.scanState.set(market, { ...base, status: "retry", retried: true, stale });
      return;
    }
    this.scanState.set(market, { ...base, status: "ok", stale });
  }

  private async fetchCandles(market: string, req: FeedRequestOptions): Promise<CandleFetch> {
    const cfg = this.config;
    const interval = cfg.interval;
    try {
      // Genoeg candles voor de warmup van de strategieën, ook als historyCandles laag staat:
      // anders valt bijv. ema-trend live stil terwijl de backtest hem wel gebruikt.
      const raw = await this.io.getCandles(market, interval, candlesToFetch(cfg), req);
      return { market, interval, ok: true, candles: sanitizeCandles(raw) };
    } catch (err) {
      return { market, interval, ok: false, error: errorMessage(err), ...(isRateLimited(err) ? { rateLimited: true } : {}) };
    }
  }

  /** Zo lang (ms) mag het beoordelen van markten per tick nieuwe verzoeken starten. */
  private scanBudgetMs(): number {
    return Math.max(1_000, Math.min(this.config.pollMs, SCAN_TIME_BUDGET_MS));
  }

  /**
   * 6. Actieve markten zonder positie die voor deze ronde nog opgehaald moeten worden:
   * hooguit {@link SCAN_BATCH_PER_TICK} per tick (de langst niet opgehaalde eerst, verder in
   * actieve volgorde), candles met hooguit {@link SCAN_CONCURRENCY} tegelijk ophalen,
   * daarna op volgorde verwerken. Stopt als de bot intussen gestopt is.
   */
  private async scanDueMarkets(active: readonly string[], held: Set<string>, now: number, round: RoundState): Promise<void> {
    const interval = this.config.interval;
    const lastRound = (m: string): number => {
      const s = this.scanState.get(m);
      return s && s.interval === interval ? s.round : Number.NEGATIVE_INFINITY;
    };
    const due = active.filter((m) => !held.has(m) && this.needsFetch(m, round.key, now));
    const batch = [...due]
      .sort((a, b) => {
        const x = lastRound(a);
        const y = lastRound(b);
        return x === y ? 0 : x < y ? -1 : 1;
      })
      .slice(0, SCAN_BATCH_PER_TICK);
    const pick = new Set(batch);
    if (!this.hasBulkPrices()) {
      // Zonder één verzoek voor alle koersen: de eerste markten elke tick vers houden (zoals vóór v2).
      for (const m of active.slice(0, PRICE_FALLBACK_MARKETS)) {
        if (!held.has(m) && !pick.has(m) && !this.inFetchBackoff(m, now)) pick.add(m);
      }
    }
    const list = active.filter((m) => pick.has(m));
    if (list.length === 0) return;
    // Geen nieuwe verzoeken meer na het tijdsbudget of als de rate limit (bijna) op is: de
    // rest blijft "nog te doen" voor de volgende tick (open posities gaan altijd voor).
    const started = this.nowFn();
    const budget = this.scanBudgetMs();
    let limited = false;
    const results = await mapLimit(
      list,
      SCAN_CONCURRENCY,
      () => this.buyAllowed() && !limited && this.nowFn() - started < budget,
      async (m) => {
        const r = await this.fetchCandles(m, FAST);
        if (!r.ok && r.rateLimited) limited = true;
        return r;
      },
    );
    if (limited) {
      this.logThrottled(
        "scan:ratelimit",
        "warn",
        "Rate limit van Bitvavo bijna bereikt: de bot bekijkt de overige munten zodra er weer ruimte is (open posities worden gewoon bewaakt)",
      );
    }
    const failed: { market: string; error: string }[] = [];
    const empty: string[] = [];
    for (const r of results) {
      // Gestopt / noodstop: de rest niet meer beoordelen (die blijven voor een volgende keer).
      if (!r || !this.buyAllowed()) break;
      // Wegens de rate limit overgeslagen: geen fout, de volgende tick opnieuw.
      if (!r.ok && r.rateLimited) continue;
      try {
        await this.processMarket(r.market, now, { pre: r, quiet: true });
      } catch (err) {
        this.log("error", `Fout bij verwerken van ${r.market}: ${errorMessage(err)}`);
      }
      if (!r.ok) failed.push({ market: r.market, error: r.error });
      else if (r.candles.length === 0) empty.push(r.market);
    }
    this.logFeedProblems(failed, empty);
  }

  /** Mislukte markten melden: een paar afzonderlijk (zoals vroeger), veel in één regel. */
  private logFeedProblems(failed: { market: string; error: string }[], empty: string[]): void {
    if (failed.length > 0 && failed.length <= FEED_LOG_DETAIL_MAX) {
      for (const f of failed) {
        this.logThrottled(
          `feed:${f.market}`,
          "warn",
          `Koersdata voor ${f.market} niet beschikbaar: ${f.error} — markt deze ronde overgeslagen`,
        );
      }
    } else if (failed.length > FEED_LOG_DETAIL_MAX) {
      this.logThrottled(
        "feed:batch",
        "warn",
        `Koersdata voor ${failed.length} markten niet beschikbaar (${fmtNameList(failed.map((f) => f.market))}): ${failed[0].error} — ` +
          `de bot probeert die markten over ongeveer een minuut opnieuw`,
        WARN_THROTTLE_MS,
        true,
      );
    }
    if (empty.length > 0 && empty.length <= FEED_LOG_DETAIL_MAX) {
      for (const m of empty) this.logThrottled(`feed:${m}`, "warn", `Geen candles ontvangen voor ${m} — markt overgeslagen`);
    } else if (empty.length > FEED_LOG_DETAIL_MAX) {
      this.logThrottled(
        "feed:empty",
        "warn",
        `Geen candles ontvangen voor ${empty.length} markten (${fmtNameList(empty)}) — overgeslagen`,
        WARN_THROTTLE_MS,
        true,
      );
    }
  }

  /**
   * 8. Kansenronde als de ronde rond is (elke actieve markt beoordeeld of mislukt), of
   * uiterlijk {@link ENTRY_ROUND_MAX_WAIT_MS} na het begin (bij korte intervallen hooguit
   * een half interval, anders verlopen de signalen voordat ze aan de beurt zijn).
   */
  private async maybeFlushRound(active: readonly string[], now: number, round: RoundState): Promise<void> {
    // Intussen gestopt / gereset / ander interval: de ronde bestaat niet meer.
    if (this.round !== round) return;
    const complete = active.every((m) => this.doneForRound(m, round.key, now));
    const maxWait = Math.min(ENTRY_ROUND_MAX_WAIT_MS, INTERVAL_MS[this.config.interval] / 2);
    if (complete && round.completedAt === null) {
      round.completedAt = now;
      await this.flushRound(now, round);
    } else if (this.pool.size > 0 && (complete || now - round.startedAt >= maxWait)) {
      await this.flushRound(now, round);
    }
  }

  private setNote(market: string, round: RoundState | null, status: RoundNote["status"], note?: string, rank?: number): void {
    const key = round?.key ?? this.roundKeyAt(this.nowFn());
    this.roundNotes.set(market, {
      round: key,
      status,
      ...(note ? { note } : {}),
      ...(rank !== undefined ? { rank } : {}),
    });
  }

  /** Koopsignaal (actieve markt, geen positie, nog niet verhandeld) → kandidaat voor de kansenronde. */
  private addCandidate(market: string, decision: EnsembleDecision): void {
    const round = this.round;
    if (!this.pool.has(market) && round) round.candidates += 1;
    this.pool.set(market, decision);
    this.setNote(market, round, "candidate", "Koopsignaal: wacht tot alle munten beoordeeld zijn");
  }

  /** Waarom er in deze kansenronde niets meer gekocht kan worden, of null. */
  private entryStopNote(reserved: number): string | null {
    if (!this.buyAllowed()) return "Koopsignaal, maar de bot is gestopt";
    const halt = this.refreshHalt();
    if (halt.halted && halt.dailyTarget === true) return "Koopsignaal, maar de dagwinst is vandaag vastgezet — morgen koopt de bot weer";
    if (halt.halted) return `Koopsignaal, maar nieuwe aankopen zijn gepauzeerd (${halt.reason ?? "risicolimiet bereikt"})`;
    const max = this.config.risk.maxOpenPositions;
    if (isNum(max) && this.positions.length + reserved >= max) {
      return `Koopsignaal, maar geen vrije plek (max. ${max} ${max === 1 ? "positie" : "posities"})`;
    }
    return null;
  }

  /**
   * De kansenronde: verlopen signalen weg, rangschikken (score, relatieve sterkte,
   * volume), en per kandidaat: vrije plek? → trendfilter → spreadlimiet → `tryEntry`.
   */
  private async flushRound(now: number, round: RoundState): Promise<void> {
    const interval = this.config.interval;
    const ms = INTERVAL_MS[interval];
    const epoch = this.epoch;
    // Na elke await: bestaat deze ronde nog? (Paper-reset, ander interval en stop wissen hem.)
    const gone = (): boolean => this.round !== round || this.epoch !== epoch || this.config.interval !== interval;
    // Vlak vóór een order (ook na de saldo-controle in live): nog steeds geldig?
    const invalid = (market: string): string | null =>
      gone()
        ? "de instellingen of het account zijn tijdens deze ronde gewijzigd"
        : !this.isActive(market)
          ? "de bot volgt deze markt niet meer"
          : null;
    const entries = [...this.pool.entries()];
    this.pool.clear();
    const btc = this.tickers.get(MARKET_FILTER_MARKET);
    const cands: EntryCandidate[] = [];
    for (const [market, decision] of entries) {
      if (!(now <= decision.time + 2 * ms)) {
        this.setNote(market, round, "blocked", "Koopsignaal verlopen: de candle is te lang geleden gesloten");
        continue;
      }
      if (!this.isActive(market)) {
        this.roundNotes.delete(market);
        continue;
      }
      if (this.positions.some((p) => p.market === market)) continue;
      const t = this.tickers.get(market);
      cands.push({
        market,
        decision,
        relStrengthPct: relativeStrengthPct(t?.changePct, btc?.changePct),
        volumeQuote24h: t && isNum(t.volumeQuote) ? t.volumeQuote : null,
      });
    }
    const ranked = rankCandidates(cands);
    let reserved = 0;
    let filterBlocked = 0;
    let filterText: string | null = null;
    let redone: string | null = null;
    for (let i = 0; i < ranked.length; i++) {
      if (gone()) return;
      const { market, decision } = ranked[i];
      const rank = i + 1;
      const stop = this.entryStopNote(reserved);
      if (stop) {
        for (let j = i; j < ranked.length; j++) this.setNote(ranked[j].market, round, "candidate", stop, j + 1);
        break;
      }
      // De marktlijst kan tijdens deze ronde gewijzigd zijn: alleen actieve markten kopen.
      if (!this.isActive(market)) {
        this.roundNotes.delete(market);
        continue;
      }
      // Instellingen per kandidaat lezen (ze kunnen tijdens de ronde veranderen).
      const cfg = this.config;
      const tf = cfg.ensemble.trendFilter;
      if (trendFilterActive(tf)) {
        const gate = await this.trendGateFor(market, tf, decision.time + ms, now);
        if (gone()) return;
        if (!gate.allowed) {
          const reason = gate.reason ?? "Trendfilter: geen aankoop";
          this.setNote(market, round, "blocked", reason, rank);
          if (reason.startsWith("Marktfilter")) {
            filterBlocked += 1;
            filterText ??= reason.replace(/^Marktfilter: /, "").replace(/ — geen nieuwe aankopen$/, "");
          } else {
            this.logRejection(market, decision.time, `Geen koop ${market}: ${reason}`);
          }
          continue;
        }
      }
      const spread = await this.spreadBlock(market);
      if (gone()) return;
      if (spread) {
        this.setNote(market, round, "blocked", spread, rank);
        this.logRejection(market, decision.time, `Geen koop ${market}: ${spread}`);
        continue;
      }
      // Tijdens het wachten gewijzigde instellingen (bijv. trendfilter aangezet): deze
      // kandidaat één keer opnieuw langs alle controles.
      if (this.config !== cfg && redone !== market) {
        redone = market;
        i -= 1;
        continue;
      }
      if (!this.isActive(market)) {
        this.roundNotes.delete(market);
        continue;
      }
      this.entryRejection.delete(market);
      const price = this.prices[market];
      const outcome = await this.tryEntry(market, decision, isNum(price) && price > 0 ? price : decision.price, now, () =>
        invalid(market),
      );
      if (gone()) return;
      if (outcome === "opened") {
        this.roundNotes.delete(market);
      } else if (outcome === "would-buy") {
        // Niet gearmd: telt wel als bezette plek, zodat de log laat zien wat de bot zou doen.
        reserved += 1;
        this.setNote(market, round, "blocked", this.entryRejection.get(market), rank);
      } else if (outcome === "unknown") {
        this.setNote(market, round, "blocked", "Kooporder met onbekende uitkomst: controleer je Bitvavo-account", rank);
      } else {
        this.setNote(market, round, "blocked", this.entryRejection.get(market) ?? "Niet gekocht (zie het logboek)", rank);
      }
    }
    if (filterBlocked > 0 && !round.filterLogged) {
      round.filterLogged = true;
      this.log(
        "info",
        `Marktfilter: ${filterBlocked} ${filterBlocked === 1 ? "koopsignaal" : "koopsignalen"} genegeerd — ${filterText ?? "Bitcoin staat niet boven zijn gemiddelde"}`,
      );
    }
    this.lastRoundCandidates = round.candidates;
    this.lastRoundCompletedAt = now;
  }

  // ───────────────────────────── v2: snapshot ─────────────────────────────

  /** Alle beslissingen bij ≤ SNAPSHOT_DECISIONS_LIMIT actieve markten; anders een relevante selectie. */
  private snapshotDecisions(active: readonly string[]): Record<string, EnsembleDecision> {
    if (active.length <= SNAPSHOT_DECISIONS_LIMIT) return { ...this.decisions };
    const keep = new Set([...this.positions.map((p) => p.market), ...active.slice(0, SNAPSHOT_DECISIONS_LIMIT)]);
    const out: Record<string, EnsembleDecision> = {};
    for (const [m, d] of Object.entries(this.decisions)) {
      if (keep.has(m) || d.action !== "hold") out[m] = d;
    }
    return out;
  }

  private radarRows(active: readonly string[], now: number): RadarRow[] {
    const positionMarkets = new Set(this.positions.map((p) => p.market));
    const markets = uniq([...active, ...positionMarkets]);
    const tf = this.config.ensemble.trendFilter;
    const roundKey = this.round?.key ?? null;
    return markets.map((market) => {
      const d = this.decisions[market];
      const t = this.tickers.get(market);
      const price = this.prices[market];
      const note = this.roundNotes.get(market);
      const current = note && roundKey !== null && note.round === roundKey ? note : undefined;
      const s = this.scanState.get(market);
      const scan = s && s.interval === this.config.interval ? s : undefined;
      let status: RadarStatus;
      let text: string | undefined;
      if (positionMarkets.has(market)) {
        status = "position";
      } else if (current) {
        status = current.status;
        text = current.note;
      } else if (scan?.status === "error") {
        status = "error";
        text = `Koersdata ophalen mislukt${scan.error ? `: ${scan.error}` : ""}`;
      } else if (d && d.action === "buy") {
        // Koopsignaal zonder uitkomst in de lopende ronde: al beoordeeld (bijv. vóór Stop → Start,
        // of al gekocht en weer verkocht). Op dezelfde candle koopt de bot niet opnieuw.
        status = "blocked";
        text = scan?.stale
          ? "Geen nieuwe candle: er wordt weinig gehandeld"
          : "Koopsignaal al beoordeeld: de bot koopt pas weer na een nieuwe candle";
      } else if (scan || d) {
        status = "watching";
        if (scan?.stale) text = "Geen nieuwe candle: er wordt weinig gehandeld";
      } else {
        status = "pending";
      }
      const row: RadarRow = {
        market,
        price: isNum(price) && price > 0 ? price : null,
        changePct24h: t && isNum(t.changePct) ? t.changePct : null,
        volumeQuote24h: t && isNum(t.volumeQuote) ? t.volumeQuote : null,
        spreadPct: t ? tickerSpreadPct(t) : null,
        action: d ? d.action : null,
        score: d && isNum(d.score) ? d.score : null,
        regime: d ? d.regime : null,
        evaluatedAt: d && isNum(d.time) ? d.time : null,
        trendOk: tf && tf.coin === true ? this.coinTrendOk(market, tf, now) : null,
        status,
      };
      if (current?.rank !== undefined) row.rank = current.rank;
      if (text) row.note = text;
      return row;
    });
  }

  private coinTrendOk(market: string, tf: TrendFilterConfig, now: number): boolean | null {
    const cache = market === MARKET_FILTER_MARKET && tf.market ? this.marketTrend : this.coinTrend.get(market);
    if (!cache || cache.key !== trendKey(tf) || cache.fetchedAt === null) return null;
    return trendStateAt(this.usableTrendCandles(cache, tf, now), tf.interval, tf.period, now).ok;
  }

  private marketFilterView(now: number): MarketFilterView | null {
    const tf = this.config.ensemble.trendFilter;
    if (!tf || tf.market !== true) return null;
    const cache = this.marketTrend && this.marketTrend.key === trendKey(tf) ? this.marketTrend : null;
    const base = { market: MARKET_FILTER_MARKET, interval: tf.interval, period: tf.period };
    if (!cache) {
      return {
        ...base,
        ok: null,
        close: null,
        sma: null,
        checkedAt: null,
        note: "Marktfilter: nog niet gecontroleerd (gebeurt zodra de bot draait) — tot dan geen nieuwe aankopen",
      };
    }
    const st = trendStateAt(this.usableTrendCandles(cache, tf, now), tf.interval, tf.period, now);
    const who = `Bitcoin (${MARKET_FILTER_MARKET})`;
    const note =
      ((st.ok === null ? this.staleTrendText(who, cache, tf, now) : null) ?? describeTrend(who, st, tf)) +
      (st.ok === true ? " — nieuwe aankopen toegestaan" : " — geen nieuwe aankopen") +
      (cache.error !== null ? ` (ophalen mislukt: ${cache.error})` : "");
    return { ...base, ok: st.ok, close: st.close, sma: st.sma, checkedAt: cache.fetchedAt, note };
  }

  /**
   * Haalt de bot elke candle alle actieve markten? Hooguit {@link SCAN_BATCH_PER_TICK} per
   * tick en één tick per pollMs (+ ~3 s): anders een Nederlandse waarschuwing, anders null.
   */
  private capacityNote(active: number): string | null {
    if (active <= SCAN_BATCH_PER_TICK) return null;
    const ms = INTERVAL_MS[this.config.interval];
    const cycle = Math.max(MIN_POLL_MS, this.config.pollMs) + EST_TICK_MS;
    const perCandle = Math.floor((SCAN_BATCH_PER_TICK * ms) / cycle);
    if (!isNum(perCandle) || perCandle >= active) return null;
    return (
      `Te veel munten voor dit interval: de bot bekijkt ongeveer ${perCandle} van de ${active} munten per candle ` +
      `(hooguit ${SCAN_BATCH_PER_TICK} per keer verversen). Kies minder munten, een langer interval of zet "Ververs elke" lager.`
    );
  }

  private universeView(active: readonly string[], now: number): UniverseView {
    const u = this.config.universe;
    const capacity = this.capacityNote(active.length);
    if (!u || u.mode !== "auto") {
      return {
        mode: "manual",
        count: active.length,
        requested: this.manualMarkets().length,
        updatedAt: null,
        ...(capacity ? { note: capacity } : {}),
      };
    }
    const sel = this.autoSel;
    const p = sel ? null : this.usablePersistedAuto(now);
    let note = this.universeNote;
    if (!note && !sel) {
      note = p
        ? "Opgeslagen automatische keuze; de bot kiest opnieuw zodra hij draait"
        : "Nog geen automatische keuze gemaakt: de bot gebruikt voorlopig je eigen lijst";
    }
    if (capacity) note = note ? `${note}. ${capacity}` : capacity;
    return {
      mode: "auto",
      count: active.length,
      requested: u.count,
      updatedAt: sel?.at ?? p?.at ?? null,
      ...(sel ? { eligible: sel.eligible, excluded: sel.excluded } : {}),
      ...(note ? { note } : {}),
    };
  }

  private scanProgress(active: readonly string[], now: number): ScanProgress {
    const round = this.round;
    return {
      done: round ? active.filter((m) => this.doneForRound(m, round.key, now)).length : 0,
      total: active.length,
      roundStartedAt: round && round.completedAt === null ? round.startedAt : null,
      lastRoundCompletedAt: this.lastRoundCompletedAt,
      candidates: this.lastRoundCandidates,
    };
  }

  /** Actuele koersen voor open posities zonder bekende koers (bijv. direct na een herstart). */
  private async loadMissingPrices(): Promise<void> {
    for (const m of new Set(this.positions.map((p) => p.market))) {
      const known = this.prices[m];
      if (isNum(known) && known > 0) continue;
      try {
        const p = await this.io.getPrice(m, POSITION);
        if (isNum(p) && p > 0) this.prices[m] = p;
      } catch {
        // dagwissel wacht dan op de volgende tick
      }
    }
  }

  private checkDayRollover(now: number): void {
    const key = dayKey(now);
    if (key === this.account.dayKey) return;
    // Zonder actuele koers zou een positie op de instapkoers gewaardeerd worden
    // en klopt de startequity van de nieuwe dag niet: dan een tick wachten.
    const missing = this.positions.filter((p) => !(isNum(this.prices[p.market]) && this.prices[p.market] > 0));
    if (missing.length > 0) {
      this.logThrottled(
        "rollover",
        "warn",
        `Dagwissel uitgesteld: nog geen actuele koers voor ${[...new Set(missing.map((p) => p.market))].join(", ")}`,
      );
      return;
    }
    this.updateEquity();
    this.account.dayKey = key;
    this.account.dayStartEquity = this.account.equity;
    this.account.tradesToday = 0;
    this.account.realizedPnlToday = 0;
    this.skimmedToday = 0;
    this.returnedToday = 0;
    this.addedToday = 0;
    this.haltedDayKey = null;
    this.targetDayKey = null;
    this.targetArmedDayKey = null;
    // Een dagdoel-verkoop van gisteren die nog niet lukte (afgewezen, live niet gearmd…)
    // vervalt: vandaag is het doel niet gehaald. De positie krijgt weer de gewone stop- en
    // koersdoelbewaking. Een verkoop met onbekende uitkomst blijft wel staan.
    const dropped: string[] = [];
    for (const [id, reason] of [...this.pendingExit]) {
      if (reason !== "daily-target" || this.unknownSellFor(id)) continue;
      this.pendingExit.delete(id);
      this.throttle.delete(`wouldsell:${id}`);
      const pos = this.positions.find((p) => p.id === id);
      if (pos) dropped.push(pos.market);
    }
    this.updateEquity();
    this.log("info", `Nieuwe handelsdag (${key}): dagtellers gereset, startequity ${fmtEur(this.account.equity)}`);
    if (dropped.length > 0) {
      this.log(
        "info",
        `Verkoop om de winst van gisteren vast te zetten vervalt voor ${uniq(dropped).join(", ")}: ` +
          "de positie blijft open en wordt weer gewoon bewaakt (stop-loss en koersdoel)",
      );
    }
  }

  /**
   * Eén markt verwerken: candles (zelf ophalen, of `opts.pre` uit de parallelle batch) →
   * "price" + "candle" events → open posities bewaken → bij een nieuwe gesloten candle:
   * beslissing → verkoopsignaal-exit, of een koopkandidaat voor de kansenronde.
   * `opts.quiet`: fouten bij het ophalen niet zelf melden (de batch vat ze samen).
   * Zonder `opts.pre` (markten met een positie) haalt hij zelf op, met voorrang.
   * Geeft true als de candles verwerkt zijn (posities bewaakt), false als ophalen mislukte.
   */
  private async processMarket(
    market: string,
    now: number,
    opts: { pre?: CandleFetch; quiet?: boolean } = {},
  ): Promise<boolean> {
    const fetched = opts.pre ?? (await this.fetchCandles(market, POSITION));
    const cfg = this.config;
    const interval = fetched.interval;
    // Interval intussen gewijzigd: deze candles horen er niet meer bij (volgende tick opnieuw).
    if (interval !== cfg.interval) return false;
    if (!fetched.ok) {
      this.markFetched(market, now, interval, { ok: false, error: fetched.error });
      if (!opts.quiet) {
        this.logThrottled(
          `feed:${market}`,
          "warn",
          `Koersdata voor ${market} niet beschikbaar: ${fetched.error} — markt deze ronde overgeslagen`,
        );
      }
      return false;
    }
    const candles = fetched.candles;
    if (candles.length === 0) {
      this.markFetched(market, now, interval, { ok: true, newestClosed: undefined });
      if (!opts.quiet) this.logThrottled(`feed:${market}`, "warn", `Geen candles ontvangen voor ${market} — markt overgeslagen`);
      return false;
    }
    this.throttle.delete(`feed:${market}`);

    const last = candles[candles.length - 1];
    const price = last.close;
    this.prices[market] = price;
    this.emitEvent("price", { market, price, time: now });
    this.emitEvent("candle", { market, interval, candle: { ...last } });

    const closed = closedCandles(candles, interval, now);
    const latest = closed.length > 0 ? closed[closed.length - 1] : undefined;
    this.markFetched(market, now, interval, { ok: true, newestClosed: latest?.time });
    const prevEval = this.lastEvaluated.get(market);
    const isNew = latest !== undefined && (prevEval === undefined || latest.time > prevEval);

    let decision: EnsembleDecision | undefined;
    const atrByTime = new Map<number, number>();
    if (isNew && latest) {
      // Vooraf markeren: een fout in de strategie wordt zo niet elke tick herhaald.
      this.lastEvaluated.set(market, latest.time);
      try {
        const all = this.decideFn(market, closed, cfg.ensemble);
        for (const d of all) {
          if (d && isNum(d.time) && isNum(d.atr)) atrByTime.set(d.time, d.atr);
        }
        decision = all.length > 0 ? all[all.length - 1] : undefined;
        if (decision && isNum(decision.atr) && decision.atr > 0) this.lastAtr.set(market, decision.atr);
      } catch (err) {
        this.log("error", `Strategie-evaluatie voor ${market} mislukt: ${errorMessage(err)}`);
      }
    }

    // Open posities bewaken (exits gaan altijd door, ook als de handel gepauzeerd is).
    for (const pos of this.positions.filter((p) => p.market === market)) {
      await this.managePosition(pos, closed, atrByTime, price, now);
    }

    if (!decision) return true;
    this.decisions[market] = decision;
    this.emitEvent("decision", decision);

    const pos = this.positions.find((p) => p.market === market);
    if (pos) {
      if (!this.pendingExit.has(pos.id) && this.safeShouldExit(pos, decision)) {
        await this.exitPosition(pos, "signal", price, false);
      }
    } else if (decision.action === "buy" && this.isActive(market)) {
      // Alleen actieve markten mogen gekocht worden. Zelfde vooraf-controles als tryEntry.
      const before = this.evaluatedBeforeRestart.get(market);
      if (before !== undefined && decision.time <= before) {
        this.logRejection(
          market,
          decision.time,
          `Geen koop ${market}: deze candle was vóór de herstart al beoordeeld — de bot wacht op de volgende candle`,
        );
        this.setNote(market, this.round, "blocked", this.entryRejection.get(market));
        return true;
      }
      const candleClose = decision.time + INTERVAL_MS[interval];
      if (this.trades.some((t) => t.market === market && t.entryTime >= candleClose)) {
        this.logRejection(market, decision.time, `Geen koop ${market}: het signaal van deze candle is al verhandeld`);
        this.setNote(market, this.round, "blocked", this.entryRejection.get(market));
        return true;
      }
      // Kopen gebeurt in de kansenronde (de sterkste kandidaten eerst).
      this.addCandidate(market, decision);
    }
    return true;
  }

  private async managePosition(
    pos: Position,
    closed: Candle[],
    atrByTime: Map<number, number>,
    price: number,
    now: number,
  ): Promise<void> {
    if (!this.positions.includes(pos)) return;
    const cursor = this.cursorFor(pos);
    const pending = this.pendingExit.get(pos.id);
    if (pending) {
      // Exit loopt al: geen stops/doelen meer evalueren, maar candlesHeld telt
      // wel door (net als in de backtester).
      for (const c of closed) {
        if (c.time <= cursor || c.time < pos.entryTime) continue;
        pos.candlesHeld += 1;
        this.posCursor.set(pos.id, c.time);
      }
      await this.exitPosition(pos, pending, price, false);
      return;
    }

    // (1) Nieuwe gesloten candles sinds de vorige evaluatie, alleen vanaf de entry.
    for (const c of closed) {
      if (c.time <= cursor || c.time < pos.entryTime) continue;
      pos.candlesHeld += 1;
      this.posCursor.set(pos.id, c.time);
      const atr = atrByTime.get(c.time) ?? this.lastAtr.get(pos.market) ?? Number.NaN;
      const upd = this.safeUpdate(pos, c, atr, true);
      if (upd.exit) {
        await this.exitPosition(pos, upd.exitReason ?? "stop-loss", price, false);
        return;
      }
    }

    // (2) De actuele koers als synthetische candle.
    const synthetic: Candle = { time: now, open: price, high: price, low: price, close: price, volume: 0 };
    const upd = this.safeUpdate(pos, synthetic, this.lastAtr.get(pos.market) ?? Number.NaN, false);
    if (upd.exit) await this.exitPosition(pos, upd.exitReason ?? "stop-loss", price, false);
  }

  /**
   * Openingstijd van de laatst verwerkte gesloten candle voor deze positie.
   * Na een herstart (geen cursor in geheugen) wordt hij geschat uit entryTime
   * en candlesHeld, zodat al getelde candles niet dubbel tellen.
   */
  private cursorFor(pos: Position): number {
    const known = this.posCursor.get(pos.id);
    if (known !== undefined) return known;
    if (pos.candlesHeld <= 0) return Number.NEGATIVE_INFINITY;
    const ms = INTERVAL_MS[this.config.interval];
    const first = Math.ceil(pos.entryTime / ms) * ms;
    const est = first + (pos.candlesHeld - 1) * ms;
    this.posCursor.set(pos.id, est);
    return est;
  }

  private safeUpdate(pos: Position, candle: Candle, atr: number, closedCandle: boolean): PositionUpdate {
    let upd: PositionUpdate;
    try {
      upd = this.risk.updatePosition({ ...pos }, candle, atr, closedCandle);
    } catch (err) {
      this.logThrottled(
        `risk:${pos.id}`,
        "error",
        `Risicocontrole voor ${pos.market} mislukt: ${errorMessage(err)} — terugval op de vaste stop`,
      );
      upd = {
        exit: candle.low <= pos.stopPrice,
        exitReason: "stop-loss",
        stopPrice: pos.stopPrice,
        highestPrice: Math.max(pos.highestPrice, candle.high),
      };
    }
    // Stops dalen nooit; hoogste koers ook niet.
    if (isNum(upd.stopPrice) && upd.stopPrice > pos.stopPrice) pos.stopPrice = upd.stopPrice;
    if (isNum(upd.highestPrice) && upd.highestPrice > pos.highestPrice) pos.highestPrice = upd.highestPrice;
    return upd;
  }

  private safeShouldExit(pos: Position, decision: EnsembleDecision): boolean {
    try {
      return this.risk.shouldExitOnSignal({ ...pos }, decision);
    } catch (err) {
      this.log("error", `Signaalcontrole voor ${pos.market} mislukt: ${errorMessage(err)}`);
      return false;
    }
  }

  // ───────────────────────────── Entry ─────────────────────────────

  /** Onthoudt waarom een koop niet doorging (korte tekst voor de munten-radar). */
  private entryRejected(market: string, note: string): "rejected" {
    this.entryRejection.set(market, note);
    return "rejected";
  }

  /**
   * `stillValid` (kansenronde): geeft een reden als de koop vlak vóór de order niet meer
   * mag (instellingen/account gewijzigd, markt niet meer actief), anders null.
   */
  private async tryEntry(
    market: string,
    decision: EnsembleDecision,
    price: number,
    now: number,
    stillValid?: () => string | null,
  ): Promise<EntryOutcome> {
    // Gestopt / noodstop tijdens deze ronde: geen nieuwe posities meer.
    if (!this.buyAllowed()) return this.entryRejected(market, "De bot is gestopt tijdens deze ronde");
    if (this.positions.some((p) => p.market === market)) {
      return this.entryRejected(market, "Er staat al een positie in deze markt");
    }
    // Een entry op of na het sluiten van deze candle kan alleen van dit signaal
    // komen: niet nog eens kopen (na een herstart of een gewijzigde marktlijst).
    const candleClose = decision.time + INTERVAL_MS[this.config.interval];
    if (this.trades.some((t) => t.market === market && t.entryTime >= candleClose)) {
      this.logRejection(market, decision.time, `Geen koop ${market}: het signaal van deze candle is al verhandeld`);
      return "rejected";
    }
    const halt = this.refreshHalt();
    // Gelogd bij de overgang naar "gepauzeerd".
    if (halt.halted) return this.entryRejected(market, `Nieuwe aankopen gepauzeerd: ${halt.reason ?? "risicolimiet bereikt"}`);
    if (this.unknownBuys.size > 0) {
      const markets = [...new Set([...this.unknownBuys.values()].map((u) => u.market))].join(", ");
      this.logRejection(
        market,
        decision.time,
        `Geen koop ${market}: kooporder met onbekende uitkomst in ${markets} — alle nieuwe entries gepauzeerd tot die opgehelderd is`,
      );
      return "rejected";
    }
    if ([...this.unknownSells.values()].some((u) => u.market === market)) {
      this.logRejection(
        market,
        decision.time,
        `Geen koop ${market}: verkooporder met onbekende uitkomst in deze markt — nieuwe entries geblokkeerd tot die opgehelderd is`,
      );
      return "rejected";
    }

    const info = this.marketInfo.get(market);
    let plan: EntryPlan;
    try {
      plan = this.risk.planEntry(decision, this.accountSnapshot(), info, now);
    } catch (err) {
      this.log("error", `Risicoplan voor ${market} mislukt: ${errorMessage(err)}`);
      return this.entryRejected(market, `Risicoplan mislukt: ${errorMessage(err)}`);
    }
    if (!plan.approved) {
      this.logRejection(
        market,
        decision.time,
        `Geen koop ${market} (${decisionSummary(decision)}): ${plan.reasons.join("; ") || "afgewezen door risicobeheer"}`,
      );
      return "rejected";
    }
    const q = plan.quoteAmount;
    if (!isNum(q) || q <= 0) {
      this.log("warn", `Ongeldig orderbedrag voor ${market} (${String(q)}) — koop overgeslagen`);
      return this.entryRejected(market, "Ongeldig orderbedrag van het risicoplan");
    }
    if (q > this.account.cashQuote + 1e-6) {
      this.log(
        "warn",
        `Orderbedrag ${fmtEur(q)} voor ${market} is hoger dan de beschikbare cash ${fmtEur(this.account.cashQuote)} — koop overgeslagen`,
      );
      return this.entryRejected(market, `Te weinig cash (${fmtEur(this.account.cashQuote)} beschikbaar, ${fmtEur(q)} nodig)`);
    }
    return this.openPosition(market, decision, plan, price, info, stillValid);
  }

  private async openPosition(
    market: string,
    decision: EnsembleDecision,
    plan: EntryPlan,
    price: number,
    info: MarketInfo | undefined,
    stillValid?: () => string | null,
  ): Promise<EntryOutcome> {
    const stopDist = plan.expectedEntryPrice - plan.stopPrice;
    const tpDist = plan.takeProfitPrice - plan.expectedEntryPrice;
    const preview =
      `${market} ${fmtEur(plan.quoteAmount)} @ ~${fmtPrice(price)}` +
      ` · stop ${fmtPrice(isNum(stopDist) ? price - stopDist : plan.stopPrice)}` +
      ` · doel ${fmtPrice(isNum(tpDist) ? price + tpDist : plan.takeProfitPrice)}` +
      ` (${decisionSummary(decision)})`;

    if (this.mode === "live" && !this.armed) {
      this.log("info", `Live mode niet gearmd: zou kopen ${preview}`);
      this.entryRejected(market, "Live niet gearmd: de bot zou hier kopen (arm de bot om echt te kopen)");
      return "would-buy";
    }

    const epoch = this.epoch;
    if (this.mode === "live") {
      const { quote } = splitMarket(market, info);
      let available: number;
      try {
        const balances = await this.broker.getBalances();
        available = balances.find((b) => b.symbol === quote)?.available ?? 0;
      } catch (err) {
        this.log("warn", `Kon ${quote}-saldo niet controleren (${errorMessage(err)}) — koop ${market} overgeslagen`);
        return this.entryRejected(market, `Kon het ${quote}-saldo op Bitvavo niet controleren`);
      }
      if (!isNum(available) || available < plan.quoteAmount) {
        this.log(
          "warn",
          `Onvoldoende ${quote}-saldo op Bitvavo (${fmtEur(available)} beschikbaar, ${fmtEur(plan.quoteAmount)} nodig) — koop ${market} overgeslagen`,
        );
        return this.entryRejected(market, `Onvoldoende ${quote}-saldo op Bitvavo`);
      }
    }
    const req: MarketOrderRequest = {
      market,
      side: "buy",
      amountQuote: plan.quoteAmount,
      clientOrderId: randomUUID(),
    };
    // Vlak vóór de order (na elke await): de gebruiker kan intussen gestopt/ontwapend hebben.
    if (!this.buyAllowed() || (this.mode === "live" && !this.armed)) {
      this.log("warn", `Koop ${market} geannuleerd: bot gestopt/ontwapend tijdens deze ronde`);
      return this.entryRejected(market, "Koop geannuleerd: de bot is gestopt of ontwapend");
    }
    const why = stillValid?.() ?? null;
    if (why) {
      this.log("warn", `Koop ${market} geannuleerd: ${why}`);
      return this.entryRejected(market, `Koop geannuleerd: ${why}`);
    }
    const { res, threw } = await this.placeOrder(req, price);
    if (epoch !== this.epoch) {
      this.log("warn", `Kooporder ${market} kwam binnen na een account-reset en wordt genegeerd`);
      return this.entryRejected(market, "Kooporder kwam binnen na een account-reset");
    }
    this.emitEvent("order", res);

    const unknown: UnknownBuy = {
      market,
      clientOrderId: (typeof res.clientOrderId === "string" && res.clientOrderId) || req.clientOrderId!,
      quoteAmount: plan.quoteAmount,
      at: this.nowFn(),
      stopDist: isNum(stopDist) ? stopDist : 0,
      tpDist: isNum(tpDist) ? tpDist : 0,
      entryReason: entryReasonText(decision),
    };
    // Onbekende uitkomst (live): NIET opnieuw versturen en geen positie openen,
    // maar wel onthouden: het geld kan al besteed zijn, dus alle entries pauzeren.
    if (this.isUnknownOutcome(res, threw)) {
      this.unknownBuys.set(unknown.clientOrderId, unknown);
      this.log(
        "error",
        `UITKOMST ONBEKEND bij koop ${market} (clientOrderId ${unknown.clientOrderId}): ${res.error ?? "geen antwoord van de broker"} — geen positie geopend en niet opnieuw verstuurd. ` +
          `Controleer je Bitvavo-account! Alle nieuwe entries zijn gepauzeerd tot de order bij Bitvavo is teruggevonden of jij de blokkade na controle opheft.`,
      );
      await this.persist(true);
      return "unknown";
    }

    // Beslis op status + gevulde hoeveelheid, niet op de aanwezigheid van `error`.
    const filledAmount = isNum(res.filledAmount) ? res.filledAmount : 0;
    if (res.status === "rejected" || filledAmount <= 0) {
      this.log(
        "warn",
        `Kooporder ${market} afgewezen: ${res.error ?? `status ${res.status}, niets gevuld`} — geen positie geopend`,
      );
      return this.entryRejected(market, `Kooporder afgewezen: ${res.error ?? `status ${res.status}, niets gevuld`}`);
    }
    const filledQuote =
      isNum(res.filledQuote) && res.filledQuote > 0 ? res.filledQuote : filledAmount * (res.avgPrice || price);
    const entryPrice = isNum(res.avgPrice) && res.avgPrice > 0 ? res.avgPrice : filledQuote / filledAmount;
    if (!isNum(entryPrice) || entryPrice <= 0) {
      this.log("error", `Kooporder ${market} gevuld zonder bruikbare prijs — controleer je account`);
      return this.entryRejected(market, "Kooporder gevuld zonder bruikbare prijs — controleer je account");
    }
    if (res.error) this.log("warn", `Melding bij koop ${market}: ${res.error}`);
    if (res.status !== "filled") {
      this.log(
        "warn",
        `Kooporder ${market} niet volledig gevuld (status ${res.status}); alleen het gevulde deel (${fmtEur(filledQuote)}) telt`,
      );
    }

    const fee = isNum(res.feeQuote) && res.feeQuote > 0 ? res.feeQuote : 0;
    let stop = isNum(stopDist) && stopDist > 0 ? entryPrice - stopDist : plan.stopPrice;
    if (!isNum(stop) || stop <= 0 || stop >= entryPrice) {
      stop = entryPrice * 0.97;
      this.log("warn", `Ongeldige stop in het plan voor ${market}; noodstop op -3% gezet (${fmtPrice(stop)})`);
    }
    let tp = isNum(tpDist) && tpDist > 0 ? entryPrice + tpDist : plan.takeProfitPrice;
    if (!isNum(tp) || tp <= entryPrice) tp = entryPrice + 2 * (entryPrice - stop);

    const pos: Position = {
      id: newId("pos"),
      market,
      side: "long",
      entryTime: this.nowFn(),
      entryPrice,
      amount: filledAmount,
      costQuote: filledQuote + fee,
      entryFeeQuote: fee,
      stopPrice: stop,
      initialStopPrice: stop,
      takeProfitPrice: tp,
      highestPrice: entryPrice,
      candlesHeld: 0,
      entryReason: entryReasonText(decision),
      ...(res.orderId ? { orderId: res.orderId } : {}),
    };
    this.positions.push(pos);
    this.account.cashQuote -= pos.costQuote;
    this.account.tradesToday += 1;
    this.account.feesPaid += fee;
    this.updateEquity();
    this.recordEquity(pos.entryTime, true);

    this.emitEvent("position-opened", { ...pos });
    this.log(
      "trade",
      `KOOP ${market} ${fmtEur(pos.costQuote)} @ ${fmtPrice(entryPrice)} · stop ${fmtPrice(stop)} · doel ${fmtPrice(tp)} (${decisionSummary(decision)})`,
    );
    if (this.isOpenOrUnknown(res)) {
      // Deels gevuld maar de order kan nog verder vullen: het gevulde deel is
      // geboekt (met stop), de rest blijft onbekend tot hij opgehelderd is.
      this.unknownBuys.set(unknown.clientOrderId, {
        ...unknown,
        positionId: pos.id,
        bookedAmount: filledAmount,
        bookedQuote: filledQuote,
        bookedFee: fee,
      });
      this.log(
        "error",
        `UITKOMST ONBEKEND bij koop ${market} (clientOrderId ${unknown.clientOrderId}): alleen het bekende deel is geboekt; de order kan nog verder vullen. ` +
          "Alle nieuwe entries zijn gepauzeerd tot dat opgehelderd is — controleer je Bitvavo-account.",
      );
    }
    await this.persist(true);
    return "opened";
  }

  /**
   * Live: probeert kooporders met onbekende uitkomst op te helderen via
   * `broker.lookupOrder` (optioneel). Een antwoord ZONDER "UITKOMST ONBEKEND"
   * (en niet meer open) is definitief: het gevulde deel dat nog niet geboekt is
   * wordt alsnog een positie (met stop), daarna vervalt de blokkade. `null`
   * (Bitvavo kent de order niet) pas als "niet geplaatst" beschouwen na
   * {@link NOT_FOUND_CONFIRMATIONS} getelde waarnemingen op rij én genoeg tijd
   * (zie {@link countNotFound}). Gooit het opzoeken: blijven wachten.
   * `countNulls` = false (noodstop): "niet gevonden" telt niet mee.
   */
  private async resolveUnknownBuys(countNulls: boolean): Promise<void> {
    const lookup = this.lookupFn();
    if (!lookup) return;
    let changed = false;
    for (const u of [...this.unknownBuys.values()]) {
      let res: OrderResult | null;
      try {
        res = await lookup(u.market, u.clientOrderId);
      } catch (err) {
        if (this.unknownBuys.get(u.clientOrderId) === u && this.resetNotFound(u)) changed = true;
        this.logThrottled(
          `unknown:${u.clientOrderId}`,
          "warn",
          `Kooporder ${u.market} (clientOrderId ${u.clientOrderId}) nog niet op te zoeken bij Bitvavo: ${errorMessage(err)} — nieuwe entries blijven gepauzeerd`,
        );
        continue;
      }
      // Intussen door de gebruiker opgeheven: niets meer mee doen.
      if (this.unknownBuys.get(u.clientOrderId) !== u) continue;
      if (res === null) {
        if (!countNulls) continue;
        const seen = this.countNotFound(u);
        if (seen === "uncounted") continue;
        changed = true;
        if (seen === "counted") {
          this.log(
            "info",
            `Kooporder ${u.market} met onbekende uitkomst (clientOrderId ${u.clientOrderId}) nog niet gevonden bij Bitvavo ` +
              `(${this.notFoundProgress(u)}) — ` +
              (this.running
                ? "de bot kijkt bij een volgende tick opnieuw; nieuwe entries blijven gepauzeerd"
                : "de bot staat stil: start hem opnieuw om verder te zoeken (nieuwe entries blijven gepauzeerd)"),
          );
          continue;
        }
        this.unknownBuys.delete(u.clientOrderId);
        this.throttle.delete(`unknown:${u.clientOrderId}`);
        this.log(
          "info",
          `Kooporder ${u.market} met onbekende uitkomst bestaat volgens Bitvavo niet (clientOrderId ${u.clientOrderId}, ${u.nullCount}× op rij niet gevonden): niet uitgevoerd` +
            (u.positionId ? "" : ", er is niets gekocht"),
        );
        continue;
      }
      if (!res || typeof res !== "object") continue;
      // Definitief = zonder "UITKOMST ONBEKEND" en niet (vangnet) status "new".
      if (this.isOpenOrUnknown(res)) {
        if (this.resetNotFound(u)) changed = true;
        // Wat al zeker gevuld is meteen boeken (met stop): niet wachten tot de order klaar is.
        if (this.unbookedAmount(u.bookedAmount, res) > 0 && this.bookResolvedBuy(u, res, false)) changed = true;
        this.logThrottled(
          `unknown:${u.clientOrderId}`,
          "warn",
          `Kooporder ${u.market} (clientOrderId ${u.clientOrderId}) is nog niet afgerond bij Bitvavo (status ${res.status}) — nieuwe entries blijven gepauzeerd`,
        );
        continue;
      }
      if (this.bookResolvedBuy(u, res, true)) {
        this.unknownBuys.delete(u.clientOrderId);
        this.throttle.delete(`unknown:${u.clientOrderId}`);
        changed = true;
      }
    }
    if (changed) {
      if (this.unknownBuys.size === 0) this.log("info", "Alle kooporders met onbekende uitkomst zijn opgehelderd: nieuwe entries weer toegestaan");
      this.updateEquity();
      await this.persist(true);
    }
  }

  /** Minimale tijd tussen een onbekende orderuitkomst en de conclusie "niet geplaatst". */
  private notFoundMinWaitMs(): number {
    return Math.max(NOT_FOUND_MIN_WAIT_MS, NOT_FOUND_CONFIRMATIONS * this.config.pollMs);
  }

  /**
   * Verwerkt een "niet gevonden" (null) van Bitvavo voor een order met onbekende
   * uitkomst. Een waarneming telt alleen mee als de vorige getelde minstens
   * pollMs/2 geleden is (snel Stop/Start of herstarten telt dus niet extra).
   * "confirmed" (= niet geplaatst) pas bij ≥ {@link NOT_FOUND_CONFIRMATIONS} getelde
   * waarnemingen op rij (in verschillende ticks) én minstens max(60 s, 3 × pollMs)
   * nadat de uitkomst onbekend werd (`u.at`).
   */
  private countNotFound(u: NotFoundTrack & { at: number }): "uncounted" | "counted" | "confirmed" {
    const now = this.nowFn();
    const count = u.nullCount ?? 0;
    if (count > 0 && isNum(u.nullAt) && now - u.nullAt < this.config.pollMs / 2) return "uncounted";
    u.nullCount = count + 1;
    u.nullAt = now;
    if (u.nullCount >= NOT_FOUND_CONFIRMATIONS && now - u.at >= this.notFoundMinWaitMs()) return "confirmed";
    return "counted";
  }

  /** Teller "niet gevonden" terug naar 0 (alleen "op rij" telt). True als er iets veranderde. */
  private resetNotFound(u: NotFoundTrack): boolean {
    if (!u.nullCount && u.nullAt === undefined) return false;
    u.nullCount = 0;
    delete u.nullAt;
    return true;
  }

  /** "1/3", of na 3 waarnemingen hoe lang de bot nog wacht (voor in de logregel). */
  private notFoundProgress(u: NotFoundTrack & { at: number }): string {
    const n = u.nullCount ?? 0;
    if (n < NOT_FOUND_CONFIRMATIONS) return `${n}/${NOT_FOUND_CONFIRMATIONS}`;
    const left = Math.max(1, Math.ceil((u.at + this.notFoundMinWaitMs() - this.nowFn()) / 1000));
    return `${n}× op rij; de bot concludeert pas ${Math.round(this.notFoundMinWaitMs() / 1000)} s na de order dat hij niet is uitgevoerd, nog ~${left} s`;
  }

  /**
   * Hoeveel base een (teruggevonden) order méér gevuld heeft dan al geboekt is
   * (0 als niets extra).
   */
  private unbookedAmount(bookedAmount: number | undefined, res: OrderResult): number {
    const filledAmount = isNum(res.filledAmount) && res.filledAmount > 0 ? res.filledAmount : 0;
    const booked = isNum(bookedAmount) && bookedAmount > 0 ? bookedAmount : 0;
    const extra = filledAmount - booked;
    return extra > filledAmount * 1e-9 ? extra : 0;
  }

  /**
   * Het NIEUWE gevulde deel van een (teruggevonden) order t.o.v. wat al geboekt is:
   * hoeveelheid, bruto EUR en fee van alleen dat deel, en de prijs ervan =
   * (bruto totaal − al geboekt bruto) / (hoeveelheid totaal − al geboekt). Zo krijgt
   * een late vulling tegen een andere koers zijn eigen prijs, niet het gemiddelde
   * van de hele order. Oudere opgeslagen staat zonder geboekte bedragen: naar rato.
   * `fallbackPrice` als de broker geen prijs meldt. null = niets nieuws / geen prijs.
   */
  private fillIncrement(res: OrderResult, booked: BookedFill, fallbackPrice?: number): FillIncrement | null {
    const amount = this.unbookedAmount(booked.bookedAmount, res);
    if (!(amount > 0)) return null;
    const totalAmount = res.filledAmount;
    const avg =
      isNum(res.avgPrice) && res.avgPrice > 0
        ? res.avgPrice
        : isNum(res.filledQuote) && res.filledQuote > 0
          ? res.filledQuote / totalAmount
          : isNum(fallbackPrice) && fallbackPrice > 0
            ? fallbackPrice
            : 0;
    if (!(isNum(avg) && avg > 0)) return null;
    const totalQuote = isNum(res.filledQuote) && res.filledQuote > 0 ? res.filledQuote : totalAmount * avg;
    const totalFee = isNum(res.feeQuote) && res.feeQuote > 0 ? res.feeQuote : 0;
    const share = (totalAmount - amount) / totalAmount;
    const prevQuote = isNum(booked.bookedQuote) && booked.bookedQuote >= 0 ? booked.bookedQuote : totalQuote * share;
    const prevFee = isNum(booked.bookedFee) && booked.bookedFee >= 0 ? booked.bookedFee : totalFee * share;
    let quote = totalQuote - prevQuote;
    let price = quote / amount;
    // Vangnet tegen afrondingsruis in de totalen (bijv. een heel klein nieuw deel):
    // een marketorder vult niet op minder dan de helft of meer dan het dubbele van
    // zijn eigen gemiddelde; dan het gemiddelde gebruiken.
    if (!(isNum(price) && price >= avg / 2 && price <= avg * 2)) {
      price = avg;
      quote = amount * avg;
    }
    const fee = Math.max(0, totalFee - prevFee);
    return { amount, quote, fee, price, totalAmount, totalQuote, totalFee };
  }

  /**
   * Boekt een teruggevonden kooporder (voor zover nog niet geboekt) als positie
   * met stop, en onthoudt in `u` wat er geboekt is. Alleen het NIEUWE deel wordt
   * geboekt, tegen zijn eigen prijs en fee ({@link fillIncrement}); stop en doel
   * liggen ten opzichte van die prijs. `final` = de order is klaar (anders kan hij
   * nog verder vullen en blijft `u` bestaan). Geeft false als de vulling
   * onbruikbaar is (dan blijft de blokkade staan).
   */
  private bookResolvedBuy(u: UnknownBuy, res: OrderResult, final: boolean): boolean {
    const booked = isNum(u.bookedAmount) && u.bookedAmount > 0 ? u.bookedAmount : 0;
    if (!(this.unbookedAmount(u.bookedAmount, res) > 0)) {
      if (final) {
        this.log(
          "info",
          `Kooporder ${u.market} met onbekende uitkomst teruggevonden (status ${res.status}): ` +
            (booked > 0 ? "niet verder gevuld dan al geboekt" : "niets gevuld, er is niets gekocht"),
        );
      }
      return true;
    }
    const inc = this.fillIncrement(res, u);
    if (!inc || !(inc.quote > 0)) {
      this.logThrottled(
        `unknown:${u.clientOrderId}`,
        "error",
        `Kooporder ${u.market} (clientOrderId ${u.clientOrderId}) is gevuld maar zonder bruikbare prijs — controleer je account; nieuwe entries blijven gepauzeerd`,
      );
      return false;
    }
    const { amount: extra, price, fee } = inc;
    const cost = inc.quote + fee;
    const existing = u.positionId ? this.positions.find((p) => p.id === u.positionId) : undefined;
    let pos: Position;
    if (existing) {
      const amount = existing.amount + extra;
      existing.entryPrice = (existing.entryPrice * existing.amount + price * extra) / amount;
      existing.amount = amount;
      existing.costQuote += cost;
      existing.entryFeeQuote += fee;
      pos = existing;
    } else {
      let stop = u.stopDist > 0 ? price - u.stopDist : price * 0.97;
      if (!isNum(stop) || stop <= 0 || stop >= price) stop = price * 0.97;
      let tp = u.tpDist > 0 ? price + u.tpDist : price + 2 * (price - stop);
      if (!isNum(tp) || tp <= price) tp = price + 2 * (price - stop);
      pos = {
        id: newId("pos"),
        market: u.market,
        side: "long",
        entryTime: u.at > 0 ? u.at : this.nowFn(),
        entryPrice: price,
        amount: extra,
        costQuote: cost,
        entryFeeQuote: fee,
        stopPrice: stop,
        initialStopPrice: stop,
        takeProfitPrice: tp,
        highestPrice: price,
        candlesHeld: 0,
        entryReason: u.entryReason,
        ...(res.orderId ? { orderId: res.orderId } : {}),
      };
      this.positions.push(pos);
      this.account.tradesToday += 1;
    }
    this.account.cashQuote -= cost;
    this.account.feesPaid += fee;
    u.positionId = pos.id;
    u.bookedAmount = inc.totalAmount;
    u.bookedQuote = inc.totalQuote;
    u.bookedFee = inc.totalFee;
    this.updateEquity();
    this.recordEquity(this.nowFn(), true);
    if (!existing) this.emitEvent("position-opened", { ...pos });
    this.log(
      "trade",
      `KOOP ${u.market} alsnog ${final ? "" : "deels "}uitgevoerd (order met onbekende uitkomst teruggevonden${final ? "" : ", nog niet afgerond"}): ` +
        `${fmtEur(cost)} @ ${fmtPrice(price)} · stop ${fmtPrice(pos.stopPrice)} · doel ${fmtPrice(pos.takeProfitPrice)}` +
        (existing ? ` — bijgeboekt bij de open positie (${fmtAmount(pos.amount)} totaal)` : ""),
    );
    if (this.account.cashQuote < -1e-6) {
      this.log(
        "warn",
        `Kapitaallimiet ${fmtEur(this.startingCapital)} overschreden door de alsnog uitgevoerde koop (cash ${fmtEur(this.account.cashQuote)})`,
      );
    }
    return true;
  }

  private logUnknownBuysBlocking(): void {
    const list = [...this.unknownBuys.values()].map((u) => `${u.market} (${fmtEur(u.quoteAmount)})`).join(", ");
    const canLookup = this.lookupFn() !== null;
    this.log(
      "warn",
      `Kooporder(s) met onbekende uitkomst: ${list}. Nieuwe entries blijven gepauzeerd tot ` +
        (canLookup
          ? "de bot ze bij Bitvavo heeft teruggevonden (of jij de blokkade na controle van je account opheft)"
          : "jij je Bitvavo-account gecontroleerd hebt en de blokkade opheft"),
    );
  }

  private logUnknownSellsPending(): void {
    const list = [...this.unknownSells.values()].map((u) => `${u.market} (${fmtAmount(u.amount)})`).join(", ");
    this.log(
      "warn",
      `Verkooporder(s) met onbekende uitkomst: ${list}. De bot verkoopt die positie(s) pas opnieuw als vaststaat wat er met de order gebeurd is — controleer je Bitvavo-account.`,
    );
  }

  /** `broker.lookupOrder` (optioneel), gebonden aan de broker; null als de broker het niet kan. */
  private lookupFn(): ((market: string, clientOrderId: string) => Promise<OrderResult | null>) | null {
    const b = this.broker;
    return typeof b.lookupOrder === "function" ? (market, cid) => b.lookupOrder!(market, cid) : null;
  }

  private unknownSellFor(positionId: string): UnknownSell | undefined {
    for (const u of this.unknownSells.values()) if (u.positionId === positionId) return u;
    return undefined;
  }

  /**
   * Live: verkooporders met onbekende uitkomst ophelderen via `broker.lookupOrder`.
   * Definitief (geen "UITKOMST ONBEKEND", niet status "new") → het (extra)
   * gevulde deel als exit boeken en de blokkade opheffen (de rest wordt daarna
   * gewoon verkocht). Nog niet afgerond → wat al zeker verkocht is boeken, blijven
   * wachten. Niet gevonden (genoeg keer op rij én lang genoeg, zie
   * {@link countNotFound}) → niet uitgevoerd, opnieuw verkopen mag; gooit → blijven wachten.
   * `countNulls` = false (noodstop / handmatig sluiten): "niet gevonden" telt niet
   * mee. Geeft de hierbij geboekte trades terug.
   */
  private async resolveUnknownSells(countNulls: boolean): Promise<Trade[]> {
    const lookup = this.lookupFn();
    const trades: Trade[] = [];
    if (!lookup) return trades;
    let changed = false;
    for (const u of [...this.unknownSells.values()]) {
      const key = `unknownsell:${u.clientOrderId}`;
      let res: OrderResult | null;
      try {
        res = await lookup(u.market, u.clientOrderId);
      } catch (err) {
        if (this.unknownSells.get(u.clientOrderId) === u && this.resetNotFound(u)) changed = true;
        this.logThrottled(
          key,
          "warn",
          `Verkooporder ${u.market} (clientOrderId ${u.clientOrderId}) met onbekende uitkomst nog niet op te zoeken bij Bitvavo: ${errorMessage(err)} — ` +
            "de bot verkoopt deze positie niet opnieuw tot dat lukt",
        );
        continue;
      }
      if (this.unknownSells.get(u.clientOrderId) !== u) continue;
      if (res === null) {
        if (!countNulls) continue;
        const seen = this.countNotFound(u);
        if (seen === "uncounted") continue;
        changed = true;
        if (seen === "counted") {
          this.log(
            "info",
            `Verkooporder ${u.market} met onbekende uitkomst (clientOrderId ${u.clientOrderId}) nog niet gevonden bij Bitvavo ` +
              `(${this.notFoundProgress(u)}) — ` +
              (this.running
                ? "de bot kijkt bij een volgende tick opnieuw en verkoopt tot dan niet opnieuw"
                : "de bot staat stil — start de bot opnieuw of sluit de positie zelf op Bitvavo"),
          );
          continue;
        }
        this.unknownSells.delete(u.clientOrderId);
        this.throttle.delete(key);
        this.log(
          "info",
          `Verkooporder ${u.market} met onbekende uitkomst bestaat volgens Bitvavo niet (clientOrderId ${u.clientOrderId}, ${u.nullCount}× op rij niet gevonden): ` +
            "niet uitgevoerd — de bot mag de positie opnieuw verkopen",
        );
        continue;
      }
      if (!res || typeof res !== "object") continue;
      const pos = this.positions.find((p) => p.id === u.positionId);
      if (this.isOpenOrUnknown(res)) {
        if (this.resetNotFound(u)) changed = true;
        // Wat al zeker verkocht is meteen boeken; de rest blijft onbekend.
        if (pos && this.unbookedAmount(u.bookedAmount, res) > 0) {
          const trade = await this.bookUnknownSellFill(u, res, pos, false);
          if (trade) trades.push(trade);
          changed = true;
        }
        this.logThrottled(
          key,
          "warn",
          `Verkooporder ${u.market} (clientOrderId ${u.clientOrderId}) is nog niet afgerond bij Bitvavo (status ${res.status}) — de bot verkoopt deze positie niet opnieuw tot dat wel zo is`,
        );
        continue;
      }
      // Definitief.
      this.unknownSells.delete(u.clientOrderId);
      this.throttle.delete(key);
      changed = true;
      const booked = isNum(u.bookedAmount) && u.bookedAmount > 0 ? u.bookedAmount : 0;
      const extra = this.unbookedAmount(u.bookedAmount, res);
      if (!(extra > 0)) {
        this.log(
          "info",
          `Verkooporder ${u.market} met onbekende uitkomst teruggevonden (status ${res.status}): ` +
            (booked > 0 ? "niet verder gevuld dan al geboekt" : "er is niets verkocht") +
            (pos ? " — de bot mag de positie opnieuw verkopen" : ""),
        );
        continue;
      }
      if (!pos) {
        this.log(
          "warn",
          `Verkooporder ${u.market} met onbekende uitkomst blijkt (verder) gevuld (${fmtAmount(extra)}), maar de positie staat niet meer in de administratie — controleer je Bitvavo-account`,
        );
        continue;
      }
      const trade = await this.bookUnknownSellFill(u, res, pos, true);
      if (trade) trades.push(trade);
    }
    if (changed) {
      this.updateEquity();
      await this.persist(true);
    }
    return trades;
  }

  /**
   * Boekt het nog niet geboekte, gevulde deel van een verkooporder met
   * onbekende uitkomst als exit, tegen de prijs en fee van alleen dat deel
   * ({@link fillIncrement}). `final` = de order is klaar ("filled" sluit dan
   * de hele positie, net als bij een gewone verkoop); anders blijft de rest van de
   * positie altijd staan (de order kan nog verder vullen).
   */
  private async bookUnknownSellFill(u: UnknownSell, res: OrderResult, pos: Position, final: boolean): Promise<Trade | null> {
    const inc = this.fillIncrement(res, u, this.priceFor(pos));
    if (!inc) return null;
    // Meer verkocht dan de positie (zou niet mogen): alleen het deel van de positie telt.
    const filled = Math.min(inc.amount, pos.amount);
    const part = filled / inc.amount;
    const exitPrice = inc.price;
    const gross = inc.quote * part;
    const fee = inc.fee * part;
    u.bookedAmount = inc.totalAmount;
    u.bookedQuote = inc.totalQuote;
    u.bookedFee = inc.totalFee;
    this.log(
      "info",
      `Verkooporder ${u.market} met onbekende uitkomst teruggevonden (status ${res.status}${final ? "" : ", nog niet afgerond"}): ` +
        `${fmtAmount(filled)} verkocht @ ${fmtPrice(exitPrice)}`,
    );
    return this.bookExit(
      pos,
      u.reason,
      { filled, exitPrice, gross, fee, closeAll: final && res.status === "filled", keep: !final },
      !final,
    );
  }

  // ───────────────────────────── Exit ─────────────────────────────

  /**
   * Verkoopt een positie. `explicit` = door de gebruiker gevraagd (handmatig
   * sluiten / noodstop): dan wordt ook in niet-gearmde live mode verkocht.
   * Lukt het niet, dan blijft de positie staan (pendingExit: de volgende tick
   * probeert het opnieuw) en staat de Nederlandse reden in `exitFailure`.
   * Er gaat GEEN order uit als: de waarde onder het beursminimum ligt
   * (onverkoopbaar), er voor deze positie nog een verkoop met onbekende uitkomst
   * loopt, of de coins in een openstaande order vastzitten.
   */
  private async exitPosition(
    pos: Position,
    reason: ExitReason,
    price: number,
    explicit: boolean,
  ): Promise<Trade | null> {
    this.exitFailure = null;
    if (!this.positions.includes(pos)) return null;
    const label = exitReasonLabel(reason);
    const info = this.marketInfo.get(pos.market);

    if (this.mode === "live" && !this.armed && !explicit) {
      this.pendingExit.set(pos.id, reason);
      this.exitFailure = "live mode is niet gearmd";
      this.logThrottled(
        `wouldsell:${pos.id}`,
        "warn",
        `Live mode niet gearmd: zou verkopen ${pos.market} @ ~${fmtPrice(price)} · ${label} — positie blijft open (arm de bot of sluit handmatig)`,
        Number.POSITIVE_INFINITY,
        true,
      );
      return null;
    }

    // Nog een verkoop met onbekende uitkomst voor deze positie: nooit een tweede sturen.
    let afterUnknownSell = false;
    const unknownSell = this.unknownSellFor(pos.id);
    if (unknownSell) {
      const waiting = await this.unknownSellWait(pos, unknownSell, label, explicit);
      if (!this.positions.includes(pos)) return null;
      if (waiting) {
        this.pendingExit.set(pos.id, reason);
        this.exitFailure = waiting;
        return null;
      }
      afterUnknownSell = true;
    }

    let amount = pos.amount;
    let sellsEverything = false;
    if (this.mode === "live") {
      const { base } = splitMarket(pos.market, info);
      // Saldo onbekend (fout of leeg antwoord, kan tijdelijk zijn): niets
      // concluderen en gewoon de volledige positie proberen te verkopen.
      let h = await this.readHolding(base);
      if (!this.positions.includes(pos)) return null; // intussen afgeschreven
      let missing = h ? this.missingKind(pos, h) : null;
      if (missing && explicit) {
        // Handmatig / noodstop: niet een tick wachten, maar meteen nog een keer kijken.
        h = await this.readHolding(base);
        if (!this.positions.includes(pos)) return null;
        if (!h) {
          this.exitFailure = `het ${base}-saldo op Bitvavo kon niet opnieuw gecontroleerd worden — probeer het zo nog eens`;
          this.log("warn", `${pos.market} (${label}): ${this.exitFailure}`);
          return null;
        }
        missing = this.missingKind(pos, h);
      } else if (missing && h) {
        // Automatisch: pas bij een tweede waarneming in een latere tick boeken
        // (één afwijkend saldo-antwoord mag een echte positie niet "wegboeken").
        const seen = this.vanishedSeen.get(pos.id);
        if (!seen || seen.seq >= this.tickSeq) {
          if (!seen) {
            this.vanishedSeen.set(pos.id, { seq: this.tickSeq, afterUnknownSell });
            this.log(
              "warn",
              `${pos.market}: er staat maar ${fmtAmount(missing === "gone" ? h.held : h.avail)} van ${fmtAmount(pos.amount)} ${base} ` +
                `(beschikbaar) op Bitvavo — ` +
                (this.running
                  ? "de bot kijkt bij de volgende tick nog een keer voordat hij iets boekt of verkoopt"
                  : "de bot staat stil — start de bot opnieuw of sluit de positie zelf op Bitvavo"),
            );
          }
          this.pendingExit.set(pos.id, reason);
          this.exitFailure = `er staat maar ${fmtAmount(missing === "gone" ? h.held : h.avail)} van ${fmtAmount(pos.amount)} ${base} op Bitvavo (wordt nog gecontroleerd)`;
          return null;
        }
        afterUnknownSell = afterUnknownSell || seen.afterUnknownSell;
      }
      if (h && !missing) this.vanishedSeen.delete(pos.id);

      if (h && missing === "gone") {
        // De coins staan niet meer op Bitvavo: een verkoop zou elke tick opnieuw
        // afgewezen worden. Administratie bijwerken (schatting).
        const cause = afterUnknownSell
          ? "vermoedelijk verkocht bij de order met onbekende uitkomst"
          : "verkocht buiten de bot of door een eerdere, laat gevulde order";
        this.log(
          "error",
          `${pos.market}: de positie staat niet meer op Bitvavo (${cause}) — ` +
            `in de administratie gesloten tegen de actuele koers ${fmtPrice(price)} (schatting, controleer je account)`,
        );
        const gross = pos.amount * price;
        return this.bookExit(pos, reason, {
          filled: pos.amount,
          exitPrice: price,
          gross,
          fee: gross * this.config.risk.takerFee,
          closeAll: true,
        });
      }
      if (h && h.avail < amount) {
        if (h.avail >= amount * (1 - MAX_SELL_SHORTFALL)) {
          // Afronding / fee in base: verkoop wat er is en sluit de positie.
          this.log(
            "warn",
            `Beschikbaar ${base}-saldo (${fmtAmount(h.avail)}) is iets lager dan de positie (${fmtAmount(amount)}); de bot verkoopt wat er is`,
          );
          amount = h.avail;
          sellsEverything = true;
        } else if (h.inOrder > 0) {
          // De coins bestaan nog maar zitten vast in een openstaande order: niet
          // verkopen (dat wordt afgewezen) en zeker niet de hele positie afboeken.
          this.pendingExit.set(pos.id, reason);
          this.exitFailure = `${fmtAmount(h.inOrder)} ${base} zit in een openstaande order op Bitvavo`;
          this.logSellProblem(
            `sellfail:${pos.id}`,
            "error",
            `${pos.market} (${label}): ${fmtAmount(h.inOrder)} ${base} zit in een openstaande order op Bitvavo; ` +
              "annuleer die order of sluit de positie handmatig — positie blijft open",
            explicit,
          );
          return null;
        } else {
          // Een deel is echt weg (handmatig verkocht / deels uitgevoerde order met
          // onbekende uitkomst): dat deel apart boeken (schatting), rest normaal verkopen.
          const missingAmount = pos.amount - h.avail;
          this.log(
            "error",
            `${pos.market}: er staat maar ${fmtAmount(h.avail)} van ${fmtAmount(pos.amount)} ${base} op Bitvavo — ` +
              `het ontbrekende deel wordt geboekt tegen de actuele koers ${fmtPrice(price)} (schatting, controleer je account)`,
          );
          const gross = missingAmount * price;
          const trade = await this.bookExit(
            pos,
            reason,
            { filled: missingAmount, exitPrice: price, gross, fee: gross * this.config.risk.takerFee, closeAll: false },
            true,
          );
          // Rest te klein om te verkopen: bookExit heeft de positie al gesloten.
          if (!this.positions.includes(pos)) return trade;
          amount = pos.amount;
          sellsEverything = true;
        }
      }
    }

    // Onder het beursminimum: GEEN order sturen (wordt toch geweigerd). De exit
    // blijft staan; zodra de waarde weer ≥ het minimum is, wordt er gewoon verkocht.
    const dust = this.dustReason(pos.market, amount, price);
    if (dust) {
      this.pendingExit.set(pos.id, reason);
      this.exitFailure = `onverkoopbaar: ${dust}`;
      this.noteUnsellable(pos, "engine", dust, explicit, { amount });
      return null;
    }
    // Actuele verkoopbare hoeveelheid onthouden (de snapshot rekent ermee).
    const rec = this.unsellable.get(pos.id);
    if (rec) rec.amount = amount;
    // De broker weigerde deze verkoop al ("ONVERKOOPBAAR"): niet elke tick opnieuw
    // versturen, pas als de positie ≥ 1% meer waard is dan max(geweigerde waarde,
    // minimum) en hooguit één keer per 5 minuten. Een expliciete actie van de
    // gebruiker (sluiten / noodstop) probeert het wel meteen.
    const refused = explicit ? null : this.refusalHold(pos, price);
    if (refused) {
      this.pendingExit.set(pos.id, reason);
      this.exitFailure = `onverkoopbaar: ${refused}`;
      return null;
    }
    // Duidelijk (≥ 1%) boven het minimum: de episode van de eigen controle is voorbij.
    // Net erboven wordt wel verkocht, maar loopt de episode (en de melding) door.
    if (rec?.kind === "engine" && this.clearlySellable(pos, amount, price)) {
      this.unsellable.delete(pos.id);
      this.log(
        "info",
        `${pos.market} is weer verkoopbaar (waarde ~${fmtEur(amount * price)}): de bot verkoopt nu (${label})`,
      );
    }

    const epoch = this.epoch;
    const req: MarketOrderRequest = { market: pos.market, side: "sell", amount, clientOrderId: randomUUID() };
    const { res, threw } = await this.placeOrder(req, price);
    if (epoch !== this.epoch || !this.positions.includes(pos)) {
      this.log("warn", `Verkooporder ${pos.market} kwam binnen na een account-reset en wordt genegeerd`);
      return null;
    }
    this.emitEvent("order", res);
    const clientOrderId = (typeof res.clientOrderId === "string" && res.clientOrderId) || req.clientOrderId!;

    if (this.isUnknownOutcome(res, threw)) {
      // Onthouden (en opslaan): tot de uitkomst bekend is gaat er voor deze positie
      // geen tweede verkoop uit — anders kan de bot twee keer verkopen.
      this.unknownSells.set(clientOrderId, {
        clientOrderId,
        positionId: pos.id,
        market: pos.market,
        amount,
        reason,
        at: this.nowFn(),
        nullCount: 0,
      });
      this.pendingExit.set(pos.id, reason);
      const why = res.error ?? "geen antwoord van de broker";
      this.exitFailure = `uitkomst van de verkooporder onbekend (${why}) — controleer je Bitvavo-account`;
      this.log(
        "error",
        `UITKOMST ONBEKEND bij verkoop ${pos.market} (${label}, clientOrderId ${clientOrderId}): ${why} — controleer je Bitvavo-account! ` +
          this.unknownSellHint(),
      );
      await this.persist(true);
      return null;
    }

    const filledAmount = isNum(res.filledAmount) ? res.filledAmount : 0;
    if (res.status === "rejected" || filledAmount <= 0) {
      this.pendingExit.set(pos.id, reason);
      const why = res.error ?? `status ${res.status}, niets gevuld`;
      if (typeof res.error === "string" && res.error.trim().toUpperCase().startsWith(UNSELLABLE_PREFIX)) {
        // De broker weigert de verkoop omdat hij onder het beursminimum valt.
        const text = res.error.trim().replace(/^ONVERKOOPBAAR:?\s*/i, "") || why;
        this.exitFailure = `onverkoopbaar: ${text}`;
        this.noteUnsellable(pos, "broker", text, explicit, { value: pos.amount * price });
        return null;
      }
      this.exitFailure = `verkoop afgewezen: ${why}`;
      this.logSellProblem(
        `sellfail:${pos.id}`,
        "error",
        `Verkoop ${pos.market} (${label}) mislukt: ${why} — positie blijft open, ${this.retryHint()}`,
        explicit,
      );
      return null;
    }
    if (res.error) this.log("warn", `Melding bij verkoop ${pos.market}: ${res.error}`);
    // Deels gevuld maar de order kan nog verder vullen: het bekende deel boeken
    // en de rest onthouden als verkoop met onbekende uitkomst.
    const stillOpen = this.isOpenOrUnknown(res);

    const filled = Math.min(filledAmount, pos.amount);
    const rawGross = isNum(res.filledQuote) && res.filledQuote > 0 ? res.filledQuote : 0;
    const exitPrice =
      isNum(res.avgPrice) && res.avgPrice > 0 ? res.avgPrice : rawGross > 0 ? rawGross / filledAmount : price;
    // Meer verkocht dan de positie (zou niet mogen): alleen het deel van de positie telt.
    const gross = rawGross > 0 ? rawGross * (filled / filledAmount) : filled * exitPrice;
    const fee = isNum(res.feeQuote) && res.feeQuote > 0 ? res.feeQuote * (filled / filledAmount) : 0;
    // "filled" = de order is klaar: wat niet verkocht is (bijv. door een lager saldo) bestaat niet meer.
    const closeAll = !stillOpen && (sellsEverything || res.status === "filled");
    const trade = await this.bookExit(pos, reason, { filled, exitPrice, gross, fee, closeAll, keep: stillOpen }, stillOpen);
    if (stillOpen && this.positions.includes(pos)) {
      this.unknownSells.set(clientOrderId, {
        clientOrderId,
        positionId: pos.id,
        market: pos.market,
        amount,
        reason,
        at: this.nowFn(),
        bookedAmount: filled,
        bookedQuote: gross,
        bookedFee: fee,
        nullCount: 0,
      });
      this.exitFailure = "deels verkocht; de rest van de verkooporder heeft een onbekende uitkomst — controleer je Bitvavo-account";
      this.log(
        "error",
        `UITKOMST ONBEKEND bij verkoop ${pos.market} (clientOrderId ${clientOrderId}): ${fmtAmount(filled)} verkocht en geboekt, de order kan nog verder vullen — controleer je Bitvavo-account! ` +
          this.unknownSellHint(),
      );
      await this.persist(true);
    }
    return trade;
  }

  /**
   * Boekt een (gedeeltelijke) exit in de administratie en stuurt events/logs.
   * `quiet`: geen "rest volgt bij de volgende tick"-melding (de caller meldt zelf iets).
   * `keep`: de rest van de positie blijft altijd staan (ook als hij onder het
   * minimum ligt), bijv. omdat de verkooporder nog verder kan vullen.
   */
  private async bookExit(
    pos: Position,
    reason: ExitReason,
    fill: { filled: number; exitPrice: number; gross: number; fee: number; closeAll: boolean; keep?: boolean },
    quiet = false,
  ): Promise<Trade> {
    const now = this.nowFn();
    const info = this.marketInfo.get(pos.market);
    const label = exitReasonLabel(reason);
    const { filled, exitPrice, gross, fee } = fill;
    const remaining = Math.max(0, pos.amount - filled);
    const mins = this.exchangeMinimums(pos.market);
    const keepRemainder = fill.keep
      ? remaining > pos.amount * 1e-6
      : !fill.closeAll && remaining > pos.amount * 1e-3 && remaining * exitPrice >= mins.quote && remaining >= mins.base;
    const share = keepRemainder ? filled / pos.amount : 1;

    const costPart = pos.costQuote * share;
    const entryFeePart = pos.entryFeeQuote * share;
    const proceeds = gross - fee;
    const pnl = proceeds - costPart;
    const pnlPct = costPart > 0 ? (pnl / costPart) * 100 : 0;
    const initialRisk = (pos.entryPrice - pos.initialStopPrice) * pos.amount * share;

    const trade: Trade = {
      id: newId("trd"),
      market: pos.market,
      entryTime: pos.entryTime,
      exitTime: now,
      entryPrice: pos.entryPrice,
      exitPrice,
      amount: filled,
      costQuote: costPart,
      proceedsQuote: proceeds,
      feesQuote: entryFeePart + fee,
      pnlQuote: pnl,
      pnlPct,
      rMultiple: initialRisk > 0 ? pnl / initialRisk : 0,
      exitReason: reason,
      candlesHeld: pos.candlesHeld,
      entryReason: pos.entryReason,
    };

    // Administratie
    this.account.cashQuote += proceeds;
    this.account.realizedPnl += pnl;
    this.account.realizedPnlToday += pnl;
    this.account.feesPaid += fee;
    if (pnl < 0) this.account.lastLossAt[pos.market] = now;
    this.trades.push(trade);
    if (this.trades.length > MAX_TRADES_KEPT) this.trades.splice(0, this.trades.length - MAX_TRADES_KEPT);
    // Er is (deels) verkocht: een eerdere "onverkoopbaar"-melding geldt niet meer.
    this.unsellable.delete(pos.id);

    const { base } = splitMarket(pos.market, info);
    if (keepRemainder) {
      pos.amount = remaining;
      pos.costQuote -= costPart;
      pos.entryFeeQuote -= entryFeePart;
      this.pendingExit.set(pos.id, reason);
      this.exitFailure = `deels verkocht (${fmtAmount(remaining)} ${base} over)`;
      if (!quiet) {
        this.log(
          "warn",
          `Verkoop ${pos.market} deels gevuld (${fmtAmount(filled)} verkocht, ${fmtAmount(remaining)} over) — ` +
            (this.running
              ? "rest volgt bij de volgende tick"
              : `de bot staat stil — start de bot opnieuw of verkoop de rest zelf${this.mode === "live" ? " op Bitvavo" : ""}`),
        );
      }
    } else {
      this.forgetPosition(pos);
      if (!fill.closeAll && remaining > pos.amount * 1e-6) {
        this.log(
          "warn",
          `Restant van ${fmtAmount(remaining)} ${base} is te klein om te verkopen en blijft op het account staan`,
        );
      }
    }
    this.enforceCapitalLimit();
    this.updateEquity();
    this.recordEquity(now, true);

    this.emitEvent("position-closed", { ...trade });
    this.log(
      "trade",
      `VERKOOP ${pos.market} @ ${fmtPrice(exitPrice)} · ${label} · ${fmtSignedEur(pnl)} (${fmtSignedPct(pnlPct)})`,
    );
    await this.persist(true);
    return trade;
  }

  /** Haalt een positie uit de administratie en ruimt alle bijbehorende toestand op. */
  private forgetPosition(pos: Position): void {
    this.positions = this.positions.filter((p) => p !== pos);
    this.pendingExit.delete(pos.id);
    this.posCursor.delete(pos.id);
    this.vanishedSeen.delete(pos.id);
    this.unsellable.delete(pos.id);
    this.throttle.delete(`wouldsell:${pos.id}`);
    this.throttle.delete(`sellfail:${pos.id}`);
    this.throttle.delete(`sellwait:${pos.id}`);
    this.throttle.delete(`risk:${pos.id}`);
  }

  /**
   * Live: cash + inleg van open posities blijft binnen de kapitaallimiet. Wat
   * erboven komt, gaat uit het handelsbudget. Dat is een overboeking, geen winst
   * of verlies (zie {@link updateEquity}: resultaat = equity + alles wat eruit ging −
   * ingelegd kapitaal). Is de limiet verlaagd terwijl er meer dan de nieuwe limiet
   * in open posities zat (`capitalPending`), dan is het eerste deel kapitaal dat
   * alsnog teruggaat (`capitalReturned`) — dat heet nooit "winst". De rest is
   * afgeroomde winst (`skimmedQuote`).
   */
  private enforceCapitalLimit(): void {
    if (this.mode !== "live") return;
    const openCost = this.positions.reduce((s, p) => s + (isNum(p.costQuote) ? p.costQuote : 0), 0);
    const cap = Math.max(0, this.startingCapital - openCost);
    if (!(this.account.cashQuote > cap + 1e-9)) {
      this.settleCapitalPending();
      return;
    }
    const excess = this.account.cashQuote - cap;
    let capital = Math.min(excess, this.capitalPending);
    if (capital <= 1e-9) capital = 0;
    if (excess - capital <= 1e-9) capital = excess;
    const profit = excess - capital;
    this.capitalPending = Math.max(0, this.capitalPending - capital);
    this.account.cashQuote = cap;
    if (profit > 0) {
      this.skimmedQuote += profit;
      this.skimmedToday += profit;
      this.log(
        "info",
        `Kapitaallimiet ${fmtEur(this.startingCapital)}: ${fmtEur(profit)} winst blijft buiten het handelsbudget van de bot`,
      );
    }
    if (capital > 0) {
      this.capitalReturned += capital;
      this.returnedToday += capital;
      this.log(
        "info",
        `Kapitaallimiet ${fmtEur(this.startingCapital)}: ${fmtEur(capital)} kapitaal gaat alsnog terug buiten het handelsbudget ` +
          "(de limiet was verlaagd terwijl dat geld in een positie zat; opname, telt niet mee in het resultaat)",
      );
    }
    this.settleCapitalPending();
  }

  /**
   * Geen open posities meer: er zit geen kapitaal van vóór de limietverlaging meer
   * vast. Wat daarvan niet terugkwam, was verlies (net als bij de verlaging zelf:
   * het budget wordt min(limiet, wat de bot heeft)).
   */
  private settleCapitalPending(): void {
    if (this.positions.length === 0) this.capitalPending = 0;
  }

  /** Beursminima (EUR en base) voor één order in deze markt — NIET de risico-instelling. */
  private exchangeMinimums(market: string): { quote: number; base: number } {
    const info = this.marketInfo.get(market);
    // Ontbrekend, ongeldig of ≤ 0 = onbekend: dan het Bitvavo-minimum.
    const quote = info && isNum(info.minOrderQuote) && info.minOrderQuote > 0 ? info.minOrderQuote : EXCHANGE_MIN_ORDER_QUOTE;
    const base = info && isNum(info.minOrderBase) && info.minOrderBase > 0 ? info.minOrderBase : 0;
    return { quote, base };
  }

  /**
   * Nederlandse reden waarom een verkoop van `amount` tegen `price` onder het
   * beursminimum valt (dan wordt hij geweigerd), of null als hij kan.
   */
  private dustReason(market: string, amount: number, price: number): string | null {
    if (!(isNum(price) && price > 0) || !(isNum(amount) && amount > 0)) return null;
    const info = this.marketInfo.get(market);
    const mins = this.exchangeMinimums(market);
    // Live rondt de broker de hoeveelheid eerst naar beneden af.
    const sellable = this.mode === "live" && info ? roundAmount(amount, info) : amount;
    if (mins.base > 0 && sellable < mins.base * (1 - 1e-9)) {
      const { base } = splitMarket(market, info);
      return `hoeveelheid ${fmtAmount(sellable)} ${base} < minimum ${fmtAmount(mins.base)} ${base}`;
    }
    const value = sellable * price;
    if (value < mins.quote - 1e-8) {
      return `waarde ${fmtEur(Math.floor(value * 100) / 100)} < minimum ${fmtEur(mins.quote)}`;
    }
    return null;
  }

  /**
   * Is deze positie NU onverkoopbaar, tegen `price` (de actuele koers)? Reden of
   * null. Altijd de eigen minimumcontrole tegen deze koers, plus een weigering van
   * de broker die bij deze koers nog geldt ({@link brokerRefusal}). Een eerder
   * opgeslagen reden telt nooit als de positie nu wel verkocht kan worden.
   */
  private unsellableNow(pos: Position, price: number): string | null {
    // Verkoopbare hoeveelheid: de positie, of minder als er bij de laatste poging
    // minder op Bitvavo beschikbaar was (bijv. fee in de munt zelf).
    const rec = this.unsellable.get(pos.id);
    const amount = rec && isNum(rec.amount) && rec.amount > 0 ? Math.min(pos.amount, rec.amount) : pos.amount;
    return this.dustReason(pos.market, amount, price) ?? this.brokerRefusal(pos, price);
  }

  /**
   * Positiewaarde vanaf waar een weigering van de broker niet meer geldt:
   * max(hoogste geweigerde waarde, beursminimum) × {@link UNSELLABLE_HYSTERESIS}.
   */
  private refusalThreshold(pos: Position, rec: UnsellableRec): number {
    const refused = isNum(rec.value) ? rec.value : 0;
    return Math.max(refused, this.exchangeMinimums(pos.market).quote) * UNSELLABLE_HYSTERESIS;
  }

  /**
   * De broker weigerde een verkoop van deze positie met "ONVERKOOPBAAR" bij
   * positiewaarde `value`: die weigering geldt zolang de positie nu (tegen `price`)
   * niet duidelijk meer waard is ({@link refusalThreshold}), ook als hij intussen
   * onder het minimum dook. Reden of null.
   */
  private brokerRefusal(pos: Position, price: number): string | null {
    const rec = this.unsellable.get(pos.id);
    if (!rec || rec.kind !== "broker") return null;
    if (!(isNum(price) && price > 0)) return null;
    return pos.amount * price < this.refusalThreshold(pos, rec) ? rec.reason : null;
  }

  /**
   * Waarom een AUTOMATISCHE verkooppoging na een weigering van de broker nu nog niet
   * mag, of null: pas bij ≥ {@link refusalThreshold} en hooguit één poging per
   * {@link REFUSAL_RETRY_MS} per positie.
   */
  private refusalHold(pos: Position, price: number): string | null {
    const why = this.brokerRefusal(pos, price);
    if (why) return why;
    const rec = this.unsellable.get(pos.id);
    if (rec?.kind === "broker" && isNum(rec.at) && this.nowFn() - rec.at < REFUSAL_RETRY_MS) {
      return `${rec.reason} (nieuwe automatische poging hooguit één keer per ${REFUSAL_RETRY_MS / 60_000} minuten)`;
    }
    return null;
  }

  /** Duidelijk (≥ 1%) boven het beursminimum: einde van een "onverkoopbaar"-episode. */
  private clearlySellable(pos: Position, amount: number, price: number): boolean {
    const mins = this.exchangeMinimums(pos.market);
    return amount * price >= mins.quote * UNSELLABLE_HYSTERESIS && amount >= mins.base * UNSELLABLE_HYSTERESIS;
  }

  /**
   * Markeert een positie als onverkoopbaar en logt dat één keer per episode
   * (niet elke tick); bij een expliciete actie van de gebruiker altijd, en ook bij
   * de eerste weigering van de broker in een episode. Een weigering van de broker
   * wordt nooit vervangen door de eigen minimumcontrole (de hoogste geweigerde
   * waarde blijft gelden). `amount` (engine): hoeveelheid die verkocht zou worden;
   * `value` (broker): positiewaarde waarbij de broker de verkoop weigerde.
   */
  private noteUnsellable(
    pos: Position,
    kind: "engine" | "broker",
    reason: string,
    explicit: boolean,
    extra: { amount?: number; value?: number } = {},
  ): void {
    const prev = this.unsellable.get(pos.id);
    let announce = !prev || explicit;
    if (kind === "broker") {
      const prevValue = prev?.kind === "broker" && isNum(prev.value) ? prev.value : 0;
      const value = Math.max(isNum(extra.value) ? extra.value : 0, prevValue);
      this.unsellable.set(pos.id, {
        kind,
        reason,
        value,
        at: this.nowFn(),
        ...(prev && isNum(prev.amount) ? { amount: prev.amount } : {}),
      });
      if (prev?.kind !== "broker") announce = true;
    } else if (prev?.kind === "broker") {
      // Onder het minimum gedoken na een weigering van de broker: die weigering blijft staan.
      if (isNum(extra.amount)) prev.amount = extra.amount;
    } else {
      this.unsellable.set(pos.id, { kind, reason, ...(isNum(extra.amount) ? { amount: extra.amount } : {}) });
    }
    if (!announce) return;
    this.log("warn", `${pos.market} positie is onverkoopbaar: ${reason}. ${this.unsellableAdvice(pos, "log")}`);
  }

  /**
   * Vervolg na "onverkoopbaar" (logregel en snapshot): belooft alleen een automatische
   * verkoop als de bot draait én (live) gearmd is.
   */
  private unsellableAdvice(pos: Position, style: "log" | "view"): string {
    const min = fmtEur(this.exchangeMinimums(pos.market).quote);
    const rec = this.unsellable.get(pos.id);
    const at = rec?.kind === "broker" ? fmtEur(this.refusalThreshold(pos, rec)) : min;
    if (this.running && (this.mode === "paper" || this.armed)) {
      return style === "log"
        ? `De bot verkoopt zodra de waarde weer ≥ ${at} is; je kunt hem ook afschrijven.`
        : `De bot verkoopt zodra de waarde weer ≥ ${at} is; je kunt de positie ook afschrijven.`;
    }
    if (!this.running && this.mode === "paper") {
      return style === "log"
        ? `De bot staat stil — start de bot opnieuw (dan verkoopt hij zodra de waarde weer ≥ ${at} is) of schrijf de positie af.`
        : `De bot staat stil: zodra de waarde weer ≥ ${at} is kun je hem verkopen (start de bot of sluit handmatig), of schrijf hem af.`;
    }
    const how = this.running ? "arm de bot of sluit handmatig" : "start en arm de bot, of sluit handmatig";
    return (
      `${this.running ? "Live is niet gearmd" : "De bot staat stil"}, dus hij verkoopt de positie niet vanzelf. ` +
      `Zodra de waarde weer ≥ ${at} is kun je hem verkopen (${how}), of schrijf hem af.`
    );
  }

  /** Saldo van één munt op het account, of null als dat nu niet te bepalen is. */
  private async readHolding(base: string): Promise<Holding | null> {
    let balances: Balance[];
    try {
      const b = await this.broker.getBalances();
      // Een leeg antwoord kan tijdelijk zijn: dan niets concluderen.
      if (!Array.isArray(b) || b.length === 0) return null;
      balances = b;
    } catch {
      return null;
    }
    const holding = balances.find((b) => b.symbol === base);
    const avail = holding && isNum(holding.available) ? Math.max(0, holding.available) : 0;
    const inOrder = holding && isNum(holding.inOrder) ? Math.max(0, holding.inOrder) : 0;
    return { avail, inOrder, held: avail + inOrder };
  }

  /** "gone" = (vrijwel) niets meer op het account; "partial" = een deel is echt weg (niet in een order). */
  private missingKind(pos: Position, h: Holding): "gone" | "partial" | null {
    if (h.held < pos.amount * GONE_FRACTION) return "gone";
    if (h.avail < pos.amount * (1 - MAX_SELL_SHORTFALL) && !(h.inOrder > 0)) return "partial";
    return null;
  }

  /**
   * Er loopt een verkoop met onbekende uitkomst voor deze positie. Geeft de
   * reden terug waarom de bot (nog) moet wachten, of null als opnieuw verkopen mag.
   * Met `lookupOrder` beslist {@link resolveUnknownSells}; zonder wacht de bot
   * zolang er coins van deze munt in een openstaande order zitten (ook als het
   * beschikbare saldo groot genoeg is: dat kunnen eigen coins van de gebruiker zijn).
   */
  private async unknownSellWait(pos: Position, u: UnknownSell, label: string, explicit: boolean): Promise<string | null> {
    const stillHint = this.running
      ? "de bot verkoopt niet opnieuw tot die is opgehelderd"
      : "de bot staat stil — start de bot opnieuw of sluit de positie zelf op Bitvavo";
    if (this.lookupFn()) {
      const why = `er loopt nog een verkooporder met onbekende uitkomst (clientOrderId ${u.clientOrderId})`;
      this.logSellProblem(`sellwait:${pos.id}`, "warn", `${pos.market} (${label}): ${why} — ${stillHint}`, explicit);
      return why;
    }
    const { base } = splitMarket(pos.market, this.marketInfo.get(pos.market));
    const h = await this.readHolding(base);
    if (this.unknownSells.get(u.clientOrderId) !== u) return null; // intussen opgehelderd
    let why: string | null = null;
    if (!h) {
      why = `het ${base}-saldo op Bitvavo is onbekend na een verkooporder met onbekende uitkomst`;
    } else if (h.inOrder > 0) {
      why = `${fmtAmount(h.inOrder)} ${base} zit nog in een openstaande order op Bitvavo (verkoop met onbekende uitkomst)`;
    }
    if (why) {
      this.logSellProblem(`sellwait:${pos.id}`, "warn", `${pos.market} (${label}): ${why} — ${stillHint}`, explicit);
      return why;
    }
    this.unknownSells.delete(u.clientOrderId);
    this.throttle.delete(`sellwait:${pos.id}`);
    this.log(
      "info",
      `${pos.market}: geen openstaande order meer op Bitvavo na de verkoop met onbekende uitkomst — de bot controleert het saldo en verkoopt zo nodig opnieuw`,
    );
    await this.persist(true);
    return null;
  }

  /**
   * Meldt waarom een verkoop niet lukte. Automatisch (tick): hooguit één keer per
   * minuut per positie (`key`). Expliciet (handmatig sluiten / noodstop): altijd —
   * zo'n melding deelt de throttle niet met de automatische pogingen.
   */
  private logSellProblem(key: string, level: LogLevel, message: string, explicit: boolean): void {
    if (explicit) this.log(level, message);
    else this.logThrottled(key, level, message, SELL_ERROR_THROTTLE_MS, true);
  }

  /** Vervolg na een verkoop met onbekende uitkomst (voor in de logregel). */
  private unknownSellHint(): string {
    if (!this.running) return "De bot staat stil — start de bot opnieuw of sluit de positie zelf op Bitvavo.";
    return this.lookupFn()
      ? "De bot zoekt de order bij de volgende tick op bij Bitvavo en verkoopt pas opnieuw als vaststaat dat hij niet (volledig) is uitgevoerd."
      : "De bot verkoopt niet opnieuw zolang er coins in een openstaande order staan en controleert bij de volgende tick het saldo.";
  }

  /** Wat er na een mislukte verkoop gebeurt (voor in de logregel). */
  private retryHint(): string {
    if (this.running) return "nieuwe poging bij de volgende tick";
    return this.mode === "live"
      ? "de bot staat stil — start de bot opnieuw of sluit de positie zelf op Bitvavo"
      : "de bot staat stil — start de bot opnieuw of sluit de positie handmatig";
  }

  /** Live: `error` begint met "UITKOMST ONBEKEND" (de order kan nog (verder) uitgevoerd worden). */
  private hasUnknownNote(res: OrderResult): boolean {
    return (
      this.mode === "live" &&
      typeof res.error === "string" &&
      res.error.trim().toUpperCase().startsWith("UITKOMST ONBEKEND")
    );
  }

  /**
   * Live: de order is (mogelijk) nog niet afgerond — "UITKOMST ONBEKEND" in
   * `error`, of (vangnet) status "new" ook zonder die melding.
   */
  private isOpenOrUnknown(res: OrderResult): boolean {
    return this.mode === "live" && (this.hasUnknownNote(res) || res.status === "new");
  }

  /**
   * Live: niets gevuld en de order is mogelijk nog niet afgerond (of de broker
   * gooide) = we weten niet of de order is uitgevoerd.
   */
  private isUnknownOutcome(res: OrderResult, threw: boolean): boolean {
    if (this.mode !== "live") return false;
    if (threw) return true;
    return !(isNum(res.filledAmount) && res.filledAmount > 0) && this.isOpenOrUnknown(res);
  }

  /** Mag de lopende tick (nog) kopen? Niet na Stop/noodstop, ook niet halverwege. */
  private buyAllowed(): boolean {
    return this.tickGen === this.stopGen && (!this.tickWhileRunning || this.running);
  }

  private async placeOrder(req: MarketOrderRequest, price: number): Promise<{ res: OrderResult; threw: boolean }> {
    this.ordersInFlight++;
    try {
      const res = await this.broker.placeMarketOrder(req, price);
      if (!res || typeof res !== "object") throw new Error("Leeg antwoord van de broker");
      return { res, threw: false };
    } catch (err) {
      return {
        threw: true,
        res: {
          orderId: "",
          clientOrderId: req.clientOrderId,
          market: req.market,
          side: req.side,
          status: "rejected",
          filledAmount: 0,
          filledQuote: 0,
          avgPrice: 0,
          feeQuote: 0,
          timestamp: this.nowFn(),
          error: errorMessage(err),
        },
      };
    } finally {
      this.ordersInFlight--;
    }
  }

  /** Verse koers van de feed (en onthouden), of null als die er nu niet is. */
  private async fetchPrice(market: string): Promise<number | null> {
    try {
      const p = await this.io.getPrice(market, POSITION);
      if (isNum(p) && p > 0) {
        this.prices[market] = p;
        return p;
      }
    } catch {
      // geen verse koers
    }
    return null;
  }

  /**
   * Actuele koers voor handmatige exits (sluiten, noodstop); valt terug op de laatst bekende
   * koers. Snel opgeven: niet wachten op de publieke rate limit (de verkoop zelf is privé).
   */
  private async freshPrice(market: string): Promise<number> {
    try {
      const p = await this.io.getPrice(market, POSITION);
      if (isNum(p) && p > 0) {
        this.prices[market] = p;
        return p;
      }
    } catch {
      // val terug
    }
    const cached = this.prices[market];
    if (isNum(cached) && cached > 0) return cached;
    const pos = this.positions.find((p) => p.market === market);
    this.log("warn", `Geen actuele koers voor ${market}; de instapkoers wordt als referentie gebruikt`);
    return pos?.entryPrice ?? 0;
  }

  // ───────────────────────────── Account & equity ─────────────────────────────

  private priceFor(pos: Position): number {
    const p = this.prices[pos.market];
    return isNum(p) && p > 0 ? p : pos.entryPrice;
  }

  private updateEquity(): void {
    const fee = this.config.risk.takerFee;
    let value = 0;
    let unrealized = 0;
    for (const pos of this.positions) {
      const px = this.priceFor(pos);
      value += pos.amount * px;
      unrealized += pos.amount * px * (1 - fee) - pos.costQuote;
    }
    const a = this.account;
    a.equity = a.cashQuote + value;
    a.unrealizedPnl = unrealized;
    // Resultaat, correct ook na afromen en na een gewijzigde kapitaallimiet (live):
    // geld dat uit het handelsbudget gaat (afgeroomde winst, kapitaal terug bij een
    // lagere limiet) of erbij komt (hogere limiet) is een overboeking, geen winst
    // of verlies. startingEquity = ingelegd kapitaal (start + verhogingen).
    const capitalIn = a.startingEquity;
    const totalPnl = a.equity + this.skimmedQuote + this.capitalReturned - capitalIn;
    a.totalPnlQuote = totalPnl;
    a.totalReturnPct = isNum(capitalIn) && capitalIn > 0 ? (totalPnl / capitalIn) * 100 : 0;
    // Vandaag: dayStartEquity = equity van het budget bij de dagwissel.
    const dayBase = this.dayBase();
    const dayPnl = a.equity + this.skimmedToday + this.returnedToday - this.addedToday - a.dayStartEquity;
    a.dayPnlQuote = dayPnl;
    a.dayReturnPct = isNum(dayBase) && dayBase > 0 ? (dayPnl / dayBase) * 100 : 0;
  }

  /**
   * Kapitaal waarmee vandaag gehandeld wordt (basis van het dag-% en dus van de
   * dagelijkse verlieslimiet): dagstart + netto stortingen van vandaag − kapitaal dat
   * vandaag terugging. Een lagere limiet midden op de dag verkleint de basis (verlies
   * telt t.o.v. het budget dat echt handelt); verlagen en weer verhogen verdunt niets.
   */
  private dayBase(): number {
    return this.account.dayStartEquity + this.addedToday - this.returnedToday;
  }

  /**
   * Live: cumulatief bedrag dat netto uit het handelsbudget is gegaan (afgeroomd +
   * kapitaal terug − kapitaal erbij na de start). equity + dit bedrag loopt door bij
   * afromen of een gewijzigde limiet (voor `EquityPoint.skimmed`).
   */
  private netTransfersOut(): number {
    return this.skimmedQuote + this.capitalReturned - this.capitalAdded;
  }

  /**
   * Dag-startequity voor de risk manager: zo gekozen dat zijn dag-% (equity −
   * dagstart) / dagstart precies `dayReturnPct` is (dus mét wat er vandaag uit het
   * budget ging of erbij kwam). Zonder overboekingen vandaag gewoon `dayStartEquity`.
   */
  private riskDayStartEquity(): number {
    const { equity, dayStartEquity } = this.account;
    if (!(this.skimmedToday > 0) && !(this.returnedToday > 0) && !(this.addedToday > 0)) return dayStartEquity;
    const base = this.dayBase();
    // base + dagresultaat = equity + vandaag afgeroomd
    const grown = equity + this.skimmedToday;
    if (!isNum(equity) || equity <= 0 || !isNum(base) || !(grown > 0)) return base;
    // (equity − E) / E = dagresultaat / base  ⇔  E = equity × base / (base + dagresultaat)
    return (equity * base) / grown;
  }

  private positionView(pos: Position): OpenPositionView {
    const px = this.priceFor(pos);
    const unrealizedPnl = pos.amount * px * (1 - this.config.risk.takerFee) - pos.costQuote;
    const view: OpenPositionView = {
      ...pos,
      currentPrice: px,
      unrealizedPnl,
      unrealizedPct: pos.costQuote > 0 ? (unrealizedPnl / pos.costQuote) * 100 : 0,
    };
    const why = this.unsellableNow(pos, px);
    if (why) {
      const min = fmtEur(this.exchangeMinimums(pos.market).quote);
      view.unsellable = true;
      view.unsellableReason =
        `Onverkoopbaar: ${why}. ` +
        (this.pendingExit.has(pos.id)
          ? this.unsellableAdvice(pos, "view")
          : `Verkopen (ook handmatig) wordt nu geweigerd; wacht tot de waarde weer ≥ ${min} is of schrijf de positie af.`);
    }
    return view;
  }

  private accountSnapshot(): AccountSnapshot {
    this.updateEquity();
    return {
      cashQuote: this.account.cashQuote,
      equity: this.account.equity,
      dayStartEquity: this.riskDayStartEquity(),
      tradesToday: this.account.tradesToday,
      realizedPnlToday: this.account.realizedPnlToday,
      openPositions: this.positions.map((p) => ({ ...p })),
      lastLossAt: { ...this.account.lastLossAt },
      exitCostQuote: this.exitCostEstimate(),
      dayTargetReached: this.targetArmedDayKey !== null && this.targetArmedDayKey === this.account.dayKey,
    };
  }

  /** Geschatte kosten (fee + slippage) om alle open posities nu tegen de actuele koers te verkopen. */
  private exitCostEstimate(): number {
    const r = this.config.risk;
    const rate = (isNum(r.takerFee) ? r.takerFee : 0) + (isNum(r.slippagePct) ? r.slippagePct : 0);
    let cost = 0;
    for (const p of this.positions) {
      const price = this.prices[p.market];
      const px = isNum(price) && price > 0 ? price : p.entryPrice;
      if (isNum(px) && isNum(p.amount)) cost += p.amount * px * rate;
    }
    return cost;
  }

  /** Heeft elke open positie een echte (opgehaalde) koers? Anders telt hij tegen de instapkoers. */
  private pricesKnown(): boolean {
    return this.positions.every((p) => isNum(this.prices[p.market]) && this.prices[p.market] > 0);
  }

  /** Het equity-punt na een gewijzigde kapitaallimiet, zodra er echte koersen zijn. */
  private flushRebasePoint(): void {
    if (!this.pendingRebasePoint || !this.pricesKnown()) return;
    this.pendingRebasePoint = false;
    // Nieuw punt (met het nieuwe netto-eruit-bedrag), zodat equity + skimmed doorloopt.
    // Oude punten blijven ongewijzigd.
    const now = this.nowFn();
    const last = this.equityHistory[this.equityHistory.length - 1];
    this.updateEquity();
    if (!last || now > last.time) this.recordEquity(now, true);
  }

  /**
   * Legt een equity-punt vast (hooguit één per minuut, `force` = altijd). Nooit
   * zolang een open positie nog geen echte koers heeft: dan zou hij tegen de
   * instapkoers gewaardeerd worden en blijft dat punt voor altijd in de grafiek.
   */
  private recordEquity(time: number, force: boolean): void {
    const equity = this.account.equity;
    if (!isNum(equity)) return;
    if (!this.pricesKnown()) return;
    const last = this.equityHistory[this.equityHistory.length - 1];
    // Live: cumulatief netto uit het budget gehaald bedrag per punt, zodat de grafiek
    // equity + skimmed kan tonen zonder sprong bij afromen of een gewijzigde limiet.
    const skimmed = this.mode === "live" ? { skimmed: this.netTransfersOut() } : {};
    if (last && time <= last.time) {
      if (force) Object.assign(last, { equity, ...skimmed });
      return;
    }
    if (!force && last && time - last.time < EQUITY_POINT_MS) return;
    this.equityHistory.push({ time, equity, ...skimmed });
    if (this.equityHistory.length > MAX_EQUITY_POINTS) {
      // Uitdunnen: elk tweede punt weg, het nieuwste punt blijft altijd staan.
      const lastIdx = this.equityHistory.length - 1;
      this.equityHistory = this.equityHistory.filter((_, i) => (lastIdx - i) % 2 === 0);
    }
  }

  private refreshHalt(): HaltStatus {
    let h: HaltStatus;
    try {
      h = this.risk.haltStatus(this.accountSnapshot());
    } catch (err) {
      h = { halted: true, reason: `Risicocontrole mislukt: ${errorMessage(err)}` };
    }
    // Een open positie zonder actuele koers (bijv. net na een herstart) telt tegen de
    // instapkoers, en zolang de dagwissel wacht (dagstart van gisteren) is het dagresultaat
    // een mengsel van twee dagen: dan is het dagresultaat niet echt. Daarop nooit de
    // verlieslimiet of de winstgrens vastzetten (tot morgen) en nooit alles verkopen; wel
    // voorzichtig: geen nieuwe aankopen tot het klopt. Al eerder vastgezet blijft gelden.
    let unknownDay: string | null = null;
    if (h.halted && (h.dailyTarget === true || this.isDailyLossHalt(h))) {
      const missing = uniq(
        this.positions.filter((p) => !(isNum(this.prices[p.market]) && this.prices[p.market] > 0)).map((p) => p.market),
      );
      if (missing.length > 0) {
        unknownDay =
          `Dagresultaat nog onbekend: nog geen actuele koers voor ${missing.join(", ")} — ` +
          "geen nieuwe aankopen tot die koers er is";
      } else if (dayKey(this.nowFn()) !== this.account.dayKey) {
        unknownDay = "Nieuwe handelsdag nog niet verwerkt: geen nieuwe aankopen tot de dagwissel klaar is";
      }
      if (unknownDay !== null) h = { halted: false };
    }
    // De dagelijkse verlieslimiet geldt tot de dagwissel, ook als open posities
    // daarna herstellen (de risk manager zelf kijkt alleen naar de huidige equity).
    if (h.halted && this.isDailyLossHalt(h)) {
      this.haltedDayKey = this.account.dayKey;
    } else if (!h.halted && this.haltedDayKey !== null && this.haltedDayKey === this.account.dayKey) {
      h = {
        halted: true,
        reason: "Dagelijkse verlieslimiet eerder vandaag bereikt: geen nieuwe trades tot morgen",
        dailyLimit: true,
      };
    }
    // Het dagdoel geldt ook tot de dagwissel (na het vastzetten kan de equity door kosten iets dalen).
    if (h.halted && h.dailyTarget === true) {
      this.targetDayKey = this.account.dayKey;
    } else if (!h.halted && this.targetDayKey !== null && this.targetDayKey === this.account.dayKey) {
      h = { halted: true, reason: "Dagwinst vandaag vastgezet: geen nieuwe trades tot morgen", dailyTarget: true };
    }
    // dailyLimit: false, zodat isDailyLossHalt hem niet alsnog als verlieslimiet ziet.
    if (unknownDay !== null && !h.halted) h = { halted: true, reason: unknownDay, dailyLimit: false };
    // Ook melden als een andere pauze overgaat in "winst vastgezet" (dan worden posities verkocht).
    if (h.halted && (!this.halted.halted || (h.dailyTarget === true && this.halted.dailyTarget !== true))) {
      if (h.dailyTarget === true) {
        this.log(
          "info",
          `${h.reason ?? "Winst vastgezet"}. Open posities worden verkocht; morgen gaat de bot weer verder.`,
        );
      } else {
        this.log(
          "warn",
          `Nieuwe trades gepauzeerd: ${h.reason ?? "risicolimiet bereikt"} (open posities worden nog wel bewaakt)`,
        );
      }
    } else if (!h.halted && this.halted.halted) {
      this.log("info", "Handel hervat: de risicolimiet is niet meer actief");
    }
    this.halted = { ...h };
    return this.halted;
  }

  /**
   * Is deze halt de dagelijkse verlieslimiet? Via de vlag `dailyLimit` van de
   * risk manager als die er is; anders dezelfde berekening als RiskManager.haltStatus.
   */
  private isDailyLossHalt(h: HaltStatus): boolean {
    if (typeof h.dailyLimit === "boolean") return h.dailyLimit;
    const { equity } = this.account;
    const dayStartEquity = this.riskDayStartEquity();
    const limit = this.config.risk.dailyLossLimitPct;
    if (!isNum(equity) || equity <= 0 || !isNum(dayStartEquity) || dayStartEquity <= 0 || !isNum(limit)) return false;
    const changePct = ((equity - dayStartEquity) / dayStartEquity) * 100;
    return -changePct >= limit - 1e-9;
  }

  // ───────────────────────────── Marktinfo ─────────────────────────────

  private async loadMarkets(force: boolean): Promise<void> {
    const now = this.nowFn();
    if (!force && this.marketsFetchedAt !== null && now - this.marketsFetchedAt < MARKETS_REFRESH_MS) return;
    try {
      // In een tick niet laten wachten (de feed geeft bij een fout de vorige lijst).
      const list = await this.io.getMarkets(force ? undefined : FAST);
      if (Array.isArray(list) && list.length > 0) {
        this.marketInfo = new Map(list.map((m) => [m.market, m]));
      }
      this.marketsFetchedAt = now;
    } catch (err) {
      this.logThrottled(
        "markets",
        "warn",
        `Kon marktinformatie niet ophalen: ${errorMessage(err)} (standaard minimale ordergrootte wordt gebruikt)`,
      );
    }
  }

  private async reconcileLiveBalances(): Promise<void> {
    if (this.positions.length > 0 && !this.armed) {
      this.log(
        "warn",
        `Live: ${this.positions.length} open positie(s) uit de opgeslagen staat. Zolang de bot niet gearmd is worden stops NIET automatisch uitgevoerd.`,
      );
    }
    // Markten die deze run gecontroleerd worden op coins die de bot niet beheert; de tick
    // controleert later ook markten die de automatische muntkeuze erbij zet.
    this.unmanagedChecked = new Set();
    this.unmanagedRetryAt = null;
    let balances: Balance[];
    try {
      balances = await this.broker.getBalances();
      if (!Array.isArray(balances)) throw new Error("leeg antwoord");
    } catch (err) {
      this.log("warn", `Kon saldi op Bitvavo niet controleren: ${errorMessage(err)}`);
      this.unmanagedRetryAt = this.nowFn() + FETCH_RETRY_MS;
      return;
    }
    const heldOf = (base: string): number => heldIn(balances, base);
    for (const pos of this.positions) {
      const { base } = splitMarket(pos.market, this.marketInfo.get(pos.market));
      const held = heldOf(base);
      if (held < pos.amount * 0.99) {
        const gone = balances.length > 0 && held < pos.amount * GONE_FRACTION;
        this.log(
          "warn",
          `Let op: positie ${pos.market} (${fmtAmount(pos.amount)} ${base}) staat in de administratie, maar op Bitvavo staat maar ${fmtAmount(held)} ${base}` +
            (gone ? " — sluit de positie handmatig om de administratie bij te werken (er wordt dan niets verkocht)" : ""),
        );
      }
    }
    const active = this.activeMarkets();
    for (const m of active) this.unmanagedChecked.add(m);
    await this.warnUnmanaged(active, balances);
  }

  /**
   * Coins in een bot-markt die de bot NIET beheert (bijv. na een onbruikbaar statusbestand
   * of een order met onbekende uitkomst): geen stop-loss, dus melden.
   */
  private async warnUnmanaged(markets: readonly string[], balances: readonly Balance[]): Promise<void> {
    const managed = new Set(this.positions.map((p) => p.market));
    for (const market of markets) {
      if (managed.has(market)) continue;
      const info = this.marketInfo.get(market);
      const { base } = splitMarket(market, info);
      const held = heldIn(balances, base);
      if (!(held > 0)) continue;
      let price: number;
      try {
        price = await this.io.getPrice(market, FAST);
      } catch {
        const known = this.prices[market];
        if (!(isNum(known) && known > 0)) continue;
        price = known;
      }
      if (!isNum(price) || price <= 0) continue;
      if (held * price >= this.exchangeMinimums(market).quote) {
        this.log(
          "warn",
          `Er staat ${fmtAmount(held)} ${base} (~${fmtEur(held * price)}) op Bitvavo die de bot niet beheert (geen stop-loss). ` +
            "Is dat van een eerdere bot-order, verkoop het dan zelf of houd het in de gaten.",
        );
      }
    }
  }

  /**
   * Live, na de start: markten die er (door de automatische muntkeuze) bij gekomen zijn ook
   * controleren op coins die de bot niet beheert (één saldo-opvraging; mislukt → na een minuut opnieuw).
   */
  private async checkUnmanagedNew(active: readonly string[], now: number): Promise<void> {
    const checked = this.unmanagedChecked;
    if (!checked) return;
    const fresh = active.filter((m) => !checked.has(m));
    if (fresh.length === 0) return;
    if (this.unmanagedRetryAt !== null && now < this.unmanagedRetryAt) return;
    let balances: Balance[];
    try {
      balances = await this.broker.getBalances();
      if (!Array.isArray(balances)) throw new Error("leeg antwoord");
    } catch (err) {
      this.unmanagedRetryAt = now + FETCH_RETRY_MS;
      this.logThrottled("unmanaged", "warn", `Kon saldi op Bitvavo niet controleren: ${errorMessage(err)}`);
      return;
    }
    this.unmanagedRetryAt = null;
    for (const m of fresh) checked.add(m);
    await this.warnUnmanaged(fresh, balances);
  }

  // ───────────────────────────── Persistentie ─────────────────────────────

  private restoreFromStore(): void {
    if (this.restored || !this.store) return;
    this.restored = true;
    let state: PersistedState | null;
    try {
      state = this.store.load();
    } catch (err) {
      this.log("error", `Opgeslagen staat kon niet gelezen worden: ${errorMessage(err)}`);
      return;
    }
    if (!state) {
      const problem = this.store.lastLoadProblem;
      if (problem) {
        this.stateRecovery = {
          reason: problem.reason,
          ...(problem.quarantinedTo ? { quarantinedTo: problem.quarantinedTo } : {}),
          at: this.nowFn(),
        };
        this.log(
          "error",
          `Opgeslagen staat onbruikbaar (${problem.reason})${problem.quarantinedTo ? `, bewaard als ${problem.quarantinedTo}` : ""}. ` +
            (this.mode === "live"
              ? "De bot begint met een LEGE administratie: open posities van vóór de herstart worden NIET bewaakt. Controleer je Bitvavo-saldi. Armen is geblokkeerd tot je dit bevestigt."
              : "De bot begint met een LEGE administratie (oefenmodus): oefenposities en -trades van vóór de herstart zijn niet hersteld. Er staat geen echt geld op het spel; bevestig de melding om verder te gaan."),
        );
      }
      return;
    }
    if (state.mode !== this.mode) {
      this.log(
        "info",
        `Opgeslagen staat hoort bij ${state.mode} mode en wordt niet gebruikt in ${this.mode} mode`,
      );
      return;
    }
    const positions = state.positions.map(normalizePosition).filter((p): p is Position => p !== null);
    const account = sanitizeAccount(state.account, freshAccount(this.startingCapital, this.nowFn()));
    const ext = state as PersistedStateExt;
    const pos0 = (v: unknown): number => (isNum(v) && v > 0 ? v : 0);
    this.skimmedQuote = pos0(state.skimmedQuote);
    // "Vandaag"-bedragen horen bij account.dayKey (de dagwissel zet ze later op 0);
    // nooit meer dan het totaal.
    this.skimmedToday = Math.min(pos0(ext.skimmedToday), this.skimmedQuote);
    this.capitalReturned = pos0(ext.capitalReturned);
    this.returnedToday = Math.min(pos0(ext.returnedToday), this.capitalReturned);
    this.capitalAdded = pos0(ext.capitalAdded);
    // Netto stortingen van vandaag; kan ook opnieuw ingelegd kapitaal van een eerdere
    // verlaging bevatten (dus niet begrensd door capitalAdded).
    this.addedToday = pos0(ext.addedToday);
    this.capitalPending = positions.length > 0 ? pos0(ext.capitalPending) : 0;
    if (ext.ledgerVersion !== LEDGER_VERSION) {
      // Oudere bestanden verlaagden start- en dag-startequity met de afgeroomde winst;
      // nu is startequity het ingelegde kapitaal en blijft de dagstart staan.
      // Ronde 2 kapte ze af op 1e-9 (meer afgeroomd dan ingelegd): dan is het oude
      // bedrag niet terug te rekenen en is de kapitaallimiet de beste schatting.
      const limit =
        isNum(state.capitalLimitQuote) && state.capitalLimitQuote > 0 ? state.capitalLimitQuote : this.startingCapital;
      const clamped = !(account.startingEquity > OLD_LEDGER_CLAMP);
      account.startingEquity = clamped ? limit : account.startingEquity + this.skimmedQuote;
      account.dayStartEquity =
        account.dayStartEquity > OLD_LEDGER_CLAMP ? account.dayStartEquity + this.skimmedToday : limit;
      if (clamped) {
        this.log(
          "warn",
          `Oud statusbestand: het ingelegde kapitaal was daarin afgekapt (er was meer winst afgeroomd dan ingelegd). ` +
            `De bot rekent verder met de kapitaallimiet ${fmtEur(limit)} als ingelegd kapitaal; het totaalrendement is daardoor een schatting.`,
        );
      }
    }
    const rebased = this.mode === "live" && this.rebaseCapitalLimit(account, positions, state);
    this.account = account;
    this.positions = positions;
    this.haltedDayKey =
      typeof state.haltedDayKey === "string" && state.haltedDayKey === account.dayKey ? state.haltedDayKey : null;
    this.targetDayKey =
      typeof state.targetDayKey === "string" && state.targetDayKey === account.dayKey ? state.targetDayKey : null;
    this.targetArmedDayKey =
      typeof state.targetArmedDayKey === "string" && state.targetArmedDayKey === account.dayKey ? state.targetArmedDayKey : null;
    if (this.mode === "live" && Array.isArray(state.unknownOrders)) {
      for (const u of state.unknownOrders as UnknownBuy[]) {
        if (!u || typeof u.market !== "string" || typeof u.clientOrderId !== "string" || !u.clientOrderId) continue;
        this.unknownBuys.set(u.clientOrderId, {
          market: u.market,
          clientOrderId: u.clientOrderId,
          quoteAmount: isNum(u.quoteAmount) ? u.quoteAmount : 0,
          // Zonder tijdstip: vanaf nu (de wachttijd vóór "niet geplaatst" begint dan nu).
          at: isNum(u.at) && u.at > 0 ? u.at : this.nowFn(),
          stopDist: isNum(u.stopDist) ? u.stopDist : 0,
          tpDist: isNum(u.tpDist) ? u.tpDist : 0,
          entryReason: typeof u.entryReason === "string" ? u.entryReason : "",
          ...(typeof u.positionId === "string" ? { positionId: u.positionId } : {}),
          ...bookedFill(u),
          ...notFoundTrack(u),
        });
      }
    }
    const rawSells = (state as PersistedStateExt).unknownSells;
    if (this.mode === "live" && Array.isArray(rawSells)) {
      for (const u of rawSells) {
        if (!u || typeof u !== "object") continue;
        if (typeof u.clientOrderId !== "string" || !u.clientOrderId || typeof u.market !== "string") continue;
        if (typeof u.positionId !== "string" || !positions.some((p) => p.id === u.positionId)) {
          this.log(
            "warn",
            `Verkooporder ${u.market} met onbekende uitkomst (clientOrderId ${u.clientOrderId}) hoort bij een positie die niet meer in de administratie staat — controleer je Bitvavo-account`,
          );
          continue;
        }
        const reason: ExitReason = typeof u.reason === "string" && u.reason in EXIT_REASON_LABELS ? u.reason : "manual";
        this.unknownSells.set(u.clientOrderId, {
          clientOrderId: u.clientOrderId,
          positionId: u.positionId,
          market: u.market,
          amount: isNum(u.amount) ? u.amount : 0,
          reason,
          at: isNum(u.at) && u.at > 0 ? u.at : this.nowFn(),
          ...bookedFill(u),
          ...notFoundTrack(u),
        });
        // De bot was deze positie aan het verkopen: na de herstart gaat de exit
        // gewoon door zodra de uitkomst van die order vaststaat.
        this.pendingExit.set(u.positionId, reason);
      }
    }
    const le = state.lastEvaluated;
    if (le && le.interval === this.config.interval && le.candles && typeof le.candles === "object") {
      for (const [m, t] of Object.entries(le.candles)) {
        if (isNum(t)) this.evaluatedBeforeRestart.set(m, t);
      }
    }
    // Laatste automatische muntkeuze: gebruikt tot de eerste nieuwe keuze (als < 24 uur oud).
    const au = state.autoUniverse;
    if (au && typeof au === "object" && Array.isArray(au.markets) && isNum(au.at)) {
      const markets = uniq(
        au.markets.filter((m): m is string => typeof m === "string" && m.trim().length > 0).map((m) => m.trim().toUpperCase()),
      ).slice(0, MAX_MARKETS);
      if (markets.length > 0) this.persistedAuto = { markets, at: au.at };
    }
    const rec = state.stateRecovery;
    if (rec && typeof rec.reason === "string") {
      this.stateRecovery = {
        reason: rec.reason,
        ...(typeof rec.quarantinedTo === "string" ? { quarantinedTo: rec.quarantinedTo } : {}),
        at: isNum(rec.at) ? rec.at : 0,
      };
    }
    this.trades = state.trades
      .filter((t) => t && typeof t === "object" && typeof t.id === "string")
      .slice(-MAX_TRADES_KEPT);
    this.equityHistory = state.equityHistory
      .filter((e) => e && isNum(e.time) && isNum(e.equity))
      .slice(-MAX_EQUITY_POINTS);
    if (this.mode === "paper" && Array.isArray(state.paperBalances)) {
      this.paperBalances = state.paperBalances;
      const b = this.broker as Broker & { restore?: (balances: Balance[]) => void };
      if (typeof b.restore === "function") b.restore(state.paperBalances);
    }
    this.updateEquity();
    if (rebased) {
      // Punt direct na de gewijzigde limiet — maar pas als elke open positie een echte
      // koers heeft (zonder posities meteen): nooit tegen de instapkoers.
      this.pendingRebasePoint = true;
      this.flushRebasePoint();
    }
    this.log(
      "info",
      `Opgeslagen staat hersteld: ${positions.length} open positie(s), ${this.trades.length} trade(s), cash ${fmtEur(account.cashQuote)}`,
    );
    const dropped = state.positions.length - positions.length;
    if (dropped > 0) this.log("warn", `${dropped} ongeldige positie(s) in de opgeslagen staat genegeerd`);
    if (this.unknownBuys.size > 0) this.logUnknownBuysBlocking();
    if (this.unknownSells.size > 0) this.logUnknownSellsPending();
    if (this.stateRecovery) {
      this.log(
        "error",
        `Nog niet bevestigd: de opgeslagen staat was eerder onbruikbaar (${this.stateRecovery.reason}). ` +
          (this.mode === "live"
            ? "Controleer je Bitvavo-saldi en bevestig dat."
            : "De oefenadministratie (paper) begon toen opnieuw; bevestig de melding om verder te gaan."),
      );
    }
  }

  /**
   * Live: de kapitaallimiet kan tussen twee runs veranderd zijn. Cash + inleg
   * van open posities moet binnen de (nieuwe) limiet blijven.
   *  - Verhoging: het verschil komt als extra budget bij de cash; dat is ingelegd
   *    kapitaal (startequity omhoog, `capitalAdded`).
   *  - Verlaging: het budget wordt min(nieuwe limiet, wat de bot nu heeft) —
   *    heeft de bot al verlies gemaakt, dan gaat er minder (of niets) af, niet
   *    het volledige verschil. Wat eraf gaat is kapitaal dat terugging
   *    (`capitalReturned`), geen winst.
   * Het verschil is een storting/opname, geen resultaat: totaal- en dagresultaat
   * (en dus de dagelijkse verlieslimiet) veranderen er niet door, en
   * `EquityPoint.skimmed` (netto eruit) schuift mee zodat de grafiek doorloopt.
   * Een verhoging legt eerst kapitaal terug in dat bij een eerdere verlaging terugging
   * (verlagen en weer verhogen verdunt het rendement dus niet); alleen de rest is nieuw
   * ingelegd kapitaal. Zelfde limiet = niets doen (ook niet bij een negatieve cash door
   * een alsnog gevulde koop: dat is geen storting).
   */
  private rebaseCapitalLimit(account: AccountState, positions: Position[], state: PersistedState): boolean {
    const oldLimit =
      isNum(state.capitalLimitQuote) && state.capitalLimitQuote > 0 ? state.capitalLimitQuote : account.startingEquity;
    const raised = isNum(oldLimit) ? this.startingCapital - oldLimit : 0;
    if (!(Math.abs(raised) > 1e-9)) return false;
    const openCost = positions.reduce((s, p) => s + p.costQuote, 0);
    const room = Math.max(0, this.startingCapital - openCost);
    const cash = account.cashQuote;
    // Verhoging: hooguit het verschil erbij, en niet boven de ruimte. Verlaging: cash
    // hooguit tot de ruimte (min(nieuwe limiet, wat de bot heeft)), nooit omhoog.
    const delta = raised > 0 ? Math.min(raised, Math.max(0, room - cash)) : Math.min(0, room - cash);
    // Zit er meer dan de (nieuwe) limiet in open posities, dan gaat dat deel bij de
    // verkoop alsnog terug als kapitaal (zie enforceCapitalLimit).
    this.capitalPending = Math.max(0, openCost - this.startingCapital);
    if (Math.abs(delta) <= 1e-9) return false;
    const equity = isNum(account.equity) && account.equity > 0 ? account.equity : cash + openCost;
    let reused = 0;
    if (delta > 0) {
      // Eerst terugleggen wat bij eerdere verlagingen terugging (vandaag teruggegaan kapitaal
      // eerst: dat verrekent binnen de dag), alleen de rest is nieuw ingelegd kapitaal.
      reused = Math.min(delta, this.capitalReturned);
      this.capitalReturned -= reused;
      const fromToday = Math.min(delta, this.returnedToday);
      this.returnedToday -= fromToday;
      this.addedToday += delta - fromToday;
      const fresh = delta - reused;
      account.startingEquity += fresh;
      this.capitalAdded += fresh;
    } else {
      this.capitalReturned -= delta;
      this.returnedToday -= delta;
    }
    account.cashQuote = cash + delta;
    account.equity = equity + delta;
    this.log(
      "info",
      `Kapitaallimiet ${fmtEur(isNum(oldLimit) ? oldLimit : this.startingCapital)} → ${fmtEur(this.startingCapital)}: ` +
        (delta > 0
          ? `${fmtEur(delta)} extra kapitaal in het handelsbudget (storting` +
            (reused > 1e-9
              ? `; ${fmtEur(reused)} daarvan ging eerder terug bij een lagere limiet en telt niet als nieuw ingelegd kapitaal)`
              : ")")
          : `${fmtEur(-delta)} kapitaal terug buiten het handelsbudget (opname)`) +
        ` — cash nu ${fmtEur(account.cashQuote)}, inleg open posities ${fmtEur(openCost)}; telt niet mee in het resultaat`,
    );
    return true;
  }

  private persistedState(): PersistedState {
    const evaluated: Record<string, number> = Object.fromEntries(this.evaluatedBeforeRestart);
    for (const [m, t] of this.lastEvaluated) evaluated[m] = Math.max(t, evaluated[m] ?? t);
    const state: PersistedStateExt = {
      version: 1,
      mode: this.mode,
      savedAt: this.nowFn(),
      account: { ...this.account, lastLossAt: { ...this.account.lastLossAt } },
      positions: this.positions.map((p) => ({ ...p })),
      trades: this.trades.map((t) => ({ ...t })),
      equityHistory: this.equityHistory.map((e) => ({ ...e })),
      ...(this.mode === "paper" && this.paperBalances
        ? { paperBalances: this.paperBalances.map((b) => ({ ...b })) }
        : {}),
      ...(this.mode === "live" ? { capitalLimitQuote: this.startingCapital } : {}),
      lastEvaluated: { interval: this.config.interval, candles: evaluated },
      ...(this.unknownBuys.size > 0 ? { unknownOrders: [...this.unknownBuys.values()].map((u) => ({ ...u })) } : {}),
      ...(this.haltedDayKey ? { haltedDayKey: this.haltedDayKey } : {}),
      ...(this.targetDayKey ? { targetDayKey: this.targetDayKey } : {}),
      ...(this.targetArmedDayKey ? { targetArmedDayKey: this.targetArmedDayKey } : {}),
      ledgerVersion: LEDGER_VERSION,
      ...(this.skimmedQuote > 0 ? { skimmedQuote: this.skimmedQuote } : {}),
      ...(this.skimmedToday > 0 ? { skimmedToday: this.skimmedToday } : {}),
      ...(this.capitalReturned > 0 ? { capitalReturned: this.capitalReturned } : {}),
      ...(this.returnedToday > 0 ? { returnedToday: this.returnedToday } : {}),
      ...(this.capitalAdded > 0 ? { capitalAdded: this.capitalAdded } : {}),
      ...(this.addedToday > 0 ? { addedToday: this.addedToday } : {}),
      ...(this.capitalPending > 0 ? { capitalPending: this.capitalPending } : {}),
      ...(this.stateRecovery ? { stateRecovery: { ...this.stateRecovery } } : {}),
      ...(this.unknownSells.size > 0 ? { unknownSells: [...this.unknownSells.values()].map((u) => ({ ...u })) } : {}),
      ...this.persistedAutoUniverse(),
    };
    return state;
  }

  /** De laatste automatische muntkeuze (deze run, anders de geladen) voor het statusbestand. */
  private persistedAutoUniverse(): Pick<PersistedState, "autoUniverse"> {
    if (this.autoSel) return { autoUniverse: { markets: [...this.autoSel.markets], at: this.autoSel.at } };
    if (this.persistedAuto) return { autoUniverse: { markets: [...this.persistedAuto.markets], at: this.persistedAuto.at } };
    return {};
  }

  private async persist(flush: boolean): Promise<void> {
    if (!this.store) return;
    if (this.mode === "paper") {
      try {
        this.paperBalances = await this.broker.getBalances();
      } catch {
        // laatst bekende balances gebruiken
      }
    }
    this.persistSync(flush);
  }

  private persistSync(flush: boolean): void {
    if (!this.store) return;
    try {
      this.store.save(this.persistedState());
      if (flush) this.store.flush();
    } catch (err) {
      this.logThrottled("persist", "error", `Kon de staat niet opslaan: ${errorMessage(err)}`);
    }
  }

  // ───────────────────────────── Hulpfuncties ─────────────────────────────

  /** Broker (paper én live) rekent met dezelfde fee/slippage als de risk manager. */
  private applyBrokerCosts(risk: RiskConfig): void {
    if (typeof this.broker.setCosts !== "function") return;
    try {
      this.broker.setCosts(risk.takerFee, risk.slippagePct);
    } catch (err) {
      this.log("warn", `Kosten konden niet aan de broker doorgegeven worden: ${errorMessage(err)}`);
    }
  }

  private scheduleNext(): void {
    if (!this.running) return;
    if (this.timer) clearTimeout(this.timer);
    const delay = Math.max(MIN_POLL_MS, this.config.pollMs);
    this.timer = setTimeout(() => {
      this.timer = null;
      if (!this.running) return;
      void this.tick().finally(() => this.scheduleNext());
    }, delay);
  }

  private clearMonitorTimer(): void {
    if (this.monitorTimer) {
      clearTimeout(this.monitorTimer);
      this.monitorTimer = null;
    }
  }

  /** Volgende koersverversing terwijl de bot stilstaat (alleen als de bewaking aan staat). */
  private scheduleMonitor(): void {
    this.clearMonitorTimer();
    if (!this.monitorEnabled || this.running) return;
    const delay = Math.max(MIN_POLL_MS, this.config.pollMs);
    const timer = setTimeout(() => {
      if (this.monitorTimer === timer) this.monitorTimer = null;
      if (!this.monitorEnabled || this.running) return;
      void this.refreshPricesWhileStopped().finally(() => this.scheduleMonitor());
    }, delay);
    // Houdt het proces niet in leven (de HTTP-server doet dat al).
    timer.unref?.();
    this.monitorTimer = timer;
  }

  /**
   * Alleen koersen verversen (ingestelde markten + markten met open posities), equity
   * bijwerken en "price" + "snapshot" sturen — geen beslissingen, orders of
   * saldo-opvragingen. Doet niets als de bot draait (dan doet de tick het).
   */
  private refreshPricesWhileStopped(): Promise<void> {
    if (this.running) return Promise.resolve();
    if (this.monitorRun) return this.monitorRun;
    const run = (async () => {
      const fetched: { market: string; price: number; event: boolean }[] = [];
      let lastError: unknown = null;
      const positionMarkets = uniq(this.positions.map((p) => p.market));
      const active = this.activeMarkets();
      if (this.hasBulkPrices()) {
        // Eén verzoek voor alle koersen. Alleen "price"-events voor posities (de snapshot draagt de rest).
        const inPosition = new Set(positionMarkets);
        let all: Record<string, number> | null = null;
        try {
          all = await this.feed.getPrices!();
        } catch (err) {
          lastError = err;
        }
        if (all && typeof all === "object") {
          for (const market of uniq([...active, ...positionMarkets])) {
            const price = Object.hasOwn(all, market) ? all[market] : undefined;
            if (isNum(price) && price > 0) fetched.push({ market, price, event: inPosition.has(market) });
          }
        }
        // Posities zonder koers in het bulkantwoord: los ophalen.
        const have = new Set(fetched.map((f) => f.market));
        for (const market of positionMarkets) {
          if (have.has(market)) continue;
          try {
            const price = await this.feed.getPrice(market);
            if (isNum(price) && price > 0) fetched.push({ market, price, event: true });
          } catch (err) {
            lastError = err;
          }
        }
      } else {
        // Per markt: de posities en de eerste actieve markten.
        for (const market of uniq([...active.slice(0, PRICE_FALLBACK_MARKETS), ...positionMarkets])) {
          try {
            const price = await this.feed.getPrice(market);
            if (isNum(price) && price > 0) fetched.push({ market, price, event: true });
          } catch (err) {
            lastError = err;
          }
        }
      }
      // Intussen gestart (of een tick bezig): die werkt de koersen zelf bij. Een positie die
      // nog GEEN koers heeft (net na een herstart) krijgt deze echte koers wel: anders telt
      // hij in de eerste tick tegen de instapkoers (verkeerd dagresultaat).
      if (this.running || this.tickInFlight) {
        for (const { market, price } of fetched) {
          const known = this.prices[market];
          if (!(isNum(known) && known > 0)) this.prices[market] = price;
        }
        return;
      }
      const now = this.nowFn();
      if (fetched.length === 0) {
        if (lastError !== null) {
          this.logThrottled("monitor", "warn", `Koersen niet ververst terwijl de bot stilstaat: ${errorMessage(lastError)}`);
        }
        // Zonder open posities kan de dagwissel ook zonder koersen.
        this.rolloverWhileStopped(now);
        return;
      }
      for (const { market, price, event } of fetched) {
        this.prices[market] = price;
        if (event) this.emitEvent("price", { market, price, time: now });
      }
      this.updateEquity();
      this.rolloverWhileStopped(now);
      this.flushRebasePoint();
      this.recordEquity(now, false);
      this.emitSnapshot();
    })().catch((err: unknown) => {
      this.logThrottled("monitor", "warn", `Koersen niet ververst terwijl de bot stilstaat: ${errorMessage(err)}`);
    });
    const tracked = run.finally(() => {
      if (this.monitorRun === tracked) this.monitorRun = null;
    });
    this.monitorRun = tracked;
    return tracked;
  }

  /**
   * Dagwissel terwijl de bot stilstaat (koersbewaking): anders blijven "vandaag", de
   * dagtellers en een dagdoel- of verlieslimiet-pauze van gisteren staan tot iemand op
   * Start drukt. Alleen als er geen order of noodstop loopt; zonder actuele koers voor
   * elke positie wacht checkDayRollover zelf.
   */
  private rolloverWhileStopped(now: number): void {
    if (this.running || this.tickInFlight || this.ordersInFlight > 0 || this.killsInProgress > 0) return;
    const day = this.account.dayKey;
    this.checkDayRollover(now);
    if (this.account.dayKey === day) return;
    this.refreshHalt();
    this.persistSync(false);
  }

  private exclusive<T>(fn: () => Promise<T>): Promise<T> {
    const run = this.lockChain.then(fn, fn);
    this.lockChain = run.catch(() => undefined);
    return run;
  }

  private emitEvent<K extends ServerEventType>(type: K, data: EventPayloads[K]): void {
    try {
      this.emit(type, data);
    } catch (err) {
      // Een kapotte listener mag de administratie nooit onderbreken.
      console.error(`[engine] listener voor "${type}" gooide een fout:`, err);
    }
  }

  private emitSnapshot(): void {
    this.emitEvent("snapshot", this.snapshot());
  }

  private log(level: LogLevel, message: string): void {
    const entry: LogEntry = { time: this.nowFn(), level, message };
    this.logs.push(entry);
    if (this.logs.length > MAX_LOGS) this.logs.splice(0, this.logs.length - MAX_LOGS);
    this.emitEvent("log", { ...entry });
  }

  /**
   * Logt onder `key` hooguit één keer per `windowMs`: dezelfde melding
   * (standaard) of — met `perKey` — welke melding dan ook onder die key.
   */
  private logThrottled(
    key: string,
    level: LogLevel,
    message: string,
    windowMs = WARN_THROTTLE_MS,
    perKey = false,
  ): void {
    const now = this.nowFn();
    const prev = this.throttle.get(key);
    if (prev && (perKey || prev.message === message) && now - prev.at < windowMs) return;
    this.throttle.set(key, { message, at: now });
    this.log(level, message);
  }

  /** Afwijzingsredenen hooguit één keer per gesloten candle per markt (de radar krijgt hem altijd). */
  private logRejection(market: string, candleTime: number, message: string): void {
    this.entryRejection.set(market, shortRejection(message));
    if (this.rejectLogged.get(market) === candleTime) return;
    this.rejectLogged.set(market, candleTime);
    this.log("info", message);
  }
}
