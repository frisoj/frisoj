/**
 * Samenvatting van één bot voor de wedstrijd (`GET /api/bots`). Puur: werkt alleen op
 * een snapshot van de engine (plus, als de engine dat kan, ALLE bewaarde trades), zodat
 * het zonder echte engine te testen is.
 *
 * - Resultaten (€ en %) komen van de engine zelf (`account.totalPnlQuote` enz.), die
 *   ook na afromen en een gewijzigde kapitaallimiet klopt. Alleen een oudere engine
 *   zonder die velden krijgt een eigen berekening.
 * - Winst/verlies-statistiek telt over alle gesloten trades die de engine bewaart
 *   (`allTrades`, max. 1000 — de engine laat daarna de oudste vallen), niet alleen de
 *   laatste 200 uit de snapshot. Zonder `allTrades` zijn het die 200.
 * - Max. daling: grootste daling van piek naar dal van `equity + skimmed` over de hele
 *   equity-historie van de engine (max. 2000 punten), in % van de piek (≤ 0). Een
 *   overboeking uit het budget (afromen) is dus geen daling.
 * - Equity-verloop voor de grafiek: `equity + skimmed`, uitgedund tot hooguit
 *   {@link EQUITY_HISTORY_MAX_POINTS} punten; het eerste en laatste punt blijven altijd.
 *   `time` in ms (zoals `EquityPoint.time`).
 */
import type { BotSummary, EngineSnapshot, EquityPoint, Trade } from "../core/types";
import { RATIO_CAP } from "../backtest/metrics";

export const EQUITY_HISTORY_MAX_POINTS = 300;

/** Wat de samenvatting van een profiel gebruikt (zie `BotProfile`). */
export interface SummaryProfile {
  id: string;
  name: string;
  short: string;
  description: string;
  color: string;
}

/** Wat de samenvatting van de snapshot gebruikt (de echte `EngineSnapshot` past). */
export type SummarySnapshot = Pick<
  EngineSnapshot,
  "running" | "mode" | "liveArmed" | "startedAt" | "config" | "account" | "positions" | "trades" | "equityHistory" | "halted"
> &
  Partial<Pick<EngineSnapshot, "activeMarkets" | "skimmedQuote">>;

export interface SummaryExtra {
  /** Alle bewaarde gesloten trades (`TradingEngine.allTrades()`); anders `snapshot.trades` (laatste 200) */
  allTrades?: readonly Trade[];
  /** Pad van het eigen dashboard; standaard `/bot/<id>/` */
  path?: string;
}

function finite(v: unknown, fallback = 0): number {
  return typeof v === "number" && Number.isFinite(v) ? v : fallback;
}

/** Equity + netto uit het budget gehaald bedrag (live), zoals de grafieken het tonen. */
export function equityValue(p: EquityPoint): number {
  return finite(p.equity) + finite(p.skimmed);
}

/**
 * Hooguit `max` punten, gelijkmatig over de lijst verdeeld; het eerste en het laatste
 * punt blijven altijd staan. Een korte lijst komt ongewijzigd (als kopie) terug.
 */
export function downsample<T>(points: readonly T[], max = EQUITY_HISTORY_MAX_POINTS): T[] {
  const n = points.length;
  const limit = Math.max(2, Math.floor(max));
  if (n <= limit) return [...points];
  const out: T[] = [];
  const step = (n - 1) / (limit - 1);
  for (let i = 0; i < limit; i++) out.push(points[Math.round(i * step)]);
  out[limit - 1] = points[n - 1];
  return out;
}

/** Totaal per markt; beste en slechtste (bij gelijk resultaat de alfabetisch eerste). */
function bestAndWorst(trades: readonly Trade[]): Pick<BotSummary, "bestMarket" | "worstMarket"> {
  const byMarket = new Map<string, number>();
  for (const t of trades) {
    if (typeof t.market !== "string") continue;
    byMarket.set(t.market, (byMarket.get(t.market) ?? 0) + finite(t.pnlQuote));
  }
  if (byMarket.size === 0) return { bestMarket: null, worstMarket: null };
  const rows = [...byMarket.entries()].sort((a, b) => a[0].localeCompare(b[0]));
  let best = rows[0];
  let worst = rows[0];
  for (const r of rows) {
    if (r[1] > best[1]) best = r;
    if (r[1] < worst[1]) worst = r;
  }
  return {
    bestMarket: { market: best[0], pnlQuote: best[1] },
    worstMarket: { market: worst[0], pnlQuote: worst[1] },
  };
}

/** Winst/verlies-statistiek, zelfde regels als de backtest (`src/backtest/metrics.ts`). */
function tradeStats(trades: readonly Trade[]) {
  let wins = 0;
  let losses = 0;
  let grossWin = 0;
  let grossLoss = 0;
  let winPct = 0;
  let lossPct = 0;
  for (const t of trades) {
    const pnl = finite(t.pnlQuote);
    if (pnl > 0) {
      wins++;
      grossWin += pnl;
      winPct += finite(t.pnlPct);
    } else if (pnl < 0) {
      losses++;
      grossLoss += -pnl;
      lossPct += finite(t.pnlPct);
    }
  }
  const n = trades.length;
  return {
    trades: n,
    wins,
    losses,
    winRatePct: n > 0 ? (wins / n) * 100 : 0,
    avgWinPct: wins > 0 ? winPct / wins : 0,
    avgLossPct: losses > 0 ? lossPct / losses : 0,
    profitFactor: grossLoss > 0 ? Math.min(RATIO_CAP, grossWin / grossLoss) : grossWin > 0 ? RATIO_CAP : 0,
  };
}

/**
 * Grootste daling van piek naar dal van (equity + skimmed), in % van max(piek, startkapitaal),
 * nooit lager dan −100%. Een hogere kapitaallimiet (live) maakt `skimmed` negatief: die
 * storting is dan geen "daling" en de % rekent met het geld dat echt meedoet.
 */
export function summaryDrawdownPct(values: readonly number[], startingEquity: number): number {
  let peak = Number.NEGATIVE_INFINITY;
  let worst = 0;
  for (const v of values) {
    if (!Number.isFinite(v)) continue;
    if (v > peak) peak = v;
    const base = Math.max(peak, Number.isFinite(startingEquity) ? startingEquity : 0);
    if (base > 0) {
      const dd = ((v - peak) / base) * 100;
      if (dd < worst) worst = dd;
    }
  }
  return Math.max(-100, worst);
}

export function summarize(snap: SummarySnapshot, profile: SummaryProfile, extra: SummaryExtra = {}): BotSummary {
  const a = snap.account;
  const startingEquity = finite(a.startingEquity);
  const equity = finite(a.equity);
  // Voorkeur: de cijfers van de engine (correct na afromen / een andere limiet).
  const totalPnlQuote = finite(a.totalPnlQuote, equity + finite(snap.skimmedQuote) - startingEquity);
  const totalReturnPct = finite(a.totalReturnPct, startingEquity > 0 ? (totalPnlQuote / startingEquity) * 100 : 0);
  const dayStart = finite(a.dayStartEquity);
  const dayPnlQuote = finite(a.dayPnlQuote, equity - dayStart);
  const dayReturnPct = finite(a.dayReturnPct, dayStart > 0 ? (dayPnlQuote / dayStart) * 100 : 0);
  const feesPaid = finite(a.feesPaid);

  const trades = extra.allTrades ?? snap.trades ?? [];
  const history = Array.isArray(snap.equityHistory) ? snap.equityHistory : [];
  const values = history.map(equityValue);

  return {
    id: profile.id,
    name: profile.name,
    short: profile.short,
    description: profile.description,
    color: profile.color,
    path: extra.path ?? `/bot/${profile.id}/`,
    mode: snap.mode,
    running: Boolean(snap.running),
    liveArmed: Boolean(snap.liveArmed),
    interval: snap.config.interval,
    startedAt: snap.startedAt ?? null,
    startingEquity,
    equity,
    totalPnlQuote,
    totalReturnPct,
    dayPnlQuote,
    dayReturnPct,
    feesPaid,
    grossPnlQuote: totalPnlQuote + feesPaid,
    ...tradeStats(trades),
    maxDrawdownPct: values.length > 0 ? finite(summaryDrawdownPct(values, startingEquity)) : 0,
    tradesToday: finite(a.tradesToday),
    openPositions: Array.isArray(snap.positions) ? snap.positions.length : 0,
    activeMarkets: (snap.activeMarkets ?? snap.config.markets ?? []).length,
    halted: { ...(snap.halted ?? { halted: false }) },
    ...bestAndWorst(trades),
    equityHistory: downsample(history).map((p) => ({ time: p.time, value: equityValue(p) })),
  };
}
