/**
 * Minimale router + helpers voor JSON-verzoeken en -antwoorden (node:http).
 */
import type { IncomingMessage, ServerResponse } from "node:http";

export class HttpError extends Error {
  constructor(
    public readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = "HttpError";
  }
}

export const MAX_BODY_BYTES = 1024 * 1024;

export interface RequestContext {
  req: IncomingMessage;
  res: ServerResponse;
  url: URL;
  query: URLSearchParams;
  params: Record<string, string>;
  /** Geparste JSON-body (undefined als er geen body is) */
  body: () => Promise<unknown>;
}

/**
 * Een handler geeft een waarde terug die als JSON (200) verstuurd wordt, of
 * `undefined` als hij het antwoord zelf al heeft afgehandeld (bijv. SSE).
 */
export type RouteHandler = (ctx: RequestContext) => unknown | Promise<unknown>;

interface Route {
  method: string;
  segments: string[];
  handler: RouteHandler;
}

export type RouteMatch =
  | { kind: "match"; handler: RouteHandler; params: Record<string, string> }
  | { kind: "method-not-allowed"; allow: string[] }
  | { kind: "not-found" };

function split(path: string): string[] {
  return path.split("/").filter((s) => s.length > 0);
}

export class Router {
  private readonly routes: Route[] = [];

  add(method: string, path: string, handler: RouteHandler): this {
    this.routes.push({ method: method.toUpperCase(), segments: split(path), handler });
    return this;
  }
  get(path: string, handler: RouteHandler): this {
    return this.add("GET", path, handler);
  }
  post(path: string, handler: RouteHandler): this {
    return this.add("POST", path, handler);
  }
  put(path: string, handler: RouteHandler): this {
    return this.add("PUT", path, handler);
  }

  match(method: string, pathname: string): RouteMatch {
    const parts = split(pathname);
    const allow = new Set<string>();
    for (const route of this.routes) {
      if (route.segments.length !== parts.length) continue;
      const params: Record<string, string> = {};
      let ok = true;
      for (let i = 0; i < parts.length; i++) {
        const seg = route.segments[i];
        if (seg.startsWith(":")) {
          let value: string;
          try {
            value = decodeURIComponent(parts[i]);
          } catch {
            ok = false;
            break;
          }
          params[seg.slice(1)] = value;
        } else if (seg !== parts[i]) {
          ok = false;
          break;
        }
      }
      if (!ok) continue;
      const m = method.toUpperCase();
      if (route.method === m || (m === "HEAD" && route.method === "GET")) {
        return { kind: "match", handler: route.handler, params };
      }
      allow.add(route.method);
    }
    if (allow.size > 0) return { kind: "method-not-allowed", allow: [...allow] };
    return { kind: "not-found" };
  }
}

export function sendJson(res: ServerResponse, status: number, data: unknown): void {
  if (res.headersSent) {
    if (!res.writableEnded) res.end();
    return;
  }
  const body = JSON.stringify(data, (_k, v) => (typeof v === "number" && !Number.isFinite(v) ? null : v));
  res.statusCode = status;
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.setHeader("Cache-Control", "no-store");
  res.setHeader("Content-Length", Buffer.byteLength(body));
  res.end(res.req?.method === "HEAD" ? undefined : body);
}

export function sendError(res: ServerResponse, status: number, message: string): void {
  sendJson(res, status, { error: message });
}

/** Leest een JSON-body (max 1MB). Lege body → undefined. */
export async function readJsonBody(req: IncomingMessage, limit = MAX_BODY_BYTES): Promise<unknown> {
  const declared = Number(req.headers["content-length"] ?? "0");
  if (Number.isFinite(declared) && declared > limit) {
    req.resume();
    throw new HttpError(413, "Verzoek te groot (maximaal 1 MB).");
  }
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req) {
    const buf = typeof chunk === "string" ? Buffer.from(chunk) : (chunk as Buffer);
    size += buf.length;
    if (size > limit) {
      req.resume();
      throw new HttpError(413, "Verzoek te groot (maximaal 1 MB).");
    }
    chunks.push(buf);
  }
  if (size === 0) return undefined;
  const text = Buffer.concat(chunks).toString("utf8").trim();
  if (text === "") return undefined;
  const type = String(req.headers["content-type"] ?? "").toLowerCase();
  if (!type.startsWith("application/json")) {
    throw new HttpError(415, "Stuur de gegevens als JSON (Content-Type: application/json).");
  }
  try {
    return JSON.parse(text);
  } catch {
    throw new HttpError(400, "Ongeldige JSON in het verzoek.");
  }
}
