import type { Candle, StrategyDefinition, StrategyParams } from "../core/types";
import { bollinger, closes, rsi } from "../indicators";
import { clamp01, finite, intParam, nl, numParam, persistRun, type SignalEvent } from "./common";

/** Na een "uitgerekte" candle mag de RSI binnen zoveel candles omhoog draaien. */
const ARM_BARS = 3;
/** Zonder exit vervalt een eigen trade na zoveel candles. */
const MAX_TRADE_BARS = 96;

const DEFAULTS = { rsiPeriod: 14, oversold: 30, overbought: 70, bbPeriod: 20, bbMult: 2 };

function resolve(params: StrategyParams) {
  return {
    rsiPeriod: intParam(params, "rsiPeriod", DEFAULTS.rsiPeriod, 2),
    oversold: numParam(params, "oversold", DEFAULTS.oversold),
    overbought: numParam(params, "overbought", DEFAULTS.overbought),
    bbPeriod: intParam(params, "bbPeriod", DEFAULTS.bbPeriod, 2),
    bbMult: numParam(params, "bbMult", DEFAULTS.bbMult),
  };
}

function warmupOf(params: StrategyParams): number {
  const p = resolve(params);
  return Math.max(p.rsiPeriod, p.bbPeriod) + 1;
}

/**
 * RSI-terugkeer (mean reversion): koopt na een scherpe daling — RSI onder
 * oversold én slot onder de onderste Bollinger-band — zodra de RSI weer omhoog
 * draait. Verkoopt (exit) bij RSI boven overbought of slot boven de bovenste
 * band. Verkoopsignalen komen alleen na een eigen koop: "overbought" in een
 * gezonde trend is voor een mean-reversion-systeem geen reden om short te
 * denken, en zou de trendstrategieën in het ensemble systematisch wegstemmen.
 */
export const rsiReversion: StrategyDefinition = {
  id: "rsi-reversion",
  name: "RSI-terugkeer",
  description:
    "Mean reversion: koopt na een scherpe daling (RSI onder oversold én koers onder de onderste Bollinger-band) zodra de RSI weer omhoog draait. Verkoopt (exit) bij RSI boven overbought of koers boven de bovenste band.",
  defaultParams: { ...DEFAULTS },
  paramSpace: {
    rsiPeriod: [7, 14, 21],
    oversold: [25, 30, 35],
    overbought: [65, 70, 75],
    bbPeriod: [20, 30],
    bbMult: [1.8, 2, 2.5],
  },
  preferredRegimes: ["range"],
  warmup: warmupOf,

  run(candles: Candle[], params: StrategyParams) {
    const p = resolve(params);
    const n = candles.length;
    const c = closes(candles);
    const r = rsi(c, p.rsiPeriod);
    const bb = bollinger(c, p.bbPeriod, p.bbMult);
    const lower = bb.lower;
    const upper = bb.upper;
    const middle = bb.middle;

    const idleOversold = `RSI onder ${nl(p.oversold, 0)}, wacht op omslag`;
    const idle = "Geen extreem (RSI en Bollinger neutraal)";

    // Interne toestand (alleen verleden)
    let armedAt = -1; // laatste candle met RSI < oversold én slot < onderste band
    let minRsi = 100; // laagste RSI in de huidige setup
    let firedAt = -1; // laatste koop-event
    let reset = true; // na een koop pas opnieuw "armen" als de RSI eerst boven oversold is geweest
    let inTrade = false; // eigen mean-reversion-trade loopt (wacht op exit)
    const overheated = (i: number) => r[i] > p.overbought || c[i] > upper[i];

    return persistRun("rsi-reversion", n, warmupOf(params), {
      ready: (i) => i > 0 && finite(r[i], r[i - 1], lower[i], upper[i], middle[i]),

      event: (i): SignalEvent | null => {
        // Setup bijhouden
        if (!reset && r[i] >= p.oversold) reset = true;
        if (reset && r[i] < p.oversold && c[i] < lower[i]) {
          const newSetup = armedAt < 0 || i - armedAt > ARM_BARS || firedAt > armedAt;
          minRsi = newSetup ? r[i] : Math.min(minRsi, r[i]);
          armedAt = i;
        }
        const armed = armedAt >= 0 && i - armedAt <= ARM_BARS && firedAt < armedAt;
        if (armed && r[i] > r[i - 1]) {
          firedAt = i;
          reset = false;
          inTrade = true;
          const depth = clamp01((p.oversold - minRsi) / 15);
          return {
            action: "buy",
            confidence: 0.8 + 0.2 * depth,
            reason: `RSI ${nl(r[i])} draait omhoog na daling onder onderste Bollinger-band`,
          };
        }
        // Exit van de eigen trade: overbought of boven de bovenste band
        if (inTrade && i - firedAt > MAX_TRADE_BARS) inTrade = false;
        if (inTrade && overheated(i)) {
          inTrade = false;
          const rsiHot = r[i] > p.overbought;
          const bandHot = c[i] > upper[i];
          const conf = 0.6 + (rsiHot && bandHot ? 0.2 : 0) + 0.2 * clamp01((r[i] - p.overbought) / 15);
          const reason =
            rsiHot && bandHot
              ? `RSI ${nl(r[i])} overbought en koers boven bovenste band`
              : rsiHot
                ? `RSI ${nl(r[i])} boven ${nl(p.overbought, 0)} (overbought)`
                : "Koers boven bovenste Bollinger-band";
          // Exit (doel bereikt), geen bearish visie: korte nawerking
          return { action: "sell", confidence: conf, reason, decayBars: 2 };
        }
        return null;
      },

      // Koop blijft geldig tot de koers terug bij het gemiddelde is; verkoop zolang hij erboven blijft.
      valid: (i, action) => (action === "buy" ? c[i] < middle[i] : c[i] > middle[i]),

      idle: (i) => (r[i] < p.oversold ? idleOversold : idle),
    });
  },
};
