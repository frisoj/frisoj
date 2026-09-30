import { connect } from "node:net";
import { afterEach, describe, expect, it } from "vitest";
import { getProfile } from "../../src/bots/profiles";
import type { AppConfig } from "../../src/config";
import type { KillResult, Trade } from "../../src/core/types";
import { createApp, startHttpServer, type RunningServer } from "../../src/server/httpServer";
import { botEntries, botInfo, createMultiApp, type MultiAppBot } from "../../src/server/multiApp";
import type { BotEntry, HeavyGate } from "../../src/server/routes";
import { FakeEngine, FakeFeed, json, makeConfig, makePublicDir, makeServices, NOW, rawGet, rawRequest } from "./helpers";

const TOKEN = "wedstrijd-geheim-1";

/** Nep-engine met instelbare start/noodstop en (optioneel) allTrades zoals de TradingEngine. */
class BotEngine extends FakeEngine {
  startError: Error | null = null;
  killImpl: (() => Promise<KillResult | void>) | null = null;
  kept: Trade[] | null = null;
  constructor(public readonly label: string) {
    super("paper");
    this.config = { ...this.config, markets: [`${label.toUpperCase()}-EUR`] };
  }
  override async start() {
    if (this.startError) throw this.startError;
    this.running = true;
  }
  override async killSwitch(): Promise<KillResult | void> {
    this.killed++;
    this.running = false;
    return this.killImpl ? this.killImpl() : { closed: 0, failed: [] };
  }
  allTrades(): Trade[] {
    return this.kept ?? [];
  }
}

interface Multi {
  base: string;
  port: number;
  engines: Record<string, BotEngine>;
  server: RunningServer;
  disposed: string[];
}

let srv: Multi | null = null;
afterEach(async () => {
  await srv?.server.close();
  srv = null;
});

async function startMulti(
  ids = ["scalper", "trend", "dip"],
  config: Partial<AppConfig> = {},
  opts: { feed?: FakeFeed; heavyGate?: HeavyGate } = {},
): Promise<Multi> {
  const publicDir = makePublicDir();
  const engines: Record<string, BotEngine> = {};
  const list: MultiAppBot[] = [];
  const entries: BotEntry[] = [];
  const disposed: string[] = [];
  for (const id of ids) {
    const profile = getProfile(id)!;
    const cfg = makeConfig(config);
    const engine = new BotEngine(id);
    engines[id] = engine;
    const { services } = makeServices();
    const app = createApp({
      config: cfg,
      engine,
      feed: opts.feed ?? new FakeFeed(),
      services,
      now: () => NOW,
      persistConfig: () => {},
      log: () => {},
      publicDir,
      info: () => ({ bot: botInfo(profile) }),
      bots: () => entries,
      ...(opts.heavyGate ? { heavyGate: opts.heavyGate } : {}),
    });
    const dispose = app.dispose;
    app.dispose = () => {
      disposed.push(id);
      dispose();
    };
    list.push({ id, app, engine, profile, config: cfg });
  }
  entries.push(...botEntries(list));
  const server = await startHttpServer(createMultiApp({ bots: list, defaultId: ids[0], log: () => {} }), "127.0.0.1", 0);
  return { base: `http://127.0.0.1:${server.port}`, port: server.port, engines, server, disposed };
}

/** Ruw verzoek over een socket (dubbele of ontbrekende Host-header kan niet via fetch). */
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

describe("multi-bot server — routering", () => {
  it("/api/... gaat naar de standaardbot (de eerste), /bot/<id>/api/... naar die bot", async () => {
    srv = await startMulti();
    const def = await json(srv.base, "GET", "/api/state");
    expect(def.status).toBe(200);
    expect(def.data.config.markets).toEqual(["SCALPER-EUR"]);
    const trend = await json(srv.base, "GET", "/bot/trend/api/state");
    expect(trend.status).toBe(200);
    expect(trend.data.config.markets).toEqual(["TREND-EUR"]);
    expect(trend.headers.get("cache-control")).toBe("no-store");

    // Acties komen alleen bij die ene bot aan
    const start = await json(srv.base, "POST", "/bot/dip/api/engine/start");
    expect(start.status).toBe(200);
    expect(srv.engines.dip.running).toBe(true);
    expect(srv.engines.scalper.running).toBe(false);
    expect(srv.engines.trend.running).toBe(false);

    // Querystring blijft staan (bijv. /api/decision?market=)
    const dec = await json(srv.base, "GET", "/bot/trend/api/decision?market=BTC-EUR");
    expect(dec.status).toBe(200);
    expect(dec.data).toEqual({ decision: null });
    // Onbekend API-pad binnen een bot: gewone 404 van die app
    expect((await json(srv.base, "GET", "/bot/trend/api/bestaat-niet")).status).toBe(404);
    expect((await json(srv.base, "GET", "/bot/trend/api")).data.error).toMatch(/Onbekend API-pad: \/api$/);
  });

  it("/api/info van elke bot noemt de bot (id, naam, kort, kleur)", async () => {
    srv = await startMulti();
    const def = await json(srv.base, "GET", "/api/info");
    expect(def.data.bot).toEqual({ id: "scalper", name: "Snelle scalper", short: "Scalper", color: getProfile("scalper")!.color });
    expect(def.data.mode).toBe("paper");
    const dip = await json(srv.base, "GET", "/bot/dip/api/info");
    expect(dip.data.bot).toEqual({ id: "dip", name: "Dip-koper", short: "Dip", color: getProfile("dip")!.color });
  });

  it("/bot/<id> → 301 naar /bot/<id>/ (met query); /bot/<id>/ en /bot/<id>/index.html → het dashboard", async () => {
    srv = await startMulti();
    const redirect = await rawGet(srv.port, "/bot/trend?token=abc", { Host: `127.0.0.1:${srv.port}` });
    expect(redirect.status).toBe(301);
    expect(redirect.headers.location).toBe("/bot/trend/?token=abc");
    expect(redirect.headers["content-security-policy"]).toMatch(/default-src 'self'/);
    for (const path of ["/bot/trend/", "/bot/trend/index.html", "/"]) {
      const page = await rawGet(srv.port, path, { Host: `localhost:${srv.port}` });
      expect(page.status).toBe(200);
      expect(page.headers["content-type"]).toMatch(/text\/html/);
      expect(page.body).toContain("<title>Test</title>");
      expect(page.headers["x-frame-options"]).toBe("DENY");
    }
    // Bestanden onder /bot/<id>/ werken ook (zelfde public-map); verborgen bestanden niet
    expect((await rawGet(srv.port, "/bot/trend/js/app.js", { Host: "localhost" })).status).toBe(200);
    expect((await rawGet(srv.port, "/bot/trend/.secret", { Host: "localhost" })).status).toBe(403);
    // Alleen GET/HEAD
    const post = await rawRequest(srv.port, "POST", "/bot/trend", { Host: "localhost" });
    expect(post.status).toBe(405);
    expect(post.headers.allow).toBe("GET, HEAD");
    const head = await rawRequest(srv.port, "HEAD", "/bot/trend", { Host: "localhost" });
    expect(head.status).toBe(301);
  });

  it("onbekende bot → 404 'Onbekende bot'; /bot en /bot/ ook; /botx is gewoon een (onbekend) bestand", async () => {
    srv = await startMulti();
    for (const path of ["/bot/turbo", "/bot/turbo/", "/bot/turbo/api/state", "/bot", "/bot/", "/bot/Trend/"]) {
      const r = await json(srv.base, "GET", path);
      expect(r.status, path).toBe(404);
      expect(r.data.error, path).toMatch(/^Onbekende bot\. Bekende bots: scalper, trend, dip\.$/);
      expect(r.headers.get("x-content-type-options")).toBe("nosniff");
    }
    const other = await json(srv.base, "GET", "/botx");
    expect(other.status).toBe(404);
    expect(other.data.error).toBe("Niet gevonden.");
  });

  it("paden met .. worden eerst genormaliseerd en dan pas gerouteerd", async () => {
    srv = await startMulti();
    const viaTrend = await rawGet(srv.port, "/bot/trend/api/../../dip/api/state", { Host: "localhost" });
    expect(viaTrend.status).toBe(200);
    expect(JSON.parse(viaTrend.body).config.markets).toEqual(["DIP-EUR"]);
    const up = await rawGet(srv.port, "/bot/trend/../api/state", { Host: "localhost" });
    expect(up.status).toBe(404); // → /bot/api/state: geen bot "api"
    const root = await rawGet(srv.port, "/bot/../api/state", { Host: "localhost" });
    expect(root.status).toBe(200); // → /api/state: de standaardbot
    expect(JSON.parse(root.body).config.markets).toEqual(["SCALPER-EUR"]);
  });

  it("één rekenwerker voor alle bots: met een gedeelde vergrendeling loopt er maar één berekening tegelijk", async () => {
    const feed = new FakeFeed();
    let release!: () => void;
    feed.historyGate = new Promise<void>((r) => (release = r));
    srv = await startMulti(["scalper", "trend"], {}, { feed, heavyGate: { busy: null } });
    const first = json(srv.base, "POST", "/api/backtest", { market: "BTC-EUR", interval: "15m", days: 5 });
    for (let i = 0; i < 50 && feed.historyCalls.length === 0; i++) await new Promise((r) => setTimeout(r, 10));
    expect(feed.historyCalls).toHaveLength(1);
    const second = await json(srv.base, "POST", "/bot/trend/api/backtest", { market: "BTC-EUR", interval: "15m", days: 5 });
    expect(second.status).toBe(429);
    expect(second.data.error).toMatch(/Er loopt al een berekening \(backtest\)/);
    release();
    expect((await first).status).toBe(200);
    const third = await json(srv.base, "POST", "/bot/trend/api/backtest", { market: "BTC-EUR", interval: "15m", days: 5 });
    expect(third.status).toBe(200);
  });

  it("dispose sluit de apps van alle bots", async () => {
    srv = await startMulti();
    await srv.server.close();
    expect(srv.disposed.sort()).toEqual(["dip", "scalper", "trend"]);
  });

  it("createMultiApp weigert geen of dubbele bots", () => {
    expect(() => createMultiApp({ bots: [] })).toThrow(/geen bots/);
    const cfg = makeConfig();
    const { services } = makeServices();
    const engine = new FakeEngine();
    const app = createApp({ config: cfg, engine, feed: new FakeFeed(), services, log: () => {} });
    const profile = getProfile("dip")!;
    expect(() =>
      createMultiApp({
        bots: [
          { id: "dip", app, engine, profile, config: cfg },
          { id: "dip", app, engine, profile, config: cfg },
        ],
      }),
    ).toThrow(/dubbel/);
    app.dispose();
  });
});

describe("multi-bot server — beveiliging geldt voor elk pad", () => {
  const paths = ["/bot/trend/api/state", "/api/bots", "/bot/trend", "/bot/trend/", "/bot/turbo/api/state", "/bot/turbo"];

  it("vreemde Host-header (DNS-rebinding) → 403, ook voor /bot/<id>/…, /api/bots, de 301 en de 404", async () => {
    srv = await startMulti();
    for (const path of paths) {
      for (const host of ["evil.example", `evil.example:${srv.port}`, "127.0.0.1.nip.io"]) {
        const r = await rawGet(srv.port, path, { Host: host });
        expect(r.status, `${path} ${host}`).toBe(403);
        expect(r.body).toMatch(/onbekende Host-header/);
      }
    }
    // Twee Host-headers → 400; geen Host-header (HTTP/1.0) → 400
    for (const path of ["/bot/trend/api/state", "/api/bots", "/bot/trend"]) {
      const dup = await rawSocket(
        srv.port,
        `GET ${path} HTTP/1.1\r\nHost: localhost\r\nHost: evil.example\r\nConnection: close\r\n\r\n`,
      );
      expect(dup.status, path).toBe(400);
      const none = await rawSocket(srv.port, `GET ${path} HTTP/1.0\r\n\r\n`);
      expect(none.status, path).toBe(400);
    }
  });

  it("dashboard-token: /bot/<id>/api/… en /api/bots vragen de token; de pagina zelf niet", async () => {
    srv = await startMulti(["scalper", "trend"], { dashboardToken: TOKEN });
    for (const [method, path] of [
      ["GET", "/bot/trend/api/state"],
      ["GET", "/api/bots"],
      ["POST", "/api/bots/kill-all"],
      ["POST", "/api/bots/stop-all"],
      ["POST", "/bot/trend/api/engine/start"],
      ["GET", "/bot/turbo/api/state"], // onbekende bot: eerst de token, dan pas de 404
      ["GET", "/bot/trend/api/state?token=" + TOKEN], // ?token= alleen voor de eventstream
    ]) {
      const r = await json(srv.base, method, path);
      expect(r.status, `${method} ${path}`).toBe(401);
      expect(r.data.error).toMatch(/token/);
    }
    expect(srv.engines.scalper.killed + srv.engines.trend.killed).toBe(0);
    expect(srv.engines.trend.running).toBe(false);

    const ok = await json(srv.base, "GET", "/bot/trend/api/state", undefined, { "x-dashboard-token": TOKEN });
    expect(ok.status).toBe(200);
    const bots = await json(srv.base, "GET", "/api/bots", undefined, { "x-dashboard-token": TOKEN });
    expect(bots.status).toBe(200);
    const unknown = await json(srv.base, "GET", "/bot/turbo/api/state", undefined, { "x-dashboard-token": TOKEN });
    expect(unknown.status).toBe(404);

    // SSE per bot met ?token=
    const ac = new AbortController();
    const sse = await fetch(`${srv.base}/bot/trend/api/events?token=${encodeURIComponent(TOKEN)}`, { signal: ac.signal });
    expect(sse.status).toBe(200);
    expect(sse.headers.get("content-type")).toMatch(/text\/event-stream/);
    ac.abort();
    const badSse = await fetch(`${srv.base}/bot/trend/api/events?token=fout`);
    expect(badSse.status).toBe(401);
    await badSse.arrayBuffer();

    // De pagina (en de 301) zonder token
    expect((await rawGet(srv.port, "/bot/trend/", { Host: "localhost" })).status).toBe(200);
    expect((await rawGet(srv.port, "/bot/trend", { Host: "localhost" })).status).toBe(301);
  });

  it("verzoeken van een andere website (Origin / Sec-Fetch-Site) → 403, en er gebeurt niets", async () => {
    srv = await startMulti();
    const host = `127.0.0.1:${srv.port}`;
    const cases: [string, string, Record<string, string>][] = [
      ["POST", "/bot/trend/api/engine/start", { Host: host, Origin: "http://evil.example" }],
      ["POST", "/bot/trend/api/engine/start", { Host: host, Origin: "null" }],
      ["POST", "/api/bots/kill-all", { Host: host, "Sec-Fetch-Site": "cross-site" }],
      ["POST", "/api/bots/start-all", { Host: host, Origin: "http://evil.example" }],
      ["GET", "/api/bots", { Host: host, "Sec-Fetch-Site": "same-site" }],
      ["GET", "/bot/trend/api/state", { Host: host, Origin: `http://127.0.0.1:${srv.port + 1}` }],
      ["GET", "/bot/turbo/api/state", { Host: host, "Sec-Fetch-Site": "cross-site" }],
    ];
    for (const [method, path, headers] of cases) {
      const r = await rawRequest(srv.port, method, path, headers);
      expect(r.status, `${method} ${path} ${JSON.stringify(headers)}`).toBe(403);
      expect(r.body).toMatch(/andere website/);
    }
    for (const e of Object.values(srv.engines)) {
      expect(e.running).toBe(false);
      expect(e.killed).toBe(0);
    }
    // Het eigen dashboard (zelfde origin) mag wel
    const own = await rawRequest(srv.port, "POST", "/bot/trend/api/engine/start", {
      Host: host,
      Origin: `http://${host}`,
      "Sec-Fetch-Site": "same-origin",
    });
    expect(own.status).toBe(200);
    expect(srv.engines.trend.running).toBe(true);
  });

  it("body-limiet (1 MB) en JSON-controle gelden ook voor /bot/<id>/api/…", async () => {
    srv = await startMulti();
    const big = JSON.stringify({ startingCapital: 100, pad: "x".repeat(1024 * 1024 + 10) });
    const r = await rawRequest(srv.port, "POST", "/bot/trend/api/paper/reset", { Host: "localhost" }, big);
    expect(r.status).toBe(413);
    const notJson = await rawRequest(
      srv.port,
      "POST",
      "/bot/trend/api/paper/reset",
      { Host: "localhost", "Content-Type": "text/plain" },
      "startingCapital=100",
    );
    expect(notJson.status).toBe(415);
    const ok = await json(srv.base, "POST", "/bot/trend/api/paper/reset", { startingCapital: 30 });
    expect(ok.status).toBe(200);
    expect(srv.engines.trend.resetCalls).toEqual([30]);
    expect(srv.engines.scalper.resetCalls).toEqual([]);
  });
});

describe("/api/bots — wedstrijd", () => {
  it("GET /api/bots: één samenvatting per bot in de volgorde van BOTS, met alle bewaarde trades", async () => {
    srv = await startMulti();
    const trade = (i: number, pnl: number): Trade => ({
      id: `t${i}`,
      market: "BTC-EUR",
      entryTime: NOW - 1000,
      exitTime: NOW,
      entryPrice: 1,
      exitPrice: 1,
      amount: 1,
      costQuote: 10,
      proceedsQuote: 10 + pnl,
      feesQuote: 0.05,
      pnlQuote: pnl,
      pnlPct: pnl * 10,
      rMultiple: 0,
      exitReason: "signal",
      candlesHeld: 1,
      entryReason: "",
    });
    srv.engines.trend.kept = Array.from({ length: 250 }, (_, i) => trade(i, i % 5 === 0 ? -1 : 0.5));
    srv.engines.dip.running = true;
    const r = await json(srv.base, "GET", "/api/bots");
    expect(r.status).toBe(200);
    expect(r.headers.get("cache-control")).toBe("no-store");
    expect(r.data.map((b: { id: string }) => b.id)).toEqual(["scalper", "trend", "dip"]);
    const trend = r.data[1];
    expect(trend).toMatchObject({
      id: "trend",
      name: "Trendvolger",
      short: "Trend",
      path: "/bot/trend/",
      mode: "paper",
      running: false,
      startingEquity: 50,
      equity: 50,
      trades: 250,
      wins: 200,
      losses: 50,
      winRatePct: 80,
      bestMarket: { market: "BTC-EUR", pnlQuote: 50 },
    });
    expect(r.data[2].running).toBe(true);
    // Zelfde lijst via een bot-pad
    const via = await json(srv.base, "GET", "/bot/dip/api/bots");
    expect(via.data.map((b: { id: string }) => b.id)).toEqual(["scalper", "trend", "dip"]);
    // Alleen GET op /api/bots, alleen POST op de acties
    expect((await json(srv.base, "POST", "/api/bots")).status).toBe(405);
    expect((await json(srv.base, "GET", "/api/bots/kill-all")).status).toBe(405);
  });

  it("start-all / stop-all: elke bot apart; een fout bij de ene houdt de andere niet tegen", async () => {
    srv = await startMulti();
    srv.engines.trend.startError = new Error("Starten geblokkeerd: noodstop bezig. Wacht …");
    const start = await json(srv.base, "POST", "/api/bots/start-all");
    expect(start.status).toBe(200);
    expect(start.data).toEqual({
      results: [
        { id: "scalper", ok: true },
        { id: "trend", ok: false, error: "Starten geblokkeerd: noodstop bezig. Wacht …" },
        { id: "dip", ok: true },
      ],
    });
    expect(srv.engines.scalper.running).toBe(true);
    expect(srv.engines.dip.running).toBe(true);
    expect(srv.engines.trend.running).toBe(false);

    const stop = await json(srv.base, "POST", "/api/bots/stop-all");
    expect(stop.data.results.every((x: { ok: boolean }) => x.ok)).toBe(true);
    expect(Object.values(srv.engines).every((e) => !e.running)).toBe(true);
  });

  it("kill-all: ELKE bot krijgt zijn noodstop (ook als er een faalt of hangt); wat niet verkocht is staat erbij", async () => {
    srv = await startMulti(["scalper", "trend", "dip", "allround"]);
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    srv.engines.scalper.killImpl = async () => {
      await gate; // hangt tot de test hem loslaat
      return { closed: 2, failed: [] };
    };
    srv.engines.trend.killImpl = async () => {
      throw new Error("Bitvavo onbereikbaar");
    };
    srv.engines.dip.killImpl = async () => ({
      closed: 1,
      failed: [{ id: "p9", market: "DOGE-EUR", reason: "onverkoopbaar: waarde €3,10 < minimum €5,00" }],
    });
    srv.engines.allround.killImpl = async () => undefined; // oude engine zonder KillResult

    const pending = json(srv.base, "POST", "/api/bots/kill-all");
    // Alle noodstoppen zijn meteen in gang gezet, ook terwijl de eerste nog loopt.
    for (let i = 0; i < 50 && srv.engines.allround.killed === 0; i++) await new Promise((r) => setTimeout(r, 10));
    expect(Object.values(srv.engines).map((e) => e.killed)).toEqual([1, 1, 1, 1]);
    release();
    const r = await pending;
    expect(r.status).toBe(200);
    expect(r.data).toEqual({
      results: [
        { id: "scalper", ok: true, killResult: { closed: 2, failed: [] } },
        { id: "trend", ok: false, error: "Bitvavo onbereikbaar" },
        {
          id: "dip",
          ok: false,
          error: "Niet alles verkocht: DOGE-EUR (onverkoopbaar: waarde €3,10 < minimum €5,00)",
          killResult: { closed: 1, failed: [{ id: "p9", market: "DOGE-EUR", reason: "onverkoopbaar: waarde €3,10 < minimum €5,00" }] },
        },
        { id: "allround", ok: true },
      ],
    });
  });

  it("een synchrone fout van één engine stopt de rest ook niet", async () => {
    srv = await startMulti();
    (srv.engines.scalper as unknown as { killSwitch: () => never }).killSwitch = () => {
      throw new Error("kapot");
    };
    const r = await json(srv.base, "POST", "/api/bots/kill-all");
    expect(r.data.results).toEqual([
      { id: "scalper", ok: false, error: "kapot" },
      { id: "trend", ok: true, killResult: { closed: 0, failed: [] } },
      { id: "dip", ok: true, killResult: { closed: 0, failed: [] } },
    ]);
  });

  it("zonder bots-provider bestaan de wedstrijdroutes niet (één losse app, zoals vroeger)", async () => {
    const cfg = makeConfig();
    const { services } = makeServices();
    const app = createApp({ config: cfg, engine: new FakeEngine(), feed: new FakeFeed(), services, log: () => {} });
    const server = await startHttpServer(app, "127.0.0.1", 0);
    try {
      const r = await json(`http://127.0.0.1:${server.port}`, "GET", "/api/bots");
      expect(r.status).toBe(404);
      const info = await json(`http://127.0.0.1:${server.port}`, "GET", "/api/info");
      expect(info.data.bot).toBeUndefined();
    } finally {
      await server.close();
    }
  });
});
