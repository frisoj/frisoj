import { afterEach, describe, expect, it } from "vitest";
import type { EngineSnapshot, ExitReason, KillResult, Trade } from "../../src/core/types";
import { openBtcPosition, setup } from "../engine/helpers";
import { FakeEngine, NOW, json, makePosition, startTestServer, type TestServer } from "./helpers";

/**
 * Fake met de nieuwe (optionele) engine-methoden, zoals de echte TradingEngine
 * ze heeft. De gewone FakeEngine mist ze bewust: oudere fakes moeten blijven werken.
 */
class FullFakeEngine extends FakeEngine {
  unknownOrders: EngineSnapshot["unknownOrders"] = [];
  stateRecovery: EngineSnapshot["stateRecovery"] = null;
  ackUnknown = 0;
  ackRecovery = 0;
  writtenOff: string[] = [];
  /** Posities die NIET onverkoopbaar zijn → afschrijven wordt geweigerd */
  sellable = new Set<string>();
  /** Volgende writeOffPosition gooit deze fout */
  writeOffError: Error | null = null;
  killResult: KillResult = { closed: 0, failed: [] };

  override snapshot(): EngineSnapshot {
    return { ...super.snapshot(), unknownOrders: this.unknownOrders, stateRecovery: this.stateRecovery };
  }
  override arm(): void {
    if (this.mode !== "live" || this.armed) return;
    if (this.stateRecovery) {
      throw new Error(
        `Armen geblokkeerd: de opgeslagen staat was bij het starten onbruikbaar (${this.stateRecovery.reason}) en de bot begon met een lege administratie.`,
      );
    }
    this.armed = true;
  }
  override async killSwitch(): Promise<KillResult> {
    await super.killSwitch();
    return this.killResult;
  }
  acknowledgeUnknownOrders(): void {
    this.ackUnknown++;
    this.unknownOrders = [];
  }
  acknowledgeStateRecovery(): void {
    this.ackRecovery++;
    this.stateRecovery = null;
  }
  writeOffPosition(id: string): Trade {
    if (this.writeOffError) {
      const err = this.writeOffError;
      this.writeOffError = null;
      throw err;
    }
    const pos = this.positions.find((p) => p.id === id);
    if (!pos) throw new Error(`Positie ${id} niet gevonden (al gesloten?)`);
    if (this.sellable.has(id)) {
      throw new Error(
        `Afschrijven kan alleen voor een onverkoopbare positie (waarde onder het beursminimum). ${pos.market} kan gewoon verkocht worden.`,
      );
    }
    this.writtenOff.push(id);
    this.positions = this.positions.filter((p) => p.id !== id);
    const trade: Trade = {
      id: "trd_wo",
      market: pos.market,
      entryTime: pos.entryTime,
      exitTime: NOW,
      entryPrice: pos.entryPrice,
      exitPrice: pos.currentPrice,
      amount: pos.amount,
      costQuote: pos.costQuote,
      proceedsQuote: 0,
      feesQuote: pos.entryFeeQuote,
      pnlQuote: -pos.costQuote,
      pnlPct: -100,
      rMultiple: -1,
      exitReason: "manual",
      candlesHeld: pos.candlesHeld,
      entryReason: `${pos.entryReason} · afgeschreven`,
    };
    this.trades.unshift(trade);
    return trade;
  }
}

const LIVE = { mode: "live" as const, apiKey: "k", apiSecret: "s", dataSource: "bitvavo" as const };

let srv: TestServer | null = null;
afterEach(async () => {
  await srv?.close();
  srv = null;
});

describe("POST /api/live/unknown-orders/ack", () => {
  it("heft de blokkade op via de engine en geeft de snapshot terug", async () => {
    const engine = new FullFakeEngine("live");
    engine.unknownOrders = [{ market: "BTC-EUR", clientOrderId: "c1", quoteAmount: 10, at: NOW }];
    srv = await startTestServer({ config: LIVE, engine });
    const r = await json(srv.base, "POST", "/api/live/unknown-orders/ack");
    expect(r.status).toBe(200);
    expect(engine.ackUnknown).toBe(1);
    expect(r.data.mode).toBe("live");
    expect(r.data.unknownOrders).toEqual([]);
  });

  it("501 als de engine het niet ondersteunt", async () => {
    srv = await startTestServer();
    const r = await json(srv.base, "POST", "/api/live/unknown-orders/ack");
    expect(r.status).toBe(501);
    expect(r.data.error).toMatch(/niet ondersteund/);
  });

  it("alleen POST", async () => {
    srv = await startTestServer({ engine: new FullFakeEngine() });
    const r = await json(srv.base, "GET", "/api/live/unknown-orders/ack");
    expect(r.status).toBe(405);
  });
});

describe("POST /api/state/recovery/ack en armen", () => {
  it("armen met een onbevestigde herstelmelding → 409 met de melding van de engine; na bevestigen lukt het", async () => {
    const engine = new FullFakeEngine("live");
    engine.stateRecovery = { reason: "JSON kapot", at: NOW };
    srv = await startTestServer({ config: LIVE, engine });

    const blocked = await json(srv.base, "POST", "/api/live/arm", { confirm: "IK BEGRIJP HET RISICO" });
    expect(blocked.status).toBe(409);
    expect(blocked.data.error).toMatch(/^Armen geblokkeerd: .*JSON kapot/);
    expect(engine.armed).toBe(false);

    const ack = await json(srv.base, "POST", "/api/state/recovery/ack");
    expect(ack.status).toBe(200);
    expect(engine.ackRecovery).toBe(1);
    expect(ack.data.stateRecovery).toBeNull();

    const ok = await json(srv.base, "POST", "/api/live/arm", { confirm: "IK BEGRIJP HET RISICO" });
    expect(ok.status).toBe(200);
    expect(ok.data.liveArmed).toBe(true);
  });

  it("andere fouten bij armen blijven een interne fout (500), geen 409", async () => {
    const engine = new FullFakeEngine("live");
    engine.arm = () => {
      throw new Error("iets anders");
    };
    srv = await startTestServer({ config: LIVE, engine });
    const r = await json(srv.base, "POST", "/api/live/arm", { confirm: "IK BEGRIJP HET RISICO" });
    expect(r.status).toBe(500);
  });

  it("501 als de engine het niet ondersteunt", async () => {
    srv = await startTestServer();
    const r = await json(srv.base, "POST", "/api/state/recovery/ack");
    expect(r.status).toBe(501);
  });
});

describe("POST /api/positions/:id/writeoff", () => {
  it("schrijft een onverkoopbare positie af en geeft de trade terug", async () => {
    const engine = new FullFakeEngine();
    engine.positions = [makePosition("pos_dust")];
    srv = await startTestServer({ engine });
    const r = await json(srv.base, "POST", "/api/positions/pos_dust/writeoff");
    expect(r.status).toBe(200);
    expect(r.data).toMatchObject({ id: "trd_wo", market: "BTC-EUR", proceedsQuote: 0, pnlPct: -100 });
    expect(engine.writtenOff).toEqual(["pos_dust"]);
  });

  it("404 voor een onbekende positie (engine wordt niet aangeroepen)", async () => {
    const engine = new FullFakeEngine();
    engine.positions = [makePosition("pos_a")];
    srv = await startTestServer({ engine });
    const r = await json(srv.base, "POST", "/api/positions/pos_onbekend/writeoff");
    expect(r.status).toBe(404);
    expect(r.data.error).toMatch(/niet gevonden/);
    expect(engine.writtenOff).toEqual([]);
  });

  it("409 als de engine weigert (positie is gewoon verkoopbaar)", async () => {
    const engine = new FullFakeEngine();
    engine.positions = [makePosition("pos_ok")];
    engine.sellable.add("pos_ok");
    srv = await startTestServer({ engine });
    const r = await json(srv.base, "POST", "/api/positions/pos_ok/writeoff");
    expect(r.status).toBe(409);
    expect(r.data.error).toMatch(/^Afschrijven kan alleen voor een onverkoopbare positie/);
    expect(engine.positions).toHaveLength(1);
  });

  it("409 ook voor 'Afschrijven kan nu (even) niet' (order loopt nog)", async () => {
    const engine = new FullFakeEngine();
    engine.positions = [makePosition("pos_x")];
    engine.writeOffError = new Error("Afschrijven kan nu even niet: er loopt nog een order bij de broker.");
    srv = await startTestServer({ engine });
    const r = await json(srv.base, "POST", "/api/positions/pos_x/writeoff");
    expect(r.status).toBe(409);
    expect(r.data.error).toMatch(/loopt nog een order/);
  });

  it("positie verdwijnt tussen controle en afschrijven → 404; onverwachte fout → 500", async () => {
    const engine = new FullFakeEngine();
    engine.positions = [makePosition("pos_y")];
    srv = await startTestServer({ engine });
    engine.writeOffError = new Error("Positie pos_y niet gevonden (al gesloten?)");
    const gone = await json(srv.base, "POST", "/api/positions/pos_y/writeoff");
    expect(gone.status).toBe(404);
    engine.writeOffError = new TypeError("kapot");
    const boom = await json(srv.base, "POST", "/api/positions/pos_y/writeoff");
    expect(boom.status).toBe(500);
  });

  it("400 voor een te lange id, 501 zonder ondersteuning in de engine", async () => {
    const engine = new FullFakeEngine();
    srv = await startTestServer({ engine });
    const long = await json(srv.base, "POST", `/api/positions/${"x".repeat(101)}/writeoff`);
    expect(long.status).toBe(400);
    await srv.close();

    srv = await startTestServer();
    srv.engine.positions = [makePosition("pos_z")];
    const r = await json(srv.base, "POST", "/api/positions/pos_z/writeoff");
    expect(r.status).toBe(501);
    expect(srv.engine.positions).toHaveLength(1);
  });
});

/** Fake waarvan closePosition mislukt met een reden, zoals de echte engine (lastCloseFailure). */
class CloseFailEngine extends FakeEngine {
  /** Als gezet: de volgende closePosition mislukt en lastCloseFailure wordt deze waarde */
  failWith: string | null | undefined = undefined;
  lastCloseFailure: string | null = null;

  override async closePosition(id: string, reason?: ExitReason): Promise<Trade | null> {
    this.lastCloseFailure = null;
    if (this.failWith !== undefined) {
      this.lastCloseFailure = this.failWith;
      return null;
    }
    return super.closePosition(id, reason);
  }
}

/** Oude fake zonder lastCloseFailure waarvan sluiten mislukt. */
class CloseFailNoReasonEngine extends FakeEngine {
  override async closePosition(): Promise<Trade | null> {
    return null;
  }
}

const GENERIC_CLOSE_ERROR = "Positie kon niet worden gesloten. Bekijk het logboek voor details.";

describe("POST /api/positions/:id/close", () => {
  it("409 met precies de reden van de engine (lastCloseFailure)", async () => {
    const engine = new CloseFailEngine();
    engine.positions = [makePosition("pos_dust")];
    engine.failWith = "onverkoopbaar: waarde €4,78 < minimum €5,00";
    srv = await startTestServer({ engine });
    const r = await json(srv.base, "POST", "/api/positions/pos_dust/close");
    expect(r.status).toBe(409);
    expect(r.data.error).toBe("onverkoopbaar: waarde €4,78 < minimum €5,00");
    expect(engine.positions).toHaveLength(1);

    engine.failWith = "uitkomst van de verkooporder onbekend (time-out) — controleer je Bitvavo-account";
    const unknown = await json(srv.base, "POST", "/api/positions/pos_dust/close");
    expect(unknown.status).toBe(409);
    expect(unknown.data.error).toBe(engine.failWith);
  });

  it("zonder (bruikbare) reden van de engine: de algemene 409-melding", async () => {
    const engine = new CloseFailEngine();
    engine.positions = [makePosition("pos_a")];
    srv = await startTestServer({ engine });
    for (const failWith of [null, "", "   "]) {
      engine.failWith = failWith;
      const r = await json(srv.base, "POST", "/api/positions/pos_a/close");
      expect(r.status, String(failWith)).toBe(409);
      expect(r.data.error).toBe(GENERIC_CLOSE_ERROR);
    }
    await srv.close();

    // Oudere engine zonder lastCloseFailure
    const old = new CloseFailNoReasonEngine();
    old.positions = [makePosition("pos_b")];
    srv = await startTestServer({ engine: old });
    const r = await json(srv.base, "POST", "/api/positions/pos_b/close");
    expect(r.status).toBe(409);
    expect(r.data.error).toBe(GENERIC_CLOSE_ERROR);
  });

  it("gelukt sluiten blijft 200 met de trade", async () => {
    const engine = new CloseFailEngine();
    engine.positions = [makePosition("pos_ok")];
    srv = await startTestServer({ engine });
    const r = await json(srv.base, "POST", "/api/positions/pos_ok/close");
    expect(r.status).toBe(200);
    expect(r.data.exitReason).toBe("manual");
    expect(engine.closed).toEqual([{ id: "pos_ok", reason: "manual" }]);
  });

  it("echte TradingEngine: onverkoopbare positie → 409 met de reden, zonder verkooporder", async () => {
    const h = setup();
    h.risk.quote = 6;
    h.risk.stopDist = 20_000; // geen automatische exit
    const pos = await openBtcPosition(h);
    h.feed.setLast("BTC-EUR", 40_000); // waarde < €5 (beursminimum)
    srv = await startTestServer({ deps: { engine: h.engine } });
    const r = await json(srv.base, "POST", `/api/positions/${pos.id}/close`);
    expect(r.status).toBe(409);
    expect(r.data.error).toMatch(/^onverkoopbaar: waarde €\d+,\d\d < minimum €5,00$/);
    expect(r.data.error).toBe(h.engine.lastCloseFailure);
    expect(h.broker.sells()).toHaveLength(0);
    expect(h.engine.snapshot().positions.map((p) => p.id)).toEqual([pos.id]);
    await h.engine.stop();
  });
});

describe("POST /api/engine/kill", () => {
  it("geeft de snapshot plus killResult terug (200, ook als posities niet gesloten konden worden)", async () => {
    const engine = new FullFakeEngine();
    engine.killResult = {
      closed: 1,
      failed: [{ id: "pos_dust", market: "ADA-EUR", reason: "waarde onder het beursminimum" }],
    };
    srv = await startTestServer({ engine });
    const r = await json(srv.base, "POST", "/api/engine/kill");
    expect(r.status).toBe(200);
    expect(engine.killed).toBe(1);
    expect(r.data.running).toBe(false);
    expect(r.data.mode).toBe("paper");
    expect(r.data.killResult).toEqual(engine.killResult);
  });

  it("zonder KillResult van de engine (oude fake): alleen de snapshot", async () => {
    srv = await startTestServer();
    const r = await json(srv.base, "POST", "/api/engine/kill");
    expect(r.status).toBe(200);
    expect(r.data.running).toBe(false);
    expect("killResult" in r.data).toBe(false);
  });
});

describe("GET /api/info", () => {
  it("bevat het startkapitaal van de oefenmodus", async () => {
    srv = await startTestServer({ config: { paperStartingCapital: 123 } });
    const r = await json(srv.base, "GET", "/api/info");
    expect(r.status).toBe(200);
    expect(r.data.paperStartingCapital).toBe(123);
  });
});
