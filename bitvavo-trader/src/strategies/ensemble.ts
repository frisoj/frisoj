import type {
  Candle,
  EnsembleConfig,
  EnsembleDecision,
  Regime,
  SignalAction,
  SignalMarker,
  StrategyDefinition,
  StrategyId,
  StrategySignal,
} from "../core/types";
import { atr } from "../indicators";
import { nl } from "./common";
import { detectRegimes } from "./regime";
import { getStrategy, isStrategyId, resolveParams } from "./registry";

/** Strategieën buiten hun voorkeursregime tellen (met regimefilter) voor dit deel mee. */
export const OFF_REGIME_WEIGHT = 0.5;

/**
 * Score → actie. De ENIGE plek waar drempels en regimefilter worden toegepast
 * (de optimizer hergebruikt dit om gecachte scores opnieuw te beoordelen).
 * - score >= buyThreshold → "buy" (maar "hold" bij regimefilter + "trend-down")
 * - score <= sellThreshold → "sell"
 * - anders "hold"
 * Een score van precies 0 (geen enkele mening) is nooit een koop of verkoop.
 */
export function classify(score: number, regime: Regime, cfg: EnsembleConfig): SignalAction {
  if (!Number.isFinite(score)) return "hold";
  if (score > 0 && score >= cfg.buyThreshold) {
    return cfg.regimeFilter && regime === "trend-down" ? "hold" : "buy";
  }
  if (score < 0 && score <= cfg.sellThreshold) return "sell";
  return "hold";
}

function direction(action: SignalAction): number {
  return action === "buy" ? 1 : action === "sell" ? -1 : 0;
}

/** Ingeschakelde, geldige strategie-ids zonder dubbelingen (volgorde behouden). */
function enabledIds(cfg: EnsembleConfig): StrategyId[] {
  const seen = new Set<StrategyId>();
  for (const id of cfg.enabled ?? []) if (isStrategyId(id)) seen.add(id);
  return [...seen];
}

/**
 * Draait elke ingeschakelde strategie één keer over alle candles en combineert
 * de signalen per candle tot een gewogen score:
 *   score = Σ w·dir·conf / Σ w   (dir: buy +1, sell −1, hold 0)
 * Met regimefilter tellen strategieën buiten hun voorkeursregime voor de helft.
 * Resultaat heeft dezelfde lengte als `candles`; beslissing i gebruikt alleen candles[0..i].
 */
export function runEnsemble(market: string, candles: Candle[], cfg: EnsembleConfig): EnsembleDecision[] {
  const n = candles.length;
  if (n === 0) return [];
  const ids = enabledIds(cfg);
  const defs: StrategyDefinition[] = ids.map((id) => getStrategy(id));
  const signals: StrategySignal[][] = defs.map((def) => def.run(candles, resolveParams(def.id, cfg.params?.[def.id])));
  const baseWeights = ids.map((id) => {
    const w = cfg.weights?.[id];
    return typeof w === "number" && Number.isFinite(w) ? Math.max(0, w) : 1;
  });
  const preferred = defs.map((d) => new Set<Regime>(d.preferredRegimes));
  const regimes = detectRegimes(candles);
  const atrs = atr(candles, 14);
  const m = ids.length;

  const out: EnsembleDecision[] = new Array(n);
  for (let i = 0; i < n; i++) {
    const regime = regimes[i];
    const filter = cfg.regimeFilter && regime !== "unknown";
    let num = 0;
    let den = 0;
    const votes: StrategySignal[] = new Array(m);
    for (let s = 0; s < m; s++) {
      const sig = signals[s][i];
      votes[s] = sig;
      const w = filter && !preferred[s].has(regime) ? baseWeights[s] * OFF_REGIME_WEIGHT : baseWeights[s];
      den += w;
      const dir = direction(sig.action);
      if (dir !== 0) {
        const conf = Number.isFinite(sig.confidence) ? Math.min(1, Math.max(0, sig.confidence)) : 0;
        num += w * dir * conf;
      }
    }
    let score = den > 0 ? num / den : 0;
    score = score > 1 ? 1 : score < -1 ? -1 : score;
    const a = atrs[i];
    out[i] = {
      market,
      time: candles[i].time,
      price: candles[i].close,
      action: classify(score, regime, cfg),
      score,
      confidence: Math.min(1, Math.abs(score)),
      regime,
      atr: Number.isFinite(a) ? a : NaN,
      votes,
    };
  }
  return out;
}

/** Beslissing op de laatste candle (de caller geeft alleen gesloten candles mee). */
export function latestDecision(market: string, candles: Candle[], cfg: EnsembleConfig): EnsembleDecision | null {
  if (candles.length === 0) return null;
  const all = runEnsemble(market, candles, cfg);
  return all[all.length - 1] ?? null;
}

/** Score met twee decimalen en Nederlandse komma, bijv. "0,52" of "-0,41". */
function scoreLabel(score: number): string {
  return nl(score, 2);
}

/**
 * Alleen buy/sell, ontdubbeld: een aaneengesloten reeks identieke acties
 * (zonder "hold" of andere actie ertussen) levert één marker op de eerste candle.
 */
export function decisionsToMarkers(decisions: EnsembleDecision[]): SignalMarker[] {
  const markers: SignalMarker[] = [];
  let prev: SignalAction = "hold";
  for (const d of decisions) {
    if ((d.action === "buy" || d.action === "sell") && d.action !== prev) {
      markers.push({
        time: d.time,
        action: d.action,
        price: d.price,
        score: d.score,
        label: `${d.action === "buy" ? "KOOP" : "VERKOOP"} ${scoreLabel(d.score)}`,
      });
    }
    prev = d.action;
  }
  return markers;
}

/** Korte samenvatting van de stemmen (bijv. als entryReason). */
export function summarizeVotes(decision: EnsembleDecision): string {
  const active = decision.votes.filter((v) => v.action !== "hold");
  if (active.length === 0) return "Geen actieve signalen";
  return active
    .map((v) => `${getStrategy(v.strategy).name}: ${v.action === "buy" ? "koop" : "verkoop"} (${nl(v.confidence, 2)}) – ${v.reason}`)
    .join("; ");
}
