/**
 * Veiligheidscontrole bij het starten van een live-bot: staan er nog live-posities
 * (of orders met onbekende uitkomst) in de administratie van een ANDERE bot?
 *
 * Er is maar één Bitvavo-account. Wie LIVE_BOT (of BOTS) wisselt terwijl de vorige
 * live-bot nog posities had, laat die munten zonder bewaking achter: geen stop-loss,
 * geen verkoop bij het signaal, en de nieuwe live-bot ziet ze als "munten die de bot
 * niet beheert". main.ts weigert dan te starten met een duidelijke uitleg.
 */
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { BOTS_DIR } from "../config";
import { getProfile } from "./profiles";

export interface LiveLedger {
  file: string;
  /** Bot-id (map onder `bots/`), of null voor de enkele bot van vóór de wedstrijd (`<DATA_DIR>/state-live.json`) */
  botId: string | null;
  positions: number;
  /** Kooporders en verkopen met onbekende uitkomst */
  unknown: number;
  /** Het bestand kon niet gelezen worden: dan weten we het niet zeker */
  unreadable: boolean;
}

function countArray(v: unknown): number {
  return Array.isArray(v) ? v.length : 0;
}

/** Leest één live-toestandsbestand; null = geen bestand of niets open. */
export function readLiveLedger(file: string, botId: string | null): LiveLedger | null {
  if (!existsSync(file)) return null;
  let raw: unknown;
  try {
    raw = JSON.parse(readFileSync(file, "utf8"));
  } catch {
    return { file, botId, positions: 0, unknown: 0, unreadable: true };
  }
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
    return { file, botId, positions: 0, unknown: 0, unreadable: true };
  }
  const s = raw as Record<string, unknown>;
  const positions = countArray(s.positions);
  const unknown = countArray(s.unknownOrders) + countArray(s.unknownSells);
  if (positions === 0 && unknown === 0) return null;
  return { file, botId, positions, unknown, unreadable: false };
}

/**
 * Alle live-administraties onder `dataDir` met open posities of onbekende orders,
 * BEHALVE `ownStateFile` (die van de bot die nu live gaat): de oude enkele bot
 * (`<dataDir>/state-live.json`) en elke map onder `<dataDir>/bots/`.
 */
export function otherOpenLiveLedgers(dataDir: string, ownStateFile: string): LiveLedger[] {
  const own = resolve(ownStateFile);
  const candidates: { file: string; botId: string | null }[] = [{ file: join(dataDir, "state-live.json"), botId: null }];
  let dirs: string[] = [];
  try {
    dirs = readdirSync(join(dataDir, BOTS_DIR), { withFileTypes: true })
      .filter((d) => d.isDirectory())
      .map((d) => d.name)
      .sort();
  } catch {
    dirs = [];
  }
  for (const id of dirs) candidates.push({ file: join(dataDir, BOTS_DIR, id, "state-live.json"), botId: id });
  const out: LiveLedger[] = [];
  for (const c of candidates) {
    if (resolve(c.file) === own) continue;
    const ledger = readLiveLedger(c.file, c.botId);
    if (ledger) out.push(ledger);
  }
  return out;
}

/** Nederlandse uitleg (voor een StartupError) waarom de live-bot niet start. */
export function liveLedgerMessage(ledgers: readonly LiveLedger[], liveBotName: string): string {
  const parts = ledgers.map((l) => {
    const who = l.botId === null ? "de enkele bot van vóór de wedstrijd" : `bot "${getProfile(l.botId)?.name ?? l.botId}"`;
    if (l.unreadable) return `${who}: live-administratie onleesbaar (${l.file})`;
    const what: string[] = [];
    if (l.positions > 0) what.push(`${l.positions} open positie${l.positions === 1 ? "" : "s"}`);
    if (l.unknown > 0) what.push(`${l.unknown} order${l.unknown === 1 ? "" : "s"} met onbekende uitkomst`);
    return `${who}: ${what.join(" en ")} met echt geld (${l.file})`;
  });
  const back: string[] = [];
  if (ledgers.some((l) => l.botId === null)) back.push("BOTS=allround (één bot: die gebruikt de oude bestanden weer)");
  for (const l of ledgers) if (l.botId !== null) back.push(`LIVE_BOT=${l.botId} (met ${l.botId} in BOTS)`);
  return (
    `${liveBotName} kan niet live starten: er staan nog live-posities van een andere bot — ${parts.join("; ")}. ` +
    "Als nu een andere bot live handelt, bewaakt niemand die posities meer (geen stop-loss). " +
    `Zet eerst ${back.join(" of ")} terug in .env, sluit de posities in het dashboard en wissel daarna. ` +
    "Heb je ze zelf op Bitvavo verkocht? Verplaats dan dat bestand naar een andere map en start opnieuw."
  );
}
