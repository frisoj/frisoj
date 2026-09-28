import { DEFAULT_ENSEMBLE_CONFIG } from "../../src/core/defaults";
import { runEnsemble } from "../../src/strategies";
import { syntheticSeries, DAY, M15 } from "./fixtures";
const days = 30, n = (days * DAY) / M15 + 200;
const opp: Record<string, Record<string, number>> = {}; const tot: Record<string, number> = {};
const sellReasons: Record<string, number> = {};
for (const seed of [1,2,3,4,5,6,7,8]) {
  const { candles } = syntheticSeries({ n, seed });
  const ds = runEnsemble("X", candles, DEFAULT_ENSEMBLE_CONFIG);
  for (let i = 200; i < n; i++) {
    const v = ds[i].votes;
    for (const b of v) if (b.action === "buy") {
      tot[b.strategy] = (tot[b.strategy] ?? 0) + 1;
      for (const s of v) if (s.action === "sell") { (opp[b.strategy] ??= {})[s.strategy] = ((opp[b.strategy] ??= {})[s.strategy] ?? 0) + 1;
        const r = s.reason.replace(/\(.*?\)/g, "").replace(/[\d,]+/g, "#").trim(); sellReasons[r] = (sellReasons[r] ?? 0) + 1; }
    }
  }
}
for (const [b, m] of Object.entries(opp)) console.log(b.padEnd(15), Object.entries(m).map(([s, c]) => `${s}:${(100*c/tot[b]).toFixed(0)}%`).join(" "));
console.log(Object.entries(sellReasons).sort((a,b)=>b[1]-a[1]).slice(0,12));
