/** public/js/api.js: de nieuwe routes (bevestigen, afschrijven) met een nep-fetch. */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { installBrowserGlobals, loadPublic, type Fake } from "./helpers";

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

// Ronde 6: een browser opent maar 6 verbindingen per server. Elk dashboard-tabblad hield
// een live-verbinding (SSE) open; met het overzicht + 4 bots + 1 tabblad kwam GEEN enkel
// verzoek meer aan, ook de noodstop niet (die ging pas minuten later alsnog de deur uit).
describe("api: nooit eindeloos wachten (tijdslimiet per verzoek)", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  /** fetch die nooit antwoordt (verzoek staat in de wachtrij van de browser), maar wel afgebroken kan worden */
  function hangingFetch() {
    const seen: { url: string; aborted: () => boolean }[] = [];
    vi.stubGlobal("fetch", (url: string, init: { signal?: AbortSignal }) => {
      seen.push({ url, aborted: () => !!init.signal?.aborted });
      return new Promise((_resolve, reject) => {
        init.signal?.addEventListener("abort", () => reject(new DOMException("The operation was aborted.", "AbortError")));
      });
    });
    return seen;
  }

  it("noodstop zonder antwoord: na de limiet afgebroken met een duidelijke Nederlandse fout (gaat dus ook niet later alsnog weg)", async () => {
    vi.useFakeTimers();
    const seen = hangingFetch();
    const { api, ApiError, ACTION_TIMEOUT_MS } = await loadPublic("js/api.js");
    const p = api.killAll().catch((e: Error) => e);
    await vi.advanceTimersByTimeAsync(ACTION_TIMEOUT_MS - 1);
    expect(seen[0].aborted()).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    const err = await p;
    expect(err).toBeInstanceOf(ApiError);
    expect(err.timeout).toBe(true);
    expect(err.status).toBe(0);
    expect(err.message).toBe(
      "Geen antwoord van de server binnen 90 seconden. Misschien is de opdracht toch uitgevoerd: controleer de status en de posities. " +
        "Staan er veel dashboard-tabbladen open? Sluit er een paar en probeer het opnieuw.",
    );
    expect(seen[0].aborted()).toBe(true);
  });

  it("opvragen (GET): kortere limiet en een eigen melding", async () => {
    vi.useFakeTimers();
    hangingFetch();
    const { api, READ_TIMEOUT_MS } = await loadPublic("js/api.js");
    expect(READ_TIMEOUT_MS).toBe(20_000);
    const p = api.getBots().catch((e: Error) => e);
    await vi.advanceTimersByTimeAsync(READ_TIMEOUT_MS);
    const err = await p;
    expect(err.timeout).toBe(true);
    expect(err.message).toBe(
      "De server reageert niet (geen antwoord binnen 20 seconden). Draait het programma nog? " +
        "Staan er veel dashboard-tabbladen open? Sluit er een paar en probeer het opnieuw.",
    );
  });

  it("backtest / optimaliseren / walk-forward mogen lang rekenen (15 minuten)", async () => {
    vi.useFakeTimers();
    const seen = hangingFetch();
    const { api, HEAVY_TIMEOUT_MS, ACTION_TIMEOUT_MS } = await loadPublic("js/api.js");
    expect(HEAVY_TIMEOUT_MS).toBe(15 * 60_000);
    const ps = [api.backtest({}), api.optimize({}), api.walkForward({})].map((x: Promise<unknown>) => x.catch((e: Error) => e));
    await vi.advanceTimersByTimeAsync(ACTION_TIMEOUT_MS * 5);
    expect(seen.map((s) => s.aborted())).toEqual([false, false, false]);
    await vi.advanceTimersByTimeAsync(HEAVY_TIMEOUT_MS);
    const errs: Fake[] = await Promise.all(ps);
    expect(errs.map((e) => e.timeout)).toEqual([true, true, true]);
    expect(errs[0].message).toContain("binnen 15 minuten");
  });

  it("een gewoon antwoord ruimt de timer op; een netwerkfout blijft een netwerkfout", async () => {
    vi.useFakeTimers();
    const { api } = await loadPublic("js/api.js");
    await expect(api.getState()).resolves.toEqual({ ok: 1 });
    expect(vi.getTimerCount()).toBe(0);
    vi.stubGlobal("fetch", async () => {
      throw new TypeError("Failed to fetch");
    });
    const err = await api.kill().catch((e: Error) => e);
    expect(err).toBeInstanceOf(TypeError);
    expect(vi.getTimerCount()).toBe(0);
  });
});

describe("connectEvents: live-verbinding alleen in een tabblad dat je bekijkt", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  function setup(hidden = false) {
    const streams: { url: string; closed: boolean; fire: (type: string, data: unknown) => void; src: Fake }[] = [];
    class FakeEventSource {
      onopen: null | (() => void) = null;
      onerror: null | (() => void) = null;
      listeners: Record<string, ((ev: { data: string }) => void)[]> = {};
      constructor(url: string) {
        const self = this;
        streams.push({
          url,
          closed: false,
          src: self,
          fire(type, data) {
            for (const fn of self.listeners[type] || []) fn({ data: JSON.stringify(data) });
          },
        });
      }
      addEventListener(type: string, fn: (ev: { data: string }) => void) {
        (this.listeners[type] ||= []).push(fn);
      }
      close() {
        streams.find((s) => s.src === this)!.closed = true;
      }
    }
    const docListeners: Record<string, (() => void)[]> = {};
    const doc = {
      hidden,
      addEventListener: (t: string, fn: () => void) => (docListeners[t] ||= []).push(fn),
      removeEventListener: (t: string, fn: () => void) => (docListeners[t] = (docListeners[t] || []).filter((f) => f !== fn)),
    };
    const setHidden = (h: boolean) => {
      doc.hidden = h;
      for (const fn of docListeners.visibilitychange || []) fn();
    };
    const events: [string, unknown][] = [];
    const statuses: string[] = [];
    return { streams, doc, docListeners, setHidden, events, statuses, FakeEventSource };
  }

  it("naar de achtergrond: na 5 s dicht ('paused'); weer zichtbaar: nieuwe verbinding (de server stuurt dan een verse snapshot)", async () => {
    vi.useFakeTimers();
    const t = setup(false);
    const { connectEvents, HIDDEN_PAUSE_MS } = await loadPublic("js/api.js");
    expect(HIDDEN_PAUSE_MS).toBe(5_000);
    connectEvents((type: string, d: unknown) => t.events.push([type, d]), (s: string) => t.statuses.push(s), {
      document: t.doc,
      EventSource: t.FakeEventSource,
    });
    expect(t.streams).toHaveLength(1);
    t.streams[0].src.onopen();
    t.streams[0].fire("snapshot", { n: 1 });
    expect(t.events).toEqual([["snapshot", { n: 1 }]]);

    t.setHidden(true);
    vi.advanceTimersByTime(HIDDEN_PAUSE_MS - 1);
    expect(t.streams[0].closed).toBe(false);
    vi.advanceTimersByTime(1);
    expect(t.streams[0].closed).toBe(true);
    expect(t.statuses).toEqual(["open", "paused"]);
    // een late fout/event van de gesloten stream telt niet meer
    t.streams[0].src.onerror();
    t.streams[0].fire("price", { market: "X" });
    expect(t.statuses).toEqual(["open", "paused"]);
    expect(t.events).toHaveLength(1);

    t.setHidden(false);
    expect(t.streams).toHaveLength(2);
    expect(t.statuses).toEqual(["open", "paused", "connecting"]);
    t.streams[1].src.onopen();
    t.streams[1].fire("snapshot", { n: 2 });
    expect(t.statuses.at(-1)).toBe("open");
    expect(t.events.at(-1)).toEqual(["snapshot", { n: 2 }]);
  });

  it("even wisselen van tabblad (korter dan 5 s): verbinding blijft, geen nieuwe", async () => {
    vi.useFakeTimers();
    const t = setup(false);
    const { connectEvents } = await loadPublic("js/api.js");
    connectEvents(() => {}, (s: string) => t.statuses.push(s), { document: t.doc, EventSource: t.FakeEventSource });
    t.setHidden(true);
    vi.advanceTimersByTime(3_000);
    t.setHidden(false);
    vi.advanceTimersByTime(10_000);
    expect(t.streams).toHaveLength(1);
    expect(t.streams[0].closed).toBe(false);
    expect(t.statuses).toEqual([]);
  });

  it("geopend op de achtergrond (Ctrl+klik): pas verbinden zodra je kijkt; sluiten ruimt alles op", async () => {
    vi.useFakeTimers();
    const t = setup(true);
    const { connectEvents } = await loadPublic("js/api.js");
    const close = connectEvents(() => {}, (s: string) => t.statuses.push(s), { document: t.doc, EventSource: t.FakeEventSource });
    expect(t.streams).toHaveLength(0);
    expect(t.statuses).toEqual(["paused"]);
    t.setHidden(false);
    expect(t.streams).toHaveLength(1);
    close();
    expect(t.streams[0].closed).toBe(true);
    expect(t.docListeners.visibilitychange).toEqual([]);
    t.setHidden(true);
    t.setHidden(false);
    vi.advanceTimersByTime(10_000);
    expect(t.streams).toHaveLength(1);
  });
});
