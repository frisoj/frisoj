import { DEFAULT_ENSEMBLE_CONFIG } from "../../src/core/defaults";
import { runEnsemble, REGIME_THRESHOLDS } from "../../src/strategies";
import { syntheticSeries, countEpisodes, DAY, M15 } from "./fixtures";
const args = process.argv.slice(2).map(Number);
if (args.length >= 2) { REGIME_THRESHOLDS.adxTrend = args[0]; REGIME_THRESHOLDS.minSlopeAtr = args[1]; }
if (args.length >= 3) REGIME_THRESHOLDS.volatileRatio = args[2];
const days = 30, n = (days * DAY) / M15 + 200;
let ep = 0, epNoBlock = 0; const reg: Record<string, number> = {}; let tot = 0;
for (const seed of [1,2,3,4,5,6,7,8]) {
  const { candles } = syntheticSeries({ n, seed });
  const ds = runEnsemble("X", candles, DEFAULT_ENSEMBLE_CONFIG).slice(200);
  ep += countEpisodes(ds, "buy");
  epNoBlock += countEpisodes(ds.map(d => ({ action: d.score >= 0.35 ? "buy" : "x" })), "buy");
  for (const d of ds) { reg[d.regime] = (reg[d.regime] ?? 0) + 1; tot++; }
}
console.log(JSON.stringify(REGIME_THRESHOLDS), "buyEp/day", (ep / (days*8)).toFixed(2), "score>=.35 episodes/day", (epNoBlock/(days*8)).toFixed(2), Object.entries(reg).map(([k,v])=>`${k}:${(100*v/tot).toFixed(0)}%`).join(" "));
