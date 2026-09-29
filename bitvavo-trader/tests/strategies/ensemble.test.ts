import { describe, expect, it } from "vitest";
import { DEFAULT_ENSEMBLE_CONFIG } from "../../src/core/defaults";
import type { EnsembleConfig, EnsembleDecision, Regime } from "../../src/core/types";
import { mulberry32 } from "../../src/core/util";
import {
  OFF_REGIME_WEIGHT,
  STRATEGIES,
  classify,
  decisionsToMarkers,
  latestDecision,
  runEnsemble,
} from "../../src/strategies";
import { DAY, M15, countEpisodes, syntheticCandles } from "./fixtures";

const cfg: EnsembleConfig = DEFAULT_ENSEMBLE_CONFIG;
const candles = syntheticCandles({ n: 2000, seed: 314 });
const decisions = runEnsemble("BTC-EUR", candles, cfg);

function decision(action: EnsembleDecision["action"], score: number, time: number): EnsembleDecision {
  return { market: "X-EUR", time, price: 100 + time, action, score, confidence: Math.abs(score), regime: "range", atr: 1, votes: [] };
}

describe("classify", () => {
  const base: EnsembleConfig = { ...cfg, buyThreshold: 0.35, sellThreshold: -0.3, regimeFilter: false };

  it("drempels", () => {
    expect(classify(0.35, "range", base)).toBe("buy");
    expect(classify(0.9, "trend-up", base)).toBe("buy");
    expect(classify(0.3499, "range", base)).toBe("hold");
    expect(classify(0, "range", base)).toBe("hold");
    expect(classify(-0.2999, "range", base)).toBe("hold");
    expect(classify(-0.3, "range", base)).toBe("sell");
    expect(classify(-1, "trend-down", base)).toBe("sell");
    expect(classify(Number.NaN, "range", base)).toBe("hold");
  });

  it("regimefilter blokkeert alleen kopen in trend-down", () => {
    const f = { ...base, regimeFilter: true };
    expect(classify(0.8, "trend-down", f)).toBe("hold");
    expect(classify(0.8, "trend-down", base)).toBe("buy");
    for (const r of ["trend-up", "range", "volatile", "unknown"] as Regime[]) expect(classify(0.8, r, f)).toBe("buy");
    expect(classify(-0.8, "trend-down", f)).toBe("sell");
  });

  it("verkopen gebruikt de exit-score (alleen actieve stemmen), kopen de gewone score", () => {
    // 5 strategieën, gewichten samen 5,0: één RSI-exitstem (0,6) en vier keer wachten.
    const score = (-1 * 0.6) / 5; // −0,12: zou nooit onder −0,3 komen
    expect(classify(score, "range", base)).toBe("hold"); // zonder exit-score: oud gedrag
    expect(classify(score, "range", base, -0.6)).toBe("sell");
    expect(classify(score, "range", base, -0.2999)).toBe("hold");
    expect(classify(-0.35, "range", base, -0.35)).toBe("sell");
    // Kopen blijft op de brede score, een hoge exit-/actieve score alleen is niet genoeg.
    expect(classify(0.2, "range", base, 0.9)).toBe("hold");
    expect(classify(0.4, "range", base, 0.9)).toBe("buy");
    expect(classify(-0.1, "range", base, Number.NaN)).toBe("hold");
    expect(classify(Number.NaN, "range", base, -1)).toBe("hold");
  });

  it("score 0 is nooit koop, ook niet met drempel 0", () => {
    const zero = { ...base, buyThreshold: 0, sellThreshold: 0 };
    expect(classify(0, "range", zero)).toBe("hold");
    expect(classify(0.01, "range", zero)).toBe("buy");
    expect(classify(-0.01, "range", zero)).toBe("sell");
  });
});

describe("runEnsemble", () => {
  it("één beslissing per candle met consistente velden", () => {
    expect(decisions).toHaveLength(candles.length);
    decisions.forEach((d, i) => {
      expect(d.market).toBe("BTC-EUR");
      expect(d.time).toBe(candles[i].time);
      expect(d.price).toBe(candles[i].close);
      expect(d.score).toBeGreaterThanOrEqual(-1);
      expect(d.score).toBeLessThanOrEqual(1);
      expect(d.confidence).toBeCloseTo(Math.min(1, Math.abs(d.score)), 12);
      expect(d.votes).toHaveLength(cfg.enabled.length);
      expect(d.votes.map((v) => v.strategy)).toEqual(cfg.enabled);
      expect(d.action).toBe(classify(d.score, d.regime, cfg, d.exitScore));
    });
    expect(runEnsemble("BTC-EUR", [], cfg)).toEqual([]);
  });

  it("warmup: hold, score 0, ATR NaN op de eerste candles", () => {
    expect(decisions[0].action).toBe("hold");
    expect(decisions[0].score).toBe(0);
    expect(decisions[0].regime).toBe("unknown");
    expect(Number.isNaN(decisions[0].atr)).toBe(true);
    expect(Number.isFinite(decisions[100].atr)).toBe(true);
  });

  it("score = Σ w·dir·conf / Σ w met halve weging buiten het voorkeursregime", () => {
    for (const filter of [true, false]) {
      const c = { ...cfg, regimeFilter: filter };
      const ds = filter ? decisions : runEnsemble("BTC-EUR", candles, c);
      for (const i of [150, 400, 777, 1234, 1999]) {
        const d = ds[i];
        let num = 0;
        let den = 0;
        for (const v of d.votes) {
          let w = c.weights[v.strategy] ?? 1;
          if (filter && d.regime !== "unknown" && !STRATEGIES[v.strategy].preferredRegimes.includes(d.regime)) w *= OFF_REGIME_WEIGHT;
          den += w;
          num += w * (v.action === "buy" ? 1 : v.action === "sell" ? -1 : 0) * v.confidence;
        }
        expect(d.score).toBeCloseTo(num / den, 12);
      }
    }
  });

  it("exitScore = Σ w·dir·conf / Σ w van alleen de strategieën die niet wachten", () => {
    let checked = 0;
    for (const d of decisions) {
      let num = 0;
      let activeDen = 0;
      for (const v of d.votes) {
        let w = cfg.weights[v.strategy] ?? 1;
        if (cfg.regimeFilter && d.regime !== "unknown" && !STRATEGIES[v.strategy].preferredRegimes.includes(d.regime)) w *= OFF_REGIME_WEIGHT;
        if (v.action === "hold") continue;
        activeDen += w;
        num += w * (v.action === "buy" ? 1 : -1) * v.confidence;
      }
      expect(d.exitScore).toBeCloseTo(activeDen > 0 ? num / activeDen : 0, 12);
      expect(Math.abs(d.exitScore)).toBeGreaterThanOrEqual(Math.abs(d.score) - 1e-12);
      if (activeDen > 0) checked++;
    }
    expect(checked).toBeGreaterThan(100);
  });

  it("één duidelijke exit-stem terwijl de rest wacht → verkoop (werd vroeger weggedrukt door de wachters)", () => {
    const thr = Math.abs(cfg.sellThreshold);
    const single = decisions.filter((d) => {
      const active = d.votes.filter((v) => v.action !== "hold");
      return active.length === 1 && active[0].action === "sell" && active[0].confidence >= thr;
    });
    expect(single.length).toBeGreaterThan(0);
    for (const d of single) expect(d.action).toBe("sell");
    // Onder de oude normalisatie (over alle vijf) haalde zo'n stem de verkoopdrempel niet.
    expect(single.some((d) => d.score > cfg.sellThreshold)).toBe(true);
    // Een zwakke, uitgedoofde exit-stem (confidence onder de drempel) sluit niets.
    const weak = decisions.filter((d) => {
      const active = d.votes.filter((v) => v.action !== "hold");
      return active.length === 1 && active[0].action === "sell" && active[0].confidence < thr - 1e-9;
    });
    for (const d of weak) expect(d.action).toBe("hold");
  });

  it("één strategie met gewicht 1 → score = dir × confidence", () => {
    const single: EnsembleConfig = { ...cfg, enabled: ["ema-trend"], weights: {}, regimeFilter: false };
    const ds = runEnsemble("BTC-EUR", candles, single);
    const sigs = STRATEGIES["ema-trend"].run(candles, STRATEGIES["ema-trend"].defaultParams);
    ds.forEach((d, i) => {
      const dir = sigs[i].action === "buy" ? 1 : sigs[i].action === "sell" ? -1 : 0;
      expect(d.score).toBeCloseTo(dir * sigs[i].confidence, 12);
    });
  });

  it("gebruikt parameter-overrides per strategie", () => {
    const withParams: EnsembleConfig = { ...cfg, enabled: ["breakout"], params: { breakout: { period: 55 } } };
    const ds = runEnsemble("BTC-EUR", candles, withParams);
    const expected = STRATEGIES.breakout.run(candles, { period: 55, exitPeriod: 10, volMult: 1.5 });
    expect(ds.map((d) => d.votes[0])).toEqual(expected);
  });

  it("geen ingeschakelde strategieën → alles hold met score 0", () => {
    const ds = runEnsemble("BTC-EUR", candles.slice(0, 300), { ...cfg, enabled: [] });
    expect(ds.every((d) => d.action === "hold" && d.score === 0 && d.votes.length === 0)).toBe(true);
  });

  it("heeft GEEN lookahead", () => {
    const rand = mulberry32(2024);
    const ks = [1, 50, 150, candles.length];
    for (let j = 0; j < 20; j++) ks.push(1 + Math.floor(rand() * candles.length));
    for (const k of ks) {
      const partial = runEnsemble("BTC-EUR", candles.slice(0, k), cfg);
      expect(partial[k - 1], `k=${k}`).toEqual(decisions[k - 1]);
    }
  });

  it("latestDecision = laatste element van runEnsemble", () => {
    expect(latestDecision("BTC-EUR", candles, cfg)).toEqual(decisions[decisions.length - 1]);
    expect(latestDecision("BTC-EUR", [], cfg)).toBeNull();
  });

  it("is snel: 10k candles × 5 strategieën ruim onder 100 ms", () => {
    const big = syntheticCandles({ n: 10_000, seed: 8 });
    runEnsemble("BTC-EUR", big, cfg); // JIT opwarmen
    let best = Infinity;
    for (let r = 0; r < 3; r++) {
      const t0 = performance.now();
      const out = runEnsemble("BTC-EUR", big, cfg);
      best = Math.min(best, performance.now() - t0);
      expect(out).toHaveLength(10_000);
    }
    console.log(`runEnsemble 10k candles: ${best.toFixed(1)} ms`);
    expect(best).toBeLessThan(100);
  });
});

describe("decisionsToMarkers", () => {
  it("alleen buy/sell, aaneengesloten gelijke acties → één marker, Nederlandse labels", () => {
    const ds = [
      decision("hold", 0, 1),
      decision("buy", 0.52, 2),
      decision("buy", 0.61, 3),
      decision("buy", 0.4, 4),
      decision("hold", 0.1, 5),
      decision("buy", 0.36, 6),
      decision("sell", -0.41, 7),
      decision("sell", -0.5, 8),
      decision("buy", 0.7, 9),
    ];
    const m = decisionsToMarkers(ds);
    expect(m.map((x) => [x.time, x.action])).toEqual([
      [2, "buy"],
      [6, "buy"],
      [7, "sell"],
      [9, "buy"],
    ]);
    expect(m[0]).toEqual({ time: 2, action: "buy", price: 102, score: 0.52, label: "KOOP 0,52" });
    expect(m[2].label).toBe("VERKOOP -0,41");
    expect(decisionsToMarkers([])).toEqual([]);
    expect(decisionsToMarkers([decision("hold", 0, 1)])).toEqual([]);
  });

  it("markers op echte ensemble-output = aantal episodes", () => {
    const m = decisionsToMarkers(decisions);
    expect(m.filter((x) => x.action === "buy")).toHaveLength(countEpisodes(decisions, "buy"));
    expect(m.filter((x) => x.action === "sell")).toHaveLength(countEpisodes(decisions, "sell"));
  });
});

describe("kalibratie (DEFAULT_ENSEMBLE_CONFIG, 15m)", () => {
  it("een handvol koop-episodes per dag: niet constant, niet afwezig", () => {
    const days = 30;
    const n = (days * DAY) / M15;
    const seeds = [1, 2, 3, 4, 5, 6, 7, 8];
    const perDay: number[] = [];
    let buyCandles = 0;
    let sellEpisodes = 0;
    let total = 0;
    for (const seed of seeds) {
      const cs = syntheticCandles({ n: n + 200, seed });
      const ds = runEnsemble("BTC-EUR", cs, cfg).slice(200); // eerste 200 = warmup
      perDay.push(countEpisodes(ds, "buy") / days);
      sellEpisodes += countEpisodes(ds, "sell");
      buyCandles += ds.filter((d) => d.action === "buy").length;
      total += ds.length;
    }
    const avg = perDay.reduce((a, b) => a + b, 0) / perDay.length;
    console.log(
      `kalibratie: koop-episodes/dag gemiddeld ${avg.toFixed(2)} (per seed: ${perDay.map((x) => x.toFixed(2)).join(", ")}), ` +
        `koop-candles ${((100 * buyCandles) / total).toFixed(1)}%, verkoop-episodes/dag ${(sellEpisodes / (days * seeds.length)).toFixed(2)}`,
    );
    expect(avg).toBeGreaterThan(0.75);
    expect(avg).toBeLessThan(6);
    for (const x of perDay) expect(x).toBeGreaterThan(0.1);
    expect(buyCandles / total).toBeLessThan(0.1);
  });
});
