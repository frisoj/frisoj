/**
 * Server-Sent Events hub: stuurt engine-events 1-op-1 door naar alle
 * verbonden dashboards (`event: <type>\ndata: <json>\n\n`).
 */
import type { IncomingMessage, ServerResponse } from "node:http";
import type { ServerEvent, ServerEventType } from "../core/types";

export const SERVER_EVENT_TYPES: readonly ServerEventType[] = [
  "snapshot",
  "price",
  "candle",
  "decision",
  "order",
  "position-opened",
  "position-closed",
  "log",
];

export interface SseHubOptions {
  /** Interval voor heartbeat-commentaar (ms), standaard 15s */
  heartbeatMs?: number;
  /** Minimale tijd tussen twee "snapshot"-events per client (ms), standaard 500 */
  snapshotMinIntervalMs?: number;
  /** Clients met meer dan dit aantal bytes in de schrijfbuffer worden losgekoppeld */
  maxBufferedBytes?: number;
  now?: () => number;
}

interface Client {
  id: number;
  res: ServerResponse;
  lastSnapshotAt: number;
  pendingSnapshot: string | null;
  snapshotTimer: NodeJS.Timeout | null;
  closed: boolean;
}

/** Minimale vorm van een event-bron (TradingEngine is een EventEmitter). */
export interface EventSourceLike {
  on(event: string, listener: (data: unknown) => void): unknown;
  off?(event: string, listener: (data: unknown) => void): unknown;
  removeListener?(event: string, listener: (data: unknown) => void): unknown;
}

function jsonReplacer(_key: string, value: unknown): unknown {
  return typeof value === "number" && !Number.isFinite(value) ? null : value;
}

export function formatSse(type: string, data: unknown): string {
  const json = JSON.stringify(data, jsonReplacer) ?? "null";
  // JSON.stringify bevat geen echte newlines, maar voor de zekerheid per regel prefixen
  const lines = json.split(/\r?\n/).map((l) => `data: ${l}`);
  return `event: ${type}\n${lines.join("\n")}\n\n`;
}

export class SseHub {
  private readonly clients = new Map<number, Client>();
  private nextId = 1;
  private heartbeat: NodeJS.Timeout | null = null;
  private readonly heartbeatMs: number;
  private readonly snapshotMinIntervalMs: number;
  private readonly maxBufferedBytes: number;
  private readonly now: () => number;

  constructor(opts: SseHubOptions = {}) {
    this.heartbeatMs = opts.heartbeatMs ?? 15_000;
    this.snapshotMinIntervalMs = opts.snapshotMinIntervalMs ?? 500;
    this.maxBufferedBytes = opts.maxBufferedBytes ?? 8 * 1024 * 1024;
    this.now = opts.now ?? Date.now;
  }

  get size(): number {
    return this.clients.size;
  }

  /**
   * Registreert een nieuwe SSE-verbinding. `initial` wordt direct verstuurd
   * (bijv. de huidige snapshot).
   */
  addClient(req: IncomingMessage, res: ServerResponse, initial: ServerEvent[] = []): number {
    const id = this.nextId++;
    res.statusCode = 200;
    res.setHeader("Content-Type", "text/event-stream; charset=utf-8");
    res.setHeader("Cache-Control", "no-cache, no-transform");
    res.setHeader("Connection", "keep-alive");
    res.setHeader("X-Accel-Buffering", "no");
    res.flushHeaders();
    req.socket.setKeepAlive?.(true);
    req.socket.setNoDelay?.(true);
    req.socket.setTimeout?.(0);

    const client: Client = { id, res, lastSnapshotAt: 0, pendingSnapshot: null, snapshotTimer: null, closed: false };
    this.clients.set(id, client);
    const onClose = () => this.removeClient(id);
    req.on("close", onClose);
    res.on("close", onClose);
    res.on("error", onClose);

    this.write(client, "retry: 3000\n\n");
    for (const ev of initial) this.sendTo(client, ev.type, ev.data);
    this.ensureHeartbeat();
    return id;
  }

  removeClient(id: number): void {
    const c = this.clients.get(id);
    if (!c) return;
    c.closed = true;
    if (c.snapshotTimer) clearTimeout(c.snapshotTimer);
    this.clients.delete(id);
    if (!c.res.writableEnded) {
      try {
        c.res.end();
      } catch {
        /* al dicht */
      }
    }
    if (this.clients.size === 0) this.stopHeartbeat();
  }

  /** Stuurt een event naar alle clients ("snapshot" wordt per client gethrottled). */
  broadcast(type: ServerEventType | string, data: unknown): void {
    if (this.clients.size === 0) return;
    const payload = formatSse(type, data);
    for (const c of this.clients.values()) this.deliver(c, type, payload);
  }

  send(type: ServerEventType, data: unknown): void {
    this.broadcast(type, data);
  }

  /** Koppelt alle ServerEvent-types van een engine aan deze hub; geeft een unsubscribe terug. */
  bridge(source: EventSourceLike, types: readonly string[] = SERVER_EVENT_TYPES): () => void {
    const listeners = types.map((type) => {
      const fn = (data: unknown) => this.broadcast(type, data);
      source.on(type, fn);
      return [type, fn] as const;
    });
    return () => {
      for (const [type, fn] of listeners) {
        if (source.off) source.off(type, fn);
        else source.removeListener?.(type, fn);
      }
    };
  }

  /** Sluit alle verbindingen en stopt de heartbeat. */
  close(): void {
    for (const id of [...this.clients.keys()]) this.removeClient(id);
    this.stopHeartbeat();
  }

  private sendTo(client: Client, type: string, data: unknown): void {
    this.deliver(client, type, formatSse(type, data));
  }

  private deliver(c: Client, type: string, payload: string): void {
    if (c.closed) return;
    if (type !== "snapshot") {
      this.write(c, payload);
      return;
    }
    const now = this.now();
    const wait = c.lastSnapshotAt + this.snapshotMinIntervalMs - now;
    if (wait <= 0 && !c.snapshotTimer) {
      c.lastSnapshotAt = now;
      this.write(c, payload);
      return;
    }
    // Throttle: bewaar alleen de nieuwste snapshot en stuur hem zodra het mag
    c.pendingSnapshot = payload;
    if (!c.snapshotTimer) {
      c.snapshotTimer = setTimeout(
        () => {
          c.snapshotTimer = null;
          const p = c.pendingSnapshot;
          c.pendingSnapshot = null;
          if (p && !c.closed) {
            c.lastSnapshotAt = this.now();
            this.write(c, p);
          }
        },
        Math.max(0, wait),
      );
      c.snapshotTimer.unref?.();
    }
  }

  private write(c: Client, chunk: string): void {
    if (c.closed || c.res.writableEnded || c.res.destroyed) {
      this.removeClient(c.id);
      return;
    }
    if (c.res.writableLength > this.maxBufferedBytes) {
      // Trage client: loskoppelen, EventSource verbindt vanzelf opnieuw
      this.removeClient(c.id);
      return;
    }
    try {
      c.res.write(chunk);
    } catch {
      this.removeClient(c.id);
    }
  }

  private ensureHeartbeat(): void {
    if (this.heartbeat) return;
    this.heartbeat = setInterval(() => {
      for (const c of [...this.clients.values()]) this.write(c, `: heartbeat ${this.now()}\n\n`);
    }, this.heartbeatMs);
    this.heartbeat.unref?.();
  }

  private stopHeartbeat(): void {
    if (this.heartbeat) clearInterval(this.heartbeat);
    this.heartbeat = null;
  }
}
