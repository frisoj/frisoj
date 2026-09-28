import type { Candle, Regime } from "../core/types";
import { adx, atr, closes, ema } from "../indicators";
import { rollingMeanSkipNaN } from "./common";

const ADX_PERIOD = 14;
const ATR_PERIOD = 14;
const EMA_PERIOD = 50;
/** Helling van EMA 50 gemeten over zoveel candles */
const SLOPE_BARS = 10;
/** ATR% wordt vergeleken met zijn eigen gemiddelde over zoveel candles */
const ATR_AVG_PERIOD = 50;

/** Drempels (geëxporteerd voor documentatie/tests) */
export const REGIME_THRESHOLDS = {
  /** ATR% ≥ dit × zijn gemiddelde → "volatile" */
  volatileRatio: 1.6,
  /** ADX vanaf hier telt als trend */
  adxTrend: 22,
  /** Minimale EMA 50-helling in ATR per candle voor een trend */
  minSlopeAtr: 0.03,
};

/**
 * Marktregime per candle (zelfde lengte als `candles`, "unknown" tijdens warmup).
 * - "volatile": ATR% duidelijk boven zijn eigen voortschrijdend gemiddelde
 * - "trend-up"/"trend-down": ADX(14) hoog genoeg én EMA 50 helt duidelijk
 * - "range": de rest
 * Gebruikt alleen candles[0..i] voor index i.
 */
export function detectRegimes(candles: Candle[]): Regime[] {
  const n = candles.length;
  const out: Regime[] = new Array(n).fill("unknown");
  if (n === 0) return out;
  const c = closes(candles);
  const dmi = adx(candles, ADX_PERIOD);
  const ax = dmi.adx;
  const e = ema(c, EMA_PERIOD);
  const a = atr(candles, ATR_PERIOD);
  const atrPct = a.map((v, i) => (c[i] > 0 ? v / c[i] : NaN));
  const atrAvg = rollingMeanSkipNaN(atrPct, ATR_AVG_PERIOD);
  const t = REGIME_THRESHOLDS;

  for (let i = SLOPE_BARS; i < n; i++) {
    const adxV = ax[i];
    const e0 = e[i - SLOPE_BARS];
    const e1 = e[i];
    const at = a[i];
    const ratioBase = atrAvg[i];
    if (!Number.isFinite(adxV) || !Number.isFinite(e0) || !Number.isFinite(e1) || !(at > 0) || !(ratioBase > 0)) {
      continue;
    }
    if (atrPct[i] / ratioBase >= t.volatileRatio) {
      out[i] = "volatile";
      continue;
    }
    const slope = (e1 - e0) / (SLOPE_BARS * at);
    if (adxV >= t.adxTrend && slope >= t.minSlopeAtr && dmi.plusDI[i] >= dmi.minusDI[i]) out[i] = "trend-up";
    else if (adxV >= t.adxTrend && slope <= -t.minSlopeAtr && dmi.minusDI[i] >= dmi.plusDI[i]) out[i] = "trend-down";
    else out[i] = "range";
  }
  return out;
}
