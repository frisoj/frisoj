import type { EngineConfig, EnsembleConfig, RiskConfig } from "./types";

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
};

export const DEFAULT_ENGINE_CONFIG: EngineConfig = {
  markets: ["BTC-EUR", "ETH-EUR", "SOL-EUR"],
  interval: "15m",
  pollMs: 15_000,
  historyCandles: 300,
  ensemble: DEFAULT_ENSEMBLE_CONFIG,
  risk: DEFAULT_RISK_CONFIG,
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
