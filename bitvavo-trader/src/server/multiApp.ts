/**
 * Eén HTTP-server voor meerdere bots (v3, bot-wedstrijd). Elke bot heeft zijn eigen
 * app (createApp: router, SSE, beveiliging); deze laag kiest alleen welke:
 *
 * - `/api/...`           → de standaardbot (de eerste): precies zoals met één bot.
 * - `/bot/<id>/api/...`  → de app van die bot, met `/bot/<id>` van `req.url` af. Alle
 *                          controles (Host, token, andere websites, body-limiet) lopen
 *                          dus ongewijzigd in die app.
 * - `/bot/<id>/`, `/bot/<id>/index.html` (en andere bestanden onder `/bot/<id>/`)
 *                        → idem zonder voorvoegsel: het dashboard uit public/ (de
 *                          bestanden gebruiken absolute paden, dus laden vanaf `/`).
 * - `/bot/<id>`          → 301 naar `/bot/<id>/`.
 * - `/bot/<onbekend>…`   → 404 "Onbekende bot".
 * - al het andere        → de standaardbot (statische bestanden, 404, …).
 *
 * Wat deze laag zelf beantwoordt (301, 404) gaat eerst door dezelfde controles
 * (`guardRequest`) als elk ander verzoek.
 */
import type { IncomingMessage, ServerResponse } from "node:http";
import type { AppConfig } from "../config";
import type { AppInfo, Trade } from "../core/types";
import { summarize, type SummaryProfile } from "../bots/summary";
import { guardRequest, parseRequestUrl, type App } from "./httpServer";
import { HttpError, sendError } from "./router";
import type { BotEntry, EngineLike } from "./routes";

export interface MultiAppBot {
  id: string;
  app: App;
  /** De engine; `allTrades()` (TradingEngine) maakt de statistiek over alle bewaarde trades mogelijk. */
  engine: EngineLike & { allTrades?(): Trade[] };
  profile: SummaryProfile;
  /** De config waarmee de app van deze bot gebouwd is (host en token zijn voor alle bots gelijk). */
  config: Pick<AppConfig, "host" | "dashboardToken">;
}

export interface MultiAppOptions {
  bots: readonly MultiAppBot[];
  /** Bot voor `/api/...` en `/` (standaard de eerste) */
  defaultId?: string;
  log?: (level: "info" | "warn" | "error", msg: string) => void;
}

/** Pad van het eigen dashboard van een bot. */
export function botPath(id: string): string {
  return `/bot/${id}/`;
}

/** `AppInfo.bot` van een bot. */
export function botInfo(profile: SummaryProfile): NonNullable<AppInfo["bot"]> {
  return { id: profile.id, name: profile.name, short: profile.short, color: profile.color };
}

/** De bots voor `ApiDeps.bots` (samenvatting + acties), in dezelfde volgorde. */
export function botEntries(bots: readonly MultiAppBot[]): BotEntry[] {
  return bots.map((b) => ({
    id: b.id,
    engine: b.engine,
    summary: () =>
      summarize(b.engine.snapshot(), b.profile, {
        ...(typeof b.engine.allTrades === "function" ? { allTrades: b.engine.allTrades() } : {}),
        path: botPath(b.id),
      }),
  }));
}

/** `/bot`, `/bot/<id>` of `/bot/<id>/<rest>` (id zonder `/`). */
const BOT_PATH_RE = /^\/bot(?:\/([^/]*))?(\/.*)?$/;

export function createMultiApp(opts: MultiAppOptions): App {
  const bots = [...opts.bots];
  if (bots.length === 0) throw new Error("createMultiApp: geen bots");
  const byId = new Map<string, MultiAppBot>();
  for (const b of bots) {
    if (byId.has(b.id)) throw new Error(`createMultiApp: bot-id "${b.id}" komt dubbel voor`);
    byId.set(b.id, b);
  }
  const def = (opts.defaultId !== undefined ? byId.get(opts.defaultId) : undefined) ?? bots[0];
  const log =
    opts.log ?? ((level: "info" | "warn" | "error", msg: string) => (level === "error" ? console.error(msg) : console.log(msg)));
  const known = () => [...byId.keys()].join(", ");

  /** Antwoorden die deze laag zelf geeft: 301 naar `/bot/<id>/` of 404 "Onbekende bot". */
  function answer(req: IncomingMessage, res: ServerResponse, url: URL, bot: MultiAppBot | undefined, rest: string | undefined) {
    // Zelfde controles als in de app (Host, andere websites, token) — met het pad zoals de
    // bot-app het zou zien, dus /bot/<onbekend>/api/… vraagt ook om de token.
    guardRequest(req, res, url, rest ?? "/", def.config);
    if (!bot) throw new HttpError(404, `Onbekende bot. Bekende bots: ${known()}.`);
    const method = (req.method ?? "GET").toUpperCase();
    if (method !== "GET" && method !== "HEAD") {
      res.setHeader("Allow", "GET, HEAD");
      throw new HttpError(405, "Methode niet toegestaan.");
    }
    res.statusCode = 301;
    res.setHeader("Location", `${botPath(bot.id)}${url.search}`);
    res.setHeader("Content-Length", "0");
    res.end();
  }

  function handle(req: IncomingMessage, res: ServerResponse): void {
    let url: URL;
    try {
      url = parseRequestUrl(req.url);
    } catch {
      def.app.handle(req, res); // die geeft de 400 "Ongeldige URL" (met beveiligingsheaders)
      return;
    }
    const m = BOT_PATH_RE.exec(url.pathname);
    if (!m) {
      def.app.handle(req, res);
      return;
    }
    const id = m[1];
    const rest = m[2];
    const bot = id ? byId.get(id) : undefined;
    if (bot && rest !== undefined) {
      // Voorvoegsel eraf; de app van de bot doet alle controles zelf.
      req.url = `${rest}${url.search}`;
      bot.app.handle(req, res);
      return;
    }
    try {
      answer(req, res, url, bot, rest);
    } catch (err) {
      if (err instanceof HttpError) {
        if (!res.headersSent) sendError(res, err.status, err.message);
        else if (!res.writableEnded) res.end();
        return;
      }
      const msg = err instanceof Error ? err.message : String(err);
      log("error", `✖ Fout bij ${req.method} ${req.url}: ${msg}`);
      if (!res.headersSent) sendError(res, 500, `Interne fout: ${msg}`);
      else if (!res.writableEnded) res.end();
    }
  }

  return {
    handle,
    hub: def.app.hub,
    router: def.app.router,
    dispose: () => {
      for (const b of bots) {
        try {
          b.app.dispose();
        } catch {
          // de andere bots toch netjes afsluiten
        }
      }
    },
  };
}
