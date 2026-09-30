/**
 * Kansen-ranglijst: als meerdere munten in dezelfde ronde een koopsignaal geven,
 * probeert de engine ze in deze volgorde (er zijn maar een paar plekken).
 *
 * 1. Signaalsterkte: de ensemble-score, in stapjes van `SCORE_BUCKET`
 *    (verschillen kleiner dan een stapje tellen niet als "sterker");
 * 2. relatieve sterkte: 24h-verandering van de munt min die van Bitcoin
 *    (de munt die het beter doet dan de markt gaat voor; onbekend = achteraan);
 * 3. 24h-volume (liquider = goedkoper in- en uitstappen);
 * 4. marktnaam (vaste volgorde).
 * Puur en deterministisch.
 */
import type { EnsembleDecision } from "../core/types";

export const SCORE_BUCKET = 0.05;

export interface EntryCandidate {
  market: string;
  decision: EnsembleDecision;
  /** 24h-verandering van de munt min die van Bitcoin, in %-punten (null = onbekend) */
  relStrengthPct: number | null;
  /** 24h-volume in EUR (null = onbekend) */
  volumeQuote24h: number | null;
}

function bucket(score: number): number {
  return Number.isFinite(score) ? Math.round(score / SCORE_BUCKET) : Number.NEGATIVE_INFINITY;
}

function desc(a: number | null, b: number | null): number {
  const fa = a !== null && Number.isFinite(a);
  const fb = b !== null && Number.isFinite(b);
  if (fa && fb) return (b as number) - (a as number);
  if (fa) return -1;
  if (fb) return 1;
  return 0;
}

export function compareCandidates(a: EntryCandidate, b: EntryCandidate): number {
  const s = bucket(b.decision.score) - bucket(a.decision.score);
  if (s !== 0) return s;
  const rs = desc(a.relStrengthPct, b.relStrengthPct);
  if (rs !== 0) return rs;
  const vol = desc(a.volumeQuote24h, b.volumeQuote24h);
  if (vol !== 0) return vol;
  return a.market < b.market ? -1 : a.market > b.market ? 1 : 0;
}

/** Nieuwe array, beste kans eerst. */
export function rankCandidates(candidates: readonly EntryCandidate[]): EntryCandidate[] {
  return [...candidates].sort(compareCandidates);
}

/** Relatieve sterkte in %-punten: munt min Bitcoin (null als een van beide onbekend is). */
export function relativeStrengthPct(coinChangePct: number | null | undefined, btcChangePct: number | null | undefined): number | null {
  if (typeof coinChangePct !== "number" || !Number.isFinite(coinChangePct)) return null;
  if (typeof btcChangePct !== "number" || !Number.isFinite(btcChangePct)) return null;
  return coinChangePct - btcChangePct;
}
