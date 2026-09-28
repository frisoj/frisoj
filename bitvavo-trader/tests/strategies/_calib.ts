import { DEFAULT_ENSEMBLE_CONFIG } from "../../src/core/defaults";
import { STRATEGY_IDS } from "../../src/core/types";
import { STRATEGIES, runEnsemble, detectRegimes } from "../../src/strategies";
import { syntheticSeries, countEpisodes, DAY, M15 } from "./fixtures";

const days = 30, n = (days * DAY) / M15 + 200;
const seeds = [1,2,3,4,5,6,7,8];
const ev: Record<string, {buy:number; sell:number; buyC:number; sellC:number}> = {};
for (const id of STRATEGY_IDS) ev[id] = {buy:0,sell:0,buyC:0,sellC:0};
const regimeCount: Record<string, number> = {};
const truthVsDet: Record<string, Record<string, number>> = {};
const scoreHist: number[] = new Array(21).fill(0);
let buyEp = 0, total = 0, maxScore = 0;
const cfg = { ...DEFAULT_ENSEMBLE_CONFIG, ...(process.env.NOFILTER ? { regimeFilter: false } : {}) };
for (const seed of seeds) {
  const { candles, regimes: truth } = syntheticSeries({ n, seed });
  const ds = runEnsemble("X", candles, cfg);
  const reg = detectRegimes(candles);
  for (let i = 200; i < n; i++) {
    total++;
    regimeCount[reg[i]] = (regimeCount[reg[i]] ?? 0) + 1;
    (truthVsDet[truth[i]] ??= {})[reg[i]] = ((truthVsDet[truth[i]] ??= {})[reg[i]] ?? 0) + 1;
    const s = ds[i].score; maxScore = Math.max(maxScore, s);
    scoreHist[Math.round((s + 1) * 10)]++;
    ds[i].votes.forEach((v) => {
      if (v.action === "buy") { ev[v.strategy].buyC++; if (!v.reason.includes("geleden")) ev[v.strategy].buy++; }
      if (v.action === "sell") { ev[v.strategy].sellC++; if (!v.reason.includes("geleden")) ev[v.strategy].sell++; }
    });
  }
  buyEp += countEpisodes(ds.slice(200), "buy");
}
const d = days * seeds.length;
console.log("buy episodes/day", (buyEp / d).toFixed(2));
for (const id of STRATEGY_IDS) console.log(id.padEnd(16), "buyEv/day", (ev[id].buy/d).toFixed(2), "sellEv/day", (ev[id].sell/d).toFixed(2), "buy%", (100*ev[id].buyC/total).toFixed(1), "sell%", (100*ev[id].sellC/total).toFixed(1));
console.log("regimes", Object.fromEntries(Object.entries(regimeCount).map(([k,v]) => [k, (100*v/total).toFixed(1)+"%"])));
console.log("truth→detected", JSON.stringify(truthVsDet));
console.log("score hist (-1..1 step .1)", scoreHist.map((x,i)=>`${((i-10)/10).toFixed(1)}:${(100*x/total).toFixed(1)}`).join(" "));
console.log("max score", maxScore.toFixed(3));
