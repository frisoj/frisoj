import type { Candle, ChartIndicators } from "../core/types";
import { ema } from "./movingAverages";
import { macd, rsi } from "./oscillators";
import { closes, toNullable } from "./series";
import { atr, bollinger } from "./volatility";
import { vwap } from "./volume";

/**
 * Alle indicatorreeksen voor de dashboardgrafiek, even lang als `candles`,
 * met null i.p.v. NaN: EMA 9/21/200, Bollinger(20, 2), VWAP, RSI(14),
 * MACD(12, 26, 9) en ATR(14).
 */
export function chartIndicators(candles: ArrayLike<Candle>): ChartIndicators {
  const c = closes(candles);
  const bb = bollinger(c, 20, 2);
  const m = macd(c, 12, 26, 9);
  return {
    emaFast: toNullable(ema(c, 9)),
    emaSlow: toNullable(ema(c, 21)),
    ema200: toNullable(ema(c, 200)),
    bbUpper: toNullable(bb.upper),
    bbMiddle: toNullable(bb.middle),
    bbLower: toNullable(bb.lower),
    vwap: toNullable(vwap(candles)),
    rsi: toNullable(rsi(c, 14)),
    macd: toNullable(m.macd),
    macdSignal: toNullable(m.signal),
    macdHist: toNullable(m.histogram),
    atr: toNullable(atr(candles, 14)),
  };
}
