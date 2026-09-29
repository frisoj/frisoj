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

describe("minimale periode (≥ 30 candles, zelfde grens als de server)", () => {
  it("rekent dagen × 86.400.000 / interval-ms", () => {
    expect(L.periodCandles(30, "1d")).toBe(30);
    expect(L.periodCandles(1, "15m")).toBe(96);
    expect(L.periodCandles(14, "12h")).toBe(28);
    expect(L.MIN_PERIOD_CANDLES).toBe(30);
  });

  it("geeft een Nederlandse melding met het minimum aantal dagen", () => {
    expect(L.periodError(30, "1d")).toBeNull();
    expect(L.periodError(1, "15m")).toBeNull();
    expect(L.periodError(1, "1h")).toBe(
      "Periode te kort: 1 dag van 1h is maar 24 candles (minimaal 30). Kies minstens 2 dagen of een korter interval.",
    );
    expect(L.periodError(14, "12h")).toContain("Kies minstens 15 dagen");
    expect(L.periodError(29, "1d")).toContain("maar 29 candles");
    expect(L.minPeriodDays("4h")).toBe(5);
    expect(L.minPeriodDays("1m")).toBe(1);
  });

  it("resultDays: echte testlengte uit from/to (inclusief de laatste candle)", () => {
    const from = Date.UTC(2026, 8, 1);
    expect(L.resultDays({ interval: "1h", from, to: from + 47 * 3600e3 })).toBeCloseTo(2, 9);
    expect(L.resultDays({ interval: "1h" })).toBeNaN();
  });
});

describe("heatmap: mediaan, beste combinatie en telling per cel", () => {
  // 2 × 2: cel (0,0) goed, (1,0) alleen afgestraft (te weinig trades), (0,1) niet getest, (1,1) mediaan laag maar beste hoog
  const hm = {
    xParam: "ensemble.buyThreshold",
    yParam: "risk.stopAtrMult",
    xValues: [0.3, 0.4],
    yValues: [2, 3],
    values: [
      [0.5, null],
      [null, 0.1],
    ],
    best: [
      [0.8, null],
      [null, 1.4],
    ],
    tested: [
      [4, 3],
      [0, 5],
    ],
    scored: [
      [4, 0],
      [0, 5],
    ],
    positive: [
      [3, 0],
      [0, 2],
    ],
  };
  const f = (v: number) => v.toFixed(2).replace(".", ",");

  it("status per cel: ok / te weinig trades / niet getest", () => {
    expect(L.heatmapCell(hm, 0, 0)).toMatchObject({ status: "ok", value: 0.5, best: 0.8, tested: 4, scored: 4, positive: 3 });
    expect(L.heatmapCell(hm, 1, 0)).toMatchObject({ status: "few", value: null, tested: 3, scored: 0 });
    expect(L.heatmapCell(hm, 0, 1)).toMatchObject({ status: "untested", tested: 0 });
    // oudere server zonder tellingen: null = "niet getest of te weinig trades"
    expect(L.heatmapCell({ ...hm, tested: undefined, scored: undefined, positive: undefined, best: undefined }, 1, 0).status).toBe("none");
  });

  it("tooltip: mediaan · beste · winstgevend van gescoord (getest)", () => {
    expect(L.heatmapCellTip(L.heatmapCell(hm, 0, 0), f)).toBe("mediaan 0,50 · beste 0,80 · 3 van 4 winstgevend (4 getest)");
    expect(L.heatmapCellTip(L.heatmapCell(hm, 1, 0), f)).toContain("te weinig trades (3 getest");
    expect(L.heatmapCellTip(L.heatmapCell(hm, 0, 1), f)).toBe("niet getest");
  });

  it("de ster hoort bij de cel van res.best, niet bij de hoogste mediaan", () => {
    const bestRow = { params: { "ensemble.buyThreshold": 0.4, "risk.stopAtrMult": 3, "risk.takeProfitR": 2 }, score: 1.4, metrics: {} };
    // hoogste mediaan zit in (0,0), maar de beste combinatie in (1,1)
    expect(L.bestHeatmapCell(hm, bestRow)).toEqual({ xi: 1, yi: 1 });
    expect(L.bestHeatmapCell(hm, null)).toBeNull();
    expect(L.bestHeatmapCell(hm, { ...bestRow, score: -1e9 })).toBeNull();
    expect(L.bestHeatmapCell(hm, { ...bestRow, params: { "ensemble.buyThreshold": 0.5, "risk.stopAtrMult": 3 } })).toBeNull();
  });
});

describe("grafiek 'Koers & trades': korte markers en ruimte aan de randen (ronde 4)", () => {
  it("shortMarkerText: koop = alleen de pijl, verkoop = alleen het resultaat", async () => {
    const { shortMarkerText } = await loadPublic("js/panels/backtestLogic.js");
    expect(shortMarkerText({ action: "buy", label: "KOOP" })).toBe("");
    expect(shortMarkerText({ action: "sell", label: "TRAIL -0,8%" })).toBe("-0,8%");
    expect(shortMarkerText({ action: "sell", label: "SIGNAAL -1,2%" })).toBe("-1,2%");
    expect(shortMarkerText({ action: "sell", label: "TP +3,0%" })).toBe("+3,0%");
    expect(shortMarkerText({ action: "sell", label: "AFGESCHREVEN -100,0%" })).toBe("-100,0%");
    expect(shortMarkerText({ action: "sell", label: "+1,5%" })).toBe("+1,5%");
    // zonder percentage: het label zelf
    expect(shortMarkerText({ action: "sell", label: "VERKOOP" })).toBe("VERKOOP");
    expect(shortMarkerText(null)).toBe("");
  });

  it("paddedRange: alle candles in beeld met precies padPx ruimte links en rechts", async () => {
    const { paddedRange } = await loadPublic("js/panels/backtestLogic.js");
    const n = 1500;
    const w = 900;
    const r = paddedRange(n, w, 32);
    const barPx = w / (r.to - r.from);
    // de eerste candle (index 0) staat 32 px van de linkerrand, de laatste 32 px van de rechterrand
    expect((0 - r.from) * barPx).toBeCloseTo(32, 6);
    expect((r.to - (n - 1)) * barPx).toBeCloseTo(32, 6);
    expect(paddedRange(0, 900)).toBeNull();
    expect(paddedRange(10, 50, 32)).toBeNull(); // te smal: dan gewoon fitContent
  });
});

describe("zijbalk sticky alleen als hij in beeld past (ronde 4)", () => {
  it("sideFitsViewport: 1440×900 met een zijbalk van 953 px → niet sticky; korte zijbalk wel", async () => {
    const { sideFitsViewport } = await loadPublic("js/panels/backtestLogic.js");
    expect(sideFitsViewport(953, 900, 66)).toBe(false);
    expect(sideFitsViewport(700, 900, 66)).toBe(true);
    expect(sideFitsViewport(822, 900, 66)).toBe(true); // 822 + 66 + 12 = 900
    expect(sideFitsViewport(823, 900, 66)).toBe(false);
    expect(sideFitsViewport(0, 900, 66)).toBe(false);
  });
});
