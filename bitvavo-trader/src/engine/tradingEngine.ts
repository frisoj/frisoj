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
 * live mode is de cash begrensd op de kapitaallimiet (`startingCapital`) en
 * worden er pas echte orders geplaatst na `arm()`.
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
import { RiskManager } from "../risk/riskManager";
import { runEnsemble } from "../strategies/ensemble";
import {
  decisionSummary,
  entryReasonText,
  errorMessage,
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
  /** Markten met een live order waarvan de uitkomst onbekend is: geen nieuwe entries */
  private uncertain = new Set<string>();
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
  }

  // ───────────────────────────── Publieke API ─────────────────────────────

  get liveArmed(): boolean {
    return this.mode === "live" && this.armed;
  }

  get isRunning(): boolean {
    return this.running;
  }

  async start(): Promise<void> {
    if (this.running) return;
    this.restoreFromStore();
    this.clearUncertain("herstart");
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
    await this.loadMarkets(true);
    if (this.mode === "live") await this.reconcileLiveBalances();
    await this.tick();
    this.scheduleNext();
  }

  async stop(): Promise<void> {
    const wasRunning = this.running;
    this.running = false;
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
    const p = this.exclusive(async () => {
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
    if (
      this.mode === "paper" &&
      (prev.risk.takerFee !== next.risk.takerFee || prev.risk.slippagePct !== next.risk.slippagePct)
    ) {
      // Paper broker (duck-typed) rekent met dezelfde kosten als de risk manager.
      const b = this.broker as Broker & { setCosts?: (takerFee: number, slippagePct: number) => void };
      if (typeof b.setCosts === "function") b.setCosts(next.risk.takerFee, next.risk.slippagePct);
    }

    if (intervalChanged || marketsChanged) {
      this.lastEvaluated.clear();
      this.rejectLogged.clear();
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
      const pos = this.positions.find((p) => p.id === id);
      if (!pos) {
        this.log("warn", `Positie ${id} niet gevonden (al gesloten?)`);
        return null;
      }
      const price = await this.freshPrice(pos.market);
      const trade = await this.exitPosition(pos, reason, price, true);
      this.updateEquity();
      this.emitSnapshot();
      return trade;
    });
  }

  async killSwitch(): Promise<void> {
    // Eerst de lus stilzetten zodat er geen nieuwe entries meer komen.
    this.running = false;
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
    this.log(
      "error",
      `NOODSTOP geactiveerd: ${this.positions.length} open positie(s) worden gesloten en de bot stopt`,
    );
    const failed: string[] = [];
    let closed = 0;
    await this.exclusive(async () => {
      for (const pos of [...this.positions]) {
        const price = await this.freshPrice(pos.market);
        const trade = await this.exitPosition(pos, "kill-switch", price, true);
        if (trade) closed++;
        if (this.positions.includes(pos)) failed.push(pos.market);
      }
    });
    if (this.mode === "live" && this.armed) {
      this.armed = false;
      this.log("warn", "Live mode ontwapend na de noodstop");
    }
    await this.stop();
    if (failed.length) {
      this.log(
        "error",
        `NOODSTOP: ${closed} positie(s) gesloten, ${failed.length} NIET gesloten (${failed.join(", ")}) — controleer je account en sluit handmatig!`,
      );
    } else {
      this.log("error", `NOODSTOP voltooid: ${closed} positie(s) gesloten, bot gestopt`);
    }
    this.emitSnapshot();
  }

  arm(): void {
    if (this.mode !== "live" || this.armed) return;
    this.armed = true;
    this.clearUncertain("opnieuw armen");
    this.log(
      "warn",
      `LIVE GEARMD: de bot plaatst nu ECHTE orders op Bitvavo (kapitaallimiet ${fmtEur(this.startingCapital)})`,
    );
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
    this.pendingExit.clear();
    this.posCursor.clear();
    this.rejectLogged.clear();
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

  private checkDayRollover(now: number): void {
    const key = dayKey(now);
    if (key === this.account.dayKey) return;
    this.updateEquity();
    this.account.dayKey = key;
    this.account.dayStartEquity = this.account.equity;
    this.account.tradesToday = 0;
    this.account.realizedPnlToday = 0;
    this.log("info", `Nieuwe handelsdag (${key}): dagtellers gereset, startequity ${fmtEur(this.account.equity)}`);
  }

  private async processMarket(market: string, now: number): Promise<void> {
    const cfg = this.config;
    const interval = cfg.interval;
    let candles: Candle[];
    try {
      candles = sanitizeCandles(await this.feed.getCandles(market, interval, cfg.historyCandles + 1));
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
    const pending = this.pendingExit.get(pos.id);
    if (pending) {
      await this.exitPosition(pos, pending, price, false);
      return;
    }

    // (1) Nieuwe gesloten candles sinds de vorige evaluatie, alleen vanaf de entry.
    const cursor = this.cursorFor(pos);
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
    if (this.positions.some((p) => p.market === market)) return;
    const halt = this.refreshHalt();
    if (halt.halted) return; // gelogd bij de overgang naar "gepauzeerd"
    if (this.uncertain.has(market)) {
      this.logRejection(
        market,
        decision.time,
        `Geen koop ${market}: eerdere order met onbekende uitkomst — nieuwe entries geblokkeerd tot een herstart of opnieuw armen`,
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
    const { res, threw } = await this.placeOrder(req, price);
    if (epoch !== this.epoch) {
      this.log("warn", `Kooporder ${market} kwam binnen na een account-reset en wordt genegeerd`);
      return;
    }
    this.emitEvent("order", res);

    // Onbekende uitkomst (live): NIET opnieuw versturen en geen positie openen.
    if (this.isUnknownOutcome(res, threw)) {
      this.uncertain.add(market);
      this.log(
        "error",
        `UITKOMST ONBEKEND bij koop ${market}: ${res.error ?? "geen antwoord van de broker"} — geen positie geopend en niet opnieuw verstuurd. ` +
          `Controleer je Bitvavo-account! Nieuwe entries in ${market} zijn geblokkeerd tot een herstart of opnieuw armen.`,
      );
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
    await this.persist(true);
  }

  // ───────────────────────────── Exit ─────────────────────────────

  /**
   * Verkoopt een positie. `explicit` = door de gebruiker gevraagd (handmatig
   * sluiten / noodstop): dan wordt ook in niet-gearmde live mode verkocht.
   * Bij een afwijzing blijft de positie staan en wordt de verkoop bij de
   * volgende tick opnieuw geprobeerd.
   */
  private async exitPosition(
    pos: Position,
    reason: ExitReason,
    price: number,
    explicit: boolean,
  ): Promise<Trade | null> {
    if (!this.positions.includes(pos)) return null;
    const label = exitReasonLabel(reason);
    const info = this.marketInfo.get(pos.market);

    if (this.mode === "live" && !this.armed && !explicit) {
      this.pendingExit.set(pos.id, reason);
      this.logThrottled(
        `wouldsell:${pos.id}`,
        "warn",
        `Live mode niet gearmd: zou verkopen ${pos.market} @ ~${fmtPrice(price)} · ${label} — positie blijft open (arm de bot of sluit handmatig)`,
        Number.POSITIVE_INFINITY,
        true,
      );
      return null;
    }

    let amount = pos.amount;
    let sellsEverything = false;
    if (this.mode === "live") {
      const { base } = splitMarket(pos.market, info);
      let holding: Balance | undefined;
      let known = false;
      try {
        holding = (await this.broker.getBalances()).find((b) => b.symbol === base);
        known = true;
      } catch {
        // Saldo onbekend: gewoon de volledige positie proberen te verkopen.
      }
      if (known) {
        const avail = holding && isNum(holding.available) ? holding.available : 0;
        const held = holding ? avail + (isNum(holding.inOrder) ? holding.inOrder : 0) : 0;
        if (this.uncertain.has(pos.market) && held < pos.amount * 0.01) {
          // Na een order met onbekende uitkomst is de positie van Bitvavo verdwenen:
          // vermoedelijk is die verkoop toch uitgevoerd. Administratie bijwerken (schatting).
          this.log(
            "warn",
            `${pos.market}: de positie staat niet meer op Bitvavo (vermoedelijk verkocht bij de order met onbekende uitkomst) — ` +
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
        if (avail > 0 && avail < amount) {
          this.log(
            "warn",
            `Beschikbaar ${base}-saldo (${fmtAmount(avail)}) is lager dan de positie (${fmtAmount(amount)}); de bot verkoopt wat er is`,
          );
          amount = avail;
          sellsEverything = true;
        }
      }
    }

    const req: MarketOrderRequest = { market: pos.market, side: "sell", amount, clientOrderId: randomUUID() };
    const { res, threw } = await this.placeOrder(req, price);
    this.emitEvent("order", res);

    if (this.isUnknownOutcome(res, threw)) {
      this.uncertain.add(pos.market);
      this.pendingExit.set(pos.id, reason);
      this.logThrottled(
        `sellfail:${pos.id}`,
        "error",
        `UITKOMST ONBEKEND bij verkoop ${pos.market} (${label}): ${res.error ?? "geen antwoord van de broker"} — controleer je Bitvavo-account! ` +
          `De bot controleert bij de volgende tick het saldo en probeert het zo nodig opnieuw`,
        SELL_ERROR_THROTTLE_MS,
        true,
      );
      return null;
    }

    const filledAmount = isNum(res.filledAmount) ? res.filledAmount : 0;
    if (res.status === "rejected" || filledAmount <= 0) {
      this.pendingExit.set(pos.id, reason);
      this.logThrottled(
        `sellfail:${pos.id}`,
        "error",
        `Verkoop ${pos.market} (${label}) mislukt: ${res.error ?? `status ${res.status}, niets gevuld`} — positie blijft open, nieuwe poging bij de volgende tick`,
        SELL_ERROR_THROTTLE_MS,
        true,
      );
      return null;
    }
    if (res.error) this.log("warn", `Melding bij verkoop ${pos.market}: ${res.error}`);

    const filled = Math.min(filledAmount, pos.amount);
    const rawGross = isNum(res.filledQuote) && res.filledQuote > 0 ? res.filledQuote : 0;
    const exitPrice =
      isNum(res.avgPrice) && res.avgPrice > 0 ? res.avgPrice : rawGross > 0 ? rawGross / filledAmount : price;
    // Meer verkocht dan de positie (zou niet mogen): alleen het deel van de positie telt.
    const gross = rawGross > 0 ? rawGross * (filled / filledAmount) : filled * exitPrice;
    const fee = isNum(res.feeQuote) && res.feeQuote > 0 ? res.feeQuote * (filled / filledAmount) : 0;
    // "filled" = de order is klaar: wat niet verkocht is (bijv. door een lager saldo) bestaat niet meer.
    const closeAll = sellsEverything || res.status === "filled";
    return this.bookExit(pos, reason, { filled, exitPrice, gross, fee, closeAll });
  }

  /** Boekt een (gedeeltelijke) exit in de administratie en stuurt events/logs. */
  private async bookExit(
    pos: Position,
    reason: ExitReason,
    fill: { filled: number; exitPrice: number; gross: number; fee: number; closeAll: boolean },
  ): Promise<Trade> {
    const now = this.nowFn();
    const info = this.marketInfo.get(pos.market);
    const label = exitReasonLabel(reason);
    const { filled, exitPrice, gross, fee } = fill;
    const remaining = Math.max(0, pos.amount - filled);
    const minQuote = info?.minOrderQuote ?? this.config.risk.minOrderQuote;
    const minBase = info?.minOrderBase ?? 0;
    const keepRemainder =
      !fill.closeAll && remaining > pos.amount * 1e-3 && remaining * exitPrice >= minQuote && remaining >= minBase;
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
    if (this.mode === "live" && this.account.cashQuote > this.startingCapital) {
      const excess = this.account.cashQuote - this.startingCapital;
      this.account.cashQuote = this.startingCapital;
      this.log(
        "info",
        `Kapitaallimiet ${fmtEur(this.startingCapital)}: ${fmtEur(excess)} winst blijft buiten het handelsbudget van de bot`,
      );
    }
    this.account.realizedPnl += pnl;
    this.account.realizedPnlToday += pnl;
    this.account.feesPaid += fee;
    if (pnl < 0) this.account.lastLossAt[pos.market] = now;
    this.trades.push(trade);
    if (this.trades.length > MAX_TRADES_KEPT) this.trades.splice(0, this.trades.length - MAX_TRADES_KEPT);

    if (keepRemainder) {
      pos.amount = remaining;
      pos.costQuote -= costPart;
      pos.entryFeeQuote -= entryFeePart;
      this.pendingExit.set(pos.id, reason);
      this.log(
        "warn",
        `Verkoop ${pos.market} deels gevuld (${fmtAmount(filled)} verkocht, ${fmtAmount(remaining)} over) — rest volgt bij de volgende tick`,
      );
    } else {
      this.positions = this.positions.filter((p) => p !== pos);
      this.pendingExit.delete(pos.id);
      this.posCursor.delete(pos.id);
      this.throttle.delete(`wouldsell:${pos.id}`);
      this.throttle.delete(`sellfail:${pos.id}`);
      this.throttle.delete(`risk:${pos.id}`);
      if (!fill.closeAll && remaining > pos.amount * 1e-6) {
        const { base } = splitMarket(pos.market, info);
        this.log(
          "warn",
          `Restant van ${fmtAmount(remaining)} ${base} is te klein om te verkopen en blijft op het account staan`,
        );
      }
    }
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

  /**
   * Live: status "new" met "UITKOMST ONBEKEND" (of een broker die gooit) =
   * we weten niet of de order is uitgevoerd.
   */
  private isUnknownOutcome(res: OrderResult, threw: boolean): boolean {
    if (this.mode !== "live") return false;
    if (threw) return true;
    return (
      res.status === "new" &&
      !(isNum(res.filledAmount) && res.filledAmount > 0) &&
      typeof res.error === "string" &&
      res.error.trim().toUpperCase().startsWith("UITKOMST ONBEKEND")
    );
  }

  private async placeOrder(req: MarketOrderRequest, price: number): Promise<{ res: OrderResult; threw: boolean }> {
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
  }

  private positionView(pos: Position): OpenPositionView {
    const px = this.priceFor(pos);
    const unrealizedPnl = pos.amount * px * (1 - this.config.risk.takerFee) - pos.costQuote;
    return {
      ...pos,
      currentPrice: px,
      unrealizedPnl,
      unrealizedPct: pos.costQuote > 0 ? (unrealizedPnl / pos.costQuote) * 100 : 0,
    };
  }

  private accountSnapshot(): AccountSnapshot {
    this.updateEquity();
    return {
      cashQuote: this.account.cashQuote,
      equity: this.account.equity,
      dayStartEquity: this.account.dayStartEquity,
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
    if (last && time <= last.time) {
      if (force) last.equity = equity;
      return;
    }
    if (!force && last && time - last.time < EQUITY_POINT_MS) return;
    this.equityHistory.push({ time, equity });
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
    if (this.positions.length === 0) return;
    if (!this.armed) {
      this.log(
        "warn",
        `Live: ${this.positions.length} open positie(s) uit de opgeslagen staat. Zolang de bot niet gearmd is worden stops NIET automatisch uitgevoerd.`,
      );
    }
    try {
      const balances = await this.broker.getBalances();
      for (const pos of this.positions) {
        const { base } = splitMarket(pos.market, this.marketInfo.get(pos.market));
        const b = balances.find((x) => x.symbol === base);
        const held = b ? b.available + b.inOrder : 0;
        if (held < pos.amount * 0.99) {
          this.log(
            "warn",
            `Let op: positie ${pos.market} (${fmtAmount(pos.amount)} ${base}) staat in de administratie, maar op Bitvavo staat maar ${fmtAmount(held)} ${base}`,
          );
        }
      }
    } catch (err) {
      this.log("warn", `Kon saldi op Bitvavo niet controleren: ${errorMessage(err)}`);
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
    if (!state) return;
    if (state.mode !== this.mode) {
      this.log(
        "info",
        `Opgeslagen staat hoort bij ${state.mode} mode en wordt niet gebruikt in ${this.mode} mode`,
      );
      return;
    }
    const positions = state.positions.map(normalizePosition).filter((p): p is Position => p !== null);
    const account = sanitizeAccount(state.account, freshAccount(this.startingCapital, this.nowFn()));
    if (this.mode === "live" && account.cashQuote > this.startingCapital) {
      account.cashQuote = this.startingCapital;
    }
    this.account = account;
    this.positions = positions;
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
  }

  private persistedState(): PersistedState {
    return {
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
    };
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

  private clearUncertain(why: string): void {
    if (this.uncertain.size === 0) return;
    this.log("info", `Blokkade na onbekende orderuitkomst opgeheven (${why}) voor: ${[...this.uncertain].join(", ")}`);
    this.uncertain.clear();
  }

  /** Afwijzingsredenen hooguit één keer per gesloten candle per markt. */
  private logRejection(market: string, candleTime: number, message: string): void {
    if (this.rejectLogged.get(market) === candleTime) return;
    this.rejectLogged.set(market, candleTime);
    this.log("info", message);
  }
}
