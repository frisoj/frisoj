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
 * (`startingCapital`; afgeroomde winst is een opname, geen verlies) en worden
 * er pas echte orders geplaatst na `arm()`.
 *
 * Veiligheid:
 *  - Stop/noodstop hogen `stopGen` op: een lopende tick opent daarna geen posities meer.
 *  - Een live koop met onbekende uitkomst pauzeert ALLE nieuwe entries (opgeslagen)
 *    tot `broker.lookupOrder` (optioneel) hem terugvindt, Bitvavo hem 3 ticks op rij
 *    niet kent, of de gebruiker `acknowledgeUnknownOrders()` aanroept.
 *  - Een live verkoop met onbekende uitkomst wordt ook onthouden (opgeslagen): voor
 *    die positie gaat er geen tweede verkooporder uit tot de uitkomst bekend is.
 *  - Een verkoop onder het beursminimum wordt niet verstuurd: de positie is dan
 *    "onverkoopbaar" (zichtbaar in de snapshot) tot de waarde herstelt, of de
 *    gebruiker hem afschrijft (`writeOffPosition`).
 *  - Coins die niet meer op Bitvavo staan worden pas na twee waarnemingen (twee
 *    ticks, of bij handmatig sluiten twee saldo-opvragingen) als gesloten geboekt.
 *  - Per markt wordt dezelfde candle niet twee keer verhandeld (ook niet na een
 *    herstart of een gewijzigde marktlijst).
 *  - De dagelijkse verlieslimiet geldt tot de dagwissel.
 *  - Een onbruikbaar statusbestand blokkeert armen tot `acknowledgeStateRecovery()`.
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
  type MarketInfo,
  type MarketOrderRequest,
  type OpenPositionView,
  type OrderResult,
  type PersistedState,
  type Position,
  type PositionUpdate,
  type RiskConfig,
  type RiskManagerLike,
  type ServerEvent,
  type ServerEventType,
  type Trade,
  type TradingMode,
} from "../core/types";
import { closedCandles, dayKey, newId } from "../core/util";
import { roundAmount } from "../exchange/precision";
import { RiskManager } from "../risk/riskManager";
import { runEnsemble } from "../strategies/ensemble";
import { getStrategy, isStrategyId, resolveParams } from "../strategies/registry";
import {
  decisionSummary,
  entryReasonText,
  errorMessage,
  EXIT_REASON_LABELS,
  exitReasonLabel,
  fmtAmount,
  fmtEur,
  fmtPrice,
  fmtSignedEur,
  fmtSignedPct,
} from "./format";
import type { StateStore } from "./stateStore";

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
/** Beursminimum per order (EUR) als de marktinfo het niet vermeldt (Bitvavo: €5) */
const DEFAULT_EXCHANGE_MIN_QUOTE = 5;
/** Zo vaak op rij (in verschillende ticks) moet Bitvavo een order met onbekende uitkomst "niet kennen" */
const NOT_FOUND_CONFIRMATIONS = 3;
/** Voorvoegsel waarmee de brokers een verkoop onder het beursminimum weigeren */
const UNSELLABLE_PREFIX = "ONVERKOOPBAAR";

/** Kooporder met onbekende uitkomst (+ teller: zo vaak op rij "niet gevonden" bij Bitvavo) */
type UnknownBuy = NonNullable<PersistedState["unknownOrders"]>[number] & { nullCount?: number };
/** Verkooporder met onbekende uitkomst: voor deze positie gaat er geen tweede verkoop uit. */
interface UnknownSell {
  clientOrderId: string;
  positionId: string;
  market: string;
  /** Gevraagde hoeveelheid base */
  amount: number;
  /** Exit-reden waarmee een (alsnog) gevulde verkoop geboekt wordt */
  reason: ExitReason;
  at: number;
  /** Deel dat al als exit geboekt is (bij een deels bekende vulling) */
  bookedAmount?: number;
  /** Zo vaak op rij (per tick) meldde Bitvavo dat de order niet bestaat */
  nullCount?: number;
}
/**
 * Opgeslagen staat met engine-eigen extra velden. types.ts blijft ongewijzigd;
 * oudere bestanden zonder deze velden laden gewoon.
 */
type PersistedStateExt = PersistedState & {
  unknownSells?: UnknownSell[];
  /** Live: vandaag (account.dayKey) afgeroomde winst — voor het dagrendement */
  skimmedToday?: number;
};
type StateRecovery = NonNullable<PersistedState["stateRecovery"]>;
/** Wat de laatste saldo-opvraging over één munt zegt */
interface Holding {
  avail: number;
  inOrder: number;
  held: number;
}

function isNum(v: unknown): v is number {
  return typeof v === "number" && Number.isFinite(v);
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
   * positie-id → waarom een verkoop nu niet kan (onder het beursminimum). "engine" =
   * eigen controle (verdwijnt zodra de waarde herstelt), "broker" = de broker
   * weigerde met "ONVERKOOPBAAR" (verdwijnt bij de eerstvolgende gelukte verkoop).
   * De melding wordt één keer per episode gelogd, niet elke tick.
   */
  private unsellable = new Map<string, { kind: "engine" | "broker"; reason: string }>();
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
  /** Live: cumulatief boven de kapitaallimiet gehouden winst */
  private skimmedQuote = 0;
  /** Live: deel van `skimmedQuote` dat vandaag (sinds de dagwissel) is afgeroomd */
  private skimmedToday = 0;
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
    if (this.running) return;
    this.restoreFromStore();
    this.applyBrokerCosts(this.config.risk);
    this.running = true;
    this.startedAt = this.nowFn();
    const modeText = this.mode === "live" ? "LIVE" : "paper";
    this.log(
      "info",
      `Bot gestart (${modeText}, ${this.config.interval}, markten: ${this.config.markets.join(", ") || "geen"})`,
    );
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
      await this.persist(true);
    });
    if (wasRunning) this.log("info", "Bot gestopt");
    this.emitSnapshot();
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
    return {
      running: this.running,
      mode: this.mode,
      dataSource: this.feed.source,
      liveArmed: this.liveArmed,
      startedAt: this.startedAt,
      lastTickAt: this.lastTickAt,
      config: cloneConfig(this.config),
      account: { ...this.account, lastLossAt: { ...this.account.lastLossAt } },
      positions: this.positions.map((p) => this.positionView(p)),
      trades: this.trades
        .slice(-MAX_TRADES_SNAPSHOT)
        .reverse()
        .map((t) => ({ ...t })),
      equityHistory: this.equityHistory.map((e) => ({ ...e })),
      decisions: { ...this.decisions },
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
    };
  }

  updateConfig(partial: Partial<EngineConfig>): EngineConfig {
    const prev = this.config;
    const p: Partial<EngineConfig> = partial ?? {};
    const next = cloneConfig({
      ...prev,
      ...p,
      risk: { ...prev.risk, ...(p.risk ?? {}) },
      ensemble: { ...prev.ensemble, ...(p.ensemble ?? {}) },
    });
    if (!INTERVALS.includes(next.interval)) {
      throw new Error(`Ongeldig interval: ${String(next.interval)}`);
    }
    if (!Array.isArray(next.markets) || next.markets.some((m) => typeof m !== "string" || !m.trim())) {
      throw new Error("Ongeldige lijst met markten");
    }
    next.markets = [...new Set(next.markets.map((m) => m.trim().toUpperCase()))];
    if (!isNum(next.pollMs) || next.pollMs <= 0) {
      throw new Error("Het poll-interval (pollMs) moet een positief getal zijn");
    }
    if (!Number.isInteger(next.historyCandles) || next.historyCandles < 2) {
      throw new Error("historyCandles moet een geheel getal van minimaal 2 zijn");
    }
    // Eerst de nieuwe risk manager maken: gooit hij, dan blijft de oude config actief.
    const risk = this.createRiskFn(next.risk, next.interval);

    const intervalChanged = prev.interval !== next.interval;
    const marketsChanged = !sameList(prev.markets, next.markets);
    const pollChanged = prev.pollMs !== next.pollMs;
    this.config = next;
    this.risk = risk;
    // Broker (paper én live) rekent met dezelfde kosten als de risk manager.
    this.applyBrokerCosts(next.risk);

    if (intervalChanged) {
      this.lastEvaluated.clear();
      this.evaluatedBeforeRestart.clear();
      this.rejectLogged.clear();
    } else if (marketsChanged) {
      // Markten die blijven houden hun evaluatie: anders wordt de laatste (al
      // verhandelde) candle opnieuw beoordeeld en kan dezelfde koop herhaald worden.
      // Nieuwe markten hebben nog niets en worden direct beoordeeld.
      for (const map of [this.lastEvaluated, this.evaluatedBeforeRestart, this.rejectLogged]) {
        for (const m of [...map.keys()]) if (!next.markets.includes(m)) map.delete(m);
      }
    }
    if (intervalChanged) {
      this.lastAtr.clear();
      this.decisions = {};
      // Alleen candles in het nieuwe interval die vanaf nu sluiten tellen nog mee.
      const cursor = this.nowFn() - INTERVAL_MS[next.interval];
      for (const pos of this.positions) this.posCursor.set(pos.id, cursor);
    } else if (marketsChanged) {
      for (const m of Object.keys(this.decisions)) {
        if (!next.markets.includes(m)) delete this.decisions[m];
      }
    }

    const changed = Object.keys(p).filter((k) => k in prev);
    this.log("info", `Instellingen bijgewerkt${changed.length ? ` (${changed.join(", ")})` : ""}`);
    if (pollChanged && this.running && this.timer) this.scheduleNext();
    this.emitSnapshot();
    return cloneConfig(next);
  }

  closePosition(id: string, reason: ExitReason = "manual"): Promise<Trade | null> {
    return this.exclusive(async () => {
      this.closeFailure = null;
      const pos = this.positions.find((p) => p.id === id);
      if (!pos) {
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
      this.updateEquity();
      this.emitSnapshot();
      return trade ?? resolved;
    });
  }

  /**
   * Noodstop: bot stilzetten, ontwapenen en alle posities verkopen. Geeft terug
   * hoeveel posities gesloten zijn en welke NIET (met Nederlandse reden, bijv.
   * onverkoopbaar, afgewezen of uitkomst onbekend).
   */
  async killSwitch(): Promise<KillResult> {
    // Eerst de lus stilzetten zodat er geen nieuwe entries meer komen, ook niet
    // in een tick die nu nog loopt (stopGen) — en direct ontwapenen: de
    // noodstop-verkopen zelf zijn expliciet en gaan ook ontwapend door.
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
    await this.exclusive(async () => {
      // Eerst ophelderen wat er met orders van onbekende uitkomst gebeurd is: een
      // alsnog gevulde koop wordt zo een positie die hieronder verkocht wordt.
      // ("Niet gevonden" telt hier niet mee voor de 3 waarnemingen.)
      if (this.unknownBuys.size > 0) await this.resolveUnknownBuys(false);
      if (this.unknownSells.size > 0) await this.resolveUnknownSells(false);
      // Pas tellen als een lopende tick klaar is.
      this.log(
        "error",
        `NOODSTOP geactiveerd: ${this.positions.length} open positie(s) worden gesloten en de bot stopt`,
      );
      for (const pos of [...this.positions]) {
        if (!this.positions.includes(pos)) continue;
        const price = await this.freshPrice(pos.market);
        await this.exitPosition(pos, "kill-switch", price, true);
        if (this.positions.includes(pos)) {
          failed.push({
            id: pos.id,
            market: pos.market,
            reason: this.exitFailure ?? "verkoop mislukt (zie het logboek)",
          });
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
    // Nogmaals: iemand kan tijdens de noodstop opnieuw gearmd hebben.
    const rearmed = this.mode === "live" && this.armed;
    this.armed = false;
    if (wasArmed || rearmed) this.log("warn", "Live mode ontwapend na de noodstop");
    await this.stop();
    if (failed.length) {
      this.log(
        "error",
        `NOODSTOP: ${closed} positie(s) gesloten, ${failed.length} NIET gesloten (${failed
          .map((f) => `${f.market}: ${f.reason}`)
          .join("; ")}) — controleer je account en sluit handmatig!`,
      );
    } else {
      this.log("error", `NOODSTOP voltooid: ${closed} positie(s) gesloten, bot gestopt`);
    }
    this.emitSnapshot();
    return { closed, failed: failed.map((f) => ({ ...f })) };
  }

  /**
   * Schrijft een ONVERKOOPBARE positie (waarde onder het beursminimum) af: de
   * bot beheert hem niet meer en boekt de volledige inleg als verlies. De coins
   * blijven op het account staan; de cash verandert niet.
   */
  writeOffPosition(id: string): Trade {
    const pos = this.positions.find((p) => p.id === id);
    if (!pos) throw new Error(`Positie ${id} niet gevonden (al gesloten?)`);
    const price = this.priceFor(pos);
    const dust = this.unsellableNow(pos, price);
    if (!dust) {
      throw new Error(
        `Afschrijven kan alleen voor een onverkoopbare positie (waarde onder het beursminimum). ` +
          `${pos.market} is nu ~${fmtEur(pos.amount * price)} waard en kan gewoon verkocht worden: sluit de positie in plaats daarvan.`,
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
      exitReason: "manual",
      candlesHeld: pos.candlesHeld,
      entryReason: `${pos.entryReason} · afgeschreven (onverkoopbaar restant blijft op je account)`,
    };
    this.account.realizedPnl += pnl;
    this.account.realizedPnlToday += pnl;
    if (pnl < 0) this.account.lastLossAt[pos.market] = now;
    this.trades.push(trade);
    if (this.trades.length > MAX_TRADES_KEPT) this.trades.splice(0, this.trades.length - MAX_TRADES_KEPT);
    this.forgetPosition(pos);
    this.updateEquity();
    this.recordEquity(now, true);
    this.emitEvent("position-closed", { ...trade });
    const { base } = splitMarket(pos.market, this.marketInfo.get(pos.market));
    this.log(
      "warn",
      `${pos.market} afgeschreven (${dust}): ${fmtAmount(pos.amount)} ${base} blijft op je ${this.mode === "live" ? "Bitvavo-account" : "paper-account"} staan ` +
        `maar wordt niet meer door de bot beheerd; ${fmtSignedEur(pnl)} als verlies geboekt`,
    );
    this.persistSync(true);
    this.emitSnapshot();
    return { ...trade };
  }

  arm(): void {
    if (this.mode !== "live" || this.armed) return;
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
    this.skimmedQuote = 0;
    this.skimmedToday = 0;
    this.pendingExit.clear();
    this.posCursor.clear();
    this.rejectLogged.clear();
    this.unsellable.clear();
    this.vanishedSeen.clear();
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
    for (const market of this.marketsToProcess()) {
      try {
        await this.processMarket(market, now);
      } catch (err) {
        this.log("error", `Fout bij verwerken van ${market}: ${errorMessage(err)}`);
      }
    }
  }

  private async afterTick(): Promise<void> {
    this.updateEquity();
    this.recordEquity(this.nowFn(), false);
    this.refreshHalt();
    await this.persist(false);
    this.emitSnapshot();
  }

  private marketsToProcess(): string[] {
    return [...new Set([...this.config.markets, ...this.positions.map((p) => p.market)])];
  }

  /** Actuele koersen voor open posities zonder bekende koers (bijv. direct na een herstart). */
  private async loadMissingPrices(): Promise<void> {
    for (const m of new Set(this.positions.map((p) => p.market))) {
      const known = this.prices[m];
      if (isNum(known) && known > 0) continue;
      try {
        const p = await this.feed.getPrice(m);
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
    this.haltedDayKey = null;
    this.updateEquity();
    this.log("info", `Nieuwe handelsdag (${key}): dagtellers gereset, startequity ${fmtEur(this.account.equity)}`);
  }

  private async processMarket(market: string, now: number): Promise<void> {
    const cfg = this.config;
    const interval = cfg.interval;
    let candles: Candle[];
    try {
      // Genoeg candles voor de warmup van de strategieën, ook als historyCandles laag staat:
      // anders valt bijv. ema-trend live stil terwijl de backtest hem wel gebruikt.
      candles = sanitizeCandles(await this.feed.getCandles(market, interval, candlesToFetch(cfg)));
    } catch (err) {
      this.logThrottled(
        `feed:${market}`,
        "warn",
        `Koersdata voor ${market} niet beschikbaar: ${errorMessage(err)} — markt deze ronde overgeslagen`,
      );
      return;
    }
    if (candles.length === 0) {
      this.logThrottled(`feed:${market}`, "warn", `Geen candles ontvangen voor ${market} — markt overgeslagen`);
      return;
    }
    this.throttle.delete(`feed:${market}`);

    const last = candles[candles.length - 1];
    const price = last.close;
    this.prices[market] = price;
    this.emitEvent("price", { market, price, time: now });
    this.emitEvent("candle", { market, interval, candle: { ...last } });

    const closed = closedCandles(candles, interval, now);
    const latest = closed.length > 0 ? closed[closed.length - 1] : undefined;
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

    if (!decision) return;
    this.decisions[market] = decision;
    this.emitEvent("decision", decision);

    const pos = this.positions.find((p) => p.market === market);
    if (pos) {
      if (!this.pendingExit.has(pos.id) && this.safeShouldExit(pos, decision)) {
        await this.exitPosition(pos, "signal", price, false);
      }
    } else if (decision.action === "buy" && this.config.markets.includes(market)) {
      const before = this.evaluatedBeforeRestart.get(market);
      if (before !== undefined && decision.time <= before) {
        this.logRejection(
          market,
          decision.time,
          `Geen koop ${market}: deze candle was vóór de herstart al beoordeeld — de bot wacht op de volgende candle`,
        );
        return;
      }
      await this.tryEntry(market, decision, price, now);
    }
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

  private async tryEntry(market: string, decision: EnsembleDecision, price: number, now: number): Promise<void> {
    // Gestopt / noodstop tijdens deze ronde: geen nieuwe posities meer.
    if (!this.buyAllowed()) return;
    if (this.positions.some((p) => p.market === market)) return;
    // Een entry op of na het sluiten van deze candle kan alleen van dit signaal
    // komen: niet nog eens kopen (na een herstart of een gewijzigde marktlijst).
    const candleClose = decision.time + INTERVAL_MS[this.config.interval];
    if (this.trades.some((t) => t.market === market && t.entryTime >= candleClose)) {
      this.logRejection(market, decision.time, `Geen koop ${market}: het signaal van deze candle is al verhandeld`);
      return;
    }
    const halt = this.refreshHalt();
    if (halt.halted) return; // gelogd bij de overgang naar "gepauzeerd"
    if (this.unknownBuys.size > 0) {
      const markets = [...new Set([...this.unknownBuys.values()].map((u) => u.market))].join(", ");
      this.logRejection(
        market,
        decision.time,
        `Geen koop ${market}: kooporder met onbekende uitkomst in ${markets} — alle nieuwe entries gepauzeerd tot die opgehelderd is`,
      );
      return;
    }
    if ([...this.unknownSells.values()].some((u) => u.market === market)) {
      this.logRejection(
        market,
        decision.time,
        `Geen koop ${market}: verkooporder met onbekende uitkomst in deze markt — nieuwe entries geblokkeerd tot die opgehelderd is`,
      );
      return;
    }

    const info = this.marketInfo.get(market);
    let plan: EntryPlan;
    try {
      plan = this.risk.planEntry(decision, this.accountSnapshot(), info, now);
    } catch (err) {
      this.log("error", `Risicoplan voor ${market} mislukt: ${errorMessage(err)}`);
      return;
    }
    if (!plan.approved) {
      this.logRejection(
        market,
        decision.time,
        `Geen koop ${market} (${decisionSummary(decision)}): ${plan.reasons.join("; ") || "afgewezen door risicobeheer"}`,
      );
      return;
    }
    const q = plan.quoteAmount;
    if (!isNum(q) || q <= 0) {
      this.log("warn", `Ongeldig orderbedrag voor ${market} (${String(q)}) — koop overgeslagen`);
      return;
    }
    if (q > this.account.cashQuote + 1e-6) {
      this.log(
        "warn",
        `Orderbedrag ${fmtEur(q)} voor ${market} is hoger dan de beschikbare cash ${fmtEur(this.account.cashQuote)} — koop overgeslagen`,
      );
      return;
    }
    await this.openPosition(market, decision, plan, price, info);
  }

  private async openPosition(
    market: string,
    decision: EnsembleDecision,
    plan: EntryPlan,
    price: number,
    info: MarketInfo | undefined,
  ): Promise<void> {
    const stopDist = plan.expectedEntryPrice - plan.stopPrice;
    const tpDist = plan.takeProfitPrice - plan.expectedEntryPrice;
    const preview =
      `${market} ${fmtEur(plan.quoteAmount)} @ ~${fmtPrice(price)}` +
      ` · stop ${fmtPrice(isNum(stopDist) ? price - stopDist : plan.stopPrice)}` +
      ` · doel ${fmtPrice(isNum(tpDist) ? price + tpDist : plan.takeProfitPrice)}` +
      ` (${decisionSummary(decision)})`;

    if (this.mode === "live" && !this.armed) {
      this.log("info", `Live mode niet gearmd: zou kopen ${preview}`);
      return;
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
        return;
      }
      if (!isNum(available) || available < plan.quoteAmount) {
        this.log(
          "warn",
          `Onvoldoende ${quote}-saldo op Bitvavo (${fmtEur(available)} beschikbaar, ${fmtEur(plan.quoteAmount)} nodig) — koop ${market} overgeslagen`,
        );
        return;
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
      return;
    }
    const { res, threw } = await this.placeOrder(req, price);
    if (epoch !== this.epoch) {
      this.log("warn", `Kooporder ${market} kwam binnen na een account-reset en wordt genegeerd`);
      return;
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
      return;
    }

    // Beslis op status + gevulde hoeveelheid, niet op de aanwezigheid van `error`.
    const filledAmount = isNum(res.filledAmount) ? res.filledAmount : 0;
    if (res.status === "rejected" || filledAmount <= 0) {
      this.log(
        "warn",
        `Kooporder ${market} afgewezen: ${res.error ?? `status ${res.status}, niets gevuld`} — geen positie geopend`,
      );
      return;
    }
    const filledQuote =
      isNum(res.filledQuote) && res.filledQuote > 0 ? res.filledQuote : filledAmount * (res.avgPrice || price);
    const entryPrice = isNum(res.avgPrice) && res.avgPrice > 0 ? res.avgPrice : filledQuote / filledAmount;
    if (!isNum(entryPrice) || entryPrice <= 0) {
      this.log("error", `Kooporder ${market} gevuld zonder bruikbare prijs — controleer je account`);
      return;
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
      this.unknownBuys.set(unknown.clientOrderId, { ...unknown, positionId: pos.id, bookedAmount: filledAmount });
      this.log(
        "error",
        `UITKOMST ONBEKEND bij koop ${market} (clientOrderId ${unknown.clientOrderId}): alleen het bekende deel is geboekt; de order kan nog verder vullen. ` +
          "Alle nieuwe entries zijn gepauzeerd tot dat opgehelderd is — controleer je Bitvavo-account.",
      );
    }
    await this.persist(true);
  }

  /**
   * Live: probeert kooporders met onbekende uitkomst op te helderen via
   * `broker.lookupOrder` (optioneel). Een antwoord ZONDER "UITKOMST ONBEKEND"
   * (en niet meer open) is definitief: het gevulde deel dat nog niet geboekt is
   * wordt alsnog een positie (met stop), daarna vervalt de blokkade. `null`
   * (Bitvavo kent de order niet) pas na {@link NOT_FOUND_CONFIRMATIONS} ticks op
   * rij als "niet geplaatst" beschouwen. Gooit het opzoeken: blijven wachten.
   * `countNulls` = false (noodstop): "niet gevonden" telt niet als extra tick.
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
        if (this.unknownBuys.get(u.clientOrderId) === u && u.nullCount) {
          u.nullCount = 0;
          changed = true;
        }
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
        u.nullCount = (u.nullCount ?? 0) + 1;
        changed = true;
        if (u.nullCount < NOT_FOUND_CONFIRMATIONS) {
          this.log(
            "info",
            `Kooporder ${u.market} met onbekende uitkomst (clientOrderId ${u.clientOrderId}) nog niet gevonden bij Bitvavo ` +
              `(${u.nullCount}/${NOT_FOUND_CONFIRMATIONS}) — ` +
              (this.running
                ? "de bot kijkt de volgende tick opnieuw; nieuwe entries blijven gepauzeerd"
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
        if (u.nullCount) {
          u.nullCount = 0;
          changed = true;
        }
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
   * Boekt een teruggevonden kooporder (voor zover nog niet geboekt) als positie
   * met stop, en onthoudt in `u` wat er geboekt is. `final` = de order is klaar
   * (anders kan hij nog verder vullen en blijft `u` bestaan). Geeft false als de
   * vulling onbruikbaar is (dan blijft de blokkade staan).
   */
  private bookResolvedBuy(u: UnknownBuy, res: OrderResult, final: boolean): boolean {
    const filledAmount = isNum(res.filledAmount) && res.filledAmount > 0 ? res.filledAmount : 0;
    const booked = isNum(u.bookedAmount) && u.bookedAmount > 0 ? u.bookedAmount : 0;
    const extra = this.unbookedAmount(u.bookedAmount, res);
    if (!(extra > 0)) {
      if (final) {
        this.log(
          "info",
          `Kooporder ${u.market} met onbekende uitkomst teruggevonden (status ${res.status}): ` +
            (booked > 0 ? "niet verder gevuld dan al geboekt" : "niets gevuld, er is niets gekocht"),
        );
      }
      return true;
    }
    const filledQuote =
      isNum(res.filledQuote) && res.filledQuote > 0
        ? res.filledQuote
        : isNum(res.avgPrice) && res.avgPrice > 0
          ? filledAmount * res.avgPrice
          : 0;
    const avg = isNum(res.avgPrice) && res.avgPrice > 0 ? res.avgPrice : filledQuote / filledAmount;
    if (!isNum(avg) || avg <= 0 || !(filledQuote > 0)) {
      this.logThrottled(
        `unknown:${u.clientOrderId}`,
        "error",
        `Kooporder ${u.market} (clientOrderId ${u.clientOrderId}) is gevuld maar zonder bruikbare prijs — controleer je account; nieuwe entries blijven gepauzeerd`,
      );
      return false;
    }
    const share = extra / filledAmount;
    const extraQuote = filledQuote * share;
    const fee = (isNum(res.feeQuote) && res.feeQuote > 0 ? res.feeQuote : 0) * share;
    const cost = extraQuote + fee;
    const existing = u.positionId ? this.positions.find((p) => p.id === u.positionId) : undefined;
    let pos: Position;
    if (existing) {
      const amount = existing.amount + extra;
      existing.entryPrice = (existing.entryPrice * existing.amount + avg * extra) / amount;
      existing.amount = amount;
      existing.costQuote += cost;
      existing.entryFeeQuote += fee;
      pos = existing;
    } else {
      let stop = u.stopDist > 0 ? avg - u.stopDist : avg * 0.97;
      if (!isNum(stop) || stop <= 0 || stop >= avg) stop = avg * 0.97;
      let tp = u.tpDist > 0 ? avg + u.tpDist : avg + 2 * (avg - stop);
      if (!isNum(tp) || tp <= avg) tp = avg + 2 * (avg - stop);
      pos = {
        id: newId("pos"),
        market: u.market,
        side: "long",
        entryTime: u.at > 0 ? u.at : this.nowFn(),
        entryPrice: avg,
        amount: extra,
        costQuote: cost,
        entryFeeQuote: fee,
        stopPrice: stop,
        initialStopPrice: stop,
        takeProfitPrice: tp,
        highestPrice: avg,
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
    u.bookedAmount = filledAmount;
    this.updateEquity();
    this.recordEquity(this.nowFn(), true);
    if (!existing) this.emitEvent("position-opened", { ...pos });
    this.log(
      "trade",
      `KOOP ${u.market} alsnog ${final ? "" : "deels "}uitgevoerd (order met onbekende uitkomst teruggevonden${final ? "" : ", nog niet afgerond"}): ` +
        `${fmtEur(cost)} @ ${fmtPrice(avg)} · stop ${fmtPrice(pos.stopPrice)} · doel ${fmtPrice(pos.takeProfitPrice)}` +
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
   * wachten. {@link NOT_FOUND_CONFIRMATIONS} ticks op rij niet gevonden → niet
   * uitgevoerd, opnieuw verkopen mag; gooit → blijven wachten.
   * `countNulls` = false (noodstop / handmatig sluiten): "niet gevonden" telt niet
   * als extra tick. Geeft de hierbij geboekte trades terug.
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
        if (this.unknownSells.get(u.clientOrderId) === u && u.nullCount) {
          u.nullCount = 0;
          changed = true;
        }
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
        u.nullCount = (u.nullCount ?? 0) + 1;
        changed = true;
        if (u.nullCount < NOT_FOUND_CONFIRMATIONS) {
          this.log(
            "info",
            `Verkooporder ${u.market} met onbekende uitkomst (clientOrderId ${u.clientOrderId}) nog niet gevonden bij Bitvavo ` +
              `(${u.nullCount}/${NOT_FOUND_CONFIRMATIONS}) — ` +
              (this.running
                ? "de bot kijkt de volgende tick opnieuw en verkoopt tot dan niet opnieuw"
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
        if (u.nullCount) {
          u.nullCount = 0;
          changed = true;
        }
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
   * onbekende uitkomst als exit. `final` = de order is klaar ("filled" sluit dan
   * de hele positie, net als bij een gewone verkoop); anders blijft de rest van de
   * positie altijd staan (de order kan nog verder vullen).
   */
  private async bookUnknownSellFill(u: UnknownSell, res: OrderResult, pos: Position, final: boolean): Promise<Trade | null> {
    const extra = this.unbookedAmount(u.bookedAmount, res);
    if (!(extra > 0)) return null;
    const filledAmount = res.filledAmount;
    const rawGross =
      isNum(res.filledQuote) && res.filledQuote > 0
        ? res.filledQuote
        : isNum(res.avgPrice) && res.avgPrice > 0
          ? filledAmount * res.avgPrice
          : 0;
    const exitPrice =
      isNum(res.avgPrice) && res.avgPrice > 0 ? res.avgPrice : rawGross > 0 ? rawGross / filledAmount : this.priceFor(pos);
    const filled = Math.min(extra, pos.amount);
    const share = filled / filledAmount;
    const gross = rawGross > 0 ? rawGross * share : filled * exitPrice;
    const fee = isNum(res.feeQuote) && res.feeQuote > 0 ? res.feeQuote * share : 0;
    u.bookedAmount = filledAmount;
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
      const waiting = await this.unknownSellWait(pos, unknownSell, label);
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
          this.logThrottled(
            `sellfail:${pos.id}`,
            "error",
            `${pos.market} (${label}): ${fmtAmount(h.inOrder)} ${base} zit in een openstaande order op Bitvavo; ` +
              "annuleer die order of sluit de positie handmatig — positie blijft open",
            SELL_ERROR_THROTTLE_MS,
            true,
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
      this.noteUnsellable(pos, "engine", dust, explicit);
      return null;
    }
    if (this.unsellable.get(pos.id)?.kind === "engine") {
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
        this.noteUnsellable(pos, "broker", text, explicit);
        return null;
      }
      this.exitFailure = `verkoop afgewezen: ${why}`;
      this.logThrottled(
        `sellfail:${pos.id}`,
        "error",
        `Verkoop ${pos.market} (${label}) mislukt: ${why} — positie blijft open, ${this.retryHint()}`,
        SELL_ERROR_THROTTLE_MS,
        true,
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
   * erboven komt (winst) blijft buiten het handelsbudget. Dat is een overboeking
   * uit het budget, geen winst of verlies:
   *  - start- en dag-startequity gaan evenveel omlaag, zodat "equity − start"
   *    (in EUR) de echte winst blijft;
   *  - het afgeroomde bedrag telt voor de rendementen weer mee
   *    (`skimmedQuote` / `skimmedToday`, zie {@link updateEquity}):
   *    totaal = (equity + afgeroomd − oorspronkelijke start) / oorspronkelijke start,
   *    en de dagelijkse verlieslimiet kijkt naar hetzelfde dag-% (zie
   *    {@link riskDayStartEquity}) — een winnende trade raakt de limiet dus nooit,
   *    en een verliesdag wordt er niet groter door.
   */
  private enforceCapitalLimit(): void {
    if (this.mode !== "live") return;
    const openCost = this.positions.reduce((s, p) => s + (isNum(p.costQuote) ? p.costQuote : 0), 0);
    const cap = Math.max(0, this.startingCapital - openCost);
    if (!(this.account.cashQuote > cap + 1e-9)) return;
    const excess = this.account.cashQuote - cap;
    this.account.cashQuote = cap;
    this.account.dayStartEquity = Math.max(this.account.dayStartEquity - excess, 1e-9);
    this.account.startingEquity = Math.max(this.account.startingEquity - excess, 1e-9);
    this.skimmedQuote += excess;
    this.skimmedToday += excess;
    this.log(
      "info",
      `Kapitaallimiet ${fmtEur(this.startingCapital)}: ${fmtEur(excess)} winst blijft buiten het handelsbudget van de bot`,
    );
  }

  /** Beursminima (EUR en base) voor één order in deze markt — NIET de risico-instelling. */
  private exchangeMinimums(market: string): { quote: number; base: number } {
    const info = this.marketInfo.get(market);
    const quote = info && isNum(info.minOrderQuote) && info.minOrderQuote >= 0 ? info.minOrderQuote : DEFAULT_EXCHANGE_MIN_QUOTE;
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

  /** Is deze positie nu onverkoopbaar? Reden of null (op basis van de laatst bekende koers). */
  private unsellableNow(pos: Position, price: number): string | null {
    return this.dustReason(pos.market, pos.amount, price) ?? (this.unsellable.get(pos.id)?.reason || null);
  }

  /**
   * Markeert een positie als onverkoopbaar en logt dat één keer per episode
   * (niet elke tick); bij een expliciete actie van de gebruiker altijd.
   */
  private noteUnsellable(pos: Position, kind: "engine" | "broker", reason: string, explicit: boolean): void {
    const first = !this.unsellable.has(pos.id);
    this.unsellable.set(pos.id, { kind, reason });
    if (!first && !explicit) return;
    const min = fmtEur(this.exchangeMinimums(pos.market).quote);
    this.log(
      "warn",
      `${pos.market} positie is onverkoopbaar: ${reason}. ` +
        (this.running
          ? `De bot verkoopt zodra de waarde weer ≥ ${min} is; je kunt hem ook afschrijven.`
          : `De bot staat stil — start de bot opnieuw (dan verkoopt hij zodra de waarde weer ≥ ${min} is) of schrijf de positie af.`),
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
  private async unknownSellWait(pos: Position, u: UnknownSell, label: string): Promise<string | null> {
    const stillHint = this.running
      ? "de bot verkoopt niet opnieuw tot die is opgehelderd"
      : "de bot staat stil — start de bot opnieuw of sluit de positie zelf op Bitvavo";
    if (this.lookupFn()) {
      const why = `er loopt nog een verkooporder met onbekende uitkomst (clientOrderId ${u.clientOrderId})`;
      this.logThrottled(`sellwait:${pos.id}`, "warn", `${pos.market} (${label}): ${why} — ${stillHint}`, SELL_ERROR_THROTTLE_MS, true);
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
      this.logThrottled(`sellwait:${pos.id}`, "warn", `${pos.market} (${label}): ${why} — ${stillHint}`, SELL_ERROR_THROTTLE_MS, true);
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

  /** Actuele koers voor handmatige exits; valt terug op de laatst bekende koers. */
  private async freshPrice(market: string): Promise<number> {
    try {
      const p = await this.feed.getPrice(market);
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
    this.account.equity = this.account.cashQuote + value;
    this.account.unrealizedPnl = unrealized;
    // Rendement, correct ook na afromen (live): afgeroomde winst is een overboeking
    // uit het handelsbudget, geen winst of verlies. Start- en dag-startequity zijn
    // met het afgeroomde bedrag verlaagd, dus het oorspronkelijke startbedrag is
    // start + afgeroomd en rendement = (equity + afgeroomd − origineel) / origineel.
    const base = this.account.startingEquity + this.skimmedQuote;
    this.account.totalReturnPct =
      isNum(base) && base > 0 ? ((this.account.equity - this.account.startingEquity) / base) * 100 : 0;
    const dayBase = this.account.dayStartEquity + this.skimmedToday;
    this.account.dayReturnPct =
      isNum(dayBase) && dayBase > 0 ? ((this.account.equity - this.account.dayStartEquity) / dayBase) * 100 : 0;
  }

  /**
   * Dag-startequity voor de risk manager: zo gekozen dat zijn dag-% (equity −
   * dagstart) / dagstart gelijk is aan `dayReturnPct`, dus mét de vandaag
   * afgeroomde winst. Zonder afromen gewoon `account.dayStartEquity`.
   */
  private riskDayStartEquity(): number {
    const { equity, dayStartEquity } = this.account;
    const s = this.skimmedToday;
    if (!(s > 0) || !isNum(equity) || equity <= 0 || !isNum(dayStartEquity)) return dayStartEquity;
    return (equity * (dayStartEquity + s)) / (equity + s);
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
          ? this.running
            ? `De bot verkoopt zodra de waarde weer ≥ ${min} is; je kunt de positie ook afschrijven.`
            : "De bot staat stil: start hem opnieuw (dan verkoopt hij zodra het weer kan) of schrijf de positie af."
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
    };
  }

  private recordEquity(time: number, force: boolean): void {
    const equity = this.account.equity;
    if (!isNum(equity)) return;
    const last = this.equityHistory[this.equityHistory.length - 1];
    // Live: cumulatief afgeroomde winst per punt, zodat de grafiek equity + afgeroomd
    // kan tonen zonder een nep-daling op het moment van afromen.
    const skimmed = this.mode === "live" ? { skimmed: this.skimmedQuote } : {};
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
    if (h.halted && !this.halted.halted) {
      this.log(
        "warn",
        `Nieuwe trades gepauzeerd: ${h.reason ?? "risicolimiet bereikt"} (open posities worden nog wel bewaakt)`,
      );
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
      const list = await this.feed.getMarkets();
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
    let balances: Balance[];
    try {
      balances = await this.broker.getBalances();
      if (!Array.isArray(balances)) return;
    } catch (err) {
      this.log("warn", `Kon saldi op Bitvavo niet controleren: ${errorMessage(err)}`);
      return;
    }
    const heldOf = (base: string): number => {
      const b = balances.find((x) => x.symbol === base);
      if (!b) return 0;
      return (isNum(b.available) ? b.available : 0) + (isNum(b.inOrder) ? b.inOrder : 0);
    };
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
    // Omgekeerd: coins in een bot-markt die de bot NIET beheert (bijv. na een
    // onbruikbaar statusbestand of een order met onbekende uitkomst): geen stop-loss.
    const managed = new Set(this.positions.map((p) => p.market));
    for (const market of this.config.markets) {
      if (managed.has(market)) continue;
      const info = this.marketInfo.get(market);
      const { base } = splitMarket(market, info);
      const held = heldOf(base);
      if (!(held > 0)) continue;
      let price: number;
      try {
        price = await this.feed.getPrice(market);
      } catch {
        continue;
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
            "De bot begint met een LEGE administratie: open posities van vóór de herstart worden NIET bewaakt. Controleer je Bitvavo-saldi." +
            (this.mode === "live" ? " Armen is geblokkeerd tot je dit bevestigt." : ""),
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
    this.skimmedQuote = isNum(state.skimmedQuote) && state.skimmedQuote > 0 ? state.skimmedQuote : 0;
    // Hoort bij account.dayKey (de dagwissel zet hem later op 0); nooit meer dan het totaal.
    const skimmedToday = (state as PersistedStateExt).skimmedToday;
    this.skimmedToday = isNum(skimmedToday) && skimmedToday > 0 ? Math.min(skimmedToday, this.skimmedQuote) : 0;
    if (this.mode === "live") this.rebaseCapitalLimit(account, positions, state);
    this.account = account;
    this.positions = positions;
    this.haltedDayKey =
      typeof state.haltedDayKey === "string" && state.haltedDayKey === account.dayKey ? state.haltedDayKey : null;
    if (this.mode === "live" && Array.isArray(state.unknownOrders)) {
      for (const u of state.unknownOrders) {
        if (!u || typeof u.market !== "string" || typeof u.clientOrderId !== "string" || !u.clientOrderId) continue;
        this.unknownBuys.set(u.clientOrderId, {
          market: u.market,
          clientOrderId: u.clientOrderId,
          quoteAmount: isNum(u.quoteAmount) ? u.quoteAmount : 0,
          at: isNum(u.at) ? u.at : 0,
          stopDist: isNum(u.stopDist) ? u.stopDist : 0,
          tpDist: isNum(u.tpDist) ? u.tpDist : 0,
          entryReason: typeof u.entryReason === "string" ? u.entryReason : "",
          ...(typeof u.positionId === "string" ? { positionId: u.positionId } : {}),
          ...(isNum(u.bookedAmount) ? { bookedAmount: u.bookedAmount } : {}),
          ...(isNum((u as UnknownBuy).nullCount) ? { nullCount: (u as UnknownBuy).nullCount } : {}),
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
          at: isNum(u.at) ? u.at : 0,
          ...(isNum(u.bookedAmount) ? { bookedAmount: u.bookedAmount } : {}),
          ...(isNum(u.nullCount) ? { nullCount: u.nullCount } : {}),
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
        `Nog niet bevestigd: de opgeslagen staat was eerder onbruikbaar (${this.stateRecovery.reason}). Controleer je Bitvavo-saldi en bevestig dat.`,
      );
    }
  }

  /**
   * Live: de kapitaallimiet kan tussen twee runs veranderd zijn. Cash + inleg
   * van open posities moet binnen de (nieuwe) limiet blijven.
   *  - Verhoging: het verschil komt als extra budget bij de cash.
   *  - Verlaging: het budget wordt min(nieuwe limiet, wat de bot nu heeft) —
   *    heeft de bot al verlies gemaakt, dan gaat er minder (of niets) af, niet
   *    het volledige verschil.
   * Het verschil is een storting/opname, geen winst of verlies: start- en
   * dag-startequity schuiven naar rato mee, zodat het totaal- en dagrendement
   * (en dus de dagelijkse verlieslimiet) er niet door veranderen.
   */
  private rebaseCapitalLimit(account: AccountState, positions: Position[], state: PersistedState): void {
    const oldLimit =
      isNum(state.capitalLimitQuote) && state.capitalLimitQuote > 0 ? state.capitalLimitQuote : account.startingEquity;
    const openCost = positions.reduce((s, p) => s + p.costQuote, 0);
    const room = Math.max(0, this.startingCapital - openCost);
    const raised = isNum(oldLimit) ? this.startingCapital - oldLimit : 0;
    const target = Math.max(0, Math.min(room, account.cashQuote + Math.max(0, raised)));
    const delta = target - account.cashQuote;
    if (Math.abs(delta) <= 1e-9) return;
    const equity = isNum(account.equity) && account.equity > 0 ? account.equity : account.cashQuote + openCost;
    const after = equity + delta;
    // Rendementen (zie updateEquity: (equity − start) / (start + afgeroomd)) blijven
    // gelijk: het oorspronkelijke startbedrag schaalt mee met wat er in het budget
    // bijkomt of afgaat. Zo telt een lagere limiet na verlies niet als extra verlies.
    const rebase = (start: number, skimmed: number): number => {
      const total = equity + skimmed;
      if (!(equity > 0 && after > 0 && total > 0)) return Math.max(start + delta, 1e-9);
      return Math.max(((start + skimmed) * (total + delta)) / total - skimmed, 1e-9);
    };
    account.startingEquity = rebase(account.startingEquity, this.skimmedQuote);
    account.dayStartEquity = rebase(account.dayStartEquity, this.skimmedToday);
    account.cashQuote = target;
    account.equity = after;
    this.log(
      "info",
      `Kapitaallimiet ${fmtEur(isNum(oldLimit) ? oldLimit : this.startingCapital)} → ${fmtEur(this.startingCapital)}: ` +
        `handelsbudget ${delta > 0 ? "+" : ""}${fmtEur(delta)} (cash nu ${fmtEur(target)}, inleg open posities ${fmtEur(openCost)})`,
    );
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
      ...(this.skimmedQuote > 0 ? { skimmedQuote: this.skimmedQuote } : {}),
      ...(this.skimmedToday > 0 ? { skimmedToday: this.skimmedToday } : {}),
      ...(this.stateRecovery ? { stateRecovery: { ...this.stateRecovery } } : {}),
      ...(this.unknownSells.size > 0 ? { unknownSells: [...this.unknownSells.values()].map((u) => ({ ...u })) } : {}),
    };
    return state;
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

  /** Afwijzingsredenen hooguit één keer per gesloten candle per markt. */
  private logRejection(market: string, candleTime: number, message: string): void {
    if (this.rejectLogged.get(market) === candleTime) return;
    this.rejectLogged.set(market, candleTime);
    this.log("info", message);
  }
}
