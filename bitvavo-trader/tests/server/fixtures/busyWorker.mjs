// Test-worker voor HeavyRunner: blokkeert zijn EIGEN thread `input.ms` milliseconden.
import { parentPort } from "node:worker_threads";

parentPort.on("message", (req) => {
  if (req.kind === "crash") process.exit(3);
  if (req.kind === "fail") {
    parentPort.postMessage({ id: req.id, ok: false, error: { name: "RangeError", message: "kapot" } });
    return;
  }
  const end = Date.now() + (req.input?.ms ?? 0);
  while (Date.now() < end) {
    // bezig
  }
  parentPort.postMessage({ id: req.id, ok: true, result: { kind: req.kind, input: req.input, opts: req.opts } });
});
