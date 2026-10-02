/**
 * public/css/radar.css gebruikt alleen de variabelen uit het Frontend contract, en de
 * radar staat op smalle schermen op een vaste plek (base.css).
 */
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const dir = resolve(dirname(fileURLToPath(import.meta.url)), "../../public");
const radarCss = readFileSync(resolve(dir, "css/radar.css"), "utf8");
const baseCss = readFileSync(resolve(dir, "css/base.css"), "utf8");
const html = readFileSync(resolve(dir, "index.html"), "utf8");

const CONTRACT = [
  "--bg", "--panel", "--panel-2", "--border", "--text", "--muted", "--green", "--green-bg", "--red", "--red-bg",
  "--accent", "--yellow", "--radius", "--gap", "--font", "--font-mono",
  "--panel-3", "--border-strong", "--grid", "--accent-bg", "--yellow-bg", "--text-dim", "--radius-sm", "--shadow", "--header-h",
];

describe("radar.css", () => {
  it("alleen contract-variabelen, en geen eigen :root", () => {
    const used = [...radarCss.matchAll(/var\((--[\w-]+)/g)].map((m) => m[1]);
    expect(used.length).toBeGreaterThan(10);
    expect(used.filter((v) => !CONTRACT.includes(v))).toEqual([]);
    expect(radarCss).not.toMatch(/:root/);
  });

  it("wordt geladen en heeft een container op de Live-tab, onder de grafiek", () => {
    expect(html).toContain('<link rel="stylesheet" href="/css/radar.css" />');
    const chart = html.indexOf('class="panel chart-panel"');
    const radar = html.indexOf('id="panel-radar"');
    const positions = html.indexOf('id="panel-positions"');
    expect(radar).toBeGreaterThan(chart);
    expect(radar).toBeLessThan(positions);
  });

  it("smal scherm (≤ 900 px): radar na signalen en posities", () => {
    const block = baseCss.slice(baseCss.indexOf("@media (max-width: 900px) {"));
    const order = (id: string) => Number(new RegExp(`#${id} \\{\\s*order: (\\d+);`).exec(block)?.[1]);
    expect(order("panel-radar")).toBe(order("panel-positions") + 1);
    expect(order("panel-radar")).toBeGreaterThan(order("panel-signals"));
    expect(order("panel-log")).toBeGreaterThan(order("panel-radar"));
  });

  it("tegels zitten in een eigen scrollvak (400 munten maken de pagina niet eindeloos lang)", () => {
    expect(radarCss).toMatch(/\.rd-scroll \{[^}]*max-height:[^}]*overflow-y: auto;/);
    expect(radarCss).toMatch(/\.rd-grid \{[^}]*grid-template-columns: repeat\(auto-fill, minmax\(150px, 1fr\)\);/);
  });
});
