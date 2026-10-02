import { EventEmitter } from "node:events";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { PaperBroker } from "../../src/broker/paperBroker";
import { DEFAULT_ENGINE_CONFIG } from "../../src/core/defaults";
import type { LogEntry } from "../../src/core/types";
import { SimulatedFeed } from "../../src/data/simulatedFeed";
import { StateStore } from "../../src/engine/stateStore";
import { TradingEngine } from "../../src/engine/tradingEngine";
import { attachTerminalLog, printLogEntry } from "../../src/server/terminalLog";

/** Nep-engine: `logs` is (zoals in de snapshot) nieuwste eerst. */
class FakeLogSource extends EventEmitter {
  constructor(public logs: LogEntry[]) {
    super();
  }
  snapshot() {
    return { logs: this.logs.map((l) => ({ ...l })) };
  }
}

function collector() {
  const printed: LogEntry[] = [];
  return { printed, print: (e: LogEntry) => printed.push(e) };
}

describe("attachTerminalLog (main.ts: engine-logregels in de terminal)", () => {
  it("print eerst de al gelogde waarschuwingen/fouten, oudste eerst, en daarna nieuwe regels (zonder dubbele)", () => {
    const source = new FakeLogSource([
      { time: 5, level: "info", message: "info later" },
      { time: 4, level: "error", message: "fout 2" },
      { time: 3, level: "trade", message: "trade" },
      { time: 2, level: "warn", message: "waarschuwing 1" },
      { time: 1, level: "error", message: "fout 1" },
    ]);
    const { printed, print } = collector();
    attachTerminalLog(source, print);
    expect(printed.map((e) => e.message)).toEqual(["fout 1", "waarschuwing 1", "fout 2"]);

    const next: LogEntry = { time: 6, level: "warn", message: "nieuw" };
    source.logs.unshift(next);
    source.emit("log", next);
    expect(printed.map((e) => e.message)).toEqual(["fout 1", "waarschuwing 1", "fout 2", "nieuw"]);
    expect(source.listenerCount("log")).toBe(1);
  });

  it("bij gelijke tijd blijft de volgorde van de engine behouden (oudste eerst)", () => {
    const source = new FakeLogSource([
      { time: 7, level: "warn", message: "c" },
      { time: 7, level: "error", message: "b" },
      { time: 7, level: "warn", message: "a" },
    ]);
    const { printed, print } = collector();
    attachTerminalLog(source, print);
    expect(printed.map((e) => e.message)).toEqual(["a", "b", "c"]);
  });

  it("echte TradingEngine (zoals main.ts hem bouwt): 'Opgeslagen staat onbruikbaar …' uit de constructor komt in de terminal", async () => {
    const dir = mkdtempSync(join(tmpdir(), "bvt-termlog-"));
    const file = join(dir, "state-paper.json");
    writeFileSync(file, '{"version":1,"mode":"paper","acc'); // afgebroken schrijfactie
    const engine = new TradingEngine({
      feed: new SimulatedFeed(),
      broker: new PaperBroker({ startingQuote: 50, takerFee: 0.0025, slippagePct: 0.05 }),
      config: structuredClone(DEFAULT_ENGINE_CONFIG),
      mode: "paper",
      store: new StateStore(file),
      startingCapital: 50,
    });
    const { printed, print } = collector();
    attachTerminalLog(engine, print);
    const recovery = printed.filter((e) => e.message.startsWith("Opgeslagen staat onbruikbaar"));
    expect(recovery).toHaveLength(1);
    expect(recovery[0].level).toBe("error");
    expect(recovery[0].message).toContain("LEGE administratie");

    // Latere regels komen via de listener, precies één keer
    const before = printed.length;
    await engine.closePosition("pos_bestaat_niet");
    expect(printed.slice(before).map((e) => e.message)).toEqual(["Positie pos_bestaat_niet niet gevonden (al gesloten?)"]);
    expect(printed.filter((e) => e.message.startsWith("Opgeslagen staat onbruikbaar"))).toHaveLength(1);
    await engine.stop();
  });

  it("printLogEntry: fouten via error, waarschuwingen via warn, trades via log, info niet", () => {
    const out = { log: [] as string[], warn: [] as string[], error: [] as string[] };
    const sink = {
      log: (m: string) => out.log.push(m),
      warn: (m: string) => out.warn.push(m),
      error: (m: string) => out.error.push(m),
    };
    printLogEntry({ time: 0, level: "error", message: "E" }, sink);
    printLogEntry({ time: 0, level: "warn", message: "W" }, sink);
    printLogEntry({ time: 0, level: "trade", message: "T" }, sink);
    printLogEntry({ time: 0, level: "info", message: "I" }, sink);
    expect(out.error).toHaveLength(1);
    expect(out.error[0]).toMatch(/✖ E$/);
    expect(out.warn[0]).toMatch(/⚠ W$/);
    expect(out.log[0]).toMatch(/€ T$/);
    expect([...out.log, ...out.warn, ...out.error].some((m) => m.endsWith("I"))).toBe(false);
  });
});
