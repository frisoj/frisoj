/**
 * StateStore: bewaart de engine-staat (account, posities, trades, equity) als
 * JSON op schijf.
 *
 * - `load()` geeft de opgeslagen staat terug of `null`. Een kapot/ongeldig
 *   bestand wordt hernoemd naar `<bestand>.corrupt-<timestamp>` zodat het niet
 *   verloren gaat, en daarna wordt `null` teruggegeven (verse start).
 * - `save()` is gedebounced (~500 ms, "trailing throttle": de LAATSTE staat
 *   wordt geschreven, ook bij voortdurende saves).
 * - `flush()` schrijft een eventueel openstaande save direct (synchroon).
 * - Schrijven is atomair: eerst naar een tijdelijk bestand, dan `rename`.
 */
import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import type { PersistedState } from "../core/types";

export interface StateStoreOptions {
  /** Debounce-tijd voor `save()` in ms (standaard 500) */
  debounceMs?: number;
  /** Klok (voor de naam van het .corrupt-bestand) */
  now?: () => number;
}

export class StateStore {
  readonly filePath: string;
  private readonly debounceMs: number;
  private readonly now: () => number;
  private pending: PersistedState | null = null;
  private timer: ReturnType<typeof setTimeout> | null = null;
  /** Laatste schrijffout (null als de laatste write lukte) */
  lastError: Error | null = null;

  constructor(filePath: string, opts: StateStoreOptions = {}) {
    this.filePath = filePath;
    this.debounceMs = Math.max(0, opts.debounceMs ?? 500);
    this.now = opts.now ?? (() => Date.now());
  }

  load(): PersistedState | null {
    if (!existsSync(this.filePath)) return null;
    let raw: string;
    try {
      raw = readFileSync(this.filePath, "utf8");
    } catch {
      // Onleesbaar (rechten o.i.d.): niet hernoemen, gewoon vers beginnen.
      return null;
    }
    try {
      const parsed: unknown = JSON.parse(raw);
      if (!isPersistedState(parsed)) throw new Error("Ongeldige staat");
      return parsed;
    } catch {
      this.quarantine();
      return null;
    }
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
      writeFileSync(tmp, JSON.stringify(state), "utf8");
      renameSync(tmp, this.filePath);
    } catch (err) {
      try {
        rmSync(tmp, { force: true });
      } catch {
        // negeren
      }
      throw err;
    }
  }

  private quarantine(): void {
    const target = `${this.filePath}.corrupt-${this.now()}`;
    try {
      renameSync(this.filePath, target);
    } catch {
      // Als hernoemen niet lukt, laten we het bestand staan; de volgende save overschrijft het.
    }
  }
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
