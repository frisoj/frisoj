import { describe, expect, it } from "vitest";
import type { Candle, StrategyDefinition, StrategyParams, StrategySignal } from "../../src/core/types";
import { STRATEGY_IDS } from "../../src/core/types";
import { mulberry32 } from "../../src/core/util";
import {
  STRATEGIES,
  breakout,
  emaTrend,
  getStrategy,
  listStrategies,
  macdMomentum,
  resolveParams,
  rsiReversion,
  vwapReversion,
} from "../../src/strategies";
import { candlesFromCloses, driftCloses, rangeCloses, syntheticCandles } from "./fixtures";

const ALL: StrategyDefinition[] = STRATEGY_IDS.map((id) => STRATEGIES[id]);
const series = syntheticCandles({ n: 1500, seed: 42 });

function actionsIn(sigs: StrategySignal[], from: number, to: number, action: string): number[] {
  const out: number[] = [];
  for (let i = from; i < Math.min(to, sigs.length); i++) if (sigs[i].action === action) out.push(i);
  return out;
}

/** Willekeurige parametercombinatie uit de paramSpace (deterministisch). */
function randomParams(def: StrategyDefinition, seed: number): StrategyParams {
  const rand = mulberry32(seed);
  const p: StrategyParams = {};
  for (const [k, values] of Object.entries(def.paramSpace)) p[k] = values[Math.floor(rand() * values.length)];
  return p;
}

describe("strategie-registry", () => {
  it("bevat alle vijf strategieën met kloppende ids", () => {
    expect(Object.keys(STRATEGIES).sort()).toEqual([...STRATEGY_IDS].sort());
    for (const id of STRATEGY_IDS) expect(getStrategy(id).id).toBe(id);
    expect(() => getStrategy("bestaat-niet" as never)).toThrow(/Onbekende strategie/);
  });

  it("listStrategies is JSON-veilig en zonder functies", () => {
    const list = listStrategies();
    expect(list).toHaveLength(5);
    const roundTrip = JSON.parse(JSON.stringify(list));
    expect(roundTrip).toEqual(list);
    for (const meta of list) {
      expect(Object.values(meta).some((v) => typeof v === "function")).toBe(false);
      expect(meta.name.length).toBeGreaterThan(0);
      expect(meta.description.length).toBeGreaterThan(20);
      expect(meta.preferredRegimes.length).toBeGreaterThan(0);
    }
    // Kopieën: muteren raakt de definities niet
    list[0].defaultParams.x = 1;
    expect(STRATEGIES[list[0].id].defaultParams.x).toBeUndefined();
  });

  it("paramSpace: 2–4 waarden per parameter, inclusief de standaardwaarde", () => {
    for (const def of ALL) {
      expect(Object.keys(def.paramSpace).sort()).toEqual(Object.keys(def.defaultParams).sort());
      for (const [k, values] of Object.entries(def.paramSpace)) {
        expect(values.length, `${def.id}.${k}`).toBeGreaterThanOrEqual(2);
        expect(values.length, `${def.id}.${k}`).toBeLessThanOrEqual(4);
        expect(values, `${def.id}.${k}`).toContain(def.defaultParams[k]);
      }
    }
  });

  it("resolveParams voegt overrides samen en negeert onzin", () => {
    expect(resolveParams("ema-trend")).toEqual({ fast: 9, slow: 21, trend: 100, adxMin: 20 });
    expect(resolveParams("ema-trend", { fast: 5, bogus: 3, slow: Number.NaN })).toEqual({
      fast: 5,
      slow: 21,
      trend: 100,
      adxMin: 20,
    });
    expect(resolveParams("macd-momentum", {})).toEqual({ fast: 12, slow: 26, signal: 9 });
    expect(resolveParams("breakout")).toEqual({ period: 20, exitPeriod: 10, volMult: 1.5 });
    expect(resolveParams("rsi-reversion")).toEqual({ rsiPeriod: 14, oversold: 30, overbought: 70, bbPeriod: 20, bbMult: 2 });
    expect(resolveParams("vwap-reversion")).toEqual({ devAtr: 1.5, rsiMax: 40 });
  });
});

describe.each(ALL.map((d) => [d.id, d] as const))("strategie %s", (_id, def) => {
  const params = def.defaultParams;
  const sigs = def.run(series, params);

  it("geeft precies één signaal per candle met geldige velden", () => {
    expect(sigs).toHaveLength(series.length);
    for (const s of sigs) {
      expect(s.strategy).toBe(def.id);
      expect(["buy", "sell", "hold"]).toContain(s.action);
      expect(s.confidence).toBeGreaterThanOrEqual(0);
      expect(s.confidence).toBeLessThanOrEqual(1);
      expect(typeof s.reason).toBe("string");
      expect(s.reason.length).toBeGreaterThan(0);
      if (s.action === "hold") expect(s.confidence).toBe(0);
      else expect(s.confidence).toBeGreaterThanOrEqual(0.3 - 1e-9);
    }
  });

  it("geeft 'hold' tijdens de warmup en werkt met lege/korte invoer", () => {
    const w = def.warmup(params);
    expect(w).toBeGreaterThan(0);
    for (let i = 0; i < Math.min(w, sigs.length); i++) expect(sigs[i].action).toBe("hold");
    expect(def.run([], params)).toEqual([]);
    const short = def.run(series.slice(0, 5), params);
    expect(short).toHaveLength(5);
    expect(short.every((s) => s.action === "hold")).toBe(true);
  });

  it("geeft ook koop- én verkoopsignalen (niet constant)", () => {
    const buys = sigs.filter((s) => s.action === "buy").length;
    const holds = sigs.filter((s) => s.action === "hold").length;
    expect(buys).toBeGreaterThan(0);
    expect(holds).toBeGreaterThan(series.length * 0.3);
    expect(sigs.some((s) => s.action === "sell")).toBe(true);
  });

  it("heeft GEEN lookahead: run(candles[0..k))[k-1] === run(candles)[k-1]", () => {
    const rand = mulberry32(1234 + def.id.length);
    const ks = [1, 2, def.warmup(params), def.warmup(params) + 1, series.length];
    for (let j = 0; j < 30; j++) ks.push(1 + Math.floor(rand() * series.length));
    for (const k of ks) {
      const partial = def.run(series.slice(0, k), params);
      expect(partial[k - 1], `k=${k}`).toEqual(sigs[k - 1]);
    }
  });

  it("heeft GEEN lookahead met andere parameters uit de paramSpace", () => {
    const p = randomParams(def, 99);
    const full = def.run(series, p);
    const rand = mulberry32(777);
    for (let j = 0; j < 15; j++) {
      const k = 1 + Math.floor(rand() * series.length);
      expect(def.run(series.slice(0, k), p)[k - 1], `k=${k}`).toEqual(full[k - 1]);
    }
  });

  it("vers event geeft hoge confidence die daarna afneemt", () => {
    // Zoek een event (niet-hold na hold) en controleer het verval erna.
    let checked = 0;
    for (let i = 1; i < sigs.length - 1 && checked < 5; i++) {
      const prev = sigs[i - 1];
      const cur = sigs[i];
      const next = sigs[i + 1];
      if (cur.action !== "hold" && prev.action === "hold" && next.action === cur.action) {
        expect(cur.confidence).toBeGreaterThanOrEqual(0.55);
        if (!next.reason.includes("geleden")) continue; // nieuw event
        expect(next.confidence).toBeLessThan(cur.confidence);
        checked++;
      }
    }
    expect(checked).toBeGreaterThan(0);
  });

  it("verloopt naar 'hold' binnen enkele candles na een event", () => {
    // Geen enkele niet-hold-reeks mag zonder nieuw event langer dan 7 candles duren.
    let run = 0;
    for (const s of sigs) {
      if (s.action !== "hold" && s.reason.includes("geleden")) run++;
      else run = 0;
      expect(run).toBeLessThanOrEqual(6);
    }
  });
});

describe("ema-trend", () => {
  it("koopt in een schone opwaartse trend", () => {
    // Zijwaarts, korte dip, dan een duidelijke stijgende trend
    const closes = [
      ...rangeCloses(150, 100, 0.4, 0.1, 3),
      ...driftCloses(10, 99.6, -0.25, 0.05, 4),
      ...driftCloses(150, 97.2, 0.3, 0.08, 5),
    ];
    const candles = candlesFromCloses(closes, { wickPct: 0.0015 });
    const sigs = emaTrend.run(candles, emaTrend.defaultParams);
    const buys = actionsIn(sigs, 160, 200, "buy");
    expect(buys.length).toBeGreaterThan(0);
    expect(actionsIn(sigs, 175, 310, "sell")).toEqual([]);
    const first = sigs[buys[0]];
    expect(first.confidence).toBeGreaterThanOrEqual(0.65);
    expect(first.reason).toMatch(/EMA 9/);
    expect(first.reason).toMatch(/ADX \d+/);
  });

  it("verkoopt in een neerwaartse trend en koopt daar niet", () => {
    const closes = [...rangeCloses(150, 100, 0.4, 0.1, 6), ...driftCloses(150, 100, -0.3, 0.08, 8)];
    const candles = candlesFromCloses(closes, { wickPct: 0.0015 });
    const sigs = emaTrend.run(candles, emaTrend.defaultParams);
    expect(actionsIn(sigs, 150, 190, "sell").length).toBeGreaterThan(0);
    expect(actionsIn(sigs, 160, 300, "buy")).toEqual([]);
    const s = sigs[actionsIn(sigs, 150, 190, "sell")[0]];
    expect(s.reason).toMatch(/kruist onder/);
  });

  it("negeert een bullish kruising onder de lange trend-EMA", () => {
    // Lange daling, kleine opleving: EMA 9 kruist boven EMA 21 maar koers < EMA 100
    const closes = [...driftCloses(200, 100, -0.2, 0.05, 9), ...driftCloses(15, 67, 0.25, 0.03, 10)];
    const candles = candlesFromCloses(closes);
    const sigs = emaTrend.run(candles, emaTrend.defaultParams);
    expect(actionsIn(sigs, 200, 215, "buy")).toEqual([]);
  });
});

describe("rsi-reversion", () => {
  it("koopt na een scherpe daling zodra de RSI omhoog draait", () => {
    const closes = [
      ...rangeCloses(100, 100, 0.4, 0.1, 21),
      ...driftCloses(6, 99, -1.5, 0.0, 22),
      ...driftCloses(10, 90.5, 0.3, 0.05, 23),
    ];
    const candles = candlesFromCloses(closes);
    const sigs = rsiReversion.run(candles, rsiReversion.defaultParams);
    const buys = actionsIn(sigs, 100, 116, "buy");
    expect(buys.length).toBeGreaterThan(0);
    expect(buys[0]).toBeGreaterThanOrEqual(106); // pas na de omslag, niet tijdens de val
    expect(buys[0]).toBeLessThanOrEqual(109);
    expect(sigs[buys[0]].confidence).toBeGreaterThanOrEqual(0.7);
    expect(sigs[buys[0]].reason).toMatch(/RSI \d+,\d draait omhoog/);
    expect(actionsIn(sigs, 100, 106, "buy")).toEqual([]);
  });

  it("verkoopt bij overbought / boven de bovenste band", () => {
    const closes = [...rangeCloses(100, 100, 0.4, 0.1, 31), ...driftCloses(8, 100.5, 1.2, 0, 32)];
    const sigs = rsiReversion.run(candlesFromCloses(closes), rsiReversion.defaultParams);
    expect(actionsIn(sigs, 100, 108, "sell").length).toBeGreaterThan(0);
  });
});

describe("breakout", () => {
  function scenario(breakoutVolume: number): Candle[] {
    const closes = [...rangeCloses(60, 100, 0.8, 0.05, 41), 103, 103.5, 103.2];
    const volume = closes.map((_, i) => (i === 60 ? breakoutVolume : 100));
    return candlesFromCloses(closes, { volume });
  }

  it("koopt op een uitbraak met hoog volume", () => {
    const sigs = breakout.run(scenario(300), breakout.defaultParams);
    expect(sigs[60].action).toBe("buy");
    expect(sigs[60].confidence).toBeGreaterThanOrEqual(0.7);
    expect(sigs[60].reason).toMatch(/Uitbraak boven 20-candle high/);
    expect(sigs[61].action).toBe("buy"); // mening blijft even staan
    expect(sigs[61].confidence).toBeLessThan(sigs[60].confidence);
    expect(actionsIn(sigs, 21, 60, "buy")).toEqual([]);
  });

  it("koopt NIET op een uitbraak met laag volume", () => {
    const sigs = breakout.run(scenario(100), breakout.defaultParams);
    expect(sigs[60].action).toBe("hold");
    expect(sigs[60].reason).toMatch(/volume/);
    expect(actionsIn(sigs, 21, sigs.length, "buy")).toEqual([]);
  });

  it("verkoopt onder de exit-low", () => {
    const closes = [...rangeCloses(60, 100, 0.8, 0.05, 41), 103, 103.5, 101, 98.5, 97];
    const volume = closes.map((_, i) => (i === 60 ? 300 : 100));
    const sigs = breakout.run(candlesFromCloses(closes, { volume }), breakout.defaultParams);
    expect(actionsIn(sigs, 62, closes.length, "sell").length).toBeGreaterThan(0);
  });
});

describe("macd-momentum", () => {
  it("koopt als momentum na een terugval boven EMA 50 hervat", () => {
    const closes = [
      ...driftCloses(120, 100, 0.15, 0.05, 51),
      ...driftCloses(12, 119.5, -0.2, 0.03, 52),
      ...driftCloses(30, 116.7, 0.35, 0.03, 53),
    ];
    const sigs = macdMomentum.run(candlesFromCloses(closes), macdMomentum.defaultParams);
    const buys = actionsIn(sigs, 132, 162, "buy");
    expect(buys.length).toBeGreaterThan(0);
    expect(sigs[buys[0]].reason).toMatch(/MACD kruist boven/);
    // De terugval zelf geeft een verkoopsignaal
    expect(actionsIn(sigs, 120, 134, "sell").length).toBeGreaterThan(0);
  });

  it("koopt niet onder EMA 50", () => {
    const closes = [...driftCloses(120, 100, -0.2, 0.05, 54), ...driftCloses(10, 78, 0.3, 0.03, 55)];
    const sigs = macdMomentum.run(candlesFromCloses(closes), macdMomentum.defaultParams);
    expect(actionsIn(sigs, 120, 130, "buy")).toEqual([]);
  });
});

describe("vwap-reversion", () => {
  it("koopt ver onder de VWAP als de RSI omhoog draait en verkoopt terug bij de VWAP", () => {
    const closes = [
      ...rangeCloses(40, 100, 0.15, 0.05, 61),
      ...driftCloses(5, 99.8, -0.8, 0, 62),
      ...driftCloses(30, 96.6, 0.25, 0.02, 63),
    ];
    const sigs = vwapReversion.run(candlesFromCloses(closes), vwapReversion.defaultParams);
    const buys = actionsIn(sigs, 40, 50, "buy");
    expect(buys.length).toBeGreaterThan(0);
    expect(sigs[buys[0]].reason).toMatch(/ATR onder VWAP/);
    const sells = actionsIn(sigs, 46, closes.length, "sell");
    expect(sells.length).toBeGreaterThan(0);
    expect(sigs[sells[0]].reason).toMatch(/terug bij VWAP/);
  });

  it("geeft in een rustige markt rond de VWAP geen signalen", () => {
    const sigs = vwapReversion.run(candlesFromCloses(rangeCloses(90, 100, 0.1, 0.02, 64)), vwapReversion.defaultParams);
    expect(sigs.every((s) => s.action === "hold")).toBe(true);
  });
});
