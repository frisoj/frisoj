/**
 * Automatische muntkeuze ("universe"): de meest verhandelde EUR-markten,
 * zonder stablecoins en verpakte munten, met genoeg volume en een kleine spread.
 * Puur (geen I/O): de engine haalt markten en 24h-tickers op en roept dit aan.
 */
import type { MarketInfo, Ticker24h, UniverseConfig } from "../core/types";
import { MAX_MARKETS } from "../core/defaults";

/**
 * Munten die (vrijwel) vast aan een munteenheid of goud hangen, of een verpakte
 * versie van een andere munt zijn: daar valt met een trend-/momentumbot niets
 * aan te verdienen, en ze nemen een plek in.
 */
export const EXCLUDED_BASES: ReadonlySet<string> = new Set([
  // stablecoins (dollar / euro)
  "USDT", "USDC", "DAI", "TUSD", "BUSD", "USDP", "PYUSD", "FDUSD", "USDE", "USDS", "GUSD", "FRAX",
  "LUSD", "USDD", "RLUSD", "USD1", "USDG", "EURC", "EURS", "EURT", "EUROC", "EURI", "EURR", "EUROP", "EURCV",
  // goud-tokens
  "PAXG", "XAUT",
  // verpakte / liquid-staking varianten van BTC en ETH
  "WBTC", "CBBTC", "WETH", "STETH", "WSTETH", "CBETH", "RETH", "WEETH",
]);

export interface UniverseSelection {
  /** Gekozen markten, hoogste 24h-volume eerst (max. `count`) */
  markets: string[];
  /** Markten die door de filters kwamen (vóór het afkappen op `count`) */
  eligible: number;
  /** Markten die door een filter vielen, met Nederlandse reden */
  excluded: { market: string; reason: string }[];
}

function baseOf(market: string, info?: MarketInfo): string {
  if (info?.base) return info.base.toUpperCase();
  const i = market.indexOf("-");
  return (i > 0 ? market.slice(0, i) : market).toUpperCase();
}

/** Marge (procentpunten) bij de spreadlimiet: afrondingsruis telt niet als "erboven" (zelfde als de backtest). */
export const SPREAD_EPS_PCT = 1e-9;

/**
 * Ligt de spread (in %) boven de limiet (in %; 0 of minder = geen limiet)? Precies op de
 * limiet (ook met afrondingsruis, bijv. 0,30000000000001 bij 0,3) is niet erboven.
 */
export function spreadAboveLimit(spreadPct: number, maxSpreadPct: number): boolean {
  return (
    Number.isFinite(maxSpreadPct) && maxSpreadPct > 0 && Number.isFinite(spreadPct) && spreadPct - maxSpreadPct > SPREAD_EPS_PCT
  );
}

/** Spread in % uit bid/ask, of null als onbekend. */
export function tickerSpreadPct(t: Pick<Ticker24h, "bid" | "ask">): number | null {
  const { bid, ask } = t;
  if (bid === null || ask === null || !Number.isFinite(bid) || !Number.isFinite(ask) || bid <= 0 || ask <= 0 || ask < bid) {
    return null;
  }
  const mid = (bid + ask) / 2;
  return ((ask - bid) / mid) * 100;
}

function clampCount(count: number): number {
  if (!Number.isFinite(count)) return 1;
  return Math.max(1, Math.min(MAX_MARKETS, Math.floor(count)));
}

/**
 * Kies de markten voor de "auto"-modus.
 * - Alleen EUR-markten met status "trading".
 * - Weg: `EXCLUDED_BASES`, geen (eindig) 24h-volume, volume < `minVolumeEur`,
 *   spread > `maxSpreadPct` (alleen als die > 0 is en de spread bekend is;
 *   een onbekende spread wordt bij het kopen alsnog gecontroleerd).
 * - Sortering: 24h-volume in EUR aflopend, bij gelijk volume op naam.
 */
export function selectUniverse(
  markets: readonly MarketInfo[],
  tickers: readonly Ticker24h[],
  cfg: UniverseConfig,
  maxSpreadPct?: number,
): UniverseSelection {
  const byMarket = new Map<string, Ticker24h>();
  for (const t of tickers) if (t && typeof t.market === "string") byMarket.set(t.market, t);
  const minVol = Number.isFinite(cfg.minVolumeEur) && cfg.minVolumeEur > 0 ? cfg.minVolumeEur : 0;
  const spreadCap = typeof maxSpreadPct === "number" && Number.isFinite(maxSpreadPct) && maxSpreadPct > 0 ? maxSpreadPct : 0;

  const excluded: { market: string; reason: string }[] = [];
  const ok: { market: string; volume: number }[] = [];
  const seen = new Set<string>();
  for (const info of markets) {
    if (!info || info.quote !== "EUR" || info.status !== "trading" || seen.has(info.market)) continue;
    seen.add(info.market);
    const market = info.market;
    if (EXCLUDED_BASES.has(baseOf(market, info))) {
      excluded.push({ market, reason: "stablecoin of verpakte munt" });
      continue;
    }
    const t = byMarket.get(market);
    if (!t || !Number.isFinite(t.volumeQuote)) {
      excluded.push({ market, reason: "geen 24-uursvolume bekend" });
      continue;
    }
    if (t.volumeQuote < minVol) {
      excluded.push({ market, reason: "te weinig handel (24-uursvolume)" });
      continue;
    }
    const spread = tickerSpreadPct(t);
    if (spread !== null && spreadAboveLimit(spread, spreadCap)) {
      excluded.push({ market, reason: `spread te groot (${spread.toFixed(2)}%)` });
      continue;
    }
    ok.push({ market, volume: t.volumeQuote });
  }
  ok.sort((a, b) => b.volume - a.volume || (a.market < b.market ? -1 : a.market > b.market ? 1 : 0));
  return {
    markets: ok.slice(0, clampCount(cfg.count)).map((o) => o.market),
    eligible: ok.length,
    excluded,
  };
}
