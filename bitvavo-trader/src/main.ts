/**
 * Startpunt: `npm start`. Leest de configuratie, kiest de databron, bouwt de bots
 * (standaard vier, elk met een eigen budget, broker, engine en instellingen; zie
 * `BOTS` in .env) en start het dashboard (HTTP + SSE).
 */
import { existsSync } from "node:fs";
import { networkInterfaces } from "node:os";
import { join } from "node:path";
import {
  ConfigError,
  describeAutoUniverse,
  loadConfig,
  planBots,
  shortList,
  universeOrManual,
  type AppConfig,
} from "./config";
import { APP_VERSION } from "./core/defaults";
import type {
  BacktestResult,
  EngineConfig,
  MarketDataFeed,
  OptimizationResult,
  WalkForwardResult,
} from "./core/types";
import { BitvavoClient } from "./exchange/bitvavoClient";
import { BitvavoFeed } from "./data/bitvavoFeed";
import { SimulatedFeed } from "./data/simulatedFeed";
import { isBitvavoReachable } from "./data/reachability";
import { listStrategies } from "./strategies";
import { decisionsToMarkers, runEnsemble } from "./strategies/ensemble";
import { detectRegimes } from "./strategies/regime";
import { chartIndicators } from "./indicators";
import { validateRiskConfig } from "./risk/riskManager";
import { startHttpServer, isLoopbackHost, type RunningServer } from "./server/httpServer";
import { HeavyRunner } from "./server/heavyRunner";
import { combineEngines, createShutdown } from "./server/shutdown";
import type { Services } from "./server/routes";
import { assembleBots, assertNoOtherLiveLedgers, StartupError, type AssembledBot } from "./bots/assemble";

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

/** De "Markten:"-regel van het startscherm. */
function marketsLine(engineCfg: EngineConfig): string {
  const u = universeOrManual(engineCfg.universe);
  return u.mode === "auto" ? describeAutoUniverse(u) : shortList(engineCfg.markets);
}

const eur = (n: number) => `€${n.toLocaleString("nl-NL", { maximumFractionDigits: 2 })}`;
const pct = (n: number, d = 2) => `${n.toLocaleString("nl-NL", { maximumFractionDigits: d })}%`;

function riskLine(engineCfg: EngineConfig): string {
  const r = engineCfg.risk;
  return (
    `${pct(r.riskPerTradePct)} per trade, max ${pct(r.maxPositionPct)} per positie, ` +
    `dagverlieslimiet ${pct(r.dailyLossLimitPct)}, taker fee ${pct(r.takerFee * 100, 3)}`
  );
}

function runningText(running: boolean | "starting", many: boolean): string {
  if (running === "starting") return many ? "worden gestart (eerste koersen ophalen…)" : "wordt gestart (eerste koersen ophalen…)";
  if (running) return many ? "draaien" : "draait";
  return many ? "gestopt (start ze in het dashboard)" : "gestopt (start hem in het dashboard)";
}

/** Startscherm met één bot: zoals vóór de wedstrijd (plus de naam van het profiel). */
function printSingleBanner(config: AppConfig, feed: MarketDataFeed, bot: AssembledBot, url: string, running: boolean | "starting") {
  const engineCfg = bot.engine.snapshot().config;
  const out: string[] = [];
  out.push("", LINE, `  Bitvavo Trader v${APP_VERSION}`, LINE);
  if (bot.setup.mode === "paper") {
    out.push(`  Modus:      OEFENMODUS (paper) — Oefenmodus met nep-geld (${eur(bot.setup.startingCapital)})`);
  } else {
    out.push(`  Modus:      LIVE — ECHT GELD (de bot gebruikt maximaal ${eur(bot.setup.startingCapital)})`);
    out.push("              Er worden pas echte orders geplaatst als je de bot in het dashboard 'armt'.");
    out.push(`  Risico:     ${riskLine(engineCfg)}`);
  }
  out.push(
    `  Marktdata:  ${feed.source === "bitvavo" ? "Bitvavo (echte koersen)" : "SIMULATIE (nep-koersen, geen echte markt)"}`,
  );
  out.push(`  Stijl:      ${bot.setup.profile.name}`);
  out.push(`  Markten:    ${marketsLine(engineCfg)}`);
  out.push(`  Interval:   ${engineCfg.interval}`);
  out.push(`  Bot:        ${runningText(running, false)}`);
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

/** Tekst op vaste breedte (voor de kolommen van de botlijst). */
function pad(s: string, n: number): string {
  return s.length >= n ? s : s + " ".repeat(n - s.length);
}

/** Startscherm met meer bots: één regel per bot en de adressen (overzicht + per bot). */
function printMultiBanner(
  config: AppConfig,
  feed: MarketDataFeed,
  bots: readonly AssembledBot[],
  url: string,
  running: boolean | "starting",
) {
  const out: string[] = [];
  const live = bots.find((b) => b.setup.mode === "live");
  const paper = bots.filter((b) => b.setup.mode === "paper");
  out.push("", LINE, `  Bitvavo Trader v${APP_VERSION} — Bot-wedstrijd: ${bots.length} bots`, LINE);
  const paperCapital = [...new Set(paper.map((b) => b.setup.startingCapital))];
  const paperText = paperCapital.length === 1 ? `${eur(paperCapital[0])} per bot` : "eigen bedrag per bot";
  if (!live) {
    out.push(`  Modus:      OEFENMODUS (paper) — elke bot oefent met eigen nep-geld (${paperText})`);
  } else {
    out.push(`  Modus:      LIVE — ECHT GELD voor ${live.setup.profile.name} (maximaal ${eur(live.setup.startingCapital)})`);
    out.push(`              De andere bots oefenen met nep-geld (${paperText}) op echte koersen.`);
    out.push("              Er worden pas echte orders geplaatst als je de live-bot in zijn dashboard 'armt'.");
    out.push(`  Risico:     ${riskLine(live.engine.snapshot().config)} (live-bot)`);
  }
  out.push(
    `  Marktdata:  ${feed.source === "bitvavo" ? "Bitvavo (echte koersen, gedeeld door alle bots)" : "SIMULATIE (nep-koersen, geen echte markt)"}`,
  );
  out.push("  Bots:");
  const nameWidth = Math.max(...bots.map((b) => b.setup.profile.name.length));
  for (const b of bots) {
    const cfg = b.engine.snapshot().config;
    const money = b.setup.mode === "live" ? `${eur(b.setup.startingCapital)} ECHT GELD` : `${eur(b.setup.startingCapital)} nep-geld`;
    out.push(`    • ${pad(b.setup.profile.name, nameWidth)}  ${pad(cfg.interval, 3)}  ${pad(money, 15)}  ${marketsLine(cfg)}`);
  }
  if (config.marketsEnv || config.intervalEnv) {
    out.push(
      "  ℹ MARKETS/INTERVAL uit .env gelden niet bij meerdere bots: elke bot volgt zijn eigen stijl",
      "    (aan te passen per bot, in zijn dashboard → Instellingen).",
    );
  }
  if (existsSync(join(config.dataDir, "state-paper.json")) && !live) {
    out.push(
      `  ℹ Je oude oefenadministratie (${join(config.dataDir, "state-paper.json")}) doet niet mee in de wedstrijd;`,
      "    met BOTS=allround (één bot) gebruik je hem weer.",
    );
  }
  out.push(
    `  Status:     ${runningText(running, true)}${live && running === "starting" ? " — de live-bot start je zelf in zijn dashboard" : ""}`,
  );
  if (config.dashboardToken) out.push("  Token:      dashboard vraagt om DASHBOARD_TOKEN uit .env");
  const phoneUrls = lanUrls(config);
  const local = phoneUrls.length > 0 ? `http://127.0.0.1:${config.port}` : url;
  const here = phoneUrls.length > 0 ? " op deze computer" : "";
  out.push("", `  ➜ Wedstrijd (alle bots)${here}: ${local}/  (tabblad "Wedstrijd")`);
  const urlWidth = nameWidth + 1;
  for (const b of bots) out.push(`  ➜ ${pad(`${b.setup.profile.name}:`, urlWidth)}  ${local}${b.setup.path}`);
  if (phoneUrls.length > 0) {
    for (const u of phoneUrls) out.push(`  ➜ Op je telefoon (zelfde wifi): ${u}/  (één bot, bijv.: ${u}${bots[0].setup.path})`);
    if (!config.dashboardToken) out.push("  ⚠ Zet een DASHBOARD_TOKEN in .env: nu kan iedereen op je wifi de bots bedienen.");
  }
  out.push("", "  Stoppen: druk op Ctrl+C", LINE, "");
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
  // Meldingen over de oude instellingen van één bot alleen als er ook één bot draait.
  const config = loadConfig(process.env, { onlySingleBotWarnings: true });
  // Eén BotSetup per bot (profiel, modus, map, kapitaal, instellingen). Live met meer
  // bots zonder geldige LIVE_BOT stopt hier met een Nederlandse uitleg.
  let setups;
  try {
    setups = planBots(config);
  } catch (err) {
    if (err instanceof ConfigError) throw new StartupError(err.message);
    throw err;
  }
  const multi = setups.length > 1;
  // Live: geen onbewaakte live-posities van een andere bot achterlaten (vóór enig netwerkverkeer).
  assertNoOtherLiveLedgers(config, setups);

  const client = new BitvavoClient({
    apiKey: config.apiKey,
    apiSecret: config.apiSecret,
    operatorId: config.operatorId,
  });

  // Eén feed voor alle bots (Bitvavo deelt gelijke verzoeken en cachet ze kort).
  const feed = await createFeed(config, client);
  if (config.mode === "live" && feed.source !== "bitvavo") {
    throw new StartupError(
      "Live trading met gesimuleerde koersen is niet toegestaan. Zorg dat Bitvavo bereikbaar is " +
        "(DATA_SOURCE=bitvavo) of zet TRADING_MODE=paper.",
    );
  }

  // Backtests/optimalisaties in één gedeelde worker-thread: de engines en de noodstop blijven reageren.
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

  // Per bot: broker (paper met eigen kapitaal, of de ene live-bot met LiveBroker + echte fees),
  // StateStore, TradingEngine (+ terminal-log met de naam ervoor), koersbewaking en app.
  const { bots, app } = await assembleBots({ config, setups, feed, services, client });
  const engines = combineEngines(
    bots.map((b) => b.engine),
    { names: bots.map((b) => b.setup.profile.name) },
  );

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
  const toStart = bots.filter((b) => b.setup.autostart);
  const running = toStart.length > 0 ? "starting" : false;
  if (multi) printMultiBanner(config, feed, bots, server.url, running);
  else printSingleBanner(config, feed, bots[0], server.url, running);
  if (toStart.length > 0) {
    const localUrl = lanUrls(config).length > 0 ? `http://127.0.0.1:${config.port}` : server.url;
    let pending = toStart.length;
    const slow = setTimeout(() => {
      console.log(
        `⏳ Nog bezig met de eerste koersen ophalen${feed.source === "bitvavo" ? " bij Bitvavo" : ""}… ` +
          `Het dashboard werkt al: ${localUrl}`,
      );
    }, 15_000);
    slow.unref();
    for (const b of toStart) {
      const who = multi ? `[${b.setup.profile.short}] ` : "";
      const dashboard = multi ? `${localUrl}${b.setup.path}` : localUrl;
      b.engine
        .start()
        .then(
          () => console.log(`${who}✔ De bot draait. Open het dashboard: ${dashboard}`),
          (err: unknown) =>
            console.error(
              `${who}✖ Kon de bot niet automatisch starten: ${(err as Error).message}. Start hem in het dashboard.`,
            ),
        )
        .finally(() => {
          if (--pending === 0) clearTimeout(slow);
        });
    }
  }
  const liveBot = bots.find((b) => b.setup.mode === "live");
  if (liveBot) {
    loud([
      multi
        ? `⚠  LIVE MODE: ${liveBot.setup.profile.name} handelt met ECHT geld. Verlies is mogelijk.`
        : "⚠  LIVE MODE: je handelt met ECHT geld. Verlies is mogelijk.",
      multi
        ? `⚠  Start en arm hem pas in zijn dashboard als je het zeker weet: ${liveBot.setup.path}`
        : "⚠  Start de bot in het dashboard en arm hem pas als je het zeker weet.",
    ]);
  }

  // ── Netjes afsluiten ──
  // Alle engines stoppen (tegelijk). In live mode wacht de noodrem langer zolang er
  // (mogelijk) een order bij Bitvavo loopt; zie src/server/shutdown.ts.
  const { shutdown } = createShutdown({
    mode: config.mode,
    stopEngine: async () => {
      for (const b of bots) b.engine.stopPriceMonitor();
      await heavyRunner.close().catch(() => undefined);
      await engines.stopAll();
    },
    cleanup: async () => {
      for (const b of bots) {
        try {
          b.store.flush();
        } catch (err) {
          const who = multi ? ` van ${b.setup.profile.name}` : "";
          console.error(`Fout bij opslaan van de toestand${who}: ${(err as Error).message}`);
        }
      }
      await server.close().catch(() => undefined);
    },
    orderInFlight: engines.orderInFlight,
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
