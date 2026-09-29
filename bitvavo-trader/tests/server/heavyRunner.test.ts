import { afterEach, describe, expect, it } from "vitest";
import { DEFAULT_ENGINE_CONFIG } from "../../src/core/defaults";
import type { BacktestResult } from "../../src/core/types";
import { HeavyRunner } from "../../src/server/heavyRunner";
import { HttpError } from "../../src/server/router";
import type { BacktestInputLike } from "../../src/server/routes";
import { json, makeCandles, makeServices, startTestServer, type TestServer } from "./helpers";

const BUSY_WORKER = new URL("./fixtures/busyWorker.mjs", import.meta.url);

let runner: HeavyRunner | null = null;
let srv: TestServer | null = null;
afterEach(async () => {
  await srv?.close();
  srv = null;
  await runner?.close();
  runner = null;
});

async function waitFor(cond: () => boolean, ms = 5000): Promise<void> {
  const end = Date.now() + ms;
  while (!cond()) {
    if (Date.now() > end) throw new Error("timeout in waitFor");
    await new Promise((r) => setTimeout(r, 5));
  }
}

function backtestInput(count = 400): BacktestInputLike {
  return {
    market: "BTC-EUR",
    interval: "1h",
    candles: makeCandles("1h", count + 1).slice(0, -1),
    initialCapital: 50,
    ensemble: structuredClone(DEFAULT_ENGINE_CONFIG.ensemble),
    risk: { ...DEFAULT_ENGINE_CONFIG.risk },
    dataSource: "simulated",
    tradeFromIndex: 150,
  };
}

describe("HeavyRunner met de echte rekenwerker", () => {
  it("draait een echte backtest in een worker-thread", async () => {
    runner = new HeavyRunner();
    const res = await runner.run<BacktestResult>("backtest", backtestInput());
    expect(res.market).toBe("BTC-EUR");
    expect(res.interval).toBe("1h");
    expect(typeof res.metrics.totalReturnPct).toBe("number");
    expect(Array.isArray(res.equityCurve)).toBe(true);
    expect(res.equityCurve.length).toBeGreaterThan(0);
    // De worker wordt hergebruikt
    const again = await runner.run<BacktestResult>("backtest", backtestInput(300));
    expect(again.market).toBe("BTC-EUR");
    expect(runner.busy).toBe(0);
  }, 30_000);

  it("geeft fouten uit de worker door als afgewezen promise", async () => {
    runner = new HeavyRunner();
    await expect(
      runner.run("walkForward", backtestInput(200), { folds: 8, trainRatio: 0.7, objective: "sharpe" }),
    ).rejects.toThrow(/Te weinig candles/);
    await expect(runner.run("onbekend", backtestInput(200))).rejects.toThrow(/Onbekende berekening/);
  }, 30_000);
});

describe("HeavyRunner (test-worker)", () => {
  it("houdt de event-loop vrij terwijl de worker rekent", async () => {
    runner = new HeavyRunner({ workerUrl: BUSY_WORKER });
    let maxGap = 0;
    let last = Date.now();
    const iv = setInterval(() => {
      const t = Date.now();
      maxGap = Math.max(maxGap, t - last);
      last = t;
    }, 10);
    try {
      const res = await runner.run<{ kind: string; input: { ms: number } }>("backtest", { ms: 800 });
      expect(res).toMatchObject({ kind: "backtest", input: { ms: 800 } });
    } finally {
      clearInterval(iv);
    }
    expect(maxGap).toBeLessThan(200);
  });

  it("breekt een te lange berekening af met 503 en start daarna een nieuwe worker", async () => {
    runner = new HeavyRunner({ workerUrl: BUSY_WORKER, timeoutMs: 300 });
    const t0 = Date.now();
    const err = await runner.run("optimize", { ms: 10_000 }).catch((e: unknown) => e);
    expect(Date.now() - t0).toBeLessThan(3000);
    expect(err).toBeInstanceOf(HttpError);
    expect((err as HttpError).status).toBe(503);
    expect((err as HttpError).message).toMatch(/duurde te lang/);
    const ok = await runner.run<{ input: { ms: number } }>("optimize", { ms: 1 });
    expect(ok.input.ms).toBe(1);
  });

  it("geeft worker-fouten en crashes door, en herstelt", async () => {
    runner = new HeavyRunner({ workerUrl: BUSY_WORKER, log: () => {} });
    await expect(runner.run("fail", {})).rejects.toThrow("kapot");
    await expect(runner.run("crash", {})).rejects.toThrow(/onverwacht gestopt/);
    const ok = await runner.run<{ kind: string }>("backtest", { ms: 1 });
    expect(ok.kind).toBe("backtest");
  });

  it("close() breekt een lopende berekening af en weigert nieuwe", async () => {
    runner = new HeavyRunner({ workerUrl: BUSY_WORKER });
    const p = runner.run("backtest", { ms: 10_000 }).catch((e: unknown) => e);
    await waitFor(() => runner!.busy === 1);
    await runner.close();
    const err = await p;
    expect(err).toBeInstanceOf(HttpError);
    expect((err as HttpError).status).toBe(503);
    await expect(runner.run("backtest", { ms: 1 })).rejects.toThrow(/afgesloten/);
  });
});

describe("API blijft reageren tijdens een zware berekening", () => {
  it("de noodstop antwoordt binnen 200 ms terwijl een optimalisatie loopt", async () => {
    runner = new HeavyRunner({ workerUrl: BUSY_WORKER });
    const r = runner;
    const { services } = makeServices();
    services.optimize = (_input, opts) => r.run("optimize", { ms: 1500 }, opts);
    srv = await startTestServer({ deps: { services } });
    const opt = json(srv.base, "POST", "/api/optimize", {
      market: "BTC-EUR",
      interval: "15m",
      days: 10,
      objective: "sharpe",
    });
    await waitFor(() => r.busy === 1);
    await new Promise((res) => setTimeout(res, 100)); // worker is nu aan het rekenen
    const t0 = performance.now();
    const kill = await json(srv.base, "POST", "/api/engine/kill");
    const elapsed = performance.now() - t0;
    expect(kill.status).toBe(200);
    expect(srv.engine.killed).toBe(1);
    expect(elapsed).toBeLessThan(200);
    // tweede zware berekening tegelijk → 429
    const second = await json(srv.base, "POST", "/api/backtest", { market: "BTC-EUR", interval: "15m", days: 10 });
    expect(second.status).toBe(429);
    const done = await opt;
    expect(done.status).toBe(200);
    expect(done.data.kind).toBe("optimize");
  });
});
