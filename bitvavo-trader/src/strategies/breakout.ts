import type { Candle, StrategyDefinition, StrategyParams } from "../core/types";
import { closes, donchian, sma } from "../indicators";
import { clamp01, finite, intParam, nl, numParam, persistRun, type SignalEvent } from "./common";

const VOLUME_PERIOD = 20;

const DEFAULTS = { period: 20, exitPeriod: 10, volMult: 1.5 };

function resolve(params: StrategyParams) {
  return {
    period: intParam(params, "period", DEFAULTS.period, 2),
    exitPeriod: intParam(params, "exitPeriod", DEFAULTS.exitPeriod, 2),
    volMult: numParam(params, "volMult", DEFAULTS.volMult),
  };
}

function warmupOf(params: StrategyParams): number {
  const p = resolve(params);
  return Math.max(p.period, p.exitPeriod, VOLUME_PERIOD) + 1;
}

/**
 * Donchian-uitbraak: koopt als de koers sluit boven het hoogste punt van de
 * vorige `period` candles én het volume duidelijk boven het gemiddelde ligt.
 * Verkoopt als de koers sluit onder het laagste punt van de vorige
 * `exitPeriod` candles.
 */
export const breakout: StrategyDefinition = {
  id: "breakout",
  name: "Donchian-uitbraak",
  description:
    "Koopt als de koers sluit boven het hoogste punt van de vorige N candles met duidelijk verhoogd volume. Verkoopt als de koers sluit onder het laagste punt van de kortere exit-periode.",
  defaultParams: { ...DEFAULTS },
  paramSpace: {
    period: [20, 30, 55],
    exitPeriod: [10, 20],
    volMult: [1.2, 1.5, 2],
  },
  preferredRegimes: ["trend-up", "volatile"],
  warmup: warmupOf,

  run(candles: Candle[], params: StrategyParams) {
    const p = resolve(params);
    const n = candles.length;
    const c = closes(candles);
    const vol = candles.map((k) => k.volume);
    const volAvg = sma(vol, VOLUME_PERIOD); // gemiddelde t/m candle i; we vergelijken met i-1 (vorige candles)
    const entry = donchian(candles, p.period);
    const exit = donchian(candles, p.exitPeriod);

    const idleNoVolume = `Uitbraak zonder volumebevestiging (< ${nl(p.volMult)}× gemiddeld)`;
    const idleInside = `Koers binnen het ${p.period}-candle kanaal`;

    const volRatio = (i: number) => (volAvg[i - 1] > 0 ? vol[i] / volAvg[i - 1] : 0);
    const above = (i: number) => c[i] > entry.upper[i];
    const confirmed = (i: number) => above(i) && volRatio(i) > p.volMult;
    const below = (i: number) => c[i] < exit.lower[i];

    return persistRun("breakout", n, warmupOf(params), {
      ready: (i) =>
        i > 1 &&
        finite(entry.upper[i], entry.middle[i], exit.lower[i], exit.middle[i], volAvg[i - 1], volAvg[i - 2]) &&
        finite(entry.upper[i - 1], exit.lower[i - 1]),

      event: (i): SignalEvent | null => {
        if (confirmed(i) && !confirmed(i - 1)) {
          const ratio = volRatio(i);
          return {
            action: "buy",
            confidence: 0.7 + 0.3 * clamp01((ratio / p.volMult - 1) / 1),
            reason: `Uitbraak boven ${p.period}-candle high (volume ${nl(ratio)}×)`,
          };
        }
        if (below(i) && !below(i - 1)) {
          const ratio = volRatio(i);
          return {
            action: "sell",
            confidence: ratio > p.volMult ? 0.85 : 0.7,
            reason: `Koers onder ${p.exitPeriod}-candle low`,
          };
        }
        return null;
      },

      valid: (i, action) =>
        action === "buy" ? c[i] > exit.lower[i] && c[i] > entry.middle[i] : c[i] < exit.middle[i],

      idle: (i) => (above(i) ? idleNoVolume : idleInside),
    });
  },
};
