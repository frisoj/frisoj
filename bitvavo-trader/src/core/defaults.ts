import type { EngineConfig, EnsembleConfig, RiskConfig, TrendFilterConfig, UniverseConfig } from "./types";

/**
 * Standaard risico-instellingen, afgestemd op een klein account (~€50) bij
 * Bitvavo (taker 0,25%, maker 0,15%, minimale order €5).
 */
export const DEFAULT_RISK_CONFIG: RiskConfig = {
  riskPerTradePct: 1.5,
  maxPositionPct: 45,
  maxOpenPositions: 2,
  maxTotalExposurePct: 90,
  stopAtrMult: 2,
  takeProfitR: 2,
  trailingAtrMult: 2.5,
  breakEvenAtR: 1,
  dailyLossLimitPct: 5,
  maxTradesPerDay: 6,
  cooldownCandlesAfterLoss: 4,
  minEdgeFeeMultiple: 3,
  takerFee: 0.0025,
  makerFee: 0.0015,
  slippagePct: 0.0005,
  minOrderQuote: 5,
  timeStopCandles: 48,
  maxSpreadPct: 0.3,
};

/**
 * Trendfilter: alleen kopen als Bitcoin boven zijn gemiddelde van 50 dagen staat.
 * In ons onderzoek op echte dagkoersen (2016–2026) was dit het enige idee dat
 * ook buiten de testperiode standhield, vooral doordat het grote dalingen ontweek.
 */
export const DEFAULT_TREND_FILTER: TrendFilterConfig = {
  market: true,
  coin: false,
  interval: "1d",
  period: 50,
};

export const DEFAULT_ENSEMBLE_CONFIG: EnsembleConfig = {
  enabled: ["ema-trend", "rsi-reversion", "breakout", "macd-momentum", "vwap-reversion"],
  weights: {
    "ema-trend": 1.2,
    "rsi-reversion": 1,
    breakout: 1,
    "macd-momentum": 1,
    "vwap-reversion": 0.8,
  },
  params: {},
  buyThreshold: 0.35,
  sellThreshold: -0.3,
  regimeFilter: true,
  trendFilter: DEFAULT_TREND_FILTER,
};

/** Maximum aantal markten dat de bot tegelijk kan volgen */
export const MAX_MARKETS = 400;
/** De markt waarop het marktfilter kijkt */
export const MARKET_FILTER_MARKET = "BTC-EUR";

export const DEFAULT_UNIVERSE_CONFIG: UniverseConfig = {
  mode: "auto",
  count: 30,
  minVolumeEur: 250_000,
};

export const DEFAULT_ENGINE_CONFIG: EngineConfig = {
  markets: ["BTC-EUR", "ETH-EUR", "SOL-EUR"],
  interval: "15m",
  pollMs: 15_000,
  historyCandles: 300,
  ensemble: DEFAULT_ENSEMBLE_CONFIG,
  risk: DEFAULT_RISK_CONFIG,
  universe: DEFAULT_UNIVERSE_CONFIG,
};

export const DEFAULT_PAPER_CAPITAL = 50;
/**
 * Minimale orderwaarde (EUR) op Bitvavo, voor kopen EN verkopen. Gebruikt als
 * MarketInfo geen (geldige, > 0) minOrderQuote heeft. Nooit vervangen door de
 * instelling risk.minOrderQuote: die is alleen een extra ondergrens voor instappen.
 */
export const EXCHANGE_MIN_ORDER_QUOTE = 5;
export const APP_VERSION = "0.1.0";
export const QUOTE_CURRENCY = "EUR";
