/**
 * Pure helpers voor de CLI-backtest (`backtest.ts`), los gehouden zodat ze
 * zonder netwerk of terminal getest kunnen worden.
 */
import type { Candle } from "../core/types";

export interface BacktestWindow {
  /** Eerste candle van de gevraagde periode (candles.length als die er niet is) */
  firstInPeriod: number;
  /** Eerste candle waarop gehandeld wordt: nooit vóór de opwarmtijd van de strategieën */
  tradeFromIndex: number;
  /** True als de periode later begint dan gevraagd (te weinig historie vóór de periode) */
  shortened: boolean;
}

/**
 * Waar de backtest mag beginnen: bij de eerste candle van de periode, maar
 * nooit binnen de opwarmtijd (`requiredWarmup` candles, zie
 * `backtestWarmupCandles`). Zelfde regel als de server (/api/backtest): bij een
 * markt met korte historie schuift het begin op in plaats van te "handelen"
 * terwijl de strategieën nog niets kunnen zeggen.
 */
export function backtestWindow(candles: Pick<Candle, "time">[], periodStart: number, requiredWarmup: number): BacktestWindow {
  let firstInPeriod = candles.findIndex((c) => c.time >= periodStart);
  if (firstInPeriod < 0) firstInPeriod = candles.length;
  const warmup = Number.isFinite(requiredWarmup) ? Math.max(0, Math.ceil(requiredWarmup)) : 0;
  const tradeFromIndex = Math.min(candles.length, Math.max(firstInPeriod, warmup));
  return { firstInPeriod, tradeFromIndex, shortened: tradeFromIndex > firstInPeriod };
}

export interface StuckCounts {
  /** Trades waarvan de verkoop eerst geweigerd werd (waarde onder het beursminimum) */
  stuckTrades: number;
  /** Daarvan: aan het einde van de test nog steeds onverkoopbaar */
  stuckAtEnd: number;
  /** Candles dat zo'n positie open stond zonder stop-loss */
  stuckCandles: number;
  /** Beursminimum per order in EUR */
  minOrderQuote: number;
}

function eurNl(x: number): string {
  return `€${x.toFixed(2).replace(".", ",")}`;
}

function count(n: number, one: string, many: string): string {
  return `${n} ${n === 1 ? one : many}`;
}

/**
 * Nederlandse waarschuwing over verkopen die de beurs zou weigeren (positie
 * minder waard dan het beursminimum), of null als dat niet gebeurde. Maakt
 * onderscheid tussen posities die later alsnog verkocht werden en posities die
 * aan het einde van de test nog onverkoopbaar waren (die zijn in het resultaat
 * tegen de laatste slotkoers gewaardeerd, wat in werkelijkheid niet kan).
 */
export function stuckTradesWarning(c: StuckCounts): string | null {
  const total = Math.max(0, Math.floor(c.stuckTrades || 0));
  if (total === 0) return null;
  const atEnd = Math.min(total, Math.max(0, Math.floor(c.stuckAtEnd || 0)));
  const soldLater = total - atEnd;
  const min = eurNl(c.minOrderQuote);
  const parts: string[] = [];
  if (soldLater > 0) {
    parts.push(
      `Let op: bij ${count(soldLater, "trade", "trades")} weigerde de beurs eerst de verkoop: de positie was minder waard ` +
        `dan het beursminimum van ${min}. De positie bleef open zonder stop-loss tot hij weer genoeg waard was en ` +
        `werd later alsnog verkocht.`,
    );
  }
  if (atEnd > 0) {
    const subject =
      soldLater > 0
        ? `Daarnaast ${atEnd === 1 ? "was 1 positie" : `waren ${atEnd} posities`}`
        : `Let op: ${atEnd === 1 ? "1 positie was" : `${atEnd} posities waren`}`;
    parts.push(
      `${subject} aan het einde ` +
        `van de test nog steeds onverkoopbaar (minder waard dan het beursminimum van ${min}). In het resultaat ` +
        `${atEnd === 1 ? "is die" : "zijn die"} tegen de laatste slotkoers gewaardeerd, maar in werkelijkheid kun je ` +
        `pas verkopen als de waarde weer boven ${min} komt (of je schrijft de positie af).`,
    );
  }
  const candles = Math.max(0, Math.floor(c.stuckCandles || 0));
  parts.push(
    `Samen ${count(candles, "candle", "candles")} zonder stop-loss in de markt. Een grotere inleg per trade of een ` +
      `kleinere stop-afstand voorkomt dit.`,
  );
  return parts.join(" ");
}
