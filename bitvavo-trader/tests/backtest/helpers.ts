import type {
  AccountSnapshot,
  Candle,
  EnsembleConfig,
  EnsembleDecision,
  EntryPlan,
  Interval,
  Position,
  PositionUpdate,
  RiskConfig,
  RiskManagerLike,
  SignalAction,
} from "../../src/core/types";
import { INTERVAL_MS } from "../../src/core/types";
import { DEFAULT_ENSEMBLE_CONFIG, DEFAULT_RISK_CONFIG } from "../../src/core/defaults";
import type { BacktestInput } from "../../src/backtest/simulator";
import type { ResolvedOptimizerDeps } from "../../src/backtest/optimizerCore";

export const T0 = Date.UTC(2025, 0, 6, 0, 0, 0); // a Monday, 00:00 UTC
export const INTERVAL: Interval = "15m";
export const STEP = INTERVAL_MS[INTERVAL];

export const FEE = 0.0025;
export const SLIP = 0.0005;

/** Candle i with explicit OHLC; time = T0 + i * STEP. */
export function candle(i: number, open: number, high: number, low: number, close: number, volume = 1): Candle {
  return { time: T0 + i * STEP, open, high, low, close, volume };
}

/** `count` flat candles at `price` (tiny range so nothing is ever hit accidentally). */
export function flatCandles(count: number, price = 100, from = 0): Candle[] {
  return Array.from({ length: count }, (_, k) => candle(from + k, price, price + 0.1, price - 0.1, price));
}

export function riskCfg(overrides: Partial<RiskConfig> = {}): RiskConfig {
  return { ...DEFAULT_RISK_CONFIG, takerFee: FEE, slippagePct: SLIP, minOrderQuote: 5, ...overrides };
}

export function input(candles: Candle[], overrides: Partial<BacktestInput> = {}): BacktestInput {
  return {
    market: "TEST-EUR",
    interval: INTERVAL,
    candles,
    initialCapital: 100,
    ensemble: { ...DEFAULT_ENSEMBLE_CONFIG },
    risk: riskCfg(),
    dataSource: "simulated",
    ...overrides,
  };
}

/** Decisions from an action per candle ("B" = buy, "S" = sell, anything else = hold). */
export function decisionsFrom(candles: Candle[], actions: string | SignalAction[], atr = 1, market = "TEST-EUR"): EnsembleDecision[] {
  return candles.map((c, i) => {
    const a = typeof actions === "string" ? actions[i] : actions[i];
    const action: SignalAction = a === "B" || a === "buy" ? "buy" : a === "S" || a === "sell" ? "sell" : "hold";
    const score = action === "buy" ? 0.6 : action === "sell" ? -0.6 : 0;
    return {
      market,
      time: c.time,
      price: c.close,
      action,
      score,
      confidence: Math.abs(score),
      regime: "range",
      atr,
      votes: [],
    };
  });
}

export interface StubRiskOptions {
  /** EUR per entry (incl. fee); default 50 */
  quote?: number;
  /** Stop distance below expectedEntryPrice; default 2 */
  stopDist?: number;
  /** Take-profit distance above expectedEntryPrice; default 4 */
  tpDist?: number;
  /** Exit on "sell" decisions; default true */
  exitOnSell?: boolean;
  /** Time-stop after this many candles held (0 = off) */
  timeStop?: number;
  /** If set: stop = stopAtrMult × decision.atr, TP = takeProfitR × stop distance */
  cfg?: RiskConfig;
}

export interface StubRisk extends RiskManagerLike {
  planCalls: { decision: EnsembleDecision; account: AccountSnapshot; now: number }[];
  updateCalls: { pos: Position; candle: Candle; atr: number }[];
}

/**
 * Simple, predictable risk manager: fixed quote amount, fixed stop/TP distances,
 * stop checked before take-profit, gaps exit at the open.
 */
export function stubRisk(opts: StubRiskOptions = {}): StubRisk {
  const quote = opts.quote ?? 50;
  const stopDist = opts.stopDist ?? 2;
  const tpDist = opts.tpDist ?? 4;
  const exitOnSell = opts.exitOnSell ?? true;
  const r: StubRisk = {
    planCalls: [],
    updateCalls: [],
    planEntry(decision, account, _market, now): EntryPlan {
      r.planCalls.push({ decision, account: { ...account }, now });
      const expected = decision.price;
      const sd = opts.cfg ? opts.cfg.stopAtrMult * decision.atr : stopDist;
      const td = opts.cfg ? opts.cfg.takeProfitR * sd : tpDist;
      return {
        approved: decision.action === "buy",
        reasons: [],
        market: decision.market,
        quoteAmount: Math.min(quote, account.cashQuote),
        expectedEntryPrice: expected,
        stopPrice: expected - sd,
        takeProfitPrice: expected + td,
        riskQuote: 1,
      };
    },
    updatePosition(pos, c, atr): PositionUpdate {
      r.updateCalls.push({ pos: { ...pos }, candle: c, atr });
      const highestPrice = Math.max(pos.highestPrice, c.high);
      if (c.low <= pos.stopPrice) {
        return { exit: true, exitReason: "stop-loss", exitPrice: Math.min(c.open, pos.stopPrice), stopPrice: pos.stopPrice, highestPrice };
      }
      if (c.high >= pos.takeProfitPrice) {
        return { exit: true, exitReason: "take-profit", exitPrice: Math.max(c.open, pos.takeProfitPrice), stopPrice: pos.stopPrice, highestPrice };
      }
      if (opts.timeStop && pos.candlesHeld >= opts.timeStop) {
        return { exit: true, exitReason: "time-stop", exitPrice: c.close, stopPrice: pos.stopPrice, highestPrice };
      }
      return { exit: false, stopPrice: pos.stopPrice, highestPrice };
    },
    shouldExitOnSignal(_pos, decision) {
      return exitOnSell && decision.action === "sell";
    },
    haltStatus() {
      return { halted: false };
    },
  };
  return r;
}

/** Deterministic random-walk candles (for optimizer / walk-forward tests). */
export function walkCandles(count: number, seed = 1, start = 100): Candle[] {
  let a = seed >>> 0;
  const rnd = () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  const out: Candle[] = [];
  let price = start;
  for (let i = 0; i < count; i++) {
    const open = price;
    const drift = Math.sin(i / 60) * 0.002;
    const close = Math.max(1, open * (1 + drift + (rnd() - 0.5) * 0.01));
    const high = Math.max(open, close) * (1 + rnd() * 0.004);
    const low = Math.min(open, close) * (1 - rnd() * 0.004);
    out.push({ time: T0 + i * STEP, open, high, low, close, volume: 1 + rnd() });
    price = close;
  }
  return out;
}

/**
 * Stub "ensemble": a momentum score from the last 5 closes (only uses candles[0..i]),
 * classified with the thresholds of the config. Counts its calls.
 */
export function momentumDecide() {
  const calls = { count: 0 };
  const classify = (score: number, _regime: unknown, cfg: EnsembleConfig): SignalAction =>
    score > 0 && score >= cfg.buyThreshold ? "buy" : score < 0 && score <= cfg.sellThreshold ? "sell" : "hold";
  const decide = (market: string, candles: Candle[], cfg: EnsembleConfig): EnsembleDecision[] => {
    calls.count++;
    return candles.map((c, i) => {
      const back = candles[Math.max(0, i - 5)];
      const mom = i >= 5 ? (c.close / back.close - 1) * 100 : 0;
      const score = Math.max(-1, Math.min(1, mom));
      return {
        market,
        time: c.time,
        price: c.close,
        action: classify(score, "range", cfg),
        score,
        confidence: Math.abs(score),
        regime: "range" as const,
        atr: c.close * 0.004,
        votes: [],
      };
    });
  };
  return { decide, classify, calls };
}

export function stubOptimizerDeps(overrides: Partial<ResolvedOptimizerDeps> = {}): ResolvedOptimizerDeps & { calls: { count: number } } {
  const m = momentumDecide();
  return {
    decide: m.decide,
    createRisk: (cfg) => stubRisk({ quote: 40, cfg }),
    classify: null,
    paramSpace: () => ({}),
    calls: m.calls,
    ...overrides,
  };
}
