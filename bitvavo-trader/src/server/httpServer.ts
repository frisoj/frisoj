/**
 * HTTP-server (node:http): beveiligingsheaders, optionele token-authenticatie,
 * de API-router, SSE en statische bestanden voor het dashboard.
 */
import { createHash, timingSafeEqual } from "node:crypto";
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";
import type { AppInfo, EngineConfig, MarketDataFeed } from "../core/types";
import { saveEngineOverrides, type AppConfig } from "../config";
import { HttpError, readJsonBody, sendError, type Router } from "./router";
import { buildApiRouter, type EngineLike, type Services } from "./routes";
import type { Scanner } from "./scanner";
import { SseHub, type EventSourceLike } from "./sse";
import { DEFAULT_PUBLIC_DIR, resolveLightweightCharts, serveStatic } from "./static";

export interface CreateAppDeps {
  config: AppConfig;
  engine: EngineLike & Partial<EventSourceLike>;
  feed: MarketDataFeed;
  services: Services;
  /** Overschrijft (delen van) AppInfo */
  info?: () => AppInfo;
  hub?: SseHub;
  scanner?: Scanner;
  publicDir?: string;
  /** Pad naar lightweight-charts standalone (null = niet beschikbaar) */
  vendorFile?: string | null;
  persistConfig?: (cfg: EngineConfig) => void;
  now?: () => number;
  log?: (level: "info" | "warn" | "error", msg: string) => void;
}

export interface App {
  handle: (req: IncomingMessage, res: ServerResponse) => void;
  hub: SseHub;
  router: Router;
  /** Koppelt engine-events los en sluit alle SSE-verbindingen */
  dispose: () => void;
}

export const CONTENT_SECURITY_POLICY = [
  "default-src 'self'",
  "script-src 'self'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob:",
  "font-src 'self' data:",
  "connect-src 'self'",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "frame-ancestors 'none'",
].join("; ");

function setSecurityHeaders(res: ServerResponse): void {
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("Content-Security-Policy", CONTENT_SECURITY_POLICY);
  res.setHeader("Referrer-Policy", "no-referrer");
  res.setHeader("X-Frame-Options", "DENY");
  res.setHeader("Cross-Origin-Opener-Policy", "same-origin");
  res.setHeader("Cross-Origin-Resource-Policy", "same-origin");
}

const LOOPBACK_HOSTS = new Set(["127.0.0.1", "localhost", "::1", "[::1]"]);

export function isLoopbackHost(host: string): boolean {
  return LOOPBACK_HOSTS.has(host.toLowerCase()) || host.startsWith("127.");
}

/** Hostnaam uit een Host-header (zonder poort), ook voor IPv6 "[::1]:4321". */
export function hostnameOf(hostHeader: string): string {
  const h = hostHeader.trim().toLowerCase();
  if (h.startsWith("[")) {
    const end = h.indexOf("]");
    return end > 0 ? h.slice(0, end + 1) : h;
  }
  const colon = h.lastIndexOf(":");
  return colon > 0 ? h.slice(0, colon) : h;
}

function digest(s: string): Buffer {
  return createHash("sha256").update(s, "utf8").digest();
}

/** Vergelijkt twee tokens in constante tijd. */
export function tokensEqual(given: string, expected: string): boolean {
  return timingSafeEqual(digest(given), digest(expected));
}

export function createApp(deps: CreateAppDeps): App {
  const { config, engine } = deps;
  const hub = deps.hub ?? new SseHub();
  const log =
    deps.log ??
    ((level: "info" | "warn" | "error", msg: string) => (level === "error" ? console.error(msg) : console.log(msg)));
  const router = buildApiRouter({
    config,
    engine,
    feed: deps.feed,
    services: deps.services,
    hub,
    info: deps.info,
    scanner: deps.scanner,
    now: deps.now,
    log,
    persistConfig: deps.persistConfig ?? ((cfg) => saveEngineOverrides(config.dataDir, cfg)),
  });
  const publicDir = deps.publicDir ?? DEFAULT_PUBLIC_DIR;
  const vendorFile = deps.vendorFile === undefined ? resolveLightweightCharts() : deps.vendorFile;

  // Engine-events → SSE
  const unbridge = typeof engine.on === "function" ? hub.bridge(engine as EventSourceLike) : () => {};

  const token = config.dashboardToken;
  const checkHost = isLoopbackHost(config.host);

  async function handleInner(req: IncomingMessage, res: ServerResponse): Promise<void> {
    setSecurityHeaders(res);
    const method = (req.method ?? "GET").toUpperCase();
    let url: URL;
    try {
      url = new URL(req.url ?? "/", "http://localhost");
    } catch {
      throw new HttpError(400, "Ongeldige URL.");
    }
    const pathname = url.pathname;
    const isApi = pathname === "/api" || pathname.startsWith("/api/");

    // Bescherming tegen DNS-rebinding: bij binden op loopback alleen lokale Host-headers
    if (checkHost) {
      const hostHeader = req.headers.host;
      if (hostHeader && !isLoopbackHost(hostnameOf(hostHeader))) {
        throw new HttpError(403, "Toegang geweigerd: onbekende Host-header.");
      }
    }

    if (isApi) {
      res.setHeader("Cache-Control", "no-store");
      // CSRF: wijzigende verzoeken moeten van dezelfde origin komen
      if (method !== "GET" && method !== "HEAD" && method !== "OPTIONS") {
        const origin = req.headers.origin;
        if (origin && origin !== "null") {
          let originHost: string | null = null;
          try {
            originHost = new URL(origin).host.toLowerCase();
          } catch {
            originHost = null;
          }
          if (!originHost || originHost !== String(req.headers.host ?? "").toLowerCase()) {
            throw new HttpError(403, "Verzoek van een andere website geweigerd.");
          }
        } else if (origin === "null") {
          throw new HttpError(403, "Verzoek van een andere website geweigerd.");
        }
      }
      if (token) {
        const header = req.headers["x-dashboard-token"];
        let given = typeof header === "string" ? header : undefined;
        if (given === undefined && pathname === "/api/events") given = url.searchParams.get("token") ?? undefined;
        if (given === undefined || !tokensEqual(given, token)) {
          throw new HttpError(401, "Ongeldige of ontbrekende dashboard-token.");
        }
      }
      const match = router.match(method, pathname);
      if (match.kind === "not-found") throw new HttpError(404, `Onbekend API-pad: ${pathname}`);
      if (match.kind === "method-not-allowed") {
        res.setHeader("Allow", match.allow.join(", "));
        throw new HttpError(405, `Methode ${method} niet toegestaan voor ${pathname}.`);
      }
      let bodyPromise: Promise<unknown> | null = null;
      const result = await match.handler({
        req,
        res,
        url,
        query: url.searchParams,
        params: match.params,
        body: () => (bodyPromise ??= readJsonBody(req)),
      });
      if (result === undefined) {
        if (!res.headersSent && !res.writableEnded) sendJsonOk(res, null);
        return;
      }
      sendJsonOk(res, result);
      return;
    }

    if (method !== "GET" && method !== "HEAD") {
      res.setHeader("Allow", "GET, HEAD");
      throw new HttpError(405, "Methode niet toegestaan.");
    }
    const served = await serveStatic(req, res, pathname, { publicDir, vendorFile });
    if (served === "forbidden") throw new HttpError(403, "Toegang geweigerd.");
    if (!served) {
      if (pathname === "/vendor/lightweight-charts.js") {
        throw new HttpError(404, "lightweight-charts niet gevonden. Voer eerst 'npm install' uit.");
      }
      if (pathname === "/" || pathname === "/index.html") {
        throw new HttpError(404, "Dashboard niet gevonden (public/index.html ontbreekt).");
      }
      throw new HttpError(404, "Niet gevonden.");
    }
  }

  function sendJsonOk(res: ServerResponse, data: unknown): void {
    const body = JSON.stringify(data, (_k, v) => (typeof v === "number" && !Number.isFinite(v) ? null : v));
    res.statusCode = 200;
    res.setHeader("Content-Type", "application/json; charset=utf-8");
    res.setHeader("Content-Length", Buffer.byteLength(body ?? "null"));
    res.end(res.req?.method === "HEAD" ? undefined : (body ?? "null"));
  }

  function handle(req: IncomingMessage, res: ServerResponse): void {
    handleInner(req, res).catch((err: unknown) => {
      if (err instanceof HttpError) {
        if (err.status === 413) res.setHeader("Connection", "close");
        if (!res.headersSent) sendError(res, err.status, err.message);
        else if (!res.writableEnded) res.end();
        return;
      }
      const msg = err instanceof Error ? err.message : String(err);
      log("error", `✖ Fout bij ${req.method} ${req.url}: ${err instanceof Error && err.stack ? err.stack : msg}`);
      if (!res.headersSent) sendError(res, 500, `Interne fout: ${msg}`);
      else if (!res.writableEnded) res.end();
    });
  }

  return {
    handle,
    hub,
    router,
    dispose: () => {
      unbridge();
      hub.close();
    },
  };
}

export interface RunningServer {
  server: Server;
  app: App;
  port: number;
  host: string;
  url: string;
  close: () => Promise<void>;
}

/** Start de HTTP-server op host:port (port 0 = willekeurige vrije poort). */
export async function startHttpServer(app: App, host: string, port: number): Promise<RunningServer> {
  const server = createServer(app.handle);
  server.keepAliveTimeout = 5_000;
  server.headersTimeout = 30_000;
  server.requestTimeout = 0; // SSE-verbindingen blijven open; backtests kunnen lang duren
  await new Promise<void>((resolve, reject) => {
    const onError = (err: Error) => {
      server.off("listening", onListening);
      reject(err);
    };
    const onListening = () => {
      server.off("error", onError);
      resolve();
    };
    server.once("error", onError);
    server.once("listening", onListening);
    server.listen(port, host);
  });
  const addr = server.address() as AddressInfo;
  const displayHost = addr.family === "IPv6" || host.includes(":") ? `[${addr.address}]` : host;
  const url = `http://${displayHost}:${addr.port}`;
  let closing: Promise<void> | null = null;
  const close = () =>
    (closing ??= new Promise<void>((resolve) => {
      app.dispose();
      server.close(() => resolve());
      server.closeAllConnections?.();
    }));
  return { server, app, port: addr.port, host, url, close };
}
