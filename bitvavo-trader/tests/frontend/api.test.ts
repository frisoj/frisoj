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
