#!/usr/bin/env node
// Static internal link + image checker.
//
// Walks app/, components/ and lib/blog-content/ for href="/..." and
// src="/..." references, then checks each against:
//   - known static routes (any app/**/page.tsx directory, translated to a
//     URL path, dynamic segments treated as wildcards)
//   - files that actually exist under public/
// Run with: node scripts/check-internal-links.mjs
//
// This is a build-time lint, not a live crawler — it can't detect a route
// that 404s only because of runtime data (e.g. a real-but-unpublished blog
// slug), but it catches typos, moved files and dangling asset references.
import { readFileSync, readdirSync, statSync, existsSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));

function walk(dir, exts, out = []) {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    const stat = statSync(full);
    if (stat.isDirectory()) {
      if (entry === "node_modules" || entry === ".next") continue;
      walk(full, exts, out);
    } else if (exts.some((ext) => entry.endsWith(ext))) {
      out.push(full);
    }
  }
  return out;
}

// --- Build the set of known app routes from the filesystem ---
function collectRoutes(dir, base = "") {
  const routes = new Set();
  let entries;
  try {
    entries = readdirSync(dir);
  } catch {
    return routes;
  }
  if (entries.includes("page.tsx") || entries.includes("page.ts")) {
    routes.add(base === "" ? "/" : base);
  }
  for (const entry of entries) {
    const full = join(dir, entry);
    if (!statSync(full).isDirectory()) continue;
    if (entry.startsWith("(") || entry.startsWith("_")) {
      // route group / private folder — doesn't affect the URL path
      for (const r of collectRoutes(full, base)) routes.add(r);
      continue;
    }
    const segment = entry.startsWith("[") ? "*" : entry;
    for (const r of collectRoutes(full, `${base}/${segment}`)) routes.add(r);
  }
  return routes;
}

function routeMatches(routes, path) {
  const normalized = path.split("?")[0].split("#")[0];
  if (routes.has(normalized)) return true;
  const parts = normalized.split("/");
  for (const route of routes) {
    const routeParts = route.split("/");
    if (routeParts.length !== parts.length) continue;
    if (routeParts.every((p, i) => p === "*" || p === parts[i])) return true;
  }
  return false;
}

function main() {
  const appDir = join(root, "app");
  const publicDir = join(root, "public");
  const routes = collectRoutes(appDir);

  const sourceFiles = [
    ...walk(join(root, "app"), [".tsx", ".ts"]),
    ...walk(join(root, "components"), [".tsx", ".ts"]),
    ...walk(join(root, "lib", "blog-content"), [".ts"]),
  ];

  const hrefRegex = /(?:href|src)=(?:"([^"]+)"|\{`([^`]+)`\})/g;
  const mdLinkRegex = /\]\((\/[a-z0-9\-/]*)\)/gi;

  const brokenLinks = [];
  const brokenImages = [];
  const externalOrDynamicSkipped = [];

  for (const file of sourceFiles) {
    const content = readFileSync(file, "utf8");
    const matches = [...content.matchAll(hrefRegex), ...content.matchAll(mdLinkRegex)];
    for (const match of matches) {
      const value = match[1] ?? match[2];
      if (!value || !value.startsWith("/")) continue;
      if (value.startsWith("//")) continue; // protocol-relative external
      if (value.includes("${")) {
        externalOrDynamicSkipped.push({ file: relative(root, file), value });
        continue;
      }

      const isAsset = /\.(svg|png|jpg|jpeg|webp|pdf|ico)$/i.test(value);
      if (isAsset) {
        const assetPath = join(publicDir, value);
        if (!existsSync(assetPath)) {
          brokenImages.push({ file: relative(root, file), value });
        }
      } else {
        if (!routeMatches(routes, value)) {
          brokenLinks.push({ file: relative(root, file), value });
        }
      }
    }
  }

  const report = { brokenLinks, brokenImages, knownRoutes: [...routes].sort() };

  if (brokenLinks.length === 0 && brokenImages.length === 0) {
    console.log(`OK — checked ${sourceFiles.length} files, ${routes.size} known routes, 0 broken internal links/images.`);
  } else {
    console.error(`Found ${brokenLinks.length} broken link(s) and ${brokenImages.length} broken image reference(s):`);
    for (const b of brokenLinks) console.error(`  [link]  ${b.value}  (${b.file})`);
    for (const b of brokenImages) console.error(`  [image] ${b.value}  (${b.file})`);
  }

  return report;
}

const result = main();
if (import.meta.url === `file://${process.argv[1]}`) {
  if (result.brokenLinks.length > 0 || result.brokenImages.length > 0) {
    process.exitCode = 1;
  }
}

export { main };
