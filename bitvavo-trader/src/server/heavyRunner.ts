/**
 * Voert zware, CPU-gebonden berekeningen (backtest, optimalisatie,
 * walk-forward) uit in een worker-thread. Op de hoofdthread zouden ze de
 * event-loop seconden lang blokkeren: dan lopen er geen ticks, geen
 * stop-loss-controles, geen LiveBroker-polling, geen SSE en reageert zelfs de
 * noodstop niet. Een geblokkeerde loop kan bovendien een order die wél gelukt
 * is als "time-out, uitkomst onbekend" laten eindigen.
 *
 * Eén worker wordt hergebruikt (de routes laten maar één berekening tegelijk
 * toe). Bij een time-out wordt de worker hard beëindigd en de volgende keer
 * opnieuw gestart.
 */
import { Worker } from "node:worker_threads";
import { HttpError } from "./router";

export type HeavyKind = "backtest" | "optimize" | "walkForward";

export interface HeavyRequest {
  id: number;
  kind: string;
  input: unknown;
  opts?: unknown;
}

export type HeavyResponse =
  | { id: number; ok: true; result: unknown }
  | { id: number; ok: false; error: { name?: string; message: string } };

/** Harde bovengrens per berekening. */
export const HEAVY_TIMEOUT_MS = 120_000;
/** Heap-limiet van de worker: bij geheugengebrek stopt alleen de worker, niet de bot. */
export const HEAVY_MAX_HEAP_MB = 1024;
export const DEFAULT_HEAVY_WORKER_URL = new URL("./heavyWorker.mjs", import.meta.url);

export interface HeavyRunnerOptions {
  timeoutMs?: number;
  /** Worker-entry (standaard heavyWorker.mjs; tests geven een eigen worker) */
  workerUrl?: URL;
  maxHeapMb?: number;
  log?: (msg: string) => void;
}

interface Pending {
  worker: Worker;
  resolve: (v: unknown) => void;
  reject: (e: Error) => void;
  timer: NodeJS.Timeout;
}

export class HeavyRunner {
  private worker: Worker | null = null;
  private readonly pending = new Map<number, Pending>();
  private nextId = 1;
  private closed = false;
  private readonly log: (msg: string) => void;

  constructor(private readonly opts: HeavyRunnerOptions = {}) {
    this.log = opts.log ?? ((m) => console.warn(m));
  }

  /** Aantal lopende berekeningen (voor tests/diagnose). */
  get busy(): number {
    return this.pending.size;
  }

  run<T>(kind: HeavyKind | string, input: unknown, opts?: unknown): Promise<T> {
    if (this.closed) {
      return Promise.reject(new HttpError(503, "De server wordt afgesloten; de berekening is niet gestart."));
    }
    let worker: Worker;
    try {
      worker = this.ensureWorker();
    } catch (err) {
      return Promise.reject(new Error(`Kon de rekenwerker niet starten: ${(err as Error).message}`));
    }
    const id = this.nextId++;
    const timeoutMs = this.opts.timeoutMs ?? HEAVY_TIMEOUT_MS;
    return new Promise<T>((resolve, reject) => {
      const timer = setTimeout(() => {
        if (!this.pending.has(id)) return;
        this.pending.delete(id);
        reject(
          new HttpError(
            503,
            `Berekening duurde te lang (meer dan ${Math.round(timeoutMs / 1000)} s) en is afgebroken. ` +
              "Kies minder dagen, een groter interval of minder combinaties.",
          ),
        );
        this.stopWorker(worker, new HttpError(503, "Berekening afgebroken."));
      }, timeoutMs);
      timer.unref?.();
      this.pending.set(id, { worker, resolve: resolve as (v: unknown) => void, reject, timer });
      worker.ref(); // houdt het proces in leven zolang er een job loopt
      try {
        const msg: HeavyRequest = { id, kind, input, opts };
        worker.postMessage(msg);
      } catch (err) {
        clearTimeout(timer);
        this.pending.delete(id);
        this.idleCheck(worker);
        reject(new Error(`Kon de berekening niet naar de rekenwerker sturen: ${(err as Error).message}`));
      }
    });
  }

  /** Beëindigt de worker; lopende berekeningen worden afgewezen. */
  async close(): Promise<void> {
    this.closed = true;
    const w = this.worker;
    if (w) await this.stopWorker(w, new HttpError(503, "De server wordt afgesloten; berekening afgebroken."));
  }

  private ensureWorker(): Worker {
    if (this.worker) return this.worker;
    const w = new Worker(this.opts.workerUrl ?? DEFAULT_HEAVY_WORKER_URL, {
      // De entry registreert zelf tsx; geen loader-flags van de hoofdthread erven.
      execArgv: [],
      resourceLimits: { maxOldGenerationSizeMb: this.opts.maxHeapMb ?? HEAVY_MAX_HEAP_MB },
    });
    w.unref(); // een wachtende worker mag het afsluiten niet tegenhouden
    w.on("message", (msg: HeavyResponse) => this.onMessage(w, msg));
    w.on("error", (err: Error) => {
      this.log(`⚠ Rekenwerker gaf een fout: ${err.message}`);
      this.failAll(w, new Error(`Rekenwerker gaf een fout: ${err.message}`));
    });
    w.on("exit", (code: number) => {
      this.failAll(w, new Error(`Rekenwerker is onverwacht gestopt (code ${code}).`));
    });
    this.worker = w;
    return w;
  }

  private onMessage(w: Worker, msg: HeavyResponse): void {
    if (!msg || typeof msg !== "object" || typeof msg.id !== "number") return;
    const p = this.pending.get(msg.id);
    if (!p) return; // bijv. al afgebroken door een time-out
    clearTimeout(p.timer);
    this.pending.delete(msg.id);
    this.idleCheck(w);
    if (msg.ok) p.resolve(msg.result);
    else {
      const err = new Error(msg.error?.message ?? "Onbekende fout in de rekenwerker.");
      if (msg.error?.name) err.name = msg.error.name;
      p.reject(err);
    }
  }

  private idleCheck(w: Worker): void {
    for (const p of this.pending.values()) if (p.worker === w) return;
    w.unref();
  }

  private failAll(w: Worker, err: Error): void {
    if (this.worker === w) this.worker = null;
    for (const [id, p] of this.pending) {
      if (p.worker !== w) continue;
      clearTimeout(p.timer);
      this.pending.delete(id);
      p.reject(err);
    }
  }

  private async stopWorker(w: Worker, err: Error): Promise<void> {
    this.failAll(w, err);
    try {
      await w.terminate();
    } catch {
      // al gestopt
    }
  }
}
