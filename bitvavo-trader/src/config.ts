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
import { DEFAULT_ENGINE_CONFIG, DEFAULT_PAPER_CAPITAL } from "./core/defaults";
import { validateRiskConfig } from "./risk/riskManager";
import {
  INTERVALS,
  STRATEGY_IDS,
  type DataSource,
  type EngineConfig,
  type EnsembleConfig,
  type Interval,
  type RiskConfig,
  type StrategyId,
  type StrategyParams,
  type TradingMode,
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
}

export interface LoadConfigOptions {
  /**
   * Pad naar een .env-bestand. Standaard `<project>/.env`, maar alleen als
   * `env === process.env`. `false` = nooit een .env-bestand lezen.
   */
  envFile?: string | false;
  /** Waarschuwingen (standaard console.warn); handig om in tests op te vangen. */
  warn?: (msg: string) => void;
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

export function cloneEngineConfig(cfg: EngineConfig): EngineConfig {
  return structuredClone(cfg);
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
      raw.markets.length <= 8 &&
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
      out.ensemble = ens as EnsembleConfig;
    } else skipped.push("ensemble");
  }
  if (skipped.length > 0) {
    warn(`⚠ Ongeldige opgeslagen instellingen genegeerd in ${file}: ${skipped.join(", ")}`);
  }
  return out;
}

/** Legt (gedeeltelijke) engine-instellingen over een basisconfig heen (diep voor ensemble/risk). */
export function mergeEngineConfig(base: EngineConfig, patch: Partial<EngineConfig>): EngineConfig {
  const out = cloneEngineConfig(base);
  if (patch.markets) out.markets = [...patch.markets];
  if (patch.interval) out.interval = patch.interval;
  if (patch.pollMs !== undefined) out.pollMs = patch.pollMs;
  if (patch.historyCandles !== undefined) out.historyCandles = patch.historyCandles;
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
      risk[k] = DEFAULT_ENGINE_CONFIG.risk[k];
      fixed.push(k);
    }
  }
  return fixed;
}

/** Slaat de huidige engine-instellingen op in `<dataDir>/config.json` (atomisch). */
export function saveEngineOverrides(dataDir: string, cfg: EngineConfig): void {
  mkdirSync(dataDir, { recursive: true });
  const file = join(dataDir, OVERRIDES_FILE);
  const tmp = `${file}.${process.pid}.tmp`;
  writeFileSync(tmp, JSON.stringify(cfg, null, 2) + "\n", "utf8");
  renameSync(tmp, file);
}

// ─────────────────────────────── loadConfig ───────────────────────────────

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

  // Engine: standaard → env → opgeslagen dashboard-instellingen
  let engine = cloneEngineConfig(DEFAULT_ENGINE_CONFIG);
  const marketsRaw = str(env, "MARKETS");
  if (marketsRaw !== undefined) {
    const markets = [
      ...new Set(
        marketsRaw
          .split(",")
          .map((m) => m.trim().toUpperCase())
          .filter(Boolean),
      ),
    ];
    const bad = markets.filter((m) => !MARKET_RE.test(m));
    if (bad.length > 0) {
      throw new ConfigError(`MARKETS bevat ongeldige markten: ${bad.join(", ")}. Gebruik bijv. "BTC-EUR,ETH-EUR".`);
    }
    if (markets.length < 1 || markets.length > 8) {
      throw new ConfigError(`MARKETS moet 1 tot 8 markten bevatten (nu: ${markets.length}).`);
    }
    engine.markets = markets;
  }
  const intervalRaw = str(env, "INTERVAL");
  if (intervalRaw !== undefined) {
    if (!(INTERVALS as readonly string[]).includes(intervalRaw)) {
      throw new ConfigError(`INTERVAL moet een van ${INTERVALS.join(", ")} zijn (nu: "${intervalRaw}").`);
    }
    engine.interval = intervalRaw as Interval;
  }
  // Instellingen die in het dashboard zijn opgeslagen winnen van .env. Zeg dat
  // hardop als ze MARKETS/INTERVAL uit .env overschrijven, anders lijkt .env kapot.
  const overrides = readEngineOverrides(dataDir, warn);
  const overridesFile = join(dataDir, OVERRIDES_FILE);
  if (marketsRaw !== undefined && overrides.markets && overrides.markets.join(",") !== engine.markets.join(",")) {
    warn(
      `⚠ MARKETS uit .env (${engine.markets.join(", ")}) wordt genegeerd: in het dashboard is ` +
        `${overrides.markets.join(", ")} opgeslagen (${overridesFile}). Wijzig de markten in het tabblad ` +
        "Instellingen, of verwijder dat bestand om .env weer te laten gelden.",
    );
  }
  if (intervalRaw !== undefined && overrides.interval && overrides.interval !== engine.interval) {
    warn(
      `⚠ INTERVAL uit .env (${engine.interval}) wordt genegeerd: in het dashboard is ${overrides.interval} ` +
        `opgeslagen (${overridesFile}). Wijzig het interval in het tabblad Instellingen, of verwijder dat ` +
        "bestand om .env weer te laten gelden.",
    );
  }
  engine = mergeEngineConfig(engine, overrides);

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
  const autostart = mode === "live" ? false : bool(env, "AUTOSTART", true);

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
  };
}
