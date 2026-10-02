/**
 * Applicatieconfiguratie: leest omgevingsvariabelen (optioneel uit `.env` in
 * de projectmap) en voegt de door het dashboard opgeslagen engine-instellingen
 * (`<dataDir>/config.json`) samen met de standaardwaarden.
 */
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { isIPv6 } from "node:net";
import { dirname, isAbsolute, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parseEnv } from "node:util";
import { DEFAULT_BOT_IDS, getProfile, profileEngineConfig, type BotProfile } from "./bots/profiles";
import {
  DEFAULT_ENGINE_CONFIG,
  DEFAULT_PAPER_CAPITAL,
  DEFAULT_TREND_FILTER,
  DEFAULT_UNIVERSE_CONFIG,
  MAX_MARKETS,
} from "./core/defaults";
import { validateRiskConfig } from "./risk/riskManager";
import {
  INTERVALS,
  STRATEGY_IDS,
  TREND_FILTER_INTERVALS,
  type DataSource,
  type EngineConfig,
  type EnsembleConfig,
  type Interval,
  type RiskConfig,
  type StrategyId,
  type StrategyParams,
  type TradingMode,
  type TrendFilterConfig,
  type TrendFilterInterval,
  type UniverseConfig,
} from "./core/types";

/** Map van het project (bitvavo-trader/), onafhankelijk van de huidige werkmap. */
export const PROJECT_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");

export interface AppConfig {
  mode: TradingMode;
  dataSource: "auto" | DataSource;
  host: string;
  port: number;
  apiKey?: string;
  apiSecret?: string;
  operatorId: number;
  paperStartingCapital: number;
  capitalLimitQuote: number;
  dashboardToken?: string;
  dataDir: string;
  engine: EngineConfig;
  /** Start de bot automatisch (paper: standaard ja; live: ALTIJD nee) */
  autostart: boolean;
  // ── v3: meerdere bots (optioneel, zodat oudere configs in tests blijven werken) ──
  /** Profiel-id's uit `BOTS`, in die volgorde en zonder dubbele (standaard alle vier). */
  bots?: string[];
  /** Startkapitaal (paper) van elke bot als er meer dan één bot is (`PAPER_CAPITAL_PER_BOT`, standaard 25). */
  paperCapitalPerBot?: number;
  /** `LIVE_BOT`: de ene bot die in live mode met echt geld handelt (zie {@link resolveLiveBot}). */
  liveBot?: string;
  /** `AUTOSTART` voor bots in oefenmodus, ook als een andere bot live handelt (live start nooit vanzelf). */
  paperAutostart?: boolean;
  /** `MARKETS` zoals in .env (alleen gebruikt bij één bot; meerdere bots volgen hun profiel). */
  marketsEnv?: MarketsEnv;
  /** `INTERVAL` zoals in .env (idem). */
  intervalEnv?: Interval;
}

export interface LoadConfigOptions {
  /**
   * Pad naar een .env-bestand. Standaard `<project>/.env`, maar alleen als
   * `env === process.env`. `false` = nooit een .env-bestand lezen.
   */
  envFile?: string | false;
  /** Waarschuwingen (standaard console.warn); handig om in tests op te vangen. */
  warn?: (msg: string) => void;
  /**
   * true (main.ts): meldingen over de instellingen van één bot (`<dataDir>/config.json`
   * en MARKETS/INTERVAL uit .env) alleen geven als er ook echt één bot draait. Bij
   * meerdere bots gelden die niet (elke bot heeft een profiel en een eigen map), dus
   * zouden ze alleen verwarren. Standaard: altijd melden.
   */
  onlySingleBotWarnings?: boolean;
}

export class ConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ConfigError";
  }
}

export const OVERRIDES_FILE = "config.json";

const OCTET = "(?:25[0-5]|2[0-4]\\d|1\\d\\d|[1-9]?\\d)";
const LOOPBACK_V4 = new RegExp(`^127\\.${OCTET}\\.${OCTET}\\.${OCTET}$`);

/** Canonieke vorm van een IPv6-adres (met of zonder [ ]), bijv. "0:0:0:0:0:0:0:1" → "[::1]"; anders null. */
function canonicalIpv6(h: string): string | null {
  const inner = h.startsWith("[") && h.endsWith("]") ? h.slice(1, -1) : h;
  if (!isIPv6(inner)) return null;
  try {
    return new URL(`http://[${inner}]/`).hostname;
  } catch {
    return null;
  }
}

/**
 * True als `host` (zonder poort) EXACT een loopback-adres is: localhost, een
 * IPv4-adres 127.x.y.z of IPv6 ::1 in elke schrijfwijze (::1, [::1],
 * 0:0:0:0:0:0:0:1, …). Namen die alleen met "127." beginnen (bijv.
 * "127.aanvaller.example" of "127.0.0.1.nip.io") zijn gewone domeinnamen en
 * tellen NIET als loopback (bescherming tegen DNS-rebinding).
 */
export function isLoopbackHost(host: string): boolean {
  const h = host.trim().toLowerCase();
  return h === "localhost" || LOOPBACK_V4.test(h) || canonicalIpv6(h) === "[::1]";
}

// ─────────────────────────────── helpers ───────────────────────────────

function str(env: NodeJS.ProcessEnv, key: string): string | undefined {
  const v = env[key];
  if (v === undefined) return undefined;
  const t = v.trim();
  return t === "" ? undefined : t;
}

function num(
  env: NodeJS.ProcessEnv,
  key: string,
  def: number,
  opts: { min?: number; max?: number; integer?: boolean } = {},
): number {
  const raw = str(env, key);
  if (raw === undefined) return def;
  const n = Number(raw.replace(",", "."));
  if (!Number.isFinite(n)) throw new ConfigError(`${key} moet een getal zijn (nu: "${raw}").`);
  if (opts.integer && !Number.isInteger(n)) {
    throw new ConfigError(`${key} moet een geheel getal zijn (nu: "${raw}").`);
  }
  if (opts.min !== undefined && n < opts.min) {
    throw new ConfigError(`${key} moet minimaal ${opts.min} zijn (nu: ${n}).`);
  }
  if (opts.max !== undefined && n > opts.max) {
    throw new ConfigError(`${key} mag maximaal ${opts.max} zijn (nu: ${n}).`);
  }
  return n;
}

function bool(env: NodeJS.ProcessEnv, key: string, def: boolean): boolean {
  const raw = str(env, key);
  if (raw === undefined) return def;
  const v = raw.toLowerCase();
  if (["1", "true", "yes", "ja", "on", "aan"].includes(v)) return true;
  if (["0", "false", "no", "nee", "off", "uit"].includes(v)) return false;
  throw new ConfigError(`${key} moet "true" of "false" zijn (nu: "${raw}").`);
}

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function isFiniteNumber(v: unknown): v is number {
  return typeof v === "number" && Number.isFinite(v);
}

const MARKET_RE = /^[A-Z0-9]{1,20}-EUR$/;

/** Grenzen voor de automatische muntkeuze en het trendfilter (zelfde als de API-validatie). */
export const UNIVERSE_MIN_VOLUME_MAX = 1e12;
export const TREND_PERIOD_MIN = 5;
export const TREND_PERIOD_MAX = 200;

/**
 * De muntkeuze van een config. Ontbreekt `universe`, dan is dat "manual"
 * (precies `markets`); de overige velden komen dan uit de standaard.
 */
export function universeOrManual(u: UniverseConfig | undefined): UniverseConfig {
  return u ? { ...u } : { ...DEFAULT_UNIVERSE_CONFIG, mode: "manual" };
}

/** Het trendfilter van een ensemble. Ontbreekt het, dan staat het uit (beide vlaggen false). */
export function trendFilterOrOff(tf: TrendFilterConfig | undefined): TrendFilterConfig {
  return tf ? { ...tf } : { ...DEFAULT_TREND_FILTER, market: false, coin: false };
}

export function isTrendFilterInterval(v: unknown): v is TrendFilterInterval {
  return typeof v === "string" && (TREND_FILTER_INTERVALS as readonly string[]).includes(v);
}

/** Kopie zonder gedeelde objecten (ook `universe` en `ensemble.trendFilter`). */
export function cloneEngineConfig(cfg: EngineConfig): EngineConfig {
  return structuredClone(cfg);
}

/** Korte weergave van een lange lijst: de eerste `max` namen plus "+N meer". */
export function shortList(items: readonly string[], max = 10): string {
  if (items.length <= max) return items.join(", ");
  return `${items.slice(0, max).join(", ")} +${items.length - max} meer`;
}

/** Nederlandse omschrijving van de automatische muntkeuze, bijv. voor het startscherm. */
export function describeAutoUniverse(u: Pick<UniverseConfig, "count" | "minVolumeEur">): string {
  const vol = Math.round(u.minVolumeEur).toLocaleString("nl-NL");
  const coins = u.count === 1 ? "de munt" : `de ${u.count} munten`;
  return `automatisch: ${coins} met de meeste handel (min. €${vol} per dag)`;
}

export type MarketsEnv = { mode: "auto"; count: number } | { mode: "manual"; markets: string[] };

/**
 * Leest `MARKETS` uit .env:
 * - `auto` → automatische muntkeuze met het standaardaantal (30);
 * - `auto:N` → automatisch, N munten (geheel getal 1..400);
 * - een komma-lijst (1..400 markten, altijd -EUR) → precies die markten ("manual").
 */
export function parseMarketsEnv(raw: string): MarketsEnv {
  const t = raw.trim();
  const auto = /^auto\s*(?::\s*(.*?)\s*)?$/i.exec(t);
  if (auto) {
    if (auto[1] === undefined) return { mode: "auto", count: DEFAULT_UNIVERSE_CONFIG.count };
    const nRaw = auto[1];
    const n = /^\d+$/.test(nRaw) ? Number(nRaw) : Number.NaN;
    if (!Number.isInteger(n) || n < 1 || n > MAX_MARKETS) {
      throw new ConfigError(
        `MARKETS=auto:N: N moet een geheel getal van 1 tot ${MAX_MARKETS} zijn (nu: "${nRaw}"). ` +
          "Bijvoorbeeld MARKETS=auto:30.",
      );
    }
    return { mode: "auto", count: n };
  }
  const markets = [
    ...new Set(
      t
        .split(",")
        .map((m) => m.trim().toUpperCase())
        .filter(Boolean),
    ),
  ];
  const bad = markets.filter((m) => !MARKET_RE.test(m));
  if (bad.length > 0) {
    throw new ConfigError(
      `MARKETS bevat ongeldige markten: ${shortList(bad)}. Gebruik bijv. "BTC-EUR,ETH-EUR", ` +
        `of "auto:30" om de bot zelf te laten kiezen.`,
    );
  }
  if (markets.length < 1 || markets.length > MAX_MARKETS) {
    throw new ConfigError(
      `MARKETS moet 1 tot ${MAX_MARKETS} markten bevatten (nu: ${markets.length}). ` +
        `Of gebruik MARKETS=auto:N om de bot zelf de N munten met de meeste handel te laten kiezen.`,
    );
  }
  return { mode: "manual", markets };
}

function loadEnvFileInto(env: NodeJS.ProcessEnv, file: string): void {
  if (!existsSync(file)) return;
  if (env === process.env) {
    // Overschrijft geen variabelen die al gezet zijn.
    process.loadEnvFile(file);
    return;
  }
  const parsed = parseEnv(readFileSync(file, "utf8"));
  for (const [k, v] of Object.entries(parsed)) {
    if (env[k] === undefined && v !== undefined) env[k] = v;
  }
}

// ─────────────────────────────── overrides ───────────────────────────────

/**
 * Leest `<dataDir>/config.json` en geeft ALLEEN de geldige velden terug.
 * Ongeldige of onbekende velden worden genegeerd (met waarschuwing), zodat een
 * kapot bestand nooit de start blokkeert.
 */
export function readEngineOverrides(
  dataDir: string,
  warn: (msg: string) => void = (m) => console.warn(m),
  /** Wordt aangeroepen bij een bestand van v1 (lijst zonder `universe`): die lijst geldt ("manual"). */
  onLegacyMarkets?: (markets: string[]) => void,
): Partial<EngineConfig> {
  const file = join(dataDir, OVERRIDES_FILE);
  if (!existsSync(file)) return {};
  let raw: unknown;
  try {
    raw = JSON.parse(readFileSync(file, "utf8"));
  } catch (err) {
    warn(`⚠ Kon ${file} niet lezen (${(err as Error).message}); opgeslagen instellingen worden genegeerd.`);
    return {};
  }
  if (!isPlainObject(raw)) {
    warn(`⚠ ${file} bevat geen geldig object; opgeslagen instellingen worden genegeerd.`);
    return {};
  }
  const out: Partial<EngineConfig> = {};
  const skipped: string[] = [];

  if (raw.markets !== undefined) {
    if (
      Array.isArray(raw.markets) &&
      raw.markets.length >= 1 &&
      raw.markets.length <= MAX_MARKETS &&
      raw.markets.every((m) => typeof m === "string" && MARKET_RE.test(m.toUpperCase()))
    ) {
      out.markets = [...new Set((raw.markets as string[]).map((m) => m.toUpperCase()))];
    } else skipped.push("markets");
  }
  if (raw.interval !== undefined) {
    if (typeof raw.interval === "string" && (INTERVALS as readonly string[]).includes(raw.interval)) {
      out.interval = raw.interval as Interval;
    } else skipped.push("interval");
  }
  if (raw.pollMs !== undefined) {
    if (isFiniteNumber(raw.pollMs) && raw.pollMs >= 5000 && raw.pollMs <= 300_000) out.pollMs = raw.pollMs;
    else skipped.push("pollMs");
  }
  if (raw.historyCandles !== undefined) {
    if (isFiniteNumber(raw.historyCandles) && raw.historyCandles >= 100 && raw.historyCandles <= 1000) {
      out.historyCandles = Math.round(raw.historyCandles);
    } else skipped.push("historyCandles");
  }
  if (raw.universe !== undefined) {
    if (isPlainObject(raw.universe)) {
      const u = raw.universe;
      const uni: Partial<UniverseConfig> = {};
      if (u.mode !== undefined) {
        if (u.mode === "manual" || u.mode === "auto") uni.mode = u.mode;
        else skipped.push("universe.mode");
      }
      if (u.count !== undefined) {
        if (isFiniteNumber(u.count) && Number.isInteger(u.count) && u.count >= 1 && u.count <= MAX_MARKETS) {
          uni.count = u.count;
        } else skipped.push("universe.count");
      }
      if (u.minVolumeEur !== undefined) {
        if (isFiniteNumber(u.minVolumeEur) && u.minVolumeEur >= 0 && u.minVolumeEur <= UNIVERSE_MIN_VOLUME_MAX) {
          uni.minVolumeEur = u.minVolumeEur;
        } else skipped.push("universe.minVolumeEur");
      }
      out.universe = uni as UniverseConfig;
    } else skipped.push("universe");
  } else if (out.markets) {
    // Bestand van v1 (vóór de automatische muntkeuze): v2 slaat `universe` altijd op. Zonder
    // dat veld betekende de opgeslagen lijst "precies deze markten" — dat blijft zo.
    out.universe = { mode: "manual" } as UniverseConfig;
    onLegacyMarkets?.([...out.markets]);
  }
  if (raw.risk !== undefined) {
    if (isPlainObject(raw.risk)) {
      const risk: Partial<RiskConfig> = {};
      for (const key of Object.keys(DEFAULT_ENGINE_CONFIG.risk) as (keyof RiskConfig)[]) {
        const v = raw.risk[key];
        if (v === undefined) continue;
        // Zelfde grenzen als de risicomanager: een ongeldige waarde (bijv. takerFee 0.05)
        // valt terug op de standaardwaarde van alleen die instelling.
        if (isFiniteNumber(v) && validateRiskConfig({ [key]: v }).ok) risk[key] = v;
        else skipped.push(`risk.${key}`);
      }
      out.risk = risk as RiskConfig;
    } else skipped.push("risk");
  }
  if (raw.ensemble !== undefined) {
    if (isPlainObject(raw.ensemble)) {
      const e = raw.ensemble;
      const ens: Partial<EnsembleConfig> = {};
      const isId = (s: unknown): s is StrategyId =>
        typeof s === "string" && (STRATEGY_IDS as readonly string[]).includes(s);
      if (e.enabled !== undefined) {
        if (Array.isArray(e.enabled) && e.enabled.length > 0 && e.enabled.every(isId)) {
          ens.enabled = [...new Set(e.enabled as StrategyId[])];
        } else skipped.push("ensemble.enabled");
      }
      if (e.weights !== undefined) {
        if (isPlainObject(e.weights)) {
          const w: Partial<Record<StrategyId, number>> = {};
          for (const [k, v] of Object.entries(e.weights)) {
            if (isId(k) && isFiniteNumber(v) && v >= 0 && v <= 5) w[k] = v;
            else skipped.push(`ensemble.weights.${k}`);
          }
          ens.weights = w;
        } else skipped.push("ensemble.weights");
      }
      if (e.params !== undefined) {
        if (isPlainObject(e.params)) {
          const p: Partial<Record<StrategyId, StrategyParams>> = {};
          for (const [k, v] of Object.entries(e.params)) {
            if (isId(k) && isPlainObject(v) && Object.values(v).every(isFiniteNumber)) {
              p[k] = v as StrategyParams;
            } else skipped.push(`ensemble.params.${k}`);
          }
          ens.params = p;
        } else skipped.push("ensemble.params");
      }
      if (e.buyThreshold !== undefined) {
        if (isFiniteNumber(e.buyThreshold) && e.buyThreshold >= 0.05 && e.buyThreshold <= 1) {
          ens.buyThreshold = e.buyThreshold;
        } else skipped.push("ensemble.buyThreshold");
      }
      if (e.sellThreshold !== undefined) {
        if (isFiniteNumber(e.sellThreshold) && e.sellThreshold >= -1 && e.sellThreshold <= -0.05) {
          ens.sellThreshold = e.sellThreshold;
        } else skipped.push("ensemble.sellThreshold");
      }
      if (e.regimeFilter !== undefined) {
        if (typeof e.regimeFilter === "boolean") ens.regimeFilter = e.regimeFilter;
        else skipped.push("ensemble.regimeFilter");
      }
      if (e.trendFilter !== undefined) {
        if (isPlainObject(e.trendFilter)) {
          const t = e.trendFilter;
          const tf: Partial<TrendFilterConfig> = {};
          for (const flag of ["market", "coin"] as const) {
            if (t[flag] === undefined) continue;
            if (typeof t[flag] === "boolean") tf[flag] = t[flag];
            else skipped.push(`ensemble.trendFilter.${flag}`);
          }
          if (t.interval !== undefined) {
            if (isTrendFilterInterval(t.interval)) tf.interval = t.interval;
            else skipped.push("ensemble.trendFilter.interval");
          }
          if (t.period !== undefined) {
            if (
              isFiniteNumber(t.period) &&
              Number.isInteger(t.period) &&
              t.period >= TREND_PERIOD_MIN &&
              t.period <= TREND_PERIOD_MAX
            ) {
              tf.period = t.period;
            } else skipped.push("ensemble.trendFilter.period");
          }
          ens.trendFilter = tf as TrendFilterConfig;
        } else skipped.push("ensemble.trendFilter");
      }
      out.ensemble = ens as EnsembleConfig;
    } else skipped.push("ensemble");
  }
  if (skipped.length > 0) {
    warn(`⚠ Ongeldige opgeslagen instellingen genegeerd in ${file}: ${skipped.join(", ")}`);
  }
  return out;
}

/**
 * Legt (gedeeltelijke) engine-instellingen over een basisconfig heen (diep voor
 * ensemble/risk; `universe` en `ensemble.trendFilter` per veld). Een basis
 * zonder `universe` telt als "manual", een ensemble zonder `trendFilter` als
 * "filter uit".
 */
export function mergeEngineConfig(base: EngineConfig, patch: Partial<EngineConfig>): EngineConfig {
  const out = cloneEngineConfig(base);
  if (patch.markets) out.markets = [...patch.markets];
  if (patch.interval) out.interval = patch.interval;
  if (patch.pollMs !== undefined) out.pollMs = patch.pollMs;
  if (patch.historyCandles !== undefined) out.historyCandles = patch.historyCandles;
  if (patch.universe) {
    const u = patch.universe as Partial<UniverseConfig>;
    out.universe = {
      ...universeOrManual(out.universe),
      ...(u.mode !== undefined ? { mode: u.mode } : {}),
      ...(u.count !== undefined ? { count: u.count } : {}),
      ...(u.minVolumeEur !== undefined ? { minVolumeEur: u.minVolumeEur } : {}),
    };
  }
  if (patch.risk) out.risk = { ...out.risk, ...patch.risk };
  if (patch.ensemble) {
    const e = patch.ensemble as Partial<EnsembleConfig>;
    out.ensemble = {
      ...out.ensemble,
      ...(e.enabled ? { enabled: [...e.enabled] } : {}),
      ...(e.buyThreshold !== undefined ? { buyThreshold: e.buyThreshold } : {}),
      ...(e.sellThreshold !== undefined ? { sellThreshold: e.sellThreshold } : {}),
      ...(e.regimeFilter !== undefined ? { regimeFilter: e.regimeFilter } : {}),
      weights: { ...out.ensemble.weights, ...(e.weights ?? {}) },
      params: { ...out.ensemble.params, ...structuredClone(e.params ?? {}) },
    };
    if (e.trendFilter) {
      const t = e.trendFilter as Partial<TrendFilterConfig>;
      out.ensemble.trendFilter = {
        ...trendFilterOrOff(out.ensemble.trendFilter),
        ...(t.market !== undefined ? { market: t.market } : {}),
        ...(t.coin !== undefined ? { coin: t.coin } : {}),
        ...(t.interval !== undefined ? { interval: t.interval } : {}),
        ...(t.period !== undefined ? { period: t.period } : {}),
      };
    }
  }
  return out;
}

/**
 * Vervangt ongeldige risico-instellingen (bijv. een takerFee van 0.05 uit een
 * oud config.json) per instelling door de standaardwaarde. Geldige waarden
 * blijven staan. Muteert `risk`; geeft de vervangen sleutels terug.
 */
export function repairRiskConfig(risk: RiskConfig): (keyof RiskConfig)[] {
  const fixed: (keyof RiskConfig)[] = [];
  if (validateRiskConfig(risk).ok) return fixed;
  for (const k of Object.keys(DEFAULT_ENGINE_CONFIG.risk) as (keyof RiskConfig)[]) {
    if (!validateRiskConfig({ [k]: risk[k] }).ok) {
      (risk as unknown as Record<string, number | undefined>)[k] = DEFAULT_ENGINE_CONFIG.risk[k];
      fixed.push(k);
    }
  }
  return fixed;
}

/**
 * Slaat de huidige engine-instellingen op in `<dataDir>/config.json` (atomisch).
 * Optionele v2-velden worden altijd expliciet opgeslagen, zodat het bestand na
 * een herstart hetzelfde betekent: geen `universe` → "manual", geen trendfilter
 * → filter uit, geen `maxSpreadPct` → 0 (geen spreadlimiet). Anders zouden de
 * (andere) standaardwaarden het bij het laden stilletjes aanvullen.
 */
export function saveEngineOverrides(dataDir: string, cfg: EngineConfig): void {
  mkdirSync(dataDir, { recursive: true });
  const file = join(dataDir, OVERRIDES_FILE);
  const tmp = `${file}.${process.pid}.tmp`;
  const out = cloneEngineConfig(cfg);
  out.universe = universeOrManual(out.universe);
  if (out.ensemble) out.ensemble.trendFilter = trendFilterOrOff(out.ensemble.trendFilter);
  if (out.risk && out.risk.maxSpreadPct === undefined) out.risk.maxSpreadPct = 0;
  writeFileSync(tmp, JSON.stringify(out, null, 2) + "\n", "utf8");
  renameSync(tmp, file);
}

// ─────────────────────────────── meerdere bots (v3) ───────────────────────────────

/** Standaard startkapitaal (paper) per bot als er meer dan één bot is. */
export const DEFAULT_PAPER_CAPITAL_PER_BOT = 25;
/** Submap van DATA_DIR met één map per bot (alleen bij meer dan één bot). */
export const BOTS_DIR = "bots";

const BOT_ID_RE = /^[a-z][a-z0-9-]{0,39}$/;

/** Bekende bot-id's als tekst voor meldingen: "scalper, trend, dip, allround". */
function knownBotsText(): string {
  return DEFAULT_BOT_IDS.join(", ");
}

/**
 * Leest `BOTS` uit .env: een komma-lijst met profiel-id's (hoofdletters en spaties
 * maken niet uit, dubbele tellen één keer, de volgorde blijft). Leeg of weggelaten =
 * alle vier de bots. Een onbekende id geeft een Nederlandse ConfigError.
 */
export function parseBotsEnv(raw: string | undefined): string[] {
  if (raw === undefined || raw.trim() === "") return [...DEFAULT_BOT_IDS];
  const ids = [
    ...new Set(
      raw
        .split(",")
        .map((s) => s.trim().toLowerCase())
        .filter(Boolean),
    ),
  ];
  if (ids.length === 0) {
    throw new ConfigError(`BOTS bevat geen bots (nu: "${raw}"). Kies uit: ${knownBotsText()}, bijv. BOTS=scalper,trend.`);
  }
  const unknown = ids.filter((id) => !getProfile(id));
  if (unknown.length > 0) {
    throw new ConfigError(
      `BOTS bevat ${unknown.length === 1 ? "een onbekende bot" : "onbekende bots"}: ${unknown.map((u) => `"${u}"`).join(", ")}. ` +
        `Kies uit: ${knownBotsText()} (komma-gescheiden), bijv. BOTS=scalper,trend. Leeg = alle vier.`,
    );
  }
  return ids;
}

/**
 * Welke bot met echt geld handelt. Alleen in live mode (anders null). Eén bot → die
 * bot (`LIVE_BOT` mag dan weg, maar moet anders dezelfde zijn). Meer bots → `LIVE_BOT`
 * is verplicht en moet in `BOTS` staan: er is maar één Bitvavo-account, dus nooit twee
 * live bots. Gooit een Nederlandse ConfigError als dat niet klopt.
 */
export function resolveLiveBot(mode: TradingMode, bots: readonly string[], liveBot: string | undefined): string | null {
  if (mode !== "live") return null;
  const wanted = liveBot?.trim().toLowerCase() || undefined;
  if (wanted === undefined) {
    if (bots.length === 1) return bots[0];
    throw new ConfigError(
      `Live handelen met ${bots.length} bots: kies in .env welke ÉÉN bot met echt geld handelt, bijvoorbeeld ` +
        `LIVE_BOT=${bots.includes("trend") ? "trend" : bots[0]}. De andere bots blijven oefenen met nep-geld op echte koersen. ` +
        `Kies uit: ${bots.join(", ")}. Of zet BOTS op één bot, of TRADING_MODE=paper om te oefenen.`,
    );
  }
  if (!getProfile(wanted)) {
    throw new ConfigError(`LIVE_BOT="${wanted}" is geen bekende bot. Kies uit: ${bots.join(", ")}.`);
  }
  if (!bots.includes(wanted)) {
    throw new ConfigError(
      `LIVE_BOT=${wanted} draait niet: BOTS bevat alleen ${bots.join(", ")}. ` +
        `Zet LIVE_BOT op een van die bots, of voeg ${wanted} toe aan BOTS.`,
    );
  }
  return wanted;
}

/**
 * Map met de instellingen (`config.json`) en de toestand (`state-<mode>.json`) van een
 * bot: bij één bot de oude plek (`dataDir` zelf), bij meer bots `<dataDir>/bots/<id>`.
 */
export function botDataDir(dataDir: string, id: string, multi: boolean): string {
  if (!BOT_ID_RE.test(id)) throw new ConfigError(`Ongeldige bot-id: "${id}".`);
  return multi ? join(dataDir, BOTS_DIR, id) : dataDir;
}

/** Het toestandsbestand van een bot: `<botDataDir>/state-<mode>.json`. */
export function botStateFile(dataDir: string, id: string, multi: boolean, mode: TradingMode): string {
  return join(botDataDir(dataDir, id, multi), `state-${mode}.json`);
}

/** Legt MARKETS/INTERVAL uit .env over een engineconfig heen (muteert `engine`). */
function applyEnvSelection(engine: EngineConfig, markets: MarketsEnv | undefined, interval: Interval | undefined): void {
  if (markets) {
    const universe = universeOrManual(engine.universe);
    if (markets.mode === "auto") {
      engine.universe = { ...universe, mode: "auto", count: markets.count };
    } else {
      engine.markets = [...markets.markets];
      engine.universe = { ...universe, mode: "manual" };
    }
  }
  if (interval) engine.interval = interval;
}

export interface BotEngineConfigOptions {
  /** De eigen map van de bot ({@link botDataDir}); daar staat zijn opgeslagen `config.json`. */
  dataDir: string;
  /** Alleen bij één bot: MARKETS/INTERVAL uit .env (tussen profiel en opgeslagen instellingen). */
  env?: { markets?: MarketsEnv; interval?: Interval };
  warn?: (msg: string) => void;
}

/**
 * Engine-instellingen van één bot: het profiel (`profileEngineConfig`) → bij één bot
 * MARKETS/INTERVAL uit .env → de in het dashboard opgeslagen instellingen van die bot
 * (`<dataDir>/config.json`, gelezen met `readEngineOverrides`, per veld gecontroleerd).
 */
export function loadBotEngineConfig(profile: BotProfile, opts: BotEngineConfigOptions): EngineConfig {
  const engine = profileEngineConfig(profile);
  applyEnvSelection(engine, opts.env?.markets, opts.env?.interval);
  const overrides = readEngineOverrides(opts.dataDir, opts.warn ?? ((m) => console.warn(m)));
  return mergeEngineConfig(engine, overrides);
}

/** Alles wat main.ts nodig heeft om één bot te bouwen. */
export interface BotSetup {
  id: string;
  profile: BotProfile;
  /** "live" alleen voor de bot uit LIVE_BOT (in live mode); alle andere bots "paper". */
  mode: TradingMode;
  /** Meer dan één bot? (bepaalt de mappen en de logprefix) */
  multi: boolean;
  /** Eigen map (instellingen); bij één bot de oude DATA_DIR. */
  dataDir: string;
  /** `<dataDir>/state-<mode>.json` */
  stateFile: string;
  /** Paper: eigen startkapitaal; live: CAPITAL_LIMIT_EUR. */
  startingCapital: number;
  engine: EngineConfig;
  /** Automatisch starten (live nooit). */
  autostart: boolean;
  /** Pad van het eigen dashboard: "/bot/<id>/". */
  path: string;
  /** Wat de server van deze bot krijgt (modus, map, kapitaal, instellingen). */
  appConfig: AppConfig;
}

/**
 * Maakt van de geladen configuratie één {@link BotSetup} per bot (in de volgorde van
 * BOTS). Bij één bot: de oude paden, PAPER_STARTING_CAPITAL en MARKETS/INTERVAL uit
 * .env, zodat bestaande gebruikers niets verliezen. Bij meer bots: `<DATA_DIR>/bots/<id>`,
 * PAPER_CAPITAL_PER_BOT en alleen het profiel (+ opgeslagen instellingen van die bot).
 * Gooit een ConfigError als de live-bot niet klopt (zie {@link resolveLiveBot}).
 */
export function planBots(config: AppConfig, opts: { warn?: (msg: string) => void } = {}): BotSetup[] {
  const warn = opts.warn ?? ((m: string) => console.warn(m));
  const ids = config.bots && config.bots.length > 0 ? [...config.bots] : [...DEFAULT_BOT_IDS];
  const multi = ids.length > 1;
  const liveId = resolveLiveBot(config.mode, ids, config.liveBot);
  const perBot = config.paperCapitalPerBot ?? DEFAULT_PAPER_CAPITAL_PER_BOT;
  return ids.map((id): BotSetup => {
    const profile = getProfile(id);
    if (!profile) throw new ConfigError(`BOTS bevat een onbekende bot: "${id}". Kies uit: ${knownBotsText()}.`);
    const mode: TradingMode = id === liveId ? "live" : "paper";
    const dataDir = botDataDir(config.dataDir, id, multi);
    const startingCapital = mode === "live" ? config.capitalLimitQuote : multi ? perBot : config.paperStartingCapital;
    const engine = loadBotEngineConfig(profile, {
      dataDir,
      // Eén bot: .env telt zoals vroeger. loadConfig heeft daar al over gemeld (zelfde
      // bestand, zelfde .env), dus hier stil om dubbele meldingen te voorkomen.
      ...(multi ? {} : { env: { markets: config.marketsEnv, interval: config.intervalEnv } }),
      warn: multi ? warn : () => {},
    });
    const autostart = mode === "live" ? false : multi ? (config.paperAutostart ?? config.autostart) : config.autostart;
    const appConfig: AppConfig = multi
      ? {
          ...config,
          mode,
          dataDir,
          engine,
          autostart,
          paperStartingCapital: mode === "paper" ? startingCapital : config.paperStartingCapital,
          // Alleen de live-bot krijgt de API-sleutel; de oefenbots hebben hem niet nodig.
          apiKey: mode === "live" ? config.apiKey : undefined,
          apiSecret: mode === "live" ? config.apiSecret : undefined,
        }
      : { ...config, engine };
    return {
      id,
      profile,
      mode,
      multi,
      dataDir,
      stateFile: botStateFile(config.dataDir, id, multi, mode),
      startingCapital,
      engine: cloneEngineConfig(engine),
      autostart,
      path: `/bot/${id}/`,
      appConfig,
    };
  });
}

// ─────────────────────────────── loadConfig ───────────────────────────────

/** Wat de bot volgt, om .env en opgeslagen instellingen te vergelijken: "auto:30" of "manual:BTC-EUR,…". */
function selectionKey(cfg: EngineConfig): string {
  const u = universeOrManual(cfg.universe);
  return u.mode === "auto" ? `auto:${u.count}` : `manual:${cfg.markets.join(",")}`;
}

/** MARKETS zoals in .env bedoeld: "auto:30" of de (ingekorte) lijst. */
function envSelectionLabel(cfg: EngineConfig): string {
  const u = universeOrManual(cfg.universe);
  return u.mode === "auto" ? `auto:${u.count}` : shortList(cfg.markets);
}

/** De opgeslagen muntkeuze in gewone taal (noemt de modus als die anders is dan in .env). */
function savedSelectionLabel(saved: EngineConfig, fromEnv: EngineConfig): string {
  const u = universeOrManual(saved.universe);
  if (u.mode === "auto") {
    return `de automatische muntkeuze (${u.count === 1 ? "de munt" : `de ${u.count} munten`} met de meeste handel)`;
  }
  const list = shortList(saved.markets);
  return universeOrManual(fromEnv.universe).mode === "auto" ? `een eigen lijst (${list})` : list;
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env, opts: LoadConfigOptions = {}): AppConfig {
  const warn = opts.warn ?? ((m: string) => console.warn(m));
  const envFile = opts.envFile === undefined ? (env === process.env ? join(PROJECT_ROOT, ".env") : false) : opts.envFile;
  if (envFile) loadEnvFileInto(env, envFile);

  const modeRaw = (str(env, "TRADING_MODE") ?? "paper").toLowerCase();
  if (modeRaw !== "paper" && modeRaw !== "live") {
    throw new ConfigError(`TRADING_MODE moet "paper" (oefenen) of "live" (echt geld) zijn (nu: "${modeRaw}").`);
  }
  const mode: TradingMode = modeRaw;

  const dsRaw = (str(env, "DATA_SOURCE") ?? "auto").toLowerCase();
  if (dsRaw !== "auto" && dsRaw !== "bitvavo" && dsRaw !== "simulated") {
    throw new ConfigError(`DATA_SOURCE moet "auto", "bitvavo" of "simulated" zijn (nu: "${dsRaw}").`);
  }
  const dataSource = dsRaw as AppConfig["dataSource"];

  const apiKey = str(env, "BITVAVO_API_KEY");
  const apiSecret = str(env, "BITVAVO_API_SECRET");
  if ((apiKey && !apiSecret) || (!apiKey && apiSecret)) {
    throw new ConfigError("Vul zowel BITVAVO_API_KEY als BITVAVO_API_SECRET in (of laat ze allebei leeg).");
  }
  const operatorId = num(env, "BITVAVO_OPERATOR_ID", 1, { min: 1, integer: true });

  const host = str(env, "HOST") ?? "127.0.0.1";
  const port = num(env, "PORT", 4321, { min: 0, max: 65535, integer: true });

  const paperStartingCapital = num(env, "PAPER_STARTING_CAPITAL", DEFAULT_PAPER_CAPITAL, { min: 5, max: 10_000_000 });
  const capitalLimitQuote = num(env, "CAPITAL_LIMIT_EUR", 50, { min: 5, max: 10_000_000 });

  const dashboardToken = str(env, "DASHBOARD_TOKEN");
  if (dashboardToken !== undefined && dashboardToken.length < 8) {
    throw new ConfigError("DASHBOARD_TOKEN moet minstens 8 tekens lang zijn (of laat hem leeg).");
  }

  const dataDirRaw = str(env, "DATA_DIR") ?? "./data";
  const dataDir = isAbsolute(dataDirRaw) ? dataDirRaw : resolve(PROJECT_ROOT, dataDirRaw);

  // Meerdere bots (v3)
  const bots = parseBotsEnv(str(env, "BOTS"));
  const paperCapitalPerBot = num(env, "PAPER_CAPITAL_PER_BOT", DEFAULT_PAPER_CAPITAL_PER_BOT, {
    min: 5,
    max: 10_000_000,
  });
  const liveBotRaw = str(env, "LIVE_BOT")?.toLowerCase();
  // Meldingen over de instellingen van één bot (config.json in DATA_DIR, MARKETS/INTERVAL).
  const singleWarn = opts.onlySingleBotWarnings && bots.length > 1 ? () => {} : warn;

  // Engine: standaard → env → opgeslagen dashboard-instellingen
  let engine = cloneEngineConfig(DEFAULT_ENGINE_CONFIG);
  const marketsRaw = str(env, "MARKETS");
  const marketsEnv = marketsRaw !== undefined ? parseMarketsEnv(marketsRaw) : undefined;
  const intervalRaw = str(env, "INTERVAL");
  if (intervalRaw !== undefined && !(INTERVALS as readonly string[]).includes(intervalRaw)) {
    throw new ConfigError(`INTERVAL moet een van ${INTERVALS.join(", ")} zijn (nu: "${intervalRaw}").`);
  }
  const intervalEnv = intervalRaw as Interval | undefined;
  applyEnvSelection(engine, marketsEnv, intervalEnv);
  // Instellingen die in het dashboard zijn opgeslagen winnen van .env. Zeg dat
  // hardop als ze MARKETS/INTERVAL uit .env overschrijven, anders lijkt .env kapot.
  let legacyMarkets: string[] | null = null;
  const overrides = readEngineOverrides(dataDir, singleWarn, (list) => {
    legacyMarkets = list;
  });
  const overridesFile = join(dataDir, OVERRIDES_FILE);
  const fromEnv = engine;
  engine = mergeEngineConfig(engine, overrides);
  if (marketsRaw !== undefined && selectionKey(engine) !== selectionKey(fromEnv)) {
    singleWarn(
      `⚠ MARKETS uit .env (${envSelectionLabel(fromEnv)}) wordt genegeerd: in het dashboard is ` +
        `${savedSelectionLabel(engine, fromEnv)} opgeslagen (${overridesFile}). ` +
        "Wijzig de munten in het tabblad Instellingen, of verwijder dat bestand om .env weer te laten gelden.",
    );
  } else if (legacyMarkets !== null && marketsRaw === undefined) {
    // Zonder MARKETS zou de bot anders stilletjes automatisch 30 munten kiezen.
    singleWarn(
      `ℹ Oud instellingenbestand (${overridesFile}): de bot volgt je opgeslagen munten (${shortList(legacyMarkets)}). ` +
        "Automatisch kiezen kan in Instellingen → Munten.",
    );
  }
  if (intervalRaw !== undefined && overrides.interval && overrides.interval !== fromEnv.interval) {
    singleWarn(
      `⚠ INTERVAL uit .env (${fromEnv.interval}) wordt genegeerd: in het dashboard is ${overrides.interval} ` +
        `opgeslagen (${overridesFile}). Wijzig het interval in het tabblad Instellingen, of verwijder dat ` +
        "bestand om .env weer te laten gelden.",
    );
  }

  // Live-specifieke veiligheidscontroles
  if (mode === "live") {
    if (!apiKey || !apiSecret) {
      throw new ConfigError(
        "Live trading vereist BITVAVO_API_KEY en BITVAVO_API_SECRET in .env. " +
          "Maak de API-sleutel aan ZONDER opnamerechten en met een IP-whitelist. " +
          "Wil je oefenen? Zet TRADING_MODE=paper.",
      );
    }
    if (dataSource === "simulated") {
      throw new ConfigError(
        "Live trading kan niet met gesimuleerde marktdata (DATA_SOURCE=simulated). " +
          "Gebruik DATA_SOURCE=bitvavo of auto, of zet TRADING_MODE=paper.",
      );
    }
    // Zonder token en buiten loopback kan iedereen op het netwerk de bot armen/starten.
    if (!dashboardToken && !isLoopbackHost(host)) {
      throw new ConfigError(
        `Live trading met HOST=${host} maakt het dashboard bereikbaar vanaf het netwerk. ` +
          "Zet een DASHBOARD_TOKEN (minstens 8 tekens) in .env, of gebruik HOST=127.0.0.1.",
      );
    }
  }
  const paperAutostart = bool(env, "AUTOSTART", true);
  const autostart = mode === "live" ? false : paperAutostart;

  // Welke bot met echt geld handelt. Een ongeldige LIVE_BOT stopt live mode meteen;
  // in oefenmodus doet LIVE_BOT niets (alleen een melding). Live met meer bots en
  // zonder LIVE_BOT weigert main.ts te starten (planBots → resolveLiveBot).
  let liveBot: string | undefined;
  if (liveBotRaw !== undefined) {
    if (mode === "live") {
      liveBot = resolveLiveBot(mode, bots, liveBotRaw) ?? undefined;
    } else {
      warn(`ℹ LIVE_BOT=${liveBotRaw} wordt genegeerd: TRADING_MODE=paper, dus alle bots oefenen met nep-geld.`);
    }
  }

  return {
    mode,
    dataSource,
    host,
    port,
    apiKey,
    apiSecret,
    operatorId,
    paperStartingCapital,
    capitalLimitQuote,
    dashboardToken,
    dataDir,
    engine,
    autostart,
    bots,
    paperCapitalPerBot,
    ...(liveBot !== undefined ? { liveBot } : {}),
    paperAutostart,
    ...(marketsEnv !== undefined ? { marketsEnv } : {}),
    ...(intervalEnv !== undefined ? { intervalEnv } : {}),
  };
}
