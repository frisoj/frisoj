import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { getProfile } from "../../src/bots/profiles";
import { downsample, equityValue, EQUITY_HISTORY_MAX_POINTS, summarize, type SummarySnapshot } from "../../src/bots/summary";
import { PaperBroker } from "../../src/broker/paperBroker";
import { DEFAULT_ENGINE_CONFIG } from "../../src/core/defaults";
import type { EquityPoint, Trade } from "../../src/core/types";
import { SimulatedFeed } from "../../src/data/simulatedFeed";
import { StateStore } from "../../src/engine/stateStore";
import { TradingEngine } from "../../src/engine/tradingEngine";

const T0 = Date.UTC(2026, 8, 28, 12, 0, 0);
const scalper = getProfile("scalper")!;

function trade(i: number, market: string, pnlQuote: number, pnlPct = pnlQuote * 10, fees = 0.05): Trade {
  return {
    id: `trd_${i}`,
    market,
    entryTime: T0 + i * 60_000,
    exitTime: T0 + i * 60_000 + 30_000,
    entryPrice: 100,
    exitPrice: 100 + pnlPct,
    amount: 0.1,
    costQuote: 10,
    proceedsQuote: 10 + pnlQuote,
    feesQuote: fees,
    pnlQuote,
    pnlPct,
    rMultiple: 0,
    exitReason: pnlQuote >= 0 ? "take-profit" : "stop-loss",
    candlesHeld: 3,
    entryReason: "test",
  };
}

function snap(over: Partial<SummarySnapshot> = {}): SummarySnapshot {
  return {
    running: true,
    mode: "paper",
    liveArmed: false,
    startedAt: T0,
    config: { ...structuredClone(DEFAULT_ENGINE_CONFIG), interval: "5m" },
    account: {
      startingEquity: 25,
      cashQuote: 20,
      equity: 26,
      dayStartEquity: 25.5,
      dayKey: "2026-09-28",
      realizedPnl: 1,
      realizedPnlToday: 0.5,
      unrealizedPnl: 0,
      feesPaid: 0.4,
      tradesToday: 3,
      lastLossAt: {},
      totalPnlQuote: 1,
      totalReturnPct: 4,
      dayPnlQuote: 0.5,
      dayReturnPct: 1.96,
    },
    positions: [],
    trades: [],
    equityHistory: [],
    halted: { halted: false },
    activeMarkets: ["BTC-EUR", "ETH-EUR", "SOL-EUR"],
    ...over,
  };
}

describe("summarize — basisvelden en resultaten", () => {
  it("neemt profiel, status en de resultaten van de engine over; bruto = resultaat + kosten", () => {
    const s = summarize(
      snap({ positions: [{} as never, {} as never], halted: { halted: true, reason: "dagverlies", dailyLimit: true } }),
      scalper,
    );
    expect(s).toMatchObject({
      id: "scalper",
      name: "Snelle scalper",
      short: "Scalper",
      color: scalper.color,
      description: scalper.description,
      path: "/bot/scalper/",
      mode: "paper",
      running: true,
      liveArmed: false,
      interval: "5m",
      startedAt: T0,
      startingEquity: 25,
      equity: 26,
      totalPnlQuote: 1,
      totalReturnPct: 4,
      dayPnlQuote: 0.5,
      dayReturnPct: 1.96,
      feesPaid: 0.4,
      tradesToday: 3,
      openPositions: 2,
      activeMarkets: 3,
      halted: { halted: true, reason: "dagverlies", dailyLimit: true },
    });
    expect(s.grossPnlQuote).toBeCloseTo(1.4, 10);
    // eigen pad kan meegegeven worden
    expect(summarize(snap(), scalper, { path: "/elders/" }).path).toBe("/elders/");
  });

  it("halted is een kopie (de samenvatting verandert de snapshot niet)", () => {
    const sn = snap();
    const s = summarize(sn, scalper);
    s.halted.halted = true;
    expect(sn.halted.halted).toBe(false);
  });

  it("oudere engine zonder resultaatvelden: eigen berekening; zonder activeMarkets telt config.markets", () => {
    const sn = snap({ activeMarkets: undefined, skimmedQuote: 2 });
    delete sn.account.totalPnlQuote;
    delete sn.account.totalReturnPct;
    delete sn.account.dayPnlQuote;
    delete sn.account.dayReturnPct;
    const s = summarize(sn, scalper);
    expect(s.totalPnlQuote).toBeCloseTo(26 + 2 - 25, 10);
    expect(s.totalReturnPct).toBeCloseTo((3 / 25) * 100, 10);
    expect(s.dayPnlQuote).toBeCloseTo(0.5, 10);
    expect(s.dayReturnPct).toBeCloseTo((0.5 / 25.5) * 100, 10);
    expect(s.activeMarkets).toBe(DEFAULT_ENGINE_CONFIG.markets.length);
  });

  it("niet-eindige getallen worden 0 (nooit NaN in het klassement)", () => {
    const sn = snap();
    sn.account.totalPnlQuote = Number.NaN;
    sn.account.feesPaid = Number.POSITIVE_INFINITY;
    sn.account.startingEquity = 0;
    delete sn.account.totalReturnPct;
    const s = summarize(sn, scalper);
    for (const v of [s.totalPnlQuote, s.totalReturnPct, s.feesPaid, s.grossPnlQuote]) expect(Number.isFinite(v)).toBe(true);
    expect(s.totalReturnPct).toBe(0); // startkapitaal 0 → geen deling door 0
  });
});

describe("summarize — trades", () => {
  it("zonder trades: alles 0, profit factor 0, geen beste/slechtste markt", () => {
    const s = summarize(snap(), scalper);
    expect(s).toMatchObject({
      trades: 0,
      wins: 0,
      losses: 0,
      winRatePct: 0,
      avgWinPct: 0,
      avgLossPct: 0,
      profitFactor: 0,
      bestMarket: null,
      worstMarket: null,
    });
  });

  it("winst/verlies, win rate, gemiddelden en profit factor (break-even telt als trade, niet als winst of verlies)", () => {
    const trades = [trade(1, "BTC-EUR", 2, 20), trade(2, "BTC-EUR", -1, -10), trade(3, "ETH-EUR", 1, 10), trade(4, "SOL-EUR", 0, 0)];
    const s = summarize(snap({ trades }), scalper);
    expect(s.trades).toBe(4);
    expect(s.wins).toBe(2);
    expect(s.losses).toBe(1);
    expect(s.winRatePct).toBe(50);
    expect(s.avgWinPct).toBe(15);
    expect(s.avgLossPct).toBe(-10);
    expect(s.profitFactor).toBe(3);
    // BTC: 2 − 1 = 1, ETH: 1 → gelijk, de alfabetisch eerste wint; SOL 0 is de slechtste
    expect(s.bestMarket).toEqual({ market: "BTC-EUR", pnlQuote: 1 });
    expect(s.worstMarket).toEqual({ market: "SOL-EUR", pnlQuote: 0 });
  });

  it("beste/slechtste markt telt per markt op; bij gelijk resultaat de alfabetisch eerste", () => {
    const trades = [trade(1, "ETH-EUR", 3), trade(2, "ETH-EUR", -2), trade(3, "ADA-EUR", 1), trade(4, "XRP-EUR", -0.5), trade(5, "SOL-EUR", -0.5)];
    const s = summarize(snap({ trades }), scalper);
    expect(s.bestMarket).toEqual({ market: "ADA-EUR", pnlQuote: 1 }); // ADA 1 = ETH 1 → ADA
    expect(s.worstMarket).toEqual({ market: "SOL-EUR", pnlQuote: -0.5 }); // SOL = XRP → SOL
    // Eén markt: die is zowel de beste als de slechtste
    const one = summarize(snap({ trades: [trade(1, "BTC-EUR", -1)] }), scalper);
    expect(one.bestMarket).toEqual({ market: "BTC-EUR", pnlQuote: -1 });
    expect(one.worstMarket).toEqual({ market: "BTC-EUR", pnlQuote: -1 });
  });

  it("profit factor 999 zonder verliezen; 0 met alleen break-even trades", () => {
    expect(summarize(snap({ trades: [trade(1, "BTC-EUR", 1)] }), scalper).profitFactor).toBe(999);
    expect(summarize(snap({ trades: [trade(1, "BTC-EUR", 0)] }), scalper).profitFactor).toBe(0);
    // begrensd op 999
    const tiny = [trade(1, "BTC-EUR", 10_000), trade(2, "BTC-EUR", -0.001)];
    expect(summarize(snap({ trades: tiny }), scalper).profitFactor).toBe(999);
  });

  it("telt over ALLE bewaarde trades (allTrades), niet alleen de laatste 200 uit de snapshot", () => {
    const all = Array.from({ length: 450 }, (_, i) => trade(i, i % 2 === 0 ? "BTC-EUR" : "ETH-EUR", i < 300 ? -1 : 2));
    const last200 = all.slice(-200).reverse();
    const s = summarize(snap({ trades: last200 }), scalper, { allTrades: all });
    expect(s.trades).toBe(450);
    expect(s.losses).toBe(300);
    expect(s.wins).toBe(150);
    expect(s.profitFactor).toBeCloseTo(300 / 300, 10);
    // zonder allTrades: alleen wat de snapshot heeft
    const only = summarize(snap({ trades: last200 }), scalper);
    expect(only.trades).toBe(200);
    expect(only.losses).toBe(50); // i = 250..299
  });
});

describe("summarize — max. daling en equity-verloop", () => {
  it("afromen (equity omlaag, skimmed omhoog) is geen daling; een echte daling wel, in % van de piek", () => {
    const hist: EquityPoint[] = [
      { time: 1, equity: 50, skimmed: 0 },
      { time: 2, equity: 60, skimmed: 0 },
      { time: 3, equity: 50, skimmed: 10 }, // €10 afgeroomd: equity + skimmed blijft 60
      { time: 4, equity: 45, skimmed: 10 }, // 55 → −8,33% van 60
      { time: 5, equity: 52, skimmed: 10 },
    ];
    const s = summarize(snap({ equityHistory: hist }), scalper);
    expect(s.maxDrawdownPct).toBeCloseTo((55 / 60 - 1) * 100, 10);
    expect(s.equityHistory).toEqual([
      { time: 1, value: 50 },
      { time: 2, value: 60 },
      { time: 3, value: 60 },
      { time: 4, value: 55 },
      { time: 5, value: 62 },
    ]);
    // zonder skimmed (paper) telt alleen equity
    expect(equityValue({ time: 1, equity: 7 })).toBe(7);
    expect(summarize(snap(), scalper).maxDrawdownPct).toBe(0);
  });

  it("live: een hogere kapitaallimiet (storting) is geen daling; de % rekent met het geld dat meedoet (≥ −100%)", () => {
    // Limiet 25 → 100 (skimmed −75), koop, koers −10%: equity + skimmed 25 → 25 → 24,78 → 15,60
    const hist: EquityPoint[] = [
      { time: 1, equity: 25, skimmed: 0 },
      { time: 2, equity: 100, skimmed: -75 },
      { time: 3, equity: 99.78, skimmed: -75 },
      { time: 4, equity: 90.6, skimmed: -75 },
    ];
    const live = snap({ mode: "live", equityHistory: hist, account: { ...snap().account, startingEquity: 100, equity: 90.6 } });
    expect(summarize(live, scalper).maxDrawdownPct).toBeCloseTo(-9.4, 10);
    // Nooit lager dan −100%
    const crash: EquityPoint[] = [
      { time: 1, equity: 10, skimmed: 0 },
      { time: 2, equity: 100, skimmed: -90 },
      { time: 3, equity: -50, skimmed: -90 },
    ];
    const deep = snap({ mode: "live", equityHistory: crash, account: { ...snap().account, startingEquity: 100 } });
    expect(summarize(deep, scalper).maxDrawdownPct).toBe(-100);
  });

  it("max. daling over de VOLLEDIGE historie, ook als het dal bij het uitdunnen wegvalt; hooguit 300 punten, eerste en laatste blijven", () => {
    const hist: EquityPoint[] = Array.from({ length: 2000 }, (_, i) => ({ time: T0 + i * 60_000, equity: 100 + i * 0.01 }));
    hist[1001] = { time: hist[1001].time, equity: 50 }; // één diep dal
    const s = summarize(snap({ equityHistory: hist }), scalper);
    const peak = 100 + 1000 * 0.01;
    expect(s.maxDrawdownPct).toBeCloseTo((50 / peak - 1) * 100, 10);
    expect(s.equityHistory).toHaveLength(EQUITY_HISTORY_MAX_POINTS);
    expect(s.equityHistory[0]).toEqual({ time: hist[0].time, value: 100 });
    expect(s.equityHistory.at(-1)).toEqual({ time: hist[1999].time, value: hist[1999].equity });
    for (let i = 1; i < s.equityHistory.length; i++) {
      expect(s.equityHistory[i].time).toBeGreaterThan(s.equityHistory[i - 1].time);
    }
  });

  it("downsample: korte lijsten ongewijzigd (kopie); lange lijsten gelijkmatig, strikt oplopend, eerste en laatste erin", () => {
    const short = [1, 2, 3];
    const copy = downsample(short);
    expect(copy).toEqual(short);
    expect(copy).not.toBe(short);
    for (const n of [301, 302, 599, 1000, 2000]) {
      const list = Array.from({ length: n }, (_, i) => i);
      const out = downsample(list);
      expect(out).toHaveLength(300);
      expect(out[0]).toBe(0);
      expect(out.at(-1)).toBe(n - 1);
      for (let i = 1; i < out.length; i++) expect(out[i]).toBeGreaterThan(out[i - 1]);
    }
    expect(downsample([1, 2, 3, 4, 5], 2)).toEqual([1, 5]);
    expect(downsample([], 300)).toEqual([]);
  });
});

describe("summarize met een echte TradingEngine", () => {
  it("allTrades() geeft alle bewaarde trades (meer dan de 200 uit de snapshot), als kopie", async () => {
    const dir = mkdtempSync(join(tmpdir(), "bvt-summary-"));
    const file = join(dir, "state-paper.json");
    const trades = Array.from({ length: 260 }, (_, i) => trade(i, i % 3 === 0 ? "BTC-EUR" : "ETH-EUR", i % 3 === 0 ? 0.5 : -0.1));
    writeFileSync(
      file,
      JSON.stringify({
        version: 1,
        mode: "paper",
        savedAt: T0,
        account: {
          startingEquity: 25,
          cashQuote: 25,
          equity: 25,
          dayStartEquity: 25,
          dayKey: "2026-09-28",
          realizedPnl: 0,
          realizedPnlToday: 0,
          unrealizedPnl: 0,
          feesPaid: 1.3,
          tradesToday: 0,
          lastLossAt: {},
        },
        positions: [],
        trades,
        equityHistory: [
          { time: T0, equity: 25 },
          { time: T0 + 60_000, equity: 24 },
        ],
        paperBalances: [{ symbol: "EUR", available: 25, inOrder: 0 }],
        ledgerVersion: 2,
      }),
    );
    const engine = new TradingEngine({
      feed: new SimulatedFeed(),
      broker: new PaperBroker({ startingQuote: 25, takerFee: 0.0025, slippagePct: 0.0005 }),
      config: structuredClone(DEFAULT_ENGINE_CONFIG),
      mode: "paper",
      store: new StateStore(file),
      startingCapital: 25,
      now: () => T0 + 120_000,
    });
    const all = engine.allTrades();
    expect(all).toHaveLength(260);
    expect(all[0].id).toBe("trd_0"); // oudste eerst
    all[0].pnlQuote = 1_000_000;
    expect(engine.allTrades()[0].pnlQuote).toBe(0.5); // kopie
    const s = engine.snapshot();
    expect(s.trades).toHaveLength(200);
    const sum = summarize(s, scalper, { allTrades: engine.allTrades() });
    expect(sum.trades).toBe(260);
    expect(sum.wins).toBe(87);
    expect(sum.losses).toBe(173);
    expect(sum.bestMarket?.market).toBe("BTC-EUR");
    expect(sum.worstMarket?.market).toBe("ETH-EUR");
    expect(sum.feesPaid).toBe(1.3);
    expect(sum.maxDrawdownPct).toBeCloseTo(-4, 10);
    expect(sum.startingEquity).toBe(25);
    await engine.stop();
  });
});
