/**
 * Honest Dutch verdicts. The user has €50 and hopes to make money: these
 * sentences must never flatter. Only a walk-forward (out-of-sample) result
 * can ever be called "robuust", and even then with a warning.
 */
import type { BacktestMetrics } from "../core/types";
import { fmtPctNl } from "./simulator";

export const ROBUST_MIN_OOS_TRADES = 20;
export const ROBUST_MIN_PROFITABLE_FOLD_RATIO = 0.6;

const SIMULATED_NOTE = " Let op: dit is gesimuleerde data en zegt niets over de echte markt.";

export interface WalkForwardVerdictInput {
  oosReturnPct: number;
  buyHoldReturnPct: number;
  /** Folds whose out-of-sample (test) return was > 0 */
  profitableFolds: number;
  folds: number;
  oosTrades: number;
  simulatedData?: boolean;
}

function trades(n: number): string {
  return n === 1 ? "1 trade" : `${n} trades`;
}

export function walkForwardVerdict(v: WalkForwardVerdictInput): string {
  const r = fmtPctNl(v.oosReturnPct);
  const b = fmtPctNl(v.buyHoldReturnPct);
  const beatsBuyHold = v.oosReturnPct > v.buyHoldReturnPct;
  const foldRatio = v.folds > 0 ? v.profitableFolds / v.folds : 0;
  const foldsText = `${v.profitableFolds} van ${v.folds} folds`;
  let s: string;

  if (v.oosTrades === 0) {
    s = `Out-of-sample geen enkele trade (buy & hold ${b}): er is geen bewijs dat deze instellingen werken. Niet live gaan; blijf paper traden.`;
  } else if (v.oosReturnPct <= 0) {
    s = beatsBuyHold
      ? `Out-of-sample verliesgevend (${r}), al deed buy & hold het nog slechter (${b}). Verlies blijft verlies. Niet live gaan met deze instellingen.`
      : `Out-of-sample verliesgevend (${r}) en slechter dan buy & hold (${b}). Niet live gaan met deze instellingen.`;
  } else if (
    beatsBuyHold &&
    foldRatio >= ROBUST_MIN_PROFITABLE_FOLD_RATIO &&
    v.oosTrades >= ROBUST_MIN_OOS_TRADES
  ) {
    s =
      `Robuust in deze test: out-of-sample ${r} tegenover buy & hold ${b}, winstgevend in ${foldsText} over ${trades(v.oosTrades)}. ` +
      `Begin hooguit klein en blijf het volgen, maar resultaten uit het verleden bieden geen garantie voor de toekomst.`;
  } else {
    const issues: string[] = [];
    if (!beatsBuyHold) issues.push(`niet beter dan buy & hold (${b})`);
    if (v.oosTrades < ROBUST_MIN_OOS_TRADES) issues.push(`slechts ${trades(v.oosTrades)}`);
    const lead = v.oosReturnPct < 2 ? "licht winstgevend" : "winstgevend";
    s =
      `Out-of-sample ${lead} (${r}) in ${foldsText}` +
      (issues.length > 0 ? `, maar ${issues.join(" en ")}` : "") +
      "; te weinig bewijs, blijf paper traden.";
  }
  return v.simulatedData ? s + SIMULATED_NOTE : s;
}

/**
 * Verdict for a single (in-sample) backtest. Never positive without the
 * caveat that only walk-forward results count.
 */
export function backtestVerdict(m: BacktestMetrics, opts: { simulatedData?: boolean } = {}): string {
  const r = fmtPctNl(m.totalReturnPct);
  const b = fmtPctNl(m.buyHoldReturnPct);
  let s: string;
  if (m.trades === 0) {
    s = `Geen trades in deze periode (buy & hold ${b}): niets te beoordelen.`;
  } else if (m.totalReturnPct <= 0) {
    s =
      m.totalReturnPct > m.buyHoldReturnPct
        ? `Verliesgevend (${r}), al deed buy & hold het nog slechter (${b}). Verlies blijft verlies. Niet live gaan met deze instellingen.`
        : `Verliesgevend (${r}) en slechter dan buy & hold (${b}). Niet live gaan met deze instellingen.`;
  } else if (m.totalReturnPct <= m.buyHoldReturnPct) {
    s = `Winstgevend (${r}) maar niet beter dan gewoon kopen en vasthouden (${b}). Dan heeft de bot geen toegevoegde waarde.`;
  } else {
    s = `Winstgevend (${r}) en beter dan buy & hold (${b}) over ${trades(m.trades)}.`;
    if (m.trades < ROBUST_MIN_OOS_TRADES) s += " Maar dat zijn te weinig trades om iets te bewijzen.";
    s += " Dit is één in-sample test: check het met een walk-forward (--walkforward) en blijf paper traden.";
  }
  return opts.simulatedData ? s + SIMULATED_NOTE : s;
}
