import { afterEach, describe, expect, it } from "vitest";
import { formatSse, SseHub } from "../../src/server/sse";
import { startTestServer, type TestServer } from "./helpers";

let srv: TestServer | null = null;
afterEach(async () => {
  await srv?.close();
  srv = null;
});

interface Parsed {
  event: string;
  data: any;
}

/** Leest SSE-events van een fetch-response. */
function sseReader(res: Response) {
  const reader = res.body!.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  const events: Parsed[] = [];
  const comments: string[] = [];
  let done = false;
  const pump = (async () => {
    try {
      for (;;) {
        const { value, done: d } = await reader.read();
        if (d) break;
        buffer += decoder.decode(value, { stream: true });
        let idx: number;
        while ((idx = buffer.indexOf("\n\n")) >= 0) {
          const block = buffer.slice(0, idx);
          buffer = buffer.slice(idx + 2);
          let event = "message";
          const data: string[] = [];
          for (const line of block.split("\n")) {
            if (line.startsWith(":")) comments.push(line);
            else if (line.startsWith("event: ")) event = line.slice(7);
            else if (line.startsWith("data: ")) data.push(line.slice(6));
          }
          if (data.length > 0) events.push({ event, data: JSON.parse(data.join("\n")) });
        }
      }
    } catch {
      /* afgebroken */
    }
    done = true;
  })();
  return {
    events,
    comments,
    get done() {
      return done;
    },
    pump,
    async waitFor(pred: (e: Parsed[]) => boolean, ms = 2000) {
      const start = Date.now();
      while (!pred(events)) {
        if (Date.now() - start > ms) throw new Error(`timeout; events: ${events.map((e) => e.event).join(",")}`);
        await new Promise((r) => setTimeout(r, 10));
      }
    },
  };
}

describe("SSE /api/events", () => {
  it("stuurt direct een snapshot en daarna engine-events", async () => {
    srv = await startTestServer();
    const ac = new AbortController();
    const res = await fetch(`${srv.base}/api/events`, { signal: ac.signal });
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("text/event-stream; charset=utf-8");
    expect(res.headers.get("cache-control")).toContain("no-cache");
    const r = sseReader(res);
    await r.waitFor((e) => e.length >= 1);
    expect(r.events[0].event).toBe("snapshot");
    expect(r.events[0].data.mode).toBe("paper");

    srv.engine.emit("log", { time: 1, level: "info", message: "Hallo" });
    srv.engine.emit("price", { market: "BTC-EUR", price: 123, time: 2 });
    srv.engine.emit("position-closed", { id: "t1", pnlQuote: 1 });
    srv.engine.emit("niet-bestaand", { x: 1 });
    await r.waitFor((e) => e.length >= 4);
    expect(r.events.slice(1).map((e) => e.event)).toEqual(["log", "price", "position-closed"]);
    expect(r.events[1].data.message).toBe("Hallo");
    expect(r.events[2].data.price).toBe(123);

    expect(srv.server.app.hub.size).toBe(1);
    ac.abort();
    for (let i = 0; i < 100 && srv.server.app.hub.size > 0; i++) await new Promise((res) => setTimeout(res, 10));
    expect(srv.server.app.hub.size).toBe(0);
  });

  it("throttlet snapshots tot ~2 per seconde per client, laatste wint", async () => {
    srv = await startTestServer();
    const ac = new AbortController();
    const res = await fetch(`${srv.base}/api/events`, { signal: ac.signal });
    const r = sseReader(res);
    await r.waitFor((e) => e.length >= 1);
    for (let i = 0; i < 10; i++) srv.engine.emit("snapshot", { n: i });
    await new Promise((res) => setTimeout(res, 150));
    // eerste snapshot (initieel) is net verstuurd → nieuwe worden uitgesteld
    expect(r.events.filter((e) => e.event === "snapshot")).toHaveLength(1);
    await r.waitFor((e) => e.filter((x) => x.event === "snapshot").length >= 2, 1500);
    await new Promise((res) => setTimeout(res, 700));
    const snaps = r.events.filter((e) => e.event === "snapshot");
    expect(snaps).toHaveLength(2);
    expect(snaps[1].data).toEqual({ n: 9 });
    ac.abort();
  });
});

describe("SseHub", () => {
  it("formatteert events en vervangt NaN door null", () => {
    expect(formatSse("price", { a: 1, b: NaN })).toBe('event: price\ndata: {"a":1,"b":null}\n\n');
  });

  it("stuurt heartbeat-commentaar", async () => {
    const hub = new SseHub({ heartbeatMs: 30 });
    const { createServer } = await import("node:http");
    const server = createServer((req, res) => hub.addClient(req, res));
    await new Promise<void>((r) => server.listen(0, "127.0.0.1", () => r()));
    const port = (server.address() as { port: number }).port;
    const ac = new AbortController();
    const res = await fetch(`http://127.0.0.1:${port}/`, { signal: ac.signal });
    const r = sseReader(res);
    const start = Date.now();
    while (r.comments.length < 2 && Date.now() - start < 2000) await new Promise((res) => setTimeout(res, 10));
    expect(r.comments.length).toBeGreaterThanOrEqual(2);
    expect(r.comments[0]).toMatch(/^: heartbeat/);
    ac.abort();
    hub.close();
    server.closeAllConnections();
    await new Promise<void>((r) => server.close(() => r()));
  });
});
