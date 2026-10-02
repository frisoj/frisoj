import type { Candle, StrategyDefinition, StrategyParams } from "../core/types";
import { atr, closes, ema, macd } from "../indicators";
import { clamp01, finite, intParam, persistRun, type SignalEvent } from "./common";

const TREND_PERIOD = 50;
const ATR_PERIOD = 14;
/** Minimaal aantal candles tussen twee events in dezelfde richting. */
const MIN_BARS_BETWEEN = 6;

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
 * omgekeerde kruising, alleen als de koers onder EMA 50 staat (symmetrisch filter).
 */
export const macdMomentum: StrategyDefinition = {
  id: "macd-momentum",
  name: "MACD-momentum",
  description:
    "Momentum: koopt als de MACD-lijn boven de signaallijn kruist met stijgend histogram en de koers boven EMA 50 staat. Verkoopt bij de omgekeerde kruising onder EMA 50.",
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
    const line = m.macd;
    const e50 = ema(c, TREND_PERIOD);
    const a = atr(candles, ATR_PERIOD);

    const idleBelowTrend = "MACD positief, maar koers onder EMA 50";
    const idlePositive = "MACD boven signaallijn, geen nieuw signaal";
    const idleNegative = "MACD onder signaallijn";
    const idleNegAbove = "MACD onder signaallijn, maar koers boven EMA 50";

    // Histogramversnelling in ATR-eenheden → extra confidence
    const accel = (i: number) => (a[i] > 0 ? (h[i] - h[i - 1]) / a[i] : 0);

    let lastBuy = -Infinity;
    let lastSell = -Infinity;

    return persistRun("macd-momentum", n, warmupOf(params), {
      // Momentummening leeft ongeveer één signaalperiode
      decayBars: Math.max(6, p.signal),
      ready: (i) => i > 0 && finite(h[i], h[i - 1], line[i], line[i - 1], e50[i], a[i]),

      event: (i): SignalEvent | null => {
        const up = h[i - 1] <= 0 && h[i] > 0;
        const down = h[i - 1] >= 0 && h[i] < 0;
        // Nullijn-kruising van de MACD-lijn (EMA fast kruist EMA slow) met positief histogram
        const zeroUp = line[i - 1] <= 0 && line[i] > 0 && h[i] > 0;
        const zeroDown = line[i - 1] >= 0 && line[i] < 0 && h[i] < 0;
        if (up && c[i] > e50[i]) {
          lastBuy = i;
          return {
            action: "buy",
            confidence: 0.8 + 0.2 * clamp01(accel(i) / 0.1),
            reason: "MACD kruist boven signaallijn, histogram stijgt (boven EMA 50)",
          };
        }
        if (zeroUp && c[i] > e50[i] && i - lastBuy >= MIN_BARS_BETWEEN) {
          lastBuy = i;
          return { action: "buy", confidence: 0.75, reason: "MACD-lijn kruist boven nul, momentum bevestigd (boven EMA 50)" };
        }
        if (down && c[i] < e50[i]) {
          lastSell = i;
          return {
            action: "sell",
            confidence: 0.7 + 0.3 * clamp01(-accel(i) / 0.1),
            reason: "MACD kruist onder signaallijn, histogram daalt (onder EMA 50)",
          };
        }
        if (zeroDown && c[i] < e50[i] && i - lastSell >= MIN_BARS_BETWEEN) {
          lastSell = i;
          return { action: "sell", confidence: 0.7, reason: "MACD-lijn kruist onder nul (onder EMA 50)" };
        }
        return null;
      },

      // Mening blijft zolang het momentum dezelfde kant op wijst
      valid: (i, action) =>
        action === "buy" ? h[i] > 0 && c[i] > e50[i] : h[i] < 0 && h[i] <= h[i - 1] && c[i] < e50[i],

      idle: (i) =>
        h[i] > 0 ? (c[i] > e50[i] ? idlePositive : idleBelowTrend) : c[i] < e50[i] ? idleNegative : idleNegAbove,
    });
  },
};
