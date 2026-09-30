/**
 * Dagdoel als winstgrens (risk.dailyProfitTargetPct): haalt de dag het doel, dan handelt de
 * bot door; valt de dagwinst terug tot de grens, dan verkoopt hij alles en koopt hij tot de
 * dagwissel niets meer.
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
      // Koersdoel ver weg (5R), zodat de koersbewegingen in deze tests het niet raken
      risk: { ...DEFAULT_RISK_CONFIG, dailyProfitTargetPct: target, maxSpreadPct: 0, takeProfitR: 5 } as RiskConfig,
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

describe("Dagdoel als winstgrens", () => {
  it("doel gehaald → doorhandelen; terugval tot de grens → alles verkopen en tot morgen niets kopen; de dag erna weer wel", async () => {
    const h = harness(1);
    await buy(h, "AAA-EUR");
    expect(h.broker.buys().map((o) => o.req.market)).toEqual(["AAA-EUR"]);

    // +1,3% vandaag (na verkoopkosten): de grens wordt actief, maar er wordt NIET verkocht
    h.feed.setLast("AAA-EUR", 103.5);
    await h.engine.tick();
    let s = h.engine.snapshot();
    expect(s.positions).toHaveLength(1);
    expect(s.halted.halted).toBe(false);
    expect(s.account.dayTargetReached).toBe(true);
    expect(s.logs.map((l) => l.message).some((m) => m.startsWith("Dagdoel gehaald: +"))).toBe(true);

    // Nog hoger: nog steeds doorhandelen
    h.feed.setLast("AAA-EUR", 106);
    await h.engine.tick();
    expect(h.engine.snapshot().positions).toHaveLength(1);

    // Terugval tot onder de grens: winst vastzetten
    h.feed.setLast("AAA-EUR", 102);
    await h.engine.tick();
    s = h.engine.snapshot();
    expect(s.positions).toHaveLength(0);
    expect(s.trades[0]).toMatchObject({ market: "AAA-EUR", exitReason: "daily-target" });
    expect(s.trades[0].pnlQuote).toBeGreaterThan(0);
    expect(s.halted).toMatchObject({ halted: true, dailyTarget: true });
    expect(s.halted.reason).toMatch(/^Dagwinst teruggevallen naar \+0,\d\d% \(winstgrens \+1%\)/);

    // Nieuw koopsignaal dezelfde dag: niet kopen
    nextCandle(h, 102);
    await buy(h, "BBB-EUR");
    s = h.engine.snapshot();
    expect(h.broker.buys().map((o) => o.req.market)).toEqual(["AAA-EUR"]);
    expect(s.halted).toMatchObject({ halted: true, dailyTarget: true });

    // Volgende dag: weer handelen, grens weer uit
    h.clock.advance(DAY);
    const last = Math.floor(h.clock.t / I15) * I15;
    h.feed.setSeries("AAA-EUR", 102, last);
    h.feed.setSeries("BBB-EUR", 100, last);
    await buy(h, "BBB-EUR");
    s = h.engine.snapshot();
    expect(s.halted.halted).toBe(false);
    expect(s.account.dayTargetReached).toBe(false);
    expect(h.broker.buys().map((o) => o.req.market)).toEqual(["AAA-EUR", "BBB-EUR"]);
  });

  it("boven de grens mag hij kopen, maar niet als die trade de dagwinst tot de grens zou duwen", async () => {
    // Net boven de grens: +1,1% — een nieuwe trade kost ~0,27% → afwijzen
    const near = harness(1);
    await buy(near, "AAA-EUR");
    near.feed.setLast("AAA-EUR", 103);
    await near.engine.tick();
    expect(near.engine.snapshot().account.dayTargetReached).toBe(true);
    nextCandle(near, 103);
    await buy(near, "BBB-EUR");
    expect(near.broker.buys().map((o) => o.req.market)).toEqual(["AAA-EUR"]);
    expect(near.engine.snapshot().logs.map((l) => l.message).some((m) => m.includes("te dicht bij de winstgrens"))).toBe(true);

    // Ruim erboven: +3% — gewoon kopen
    const far = harness(1);
    await buy(far, "AAA-EUR");
    far.feed.setLast("AAA-EUR", 108);
    await far.engine.tick();
    nextCandle(far, 108);
    await buy(far, "BBB-EUR");
    expect(far.broker.buys().map((o) => o.req.market)).toEqual(["AAA-EUR", "BBB-EUR"]);
  });

  it("telt na verkoopkosten: op papier net boven +1%, na fee en slippage eronder → grens nog niet actief", async () => {
    const h = harness(1);
    await buy(h, "AAA-EUR");
    h.feed.setLast("AAA-EUR", 102.6); // ~+1,05% op papier, ~+0,92% na verkoopkosten
    await h.engine.tick();
    const s = h.engine.snapshot();
    expect(s.account.dayTargetReached).toBe(false);
    // Een terugval daarna zet dus ook niets vast
    h.feed.setLast("AAA-EUR", 100.5);
    await h.engine.tick();
    expect(h.engine.snapshot().positions).toHaveLength(1);
    expect(h.engine.snapshot().halted.halted).toBe(false);
  });

  it("blijft de hele dag gelden, ook als de verkoop eerst mislukt en de koers daarna verder zakt", async () => {
    const h = harness(1);
    await buy(h, "AAA-EUR");
    h.feed.setLast("AAA-EUR", 103.5);
    await h.engine.tick();
    h.broker.rejectSells = 1; // de eerste verkoop wordt geweigerd
    h.feed.setLast("AAA-EUR", 102);
    await h.engine.tick();
    let s = h.engine.snapshot();
    expect(s.positions).toHaveLength(1);
    expect(s.halted).toMatchObject({ halted: true, dailyTarget: true });
    nextCandle(h, 99);
    await buy(h, "BBB-EUR");
    s = h.engine.snapshot();
    expect(h.broker.buys().map((o) => o.req.market)).toEqual(["AAA-EUR"]);
    expect(s.trades[0]).toMatchObject({ exitReason: "daily-target" }); // de verkoop is opnieuw geprobeerd
    expect(s.halted).toMatchObject({ halted: true, dailyTarget: true });
    expect(s.halted.reason).toMatch(/^Dagwinst /);
  });

  it("dagdoel 0 = uit: geen grens en niets vastzetten", async () => {
    const off = harness(0);
    await buy(off, "AAA-EUR");
    off.feed.setLast("AAA-EUR", 106);
    await off.engine.tick();
    off.feed.setLast("AAA-EUR", 100.5);
    await off.engine.tick();
    expect(off.engine.snapshot().positions).toHaveLength(1);
    expect(off.engine.snapshot().account.dayTargetReached).toBe(false);
    expect(off.engine.snapshot().halted.halted).toBe(false);
  });

  it("grens en vastgezette winst blijven na een herstart op dezelfde dag gelden, de dag erna niet", async () => {
    const d = mkdtempSync(join(tmpdir(), "engine-target-"));
    dirs.push(d);
    const file = join(d, "state.json");
    const h1 = harness(1, { store: new StateStore(file) });
    await buy(h1, "AAA-EUR");
    h1.feed.setLast("AAA-EUR", 103.5);
    await h1.engine.tick();
    await h1.engine.stop();
    expect(JSON.parse(readFileSync(file, "utf8")).targetArmedDayKey).toBe(h1.engine.snapshot().account.dayKey);

    // Herstart: de grens is nog actief; een terugval zet de winst vast
    const h2 = harness(1, { store: new StateStore(file), clock: h1.clock });
    expect(h2.engine.snapshot().account.dayTargetReached).toBe(true);
    h2.feed.setLast("AAA-EUR", 102);
    await h2.engine.tick();
    expect(h2.engine.snapshot().halted).toMatchObject({ halted: true, dailyTarget: true });
    await h2.engine.stop();
    expect(JSON.parse(readFileSync(file, "utf8")).targetDayKey).toBe(h2.engine.snapshot().account.dayKey);

    const h3 = harness(1, { store: new StateStore(file), clock: h1.clock });
    await buy(h3, "BBB-EUR");
    expect(h3.broker.buys()).toHaveLength(0);

    const h4 = harness(1, { store: new StateStore(file), clock: new Clock(h1.clock.t + DAY) });
    await buy(h4, "BBB-EUR");
    expect(h4.broker.buys().map((o) => o.req.market)).toEqual(["BBB-EUR"]);
    expect(h4.engine.snapshot().account.dayTargetReached).toBe(false);
  });
});
