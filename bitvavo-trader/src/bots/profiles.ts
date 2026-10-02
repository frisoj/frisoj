/**
 * De handelsstijlen voor de bot-wedstrijd: vier bots met elk een eigen budget,
 * die op een andere manier handelen. Zo laten echte resultaten zien wat werkt.
 *
 * Een profiel is een aanpassing op DEFAULT_ENGINE_CONFIG (interval, strategieën,
 * risico, muntkeuze). Instellingen die de gebruiker per bot in het dashboard
 * opslaat, gaan daar weer overheen (data/bots/<id>/config.json).
 */
import type { EngineConfig, EnsembleConfig, RiskConfig, UniverseConfig } from "../core/types";
import { DEFAULT_ENGINE_CONFIG } from "../core/defaults";
import { mergeEngineConfig } from "../config";

export interface BotProfile {
  id: string;
  name: string;
  short: string;
  description: string;
  color: string;
  engine: {
    interval?: EngineConfig["interval"];
    pollMs?: number;
    ensemble?: Partial<EnsembleConfig>;
    risk?: Partial<RiskConfig>;
    universe?: UniverseConfig;
  };
}

export const BOT_PROFILES: readonly BotProfile[] = [
  {
    id: "scalper",
    name: "Snelle scalper",
    short: "Scalper",
    description:
      "Handelt op 5-minutencandles in de 60 meest verhandelde munten (kleinste spreads). Koopt bij korte uitbraken en " +
      "momentum, pakt kleine winsten snel (koersdoel 1,5× het risico) met een krappe stop, en handelt ook als de markt " +
      "daalt (geen trendfilter). Hij kijkt het vaakst van alle bots, maar koopt alleen als de verwachte winst minstens 3× " +
      "de kosten is. Dat lukt alleen bij grote uitschieters, dus vaak doet hij uren of dagen niets: zonder die regel " +
      "verloor hij in de test 40% in drie maanden.",
    color: "#e0a23a",
    engine: {
      interval: "5m",
      ensemble: {
        enabled: ["breakout", "macd-momentum", "ema-trend", "vwap-reversion"],
        weights: { breakout: 1.3, "macd-momentum": 1.2, "ema-trend": 1, "vwap-reversion": 0.6 },
        buyThreshold: 0.3,
        sellThreshold: -0.25,
        regimeFilter: true,
        trendFilter: { market: false, coin: false, interval: "1d", period: 50 },
      },
      risk: {
        stopAtrMult: 1.2,
        takeProfitR: 1.5,
        trailingAtrMult: 1.5,
        breakEvenAtR: 0.8,
        maxTradesPerDay: 30,
        cooldownCandlesAfterLoss: 6,
        timeStopCandles: 36,
        maxSpreadPct: 0.15,
      },
      universe: { mode: "auto", count: 60, minVolumeEur: 1_000_000 },
    },
  },
  {
    id: "trend",
    name: "Trendvolger",
    short: "Trend",
    description:
      "Handelt op 1-uurscandles. Koopt alleen als Bitcoin én de munt zelf in een stijgende trend zitten (boven hun " +
      "gemiddelde van 50 dagen), en laat winnaars lang lopen met een meeschuivende stop (koersdoel 3× het risico). " +
      "Weinig, maar grotere trades. In ons onderzoek op echte dagkoersen hield dit idee het beste stand.",
    color: "#3987e5",
    engine: {
      interval: "1h",
      ensemble: {
        enabled: ["ema-trend", "breakout", "macd-momentum"],
        weights: { "ema-trend": 1.5, breakout: 1.2, "macd-momentum": 1 },
        buyThreshold: 0.35,
        regimeFilter: true,
        trendFilter: { market: true, coin: true, interval: "1d", period: 50 },
      },
      risk: {
        // 2% risico per trade: met €25 en een ruime stop past anders ~1 op de 9 signalen niet boven het €5-minimum
        riskPerTradePct: 2,
        stopAtrMult: 2.5,
        takeProfitR: 3,
        trailingAtrMult: 3,
        breakEvenAtR: 1.5,
        maxTradesPerDay: 6,
        timeStopCandles: 72,
      },
      universe: { mode: "auto", count: 100, minVolumeEur: 250_000 },
    },
  },
  {
    id: "dip",
    name: "Dip-koper",
    short: "Dip",
    description:
      "Handelt op 15-minutencandles. Koopt munten die kort hard gezakt en oververkocht zijn (RSI laag, onder de " +
      "Bollinger-band of ver onder de VWAP) en verkoopt bij het herstel (koersdoel 1,5× het risico). Werkt vooral in een " +
      "zijwaartse markt; koopt niet als Bitcoin in een dalende trend zit.",
    color: "#9b6ddf",
    engine: {
      interval: "15m",
      ensemble: {
        enabled: ["rsi-reversion", "vwap-reversion"],
        weights: { "rsi-reversion": 1.4, "vwap-reversion": 1.2 },
        buyThreshold: 0.3,
        sellThreshold: -0.25,
        regimeFilter: true,
        trendFilter: { market: true, coin: false, interval: "1d", period: 50 },
      },
      risk: {
        stopAtrMult: 1.5,
        takeProfitR: 1.5,
        trailingAtrMult: 0,
        breakEvenAtR: 1,
        maxTradesPerDay: 12,
        timeStopCandles: 32,
        maxSpreadPct: 0.25,
      },
      universe: { mode: "auto", count: 100, minVolumeEur: 250_000 },
    },
  },
  {
    id: "allround",
    name: "Allrounder",
    short: "Allround",
    description:
      "De bot zoals je hem kent: alle vijf strategieën stemmen samen, op 15-minutencandles, met het trendfilter op " +
      "Bitcoin. Met een krappere stop-loss dan eerst (1,5× in plaats van 2× de ATR, dus kleinere verliezen per trade, " +
      "maar vaker uitgestopt) en maximaal 20 trades per dag.",
    color: "#2fb67c",
    engine: {
      interval: "15m",
      risk: { stopAtrMult: 1.5, maxTradesPerDay: 20 },
      universe: { mode: "auto", count: 150, minVolumeEur: 250_000 },
    },
  },
];

export const DEFAULT_BOT_IDS: readonly string[] = BOT_PROFILES.map((p) => p.id);

export function getProfile(id: string): BotProfile | undefined {
  return BOT_PROFILES.find((p) => p.id === id);
}

/** De engine-instellingen van een profiel: DEFAULT_ENGINE_CONFIG (of `base`) met het profiel eroverheen. */
export function profileEngineConfig(profile: BotProfile, base: EngineConfig = DEFAULT_ENGINE_CONFIG): EngineConfig {
  const e = profile.engine;
  const merged = mergeEngineConfig(base, {
    ...(e.interval ? { interval: e.interval } : {}),
    ...(e.pollMs !== undefined ? { pollMs: e.pollMs } : {}),
    ...(e.risk ? { risk: e.risk as RiskConfig } : {}),
    ...(e.universe ? { universe: { ...e.universe } } : {}),
  });
  if (e.ensemble) {
    const ens = e.ensemble;
    merged.ensemble = {
      ...merged.ensemble,
      ...(ens.enabled ? { enabled: [...ens.enabled] } : {}),
      // Een profiel legt ALLE gewichten vast (niet mengen met de standaardgewichten)
      ...(ens.weights ? { weights: { ...ens.weights } } : {}),
      ...(ens.buyThreshold !== undefined ? { buyThreshold: ens.buyThreshold } : {}),
      ...(ens.sellThreshold !== undefined ? { sellThreshold: ens.sellThreshold } : {}),
      ...(ens.regimeFilter !== undefined ? { regimeFilter: ens.regimeFilter } : {}),
      ...(ens.trendFilter ? { trendFilter: { ...ens.trendFilter } } : {}),
    };
  }
  return merged;
}
