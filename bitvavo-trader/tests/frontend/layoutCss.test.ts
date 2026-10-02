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

describe("base.css (ronde 4: 390 px en statistiekkaarten)", () => {
  it("390 px: hoofdtabs zonder iconen en met minder ruimte, vervaagde rand zolang er nog tabs buiten beeld staan", () => {
    expect(rule(".nav-tabs button svg", "(max-width: 480px)")).toContain("display: none");
    expect(rule(".nav-tabs button", "(max-width: 480px)")).toContain("padding: 0 10px");
    // ook voor de marktbalk (klassen gezet door main.js)
    expect(css).toMatch(/\.nav-tabs\.can-right,\s*\.market-tabs\.can-right \{[^}]*mask-image/);
    expect(css).toMatch(/\.nav-tabs\.can-left,\s*\.market-tabs\.can-left \{[^}]*mask-image/);
  });

  it("markttab krimpt nooit onder zijn inhoud (24u-label niet afgesneden)", () => {
    expect(rule(".mkt-tab")).toContain("flex: none");
  });

  it("OHLC-legenda op ≤ 600 px minstens zo ver van rechts als de prijsschaal (82 px) + marge", () => {
    expect(css).toMatch(/@media \(max-width: 600px\) \{[^@]*\.chart-legend \{\s*[^}]*right: 90px;/);
    expect(css).not.toMatch(/\.chart-legend \{[^}]*right: 70px/);
  });

  it("statistiekkaarten: subregels breken af i.p.v. bedragen/percentages af te kappen; haltreden leesbaar", () => {
    const sub = rule(".stats-bar .stat-sub");
    expect(sub).toContain("white-space: normal");
    expect(sub).toContain("overflow: visible");
    expect(sub).toContain("text-overflow: clip");
    expect(rule(".stats-bar .stat-sub > span")).toContain("white-space: nowrap");
    expect(rule(".stat-bot .stat-sub.halt")).toContain("overflow-wrap: break-word");
  });

  it("vaste kopbalk: scroll-padding zodat gefocuste velden er niet onder vallen", () => {
    expect(rule("html", "(min-width: 901px)")).toContain("scroll-padding-top: calc(var(--header-h) + 12px)");
  });
});

describe("panels.css (ronde 4: zijbalk Backtest-lab)", () => {
  const panels = readFileSync(resolve(dirname(fileURLToPath(import.meta.url)), "../../public/css/panels.css"), "utf8");
  const block = (sel: string) => {
    const esc = sel.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const m = new RegExp(`(^|\\n)${esc}\\s*\\{([^}]*)\\}`).exec(panels);
    expect(m, sel).not.toBeNull();
    return m![2];
  };

  it("geen eigen scrollbalk (geen scrollval), alleen sticky onder de kopbalk als hij past", () => {
    const side = block(".bt-side");
    expect(side).not.toMatch(/overflow-y|max-height|position:\s*sticky/);
    const sticky = block(".bt-side.is-sticky");
    expect(sticky).toContain("position: sticky");
    expect(sticky).toContain("top: calc(var(--header-h) + 12px)");
  });
});

describe("base.css (ronde 5: kopbalk tussen 901 en 1279 px, bijv. iPad liggend) — UI-9", () => {
  const MID = "(min-width: 901px) and (max-width: 1279px)";
  const NARROW = "(min-width: 901px) and (max-width: 1120px)";

  it("901–1279 px: menu zonder iconen, 'Reset oefengeld' alleen als icoon (Noodstop blijft in beeld)", () => {
    expect(rule(".nav-tabs button svg", MID)).toContain("display: none");
    expect(rule(".nav-tabs button", MID)).toContain("padding: 0 8px");
    expect(rule(".bot-controls .btn .lbl-long", MID)).toContain("display: none");
  });

  it("901–1120 px: ook de merknaam weg en van de verbinding alleen de stip (tekst blijft voor schermlezers)", () => {
    expect(rule(".brand-text", NARROW)).toContain("display: none");
    const conn = rule(".conn .conn-text", NARROW);
    expect(conn).toContain("position: absolute");
    expect(conn).toContain("clip-path: inset(50%)");
    expect(conn).not.toContain("display: none");
  });

  it("de knop 'Reset oefengeld' heeft een aria-label (het label kan verborgen zijn)", () => {
    const header = readFileSync(resolve(dirname(fileURLToPath(import.meta.url)), "../../public/js/header.js"), "utf8");
    expect(header).toMatch(/data-act="reset"[^>]*aria-label="Reset oefengeld"/);
  });

  it("stop/doel onder de balk: klasse tight zet het doel op een tweede regel (niet in de kaartweergave)", () => {
    expect(rule(".rangebar.tight")).toContain("height: 46px");
    expect(rule(".rangebar.tight .lbl.r")).toContain("top: 31px");
    expect(css).toMatch(/@media \(max-width: 600px\) \{[^@]*\.rangebar\.tight \.lbl\.r \{\s*top: 18px;/);
  });
});

describe("panels.css (ronde 5)", () => {
  const panels = readFileSync(resolve(dirname(fileURLToPath(import.meta.url)), "../../public/css/panels.css"), "utf8");
  it("mislukte muntkeuze: gele stip; lange eenheid ('blokken van 4 uur') krijgt ruimte naast de pijltjes", () => {
    expect(panels).toMatch(/\.st-uni-now\.is-warn \.st-uni-dot \{[^}]*background: var\(--yellow\)/);
    expect(panels).toMatch(/\.st-input-wrap\.has-long-unit \.input \{[^}]*padding-right: 132px/);
  });
});
