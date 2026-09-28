import { DEFAULT_ENSEMBLE_CONFIG, DEFAULT_RISK_CONFIG } from "../../src/core/defaults";
import { runBacktest } from "../../src/backtest/backtester";
import { SimulatedFeed } from "../../src/data/simulatedFeed";
import { syntheticCandles, DAY, M15 } from "./fixtures";
const now = Date.UTC(2026, 8, 1);
const days = 60;
const rows: string[] = [];
async function one(label: string, candles: any[]) {
  try {
    const r = runBacktest({ market: "X-EUR", interval: "15m", candles, initialCapital: 50, ensemble: DEFAULT_ENSEMBLE_CONFIG, risk: DEFAULT_RISK_CONFIG, tradeFromIndex: 200 });
    const m = r.metrics;
    const reasons: Record<string, number> = {}; for (const t of r.trades) reasons[t.exitReason] = (reasons[t.exitReason] ?? 0) + 1;
    rows.push(`${label.padEnd(18)} trades/day=${(m.trades/days).toFixed(2)} ret=${m.totalReturnPct.toFixed(1)}% bh=${m.buyHoldReturnPct.toFixed(1)}% win=${m.winRatePct.toFixed(0)}% pf=${m.profitFactor.toFixed(2)} fees=€${m.feesPaid.toFixed(2)} dd=${m.maxDrawdownPct.toFixed(1)}% held=${m.avgCandlesHeld.toFixed(0)} exits=${JSON.stringify(reasons)}`);
  } catch (e) { rows.push(label + " ERROR " + (e as Error).message); }
}
for (const seed of [1, 2, 3]) {
  const feed = new SimulatedFeed({ seed, now: () => now });
  for (const m of ["BTC-EUR", "ETH-EUR", "SOL-EUR"]) await one(`sim${seed} ${m}`, await feed.getHistory(m, "15m", now - days * DAY - 200 * M15, now));
}
for (const seed of [1, 2, 3]) await one(`synth${seed}`, syntheticCandles({ n: days * 96 + 200, seed }));
console.log(rows.join("\n"));
