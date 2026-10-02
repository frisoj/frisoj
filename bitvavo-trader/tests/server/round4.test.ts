/**
 * Ronde 4 — server:
 *  - twee Host-headers → 400 (Node houdt stilletjes de eerste; die mag de Host-check
 *    niet omzeilen), ook zonder Host-check (niet op loopback gebonden);
 *  - POST /api/engine/start tijdens een noodstop → 409 "Starten geblokkeerd: noodstop bezig";
 *  - POST /api/positions/:id/writeoff wacht op de (async) engine die op verse gegevens
 *    beslist: 409 als de positie met de verse koers verkoopbaar is of een noodstop loopt.
 */
import { connect } from "node:net";
import { afterEach, describe, expect, it } from "vitest";
import { Deferred, openBtcPosition, setup } from "../engine/helpers";
import { FakeEngine, json, startTestServer, type TestServer } from "./helpers";

/** Ruw verzoek over een socket (bijv. met twee Host-headers); geeft status + body. */
function rawSocket(port: number, request: string): Promise<{ status: number; body: string }> {
  return new Promise((resolve, reject) => {
    const sock = connect(port, "127.0.0.1");
    const chunks: Buffer[] = [];
    sock.on("data", (c: Buffer) => chunks.push(c));
    sock.on("error", reject);
    sock.on("close", () => {
      const text = Buffer.concat(chunks).toString("utf8");
      const status = Number(/^HTTP\/1\.[01] (\d{3})/.exec(text)?.[1] ?? 0);
      const idx = text.indexOf("\r\n\r\n");
      resolve({ status, body: idx >= 0 ? text.slice(idx + 4) : "" });
    });
    sock.write(request);
  });
}

async function waitFor(cond: () => boolean): Promise<void> {
  for (let i = 0; i < 1000 && !cond(); i++) await new Promise((r) => setImmediate(r));
  if (!cond()) throw new Error("waitFor: voorwaarde niet gehaald");
}

let srv: TestServer | null = null;
afterEach(async () => {
  await srv?.close();
  srv = null;
});

describe("Twee Host-headers", () => {
  it("→ 400, ook als beide lokaal zijn of met een andere schrijfwijze van de naam; één Host-header werkt gewoon", async () => {
    srv = await startTestServer();
    const local = `127.0.0.1:${srv.port}`;
    const cases = [
      `GET /api/info HTTP/1.1\r\nHost: ${local}\r\nHost: evil.example\r\nConnection: close\r\n\r\n`,
      `GET /api/info HTTP/1.1\r\nHost: evil.example\r\nHost: ${local}\r\nConnection: close\r\n\r\n`,
      `GET /api/info HTTP/1.1\r\nHost: ${local}\r\nHost: ${local}\r\nConnection: close\r\n\r\n`,
      `GET /api/info HTTP/1.1\r\nhost: ${local}\r\nHOST: localhost\r\nConnection: close\r\n\r\n`,
      `POST /api/engine/kill HTTP/1.1\r\nHost: ${local}\r\nHost: evil.example\r\nContent-Length: 0\r\nConnection: close\r\n\r\n`,
      `GET / HTTP/1.1\r\nHost: ${local}\r\nHost: evil.example\r\nConnection: close\r\n\r\n`,
    ];
    for (const req of cases) {
      const r = await rawSocket(srv.port, req);
      expect(r.status, req).toBe(400);
      expect(JSON.parse(r.body).error).toBe("Ongeldig verzoek: meer dan één Host-header.");
    }
    expect(srv.engine.killed).toBe(0);
    const ok = await rawSocket(srv.port, `GET /api/info HTTP/1.1\r\nHost: ${local}\r\nConnection: close\r\n\r\n`);
    expect(ok.status).toBe(200);
  });

  it("ook zonder Host-check (HOST niet op loopback): twee Host-headers → 400", async () => {
    srv = await startTestServer({ config: { host: "0.0.0.0" } });
    const r = await rawSocket(
      srv.port,
      "GET /api/info HTTP/1.1\r\nHost: a.example\r\nHost: b.example\r\nConnection: close\r\n\r\n",
    );
    expect(r.status).toBe(400);
    const ok = await rawSocket(srv.port, "GET /api/info HTTP/1.1\r\nHost: a.example\r\nConnection: close\r\n\r\n");
    expect(ok.status).toBe(200);
  });
});

describe("POST /api/engine/start tijdens een noodstop", () => {
  it("echte TradingEngine: 409 'Starten geblokkeerd: noodstop bezig'; de noodstop eindigt met een stilstaande bot", async () => {
    const h = setup();
    await openBtcPosition(h);
    const gate = new Deferred();
    const orig = h.broker.placeMarketOrder.bind(h.broker);
    let waiting = false;
    h.broker.placeMarketOrder = async (req, ref) => {
      waiting = true;
      await gate.promise;
      return orig(req, ref);
    };
    srv = await startTestServer({ deps: { engine: h.engine } });
    const killing = json(srv.base, "POST", "/api/engine/kill");
    await waitFor(() => waiting);
    const start = await json(srv.base, "POST", "/api/engine/start");
    expect(start.status).toBe(409);
    expect(start.data.error).toMatch(/^Starten geblokkeerd: noodstop bezig/);
    gate.resolve();
    const kill = await killing;
    expect(kill.status).toBe(200);
    expect(kill.data.killResult).toEqual({ closed: 1, failed: [] });
    expect(kill.data.running).toBe(false);
    expect(h.engine.isRunning).toBe(false);
    // Na de noodstop mag starten weer
    const again = await json(srv.base, "POST", "/api/engine/start");
    expect(again.status).toBe(200);
    expect(again.data.running).toBe(true);
    await h.engine.stop();
  });

  it("andere fouten bij starten blijven een interne fout (500)", async () => {
    const engine = new FakeEngine();
    engine.start = async () => {
      throw new Error("iets anders");
    };
    srv = await startTestServer({ engine });
    const r = await json(srv.base, "POST", "/api/engine/start");
    expect(r.status).toBe(500);
  });
});

describe("POST /api/positions/:id/writeoff met de echte (async) engine", () => {
  it("beslist op de verse koers: verouderd 'onverkoopbaar' maar nu €5,9x → 409; daarna onder €5 → 200 met de afschrijving", async () => {
    const h = setup();
    h.risk.quote = 6;
    h.risk.stopDist = 20_000;
    const pos = await openBtcPosition(h);
    h.feed.setLast("BTC-EUR", 40_000);
    h.clock.advance(15_000);
    await h.engine.tick();
    h.feed.setLast("BTC-EUR", 50_000); // geen tick: de snapshot zegt nog onverkoopbaar
    srv = await startTestServer({ deps: { engine: h.engine } });
    const state = await json(srv.base, "GET", "/api/state");
    expect(state.data.positions[0].unsellable).toBe(true);
    const refused = await json(srv.base, "POST", `/api/positions/${pos.id}/writeoff`);
    expect(refused.status).toBe(409);
    expect(refused.data.error).toMatch(/^Afschrijven kan alleen voor een onverkoopbare positie/);
    expect(h.engine.snapshot().positions).toHaveLength(1);

    h.feed.setLast("BTC-EUR", 40_000);
    const ok = await json(srv.base, "POST", `/api/positions/${pos.id}/writeoff`);
    expect(ok.status).toBe(200);
    expect(ok.data).toMatchObject({ exitReason: "write-off", exitPrice: 40_000, proceedsQuote: 0, pnlPct: -100 });
    const gone = await json(srv.base, "POST", `/api/positions/${pos.id}/writeoff`);
    expect(gone.status).toBe(404);
  });

  it("tijdens de noodstop → 409 'Afschrijven kan nu niet: de noodstop is bezig …'", async () => {
    const h = setup({ mode: "live", startingCapital: 50 });
    h.engine.arm();
    h.risk.quote = 6;
    h.risk.stopDist = 20_000;
    const pos = await openBtcPosition(h);
    h.feed.setLast("BTC-EUR", 40_000);
    const gate = new Deferred();
    const orig = h.broker.getBalances.bind(h.broker);
    let waiting = false;
    h.broker.getBalances = async () => {
      if (!waiting) {
        waiting = true;
        await gate.promise;
      }
      return orig();
    };
    srv = await startTestServer({ config: { mode: "live", apiKey: "k", apiSecret: "s", dataSource: "bitvavo" }, deps: { engine: h.engine } });
    const killing = h.engine.killSwitch();
    await waitFor(() => waiting);
    const r = await json(srv.base, "POST", `/api/positions/${pos.id}/writeoff`);
    expect(r.status).toBe(409);
    expect(r.data.error).toMatch(/^Afschrijven kan nu niet: de noodstop is bezig/);
    gate.resolve();
    const res = await killing;
    expect(res.closed).toBe(0);
    expect(res.failed).toHaveLength(1);
  });
});
