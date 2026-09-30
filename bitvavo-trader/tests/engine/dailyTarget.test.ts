/**
 * Dagdoel (risk.dailyProfitTargetPct): zodra het resultaat van vandaag het doel haalt,
 * verkoopt de bot open posities (winst vastzetten) en koopt hij tot de dagwissel niets meer.
 */
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { DEFAULT_RISK_CONFIG } from "../../src/core/defaults";
import type { Interval, RiskConfig } from "../../src/core/types";
import { StateStore } from "../../src/engine/stateStore";
import { RiskManager } from "../../src/risk/riskManager";
import { Clock, I15, T0, setup, type Harness } from "./helpers";

const DAY = 86_400_000;
let dirs: string[] = [];
afterEach(() => {
  for (const d of dirs) rmSync(d, { recursive: true, force: true });
  dirs = [];
});

function harness(target: number, o: { store?: StateStore; clock?: Clock } = {}): Harness {
  const h = setup({
    markets: ["AAA-EUR", "BBB-EUR"],
    startingCapital: 100,
    clock: o.clock,
    config: {
      risk: { ...DEFAULT_RISK_CONFIG, dailyProfitTargetPct: target, maxSpreadPct: 0 } as RiskConfig,
    },
    deps: {
      createRisk: (cfg: RiskConfig, interval: Interval) => new RiskManager(cfg, interval),
      ...(o.store ? { store: o.store } : {}),
    },
  });
  // Koers 100 voor beide markten; ATR 1 → stop 2 onder de instap, koersdoel 2R erboven
  const last = Math.floor(h.clock.t / I15) * I15;
  h.feed.setSeries("AAA-EUR", 100, last);
  h.feed.setSeries("BBB-EUR", 100, last);
  h.signals.atr = 1;
  return h;
}

async function buy(h: Harness, market: string): Promise<void> {
  h.signals.buyMarkets = new Set([market]);
  h.signals.buyAt.add(h.lastClosed());
  await h.engine.tick();
}

/** Klok een candle verder; nieuwe vormende candle op `close` voor beide markten. */
function nextCandle(h: Harness, aaa: number, bbb = 100): void {
  h.clock.advance(I15);
  h.feed.append("AAA-EUR", aaa);
  h.feed.append("BBB-EUR", bbb);
}

describe("Dagdoel", () => {
  it("doel gehaald → open positie verkocht (dagdoel), daarna tot de dagwissel geen aankopen; de dag erna weer wel", async () => {
    const h = harness(1);
    await buy(h, "AAA-EUR");
    expect(h.broker.buys().map((o) => o.req.market)).toEqual(["AAA-EUR"]);
    expect(h.engine.snapshot().halted.halted).toBe(false);

    // Koers stijgt: het resultaat van vandaag (incl. de open positie) komt boven +1%
    h.feed.setLast("AAA-EUR", 103.5);
    await h.engine.tick();
    let s = h.engine.snapshot();
    expect(s.positions).toHaveLength(0);
    expect(s.trades[0]).toMatchObject({ market: "AAA-EUR", exitReason: "daily-target" });
    expect(s.trades[0].pnlQuote).toBeGreaterThan(0);
    expect(s.halted).toMatchObject({ halted: true, dailyTarget: true });
    expect(s.logs.map((l) => l.message).some((m) => m.startsWith("Dagdoel gehaald (+"))).toBe(true);

    // Nieuw koopsignaal dezelfde dag: niet kopen
    nextCandle(h, 103.5);
    await buy(h, "BBB-EUR");
    s = h.engine.snapshot();
    expect(h.broker.buys().map((o) => o.req.market)).toEqual(["AAA-EUR"]);
    expect(s.halted).toMatchObject({ halted: true, dailyTarget: true });

    // Volgende dag: weer handelen
    h.clock.advance(DAY);
    const last = Math.floor(h.clock.t / I15) * I15;
    h.feed.setSeries("AAA-EUR", 103.5, last);
    h.feed.setSeries("BBB-EUR", 100, last);
    await buy(h, "BBB-EUR");
    s = h.engine.snapshot();
    expect(s.halted.halted).toBe(false);
    expect(h.broker.buys().map((o) => o.req.market)).toEqual(["AAA-EUR", "BBB-EUR"]);
  });

  it("telt pas na verkoopkosten: op papier net boven +1%, na fee en slippage eronder → niets doen", async () => {
    const h = harness(1);
    await buy(h, "AAA-EUR");
    h.feed.setLast("AAA-EUR", 102.6); // ~+1,05% op papier, ~+0,92% na verkoopkosten
    await h.engine.tick();
    const s = h.engine.snapshot();
    expect(s.positions).toHaveLength(1);
    expect(s.halted.halted).toBe(false);
  });

  it("blijft de hele dag gelden, ook als de verkoop eerst mislukt en de koers daarna zakt", async () => {
    const h = harness(1);
    await buy(h, "AAA-EUR");
    h.broker.rejectSells = 1; // de eerste verkoop wordt geweigerd
    h.feed.setLast("AAA-EUR", 103.5);
    await h.engine.tick();
    let s = h.engine.snapshot();
    expect(s.positions).toHaveLength(1);
    expect(s.halted).toMatchObject({ halted: true, dailyTarget: true });
    // De koers zakt terug: het resultaat van vandaag ligt nu onder het doel
    nextCandle(h, 100);
    await buy(h, "BBB-EUR");
    s = h.engine.snapshot();
    expect(h.broker.buys().map((o) => o.req.market)).toEqual(["AAA-EUR"]);
    expect(s.trades[0]).toMatchObject({ exitReason: "daily-target" }); // de verkoop is opnieuw geprobeerd
    expect(s.account.dayReturnPct!).toBeLessThan(1);
    expect(s.halted).toMatchObject({ halted: true, dailyTarget: true, reason: "Dagdoel vandaag gehaald: geen nieuwe trades tot morgen" });
  });

  it("onder het doel gebeurt er niets; dagdoel 0 = uit", async () => {
    const below = harness(1);
    await buy(below, "AAA-EUR");
    below.feed.setLast("AAA-EUR", 100.5);
    await below.engine.tick();
    expect(below.engine.snapshot().positions).toHaveLength(1);
    expect(below.engine.snapshot().halted.halted).toBe(false);

    const off = harness(0);
    await buy(off, "AAA-EUR");
    off.feed.setLast("AAA-EUR", 103.5);
    await off.engine.tick();
    expect(off.engine.snapshot().positions).toHaveLength(1);
    expect(off.engine.snapshot().halted.halted).toBe(false);
  });

  it("blijft na een herstart op dezelfde dag gelden (opgeslagen), maar niet meer de dag erna", async () => {
    const d = mkdtempSync(join(tmpdir(), "engine-target-"));
    dirs.push(d);
    const file = join(d, "state.json");
    const h1 = harness(1, { store: new StateStore(file) });
    await buy(h1, "AAA-EUR");
    h1.feed.setLast("AAA-EUR", 103.5);
    await h1.engine.tick();
    await h1.engine.stop();
    expect(JSON.parse(readFileSync(file, "utf8")).targetDayKey).toBe(h1.engine.snapshot().account.dayKey);

    const h2 = harness(1, { store: new StateStore(file), clock: h1.clock });
    await buy(h2, "BBB-EUR");
    expect(h2.broker.buys()).toHaveLength(0);
    expect(h2.engine.snapshot().halted).toMatchObject({ halted: true, dailyTarget: true });

    const h3 = harness(1, { store: new StateStore(file), clock: new Clock(h1.clock.t + DAY) });
    await buy(h3, "BBB-EUR");
    expect(h3.broker.buys().map((o) => o.req.market)).toEqual(["BBB-EUR"]);
  });
});
