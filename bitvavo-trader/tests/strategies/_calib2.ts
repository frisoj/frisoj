import { DEFAULT_ENSEMBLE_CONFIG } from "../../src/core/defaults";
import { STRATEGY_IDS } from "../../src/core/types";
import { runEnsemble } from "../../src/strategies";
import { syntheticSeries, DAY, M15 } from "./fixtures";
const days = 30, n = (days * DAY) / M15 + 200;
const pair: Record<string, number> = {};
const dist: Record<string, number> = {};
let total = 0;
const buyWithSell: Record<string, number> = {}; const buyTot: Record<string, number> = {};
for (const seed of [1,2,3,4,5,6,7,8]) {
  const { candles } = syntheticSeries({ n, seed });
  const ds = runEnsemble("X", candles, DEFAULT_ENSEMBLE_CONFIG);
  for (let i = 200; i < n; i++) {
    total++;
    const v = ds[i].votes;
    const b = v.filter(x => x.action === "buy").map(x=>x.strategy);
    const s = v.filter(x => x.action === "sell").map(x=>x.strategy);
    const key = `${b.length}b${s.length}s`; dist[key] = (dist[key] ?? 0) + 1;
    for (let a = 0; a < b.length; a++) for (let c = a+1; c < b.length; c++) { const k = b[a]+"+"+b[c]; pair[k] = (pair[k]??0)+1; }
    for (const x of b) { buyTot[x] = (buyTot[x]??0)+1; if (s.length) buyWithSell[x] = (buyWithSell[x]??0)+1; }
  }
}
console.log("dist", Object.entries(dist).sort().map(([k,v])=>`${k}:${(100*v/total).toFixed(2)}%`).join(" "));
console.log("pairs (% candles)", Object.entries(pair).map(([k,v])=>`${k}:${(100*v/total).toFixed(2)}`).join("  "));
console.log("buy-with-opposing-sell share", Object.entries(buyTot).map(([k,v])=>`${k}:${(100*(buyWithSell[k]??0)/v).toFixed(0)}%`).join(" "));
