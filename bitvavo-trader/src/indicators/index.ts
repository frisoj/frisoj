/**
 * Technische indicatoren. Alle functies zijn puur, O(n), en geven arrays van
 * dezelfde lengte als de invoer terug met NaN tijdens de warmup.
 * Een periode < 1 (of niet-eindig) gooit een Error; periode > lengte → alles NaN.
 */
export { sma, ema, rma, stdev } from "./movingAverages";
export { rollingMax, rollingMin } from "./rolling";
export { rsi, macd, stochastic } from "./oscillators";
export type { MacdResult, StochasticResult } from "./oscillators";
export { atr, trueRange, bollinger, donchian } from "./volatility";
export type { BollingerResult, DonchianResult } from "./volatility";
export { adx } from "./trend";
export type { AdxResult } from "./trend";
export { vwap, obv } from "./volume";
export { closes, highs, lows, toNullable } from "./series";
export { chartIndicators } from "./chart";
