/**
 * Draait in de worker-thread (zie heavyRunner.ts / heavyWorker.mjs): voert
 * backtests, optimalisaties en walk-forwards uit met de echte modules.
 */
import { parentPort } from "node:worker_threads";
import { runBacktest, type BacktestInput } from "../backtest/backtester";
import { optimize } from "../backtest/optimizer";
import { walkForward, type WalkForwardOptions } from "../backtest/walkForward";
import type { HeavyRequest, HeavyResponse } from "./heavyRunner";

type OptimizeOpts = Parameters<typeof optimize>[1];

function execute(req: HeavyRequest): unknown {
  const input = req.input as BacktestInput;
  switch (req.kind) {
    case "backtest":
      return runBacktest(input);
    case "optimize":
      return optimize(input, req.opts as OptimizeOpts);
    case "walkForward":
      return walkForward(input, req.opts as WalkForwardOptions);
    default:
      throw new Error(`Onbekende berekening: ${String(req.kind)}`);
  }
}

const port = parentPort;
if (port) {
  port.on("message", (req: HeavyRequest) => {
    let reply: HeavyResponse;
    try {
      reply = { id: req.id, ok: true, result: execute(req) };
    } catch (err) {
      const e = err instanceof Error ? err : new Error(String(err));
      reply = { id: req.id, ok: false, error: { name: e.name, message: e.message } };
    }
    try {
      port.postMessage(reply);
    } catch (err) {
      port.postMessage({
        id: req.id,
        ok: false,
        error: { name: "Error", message: `Resultaat kon niet worden teruggestuurd: ${(err as Error).message}` },
      } satisfies HeavyResponse);
    }
  });
}
