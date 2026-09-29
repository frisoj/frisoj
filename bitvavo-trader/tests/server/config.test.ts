import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { ConfigError, PROJECT_ROOT, loadConfig, repairRiskConfig, saveEngineOverrides } from "../../src/config";
import { DEFAULT_ENGINE_CONFIG } from "../../src/core/defaults";

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
    [{ MARKETS: "A-EUR,B-EUR,C-EUR,D-EUR,E-EUR,F-EUR,G-EUR,H-EUR,I-EUR" }, /1 tot 8/],
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
      saveEngineOverrides(dir, { ...structuredClone(DEFAULT_ENGINE_CONFIG), markets: ["BTC-EUR", "ETH-EUR"], interval: "15m" });
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
      saveEngineOverrides(dir, { ...structuredClone(DEFAULT_ENGINE_CONFIG), markets: ["ETH-EUR"], interval: "1h" });
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
