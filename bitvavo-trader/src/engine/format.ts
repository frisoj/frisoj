/**
 * Kleine Nederlandse opmaakhelpers voor de logregels van de engine.
 * (Alleen voor tekst; rekenen gebeurt altijd met de ruwe getallen.)
 */
import type { EnsembleDecision, ExitReason, StrategyId } from "../core/types";

function nf(opts: Intl.NumberFormatOptions): Intl.NumberFormat {
  return new Intl.NumberFormat("nl-NL", opts);
}

const EUR_FMT = nf({ minimumFractionDigits: 2, maximumFractionDigits: 2 });
const PCT_FMT = nf({ minimumFractionDigits: 1, maximumFractionDigits: 1 });
const PCT2_FMT = nf({ minimumFractionDigits: 2, maximumFractionDigits: 2 });
const SCORE_FMT = nf({ minimumFractionDigits: 2, maximumFractionDigits: 2 });
const PRICE_BIG = nf({ maximumFractionDigits: 0 });
const PRICE_MID = nf({ minimumFractionDigits: 2, maximumFractionDigits: 2 });
const PRICE_SMALL = nf({ minimumFractionDigits: 2, maximumFractionDigits: 4 });
const PRICE_TINY = nf({ maximumSignificantDigits: 4 });
const AMOUNT_FMT = nf({ maximumSignificantDigits: 6 });

function finite(v: number): boolean {
  return typeof v === "number" && Number.isFinite(v);
}

/** €22,50 (negatief: -€1,20) */
export function fmtEur(v: number): string {
  if (!finite(v)) return "€?";
  const s = EUR_FMT.format(Math.abs(v));
  return v < 0 && s !== "0,00" ? `-€${s}` : `€${s}`;
}

/** +€0,41 / -€0,41 */
export function fmtSignedEur(v: number): string {
  if (!finite(v)) return "€?";
  const s = EUR_FMT.format(Math.abs(v));
  return `${v < 0 && s !== "0,00" ? "-" : "+"}€${s}`;
}

/** +1,8% / -0,4% */
export function fmtSignedPct(v: number): string {
  if (!finite(v)) return "?%";
  const s = PCT_FMT.format(Math.abs(v));
  return `${v < 0 && s !== "0,0" ? "-" : "+"}${s}%`;
}

/** 0,62% (twee decimalen, zonder plusteken; bijv. voor een spread) */
export function fmtPct2(v: number): string {
  return finite(v) ? `${PCT2_FMT.format(v)}%` : "?%";
}

/** "A, B, C" — hooguit `max` namen, daarna " +N" */
export function fmtNameList(names: readonly string[], max = 8): string {
  const shown = names.slice(0, Math.max(0, max)).join(", ");
  return names.length > max ? `${shown} +${names.length - max}` : shown;
}

/** Koers: 91.234 · 150,23 · 0,5123 · 0,00001234 */
export function fmtPrice(p: number): string {
  if (!finite(p)) return "?";
  const a = Math.abs(p);
  if (a >= 1000) return PRICE_BIG.format(p);
  if (a >= 10) return PRICE_MID.format(p);
  if (a >= 0.1) return PRICE_SMALL.format(p);
  return PRICE_TINY.format(p);
}

export function fmtAmount(a: number): string {
  return finite(a) ? AMOUNT_FMT.format(a) : "?";
}

export function fmtScore(s: number): string {
  return finite(s) ? SCORE_FMT.format(s) : "?";
}

export const STRATEGY_LABELS: Record<StrategyId, string> = {
  "ema-trend": "EMA-trend",
  "rsi-reversion": "RSI-reversie",
  breakout: "Breakout",
  "macd-momentum": "MACD-momentum",
  "vwap-reversion": "VWAP-reversie",
};

export function strategyLabel(id: string): string {
  return (STRATEGY_LABELS as Record<string, string>)[id] ?? id;
}

export const EXIT_REASON_LABELS: Record<ExitReason, string> = {
  "stop-loss": "stop-loss",
  "take-profit": "take-profit",
  "trailing-stop": "trailing stop",
  "break-even": "break-even stop",
  signal: "verkoopsignaal",
  "time-stop": "tijdstop",
  manual: "handmatig",
  "kill-switch": "noodstop",
  "end-of-backtest": "einde backtest",
  "write-off": "afgeschreven",
  "daily-target": "dagdoel gehaald",
};

export function exitReasonLabel(r: ExitReason): string {
  return EXIT_REASON_LABELS[r] ?? r;
}

/** Strategieën die in deze beslissing voor "buy" stemden, sterkste eerst. */
export function buyVoters(decision: EnsembleDecision): EnsembleDecision["votes"] {
  const votes = Array.isArray(decision.votes) ? decision.votes : [];
  return votes
    .filter((v) => v && v.action === "buy")
    .sort((a, b) => (b.confidence ?? 0) - (a.confidence ?? 0));
}

/** "score 0,52: EMA-trend, Breakout" */
export function decisionSummary(decision: EnsembleDecision): string {
  const names = buyVoters(decision).map((v) => strategyLabel(v.strategy));
  return `score ${fmtScore(decision.score)}${names.length ? `: ${names.join(", ")}` : ""}`;
}

/** Uitgebreidere entry-reden voor de positie (met de uitleg per strategie). */
export function entryReasonText(decision: EnsembleDecision): string {
  const voters = buyVoters(decision);
  const parts = voters.map((v) => (v.reason ? `${strategyLabel(v.strategy)} (${v.reason})` : strategyLabel(v.strategy)));
  const regime = decision.regime && decision.regime !== "unknown" ? `, regime ${decision.regime}` : "";
  const head = `Score ${fmtScore(decision.score)}${regime}`;
  return parts.length ? `${head} · ${parts.join(" · ")}` : head;
}

export function errorMessage(err: unknown): string {
  if (err instanceof Error) return err.message;
  if (typeof err === "string") return err;
  try {
    return JSON.stringify(err);
  } catch {
    return String(err);
  }
}
