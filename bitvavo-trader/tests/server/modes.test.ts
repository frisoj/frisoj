import { afterEach, describe, expect, it } from "vitest";
import { json, startTestServer, type TestServer } from "./helpers";

let srv: TestServer | null = null;
afterEach(async () => {
  await srv?.close();
  srv = null;
});

describe("live arm / paper reset", () => {
  it("paper: armen geeft 400, reset werkt met startkapitaal", async () => {
    srv = await startTestServer({ config: { mode: "paper" } });
    const arm = await json(srv.base, "POST", "/api/live/arm", { confirm: "IK BEGRIJP HET RISICO" });
    expect(arm.status).toBe(400);
    expect(arm.data.error).toMatch(/live mode/);
    expect(srv.engine.armed).toBe(false);

    const reset = await json(srv.base, "POST", "/api/paper/reset");
    expect(reset.status).toBe(200);
    expect(reset.data.mode).toBe("paper");
    expect(srv.engine.resetCalls).toEqual([50]);

    const reset2 = await json(srv.base, "POST", "/api/paper/reset", { startingCapital: 100 });
    expect(reset2.status).toBe(200);
    expect(srv.engine.resetCalls).toEqual([50, 100]);

    const disarm = await json(srv.base, "POST", "/api/live/disarm");
    expect(disarm.status).toBe(200);
    expect(disarm.data.liveArmed).toBe(false);
  });

  it("live: armen vereist exacte bevestigingstekst, reset geeft 400", async () => {
    srv = await startTestServer({
      config: { mode: "live", apiKey: "k", apiSecret: "s", dataSource: "bitvavo", capitalLimitQuote: 25 },
    });
    const wrong = await json(srv.base, "POST", "/api/live/arm", { confirm: "ik begrijp het risico" });
    expect(wrong.status).toBe(400);
    expect(wrong.data.error).toContain("IK BEGRIJP HET RISICO");
    const none = await json(srv.base, "POST", "/api/live/arm");
    expect(none.status).toBe(400);
    expect(srv.engine.armed).toBe(false);

    const ok = await json(srv.base, "POST", "/api/live/arm", { confirm: "IK BEGRIJP HET RISICO" });
    expect(ok.status).toBe(200);
    expect(ok.data).toMatchObject({ mode: "live", liveArmed: true, hasApiKeys: true, capitalLimitQuote: 25 });

    const disarm = await json(srv.base, "POST", "/api/live/disarm");
    expect(disarm.status).toBe(200);
    expect(disarm.data.liveArmed).toBe(false);

    const reset = await json(srv.base, "POST", "/api/paper/reset");
    expect(reset.status).toBe(400);
    expect(reset.data.error).toMatch(/oefenmodus/);
    expect(srv.engine.resetCalls).toEqual([]);
  });
});
