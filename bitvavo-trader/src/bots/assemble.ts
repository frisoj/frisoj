/**
 * Bouwt de bots van één proces (v3, bot-wedstrijd): per bot een eigen broker,
 * StateStore, TradingEngine en app, samen achter één multi-bot-server. Eén gedeelde
 * feed (marktdata), één BitvavoClient en één rekenwerker (services) — die komen van
 * main.ts. Staat los van main.ts zodat de integratietest precies dezelfde opbouw
 * gebruikt.
 */
import { repairRiskConfig, shortList, universeOrManual, type AppConfig, type BotSetup } from "../config";
import { DEFAULT_ENGINE_CONFIG } from "../core/defaults";
import type { Broker, EngineConfig, MarketDataFeed } from "../core/types";
import { LiveBroker } from "../broker/liveBroker";
import { PaperBroker } from "../broker/paperBroker";
import type { BitvavoClient } from "../exchange/bitvavoClient";
import { StateStore } from "../engine/stateStore";
import { TradingEngine } from "../engine/tradingEngine";
import { validateRiskConfig } from "../risk/riskManager";
import { syncAccountFees } from "../server/accountFees";
import { createApp, type App } from "../server/httpServer";
import { botEntries, botInfo, createMultiApp, type MultiAppBot } from "../server/multiApp";
import type { BotEntry, HeavyGate, Services } from "../server/routes";
import { attachTerminalLog } from "../server/terminalLog";
import { liveLedgerMessage, otherOpenLiveLedgers } from "./liveGuard";

/** Fout bij het starten met een Nederlandse uitleg (main.ts toont alleen de melding). */
export class StartupError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "StartupError";
  }
}

/**
 * Houdt in de eigen marktlijst (`config.markets`, 1..400) alleen markten over
 * die bestaan en verhandelbaar zijn in EUR. Bij de automatische muntkeuze is
 * dat de reservelijst (tot de eerste automatische keuze); die keuze zelf
 * gebruikt altijd de actuele marktlijst van Bitvavo.
 */
export async function sanitizeMarkets(
  feed: MarketDataFeed,
  engine: EngineConfig,
  warn: (msg: string) => void = (m) => console.warn(m),
): Promise<void> {
  let known: Set<string>;
  try {
    const markets = await feed.getMarkets();
    known = new Set(markets.filter((m) => m.quote === "EUR" && m.status === "trading").map((m) => m.market));
  } catch (err) {
    warn(`⚠ Kon de marktlijst niet ophalen (${(err as Error).message}); markten niet gecontroleerd.`);
    return;
  }
  const auto = universeOrManual(engine.universe).mode === "auto";
  const which = auto ? "je eigen marktlijst (reserve voor de automatische keuze)" : "je marktlijst";
  const ok = engine.markets.filter((m) => known.has(m));
  const dropped = engine.markets.filter((m) => !known.has(m));
  if (dropped.length > 0) {
    warn(`⚠ Onbekende of niet-verhandelbare markten overgeslagen in ${which}: ${shortList(dropped)}`);
  }
  if (ok.length === 0) {
    const fallback = DEFAULT_ENGINE_CONFIG.markets.filter((m) => known.has(m));
    const list = fallback.length > 0 ? fallback : [...known].sort().slice(0, 3);
    if (list.length === 0) throw new StartupError("Er zijn geen verhandelbare EUR-markten gevonden.");
    warn(`⚠ Geen geldige markten in ${which}; de bot gebruikt ${list.join(", ")}.`);
    engine.markets = list;
  } else {
    engine.markets = ok;
  }
}

/**
 * Weigert een live-bot als een ANDERE bot (of de enkele bot van vóór de wedstrijd) nog
 * live-posities of orders met onbekende uitkomst heeft: die zouden dan onbewaakt op
 * het ene Bitvavo-account blijven staan (zie liveGuard.ts).
 */
export function assertNoOtherLiveLedgers(config: Pick<AppConfig, "dataDir">, setups: readonly BotSetup[]): void {
  for (const s of setups) {
    if (s.mode !== "live") continue;
    const others = otherOpenLiveLedgers(config.dataDir, s.stateFile);
    if (others.length > 0) throw new StartupError(liveLedgerMessage(others, s.profile.name));
  }
}

export interface AssembleDeps {
  /** De geladen configuratie (host, token, sleutels, dataDir) */
  config: AppConfig;
  /** Eén per bot, uit planBots(config) */
  setups: readonly BotSetup[];
  /** Gedeelde marktdata */
  feed: MarketDataFeed;
  /** Gedeelde services (main.ts: backtests in één rekenwerker) */
  services: Services;
  /** Alleen nodig als een bot live handelt (LiveBroker + echte fees) */
  client?: BitvavoClient;
  /** Engine-logregels in de terminal (standaard ja; bij meer bots met de korte naam ervoor) */
  terminalLog?: boolean;
  /** Koersbewaking meteen starten (standaard ja, zoals main.ts) */
  startPriceMonitor?: boolean;
  warn?: (msg: string) => void;
  /** Voor tests */
  publicDir?: string;
  vendorFile?: string | null;
  now?: () => number;
}

export interface AssembledBot {
  setup: BotSetup;
  engine: TradingEngine;
  broker: Broker;
  store: StateStore;
  app: App;
}

export interface Assembled {
  bots: AssembledBot[];
  /** De server-app voor alle bots samen (`/api/…`, `/bot/<id>/…`) */
  app: App;
  /** Wat `/api/bots` gebruikt */
  entries: BotEntry[];
}

export async function assembleBots(deps: AssembleDeps): Promise<Assembled> {
  const warn = deps.warn ?? ((m: string) => console.warn(m));
  if (deps.setups.length === 0) throw new StartupError("Geen bots om te starten (BOTS is leeg).");
  if (deps.setups.filter((s) => s.mode === "live").length > 1) {
    // planBots laat dit nooit gebeuren; dubbel gecontroleerd omdat het om echt geld gaat.
    throw new StartupError("Er mag maar één bot live handelen (één Bitvavo-account).");
  }
  assertNoOtherLiveLedgers(deps.config, deps.setups);

  const entries: BotEntry[] = [];
  // Eén rekenwerker voor alle bots → ook één "berekening tegelijk"-vergrendeling.
  const heavyGate: HeavyGate = { busy: null };
  const bots: AssembledBot[] = [];
  const multiBots: MultiAppBot[] = [];
  for (const setup of deps.setups) {
    const who = setup.multi ? `[${setup.profile.short}] ` : "";
    const botWarn = (m: string) => warn(`${who}${m}`);
    const engineConfig = structuredClone(setup.engine);
    // Vóór het bouwen van een broker: de PaperBroker neemt fee/slippage over.
    const fixedRisk = repairRiskConfig(engineConfig.risk);
    if (fixedRisk.length > 0) {
      botWarn(`⚠ Ongeldige risico-instellingen vervangen door standaardwaarden: ${fixedRisk.join(", ")}.`);
    }
    await sanitizeMarkets(deps.feed, engineConfig, botWarn);

    let broker: Broker;
    if (setup.mode === "paper") {
      broker = new PaperBroker({
        startingQuote: setup.startingCapital,
        takerFee: engineConfig.risk.takerFee,
        slippagePct: engineConfig.risk.slippagePct,
      });
    } else {
      const client = deps.client;
      if (!client) throw new StartupError("Live handelen vereist een verbinding met Bitvavo (geen client).");
      if (deps.feed.source !== "bitvavo") {
        throw new StartupError(
          "Live trading met gesimuleerde koersen is niet toegestaan. Zorg dat Bitvavo bereikbaar is " +
            "(DATA_SOURCE=bitvavo) of zet TRADING_MODE=paper.",
        );
      }
      const feed = deps.feed;
      broker = new LiveBroker(client, {
        getMarketInfo: async (market: string) => (await feed.getMarkets()).find((m) => m.market === market),
      });
      // Echte fees ophalen en daarna ook aan de (al gebouwde) LiveBroker doorgeven.
      await syncAccountFees({
        account: () => client.account(),
        broker,
        risk: engineConfig.risk,
        validateRisk: validateRiskConfig,
        ...(setup.multi ? { log: { info: (m: string) => console.log(`${who}${m}`), warn: botWarn } } : {}),
      });
    }

    const store = new StateStore(setup.stateFile);
    const engine = new TradingEngine({
      feed: deps.feed,
      broker,
      config: engineConfig,
      mode: setup.mode,
      store,
      startingCapital: setup.startingCapital,
      ...(deps.now ? { now: deps.now } : {}),
    });
    // Ook wat de engine al tijdens het bouwen logde (bijv. "Opgeslagen staat onbruikbaar …"),
    // daarna elke nieuwe regel; bij meer bots met de korte naam ervoor.
    if (deps.terminalLog !== false) attachTerminalLog(engine, setup.multi ? setup.profile.short : undefined);
    // Zolang de bot niet draait (vóór Start, na Stop/noodstop): alleen koersen verversen,
    // meteen één keer, zodat herstelde posities niet tegen de instapkoers getoond worden.
    if (deps.startPriceMonitor !== false) void engine.startPriceMonitor();

    const info = botInfo(setup.profile);
    const app = createApp({
      config: setup.appConfig,
      engine,
      feed: deps.feed,
      services: deps.services,
      // Modus en kapitaal van deze bot staan al in zijn eigen config; hier alleen wie hij is.
      info: () => ({ bot: { ...info } }),
      bots: () => entries,
      heavyGate,
      ...(deps.publicDir !== undefined ? { publicDir: deps.publicDir } : {}),
      ...(deps.vendorFile !== undefined ? { vendorFile: deps.vendorFile } : {}),
      ...(deps.now ? { now: deps.now } : {}),
    });
    bots.push({ setup, engine, broker, store, app });
    multiBots.push({ id: setup.id, app, engine, profile: setup.profile, config: setup.appConfig });
  }
  entries.push(...botEntries(multiBots));
  const app = createMultiApp({ bots: multiBots, defaultId: deps.setups[0].id });
  return { bots, app, entries };
}
