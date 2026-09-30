import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  ConfigError,
  PROJECT_ROOT,
  cloneEngineConfig,
  describeAutoUniverse,
  loadConfig,
  mergeEngineConfig,
  parseMarketsEnv,
  readEngineOverrides,
  repairRiskConfig,
  saveEngineOverrides,
  shortList,
} from "../../src/config";
import { DEFAULT_ENGINE_CONFIG, DEFAULT_UNIVERSE_CONFIG } from "../../src/core/defaults";
import type { EngineConfig, EnsembleConfig, RiskConfig, UniverseConfig } from "../../src/core/types";

function tmp(): string {
  return mkdtempSync(join(tmpdir(), "bvt-config-"));
}

describe("loadConfig", () => {
  it("gebruikt veilige standaardwaarden", () => {
    const dir = tmp();
    const cfg = loadConfig({ DATA_DIR: dir });
    expect(cfg.mode).toBe("paper");
    expect(cfg.dataSource).toBe("auto");
    expect(cfg.host).toBe("127.0.0.1");
    expect(cfg.port).toBe(4321);
    expect(cfg.operatorId).toBe(1);
    expect(cfg.paperStartingCapital).toBe(50);
    expect(cfg.capitalLimitQuote).toBe(50);
    expect(cfg.autostart).toBe(true);
    expect(cfg.dashboardToken).toBeUndefined();
    expect(cfg.dataDir).toBe(dir);
    expect(cfg.engine).toEqual(DEFAULT_ENGINE_CONFIG);
    expect(cfg.engine).not.toBe(DEFAULT_ENGINE_CONFIG);
  });

  it("DATA_DIR is standaard ./data in de projectmap", () => {
    const cfg = loadConfig({});
    expect(cfg.dataDir).toBe(join(PROJECT_ROOT, "data"));
    const rel = loadConfig({ DATA_DIR: "./elders" });
    expect(rel.dataDir).toBe(join(PROJECT_ROOT, "elders"));
  });

  it("leest alle omgevingsvariabelen", () => {
    const cfg = loadConfig({
      TRADING_MODE: "paper",
      DATA_SOURCE: "simulated",
      HOST: "0.0.0.0",
      PORT: "5000",
      PAPER_STARTING_CAPITAL: "100",
      CAPITAL_LIMIT_EUR: "25",
      DASHBOARD_TOKEN: "abcdefgh1",
      DATA_DIR: tmp(),
      MARKETS: "btc-eur, ada-eur ,BTC-EUR",
      INTERVAL: "5m",
      AUTOSTART: "false",
      BITVAVO_OPERATOR_ID: "7",
    });
    expect(cfg.dataSource).toBe("simulated");
    expect(cfg.host).toBe("0.0.0.0");
    expect(cfg.port).toBe(5000);
    expect(cfg.paperStartingCapital).toBe(100);
    expect(cfg.capitalLimitQuote).toBe(25);
    expect(cfg.dashboardToken).toBe("abcdefgh1");
    expect(cfg.engine.markets).toEqual(["BTC-EUR", "ADA-EUR"]);
    expect(cfg.engine.interval).toBe("5m");
    expect(cfg.autostart).toBe(false);
    expect(cfg.operatorId).toBe(7);
  });

  it("live mode vereist sleutels, staat geen simulatie toe en start nooit automatisch", () => {
    const dir = tmp();
    expect(() => loadConfig({ TRADING_MODE: "live", DATA_DIR: dir })).toThrow(/BITVAVO_API_KEY/);
    expect(() => loadConfig({ TRADING_MODE: "live", DATA_DIR: dir })).toThrow(ConfigError);
    expect(() =>
      loadConfig({ TRADING_MODE: "live", BITVAVO_API_KEY: "k", BITVAVO_API_SECRET: "s", DATA_SOURCE: "simulated", DATA_DIR: dir }),
    ).toThrow(/gesimuleerde/);
    const cfg = loadConfig({
      TRADING_MODE: "LIVE",
      BITVAVO_API_KEY: "k",
      BITVAVO_API_SECRET: "s",
      AUTOSTART: "true",
      DATA_DIR: dir,
    });
    expect(cfg.mode).toBe("live");
    expect(cfg.autostart).toBe(false);
    expect(cfg.apiKey).toBe("k");
  });

  it.each([
    [{ TRADING_MODE: "yolo" }, /TRADING_MODE/],
    [{ DATA_SOURCE: "binance" }, /DATA_SOURCE/],
    [{ PORT: "abc" }, /PORT/],
    [{ PORT: "70000" }, /PORT/],
    [{ PAPER_STARTING_CAPITAL: "1" }, /PAPER_STARTING_CAPITAL/],
    [{ CAPITAL_LIMIT_EUR: "-5" }, /CAPITAL_LIMIT_EUR/],
    [{ MARKETS: "BTCEUR" }, /MARKETS/],
    [{ MARKETS: "BTC-USD" }, /MARKETS/],
    [{ MARKETS: Array.from({ length: 401 }, (_, i) => `M${i}-EUR`).join(",") }, /1 tot 400/],
    [{ INTERVAL: "3m" }, /INTERVAL/],
    [{ AUTOSTART: "misschien" }, /AUTOSTART/],
    [{ DASHBOARD_TOKEN: "kort" }, /DASHBOARD_TOKEN/],
    [{ BITVAVO_API_KEY: "alleen-key" }, /BITVAVO_API_SECRET/],
    [{ BITVAVO_OPERATOR_ID: "0" }, /BITVAVO_OPERATOR_ID/],
  ])("gooit een duidelijke fout voor %j", (env, msg) => {
    expect(() => loadConfig({ DATA_DIR: tmp(), ...env })).toThrow(msg);
  });

  it("legt opgeslagen dashboard-instellingen over env en standaard heen", () => {
    const dir = tmp();
    saveEngineOverrides(dir, {
      ...structuredClone(DEFAULT_ENGINE_CONFIG),
      markets: ["ETH-EUR"],
      pollMs: 30_000,
      risk: { ...DEFAULT_ENGINE_CONFIG.risk, riskPerTradePct: 1 },
      ensemble: { ...DEFAULT_ENGINE_CONFIG.ensemble, buyThreshold: 0.5, weights: { breakout: 2 } },
    });
    const saved = JSON.parse(readFileSync(join(dir, "config.json"), "utf8"));
    expect(saved.pollMs).toBe(30_000);

    const cfg = loadConfig({ DATA_DIR: dir, MARKETS: "BTC-EUR", INTERVAL: "1h" });
    expect(cfg.engine.markets).toEqual(["ETH-EUR"]); // overrides winnen van env
    expect(cfg.engine.interval).toBe("15m");
    expect(cfg.engine.pollMs).toBe(30_000);
    expect(cfg.engine.risk.riskPerTradePct).toBe(1);
    expect(cfg.engine.risk.stopAtrMult).toBe(DEFAULT_ENGINE_CONFIG.risk.stopAtrMult);
    expect(cfg.engine.ensemble.buyThreshold).toBe(0.5);
    expect(cfg.engine.ensemble.weights.breakout).toBe(2);
    expect(cfg.engine.ensemble.weights["ema-trend"]).toBe(1.2);
  });

  it("negeert een kapot of deels ongeldig overrides-bestand", () => {
    const dir = tmp();
    writeFileSync(join(dir, "config.json"), "{kapot");
    expect(loadConfig({ DATA_DIR: dir }).engine).toEqual(DEFAULT_ENGINE_CONFIG);

    writeFileSync(
      join(dir, "config.json"),
      JSON.stringify({ interval: "7m", pollMs: 1, markets: ["BTC-EUR", "ETH-EUR"], risk: { takeProfitR: "x", maxOpenPositions: 3 } }),
    );
    const cfg = loadConfig({ DATA_DIR: dir });
    expect(cfg.engine.interval).toBe("15m");
    expect(cfg.engine.pollMs).toBe(DEFAULT_ENGINE_CONFIG.pollMs);
    expect(cfg.engine.markets).toEqual(["BTC-EUR", "ETH-EUR"]);
    expect(cfg.engine.risk.takeProfitR).toBe(DEFAULT_ENGINE_CONFIG.risk.takeProfitR);
    expect(cfg.engine.risk.maxOpenPositions).toBe(3);
  });

  it("leest een .env-bestand zonder bestaande variabelen te overschrijven", () => {
    const dir = tmp();
    const envFile = join(dir, ".env");
    writeFileSync(envFile, `PORT=6000\nHOST=0.0.0.0\n# commentaar\nDATA_DIR=${dir}\nINTERVAL="1h"\n`);
    const env: NodeJS.ProcessEnv = { HOST: "127.0.0.1" };
    const cfg = loadConfig(env, { envFile });
    expect(cfg.port).toBe(6000);
    expect(cfg.host).toBe("127.0.0.1");
    expect(cfg.engine.interval).toBe("1h");
    // niet-bestaand bestand is geen probleem
    expect(() => loadConfig({ DATA_DIR: dir }, { envFile: join(dir, "bestaat-niet") })).not.toThrow();
  });

  describe("live mode buiten loopback", () => {
    const live = { TRADING_MODE: "live", BITVAVO_API_KEY: "k", BITVAVO_API_SECRET: "s" };

    it.each(["0.0.0.0", "::", "::2", "192.168.1.20", "127.evil.example", "127.0.0.1.nip.io"])(
      "weigert HOST=%s zonder DASHBOARD_TOKEN",
      (host) => {
        const load = () => loadConfig({ ...live, HOST: host, DATA_DIR: tmp() });
        expect(load).toThrow(ConfigError);
        expect(load).toThrow(/DASHBOARD_TOKEN/);
      },
    );

    it("staat live toe met een token, of op loopback zonder token", () => {
      expect(loadConfig({ ...live, HOST: "0.0.0.0", DASHBOARD_TOKEN: "lang-genoeg-1", DATA_DIR: tmp() }).host).toBe("0.0.0.0");
      for (const host of ["127.0.0.1", "127.0.0.2", "localhost", "::1", "[::1]", "0:0:0:0:0:0:0:1"]) {
        expect(loadConfig({ ...live, HOST: host, DATA_DIR: tmp() }).host).toBe(host);
      }
      expect(loadConfig({ ...live, DATA_DIR: tmp() }).host).toBe("127.0.0.1");
    });

    it("paper op 0.0.0.0 zonder token mag (alleen een waarschuwing bij het starten)", () => {
      const cfg = loadConfig({ HOST: "0.0.0.0", DATA_DIR: tmp() });
      expect(cfg.mode).toBe("paper");
      expect(cfg.host).toBe("0.0.0.0");
    });
  });

  describe("dashboard-instellingen versus .env", () => {
    it("waarschuwt als MARKETS/INTERVAL uit .env genegeerd worden", () => {
      const dir = tmp();
      saveEngineOverrides(dir, {
        ...structuredClone(DEFAULT_ENGINE_CONFIG),
        markets: ["BTC-EUR", "ETH-EUR"],
        interval: "15m",
        universe: { ...DEFAULT_UNIVERSE_CONFIG, mode: "manual" },
      });
      const warnings: string[] = [];
      const cfg = loadConfig({ DATA_DIR: dir, MARKETS: "ADA-EUR", INTERVAL: "1h" }, { warn: (m) => warnings.push(m) });
      expect(cfg.engine.markets).toEqual(["BTC-EUR", "ETH-EUR"]);
      expect(cfg.engine.interval).toBe("15m");
      expect(warnings).toHaveLength(2);
      expect(warnings[0]).toMatch(/MARKETS uit \.env \(ADA-EUR\) wordt genegeerd/);
      expect(warnings[0]).toContain(join(dir, "config.json"));
      expect(warnings[1]).toMatch(/INTERVAL uit \.env \(1h\) wordt genegeerd.*15m/);
    });

    it("waarschuwt niet als .env niets zegt of hetzelfde zegt", () => {
      const dir = tmp();
      saveEngineOverrides(dir, {
        ...structuredClone(DEFAULT_ENGINE_CONFIG),
        markets: ["ETH-EUR"],
        interval: "1h",
        universe: { ...DEFAULT_UNIVERSE_CONFIG, mode: "manual" },
      });
      const warnings: string[] = [];
      loadConfig({ DATA_DIR: dir }, { warn: (m) => warnings.push(m) });
      loadConfig({ DATA_DIR: dir, MARKETS: "eth-eur", INTERVAL: "1h" }, { warn: (m) => warnings.push(m) });
      expect(warnings).toEqual([]);
      // Zonder config.json geldt .env gewoon
      const fresh = loadConfig({ DATA_DIR: tmp(), MARKETS: "ADA-EUR", INTERVAL: "4h" }, { warn: (m) => warnings.push(m) });
      expect(fresh.engine.markets).toEqual(["ADA-EUR"]);
      expect(fresh.engine.interval).toBe("4h");
      expect(warnings).toEqual([]);
    });
  });

  describe("risico-instellingen uit config.json", () => {
    it("vervangt alleen ongeldige waarden door de standaard (per instelling)", () => {
      const dir = tmp();
      writeFileSync(
        join(dir, "config.json"),
        JSON.stringify({ risk: { takerFee: 0.05, slippagePct: 0.5, makerFee: 0.001, riskPerTradePct: 1 } }),
      );
      const warnings: string[] = [];
      const cfg = loadConfig({ DATA_DIR: dir }, { warn: (m) => warnings.push(m) });
      expect(cfg.engine.risk.takerFee).toBe(DEFAULT_ENGINE_CONFIG.risk.takerFee);
      expect(cfg.engine.risk.slippagePct).toBe(DEFAULT_ENGINE_CONFIG.risk.slippagePct);
      expect(cfg.engine.risk.makerFee).toBe(0.001);
      expect(cfg.engine.risk.riskPerTradePct).toBe(1);
      expect(warnings.join(" ")).toMatch(/risk\.takerFee/);
      expect(warnings.join(" ")).toMatch(/risk\.slippagePct/);
    });

    it("repairRiskConfig herstelt per sleutel en laat geldige waarden staan", () => {
      const risk = { ...DEFAULT_ENGINE_CONFIG.risk, takerFee: 0.25, slippagePct: 0.5, makerFee: 0.001, stopAtrMult: 3 };
      const fixed = repairRiskConfig(risk);
      expect(fixed.sort()).toEqual(["slippagePct", "takerFee"]);
      expect(risk.takerFee).toBe(DEFAULT_ENGINE_CONFIG.risk.takerFee);
      expect(risk.slippagePct).toBe(DEFAULT_ENGINE_CONFIG.risk.slippagePct);
      expect(risk.makerFee).toBe(0.001);
      expect(risk.stopAtrMult).toBe(3);
      const ok = { ...DEFAULT_ENGINE_CONFIG.risk };
      expect(repairRiskConfig(ok)).toEqual([]);
      expect(ok).toEqual(DEFAULT_ENGINE_CONFIG.risk);
    });
  });
});

// ─────────────────────────────── v2: veel munten, muntkeuze, trendfilter ───────────────────────────────

describe("MARKETS uit .env (v2)", () => {
  it("zonder MARKETS: automatisch, 30 munten (standaard)", () => {
    const cfg = loadConfig({ DATA_DIR: tmp() });
    expect(cfg.engine.universe).toEqual({ mode: "auto", count: 30, minVolumeEur: 250_000 });
    expect(cfg.engine.markets).toEqual(DEFAULT_ENGINE_CONFIG.markets);
  });

  it.each([
    ["auto", 30],
    ["AUTO", 30],
    [" auto ", 30],
    ["auto:1", 1],
    ["auto:10", 10],
    ["Auto: 100", 100],
    ["auto:400", 400],
  ])("MARKETS=%j → automatisch met %d munten (eigen lijst blijft de standaard)", (raw, count) => {
    const cfg = loadConfig({ DATA_DIR: tmp(), MARKETS: raw });
    expect(cfg.engine.universe).toEqual({ mode: "auto", count, minVolumeEur: 250_000 });
    expect(cfg.engine.markets).toEqual(DEFAULT_ENGINE_CONFIG.markets);
  });

  it("een lijst → zelf gekozen (manual) met precies die markten", () => {
    const cfg = loadConfig({ DATA_DIR: tmp(), MARKETS: "ada-eur, BTC-EUR,ada-eur" });
    expect(cfg.engine.markets).toEqual(["ADA-EUR", "BTC-EUR"]);
    expect(cfg.engine.universe).toEqual({ mode: "manual", count: 30, minVolumeEur: 250_000 });
  });

  it("accepteert tot 400 markten", () => {
    const list = Array.from({ length: 400 }, (_, i) => `M${i}-EUR`);
    const cfg = loadConfig({ DATA_DIR: tmp(), MARKETS: list.join(",") });
    expect(cfg.engine.markets).toEqual(list);
    expect(cfg.engine.universe?.mode).toBe("manual");
  });

  it.each([
    ["auto:0", /MARKETS=auto:N: N moet een geheel getal van 1 tot 400 zijn \(nu: "0"\)/],
    ["auto:401", /1 tot 400.*"401"/],
    ["auto:abc", /"abc"/],
    ["auto:", /nu: ""/],
    ["auto:2.5", /"2\.5"/],
    ["auto:-3", /"-3"/],
    ["auto:0x10", /"0x10"/],
    ["auto:30,BTC-EUR", /auto:N/],
    ["automatisch", /ongeldige markten: AUTOMATISCH/],
    [",", /MARKETS moet 1 tot 400 markten bevatten \(nu: 0\)/],
    [Array.from({ length: 401 }, (_, i) => `M${i}-EUR`).join(","), /MARKETS moet 1 tot 400 markten bevatten \(nu: 401\)/],
    ["BTC-EUR,DOGE", /ongeldige markten: DOGE/],
  ])("MARKETS=%j → duidelijke ConfigError", (raw, msg) => {
    const load = () => loadConfig({ DATA_DIR: tmp(), MARKETS: raw });
    expect(load).toThrow(ConfigError);
    expect(load).toThrow(msg);
  });

  it("een lange lijst ongeldige markten wordt ingekort in de melding", () => {
    const bad = Array.from({ length: 25 }, (_, i) => `X${i}`).join(",");
    expect(() => loadConfig({ DATA_DIR: tmp(), MARKETS: bad })).toThrow(/X9 \+15 meer/);
  });

  it("parseMarketsEnv los", () => {
    expect(parseMarketsEnv("auto")).toEqual({ mode: "auto", count: 30 });
    expect(parseMarketsEnv("auto:7")).toEqual({ mode: "auto", count: 7 });
    expect(parseMarketsEnv("eth-eur")).toEqual({ mode: "manual", markets: ["ETH-EUR"] });
  });
});

describe("opgeslagen instellingen (v2): markets, universe, trendFilter, maxSpreadPct", () => {
  function write(dir: string, obj: unknown): void {
    writeFileSync(join(dir, "config.json"), JSON.stringify(obj));
  }

  it("leest geldige waarden (ook 400 markten)", () => {
    const dir = tmp();
    const markets = Array.from({ length: 400 }, (_, i) => `M${i}-EUR`);
    write(dir, {
      markets,
      universe: { mode: "manual", count: 120, minVolumeEur: 1_000_000 },
      ensemble: { trendFilter: { market: false, coin: true, interval: "4h", period: 20 } },
      risk: { maxSpreadPct: 0.5 },
    });
    const warnings: string[] = [];
    const o = readEngineOverrides(dir, (m) => warnings.push(m));
    expect(warnings).toEqual([]);
    expect(o.markets).toEqual(markets);
    expect(o.universe).toEqual({ mode: "manual", count: 120, minVolumeEur: 1_000_000 });
    expect(o.ensemble?.trendFilter).toEqual({ market: false, coin: true, interval: "4h", period: 20 });
    expect(o.risk?.maxSpreadPct).toBe(0.5);

    const cfg = loadConfig({ DATA_DIR: dir });
    expect(cfg.engine.markets).toHaveLength(400);
    expect(cfg.engine.universe).toEqual({ mode: "manual", count: 120, minVolumeEur: 1_000_000 });
    expect(cfg.engine.ensemble.trendFilter).toEqual({ market: false, coin: true, interval: "4h", period: 20 });
    expect(cfg.engine.risk.maxSpreadPct).toBe(0.5);
  });

  it("slaat ongeldige velden per veld over (met waarschuwing) en houdt de geldige", () => {
    const dir = tmp();
    write(dir, {
      markets: Array.from({ length: 401 }, (_, i) => `M${i}-EUR`),
      universe: { mode: "alles", count: 50, minVolumeEur: -1 },
      ensemble: { trendFilter: { market: "ja", coin: true, interval: "1h", period: 4 } },
      risk: { maxSpreadPct: 6, riskPerTradePct: 1 },
    });
    const warnings: string[] = [];
    const o = readEngineOverrides(dir, (m) => warnings.push(m));
    expect(o.markets).toBeUndefined();
    expect(o.universe).toEqual({ count: 50 });
    expect(o.ensemble?.trendFilter).toEqual({ coin: true });
    expect(o.risk).toEqual({ riskPerTradePct: 1 });
    expect(warnings).toHaveLength(1);
    for (const key of [
      "markets",
      "universe.mode",
      "universe.minVolumeEur",
      "ensemble.trendFilter.market",
      "ensemble.trendFilter.interval",
      "ensemble.trendFilter.period",
      "risk.maxSpreadPct",
    ]) {
      expect(warnings[0]).toContain(key);
    }
    expect(warnings[0]).not.toContain("universe.count");
    expect(warnings[0]).not.toContain("trendFilter.coin");

    // Samengevoegd over de standaard: alleen de geldige velden wijzigen
    const cfg = loadConfig({ DATA_DIR: dir }, { warn: () => {} });
    expect(cfg.engine.markets).toEqual(DEFAULT_ENGINE_CONFIG.markets);
    expect(cfg.engine.universe).toEqual({ mode: "auto", count: 50, minVolumeEur: 250_000 });
    expect(cfg.engine.ensemble.trendFilter).toEqual({ market: true, coin: true, interval: "1d", period: 50 });
    expect(cfg.engine.risk.maxSpreadPct).toBe(0.3);
    expect(cfg.engine.risk.riskPerTradePct).toBe(1);
  });

  it.each([
    [{ universe: "auto" }, "universe"],
    [{ universe: { count: 0 } }, "universe.count"],
    [{ universe: { count: 401 } }, "universe.count"],
    [{ universe: { count: 12.5 } }, "universe.count"],
    [{ universe: { minVolumeEur: 2e12 } }, "universe.minVolumeEur"],
    [{ universe: { minVolumeEur: "veel" } }, "universe.minVolumeEur"],
    [{ ensemble: { trendFilter: true } }, "ensemble.trendFilter"],
    [{ ensemble: { trendFilter: { period: 201 } } }, "ensemble.trendFilter.period"],
    [{ ensemble: { trendFilter: { period: 20.5 } } }, "ensemble.trendFilter.period"],
    [{ ensemble: { trendFilter: { coin: 1 } } }, "ensemble.trendFilter.coin"],
    [{ risk: { maxSpreadPct: -0.1 } }, "risk.maxSpreadPct"],
    [{ markets: [] }, "markets"],
  ])("ongeldig %j → %s overgeslagen", (obj, key) => {
    const dir = tmp();
    write(dir, obj);
    const warnings: string[] = [];
    readEngineOverrides(dir, (m) => warnings.push(m));
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toMatch(new RegExp(`: (.*, )?${key.replace(/\./g, "\\.")}(,|$)`));
  });

  it("randwaarden zijn geldig", () => {
    const dir = tmp();
    write(dir, {
      universe: { mode: "auto", count: 400, minVolumeEur: 0 },
      ensemble: { trendFilter: { period: 5 } },
      risk: { maxSpreadPct: 0 },
    });
    const warnings: string[] = [];
    const o = readEngineOverrides(dir, (m) => warnings.push(m));
    expect(warnings).toEqual([]);
    expect(o.universe).toEqual({ mode: "auto", count: 400, minVolumeEur: 0 });
    expect(o.ensemble?.trendFilter).toEqual({ period: 5 });
    expect(o.risk?.maxSpreadPct).toBe(0);
    write(dir, { universe: { count: 1, minVolumeEur: 1e12 }, ensemble: { trendFilter: { period: 200 } }, risk: { maxSpreadPct: 5 } });
    expect(readEngineOverrides(dir, (m) => warnings.push(m))).toMatchObject({
      universe: { count: 1, minVolumeEur: 1e12 },
      ensemble: { trendFilter: { period: 200 } },
      risk: { maxSpreadPct: 5 },
    });
    expect(warnings).toEqual([]);
  });

  it("opslaan en weer laden geeft dezelfde instellingen (universe, trendFilter, maxSpreadPct)", () => {
    const dir = tmp();
    const saved = {
      ...structuredClone(DEFAULT_ENGINE_CONFIG),
      markets: ["ADA-EUR", "SOL-EUR"],
      universe: { mode: "manual" as const, count: 75, minVolumeEur: 500_000 },
      ensemble: {
        ...structuredClone(DEFAULT_ENGINE_CONFIG.ensemble),
        trendFilter: { market: false, coin: true, interval: "4h" as const, period: 30 },
      },
      risk: { ...DEFAULT_ENGINE_CONFIG.risk, maxSpreadPct: 1.2 },
    };
    saveEngineOverrides(dir, saved);
    const file = JSON.parse(readFileSync(join(dir, "config.json"), "utf8"));
    expect(file.universe).toEqual(saved.universe);
    expect(file.ensemble.trendFilter).toEqual(saved.ensemble.trendFilter);
    expect(file.risk.maxSpreadPct).toBe(1.2);
    expect(loadConfig({ DATA_DIR: dir }).engine).toEqual(saved);
  });

  it("een config ZONDER universe/trendFilter/maxSpreadPct blijft na opslaan en laden manual / filter uit / geen spreadlimiet", () => {
    const dir = tmp();
    const v1 = structuredClone(DEFAULT_ENGINE_CONFIG);
    delete v1.universe;
    delete v1.ensemble.trendFilter;
    delete v1.risk.maxSpreadPct;
    v1.markets = ["ETH-EUR"];
    saveEngineOverrides(dir, v1);
    // saveEngineOverrides wijzigt het meegegeven object niet
    expect(v1.universe).toBeUndefined();
    const cfg = loadConfig({ DATA_DIR: dir }).engine;
    expect(cfg.markets).toEqual(["ETH-EUR"]);
    expect(cfg.universe).toEqual({ mode: "manual", count: 30, minVolumeEur: 250_000 });
    expect(cfg.ensemble.trendFilter).toEqual({ market: false, coin: false, interval: "1d", period: 50 });
    expect(cfg.risk.maxSpreadPct).toBe(0);
  });
});

describe("mergeEngineConfig en cloneEngineConfig (v2)", () => {
  it("voegt universe en trendFilter per veld samen", () => {
    const base = structuredClone(DEFAULT_ENGINE_CONFIG);
    const out = mergeEngineConfig(base, {
      universe: { count: 100 } as UniverseConfig,
      ensemble: { trendFilter: { coin: true } } as EnsembleConfig,
      risk: { maxSpreadPct: 0.8 } as RiskConfig,
    });
    expect(out.universe).toEqual({ mode: "auto", count: 100, minVolumeEur: 250_000 });
    expect(out.ensemble.trendFilter).toEqual({ market: true, coin: true, interval: "1d", period: 50 });
    expect(out.ensemble.enabled).toEqual(DEFAULT_ENGINE_CONFIG.ensemble.enabled);
    expect(out.risk.maxSpreadPct).toBe(0.8);
    expect(out.risk.stopAtrMult).toBe(DEFAULT_ENGINE_CONFIG.risk.stopAtrMult);
    // basis ongewijzigd, geen gedeelde objecten
    expect(base).toEqual(DEFAULT_ENGINE_CONFIG);
    expect(out.universe).not.toBe(base.universe);
    expect(out.ensemble.trendFilter).not.toBe(base.ensemble.trendFilter);
  });

  it("basis zonder universe = manual, ensemble zonder trendFilter = filter uit", () => {
    const base = structuredClone(DEFAULT_ENGINE_CONFIG);
    delete base.universe;
    delete base.ensemble.trendFilter;
    const out = mergeEngineConfig(base, {
      universe: { minVolumeEur: 1 } as UniverseConfig,
      ensemble: { trendFilter: { period: 20 } } as EnsembleConfig,
    });
    expect(out.universe).toEqual({ mode: "manual", count: 30, minVolumeEur: 1 });
    expect(out.ensemble.trendFilter).toEqual({ market: false, coin: false, interval: "1d", period: 20 });
    // zonder patch blijven ze weg
    const same = mergeEngineConfig(base, { pollMs: 20_000 });
    expect(same.universe).toBeUndefined();
    expect(same.ensemble.trendFilter).toBeUndefined();
  });

  it("cloneEngineConfig kopieert universe en trendFilter diep", () => {
    const base = structuredClone(DEFAULT_ENGINE_CONFIG);
    const c = cloneEngineConfig(base);
    expect(c).toEqual(base);
    c.universe!.count = 5;
    c.ensemble.trendFilter!.coin = true;
    expect(base.universe!.count).toBe(30);
    expect(base.ensemble.trendFilter!.coin).toBe(false);
  });
});

describe("waarschuwing: muntkeuze uit .env overschreven door het dashboard", () => {
  function load(env: NodeJS.ProcessEnv, saved: Partial<EngineConfig>) {
    const dir = tmp();
    saveEngineOverrides(dir, { ...structuredClone(DEFAULT_ENGINE_CONFIG), ...saved });
    const warnings: string[] = [];
    const cfg = loadConfig({ DATA_DIR: dir, ...env }, { warn: (m) => warnings.push(m) });
    return { cfg, warnings, file: join(dir, "config.json") };
  }

  it("lijst in .env, automatische keuze opgeslagen → noemt de automatische keuze", () => {
    const { cfg, warnings, file } = load({ MARKETS: "ADA-EUR" }, { markets: ["BTC-EUR"] });
    expect(cfg.engine.universe?.mode).toBe("auto");
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toMatch(/MARKETS uit \.env \(ADA-EUR\) wordt genegeerd/);
    expect(warnings[0]).toMatch(/de automatische muntkeuze \(de 30 munten met de meeste handel\) opgeslagen/);
    expect(warnings[0]).toContain(file);
  });

  it("auto in .env, eigen lijst opgeslagen → noemt de eigen lijst", () => {
    const { cfg, warnings } = load(
      { MARKETS: "auto:50" },
      { markets: ["BTC-EUR", "ETH-EUR"], universe: { ...DEFAULT_UNIVERSE_CONFIG, mode: "manual" } },
    );
    expect(cfg.engine.universe?.mode).toBe("manual");
    expect(cfg.engine.markets).toEqual(["BTC-EUR", "ETH-EUR"]);
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toMatch(/MARKETS uit \.env \(auto:50\) wordt genegeerd: in het dashboard is een eigen lijst \(BTC-EUR, ETH-EUR\) opgeslagen/);
  });

  it("auto:N in .env, ander aantal opgeslagen → waarschuwt; zelfde aantal → niet", () => {
    const diff = load({ MARKETS: "auto:50" }, { universe: { ...DEFAULT_UNIVERSE_CONFIG, count: 100 } });
    expect(diff.cfg.engine.universe?.count).toBe(100);
    expect(diff.warnings).toHaveLength(1);
    expect(diff.warnings[0]).toMatch(/\(auto:50\).*de 100 munten/);

    // Zelfde muntkeuze: een andere (reserve)lijst of minimum volume is geen overschrijving van MARKETS
    const same = load({ MARKETS: "auto" }, { markets: ["ETH-EUR"], universe: { ...DEFAULT_UNIVERSE_CONFIG, minVolumeEur: 1 } });
    expect(same.warnings).toEqual([]);
    expect(same.cfg.engine.markets).toEqual(["ETH-EUR"]);
  });

  it("een lange opgeslagen lijst wordt ingekort", () => {
    const markets = Array.from({ length: 25 }, (_, i) => `M${i}-EUR`);
    const { warnings } = load({ MARKETS: "BTC-EUR" }, { markets, universe: { ...DEFAULT_UNIVERSE_CONFIG, mode: "manual" } });
    expect(warnings[0]).toMatch(/M9-EUR \+15 meer opgeslagen/);
  });

  it("oud config.json zonder universe (v1): een lijst in .env blijft manual met de opgeslagen markten", () => {
    const dir = tmp();
    writeFileSync(join(dir, "config.json"), JSON.stringify({ markets: ["ETH-EUR"], interval: "15m" }));
    const warnings: string[] = [];
    const cfg = loadConfig({ DATA_DIR: dir, MARKETS: "ETH-EUR" }, { warn: (m) => warnings.push(m) });
    expect(cfg.engine.universe?.mode).toBe("manual");
    expect(cfg.engine.markets).toEqual(["ETH-EUR"]);
    expect(warnings).toEqual([]);
  });
});

describe("helpers voor het startscherm", () => {
  it("shortList en describeAutoUniverse", () => {
    expect(shortList(["A", "B"])).toBe("A, B");
    const many = Array.from({ length: 12 }, (_, i) => `M${i}-EUR`);
    expect(shortList(many)).toBe("M0-EUR, M1-EUR, M2-EUR, M3-EUR, M4-EUR, M5-EUR, M6-EUR, M7-EUR, M8-EUR, M9-EUR +2 meer");
    expect(describeAutoUniverse({ count: 30, minVolumeEur: 250_000 })).toBe(
      "automatisch: de 30 munten met de meeste handel (min. €250.000 per dag)",
    );
    expect(describeAutoUniverse({ count: 1, minVolumeEur: 0 })).toBe("automatisch: de munt met de meeste handel (min. €0 per dag)");
  });
});

describe("oud config.json van v1 (zonder universe) — ronde 5", () => {
  /** Zoals v1 het opsloeg: de volledige config zonder v2-velden. */
  function v1File(markets: string[]): string {
    const dir = tmp();
    const v1 = structuredClone(DEFAULT_ENGINE_CONFIG) as Partial<EngineConfig>;
    delete v1.universe;
    delete v1.ensemble!.trendFilter;
    delete v1.risk!.maxSpreadPct;
    v1.markets = markets;
    writeFileSync(join(dir, "config.json"), JSON.stringify(v1));
    return dir;
  }

  it("zonder MARKETS in .env volgt de bot de opgeslagen munten (manual), met één uitleg bij het starten", () => {
    const dir = v1File(["BTC-EUR", "ADA-EUR"]);
    const warnings: string[] = [];
    const cfg = loadConfig({ DATA_DIR: dir }, { warn: (m) => warnings.push(m) });
    expect(cfg.engine.universe).toEqual({ mode: "manual", count: 30, minVolumeEur: 250_000 });
    expect(cfg.engine.markets).toEqual(["BTC-EUR", "ADA-EUR"]);
    expect(warnings).toEqual([
      `ℹ Oud instellingenbestand (${join(dir, "config.json")}): de bot volgt je opgeslagen munten (BTC-EUR, ADA-EUR). ` +
        "Automatisch kiezen kan in Instellingen → Munten.",
    ]);
    // De beschermende v2-standaarden blijven (trendfilter, spreadlimiet).
    expect(cfg.engine.ensemble.trendFilter).toEqual(DEFAULT_ENGINE_CONFIG.ensemble.trendFilter);
    expect(cfg.engine.risk.maxSpreadPct).toBe(DEFAULT_ENGINE_CONFIG.risk.maxSpreadPct);
  });

  it.each(["auto", "auto:50"])("MARKETS=%s in .env: de opgeslagen lijst wint, met de gewone melding", (raw) => {
    const dir = v1File(["BTC-EUR", "ADA-EUR"]);
    const warnings: string[] = [];
    const cfg = loadConfig({ DATA_DIR: dir, MARKETS: raw }, { warn: (m) => warnings.push(m) });
    expect(cfg.engine.universe?.mode).toBe("manual");
    expect(cfg.engine.markets).toEqual(["BTC-EUR", "ADA-EUR"]);
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toMatch(/^⚠ MARKETS uit \.env \(auto:\d+\) wordt genegeerd: in het dashboard is een eigen lijst \(BTC-EUR, ADA-EUR\) opgeslagen/);
  });

  it("readEngineOverrides: v1-bestand → universe manual + melding; v2-bestand met universe → ongewijzigd", () => {
    const seen: string[][] = [];
    const v1 = readEngineOverrides(v1File(["ETH-EUR"]), () => {}, (m) => seen.push(m));
    expect(v1.universe).toEqual({ mode: "manual" });
    expect(seen).toEqual([["ETH-EUR"]]);

    const dir = tmp();
    saveEngineOverrides(dir, { ...structuredClone(DEFAULT_ENGINE_CONFIG), markets: ["ETH-EUR"] });
    const v2 = readEngineOverrides(dir, () => {}, (m) => seen.push(m));
    expect(v2.universe).toEqual(DEFAULT_ENGINE_CONFIG.universe);
    expect(seen).toHaveLength(1);
    expect(loadConfig({ DATA_DIR: dir }).engine.universe?.mode).toBe("auto");
  });
});
