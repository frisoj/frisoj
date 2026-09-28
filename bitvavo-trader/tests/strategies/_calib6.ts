import { DEFAULT_ENSEMBLE_CONFIG } from "../../src/core/defaults";
import { runEnsemble, detectRegimes } from "../../src/strategies";
import { SimulatedFeed } from "../../src/data/simulatedFeed";
import { countEpisodes, DAY, M15 } from "./fixtures";
const now = Date.UTC(2026, 8, 1);
const days = 30;
const out: string[] = [];
let totalEp = 0, totalDays = 0;
for (const seed of [1, 2, 3]) {
  const feed = new SimulatedFeed({ seed, now: () => now });
  for (const m of ["BTC-EUR", "ETH-EUR", "SOL-EUR"]) {
    const cs = await feed.getHistory(m, "15m", now - (days * DAY) - 200 * M15, now);
    const ds = runEnsemble(m, cs, DEFAULT_ENSEMBLE_CONFIG).slice(200);
    const ep = countEpisodes(ds, "buy");
    const regs: Record<string, number> = {}; for (const r of detectRegimes(cs).slice(200)) regs[r] = (regs[r] ?? 0) + 1;
    const atrPct = ds.reduce((a, d) => a + d.atr / d.price, 0) / ds.length * 100;
    out.push(`${seed} ${m} n=${cs.length} buyEp/day=${(ep / days).toFixed(2)} sellEp/day=${(countEpisodes(ds, "sell")/days).toFixed(2)} atr%=${atrPct.toFixed(2)} ${Object.entries(regs).map(([k,v])=>`${k}:${(100*v/ds.length).toFixed(0)}%`).join(" ")}`);
    totalEp += ep; totalDays += days;
  }
}
console.log(out.join("\n"));
console.log("SimulatedFeed avg buy episodes/day:", (totalEp / totalDays).toFixed(2));
