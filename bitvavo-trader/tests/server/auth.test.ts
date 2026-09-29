import { connect } from "node:net";
import { afterEach, describe, expect, it } from "vitest";
import { hostnameOf, isLoopbackHost, tokensEqual } from "../../src/server/httpServer";
import { json, rawGet, rawRequest, startTestServer, type TestServer } from "./helpers";

/** Ruw verzoek over een socket (bijv. HTTP/1.0 zonder Host-header); geeft statusregel + body. */
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
    for (const h of [
      "127.0.0.1",
      "127.0.0.2",
      "127.255.255.254",
      "localhost",
      "LOCALHOST",
      "::1",
      "[::1]",
      " 127.0.0.1 ",
      // IPv6-loopback in andere schrijfwijzen
      "0:0:0:0:0:0:0:1",
      "[0:0:0:0:0:0:0:1]",
      "0000:0000:0000:0000:0000:0000:0000:0001",
      "::0:1",
      "0::1",
    ]) {
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
      "::2",
      "1::",
      "0:0:0:0:0:0:1:0",
      "[::1",
      "::1]",
      "[::]",
      "::1%lo",
      "",
    ]) {
      expect(isLoopbackHost(h), h).toBe(false);
    }
  });

  it("hostnameOf haalt de poort eraf, ook bij IPv6", () => {
    expect(hostnameOf("localhost:4321")).toBe("localhost");
    expect(hostnameOf("[::1]:4321")).toBe("[::1]");
    expect(hostnameOf("[0:0:0:0:0:0:0:1]:4321")).toBe("[0:0:0:0:0:0:0:1]");
    expect(hostnameOf("[::1]")).toBe("[::1]");
    expect(hostnameOf("127.0.0.1")).toBe("127.0.0.1");
    expect(hostnameOf("LOCALHOST:4321")).toBe("localhost");
    expect(hostnameOf(" localhost:4321 ")).toBe("localhost");
    expect(hostnameOf("localhost:65535")).toBe("localhost");
  });

  it("hostnameOf parset strikt: alleen naam, naam:poort, [ipv6] of [ipv6]:poort", () => {
    for (const h of [
      // tekst na de host / niet-numerieke of lege poort
      "localhost:4321x",
      "localhost:abc",
      "localhost:",
      "localhost:4321:80",
      "localhost:4321/pad",
      "localhost:+80",
      "localhost:65536",
      "localhost:123456",
      "localhost:4321 evil",
      // "@" en spaties
      "localhost@evil.example",
      "evil.example@localhost",
      "user@localhost:4321",
      "local host",
      "localhost :4321",
      "localhost\t:4321",
      // IPv6-varianten
      "[::1].evil.example",
      "[::1]evil:4321",
      "[::1]:",
      "[::1]:43a21",
      "[::1]:4321x",
      "[::1:4321",
      "::1]:4321",
      "[::1%25lo]:4321",
      "[not-ipv6]:4321",
      "[]:4321",
      "::1", // IPv6 zonder haken: is geen geldige Host-header
      "0:0:0:0:0:0:0:1",
      "",
      ":4321",
    ]) {
      expect(hostnameOf(h), JSON.stringify(h)).toBeNull();
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
    for (const host of [
      `127.0.0.2:${srv.port}`,
      `[::1]:${srv.port}`,
      `[0:0:0:0:0:0:0:1]:${srv.port}`,
      `localhost:${srv.port}`,
      "127.0.0.1",
    ]) {
      const r = await rawGet(srv.port, "/api/info", { Host: host });
      expect(r.status, host).toBe(200);
    }
  });

  it("weigert Host-headers met rommel na de host, '@' of spaties (strikte parse)", async () => {
    srv = await startTestServer();
    const p = srv.port;
    for (const host of [
      `localhost:${p}x`,
      `localhost:${p} evil.example`,
      `127.0.0.1:${p}:80`,
      `localhost:${p}/x`,
      "localhost:",
      `localhost@evil.example:${p}`,
      `evil.example@localhost:${p}`,
      `local host:${p}`,
      `[::1].evil.example:${p}`,
      `[::1].evil.example`,
      `[::1]:${p}x`,
      "::1",
    ]) {
      const r = await rawGet(srv.port, "/api/info", { Host: host });
      expect(r.status, host).toBe(403);
      const kill = await rawRequest(srv.port, "POST", "/api/engine/kill", { Host: host });
      expect(kill.status, host).toBe(403);
      const page = await rawGet(srv.port, "/", { Host: host });
      expect(page.status, host).toBe(403);
    }
    expect(srv.engine.killed).toBe(0);
    // Loopback-normalisatie blijft: andere schrijfwijzen van ::1 en 127.x.y.z mogen wel
    for (const host of [
      "localhost",
      `LOCALHOST:${p}`,
      "[::1]",
      `[0000:0000:0000:0000:0000:0000:0000:0001]:${p}`,
      `[::0:1]:${p}`,
      `127.9.8.7:${p}`,
    ]) {
      const r = await rawGet(srv.port, "/api/info", { Host: host });
      expect(r.status, host).toBe(200);
    }
  });

  it("weigert verzoeken ZONDER Host-header als de Host-check geldt (400)", async () => {
    srv = await startTestServer();
    // HTTP/1.0 mag zonder Host: Node laat dat door, onze check niet.
    const api = await rawSocket(srv.port, "POST /api/engine/kill HTTP/1.0\r\nContent-Length: 0\r\n\r\n");
    expect(api.status).toBe(400);
    expect(JSON.parse(api.body).error).toMatch(/Host-header ontbreekt/);
    expect(srv.engine.killed).toBe(0);
    const page = await rawSocket(srv.port, "GET / HTTP/1.0\r\n\r\n");
    expect(page.status).toBe(400);
    const empty = await rawSocket(srv.port, "GET /api/info HTTP/1.0\r\nHost: \r\n\r\n");
    expect(empty.status).toBe(400);
    // HTTP/1.1 zonder Host weigert Node zelf al (ook 400)
    const v11 = await rawSocket(srv.port, "GET /api/info HTTP/1.1\r\nConnection: close\r\n\r\n");
    expect(v11.status).toBe(400);
    // Met een lokale Host-header werkt HTTP/1.0 gewoon
    const ok = await rawSocket(srv.port, `GET /api/info HTTP/1.0\r\nHost: 127.0.0.1:${srv.port}\r\n\r\n`);
    expect(ok.status).toBe(200);
  });

  it("zonder Host-check (niet op loopback gebonden) mag een verzoek zonder Host-header", async () => {
    srv = await startTestServer({ config: { host: "0.0.0.0" } });
    const r = await rawSocket(srv.port, "GET /api/info HTTP/1.0\r\n\r\n");
    expect(r.status).toBe(200);
  });

  it("HOST=0:0:0:0:0:0:0:1 telt als loopback: de Host-check (DNS-rebinding) staat aan", async () => {
    srv = await startTestServer({ config: { host: "0:0:0:0:0:0:0:1" } });
    const evil = await rawGet(srv.port, "/api/state", { Host: `evil.example:${srv.port}` });
    expect(evil.status).toBe(403);
    const local = await rawGet(srv.port, "/api/info", { Host: `[::1]:${srv.port}` });
    expect(local.status).toBe(200);
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
