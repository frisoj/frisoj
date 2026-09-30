import { EventEmitter } from "node:events";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { LogEntry } from "../../src/core/types";
import { combineEngines, createShutdown } from "../../src/server/shutdown";
import { attachTerminalLog, printLogEntry } from "../../src/server/terminalLog";

class FakeLogSource extends EventEmitter {
  constructor(public logs: LogEntry[]) {
    super();
  }
  snapshot() {
    return { logs: this.logs.map((l) => ({ ...l })) };
  }
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("terminal-log met de naam van de bot ervoor", () => {
  it("printLogEntry met voorvoegsel: [Scalper] vooraan elke regel; zonder voorvoegsel zoals vroeger", () => {
    const lines: string[] = [];
    const sink = { log: (m: string) => lines.push(m), warn: (m: string) => lines.push(m), error: (m: string) => lines.push(m) };
    printLogEntry({ time: 0, level: "trade", message: "KOOP BTC-EUR" }, sink, "Scalper");
    printLogEntry({ time: 0, level: "warn", message: "let op" }, sink, "Trend");
    printLogEntry({ time: 0, level: "error", message: "fout" }, sink, "Dip");
    printLogEntry({ time: 0, level: "info", message: "info" }, sink, "Dip");
    printLogEntry({ time: 0, level: "trade", message: "zonder" }, sink);
    expect(lines).toHaveLength(4);
    expect(lines[0]).toMatch(/^\[Scalper\] \[[^\]]+\] € KOOP BTC-EUR$/);
    expect(lines[1]).toMatch(/^\[Trend\] \[[^\]]+\] ⚠ let op$/);
    expect(lines[2]).toMatch(/^\[Dip\] \[[^\]]+\] ✖ fout$/);
    expect(lines[3]).toMatch(/^\[[^\]]+\] € zonder$/);
  });

  it("attachTerminalLog(engine, 'Scalper'): eerdere en nieuwe regels met het voorvoegsel; functie werkt nog zoals vroeger", () => {
    const out: string[] = [];
    vi.spyOn(console, "log").mockImplementation((m: string) => void out.push(m));
    vi.spyOn(console, "warn").mockImplementation((m: string) => void out.push(m));
    vi.spyOn(console, "error").mockImplementation((m: string) => void out.push(m));
    const source = new FakeLogSource([{ time: 1, level: "error", message: "al gebeurd" }]);
    attachTerminalLog(source, "Scalper");
    source.emit("log", { time: 2, level: "trade", message: "KOOP ETH-EUR" });
    expect(out).toHaveLength(2);
    expect(out[0]).toMatch(/^\[Scalper\] .*✖ al gebeurd$/);
    expect(out[1]).toMatch(/^\[Scalper\] .*€ KOOP ETH-EUR$/);

    const printed: LogEntry[] = [];
    const other = new FakeLogSource([{ time: 1, level: "warn", message: "w" }]);
    attachTerminalLog(other, (e) => printed.push(e));
    expect(printed.map((e) => e.message)).toEqual(["w"]);
  });
});

describe("afsluiten met meerdere engines", () => {
  function engine(opts: { stopMs?: number; fail?: string; inFlight?: unknown } = {}) {
    const e = {
      stopped: 0,
      monitorStopped: 0,
      orderInFlight: opts.inFlight === undefined ? false : opts.inFlight,
      stopPriceMonitor() {
        e.monitorStopped++;
      },
      async stop() {
        await new Promise((r) => setTimeout(r, opts.stopMs ?? 0));
        if (opts.fail) throw new Error(opts.fail);
        e.stopped++;
      },
    };
    return e;
  }

  it("stopAll zet de koersbewaking uit en stopt ALLE engines, ook als er een faalt", async () => {
    const a = engine({ stopMs: 20 });
    const b = engine({ fail: "schijf vol" });
    const c = engine();
    const warnings: string[] = [];
    const combo = combineEngines([a, b, c], { warn: (m) => warnings.push(m), names: ["Scalper", "Trend", "Dip"] });
    await expect(combo.stopAll()).rejects.toThrow("Trend: schijf vol");
    expect([a.stopped, b.stopped, c.stopped]).toEqual([1, 0, 1]);
    expect([a.monitorStopped, b.monitorStopped, c.monitorStopped]).toEqual([1, 1, 1]);
    expect(warnings).toEqual(["Fout bij stoppen van Trend: schijf vol"]);
    await expect(combineEngines([engine(), engine()]).stopAll()).resolves.toBeUndefined();
  });

  it("orderInFlight: true als één engine een order heeft lopen; onbekend als een engine het niet weet; anders false", () => {
    const a = engine();
    const b = engine();
    const combo = combineEngines([a, b]);
    expect(combo.orderInFlight()).toBe(false);
    b.orderInFlight = true;
    expect(combo.orderInFlight()).toBe(true);
    b.orderInFlight = false;
    const unknown = combineEngines([a, { stop: async () => {} }]);
    expect(unknown.orderInFlight()).toBeUndefined();
    const sure = combineEngines([{ stop: async () => {} }, { ...engine(), orderInFlight: true }]);
    expect(sure.orderInFlight()).toBe(true);
  });

  it("met createShutdown: live wacht zolang één van de engines een order heeft lopen", async () => {
    const live = engine({ stopMs: 80, inFlight: true });
    const paper = engine();
    const combo = combineEngines([paper, live]);
    const exits: number[] = [];
    const lines: string[] = [];
    const ctl = createShutdown({
      mode: "live",
      stopEngine: async () => {
        await combo.stopAll();
        live.orderInFlight = false;
      },
      cleanup: async () => {},
      orderInFlight: combo.orderInFlight,
      exit: (code) => exits.push(code),
      log: (m) => lines.push(m),
      warn: (m) => lines.push(m),
      loud: (ls) => lines.push(...ls),
      forceExitMs: 20,
      orderWaitMaxMs: 2_000,
      orderPollMs: 5,
    });
    await ctl.shutdown("SIGINT");
    expect(exits).toEqual([0]);
    expect(lines.join("\n")).toMatch(/Er loopt nog een order bij Bitvavo/);
    expect([paper.stopped, live.stopped]).toEqual([1, 1]);
  });
});
