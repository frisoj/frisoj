/**
 * Integratie-smoketest met de ECHTE modules: SimulatedFeed (A6), PaperBroker
 * (A6), runEnsemble (A3) en RiskManager (A4). Controleert vooral invarianten
 * van de administratie (engine-ledger == paper-broker-saldi), niet het
 * rendement van de strategieën.
 */
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { PaperBroker } from "../../src/broker/paperBroker";
import { DEFAULT_ENGINE_CONFIG, DEFAULT_ENSEMBLE_CONFIG, DEFAULT_RISK_CONFIG } from "../../src/core/defaults";
import { INTERVAL_MS, type Candle, type EngineConfig, type EnsembleConfig } from "../../src/core/types";
import { SimulatedFeed } from "../../src/data/simulatedFeed";
import { StateStore } from "../../src/engine/stateStore";
import { TradingEngine } from "../../src/engine/tradingEngine";
import { runEnsemble } from "../../src/strategies/ensemble";

const MARKETS = ["BTC-EUR", "ETH-EUR", "SOL-EUR"];

function config(): EngineConfig {
  return structuredClone({
    ...DEFAULT_ENGINE_CONFIG,
    markets: MARKETS,
    interval: "15m" as const,
    historyCandles: 200,
    ensemble: { ...DEFAULT_ENSEMBLE_CONFIG },
    risk: {
      ...DEFAULT_RISK_CONFIG,
      stopAtrMult: 3,
      takeProfitR: 2,
      minEdgeFeeMultiple: 1,
      maxTradesPerDay: 100,
      cooldownCandlesAfterLoss: 0,
      timeStopCandles: 12,
    },
  });
}

async function checkLedger(engine: TradingEngine, broker: PaperBroker): Promise<void> {
  const s = engine.snapshot();
  const balances = await broker.getBalances();
  const bal = (sym: string) => balances.find((b) => b.symbol === sym)?.available ?? 0;
  expect(s.account.cashQuote).toBeCloseTo(bal("EUR"), 6);
  for (const p of s.positions) {
    expect(bal(p.market.split("-")[0])).toBeCloseTo(p.amount, 10);
  }
  const held = balances.filter((b) => b.symbol !== "EUR" && b.available > 1e-12).map((b) => b.symbol);
  expect(held.sort()).toEqual(s.positions.map((p) => p.market.split("-")[0]).sort());
  const value = s.positions.reduce((a, p) => a + p.amount * p.currentPrice, 0);
  expect(s.account.equity).toBeCloseTo(s.account.cashQuote + value, 6);
  const pnl = s.trades.reduce((a, t) => a + t.pnlQuote, 0);
  expect(s.account.realizedPnl).toBeCloseTo(pnl, 6);
  expect(s.positions.length).toBeLessThanOrEqual(s.config.risk.maxOpenPositions);
  for (const t of s.trades) {
    expect(t.exitTime).toBeGreaterThanOrEqual(t.entryTime);
    expect(t.costQuote).toBeGreaterThan(0);
  }
  expect(s.logs.filter((l) => l.level === "error" && !l.message.startsWith("NOODSTOP"))).toEqual([]);
}

describe("TradingEngine — integratie met echte modules", () => {
  let dir: string;
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "engine-int-"));
  });
  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it("paper-run met echte ensemble/risk/feed/broker: ledger klopt, noodstop en herstart werken", async () => {
    let t = Date.UTC(2026, 5, 1, 20, 2, 0);
    const now = () => t;
    const cfg = config();
    const feed = new SimulatedFeed({ seed: 7, now, markets: MARKETS });
    const broker = new PaperBroker({
      startingQuote: 50,
      takerFee: cfg.risk.takerFee,
      slippagePct: cfg.risk.slippagePct,
      now,
    });
    const file = join(dir, "state.json");
    // Echte runEnsemble, maar elke 5e candle geforceerd "buy" zodat het koop-pad
    // (echte RiskManager + PaperBroker) zeker geraakt wordt.
    const decide = (market: string, candles: Candle[], ens: EnsembleConfig) =>
      runEnsemble(market, candles, ens).map((d, i) =>
        i === candles.length - 1 && Math.round(candles[i].time / INTERVAL_MS["15m"]) % 5 === 0
          ? { ...d, action: "buy" as const, score: Math.max(d.score, 0.5) }
          : d,
      );
    const engine = new TradingEngine({
      feed,
      broker,
      mode: "paper",
      config: cfg,
      startingCapital: 50,
      now,
      store: new StateStore(file),
      decide,
    });

    let opened = 0;
    let closed = 0;
    engine.on("position-opened", () => opened++);
    engine.on("position-closed", () => closed++);

    for (let i = 0; i < 240; i++) {
      await engine.tick();
      await checkLedger(engine, broker);
      t += 5 * 60_000; // 3 ticks per 15m-candle, ~20 uur (incl. dagwissel)
    }
    const s = engine.snapshot();
    expect(opened).toBeGreaterThan(0);
    expect(closed).toBeGreaterThan(0);
    expect(Object.keys(s.decisions).sort()).toEqual([...MARKETS].sort());
    expect(s.equityHistory.length).toBeGreaterThan(10);

    await engine.killSwitch();
    await checkLedger(engine, broker);
    const after = engine.snapshot();
    expect(after.positions).toHaveLength(0);
    expect(after.running).toBe(false);
    expect(closed).toBe(after.trades.length);

    // Herstart: nieuwe broker, staat uit het bestand
    const broker2 = new PaperBroker({ startingQuote: 50, takerFee: cfg.risk.takerFee, slippagePct: cfg.risk.slippagePct, now });
    const engine2 = new TradingEngine({
      feed,
      broker: broker2,
      mode: "paper",
      config: cfg,
      startingCapital: 50,
      now,
      store: new StateStore(file),
    });
    expect(engine2.snapshot().account.cashQuote).toBeCloseTo(after.account.cashQuote, 9);
    expect(engine2.snapshot().trades.length).toBe(after.trades.length);
    await checkLedger(engine2, broker2);
    await engine2.tick(); // standaard-deps (echte runEnsemble + RiskManager)
    await checkLedger(engine2, broker2);
    await engine2.stop();
  }, 60_000);
});
