import type { Candle, StrategyDefinition, StrategyParams } from "../core/types";
import { adx, closes, ema } from "../indicators";
import { clamp01, finite, intParam, nl, numParam, persistRun, type SignalEvent } from "./common";

const ADX_PERIOD = 14;
/** Een bullish kruising mag tot zoveel candles later alsnog bevestigd worden door de filters. */
const CONFIRM_BARS = 8;

const DEFAULTS = { fast: 9, slow: 21, trend: 100, adxMin: 20 };

function warmupOf(params: StrategyParams): number {
  const p = resolve(params);
  return Math.max(p.fast, p.slow, p.trend, 2 * ADX_PERIOD) + 1;
}

function resolve(params: StrategyParams) {
  const fast = intParam(params, "fast", DEFAULTS.fast);
  const slow = intParam(params, "slow", DEFAULTS.slow);
  const trend = intParam(params, "trend", DEFAULTS.trend);
  const adxMin = numParam(params, "adxMin", DEFAULTS.adxMin);
  return { fast, slow, trend, adxMin };
}

/**
 * EMA-trend: trendvolger. Koopt op een kruising van de snelle EMA boven de
 * trage EMA, maar alleen als de koers boven de lange trend-EMA staat en de
 * ADX voldoende trendsterkte laat zien. Verkoopt op de omgekeerde kruising.
 */
export const emaTrend: StrategyDefinition = {
  id: "ema-trend",
  name: "EMA-trend",
  description:
    "Trendvolger: koopt als de snelle EMA boven de trage EMA kruist, alleen boven de lange trend-EMA en bij voldoende trendsterkte (ADX). Verkoopt als de snelle EMA weer onder de trage kruist.",
  defaultParams: { ...DEFAULTS },
  paramSpace: {
    fast: [5, 9, 12],
    slow: [21, 26, 34],
    trend: [50, 100, 200],
    adxMin: [15, 20, 25],
  },
  preferredRegimes: ["trend-up", "trend-down"],

  warmup: warmupOf,

  run(candles: Candle[], params: StrategyParams) {
    const p = resolve(params);
    const n = candles.length;
    const c = closes(candles);
    const f = ema(c, p.fast);
    const s = ema(c, p.slow);
    const t = ema(c, p.trend);
    const ax = adx(candles, ADX_PERIOD).adx;

    const crossUpReason = `EMA ${p.fast} kruist boven EMA ${p.slow}`;
    const confirmReason = `Trend bevestigd: EMA ${p.fast} boven EMA ${p.slow}`;
    const crossDownReason = `EMA ${p.fast} kruist onder EMA ${p.slow}`;
    const idleBelowTrend = `EMA ${p.fast} boven EMA ${p.slow}, maar koers onder EMA ${p.trend}`;
    const idleWeak = `Trend te zwak (ADX < ${nl(p.adxMin, 0)})`;
    const idleBull = `EMA ${p.fast} boven EMA ${p.slow}, geen nieuw signaal`;
    const idleBear = `EMA ${p.fast} onder EMA ${p.slow}`;

    // Interne toestand (alleen verleden): laatste bullish kruising die nog op bevestiging wacht.
    let pendingCross = -1;

    return persistRun("ema-trend", n, warmupOf(params), {
      ready: (i) => i > 0 && finite(f[i], s[i], t[i], ax[i], f[i - 1], s[i - 1]),

      event: (i): SignalEvent | null => {
        const up = f[i - 1] <= s[i - 1] && f[i] > s[i];
        const down = f[i - 1] >= s[i - 1] && f[i] < s[i];
        if (down) {
          pendingCross = -1;
          const strong = c[i] < t[i] && ax[i] >= p.adxMin;
          const conf = strong ? 0.75 + 0.25 * clamp01((ax[i] - p.adxMin) / 20) : 0.6;
          return {
            action: "sell",
            confidence: conf,
            reason: `${crossDownReason} (ADX ${nl(ax[i], 0)})`,
          };
        }
        if (up) pendingCross = i;
        if (pendingCross >= 0 && i - pendingCross > CONFIRM_BARS) pendingCross = -1;
        if (pendingCross >= 0 && f[i] > s[i] && c[i] > t[i] && ax[i] >= p.adxMin) {
          const fresh = pendingCross === i;
          pendingCross = -1;
          const strength = clamp01((ax[i] - p.adxMin) / 20);
          return {
            action: "buy",
            confidence: (fresh ? 0.7 : 0.65) + 0.3 * strength,
            reason: `${fresh ? crossUpReason : confirmReason} (ADX ${nl(ax[i], 0)})`,
          };
        }
        return null;
      },

      valid: (i, action) => (action === "buy" ? f[i] > s[i] && c[i] > t[i] : f[i] < s[i]),

      idle: (i) => {
        if (f[i] <= s[i]) return idleBear;
        if (c[i] <= t[i]) return idleBelowTrend;
        if (ax[i] < p.adxMin) return idleWeak;
        return idleBull;
      },
    });
  },
};
