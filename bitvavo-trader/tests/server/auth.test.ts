import { afterEach, describe, expect, it } from "vitest";
import { tokensEqual } from "../../src/server/httpServer";
import { json, rawGet, startTestServer, type TestServer } from "./helpers";

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
});
