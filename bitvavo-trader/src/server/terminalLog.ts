/**
 * Engine-logregels in de terminal (main.ts). Waarschuwingen die de engine al
 * tijdens het bouwen logde (bijv. "Opgeslagen staat onbruikbaar …"), gingen
 * vroeger verloren omdat de listener pas daarna gekoppeld werd.
 */
import type { LogEntry } from "../core/types";

/** Wat hiervoor van de engine nodig is (de TradingEngine is een EventEmitter). */
export interface LogSourceLike {
  snapshot(): { logs: LogEntry[] };
  on(event: "log", listener: (entry: LogEntry) => void): unknown;
}

export interface TerminalOut {
  log(msg: string): void;
  warn(msg: string): void;
  error(msg: string): void;
}

/**
 * Print één logregel (warn/error/trade; info alleen in het dashboard). Met `prefix`
 * (bij meer bots de korte naam, bijv. "Scalper") begint de regel met `[Scalper] `,
 * zodat je in de terminal ziet welke bot het was.
 */
export function printLogEntry(entry: LogEntry, out: TerminalOut = console, prefix?: string): void {
  if (!entry || typeof entry.message !== "string") return;
  const time = new Date(entry.time ?? Date.now()).toLocaleTimeString("nl-NL");
  const who = prefix ? `[${prefix}] ` : "";
  if (entry.level === "error") out.error(`${who}[${time}] ✖ ${entry.message}`);
  else if (entry.level === "warn") out.warn(`${who}[${time}] ⚠ ${entry.message}`);
  else if (entry.level === "trade") out.log(`${who}[${time}] € ${entry.message}`);
}

/**
 * Print eerst de waarschuwingen en fouten die de engine AL gelogd heeft
 * (`snapshot().logs` is nieuwste eerst → oudste eerst geprint) en koppelt
 * daarna de listener voor nieuwe regels. Beide gebeuren synchroon achter
 * elkaar, dus er kan geen regel dubbel of verloren gaan.
 */
export function attachTerminalLog(
  engine: LogSourceLike,
  /** Eigen printfunctie, of een voorvoegsel (korte botnaam) voor {@link printLogEntry}. */
  printOrPrefix?: ((entry: LogEntry) => void) | string,
): void {
  const print =
    typeof printOrPrefix === "function"
      ? printOrPrefix
      : (e: LogEntry) => printLogEntry(e, console, typeof printOrPrefix === "string" ? printOrPrefix : undefined);
  const earlier = engine
    .snapshot()
    .logs.filter((l) => l && (l.level === "warn" || l.level === "error"))
    .reverse()
    // Stabiel: bij gelijke tijd blijft de (omgekeerde) volgorde van de engine staan.
    .sort((a, b) => (a.time ?? 0) - (b.time ?? 0));
  for (const entry of earlier) print(entry);
  engine.on("log", print);
}
