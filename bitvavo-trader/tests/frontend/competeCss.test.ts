/**
 * v3 (Bot-wedstrijd): stylesheet en HTML-aansluiting van het tabblad Wedstrijd en de
 * botwisselaar. De kopbalkregels zijn met Playwright gecontroleerd (901–1920 px met en
 * zonder botwisselaar, 360–480 px) en mogen niet stilletjes verdwijnen.
 */
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const dir = resolve(dirname(fileURLToPath(import.meta.url)), "../../public");
const read = (rel: string) => readFileSync(resolve(dir, rel), "utf8");
const competeCss = read("css/compete.css");
const baseCss = read("css/base.css");
const html = read("index.html");
const mainJs = read("js/main.js");

const CONTRACT = [
  "--bg", "--panel", "--panel-2", "--border", "--text", "--muted", "--green", "--green-bg", "--red", "--red-bg",
  "--accent", "--yellow", "--radius", "--gap", "--font", "--font-mono",
  "--panel-3", "--border-strong", "--grid", "--accent-bg", "--yellow-bg", "--text-dim", "--radius-sm", "--shadow", "--header-h",
];

/** Inhoud van het eerste @media-blok met precies deze voorwaarde (tot het volgende @media op kolom 0) */
function media(css: string, cond: string): string {
  const start = css.indexOf(`@media ${cond} {`);
  expect(start, cond).toBeGreaterThanOrEqual(0);
  const end = css.indexOf("\n@media", start + 1);
  return css.slice(start, end < 0 ? undefined : end);
}

describe("compete.css", () => {
  it("alleen contract-variabelen, geen eigen :root en geen eigen custom properties", () => {
    const used = [...competeCss.matchAll(/var\((--[\w-]+)/g)].map((m) => m[1]);
    expect(used.length).toBeGreaterThan(20);
    expect(used.filter((v) => !CONTRACT.includes(v))).toEqual([]);
    expect(competeCss).not.toMatch(/:root/);
    expect(competeCss).not.toMatch(/^\s*--[\w-]+\s*:/m);
  });

  it("kaarten: 4 naast elkaar op breed scherm, 2 op tablet, 1 op telefoon; één bot niet over de hele breedte", () => {
    expect(competeCss).toMatch(/\.cp-board \{[^}]*grid-template-columns: repeat\(auto-fit, minmax\(250px, 1fr\)\);/);
    expect(media(competeCss, "(max-width: 1199px)")).toMatch(/\.cp-board \{\s*grid-template-columns: repeat\(2, minmax\(0, 1fr\)\);/);
    expect(media(competeCss, "(max-width: 699px)")).toMatch(/\.cp-board \{\s*grid-template-columns: minmax\(0, 1fr\);/);
    expect(competeCss).toMatch(/\.cp-board\.is-single \{\s*grid-template-columns: minmax\(0, 460px\);/);
  });

  it("telefoon: knoppen in een raster, Noodstop over de volle breedte", () => {
    const phone = media(competeCss, "(max-width: 699px)");
    expect(phone).toMatch(/\.cp-actions \{[^}]*grid-template-columns: repeat\(2, minmax\(0, 1fr\)\);/);
    expect(phone).toMatch(/\.cp-actions \[data-cp-act="kill"\] \{\s*grid-column: 1 \/ -1;/);
  });
});

describe("index.html en main.js", () => {
  it("stylesheet geladen, tabblad Wedstrijd (tweede in het menu) met container, botwisselaar naast het logo", () => {
    expect(html).toContain('<link rel="stylesheet" href="/css/compete.css" />');
    expect(html).toMatch(/<section id="tab-compete" class="tab-page" role="tabpanel" aria-label="Wedstrijd" hidden>\s*<div id="compete-root" class="tab-root"><\/div>/);
    const tabs = [...html.matchAll(/data-tab="(\w+)"/g)].map((m) => m[1]);
    expect(tabs).toEqual(["live", "compete", "backtest", "scanner", "settings"]);
    expect(html).toMatch(/<\/a>\s*<div id="bot-switch" class="bot-switch" hidden><\/div>\s*<nav class="nav-tabs"/);
  });

  it("main.js mount het paneel dynamisch en kent het tabblad", () => {
    expect(mainJs).toContain('const TABS = ["live", "compete", "backtest", "scanner", "settings"];');
    expect(mainJs).toContain('["compete", "mountCompete", "compete-root"]');
    expect(mainJs).toMatch(/mountBotSwitcher\(ctx, \$\("bot-switch"\)\)/);
    expect(mainJs).toContain("pageTitle(");
  });
});

describe("base.css: kopbalk met vijf tabs en de botwisselaar", () => {
  it("meerdere bots: merknaam weg tot 1560 px (logo en wisselaar blijven)", () => {
    expect(media(baseCss, "(min-width: 901px) and (max-width: 1560px)")).toMatch(/body\.multi-bot \.brand-text \{\s*display: none;/);
    // telefoon (in het ≤ 600 px-blok van de kopbalk)
    expect(baseCss).toMatch(/@media \(max-width: 600px\) \{[^@]*body\.multi-bot \.brand-text \{\s*display: none;/);
  });

  it("901–1399 px: menu zonder iconen; 901–1000 px nog compacter", () => {
    expect(media(baseCss, "(min-width: 901px) and (max-width: 1399px)")).toMatch(/\.nav-tabs button svg \{\s*display: none;/);
    expect(media(baseCss, "(min-width: 901px) and (max-width: 1000px)")).toMatch(/\.nav-tabs button \{\s*padding: 0 6px;/);
  });

  it("vangnet: het menu krimpt en schuift in plaats van de pagina te verbreden", () => {
    expect(baseCss).toMatch(
      /Vangnet[^@]*@media \(min-width: 901px\) \{\s*\.nav-tabs \{\s*flex: 0 1 auto;\s*min-width: 0;\s*overflow-x: auto;[^@]*\.header-right \{\s*flex: none;/,
    );
  });

  it("telefoon: 'Backtest' zonder '-lab' en minder ruimte per tab (vijf tabs op 390 px)", () => {
    expect(html).toContain('<span>Backtest<span class="tab-long">-lab</span></span>');
    expect(baseCss).toMatch(/@media \(max-width: 480px\) \{\s*\.nav-tabs button \.tab-long \{\s*display: none;/);
    expect(media(baseCss, "(max-width: 430px)")).toMatch(/\.nav-tabs button \{\s*padding: 0 8px;\s*font-size: 12.5px;/);
  });

  it("menu van de wisselaar past op een telefoon; ≤ 900 px staat de wisselaar naast het logo", () => {
    expect(baseCss).toMatch(/\.bs-menu \{[^}]*max-width: calc\(100vw - 24px\);/);
    expect(media(baseCss, "(max-width: 900px)")).toMatch(/\.bot-switch \{\s*order: 1;/);
  });
});
