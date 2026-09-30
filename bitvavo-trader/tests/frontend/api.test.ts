/** public/js/api.js: de nieuwe routes (bevestigen, afschrijven) met een nep-fetch. */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { installBrowserGlobals, loadPublic } from "./helpers";

let env: ReturnType<typeof installBrowserGlobals>;
const calls: { url: string; method: string; body: unknown }[] = [];
beforeEach(() => {
  env = installBrowserGlobals();
  calls.length = 0;
  vi.stubGlobal("fetch", async (url: string, init: { method: string; body?: string }) => {
    calls.push({ url, method: init.method, body: init.body });
    return { ok: true, status: 200, text: async () => JSON.stringify({ ok: 1 }) };
  });
});
afterEach(() => {
  vi.unstubAllGlobals();
  env.restore();
});

describe("api: nieuwe routes", () => {
  it("ackUnknownOrders → POST /api/live/unknown-orders/ack", async () => {
    const { api } = await loadPublic("js/api.js");
    await expect(api.ackUnknownOrders()).resolves.toEqual({ ok: 1 });
    expect(calls).toEqual([{ url: "/api/live/unknown-orders/ack", method: "POST", body: undefined }]);
  });

  it("ackStateRecovery → POST /api/state/recovery/ack", async () => {
    const { api } = await loadPublic("js/api.js");
    await api.ackStateRecovery();
    expect(calls).toEqual([{ url: "/api/state/recovery/ack", method: "POST", body: undefined }]);
  });

  it("writeOffPosition(id) → POST /api/positions/:id/writeoff (id ge-encodeerd)", async () => {
    const { api } = await loadPublic("js/api.js");
    await api.writeOffPosition("pos_1/x");
    expect(calls).toEqual([{ url: "/api/positions/pos_1%2Fx/writeoff", method: "POST", body: undefined }]);
  });

  it("getDecision(market) → GET /api/decision?market=… (ge-encodeerd)", async () => {
    const { api } = await loadPublic("js/api.js");
    await api.getDecision("BTC-EUR");
    await api.getDecision("A B/C");
    expect(calls).toEqual([
      { url: "/api/decision?market=BTC-EUR", method: "GET", body: undefined },
      { url: "/api/decision?market=A%20B%2FC", method: "GET", body: undefined },
    ]);
  });

  it("een serverfout komt als ApiError met de Nederlandse melding terug", async () => {
    vi.stubGlobal("fetch", async () => ({
      ok: false,
      status: 409,
      text: async () => JSON.stringify({ error: "Afschrijven kan alleen voor een onverkoopbare positie" }),
    }));
    const { api, ApiError } = await loadPublic("js/api.js");
    const err = await api.writeOffPosition("p1").catch((e: Error) => e);
    expect(err).toBeInstanceOf(ApiError);
    expect(err.status).toBe(409);
    expect(err.message).toBe("Afschrijven kan alleen voor een onverkoopbare positie");
  });
});

describe("api: meerdere bots (v3) — BASE uit location.pathname", () => {
  const g = globalThis as Record<string, unknown>;
  let hadLocation: boolean;
  let savedLocation: unknown;
  beforeEach(() => {
    hadLocation = "location" in g;
    savedLocation = g.location;
  });
  afterEach(() => {
    if (hadLocation) g.location = savedLocation;
    else delete g.location;
  });
  const at = (pathname: string) => {
    g.location = { pathname, hash: "#live" };
  };

  it("basePath: /bot/<id> alleen voor een veilige id aan het begin van het pad", async () => {
    const { basePath, baseBotId } = await loadPublic("js/api.js");
    expect(basePath("/bot/trend/")).toBe("/bot/trend");
    expect(basePath("/bot/trend")).toBe("/bot/trend");
    expect(basePath("/bot/scalper/index.html")).toBe("/bot/scalper");
    expect(basePath("/bot/my_bot-2/")).toBe("/bot/my_bot-2");
    for (const p of ["/", "", "/index.html", "/bot/", "/bot", "/botx/trend/", "/x/bot/trend/", "/bot/a%20b/", "/bot/../x", "/bot/tr.end/"]) {
      expect(basePath(p), p).toBe("");
    }
    expect(basePath(undefined)).toBe("");
    expect(baseBotId("/bot/dip/")).toBe("dip");
    expect(baseBotId("/")).toBe("");
  });

  it("onder /bot/<id>/: elk verzoek voor deze bot krijgt de BASE", async () => {
    at("/bot/dip/");
    const { api, apiBase } = await loadPublic("js/api.js");
    expect(apiBase()).toBe("/bot/dip");
    await api.info();
    await api.getState();
    await api.putConfig({ pollMs: 1 });
    await api.start();
    await api.kill();
    await api.closePosition("p/1");
    await api.getCandles("BTC-EUR", "15m", 10);
    await api.backtest({ market: "BTC-EUR" });
    expect(calls.map((c) => `${c.method} ${c.url}`)).toEqual([
      "GET /bot/dip/api/info",
      "GET /bot/dip/api/state",
      "PUT /bot/dip/api/config",
      "POST /bot/dip/api/engine/start",
      "POST /bot/dip/api/engine/kill",
      "POST /bot/dip/api/positions/p%2F1/close",
      "GET /bot/dip/api/candles?market=BTC-EUR&interval=15m&limit=10",
      "POST /bot/dip/api/backtest",
    ]);
  });

  it("wedstrijdroutes gaan altijd naar de root, ook vanaf /bot/<id>/", async () => {
    at("/bot/trend/");
    const { api } = await loadPublic("js/api.js");
    await api.getBots();
    await api.startAll();
    await api.stopAll();
    await api.killAll();
    expect(calls.map((c) => `${c.method} ${c.url}`)).toEqual([
      "GET /api/bots",
      "POST /api/bots/start-all",
      "POST /api/bots/stop-all",
      "POST /api/bots/kill-all",
    ]);
  });

  it("op de root (of zonder location): geen BASE, zoals vroeger", async () => {
    at("/");
    const { api } = await loadPublic("js/api.js");
    await api.getState();
    delete g.location;
    await api.getMarkets();
    expect(calls.map((c) => c.url)).toEqual(["/api/state", "/api/markets"]);
  });

  it("SSE-stream onder /bot/<id>/ (met en zonder token)", async () => {
    const urls: string[] = [];
    class FakeEventSource {
      onopen: unknown = null;
      onerror: unknown = null;
      constructor(url: string) {
        urls.push(url);
      }
      addEventListener() {}
      close() {}
    }
    vi.stubGlobal("EventSource", FakeEventSource);
    at("/bot/scalper/");
    const { connectEvents } = await loadPublic("js/api.js");
    connectEvents(() => {});
    vi.stubGlobal("localStorage", { getItem: () => "geheim token", setItem() {}, removeItem() {} });
    connectEvents(() => {});
    at("/");
    connectEvents(() => {});
    expect(urls).toEqual(["/bot/scalper/api/events", "/bot/scalper/api/events?token=geheim%20token", "/api/events?token=geheim%20token"]);
  });

  it("de bestaande exports blijven bestaan", async () => {
    const mod = await loadPublic("js/api.js");
    for (const k of ["api", "connectEvents", "setToken", "ApiError", "EVENT_TYPES", "BASE", "basePath", "apiBase"]) expect(mod, k).toHaveProperty(k);
    for (const m of ["info", "getState", "getConfig", "putConfig", "start", "stop", "kill", "closePosition", "writeOffPosition", "arm", "disarm", "ackUnknownOrders", "ackStateRecovery", "resetPaper", "getMarkets", "getCandles", "getDecision", "getScanner", "getStrategies", "backtest", "optimize", "walkForward", "getBots", "startAll", "stopAll", "killAll"]) {
      expect(typeof mod.api[m], m).toBe("function");
    }
  });
});
