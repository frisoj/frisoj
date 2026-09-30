import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  ConfigError,
  DEFAULT_PAPER_CAPITAL_PER_BOT,
  botDataDir,
  botStateFile,
  loadBotEngineConfig,
  loadConfig,
  parseBotsEnv,
  planBots,
  resolveLiveBot,
  saveEngineOverrides,
} from "../../src/config";
import { assertNoOtherLiveLedgers, StartupError } from "../../src/bots/assemble";
import { liveLedgerMessage, otherOpenLiveLedgers, readLiveLedger } from "../../src/bots/liveGuard";
import { getProfile, profileEngineConfig } from "../../src/bots/profiles";
import { DEFAULT_ENGINE_CONFIG } from "../../src/core/defaults";

function tmp(): string {
  return mkdtempSync(join(tmpdir(), "bvt-bots-"));
}

const LIVE = { TRADING_MODE: "live", BITVAVO_API_KEY: "sleutel", BITVAVO_API_SECRET: "geheim" };

describe("BOTS uit .env", () => {
  it("leeg of weggelaten = alle vier, in vaste volgorde", () => {
    expect(parseBotsEnv(undefined)).toEqual(["scalper", "trend", "dip", "allround"]);
    expect(parseBotsEnv("")).toEqual(["scalper", "trend", "dip", "allround"]);
    expect(parseBotsEnv("   ")).toEqual(["scalper", "trend", "dip", "allround"]);
    expect(loadConfig({ DATA_DIR: tmp() }).bots).toEqual(["scalper", "trend", "dip", "allround"]);
  });

  it("volgorde blijft, hoofdletters/spaties maken niet uit, dubbele tellen één keer", () => {
    expect(parseBotsEnv(" Dip , trend,DIP,scalper ")).toEqual(["dip", "trend", "scalper"]);
    expect(parseBotsEnv("allround")).toEqual(["allround"]);
    expect(loadConfig({ DATA_DIR: tmp(), BOTS: "trend" }).bots).toEqual(["trend"]);
  });

  it("onbekende bot of een lege lijst → duidelijke Nederlandse fout met de keuzes", () => {
    expect(() => parseBotsEnv("scalper,turbo")).toThrow(ConfigError);
    expect(() => parseBotsEnv("scalper,turbo")).toThrow(/onbekende bot: "turbo".*scalper, trend, dip, allround/);
    expect(() => parseBotsEnv("x,y")).toThrow(/onbekende bots: "x", "y"/);
    expect(() => parseBotsEnv(" , ,")).toThrow(/BOTS bevat geen bots/);
    expect(() => loadConfig({ DATA_DIR: tmp(), BOTS: "turbo" })).toThrow(/BOTS/);
  });
});

describe("PAPER_CAPITAL_PER_BOT", () => {
  it("standaard 25; getal ≥ 5", () => {
    expect(DEFAULT_PAPER_CAPITAL_PER_BOT).toBe(25);
    expect(loadConfig({ DATA_DIR: tmp() }).paperCapitalPerBot).toBe(25);
    expect(loadConfig({ DATA_DIR: tmp(), PAPER_CAPITAL_PER_BOT: "100" }).paperCapitalPerBot).toBe(100);
    expect(loadConfig({ DATA_DIR: tmp(), PAPER_CAPITAL_PER_BOT: "12,5" }).paperCapitalPerBot).toBe(12.5);
    expect(() => loadConfig({ DATA_DIR: tmp(), PAPER_CAPITAL_PER_BOT: "4" })).toThrow(/PAPER_CAPITAL_PER_BOT moet minimaal 5/);
    expect(() => loadConfig({ DATA_DIR: tmp(), PAPER_CAPITAL_PER_BOT: "veel" })).toThrow(/PAPER_CAPITAL_PER_BOT moet een getal/);
  });
});

describe("LIVE_BOT", () => {
  it("resolveLiveBot: paper → geen live-bot; één bot → die bot; meer bots → LIVE_BOT verplicht en geldig", () => {
    const all = ["scalper", "trend", "dip", "allround"];
    expect(resolveLiveBot("paper", all, "trend")).toBeNull();
    expect(resolveLiveBot("live", ["dip"], undefined)).toBe("dip");
    expect(resolveLiveBot("live", ["dip"], "DIP")).toBe("dip");
    expect(() => resolveLiveBot("live", ["dip"], "trend")).toThrow(/LIVE_BOT=trend draait niet: BOTS bevat alleen dip/);
    expect(resolveLiveBot("live", all, " Trend ")).toBe("trend");
    expect(() => resolveLiveBot("live", all, undefined)).toThrow(ConfigError);
    expect(() => resolveLiveBot("live", all, undefined)).toThrow(/kies in \.env welke ÉÉN bot met echt geld handelt.*LIVE_BOT=trend/);
    expect(() => resolveLiveBot("live", all, "")).toThrow(/LIVE_BOT=/);
    expect(() => resolveLiveBot("live", all, "turbo")).toThrow(/LIVE_BOT="turbo" is geen bekende bot/);
    expect(() => resolveLiveBot("live", ["scalper", "dip"], "trend")).toThrow(/draait niet/);
  });

  it("loadConfig: in oefenmodus doet LIVE_BOT niets (alleen een melding)", () => {
    const warnings: string[] = [];
    const cfg = loadConfig({ DATA_DIR: tmp(), LIVE_BOT: "trend" }, { warn: (m) => warnings.push(m) });
    expect(cfg.liveBot).toBeUndefined();
    expect(warnings).toEqual(["ℹ LIVE_BOT=trend wordt genegeerd: TRADING_MODE=paper, dus alle bots oefenen met nep-geld."]);
  });

  it("loadConfig live: een ongeldige LIVE_BOT stopt meteen; een geldige wordt bewaard", () => {
    expect(() => loadConfig({ ...LIVE, DATA_DIR: tmp(), LIVE_BOT: "turbo" })).toThrow(/geen bekende bot/);
    expect(() => loadConfig({ ...LIVE, DATA_DIR: tmp(), BOTS: "scalper,dip", LIVE_BOT: "trend" })).toThrow(/draait niet/);
    expect(loadConfig({ ...LIVE, DATA_DIR: tmp(), LIVE_BOT: "Dip" }).liveBot).toBe("dip");
    // Zonder LIVE_BOT laadt de config wel (bestaand gedrag); planBots weigert daarna te starten.
    const noLive = loadConfig({ ...LIVE, DATA_DIR: tmp() });
    expect(noLive.liveBot).toBeUndefined();
    expect(() => planBots(noLive, { warn: () => {} })).toThrow(/LIVE_BOT=/);
  });
});

describe("mappen per bot", () => {
  it("één bot: de oude plek; meer bots: <DATA_DIR>/bots/<id>", () => {
    expect(botDataDir("/data", "trend", false)).toBe("/data");
    expect(botDataDir("/data", "trend", true)).toBe(join("/data", "bots", "trend"));
    expect(botStateFile("/data", "trend", false, "paper")).toBe(join("/data", "state-paper.json"));
    expect(botStateFile("/data", "dip", true, "live")).toBe(join("/data", "bots", "dip", "state-live.json"));
    expect(() => botDataDir("/data", "../etc", true)).toThrow(ConfigError);
    expect(() => botDataDir("/data", "", true)).toThrow(ConfigError);
  });
});

describe("loadBotEngineConfig", () => {
  it("profiel → (alleen bij één bot) MARKETS/INTERVAL → opgeslagen instellingen van die bot", () => {
    const dir = tmp();
    const scalper = getProfile("scalper")!;
    expect(loadBotEngineConfig(scalper, { dataDir: dir })).toEqual(profileEngineConfig(scalper));

    const withEnv = loadBotEngineConfig(scalper, {
      dataDir: dir,
      env: { markets: { mode: "manual", markets: ["ADA-EUR"] }, interval: "1h" },
    });
    expect(withEnv.interval).toBe("1h");
    expect(withEnv.markets).toEqual(["ADA-EUR"]);
    expect(withEnv.universe?.mode).toBe("manual");
    expect(withEnv.risk.stopAtrMult).toBe(1.2); // profiel blijft staan

    saveEngineOverrides(dir, { ...profileEngineConfig(scalper), pollMs: 20_000, risk: { ...profileEngineConfig(scalper).risk, stopAtrMult: 1.7 } });
    const saved = loadBotEngineConfig(scalper, { dataDir: dir, env: { interval: "4h" } });
    expect(saved.pollMs).toBe(20_000);
    expect(saved.risk.stopAtrMult).toBe(1.7);
    expect(saved.interval).toBe("5m"); // het opgeslagen interval wint van .env
  });

  it("ongeldige opgeslagen velden worden per veld genegeerd, met melding", () => {
    const dir = tmp();
    writeFileSync(join(dir, "config.json"), JSON.stringify({ interval: "7m", risk: { stopAtrMult: 1.9, takerFee: 0.5 } }));
    const warnings: string[] = [];
    const cfg = loadBotEngineConfig(getProfile("dip")!, { dataDir: dir, warn: (m) => warnings.push(m) });
    expect(cfg.interval).toBe("15m");
    expect(cfg.risk.stopAtrMult).toBe(1.9);
    expect(cfg.risk.takerFee).toBe(DEFAULT_ENGINE_CONFIG.risk.takerFee);
    expect(warnings.join(" ")).toMatch(/interval.*risk\.takerFee/);
  });
});

describe("planBots — meerdere bots (standaard)", () => {
  it("vier bots in oefenmodus, elk met eigen map, eigen kapitaal en eigen stijl; MARKETS/INTERVAL uit .env tellen niet", () => {
    const dir = tmp();
    const cfg = loadConfig({ DATA_DIR: dir, MARKETS: "BTC-EUR", INTERVAL: "1h", BITVAVO_API_KEY: "k", BITVAVO_API_SECRET: "s" });
    expect(cfg.marketsEnv).toEqual({ mode: "manual", markets: ["BTC-EUR"] });
    expect(cfg.intervalEnv).toBe("1h");
    const setups = planBots(cfg, { warn: () => {} });
    expect(setups.map((s) => s.id)).toEqual(["scalper", "trend", "dip", "allround"]);
    for (const s of setups) {
      expect(s.multi).toBe(true);
      expect(s.mode).toBe("paper");
      expect(s.dataDir).toBe(join(dir, "bots", s.id));
      expect(s.stateFile).toBe(join(dir, "bots", s.id, "state-paper.json"));
      expect(s.startingCapital).toBe(25);
      expect(s.autostart).toBe(true);
      expect(s.path).toBe(`/bot/${s.id}/`);
      expect(s.engine).toEqual(profileEngineConfig(s.profile));
      expect(s.appConfig).toMatchObject({ mode: "paper", dataDir: s.dataDir, paperStartingCapital: 25, autostart: true });
      // De oefenbots krijgen de API-sleutel niet.
      expect(s.appConfig.apiKey).toBeUndefined();
      expect(s.appConfig.apiSecret).toBeUndefined();
    }
    expect(setups.map((s) => s.engine.interval)).toEqual(["5m", "1h", "15m", "15m"]);
  });

  it("opgeslagen instellingen gelden alleen voor die ene bot; PAPER_CAPITAL_PER_BOT en AUTOSTART tellen", () => {
    const dir = tmp();
    const dip = getProfile("dip")!;
    saveEngineOverrides(join(dir, "bots", "dip"), { ...profileEngineConfig(dip), pollMs: 30_000 });
    // Het oude bestand van één bot doet bij meer bots niet mee.
    saveEngineOverrides(dir, { ...structuredClone(DEFAULT_ENGINE_CONFIG), pollMs: 60_000 });
    const cfg = loadConfig({ DATA_DIR: dir, PAPER_CAPITAL_PER_BOT: "40", AUTOSTART: "false" });
    const setups = planBots(cfg, { warn: () => {} });
    expect(setups.find((s) => s.id === "dip")!.engine.pollMs).toBe(30_000);
    for (const s of setups.filter((x) => x.id !== "dip")) expect(s.engine.pollMs).toBe(DEFAULT_ENGINE_CONFIG.pollMs);
    for (const s of setups) {
      expect(s.startingCapital).toBe(40);
      expect(s.autostart).toBe(false);
    }
  });

  it("meldingen over de instellingen van één bot alleen als er één bot draait (main.ts)", () => {
    const dir = tmp();
    saveEngineOverrides(dir, { ...structuredClone(DEFAULT_ENGINE_CONFIG), interval: "15m", markets: ["ETH-EUR"], universe: { mode: "manual", count: 30, minVolumeEur: 0 } });
    const multi: string[] = [];
    loadConfig({ DATA_DIR: dir, MARKETS: "ADA-EUR", INTERVAL: "1h" }, { warn: (m) => multi.push(m), onlySingleBotWarnings: true });
    expect(multi).toEqual([]);
    const single: string[] = [];
    loadConfig({ DATA_DIR: dir, MARKETS: "ADA-EUR", INTERVAL: "1h", BOTS: "allround" }, { warn: (m) => single.push(m), onlySingleBotWarnings: true });
    expect(single).toHaveLength(2);
    expect(single[0]).toMatch(/MARKETS uit \.env/);
  });

  it("live met LIVE_BOT: precies die bot live (CAPITAL_LIMIT_EUR, nooit automatisch, sleutel), de rest oefent", () => {
    const dir = tmp();
    const cfg = loadConfig({ ...LIVE, DATA_DIR: dir, LIVE_BOT: "dip", CAPITAL_LIMIT_EUR: "80", PAPER_CAPITAL_PER_BOT: "30" });
    const setups = planBots(cfg, { warn: () => {} });
    expect(setups.filter((s) => s.mode === "live").map((s) => s.id)).toEqual(["dip"]);
    const dip = setups.find((s) => s.id === "dip")!;
    expect(dip).toMatchObject({ mode: "live", startingCapital: 80, autostart: false, stateFile: join(dir, "bots", "dip", "state-live.json") });
    expect(dip.appConfig).toMatchObject({ mode: "live", apiKey: "sleutel", apiSecret: "geheim", capitalLimitQuote: 80, autostart: false });
    for (const s of setups.filter((x) => x.id !== "dip")) {
      expect(s).toMatchObject({ mode: "paper", startingCapital: 30, autostart: true });
      expect(s.stateFile).toBe(join(dir, "bots", s.id, "state-paper.json"));
      expect(s.appConfig.mode).toBe("paper");
      expect(s.appConfig.apiKey).toBeUndefined();
    }
  });
});

describe("planBots — één bot (oude paden en .env)", () => {
  it("BOTS=trend: DATA_DIR zelf, PAPER_STARTING_CAPITAL, MARKETS/INTERVAL uit .env over het profiel", () => {
    const dir = tmp();
    const cfg = loadConfig({ DATA_DIR: dir, BOTS: "trend", INTERVAL: "4h", MARKETS: "BTC-EUR,ETH-EUR", PAPER_STARTING_CAPITAL: "70" });
    const [s] = planBots(cfg);
    expect(s).toMatchObject({ id: "trend", multi: false, mode: "paper", dataDir: dir, startingCapital: 70, autostart: true });
    expect(s.stateFile).toBe(join(dir, "state-paper.json"));
    expect(s.engine.interval).toBe("4h");
    expect(s.engine.markets).toEqual(["BTC-EUR", "ETH-EUR"]);
    expect(s.engine.universe?.mode).toBe("manual");
    expect(s.engine.risk.takeProfitR).toBe(3); // stijl van de trendvolger
    expect(s.appConfig.dataDir).toBe(dir);
    expect(s.appConfig.paperStartingCapital).toBe(70);
  });

  it("het oude config.json (DATA_DIR) wint, zoals vroeger; zonder meldingen dubbel", () => {
    const dir = tmp();
    saveEngineOverrides(dir, { ...structuredClone(DEFAULT_ENGINE_CONFIG), pollMs: 45_000, interval: "30m" });
    const warnings: string[] = [];
    const cfg = loadConfig({ DATA_DIR: dir, BOTS: "allround", INTERVAL: "1h" }, { warn: (m) => warnings.push(m) });
    expect(warnings).toHaveLength(1); // INTERVAL genegeerd — één keer, door loadConfig
    const [s] = planBots(cfg, { warn: (m) => warnings.push(m) });
    expect(warnings).toHaveLength(1);
    expect(s.engine.pollMs).toBe(45_000);
    expect(s.engine.interval).toBe("30m");
    expect(s.engine).toEqual(cfg.engine); // volledig opgeslagen config: zelfde als vóór de wedstrijd
  });

  it("live met één bot: die bot is live, oude plek state-live.json, LIVE_BOT mag weg", () => {
    const dir = tmp();
    const [s] = planBots(loadConfig({ ...LIVE, DATA_DIR: dir, BOTS: "allround" }));
    expect(s).toMatchObject({ id: "allround", mode: "live", startingCapital: 50, autostart: false, stateFile: join(dir, "state-live.json") });
    expect(s.appConfig.apiKey).toBe("sleutel");
  });
});

describe("live: geen onbewaakte posities van een andere bot", () => {
  const state = (extra: object) =>
    JSON.stringify({ version: 1, mode: "live", savedAt: 0, account: { cashQuote: 1, startingEquity: 50 }, positions: [], trades: [], equityHistory: [], ...extra });

  it("vindt open live-posities/orders van de oude enkele bot en van andere bots, niet die van de bot zelf", () => {
    const dir = tmp();
    writeFileSync(join(dir, "state-live.json"), state({ positions: [{ id: "p1" }, { id: "p2" }] }));
    mkdirSync(join(dir, "bots", "trend"), { recursive: true });
    writeFileSync(join(dir, "bots", "trend", "state-live.json"), state({ unknownOrders: [{}], unknownSells: [{}] }));
    mkdirSync(join(dir, "bots", "scalper"), { recursive: true });
    writeFileSync(join(dir, "bots", "scalper", "state-live.json"), state({})); // leeg: geen probleem
    mkdirSync(join(dir, "bots", "dip"), { recursive: true });
    writeFileSync(join(dir, "bots", "dip", "state-live.json"), state({ positions: [{ id: "eigen" }] }));
    writeFileSync(join(dir, "bots", "dip", "state-paper.json"), state({ positions: [{ id: "oefen" }] }));

    const found = otherOpenLiveLedgers(dir, join(dir, "bots", "dip", "state-live.json"));
    expect(found).toEqual([
      { file: join(dir, "state-live.json"), botId: null, positions: 2, unknown: 0, unreadable: false },
      { file: join(dir, "bots", "trend", "state-live.json"), botId: "trend", positions: 0, unknown: 2, unreadable: false },
    ]);
    const msg = liveLedgerMessage(found, "Dip-koper");
    expect(msg).toMatch(/^Dip-koper kan niet live starten: er staan nog live-posities van een andere bot/);
    expect(msg).toContain("de enkele bot van vóór de wedstrijd: 2 open posities met echt geld");
    expect(msg).toContain('bot "Trendvolger": 2 orders met onbekende uitkomst');
    expect(msg).toMatch(/geen stop-loss/);
    // Concreet advies: welke instelling terug moet om die posities eerst te sluiten
    expect(msg).toContain("Zet eerst BOTS=allround (één bot: die gebruikt de oude bestanden weer) of LIVE_BOT=trend (met trend in BOTS) terug in .env");
  });

  it("een onleesbaar live-bestand telt ook (dan weten we het niet zeker)", () => {
    const dir = tmp();
    mkdirSync(join(dir, "bots", "trend"), { recursive: true });
    writeFileSync(join(dir, "bots", "trend", "state-live.json"), "{kapot");
    expect(readLiveLedger(join(dir, "bots", "trend", "state-live.json"), "trend")).toMatchObject({ unreadable: true });
    expect(readLiveLedger(join(dir, "bestaat-niet.json"), null)).toBeNull();
    expect(liveLedgerMessage(otherOpenLiveLedgers(dir, join(dir, "x.json")), "X")).toMatch(/onleesbaar/);
  });

  it("assertNoOtherLiveLedgers: weigert de live-bot met een StartupError; zonder andere live-posities geen probleem", () => {
    const dir = tmp();
    const setups = planBots(loadConfig({ ...LIVE, DATA_DIR: dir, LIVE_BOT: "trend" }), { warn: () => {} });
    expect(() => assertNoOtherLiveLedgers({ dataDir: dir }, setups)).not.toThrow();
    writeFileSync(join(dir, "state-live.json"), state({ positions: [{ id: "oud" }] }));
    expect(() => assertNoOtherLiveLedgers({ dataDir: dir }, setups)).toThrow(StartupError);
    expect(() => assertNoOtherLiveLedgers({ dataDir: dir }, setups)).toThrow(/Trendvolger kan niet live starten/);
    // In oefenmodus is er geen live-bot: niets te controleren.
    const paper = planBots(loadConfig({ DATA_DIR: dir }), { warn: () => {} });
    expect(() => assertNoOtherLiveLedgers({ dataDir: dir }, paper)).not.toThrow();
    // Eén live-bot met de oude paden: het eigen bestand is geen "andere" bot.
    const single = planBots(loadConfig({ ...LIVE, DATA_DIR: dir, BOTS: "allround" }));
    expect(() => assertNoOtherLiveLedgers({ dataDir: dir }, single)).not.toThrow();
  });
});
