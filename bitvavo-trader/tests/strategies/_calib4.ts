import { DEFAULT_ENSEMBLE_CONFIG } from "../../src/core/defaults";
import { runEnsemble } from "../../src/strategies";
import { syntheticSeries, DAY, M15 } from "./fixtures";
const days = 30, n = (days * DAY) / M15 + 200;
const agg: Record<string, { cnt: number; sum: number; over: number }> = {};
const evConf: Record<string, number[]> = {};
for (const seed of [1,2,3,4,5,6,7,8]) {
  const { candles } = syntheticSeries({ n, seed });
  const ds = runEnsemble("X", candles, DEFAULT_ENSEMBLE_CONFIG);
  for (let i = 200; i < n; i++) {
    const d = ds[i];
    for (const v of d.votes) if (v.action === "buy" && !v.reason.includes("geleden")) (evConf[v.strategy] ??= []).push(v.confidence);
    const b = d.votes.filter(v => v.action === "buy");
    const s = d.votes.filter(v => v.action === "sell");
    if (b.length >= 2 && s.length === 0) {
      const k = `${d.regime} ${b.map(x=>x.strategy).join("+")}`;
      const a = (agg[k] ??= { cnt: 0, sum: 0, over: 0 });
      a.cnt++; a.sum += d.score; if (d.action === "buy") a.over++;
    }
  }
}
for (const [k, a] of Object.entries(agg).sort((x,y)=>y[1].cnt-x[1].cnt).slice(0,20)) console.log(k.padEnd(60), a.cnt, "avgScore", (a.sum/a.cnt).toFixed(3), "buy%", (100*a.over/a.cnt).toFixed(0));
for (const [k, v] of Object.entries(evConf)) { v.sort((a,b)=>a-b); console.log(k.padEnd(16), "event conf p25/p50/p75", v[Math.floor(v.length*.25)].toFixed(2), v[Math.floor(v.length*.5)].toFixed(2), v[Math.floor(v.length*.75)].toFixed(2)); }
