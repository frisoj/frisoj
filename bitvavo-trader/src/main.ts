/**
 * Startpunt: `npm start`. Leest de configuratie, kiest de databron en broker,
 * start de trading-engine en het dashboard (HTTP + SSE).
 */
import { networkInterfaces } from "node:os";
import { join } from "node:path";
import {
  ConfigError,
  describeAutoUniverse,
  loadConfig,
  repairRiskConfig,
  shortList,
  universeOrManual,
  type AppConfig,
} from "./config";
import { APP_VERSION, DEFAULT_ENGINE_CONFIG } from "./core/defaults";
import type {
  BacktestResult,
  Broker,
  EngineConfig,
  MarketDataFeed,
  OptimizationResult,
  WalkForwardResult,
} from "./core/types";
import { BitvavoClient } from "./exchange/bitvavoClient";
import { LiveBroker } from "./broker/liveBroker";
import { PaperBroker } from "./broker/paperBroker";
import { BitvavoFeed } from "./data/bitvavoFeed";
import { SimulatedFeed } from "./data/simulatedFeed";
import { isBitvavoReachable } from "./data/reachability";
import { StateStore } from "./engine/stateStore";
import { TradingEngine } from "./engine/tradingEngine";
import { listStrategies } from "./strategies";
import { decisionsToMarkers, runEnsemble } from "./strategies/ensemble";
import { detectRegimes } from "./strategies/regime";
import { chartIndicators } from "./indicators";
import { validateRiskConfig } from "./risk/riskManager";
import { createApp, startHttpServer, isLoopbackHost, type RunningServer } from "./server/httpServer";
import { HeavyRunner } from "./server/heavyRunner";
import { createShutdown } from "./server/shutdown";
import { syncAccountFees } from "./server/accountFees";
import { attachTerminalLog } from "./server/terminalLog";
import type { Services } from "./server/routes";

class StartupError extends Error {}

const LINE = "═".repeat(66);
const BANG = "!".repeat(66);

function loud(lines: string[]): void {
  console.warn(`\n${BANG}`);
  for (const l of lines) console.warn(`  ${l}`);
  console.warn(`${BANG}\n`);
}

async function createFeed(config: AppConfig, client: BitvavoClient): Promise<MarketDataFeed> {
  const cacheDir = join(config.dataDir, "cache");
  if (config.dataSource === "simulated") return new SimulatedFeed();
  if (config.dataSource === "bitvavo") {
    console.log("Verbinding met Bitvavo controleren…");
    if (!(await isBitvavoReachable(client))) {
      throw new StartupError(
        "Bitvavo is niet bereikbaar (DATA_SOURCE=bitvavo). Controleer je internetverbinding, " +
          "of zet DATA_SOURCE=auto of simulated in .env om met gesimuleerde koersen te oefenen.",
      );
    }
    return new BitvavoFeed(client, { cacheDir });
  }
  console.log("Verbinding met Bitvavo controleren…");
  if (await isBitvavoReachable(client)) return new BitvavoFeed(client, { cacheDir });
  if (config.mode === "live") {
    throw new StartupError(
      "Bitvavo is niet bereikbaar en live trading met gesimuleerde koersen is niet toegestaan. " +
        "Controleer je internetverbinding, of zet TRADING_MODE=paper om te oefenen.",
    );
  }
  loud([
    "⚠  LET OP: Bitvavo is NIET bereikbaar.",
    "⚠  De bot gebruikt nu GESIMULEERDE koersen: alle prijzen, signalen en",
    "⚠  resultaten in het dashboard zijn NEP en zeggen niets over de echte markt.",
    "⚠  Controleer je internetverbinding en herstart, of zet DATA_SOURCE=simulated",
    "⚠  in .env als je bewust met simulatie wilt oefenen.",
  ]);
  return new SimulatedFeed();
}

/**
 * Houdt in de eigen marktlijst (`config.markets`, 1..400) alleen markten over
 * die bestaan en verhandelbaar zijn in EUR. Bij de automatische muntkeuze is
 * dat de reservelijst (tot de eerste automatische keuze); die keuze zelf
 * gebruikt altijd de actuele marktlijst van Bitvavo.
 */
async function sanitizeMarkets(feed: MarketDataFeed, engine: EngineConfig): Promise<void> {
  let known: Set<string>;
  try {
    const markets = await feed.getMarkets();
    known = new Set(markets.filter((m) => m.quote === "EUR" && m.status === "trading").map((m) => m.market));
  } catch (err) {
    console.warn(`⚠ Kon de marktlijst niet ophalen (${(err as Error).message}); markten niet gecontroleerd.`);
    return;
  }
  const auto = universeOrManual(engine.universe).mode === "auto";
  const which = auto ? "je eigen marktlijst (reserve voor de automatische keuze)" : "je marktlijst";
  const ok = engine.markets.filter((m) => known.has(m));
  const dropped = engine.markets.filter((m) => !known.has(m));
  if (dropped.length > 0) {
    console.warn(`⚠ Onbekende of niet-verhandelbare markten overgeslagen in ${which}: ${shortList(dropped)}`);
  }
  if (ok.length === 0) {
    const fallback = DEFAULT_ENGINE_CONFIG.markets.filter((m) => known.has(m));
    const list = fallback.length > 0 ? fallback : [...known].sort().slice(0, 3);
    if (list.length === 0) throw new StartupError("Er zijn geen verhandelbare EUR-markten gevonden.");
    console.warn(`⚠ Geen geldige markten in ${which}; de bot gebruikt ${list.join(", ")}.`);
    engine.markets = list;
  } else {
    engine.markets = ok;
  }
}

/** De "Markten:"-regel van het startscherm. */
function marketsLine(engineCfg: EngineConfig): string {
  const u = universeOrManual(engineCfg.universe);
  return u.mode === "auto" ? describeAutoUniverse(u) : shortList(engineCfg.markets);
}

function printBanner(
  config: AppConfig,
  feed: MarketDataFeed,
  engineCfg: EngineConfig,
  url: string,
  running: boolean | "starting",
) {
  const eur = (n: number) => `€${n.toLocaleString("nl-NL", { maximumFractionDigits: 2 })}`;
  const out: string[] = [];
  out.push("", LINE, `  Bitvavo Trader v${APP_VERSION}`, LINE);
  if (config.mode === "paper") {
    out.push(`  Modus:      OEFENMODUS (paper) — Oefenmodus met nep-geld (${eur(config.paperStartingCapital)})`);
  } else {
    out.push(`  Modus:      LIVE — ECHT GELD (de bot gebruikt maximaal ${eur(config.capitalLimitQuote)})`);
    out.push("              Er worden pas echte orders geplaatst als je de bot in het dashboard 'armt'.");
    const r = engineCfg.risk;
    const pct = (n: number, d = 2) => `${n.toLocaleString("nl-NL", { maximumFractionDigits: d })}%`;
    out.push(
      `  Risico:     ${pct(r.riskPerTradePct)} per trade, max ${pct(r.maxPositionPct)} per positie, ` +
        `dagverlieslimiet ${pct(r.dailyLossLimitPct)}, taker fee ${pct(r.takerFee * 100, 3)}`,
    );
  }
  out.push(
    `  Marktdata:  ${feed.source === "bitvavo" ? "Bitvavo (echte koersen)" : "SIMULATIE (nep-koersen, geen echte markt)"}`,
  );
  out.push(`  Markten:    ${marketsLine(engineCfg)}`);
  out.push(`  Interval:   ${engineCfg.interval}`);
  out.push(
    `  Bot:        ${
      running === "starting"
        ? "wordt gestart (eerste koersen ophalen…)"
        : running
          ? "draait"
          : "gestopt (start hem in het dashboard)"
    }`,
  );
  if (config.dashboardToken) out.push("  Token:      dashboard vraagt om DASHBOARD_TOKEN uit .env");
  const phoneUrls = lanUrls(config);
  if (phoneUrls.length > 0) {
    out.push("", `  ➜ Op deze computer:     http://127.0.0.1:${config.port}`);
    for (const u of phoneUrls) out.push(`  ➜ Op je telefoon (zelfde wifi): ${u}`);
    if (!config.dashboardToken) out.push("  ⚠ Zet een DASHBOARD_TOKEN in .env: nu kan iedereen op je wifi de bot bedienen.");
    out.push("", "  Stoppen: druk op Ctrl+C", LINE, "");
  } else {
    out.push("", `  ➜ Open het dashboard:  ${url}`, "", "  Stoppen: druk op Ctrl+C", LINE, "");
  }
  console.log(out.join("\n"));
}

/** Bij HOST=0.0.0.0 (of ::): de adressen waarop een telefoon in hetzelfde netwerk het dashboard vindt. */
function lanUrls(config: AppConfig): string[] {
  if (config.host !== "0.0.0.0" && config.host !== "::" && config.host !== "[::]") return [];
  const urls: string[] = [];
  for (const addrs of Object.values(networkInterfaces())) {
    for (const a of addrs ?? []) {
      if (a.family === "IPv4" && !a.internal) urls.push(`http://${a.address}:${config.port}`);
    }
  }
  return urls;
}

async function main(): Promise<void> {
  const config = loadConfig();
  const engineConfig = structuredClone(config.engine);
  // Vóór het bouwen van een broker: de PaperBroker neemt fee/slippage over.
  const fixedRisk = repairRiskConfig(engineConfig.risk);
  if (fixedRisk.length > 0) {
    console.warn(`⚠ Ongeldige risico-instellingen vervangen door standaardwaarden: ${fixedRisk.join(", ")}.`);
  }

  const client = new BitvavoClient({
    apiKey: config.apiKey,
    apiSecret: config.apiSecret,
    operatorId: config.operatorId,
  });

  const feed = await createFeed(config, client);
  if (config.mode === "live" && feed.source !== "bitvavo") {
    throw new StartupError(
      "Live trading met gesimuleerde koersen is niet toegestaan. Zorg dat Bitvavo bereikbaar is " +
        "(DATA_SOURCE=bitvavo) of zet TRADING_MODE=paper.",
    );
  }
  await sanitizeMarkets(feed, engineConfig);

  let broker: Broker;
  if (config.mode === "paper") {
    broker = new PaperBroker({
      startingQuote: config.paperStartingCapital,
      takerFee: engineConfig.risk.takerFee,
      slippagePct: engineConfig.risk.slippagePct,
    });
  } else {
    broker = new LiveBroker(client, {
      getMarketInfo: async (market: string) => (await feed.getMarkets()).find((m) => m.market === market),
    });
    // Echte fees ophalen en daarna ook aan de (al gebouwde) LiveBroker doorgeven.
    await syncAccountFees({
      account: () => client.account(),
      broker,
      risk: engineConfig.risk,
      validateRisk: validateRiskConfig,
    });
  }

  const store = new StateStore(join(config.dataDir, `state-${config.mode}.json`));
  const engine = new TradingEngine({
    feed,
    broker,
    config: engineConfig,
    mode: config.mode,
    store,
    startingCapital: config.mode === "paper" ? config.paperStartingCapital : config.capitalLimitQuote,
  });
  // Ook wat de engine al tijdens het bouwen logde (bijv. "Opgeslagen staat onbruikbaar …"),
  // daarna elke nieuwe regel.
  attachTerminalLog(engine);
  // Zolang de bot niet draait (vóór Start, na Stop/noodstop): alleen koersen verversen,
  // meteen één keer, zodat herstelde posities niet tegen de instapkoers getoond worden.
  void engine.startPriceMonitor();

  // Backtests/optimalisaties in een worker-thread: de engine en de noodstop blijven reageren.
  const heavyRunner = new HeavyRunner({ log: (m) => console.warn(m) });
  const services: Services = {
    runBacktest: (input) => heavyRunner.run<BacktestResult>("backtest", input),
    optimize: (input, opts) => heavyRunner.run<OptimizationResult>("optimize", input, opts),
    walkForward: (input, opts) => heavyRunner.run<WalkForwardResult>("walkForward", input, opts),
    listStrategies,
    chartIndicators,
    runEnsemble,
    decisionsToMarkers,
    detectRegimes,
    validateRiskConfig,
  };
  const app = createApp({ config, engine, feed, services });

  let server: RunningServer;
  try {
    server = await startHttpServer(app, config.host, config.port);
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code;
    if (code === "EADDRINUSE") {
      throw new StartupError(
        `Poort ${config.port} is al in gebruik. Draait de bot al in een ander venster? ` +
          "Sluit die eerst, of kies een andere PORT in .env.",
      );
    }
    if (code === "EADDRNOTAVAIL" || code === "EACCES") {
      throw new StartupError(`Kan niet luisteren op ${config.host}:${config.port} (${code}). Controleer HOST en PORT in .env.`);
    }
    throw err;
  }

  if (!isLoopbackHost(config.host) && !config.dashboardToken) {
    loud([
      `⚠  Het dashboard is bereikbaar vanaf andere apparaten (HOST=${config.host})`,
      "⚠  zonder wachtwoord. Zet DASHBOARD_TOKEN in .env of gebruik HOST=127.0.0.1.",
    ]);
  }

  // Eerst het adres tonen: de server draait al. De eerste tick (koersen ophalen)
  // kan bij een trage verbinding even duren; daar mag het startscherm niet op wachten.
  printBanner(config, feed, engine.snapshot().config, server.url, config.autostart ? "starting" : false);
  if (config.autostart) {
    const localUrl = lanUrls(config).length > 0 ? `http://127.0.0.1:${config.port}` : server.url;
    const slow = setTimeout(() => {
      console.log(
        `⏳ Nog bezig met de eerste koersen ophalen${feed.source === "bitvavo" ? " bij Bitvavo" : ""}… ` +
          `Het dashboard werkt al: ${localUrl}`,
      );
    }, 15_000);
    slow.unref();
    engine
      .start()
      .then(
        () => console.log(`✔ De bot draait. Open het dashboard: ${localUrl}`),
        (err: unknown) =>
          console.error(`✖ Kon de bot niet automatisch starten: ${(err as Error).message}. Start hem in het dashboard.`),
      )
      .finally(() => clearTimeout(slow));
  }
  if (config.mode === "live") {
    loud([
      "⚠  LIVE MODE: je handelt met ECHT geld. Verlies is mogelijk.",
      "⚠  Start de bot in het dashboard en arm hem pas als je het zeker weet.",
    ]);
  }

  // ── Netjes afsluiten ──
  // In live mode wacht de noodrem langer zolang er (mogelijk) een order bij Bitvavo
  // loopt; zie src/server/shutdown.ts.
  const { shutdown } = createShutdown({
    mode: config.mode,
    stopEngine: async () => {
      engine.stopPriceMonitor();
      await heavyRunner.close().catch(() => undefined);
      await engine.stop();
    },
    cleanup: async () => {
      try {
        store.flush();
      } catch (err) {
        console.error(`Fout bij opslaan van de toestand: ${(err as Error).message}`);
      }
      await server.close().catch(() => undefined);
    },
    // Optionele vlag van de engine; zonder vlag geldt "mogelijk" tot engine.stop() klaar is.
    orderInFlight: () => {
      const flag = (engine as unknown as { orderInFlight?: unknown }).orderInFlight;
      return typeof flag === "boolean" ? flag : undefined;
    },
    exit: (code) => process.exit(code),
    loud,
  });
  process.on("SIGINT", () => void shutdown("SIGINT"));
  process.on("SIGTERM", () => void shutdown("SIGTERM"));
  // Terminal/venster gesloten (en Ctrl+Break op Windows): ook netjes afsluiten.
  process.on("SIGHUP", () => void shutdown("SIGHUP"));
  if (process.platform === "win32") process.on("SIGBREAK", () => void shutdown("SIGBREAK"));
  process.on("unhandledRejection", (reason) => {
    console.error(`✖ Onverwachte fout (niet afgehandeld): ${reason instanceof Error ? reason.stack : String(reason)}`);
  });
  process.on("uncaughtException", (err) => {
    console.error(`✖ Onverwachte fout: ${err.stack ?? err.message}`);
    void shutdown("Fout", 1);
  });
}

main().catch((err: unknown) => {
  if (err instanceof ConfigError || err instanceof StartupError) {
    console.error(`\n✖ ${err.message}\n`);
  } else {
    console.error(`\n✖ De bot kon niet starten: ${err instanceof Error ? (err.stack ?? err.message) : String(err)}\n`);
  }
  process.exit(1);
});
