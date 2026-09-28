import type { Candle, StrategyDefinition, StrategyParams } from "../core/types";
import { atr, closes, rsi, vwap } from "../indicators";
import { clamp01, finite, nl, numParam, persistRun, type SignalEvent } from "./common";

const ATR_PERIOD = 14;
const RSI_PERIOD = 14;
/** Na een uitgerekte candle mag de RSI binnen zoveel candles omhoog draaien. */
const ARM_BARS = 2;
/** Na zoveel candles zonder terugkeer naar de VWAP vervalt de setup. */
const MAX_TRADE_BARS = 48;
const DAY_MS = 86_400_000;

const DEFAULTS = { devAtr: 1.5, rsiMax: 40 };

function resolve(params: StrategyParams) {
  return {
    devAtr: Math.max(0.1, numParam(params, "devAtr", DEFAULTS.devAtr)),
    rsiMax: numParam(params, "rsiMax", DEFAULTS.rsiMax),
  };
}

function warmupOf(_params: StrategyParams): number {
  return Math.max(ATR_PERIOD, RSI_PERIOD) + 1;
}

/**
 * VWAP-terugkeer: koopt als de koers `devAtr` × ATR onder de dag-VWAP staat
 * (sessie start 00:00 UTC) en de RSI omhoog draait; verkoopt zodra de koers
 * weer bij of boven de VWAP is.
 */
export const vwapReversion: StrategyDefinition = {
  id: "vwap-reversion",
  name: "VWAP-terugkeer",
  description:
    "Intraday mean reversion: koopt als de koers ver (k × ATR) onder de dag-VWAP staat en de RSI omhoog draait. Verkoopt zodra de koers terug bij de VWAP is.",
  defaultParams: { ...DEFAULTS },
  paramSpace: {
    devAtr: [1, 1.5, 2],
    rsiMax: [35, 40, 45],
  },
  preferredRegimes: ["range"],
  warmup: warmupOf,

  run(candles: Candle[], params: StrategyParams) {
    const p = resolve(params);
    const n = candles.length;
    const c = closes(candles);
    const vw = vwap(candles);
    const a = atr(candles, ATR_PERIOD);
    const r = rsi(c, RSI_PERIOD);

    const idleStretched = `Koers ver onder VWAP, wacht op RSI-omslag`;
    const idleBelow = "Koers onder VWAP, niet ver genoeg";
    const idleAbove = "Koers boven VWAP";

    // Interne toestand (alleen verleden)
    let session = -1;
    let armedAt = -1; // laatste candle met koers >= devAtr × ATR onder VWAP
    let maxDev = 0; // grootste afwijking in de huidige setup (in ATR)
    let firedAt = -1; // laatste koop-event
    let inTrade = false; // wacht op terugkeer naar de VWAP

    const dev = (i: number) => (a[i] > 0 ? (vw[i] - c[i]) / a[i] : 0);

    return persistRun("vwap-reversion", n, warmupOf(params), {
      ready: (i) => i > 0 && finite(vw[i], a[i], r[i], r[i - 1]),

      event: (i): SignalEvent | null => {
        const day = Math.floor(candles[i].time / DAY_MS);
        if (day !== session) {
          // Nieuwe VWAP-sessie: oude setup telt niet meer.
          session = day;
          armedAt = -1;
          inTrade = false;
        }
        if (inTrade && c[i] >= vw[i]) {
          inTrade = false;
          // Exit (doel bereikt), geen bearish visie: korte nawerking
          return { action: "sell", confidence: 0.6, reason: "Koers terug bij VWAP (doel bereikt)", decayBars: 2 };
        }
        if (inTrade && i - firedAt > MAX_TRADE_BARS) inTrade = false;

        const d = dev(i);
        if (d >= p.devAtr) {
          const newSetup = armedAt < 0 || i - armedAt > ARM_BARS || firedAt > armedAt;
          maxDev = newSetup ? d : Math.max(maxDev, d);
          armedAt = i;
        }
        const armed = !inTrade && armedAt >= 0 && i - armedAt <= ARM_BARS && firedAt < armedAt;
        if (armed && r[i] > r[i - 1] && r[i - 1] <= p.rsiMax) {
          firedAt = i;
          inTrade = true;
          return {
            action: "buy",
            confidence: 0.7 + 0.3 * clamp01((maxDev - p.devAtr) / p.devAtr),
            reason: `Koers ${nl(maxDev)}× ATR onder VWAP, RSI ${nl(r[i])} draait omhoog`,
          };
        }
        return null;
      },

      valid: (i, action) => (action === "buy" ? c[i] < vw[i] : c[i] >= vw[i]),

      idle: (i) => {
        const d = dev(i);
        if (d >= p.devAtr) return idleStretched;
        return d > 0 ? idleBelow : idleAbove;
      },
    });
  },
};
