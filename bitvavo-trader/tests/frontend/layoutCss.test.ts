/**
 * Lay-outregels in public/css/base.css die met Playwright gecontroleerd zijn
 * (1280/1440/1920/768/390 px) en niet stilletjes mogen verdwijnen:
 * actieknoppen van open posities altijd zichtbaar, lange paden in de
 * herstelbanner breken af, kopbalk past op 1280 px.
 */
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const css = readFileSync(resolve(dirname(fileURLToPath(import.meta.url)), "../../public/css/base.css"), "utf8");

/** Declaraties van de eerste regel met precies deze selector (optioneel binnen een @media-blok). */
function rule(selector: string, media?: string): string {
  let src = css;
  if (media) {
    const start = css.indexOf(`@media ${media} {`);
    expect(start, `@media ${media}`).toBeGreaterThanOrEqual(0);
    // tot het volgende @media-blok op kolom 0
    const end = css.indexOf("\n@media", start + 1);
    src = css.slice(start, end < 0 ? undefined : end);
  }
  const esc = selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const m = new RegExp(`(^|\\n)\\s*${esc}\\s*\\{([^}]*)\\}`).exec(src);
  expect(m, selector).not.toBeNull();
  return m![2];
}

describe("base.css", () => {
  it("open posities: actiekolom sticky rechts, met schaduw als de tabel scrolt", () => {
    expect(rule(".pos-table .col-act")).toMatch(/position:\s*sticky;[\s\S]*right:\s*0;/);
    expect(rule(".pos-wrap.is-scrollx .col-act")).toContain("box-shadow");
    expect(rule(".scroll-cue")).toContain("display: inline-flex");
  });

  it("kaartweergave (≤ 600 px): geen sticky kolom en geen losse vlakken per cel", () => {
    // binnen één @media (max-width: 600px)-blok ([^@]* = geen ander @-blok ertussen)
    expect(css).toMatch(/@media \(max-width: 600px\) \{[^@]*\.pos-table \.col-act,\s*\.pos-wrap\.is-scrollx \.col-act \{\s*position: static;/);
    expect(css).toMatch(/@media \(max-width: 600px\) \{[^@]*\.table\.responsive tr\.is-unsellable \{\s*background:/);
  });

  it("herstelbanner: lange paden breken af (overflow-wrap: anywhere)", () => {
    expect(rule(".alert-banner")).toContain("overflow-wrap: anywhere");
    expect(rule(".alert-banner .ab-sub.ab-path")).toContain("display: block");
    expect(rule(".alert-banner .ab-path .mono")).toContain("overflow-wrap: anywhere");
  });

  it("kopbalk compacter tot 1440 px (past op 1280 px mét schuifbalk)", () => {
    expect(rule(".nav-tabs button", "(max-width: 1440px)")).toContain("padding: 0 9px");
    expect(rule(".app-header", "(max-width: 1440px)")).toContain("gap: 12px");
  });
});
