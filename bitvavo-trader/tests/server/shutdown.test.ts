import { describe, expect, it } from "vitest";
import { createShutdown, type ShutdownDeps } from "../../src/server/shutdown";

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

function setup(over: Partial<ShutdownDeps> & { stopMs?: number | null; inFlight?: () => boolean | undefined } = {}) {
  const exits: { code: number; at: number }[] = [];
  const lines: string[] = [];
  const t0 = Date.now();
  let releaseStop!: () => void;
  const stopGate = new Promise<void>((r) => (releaseStop = r));
  let cleanedUp = 0;
  const stopMs = over.stopMs === undefined ? 0 : over.stopMs;
  const ctl = createShutdown({
    mode: "live",
    stopEngine: async () => {
      if (stopMs === null) await stopGate; // hangt tot releaseStop()
      else await sleep(stopMs);
    },
    cleanup: async () => {
      cleanedUp++;
    },
    orderInFlight: over.inFlight ?? (() => false),
    exit: (code) => exits.push({ code, at: Date.now() - t0 }),
    log: (m) => lines.push(m),
    warn: (m) => lines.push(m),
    loud: (ls) => lines.push(...ls),
    forceExitMs: 50,
    orderWaitMaxMs: 400,
    orderPollMs: 10,
    ...over,
  });
  return { ctl, exits, lines, releaseStop, cleaned: () => cleanedUp };
}

describe("netjes afsluiten", () => {
  it("stopt de engine, ruimt op en sluit af met code 0", async () => {
    const s = setup({ mode: "paper" });
    await s.ctl.shutdown("SIGINT");
    expect(s.exits).toEqual([{ code: 0, at: expect.any(Number) }]);
    expect(s.cleaned()).toBe(1);
    expect(s.lines.join("\n")).toMatch(/SIGINT ontvangen[\s\S]*Tot ziens!/);
  });

  it("paper: hangt het stoppen, dan geforceerd na de noodrem; tweede Ctrl+C stopt direct", async () => {
    const s = setup({ mode: "paper", stopMs: null });
    void s.ctl.shutdown("SIGINT");
    await sleep(120);
    expect(s.exits.map((e) => e.code)).toEqual([1]);
    expect(s.lines.join("\n")).toMatch(/geforceerd gestopt/);

    const s2 = setup({ mode: "paper", stopMs: null });
    void s2.ctl.shutdown("SIGINT");
    await s2.ctl.shutdown("SIGINT");
    expect(s2.exits.map((e) => e.code)).toEqual([1]);
    expect(s2.lines.join("\n")).toMatch(/Geforceerd afsluiten/);
  });

  it("live: wacht op een lopende order in plaats van na 10 s te stoppen", async () => {
    let inFlight = true;
    const s = setup({ stopMs: null, inFlight: () => inFlight });
    const done = s.ctl.shutdown("SIGINT");
    await sleep(150); // ruim voorbij forceExitMs (50)
    expect(s.exits).toEqual([]);
    expect(s.lines.join("\n")).toMatch(/Er loopt nog een order bij Bitvavo/);
    // order afgerond → engine.stop() klaar → normale afsluiting
    inFlight = false;
    s.releaseStop();
    await done;
    expect(s.exits.map((e) => e.code)).toEqual([0]);
    expect(s.cleaned()).toBe(1);
  });

  it("live: tweede Ctrl+C tijdens een order waarschuwt, de derde stopt", async () => {
    const s = setup({ stopMs: null, inFlight: () => true, forceExitMs: 5_000 });
    void s.ctl.shutdown("SIGINT");
    await s.ctl.shutdown("SIGINT");
    expect(s.exits).toEqual([]);
    expect(s.lines.join("\n")).toMatch(/Druk nogmaals Ctrl\+C/);
    await s.ctl.shutdown("SIGINT");
    expect(s.exits.map((e) => e.code)).toEqual([1]);
    expect(s.lines.join("\n")).toMatch(/controleer je Bitvavo-account/);
  });

  it("live: harde bovengrens als de order nooit klaar komt", async () => {
    const s = setup({ stopMs: null, inFlight: () => true });
    void s.ctl.shutdown("SIGTERM");
    await sleep(200);
    expect(s.exits).toEqual([]);
    await sleep(400);
    expect(s.exits.map((e) => e.code)).toEqual([1]);
    expect(s.exits[0].at).toBeGreaterThanOrEqual(400);
    expect(s.lines.join("\n")).toMatch(/controleer je Bitvavo-account/);
  });

  it("live zonder lopende order: gewone noodrem na forceExitMs", async () => {
    const s = setup({ stopMs: null, inFlight: () => false });
    void s.ctl.shutdown("SIGINT");
    await sleep(120);
    expect(s.exits.map((e) => e.code)).toEqual([1]);
    expect(s.lines.join("\n")).not.toMatch(/Er loopt nog een order/);
  });

  it("live, engine zonder orderInFlight-vlag: wacht zolang engine.stop() loopt", async () => {
    const s = setup({ stopMs: null, inFlight: () => undefined });
    const done = s.ctl.shutdown("SIGHUP");
    await sleep(150);
    expect(s.exits).toEqual([]);
    s.releaseStop();
    await done;
    expect(s.exits.map((e) => e.code)).toEqual([0]);
  });
});
