import type { Candle, StrategyDefinition, StrategyParams } from "../core/types";
import { atr, closes, ema, macd } from "../indicators";
import { clamp01, finite, intParam, persistRun, type SignalEvent } from "./common";

const TREND_PERIOD = 50;
const ATR_PERIOD = 14;

const DEFAULTS = { fast: 12, slow: 26, signal: 9 };

function resolve(params: StrategyParams) {
  return {
    fast: intParam(params, "fast", DEFAULTS.fast),
    slow: intParam(params, "slow", DEFAULTS.slow),
    signal: intParam(params, "signal", DEFAULTS.signal),
  };
}

function warmupOf(params: StrategyParams): number {
  const p = resolve(params);
  return Math.max(p.slow + p.signal, TREND_PERIOD, ATR_PERIOD) + 1;
}

/**
 * MACD-momentum: koopt als de MACD-lijn boven de signaallijn kruist met een
 * stijgend histogram, alleen als de koers boven EMA 50 staat. Verkoopt op de
 * omgekeerde kruising (sterker onder EMA 50).
 */
export const macdMomentum: StrategyDefinition = {
  id: "macd-momentum",
  name: "MACD-momentum",
  description:
    "Momentum: koopt als de MACD-lijn boven de signaallijn kruist met stijgend histogram en de koers boven EMA 50 staat. Verkoopt als de MACD weer onder de signaallijn kruist.",
  defaultParams: { ...DEFAULTS },
  paramSpace: {
    fast: [8, 12],
    slow: [21, 26],
    signal: [5, 9],
  },
  preferredRegimes: ["trend-up", "trend-down"],
  warmup: warmupOf,

  run(candles: Candle[], params: StrategyParams) {
    const p = resolve(params);
    const n = candles.length;
    const c = closes(candles);
    const m = macd(c, p.fast, p.slow, p.signal);
    const h = m.histogram;
    const e50 = ema(c, TREND_PERIOD);
    const a = atr(candles, ATR_PERIOD);

    const idleBelowTrend = "MACD positief, maar koers onder EMA 50";
    const idlePositive = "MACD boven signaallijn, geen nieuw signaal";
    const idleNegative = "MACD onder signaallijn";

    // Histogramversnelling in ATR-eenheden → extra confidence
    const accel = (i: number) => (a[i] > 0 ? (h[i] - h[i - 1]) / a[i] : 0);

    return persistRun("macd-momentum", n, warmupOf(params), {
      ready: (i) => i > 0 && finite(h[i], h[i - 1], e50[i], a[i]),

      event: (i): SignalEvent | null => {
        const up = h[i - 1] <= 0 && h[i] > 0;
        const down = h[i - 1] >= 0 && h[i] < 0;
        if (up && c[i] > e50[i]) {
          return {
            action: "buy",
            confidence: 0.7 + 0.3 * clamp01(accel(i) / 0.1),
            reason: "MACD kruist boven signaallijn, histogram stijgt (boven EMA 50)",
          };
        }
        if (down) {
          const underTrend = c[i] < e50[i];
          return {
            action: "sell",
            confidence: (underTrend ? 0.75 : 0.55) + 0.25 * clamp01(-accel(i) / 0.1),
            reason: underTrend ? "MACD kruist onder signaallijn (onder EMA 50)" : "MACD kruist onder signaallijn",
          };
        }
        return null;
      },

      valid: (i, action) => (action === "buy" ? h[i] > 0 && c[i] > e50[i] : h[i] < 0),

      idle: (i) => (h[i] > 0 ? (c[i] > e50[i] ? idlePositive : idleBelowTrend) : idleNegative),
    });
  },
};
