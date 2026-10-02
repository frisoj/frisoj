/**
 * Integratietest: een echte multi-bot-app (zelfde opbouw als main.ts via assembleBots)
 * met gesimuleerde koersen, echte engines, PaperBrokers en StateStores in een tijdelijke
 * DATA_DIR, achter een echte HTTP-server.
 */
import { existsSync, mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { assembleBots, type Assembled } from "../../src/bots/assemble";
import { loadConfig, planBots } from "../../src/config";
import { SimulatedFeed } from "../../src/data/simulatedFeed";
import { startHttpServer, type RunningServer } from "../../src/server/httpServer";
import { json, makePublicDir, makeServices } from "../server/helpers";

interface Running {
  assembled: Assembled;
  server: RunningServer;
  base: string;
}

const running: Running[] = [];

afterEach(async () => {
  for (const r of running.splice(0)) {
    for (const b of r.assembled.bots) b.engine.stopPriceMonitor();
    await r.server.close();
    await Promise.all(r.assembled.bots.map((b) => b.engine.stop()));
    for (const b of r.assembled.bots) b.store.flush();
  }
});

async function boot(dataDir: string, env: Record<string, string> = {}): Promise<Running> {
  const config = loadConfig({ DATA_DIR: dataDir, DATA_SOURCE: "simulated", PORT: "0", ...env }, { envFile: false, warn: () => {} });
  const setups = planBots(config, { warn: () => {} });
  const assembled = await assembleBots({
    config,
    setups,
    feed: new SimulatedFeed(),
    services: makeServices().services,
    terminalLog: false,
    warn: () => {},
    publicDir: makePublicDir(),
    vendorFile: null,
  });
  const server = await startHttpServer(assembled.app, "127.0.0.1", 0);
  const r = { assembled, server, base: `http://127.0.0.1:${server.port}` };
  running.push(r);
  return r;
}

function readJson(file: string): any {
  return JSON.parse(readFileSync(file, "utf8"));
}

describe("multi-bot-app (integratie)", () => {
  it("vier bots met elk eigen kapitaal, instellingen en toestandsbestanden; /api/bots en /bot/<id>/api/state", async () => {
    const dataDir = mkdtempSync(join(tmpdir(), "bvt-multi-"));
    const app = await boot(dataDir, { PAPER_CAPITAL_PER_BOT: "30" });
    const { base } = app;

    // Wedstrijd-overzicht
    const bots = await json(base, "GET", "/api/bots");
    expect(bots.status).toBe(200);
    expect(bots.data.map((b: any) => b.id)).toEqual(["scalper", "trend", "dip", "allround"]);
    expect(bots.data.map((b: any) => b.interval)).toEqual(["5m", "1h", "15m", "15m"]);
    for (const b of bots.data) {
      expect(b).toMatchObject({ mode: "paper", running: false, startingEquity: 30, equity: 30, trades: 0, path: `/bot/${b.id}/` });
      expect(Array.isArray(b.equityHistory)).toBe(true);
    }

    // Toestand per bot, en /api/state = de eerste bot
    const trend = await json(base, "GET", "/bot/trend/api/state");
    expect(trend.status).toBe(200);
    expect(trend.data.config.interval).toBe("1h");
    expect(trend.data.account.startingEquity).toBe(30);
    expect((await json(base, "GET", "/api/state")).data.config.interval).toBe("5m");
    const info = await json(base, "GET", "/bot/dip/api/info");
    expect(info.data).toMatchObject({ mode: "paper", paperStartingCapital: 30, bot: { id: "dip", short: "Dip" } });

    // Instellingen van één bot gaan naar zijn eigen map
    const put = await json(base, "PUT", "/bot/dip/api/config", { pollMs: 20_000 });
    expect(put.status).toBe(200);
    expect(readJson(join(dataDir, "bots", "dip", "config.json")).pollMs).toBe(20_000);
    expect(existsSync(join(dataDir, "config.json"))).toBe(false);
    expect((await json(base, "GET", "/bot/trend/api/config")).data.pollMs).not.toBe(20_000);

    // Eigen kapitaal per bot
    const reset = await json(base, "POST", "/bot/trend/api/paper/reset", { startingCapital: 60 });
    expect(reset.status).toBe(200);
    const after = await json(base, "GET", "/api/bots");
    expect(after.data.map((b: any) => b.startingEquity)).toEqual([30, 60, 30, 30]);

    // Alles starten en stoppen (echte engines, gesimuleerde koersen)
    const start = await json(base, "POST", "/api/bots/start-all");
    expect(start.data.results).toEqual([
      { id: "scalper", ok: true },
      { id: "trend", ok: true },
      { id: "dip", ok: true },
      { id: "allround", ok: true },
    ]);
    expect((await json(base, "GET", "/api/bots")).data.every((b: any) => b.running)).toBe(true);
    const kill = await json(base, "POST", "/api/bots/kill-all");
    expect(kill.status).toBe(200);
    for (const r of kill.data.results) {
      expect(r.ok).toBe(true);
      expect(r.killResult.failed).toEqual([]);
    }
    expect((await json(base, "GET", "/api/bots")).data.every((b: any) => !b.running)).toBe(true);
    const stop = await json(base, "POST", "/api/bots/stop-all");
    expect(stop.data.results.every((r: any) => r.ok)).toBe(true);

    // Elke bot heeft zijn eigen toestandsbestand; de oude plek van één bot blijft leeg.
    for (const id of ["scalper", "trend", "dip", "allround"]) {
      const file = join(dataDir, "bots", id, "state-paper.json");
      expect(existsSync(file), file).toBe(true);
      expect(readJson(file).account.startingEquity).toBe(id === "trend" ? 60 : 30);
    }
    expect(existsSync(join(dataDir, "state-paper.json"))).toBe(false);

    // Herstart met dezelfde DATA_DIR: kapitaal en instellingen per bot komen terug.
    for (const b of app.assembled.bots) b.engine.stopPriceMonitor();
    await app.server.close();
    await Promise.all(app.assembled.bots.map((b) => b.engine.stop()));
    for (const b of app.assembled.bots) b.store.flush();
    running.splice(running.indexOf(app), 1);

    const again = await boot(dataDir, { PAPER_CAPITAL_PER_BOT: "30" });
    const restored = await json(again.base, "GET", "/api/bots");
    expect(restored.data.map((b: any) => b.startingEquity)).toEqual([30, 60, 30, 30]);
    expect((await json(again.base, "GET", "/bot/dip/api/config")).data.pollMs).toBe(20_000);
  });

  it("één bot (BOTS=allround): de oude paden in DATA_DIR, /bot/allround/ werkt ook", async () => {
    const dataDir = mkdtempSync(join(tmpdir(), "bvt-single-"));
    const { base, assembled } = await boot(dataDir, { BOTS: "allround", PAPER_STARTING_CAPITAL: "40" });
    expect(assembled.bots).toHaveLength(1);
    const bots = await json(base, "GET", "/api/bots");
    expect(bots.data.map((b: any) => [b.id, b.startingEquity])).toEqual([["allround", 40]]);
    expect((await json(base, "GET", "/bot/allround/api/state")).data.account.startingEquity).toBe(40);
    const put = await json(base, "PUT", "/api/config", { pollMs: 25_000 });
    expect(put.status).toBe(200);
    expect(readJson(join(dataDir, "config.json")).pollMs).toBe(25_000);
    await assembled.bots[0].engine.stop();
    assembled.bots[0].store.flush();
    expect(existsSync(join(dataDir, "state-paper.json"))).toBe(true);
    expect(existsSync(join(dataDir, "bots"))).toBe(false);
  });
});
