import { STRATEGIES } from "../../src/strategies";
import { syntheticSeries, DAY, M15 } from "./fixtures";
const days = 30, n = (days * DAY) / M15 + 200;
const ids = ["ema-trend", "macd-momentum", "breakout", "rsi-reversion", "vwap-reversion"] as const;
const lagHist: Record<string, number[]> = {};
for (const seed of [1,2,3,4,5,6,7,8]) {
  const { candles } = syntheticSeries({ n, seed });
  const ev: Record<string, number[]> = {};
  for (const id of ids) { const s = STRATEGIES[id].run(candles, STRATEGIES[id].defaultParams); ev[id] = s.map((x, i) => (x.action === "buy" && !x.reason.includes("geleden") ? i : -1)).filter((i) => i >= 0); }
  for (const [a, b] of [["macd-momentum","ema-trend"],["macd-momentum","breakout"],["ema-trend","breakout"],["rsi-reversion","vwap-reversion"]]) {
    for (const i of ev[a]) {
      let best = 999; for (const j of ev[b]) if (Math.abs(j - i) < Math.abs(best)) best = j - i;
      (lagHist[`${a}→${b}`] ??= []).push(best);
    }
  }
}
for (const [k, v] of Object.entries(lagHist)) {
  const buckets: Record<string, number> = {};
  for (const x of v) { const b = x <= -30 ? "<=-30" : x >= 30 ? ">=30" : String(Math.floor(x / 3) * 3); buckets[b] = (buckets[b] ?? 0) + 1; }
  const order = Object.keys(buckets).sort((a, b) => (parseInt(a.replace(/[<>=]/g,"")) - parseInt(b.replace(/[<>=]/g,""))));
  console.log(k.padEnd(34), order.map((b) => `${b}:${(100 * buckets[b] / v.length).toFixed(0)}`).join(" "));
}
