/**
 * Statische bestanden uit public/ plus /vendor/lightweight-charts.js.
 * Beschermd tegen directory traversal.
 */
import { createReadStream, existsSync } from "node:fs";
import { stat } from "node:fs/promises";
import type { IncomingMessage, ServerResponse } from "node:http";
import { createRequire } from "node:module";
import { dirname, extname, join, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

export const DEFAULT_PUBLIC_DIR = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..", "public");

const CONTENT_TYPES: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".htm": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".map": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".webp": "image/webp",
  ".ico": "image/x-icon",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
  ".ttf": "font/ttf",
  ".txt": "text/plain; charset=utf-8",
  ".webmanifest": "application/manifest+json",
};

export function contentTypeFor(file: string): string {
  return CONTENT_TYPES[extname(file).toLowerCase()] ?? "application/octet-stream";
}

/** Zoekt het standalone-bestand van lightweight-charts, onafhankelijk van de werkmap. */
export function resolveLightweightCharts(): string | null {
  const rel = join("dist", "lightweight-charts.standalone.production.js");
  try {
    const require = createRequire(import.meta.url);
    const pkg = require.resolve("lightweight-charts/package.json");
    const file = join(dirname(pkg), rel);
    if (existsSync(file)) return file;
  } catch {
    /* val terug op het pad in de projectmap */
  }
  const fallback = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..", "node_modules", "lightweight-charts", rel);
  return existsSync(fallback) ? fallback : null;
}

/**
 * Zet een URL-pad om naar een bestand binnen `root`, of null als het pad
 * ongeldig is of buiten `root` valt.
 */
export function safeResolve(root: string, pathname: string): string | null {
  let decoded: string;
  try {
    decoded = decodeURIComponent(pathname);
  } catch {
    return null;
  }
  if (decoded.includes("\0") || decoded.includes("\\")) return null;
  const rootAbs = resolve(root);
  const target = resolve(rootAbs, "." + (decoded.startsWith("/") ? decoded : "/" + decoded));
  if (target !== rootAbs && !target.startsWith(rootAbs + sep)) return null;
  // Geen verborgen bestanden (.env, .git, ...)
  const relParts = target.slice(rootAbs.length).split(sep).filter(Boolean);
  if (relParts.some((p) => p.startsWith("."))) return null;
  return target;
}

export async function sendFile(
  req: IncomingMessage,
  res: ServerResponse,
  file: string,
  opts: { cacheControl?: string } = {},
): Promise<boolean> {
  let info;
  try {
    info = await stat(file);
  } catch {
    return false;
  }
  if (!info.isFile()) return false;
  res.statusCode = 200;
  res.setHeader("Content-Type", contentTypeFor(file));
  res.setHeader("Content-Length", info.size);
  res.setHeader("Last-Modified", info.mtime.toUTCString());
  res.setHeader("Cache-Control", opts.cacheControl ?? "no-cache");
  if (req.method === "HEAD") {
    res.end();
    return true;
  }
  await new Promise<void>((resolveDone) => {
    const stream = createReadStream(file);
    stream.on("error", () => {
      if (!res.headersSent) res.statusCode = 500;
      res.destroy();
      resolveDone();
    });
    stream.on("end", () => resolveDone());
    res.on("close", () => {
      stream.destroy();
      resolveDone();
    });
    stream.pipe(res);
  });
  return true;
}

/**
 * Serveert een statisch bestand. Geeft false terug als er niets gevonden is
 * (de caller stuurt dan een 404).
 */
export async function serveStatic(
  req: IncomingMessage,
  res: ServerResponse,
  pathname: string,
  opts: { publicDir: string; vendorFile: string | null },
): Promise<boolean | "forbidden"> {
  if (pathname === "/vendor/lightweight-charts.js") {
    if (!opts.vendorFile) return false;
    return sendFile(req, res, opts.vendorFile, { cacheControl: "public, max-age=86400" });
  }
  const rel = pathname === "/" || pathname === "" ? "/index.html" : pathname;
  const file = safeResolve(opts.publicDir, rel);
  if (!file) return "forbidden";
  if (await sendFile(req, res, file)) return true;
  // Map opgevraagd? Probeer index.html daarin.
  if (rel.endsWith("/")) {
    const idx = safeResolve(opts.publicDir, rel + "index.html");
    if (idx && (await sendFile(req, res, idx))) return true;
  }
  return false;
}
