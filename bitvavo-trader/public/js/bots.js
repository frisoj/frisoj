// Meerdere bots (v3, "Bot-wedstrijd"): gedeelde, pure hulpjes (geen DOM) voor de
// botwisselaar in de kopbalk (header.js) en het tabblad Wedstrijd (panels/compete.js).

import { baseBotId } from "./api.js";

const str = (v) => (typeof v === "string" ? v.trim() : "");

/** Reservekleuren als de server geen geldige kleur meestuurt (volgorde = positie in de lijst) */
export const FALLBACK_COLORS = ["#e0a23a", "#3987e5", "#9b6ddf", "#2fb67c", "#e05a7a", "#3fb8c9", "#c9c14a", "#8a94a8"];

/**
 * Kleur van een bot, veilig voor een style-attribuut: alleen #rgb of #rrggbb.
 * Anders een reservekleur op basis van de positie in de lijst.
 */
export function safeColor(color, index = 0) {
  const c = str(color);
  if (/^#(?:[0-9a-f]{3}|[0-9a-f]{6})$/i.test(c)) return c.toLowerCase();
  const i = Number.isInteger(index) && index >= 0 ? index : 0;
  return FALLBACK_COLORS[i % FALLBACK_COLORS.length];
}

const SAFE_ID = /^[A-Za-z0-9_-]+$/;

/**
 * Pad naar het eigen dashboard van een bot: `/bot/<id>/` (plus `#tab`).
 * Gebruikt `bot.path` van de server als dat precies die vorm heeft.
 */
export function botHref(bot, tab = "") {
  const id = str(bot && bot.id);
  const path = str(bot && bot.path);
  let href;
  if (/^\/bot\/[A-Za-z0-9_-]+\/$/.test(path)) href = path;
  else if (SAFE_ID.test(id)) href = `/bot/${id}/`;
  else href = `/bot/${encodeURIComponent(id)}/`;
  const t = str(tab).replace(/^#/, "");
  return t ? `${href}#${encodeURIComponent(t)}` : href;
}

/**
 * Antwoord van GET /api/bots → schone lijst (null als het geen lijst is).
 * Houdt de volgorde van de server (BOTS), laat items zonder id en dubbele ids weg,
 * vult naam / korte naam aan en maakt de kleur veilig.
 */
export function normalizeBots(raw) {
  const list = Array.isArray(raw) ? raw : raw && typeof raw === "object" && Array.isArray(raw.bots) ? raw.bots : null;
  if (!list) return null;
  const seen = new Set();
  const out = [];
  for (const b of list) {
    const id = b && typeof b === "object" ? str(b.id) : "";
    if (!id || seen.has(id)) continue;
    seen.add(id);
    const name = str(b.name) || str(b.short) || id;
    out.push({
      ...b,
      id,
      name,
      short: str(b.short) || name,
      description: str(b.description),
      color: safeColor(b.color, out.length),
      href: botHref(b),
    });
  }
  return out;
}

/**
 * Welke bot dit dashboard toont: de id uit het pad (/bot/<id>/), anders de bot uit
 * GET /api/info (`info.bot`, de standaardbot op de root), anders de eerste uit de lijst.
 */
export function currentBotId(bots, info, pathname) {
  const fromPath = baseBotId(pathname);
  if (fromPath) return fromPath;
  const id = info && info.bot && typeof info.bot === "object" ? str(info.bot.id) : "";
  if (id) return id;
  return Array.isArray(bots) && bots[0] && typeof bots[0].id === "string" ? bots[0].id : "";
}
