/**
 * StateStore: bewaart de engine-staat (account, posities, trades, equity) als
 * JSON op schijf.
 *
 * - `load()` geeft de opgeslagen staat terug of `null`. Een kapot/ongeldig
 *   bestand wordt hernoemd naar `<bestand>.corrupt-<timestamp>` zodat het niet
 *   verloren gaat, en daarna wordt `null` teruggegeven (verse start). Wat er
 *   mis was staat in `lastLoadProblem`, zodat de engine het kan melden.
 * - Is het bestand er wel maar onleesbaar (rechten, I/O-fout), of lukt het
 *   hernoemen niet, dan wordt schrijven GEBLOKKEERD tot `unblockWrites()`:
 *   anders zou een lege administratie het (mogelijk goede) bestand overschrijven.
 * - `save()` is gedebounced (~500 ms, "trailing throttle": de LAATSTE staat
 *   wordt geschreven, ook bij voortdurende saves).
 * - `flush()` schrijft een eventueel openstaande save direct (synchroon).
 * - Schrijven is atomair: eerst naar een tijdelijk bestand (met fsync), dan `rename`.
 */
import {
  closeSync,
  existsSync,
  fsyncSync,
  mkdirSync,
  openSync,
  readFileSync,
  renameSync,
  rmSync,
  writeSync,
} from "node:fs";
import { dirname } from "node:path";
import type { PersistedState } from "../core/types";

export interface StateStoreOptions {
  /** Debounce-tijd voor `save()` in ms (standaard 500) */
  debounceMs?: number;
  /** Klok (voor de naam van het .corrupt-bestand) */
  now?: () => number;
}

/** Waarom `load()` geen bruikbare staat opleverde terwijl er wel een bestand was. */
export interface LoadProblem {
  reason: string;
  /** Waar het kapotte bestand bewaard is (als hernoemen lukte) */
  quarantinedTo?: string;
}

export class StateStore {
  readonly filePath: string;
  private readonly debounceMs: number;
  private readonly now: () => number;
  private pending: PersistedState | null = null;
  private timer: ReturnType<typeof setTimeout> | null = null;
  /** Laatste schrijffout (null als de laatste write lukte) */
  lastError: Error | null = null;
  /** Probleem bij de laatste `load()` (null = geen bestand of alles in orde) */
  lastLoadProblem: LoadProblem | null = null;
  private writeBlocked = false;

  constructor(filePath: string, opts: StateStoreOptions = {}) {
    this.filePath = filePath;
    this.debounceMs = Math.max(0, opts.debounceMs ?? 500);
    this.now = opts.now ?? (() => Date.now());
  }

  load(): PersistedState | null {
    this.lastLoadProblem = null;
    if (!existsSync(this.filePath)) return null;
    let raw: string;
    try {
      raw = readFileSync(this.filePath, "utf8");
    } catch (err) {
      // Onleesbaar (rechten o.i.d.): niet hernoemen, en ook NIET overschrijven
      // met een lege administratie tot de gebruiker het bevestigd heeft.
      this.writeBlocked = true;
      this.lastLoadProblem = { reason: `bestand kon niet gelezen worden (${errText(err)})` };
      return null;
    }
    let reason: string;
    try {
      if (raw.trim() === "") throw new Error("bestand is leeg");
      let parsed: unknown;
      try {
        parsed = JSON.parse(raw);
      } catch (err) {
        throw new Error(`geen geldige JSON (${errText(err)})`);
      }
      if (!isPersistedState(parsed)) throw new Error("onbekende structuur of versie");
      return parsed;
    } catch (err) {
      reason = errText(err);
    }
    const quarantinedTo = this.quarantine();
    // Hernoemen mislukt: het kapotte bestand niet stilletjes overschrijven.
    if (!quarantinedTo) this.writeBlocked = true;
    this.lastLoadProblem = quarantinedTo ? { reason, quarantinedTo } : { reason };
    return null;
  }

  /** True zolang schrijven geblokkeerd is (zie `unblockWrites`). */
  get writesBlocked(): boolean {
    return this.writeBlocked;
  }

  /** Na bevestiging door de gebruiker: het bestaande bestand mag overschreven worden. */
  unblockWrites(): void {
    this.writeBlocked = false;
  }

  save(state: PersistedState): void {
    this.pending = state;
    if (this.timer) return;
    this.timer = setTimeout(() => {
      this.timer = null;
      try {
        this.flush();
      } catch {
        // lastError is gezet; volgende save probeert het opnieuw
      }
    }, this.debounceMs);
  }

  /** Schrijft een openstaande save nu (synchroon). Gooit bij een schrijffout. */
  flush(): void {
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
    const state = this.pending;
    if (!state) return;
    if (this.writeBlocked) {
      // Staat vasthouden; pas schrijven na `unblockWrites()`.
      this.lastError = new Error(
        `Opslaan geblokkeerd: het bestaande statusbestand (${this.filePath}) kon niet gelezen worden en wordt niet overschreven`,
      );
      throw this.lastError;
    }
    this.pending = null;
    try {
      this.writeAtomic(state);
      this.lastError = null;
    } catch (err) {
      this.lastError = err instanceof Error ? err : new Error(String(err));
      // Niet kwijtraken: bij de volgende save/flush opnieuw proberen.
      if (!this.pending) this.pending = state;
      throw this.lastError;
    }
  }

  /** True als er nog een save wacht om geschreven te worden. */
  get hasPending(): boolean {
    return this.pending !== null;
  }

  private writeAtomic(state: PersistedState): void {
    mkdirSync(dirname(this.filePath), { recursive: true });
    const tmp = `${this.filePath}.tmp-${process.pid}`;
    try {
      const fd = openSync(tmp, "w");
      try {
        writeSync(fd, JSON.stringify(state));
        fsyncSync(fd);
      } finally {
        closeSync(fd);
      }
      renameSync(tmp, this.filePath);
    } catch (err) {
      try {
        rmSync(tmp, { force: true });
      } catch {
        // negeren
      }
      throw err;
    }
    // Best effort: ook de map-entry (rename) naar schijf, zodat een stroomstoring
    // niet het oude bestand terugzet. Op Windows kan een map niet geopend worden.
    if (process.platform !== "win32") {
      try {
        const d = openSync(dirname(this.filePath), "r");
        try {
          fsyncSync(d);
        } finally {
          closeSync(d);
        }
      } catch {
        // negeren
      }
    }
  }

  /** Hernoemt het kapotte bestand; geeft het nieuwe pad terug of null als dat niet lukte. */
  private quarantine(): string | null {
    const target = `${this.filePath}.corrupt-${this.now()}`;
    try {
      renameSync(this.filePath, target);
      return target;
    } catch {
      return null;
    }
  }
}

function errText(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

function isObj(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function isNum(v: unknown): v is number {
  return typeof v === "number" && Number.isFinite(v);
}

/** Structurele controle: genoeg om de engine veilig te laten herstellen. */
export function isPersistedState(v: unknown): v is PersistedState {
  if (!isObj(v)) return false;
  if (v.version !== 1) return false;
  if (v.mode !== "paper" && v.mode !== "live") return false;
  if (!isObj(v.account)) return false;
  const a = v.account;
  if (!isNum(a.cashQuote) || !isNum(a.startingEquity)) return false;
  if (!Array.isArray(v.positions) || !Array.isArray(v.trades) || !Array.isArray(v.equityHistory)) return false;
  if (v.paperBalances !== undefined && !Array.isArray(v.paperBalances)) return false;
  return true;
}
