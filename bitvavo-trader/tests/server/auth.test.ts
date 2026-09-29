import { afterEach, describe, expect, it } from "vitest";
import { isLoopbackHost, tokensEqual } from "../../src/server/httpServer";
import { json, rawGet, rawRequest, startTestServer, type TestServer } from "./helpers";

let srv: TestServer | null = null;
afterEach(async () => {
  await srv?.close();
  srv = null;
});

const TOKEN = "super-geheim-123";

describe("dashboard-token", () => {
  it("vereist de token op /api/* maar niet op statische bestanden", async () => {
    srv = await startTestServer({ config: { dashboardToken: TOKEN } });
    const none = await json(srv.base, "GET", "/api/state");
    expect(none.status).toBe(401);
    expect(none.data.error).toMatch(/token/);

    const wrong = await json(srv.base, "GET", "/api/state", undefined, { "x-dashboard-token": "fout" });
    expect(wrong.status).toBe(401);

    const ok = await json(srv.base, "GET", "/api/state", undefined, { "x-dashboard-token": TOKEN });
    expect(ok.status).toBe(200);

    // ?token= alleen voor de SSE-stream
    const q = await json(srv.base, "GET", `/api/state?token=${TOKEN}`);
    expect(q.status).toBe(401);

    const page = await fetch(srv.base + "/");
    expect(page.status).toBe(200);
    await page.arrayBuffer();
  });

  it("accepteert ?token= voor /api/events", async () => {
    srv = await startTestServer({ config: { dashboardToken: TOKEN } });
    const bad = await fetch(`${srv.base}/api/events?token=fout`);
    expect(bad.status).toBe(401);
    await bad.arrayBuffer();

    const ac = new AbortController();
    const res = await fetch(`${srv.base}/api/events?token=${encodeURIComponent(TOKEN)}`, { signal: ac.signal });
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toMatch(/text\/event-stream/);
    ac.abort();
  });

  it("zonder token is de API open", async () => {
    srv = await startTestServer();
    const r = await json(srv.base, "GET", "/api/info");
    expect(r.status).toBe(200);
  });

  it("tokensEqual vergelijkt correct", () => {
    expect(tokensEqual("abc", "abc")).toBe(true);
    expect(tokensEqual("abc", "abd")).toBe(false);
    expect(tokensEqual("abc", "abcd")).toBe(false);
  });
});

describe("bescherming tegen andere websites", () => {
  it("weigert vreemde Host-headers (DNS-rebinding)", async () => {
    srv = await startTestServer();
    const evil = await rawGet(srv.port, "/api/state", { Host: "evil.example:4321" });
    expect(evil.status).toBe(403);
    const local = await rawGet(srv.port, "/api/info", { Host: `localhost:${srv.port}` });
    expect(local.status).toBe(200);
  });

  it("weigert wijzigende verzoeken met een vreemde Origin", async () => {
    srv = await startTestServer();
    const evil = await json(srv.base, "POST", "/api/engine/kill", undefined, { Origin: "http://evil.example" });
    expect(evil.status).toBe(403);
    expect(srv.engine.killed).toBe(0);
    const same = await json(srv.base, "POST", "/api/engine/kill", undefined, { Origin: srv.base });
    expect(same.status).toBe(200);
    expect(srv.engine.killed).toBe(1);
  });

  it("isLoopbackHost accepteert alleen echte loopback-adressen", () => {
    for (const h of ["127.0.0.1", "127.0.0.2", "127.255.255.254", "localhost", "LOCALHOST", "::1", "[::1]", " 127.0.0.1 "]) {
      expect(isLoopbackHost(h), h).toBe(true);
    }
    for (const h of [
      "127.attacker.example",
      "127.0.0.1.nip.io",
      "127.evil.com",
      "127.0.0.256",
      "127.0.0",
      "127.0.0.1.",
      "0.0.0.0",
      "::",
      "192.168.1.50",
      "evil.example",
      "localhost.evil.example",
    ]) {
      expect(isLoopbackHost(h), h).toBe(false);
    }
  });

  it("weigert DNS-rebinding met een hostnaam die met 127. begint", async () => {
    srv = await startTestServer();
    for (const host of [`127.attacker.example:${srv.port}`, `127.0.0.1.nip.io:${srv.port}`, "127.evil.com"]) {
      const r = await rawGet(srv.port, "/api/state", { Host: host });
      expect(r.status, host).toBe(403);
    }
    // Host én Origin gelijk (zoals bij rebinding): de CSRF-check helpt dan niet, de Host-check wel
    const host = `127.attacker.example:${srv.port}`;
    const kill = await rawRequest(srv.port, "POST", "/api/engine/kill", { Host: host, Origin: `http://${host}` });
    expect(kill.status).toBe(403);
    expect(srv.engine.killed).toBe(0);
    const arm = await rawRequest(
      srv.port,
      "POST",
      "/api/live/arm",
      { Host: host, Origin: `http://${host}` },
      JSON.stringify({ confirm: "IK BEGRIJP HET RISICO" }),
    );
    expect(arm.status).toBe(403);
    expect(srv.engine.armed).toBe(false);
  });

  it("staat echte loopback-hosts toe (127.0.0.2, [::1], localhost)", async () => {
    srv = await startTestServer();
    for (const host of [`127.0.0.2:${srv.port}`, `[::1]:${srv.port}`, `localhost:${srv.port}`, "127.0.0.1"]) {
      const r = await rawGet(srv.port, "/api/info", { Host: host });
      expect(r.status, host).toBe(200);
    }
  });

  it("weigert cross-site GET's (Sec-Fetch-Site) zonder Bitvavo aan te roepen", async () => {
    srv = await startTestServer();
    for (const site of ["cross-site", "same-site"]) {
      for (const path of ["/api/scanner?limit=5", "/api/candles?market=BTC-EUR&interval=15m", "/api/state"]) {
        const r = await rawGet(srv.port, path, { "Sec-Fetch-Site": site, "Sec-Fetch-Mode": "no-cors" });
        expect(r.status, `${site} ${path}`).toBe(403);
        expect(JSON.parse(r.body).error).toMatch(/andere website/);
      }
    }
    expect(srv.feed.candleCalls).toHaveLength(0);
    expect(srv.feed.tickerCalls).toBe(0);
    // Ook de SSE-stream
    const sse = await rawGet(srv.port, "/api/events", { "Sec-Fetch-Site": "cross-site" });
    expect(sse.status).toBe(403);
    // Eigen dashboard (same-origin) en de adresbalk (none) mogen wel
    const same = await rawGet(srv.port, "/api/candles?market=BTC-EUR&interval=15m", { "Sec-Fetch-Site": "same-origin" });
    expect(same.status).toBe(200);
    const typed = await rawGet(srv.port, "/api/info", { "Sec-Fetch-Site": "none" });
    expect(typed.status).toBe(200);
    // Statische bestanden blijven gewoon bereikbaar
    const page = await rawGet(srv.port, "/", { "Sec-Fetch-Site": "cross-site" });
    expect(page.status).toBe(200);
  });

  it("controleert de Origin ook bij GET-verzoeken", async () => {
    srv = await startTestServer();
    const evil = await rawGet(srv.port, "/api/scanner?limit=3", { Origin: "https://evil.example" });
    expect(evil.status).toBe(403);
    const nul = await rawGet(srv.port, "/api/state", { Origin: "null" });
    expect(nul.status).toBe(403);
    expect(srv.feed.candleCalls).toHaveLength(0);
    const same = await rawGet(srv.port, "/api/info", { Origin: srv.base });
    expect(same.status).toBe(200);
    const cross = await rawRequest(srv.port, "POST", "/api/engine/kill", { "Sec-Fetch-Site": "cross-site" });
    expect(cross.status).toBe(403);
    expect(srv.engine.killed).toBe(0);
  });
});
