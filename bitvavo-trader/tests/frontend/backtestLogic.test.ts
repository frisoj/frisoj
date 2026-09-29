import { beforeAll, describe, expect, it } from "vitest";
import { maxDrawdownPct } from "../../src/backtest/metrics";
import { loadPublic, type Fake } from "./helpers";

let L: Fake;
beforeAll(async () => {
  L = await loadPublic("js/panels/backtestLogic.js");
});

const IDS = new Set(["ema-trend", "rsi-reversion", "breakout", "macd-momentum", "vwap-reversion"]);
const STRATS = [
  { id: "ema-trend", defaultParams: { fast: 9, slow: 21, trend: 200, adxMin: 20 } },
  { id: "rsi-reversion", defaultParams: {} },
  { id: "breakout", defaultParams: { lookback: 20 } },
  { id: "macd-momentum", defaultParams: {} },
  { id: "vwap-reversion", defaultParams: {} },
];
const botConfig = () => ({
  markets: ["BTC-EUR"],
  interval: "15m",
  ensemble: {
    enabled: ["rsi-reversion", "breakout", "macd-momentum", "vwap-reversion"],
    weights: { "ema-trend": 0, "rsi-reversion": 1, breakout: 1, "macd-momentum": 1, "vwap-reversion": 0.8 },
    params: {},
    buyThreshold: 0.35,
    sellThreshold: -0.3,
    regimeFilter: true,
  },
  risk: { stopAtrMult: 2, takeProfitR: 2, riskPerTradePct: 1.5, maxPositionPct: 45 },
});

describe("quality('dd') — max. drawdown is ≤ 0 volgens het contract", () => {
  it("beoordeelt de grootte van de drawdown, niet het teken", () => {
    const q = (dd: number) => L.quality("dd", { maxDrawdownPct: dd }, 50);
    expect(q(-5)).toBe("good");
    expect(q(-15)).toBe("warn");
    expect(q(-45)).toBe("bad");
    expect(q(-83.33)).toBe("bad");
    // positieve conventie werkt ook
    expect(q(5)).toBe("good");
    expect(q(45)).toBe("bad");
  });

  it("gebruikt de echte maxDrawdownPct() uit metrics.ts", () => {
    const dd = maxDrawdownPct([100, 55]);
    expect(dd).toBeLessThan(0);
    expect(L.quality("dd", { maxDrawdownPct: dd }, 100)).toBe("bad");
    expect(L.quality("dd", { maxDrawdownPct: maxDrawdownPct([100, 95]) }, 100)).toBe("good");
  });

  it("een ontbrekende waarde is neutraal, niet goed of slecht", () => {
    expect(L.quality("dd", {}, 50)).toBe("neutral");
    expect(L.quality("dd", { maxDrawdownPct: null }, 50)).toBe("neutral");
    expect(L.quality("dd", { maxDrawdownPct: NaN }, 50)).toBe("neutral");
  });
});

describe("optimizer: afgestrafte rijen (te weinig trades)", () => {
  const penalized = { params: { "ensemble.buyThreshold": 0.25 }, score: -1e9, metrics: { trades: 0 } };
  const good = { params: { "ensemble.buyThreshold": 0.35 }, score: 1.2, metrics: { trades: 12 } };

  it("best = null wordt nooit vervangen door een afgestrafte rij", () => {
    expect(L.bestScoredRow({ best: null, rows: [penalized, penalized] })).toBeNull();
    expect(L.bestScoredRow({ best: penalized, rows: [penalized] })).toBeNull();
    expect(L.bestScoredRow({ best: good, rows: [good, penalized] })).toBe(good);
  });

  it("isScoredRow herkent de strafscore van de server", () => {
    expect(L.isScoredRow({ score: -1e9 })).toBe(false);
    expect(L.isScoredRow({ score: -0.5 })).toBe(true);
    expect(L.isScoredRow({ score: NaN })).toBe(false);
    expect(L.isScoredRow(null)).toBe(false);
  });

  it("de scorebalkjes worden geschaald op geldige rijen (niet op 1e9)", () => {
    expect(L.scoreBarMax([good, penalized, { ...good, score: -0.6 }])).toBeCloseTo(1.2);
    expect(L.scoreBarMax([penalized])).toBeLessThan(1e-6);
  });
});

describe("toepassen: de getest configuratie, niet alleen de grid-parameters", () => {
  it("scenario A: strategie uit in de bot → wordt aangezet met gewicht ≥ 1, plus haar parameters", () => {
    const cfg = botConfig();
    const req = {
      strategy: "ema-trend",
      ensemble: { enabled: [...cfg.ensemble.enabled], buyThreshold: 0.35, sellThreshold: -0.3 },
      risk: { stopAtrMult: 2, takeProfitR: 2, riskPerTradePct: 1.5 },
    };
    const row = { params: { "ema-trend.fast": 12, "ema-trend.slow": 26, "ema-trend.trend": 200, "ema-trend.adxMin": 20 }, score: 1 };
    const p = L.testedPartial(row, req, cfg, IDS);
    expect(p.ensemble.enabled).toContain("ema-trend");
    expect(p.ensemble.weights["ema-trend"]).toBe(1);
    expect(p.ensemble.params["ema-trend"]).toEqual({ fast: 12, slow: 26, trend: 200, adxMin: 20 });
    expect(p.ensemble.buyThreshold).toBe(0.35);
    expect(p.risk).toEqual({ stopAtrMult: 2, takeProfitR: 2, riskPerTradePct: 1.5 });
  });

  it("scenario B: lab met alleen breakout, koop 0,25 en stop 3 → precies dat gaat naar de bot", () => {
    const cfg = { ...botConfig(), ensemble: { ...botConfig().ensemble, enabled: [...IDS] } };
    const req = {
      strategy: "breakout",
      ensemble: { enabled: ["breakout"], buyThreshold: 0.25, sellThreshold: -0.3 },
      risk: { stopAtrMult: 3, takeProfitR: 2, riskPerTradePct: 1.5 },
    };
    const row = { params: { "breakout.lookback": 30 }, score: 0.4 };
    const p = L.testedPartial(row, req, cfg, IDS);
    expect(p.ensemble.enabled).toEqual(["breakout"]);
    expect(p.ensemble.buyThreshold).toBe(0.25);
    expect(p.risk.stopAtrMult).toBe(3);
    expect(p.ensemble.params.breakout).toEqual({ lookback: 30 });
    // breakout had al een positief gewicht: niet aanraken
    expect(p.ensemble.weights).toBeUndefined();
  });

  it("ensemble-grid: rij-waarden gaan voor op het formulier", () => {
    const cfg = botConfig();
    const req = {
      ensemble: { enabled: ["breakout", "rsi-reversion"], buyThreshold: 0.35, sellThreshold: -0.3 },
      risk: { stopAtrMult: 2, takeProfitR: 2, riskPerTradePct: 1 },
    };
    const row = {
      params: { "ensemble.buyThreshold": 0.45, "ensemble.sellThreshold": -0.2, "risk.stopAtrMult": 2.5, "risk.takeProfitR": 3 },
      score: 2,
    };
    const p = L.testedPartial(row, req, cfg, IDS);
    expect(p.ensemble).toEqual({ enabled: ["breakout", "rsi-reversion"], buyThreshold: 0.45, sellThreshold: -0.2 });
    expect(p.risk).toEqual({ stopAtrMult: 2.5, takeProfitR: 3, riskPerTradePct: 1 });
  });

  it("het overzicht toont alle gewijzigde instellingen, inclusief strategieën aan/uit", () => {
    const cfg = { ...botConfig(), ensemble: { ...botConfig().ensemble, enabled: [...IDS].filter((i) => i !== "ema-trend") } };
    const req = {
      strategy: "ema-trend",
      ensemble: { enabled: ["breakout"], buyThreshold: 0.25, sellThreshold: -0.3 },
      risk: { stopAtrMult: 3, takeProfitR: 2, riskPerTradePct: 1.5 },
    };
    const row = { params: { "ema-trend.fast": 12 }, score: 1 };
    const p = L.testedPartial(row, req, cfg, IDS);
    const d = L.describeApply(p, row, cfg, STRATS);
    expect(d.enabled.added).toEqual(["ema-trend"]);
    expect(d.enabled.removed).toEqual(["rsi-reversion", "macd-momentum", "vwap-reversion"]);
    const byKey = Object.fromEntries(d.rows.map((r: Fake) => [r.key, r]));
    expect(byKey["ema-trend.fast"]).toMatchObject({ cur: 9, next: 12, same: false });
    expect(byKey["ensemble.weights.ema-trend"]).toMatchObject({ cur: 0, next: 1, same: false });
    expect(byKey["ensemble.buyThreshold"]).toMatchObject({ cur: 0.35, next: 0.25, same: false });
    expect(byKey["risk.stopAtrMult"]).toMatchObject({ cur: 2, next: 3, same: false });
    expect(byKey["risk.takeProfitR"]).toMatchObject({ same: true });
  });
});
