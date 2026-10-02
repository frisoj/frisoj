/**
 * Stuurt het echte public/js/panels/settings.js aan met een nep-DOM en een
 * nep-server die PUT /api/config met de echte validateConfigPatch samenvoegt.
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { DEFAULT_ENGINE_CONFIG } from "../../src/core/defaults";
import type { EngineConfig } from "../../src/core/types";
import { validateRiskConfig } from "../../src/risk/riskManager";
import { validateConfigPatch } from "../../src/server/validation";
import { listStrategies } from "../../src/strategies";
import { fakeNode, installBrowserGlobals, loadPublic, makeBus, settle, type Fake } from "./helpers";

const KNOWN = new Set(["BTC-EUR", "ETH-EUR", "SOL-EUR", "TRX-EUR", "ADA-EUR"]);

function fakeServer(opts: { config?: EngineConfig; known?: Set<string>; info?: Fake } = {}) {
  let config: EngineConfig = structuredClone(opts.config ?? DEFAULT_ENGINE_CONFIG);
  const known = opts.known ?? KNOWN;
  const puts: unknown[] = [];
  const put = (patch: unknown): EngineConfig => {
    const valid = validateConfigPatch(patch, config, {
      knownEurMarkets: known,
      validateRisk: validateRiskConfig,
      strategies: listStrategies(),
    });
    config = structuredClone({ ...config, ...valid });
    return structuredClone(config);
  };
  const api = {
    getConfig: async () => structuredClone(config),
    putConfig: async (patch: unknown) => {
      puts.push(structuredClone(patch));
      return put(patch);
    },
    getStrategies: async () => listStrategies(),
    info: async () => structuredClone(opts.info ?? { mode: "paper", liveArmed: false, hasApiKeys: false, capitalLimitQuote: 50, dataSource: "simulated" }),
    getMarkets: async () => [...known].map((market) => ({ market })),
    arm: async () => ({}),
    disarm: async () => ({}),
  };
  return {
    api,
    puts,
    get config() {
      return config;
    },
    /** Wijziging van elders (Scanner, Backtest, ander tabblad) — rechtstreeks op de server */
    change: (patch: unknown) => put(patch),
  };
}

let env: ReturnType<typeof installBrowserGlobals>;
beforeEach(() => {
  env = installBrowserGlobals();
});
afterEach(() => env.restore());

async function mount(
  opts: { config?: EngineConfig; known?: Set<string>; snapshot?: Fake; boxes?: string[]; info?: Fake; bots?: Fake[] } = {},
) {
  const { mountSettings } = await loadPublic("js/panels/settings.js");
  const { fmt, esc } = await loadPublic("js/format.js");
  const server = fakeServer(opts);
  const bus = makeBus();
  const toasts: string[] = [];
  const modals: Fake[] = [];
  // Alleen de meldingsvakken en het live-vak bestaan in de nep-DOM; de rest van het formulier niet
  const liveNodes: Record<string, Fake> = {};
  const boxes: Record<string, Fake> = {
    ".st-errors": fakeNode(),
    ".st-notice": fakeNode(),
    ".st-sec-live": fakeNode({ querySelector: (sel: string) => (liveNodes[sel] ||= fakeNode()) }),
  };
  for (const sel of opts.boxes || []) boxes[sel] = fakeNode();
  const el = fakeNode({ querySelector: (sel: string) => boxes[sel] ?? null });
  const ctx = {
    fmt,
    esc,
    api: server.api,
    bus,
    toast: (m: string, k: string) => toasts.push(`${k}: ${m}`),
    getInfo: () => null,
    getState: () => opts.snapshot ?? null,
    getBots: () => opts.bots ?? null,
    openModal(o: Fake) {
      modals.push(o);
      return () => {};
    },
  };
  mountSettings(ctx, el);
  await settle();
  const input = (path: string, value: string, scale = 1) =>
    el.fire("input", {
      target: {
        dataset: { path, scale: String(scale) },
        value,
        type: "number",
        tagName: "INPUT",
        classList: { contains: () => false },
        closest: () => null,
      },
    });
  const click = (act: string) => el.fire("click", { target: { closest: () => ({ dataset: { act } }) } });
  /** Klik op een knop met deze data-attributen (bijv. { uniMode: "manual" }) */
  const clickData = (dataset: Record<string, string>) => el.fire("click", { target: { closest: () => ({ dataset }) } });
  const check = (path: string, checked: boolean) =>
    el.fire("input", {
      target: { dataset: { path }, checked, type: "checkbox", tagName: "INPUT", classList: { contains: () => false }, closest: () => null },
    });
  /** Bedragveld met duizendtallen (minimaal volume) */
  const typeGrouped = (path: string, value: string) =>
    el.fire("input", {
      target: { dataset: { path, scale: "1", grouped: "1" }, value, type: "text", tagName: "INPUT", classList: { contains: () => false }, closest: () => null },
    });
  return {
    clickData,
    check,
    typeGrouped,
    boxes,
    server,
    bus,
    toasts,
    modals,
    el,
    input,
    click,
    errorsBox: boxes[".st-errors"],
    noticeBox: boxes[".st-notice"],
    liveBox: boxes[".st-sec-live"],
    liveNodes,
  };
}

describe("Instellingen opslaan draait wijzigingen van elders niet terug", () => {
  it("Scanner-markt en Backtest-parameters blijven staan na opslaan met een open wijziging", async () => {
    const { server, bus, toasts, input, click } = await mount();
    input("pollMs", "20", 0.001); // Ververs elke 20 sec — niet opgeslagen

    // Scanner voegt TRX-EUR toe (zelfde pad als scanner.js addMarket)
    bus.emit("config-changed", server.change({ markets: [...server.config.markets, "TRX-EUR"] }));
    // Backtest past parameters + stop toe (zelfde pad als backtest.js confirmApply)
    bus.emit(
      "config-changed",
      server.change({ ensemble: { params: { "ema-trend": { fast: 12, slow: 26, trend: 100, adxMin: 20 } } }, risk: { stopAtrMult: 2.5 } }),
    );

    click("save");
    await settle();

    expect(server.puts).toEqual([{ pollMs: 20000 }]);
    expect(server.config.pollMs).toBe(20000);
    expect(server.config.markets).toContain("TRX-EUR");
    expect(server.config.ensemble.params["ema-trend"]).toEqual({ fast: 12, slow: 26, trend: 100, adxMin: 20 });
    expect(server.config.risk.stopAtrMult).toBe(2.5);
    expect(toasts.some((t) => t.startsWith("success: Instellingen opgeslagen"))).toBe(true);
  });

  it("ook zonder event (ander tabblad): opslaan haalt eerst de actuele config op", async () => {
    const { server, input, click } = await mount();
    input("pollMs", "30", 0.001);
    server.change({ markets: [...server.config.markets, "TRX-EUR"], risk: { stopAtrMult: 2.5 } }); // geen bus-event

    click("save");
    await settle();

    expect(server.puts).toEqual([{ pollMs: 30000 }]);
    expect(server.config.markets).toContain("TRX-EUR");
    expect(server.config.risk.stopAtrMult).toBe(2.5);
  });

  it("zelfde veld op twee plekken gewijzigd: eerst melden, pas bij de tweede klik opslaan", async () => {
    const { server, toasts, input, click, noticeBox } = await mount();
    input("risk.stopAtrMult", "3");
    server.change({ risk: { stopAtrMult: 2.5 } }); // elders

    click("save");
    await settle();
    expect(server.puts).toEqual([]);
    expect(toasts.some((t) => t.startsWith("warn: Instellingen zijn intussen elders gewijzigd"))).toBe(true);
    expect(noticeBox.hidden).toBe(false);
    expect(noticeBox.innerHTML).toContain("Stop-loss afstand");

    click("save");
    await settle();
    expect(server.puts).toEqual([{ risk: { stopAtrMult: 3 } }]);
    expect(server.config.risk.stopAtrMult).toBe(3);
  });

  it("zonder eigen wijzigingen neemt het paneel een nieuwe config uit de snapshot over", async () => {
    const { server, bus, input, click } = await mount();
    server.change({ markets: ["BTC-EUR", "TRX-EUR"] });
    bus.emit("snapshot", { mode: "paper", liveArmed: false, config: structuredClone(server.config) });
    // Daarna één veld wijzigen en opslaan: de markten komen niet terug
    input("historyCandles", "400");
    click("save");
    await settle();
    expect(server.puts).toEqual([{ historyCandles: 400 }]);
    expect(server.config.markets).toEqual(["BTC-EUR", "TRX-EUR"]);
  });

  it("een te hoge taker fee wordt geweigerd met een melding in %", async () => {
    const { server, input, click, errorsBox } = await mount();
    input("risk.takerFee", "2", 100);
    click("save");
    await settle();
    expect(server.puts).toEqual([]);
    expect(errorsBox.hidden).toBe(false);
    expect(errorsBox.innerHTML).toContain("Taker fee moet tussen 0% en 1% liggen.");
    expect(errorsBox.innerHTML).not.toContain("0,01");
  });
});

describe("Instellingen: live handel in dezelfde (Nederlandse) woorden als de header", () => {
  const liveInfo = { mode: "live", liveArmed: false, hasApiKeys: true, capitalLimitQuote: 50, dataSource: "bitvavo", version: "0.1.0" };

  it("niet ingeschakeld: knop 'Live handel inschakelen…', nergens 'Arm live trading'/'gewapend'", async () => {
    const { bus, liveBox } = await mount();
    bus.emit("app-info", liveInfo);
    const html = String(liveBox.innerHTML).replace(/\s+/g, " ");
    expect(html).toContain(">Live handel inschakelen…</button>");
    expect(html).toContain('<div class="panel-title">Live handel</div>');
    expect(html).toContain("Live handel ingeschakeld");
    expect(html).not.toMatch(/Arm live trading|gewapend|armen|Live trading/i);
  });

  it("de bevestiging heet 'Live handel inschakelen' met knop 'Inschakelen' (zoals in de header)", async () => {
    const { bus, modals, liveNodes, toasts, server } = await mount();
    server.api.arm = async () => ({ ...liveInfo, liveArmed: true });
    bus.emit("app-info", liveInfo);
    liveNodes[".st-arm"].fire("click", {});
    const m = modals[modals.length - 1];
    expect(m.title).toBe("Live handel inschakelen");
    expect(m.confirmText).toBe("Inschakelen");
    expect(String(m.bodyHtml)).not.toMatch(/armen|ontwapenen/i);
    await m.onConfirm("IK BEGRIJP HET RISICO");
    expect(toasts).toContain("warn: Live handel ingeschakeld — de bot handelt nu met echt geld");
  });

  it("ingeschakeld: knop 'Uitschakelen (stop echte orders)'; oefenmodus-uitleg noemt 'Live handel inschakelen…'", async () => {
    const { bus, liveBox } = await mount();
    bus.emit("app-info", { ...liveInfo, liveArmed: true });
    expect(String(liveBox.innerHTML)).toContain(">Uitschakelen (stop echte orders)</button>");
    expect(String(liveBox.innerHTML)).toContain("Live handel staat AAN.");
    bus.emit("app-info", { ...liveInfo, mode: "paper" });
    const paper = String(liveBox.innerHTML).replace(/\s+/g, " ");
    expect(paper).toContain("<b>Live handel inschakelen…</b> klikt");
    expect(paper).not.toContain("Arm live trading");
  });
});

describe("Instellingen: uitleg", () => {
  it("historie: de bot haalt zelf de opwarm-candles; opgeslagen instellingen gaan vóór MARKETS/INTERVAL in .env", async () => {
    const { el } = await mount();
    const html = String(el.innerHTML).replace(/\s+/g, " ");
    expect(html).toContain("dan haalt de bot die extra candles zelf op");
    expect(html).not.toContain("Minimaal ~250");
    expect(html).toContain("&lt;DATA_DIR&gt;/config.json");
    expect(html).toMatch(/gaat vóór <span class="mono">MARKETS<\/span> en <span class="mono">INTERVAL<\/span> uit <span class="mono">\.env<\/span>/);
    expect(html).toContain("Kleinste bedrag waarmee de bot een positie opent.");
  });
});

// ── v2: munten (tot 400), automatische muntkeuze, trendfilter, spreadlimiet ──

const flat = (h: unknown) => String(h).replace(/\s+/g, " ");
const names = (n: number, prefix = "M") => Array.from({ length: n }, (_, i) => `${prefix}${String(i).padStart(3, "0")}-EUR`);

describe("v2 Instellingen: Munten — automatisch", () => {
  // vandaag om 14:05 (een vaste datum faalde na middernacht: dan staat de datum er terecht bij)
  const at = (() => {
    const d = new Date();
    d.setHours(14, 5, 0, 0);
    return d.getTime();
  })();
  const snapshot = (over: Fake = {}) => ({
    mode: "paper",
    liveArmed: false,
    config: structuredClone(DEFAULT_ENGINE_CONFIG),
    activeMarkets: names(30),
    universe: { mode: "auto", count: 30, requested: 30, updatedAt: at },
    ...over,
  });

  it("uitleg, snelkeuzes 10 · 30 · 100 · 400, minimaal volume, status uit de snapshot en de positie-hint", async () => {
    const { el } = await mount({ snapshot: snapshot() });
    const html = flat(el.innerHTML);
    expect(html).toContain('<div class="panel-title">Munten</div>');
    expect(html).toMatch(/data-uni-mode="auto"[^>]*class="is-active">Automatisch \(meest verhandeld\)<\/button>/);
    expect(html).toContain(">Zelf kiezen</button>");
    expect(html).toContain(
      'Elk uur kiest de bot de <b class="mono st-uni-n">30</b> munten met de meeste handel op Bitvavo, zonder stablecoins en met een kleine spread.',
    );
    for (const n of [10, 30, 100, 400]) expect(html).toContain(`data-uni-count="${n}"`);
    expect(html).toMatch(/class="st-mopt st-uni-preset is-active" data-uni-count="30"/);
    expect(html).toContain('max="400"');
    expect(html).toContain('value="250.000"');
    expect(html).toContain("Nu actief: 30 munten, gekozen om 14:05");
    expect(html).toContain("Meer munten = meer keus, niet meer posities");
    expect(html).toContain("nu max. <b>2</b>");
    // Zelf-kiezen-onderdelen staan er in deze stand niet
    expect(html).not.toContain("Alle markten toevoegen");
  });

  it("snelkeuze 100 en een bedrag met punten → PUT met alleen universe.count en minVolumeEur", async () => {
    const { server, click, clickData, typeGrouped } = await mount();
    clickData({ uniCount: "100" });
    typeGrouped("universe.minVolumeEur", "1.000.000");
    click("save");
    await settle();
    expect(server.puts).toEqual([{ universe: { count: 100, minVolumeEur: 1_000_000 } }]);
    expect(server.config.universe).toEqual({ mode: "auto", count: 100, minVolumeEur: 1_000_000 });
  });

  it("meer dan 400 munten wordt in de browser geweigerd, met de melding in munten", async () => {
    const { server, click, input, errorsBox } = await mount();
    input("universe.count", "500");
    click("save");
    await settle();
    expect(server.puts).toEqual([]);
    expect(errorsBox.innerHTML).toContain("Aantal munten moet tussen 1 en 400 munten liggen.");
  });

  it("nieuwe snapshot → alleen de statusregel wordt bijgewerkt", async () => {
    const { bus, boxes } = await mount({ snapshot: snapshot(), boxes: [".st-uni-status"] });
    bus.emit("snapshot", snapshot({ activeMarkets: names(100), universe: { mode: "auto", count: 100, requested: 100, updatedAt: at } }));
    expect(flat(boxes[".st-uni-status"].innerHTML)).toContain("Nu actief: 100 munten, gekozen om 14:05");
  });
});

describe("v2 Instellingen: Munten — zelf kiezen", () => {
  it("wisselen naar Zelf kiezen: chips, zoeken, teller N/400, 'Alle markten toevoegen (N)' en 'Alles wissen'", async () => {
    const known = new Set(["BTC-EUR", "ETH-EUR", "SOL-EUR", ...names(60)]);
    const { el, server, click, clickData } = await mount({ known });
    clickData({ uniMode: "manual" });
    const html = flat(el.innerHTML);
    expect(html).toMatch(/data-uni-mode="manual"[^>]*class="is-active">Zelf kiezen<\/button>/);
    expect(html).toContain("Jouw munten");
    expect(html).toContain("3/400");
    expect(html).toContain('placeholder="Zoek munt, bijv. XRP…"');
    expect(html).toContain("Alle markten toevoegen (60)");
    expect(html).toContain(">Alles wissen</button>");
    expect((html.match(/class="st-mchip"/g) || []).length).toBe(3);

    clickData({ act: "markets-all" });
    click("save");
    await settle();
    expect(server.puts).toHaveLength(1);
    const put = server.puts[0] as Fake;
    expect(put.universe).toEqual({ mode: "manual" });
    expect(put.markets).toHaveLength(63);
    expect(put.markets.slice(0, 3)).toEqual(["BTC-EUR", "ETH-EUR", "SOL-EUR"]);
  });

  it("meer dan 30 munten: ingeklapt met '+15 meer tonen'; uitklappen toont ze allemaal", async () => {
    const markets = names(45);
    const config = { ...structuredClone(DEFAULT_ENGINE_CONFIG), markets, universe: { mode: "manual" as const, count: 30, minVolumeEur: 250_000 } };
    const { el, clickData, boxes } = await mount({ config, known: new Set(markets), boxes: [".st-msel"] });
    const html = flat(el.innerHTML);
    expect(html).toContain("45/400");
    expect(html).toContain("+15 meer tonen");
    expect((html.match(/class="st-mchip"/g) || []).length).toBe(30);
    clickData({ act: "chips-more" });
    const open = flat(boxes[".st-msel"].innerHTML);
    expect((open.match(/class="st-mchip"/g) || []).length).toBe(45);
    expect(open).toContain(">Minder tonen</button>");
  });

  it("alles wissen en opslaan in 'Zelf kiezen' wordt geweigerd; bij 'Automatisch' blijft de opgeslagen lijst staan", async () => {
    const config = { ...structuredClone(DEFAULT_ENGINE_CONFIG), universe: { mode: "manual" as const, count: 30, minVolumeEur: 250_000 } };
    const { server, click, clickData, errorsBox } = await mount({ config });
    clickData({ act: "markets-clear" });
    click("save");
    await settle();
    expect(server.puts).toEqual([]);
    expect(errorsBox.innerHTML).toContain("Kies minstens één munt, of zet Munten op Automatisch.");

    clickData({ uniMode: "auto" });
    click("save");
    await settle();
    expect(server.puts).toEqual([{ universe: { mode: "auto" } }]);
    expect(server.config.markets).toEqual(["BTC-EUR", "ETH-EUR", "SOL-EUR"]);
  });

  it("Scanner schakelt elders over naar Zelf kiezen: overgenomen, en opslaan stuurt alleen de eigen wijziging", async () => {
    const { el, server, bus, input, click } = await mount();
    input("pollMs", "20", 0.001);
    bus.emit("config-changed", server.change({ universe: { mode: "manual" }, markets: ["BTC-EUR", "ETH-EUR", "TRX-EUR"] }));
    expect(flat(el.innerHTML)).toContain("Jouw munten");
    click("save");
    await settle();
    expect(server.puts).toEqual([{ pollMs: 20000 }]);
    expect(server.config.universe?.mode).toBe("manual");
    expect(server.config.markets).toEqual(["BTC-EUR", "ETH-EUR", "TRX-EUR"]);
  });
});

describe("v2 Instellingen: Trendfilter en max. spread", () => {
  it("uitleg in gewone taal, twee schakelaars, Dag / 4 uur en periode; PUT met alleen de gewijzigde velden", async () => {
    const { el, server, click, clickData, check, input } = await mount();
    const html = flat(el.innerHTML);
    expect(html).toContain('<div class="panel-title">Trendfilter</div>');
    expect(html).toContain("Marktfilter: alleen kopen als Bitcoin boven zijn gemiddelde staat");
    expect(html).toContain("Muntfilter: alleen kopen als de munt zelf boven zijn gemiddelde staat");
    expect(html).toContain("alleen <b>nieuwe aankopen</b> tegen; verkopen, stop-losses en winstdoelen gaan altijd gewoon door");
    expect(html).toContain("In ons onderzoek op echte dagkoersen (2016–2026) was dit het enige idee dat ook buiten de testperiode standhield");
    expect(html).toContain("<b>wekenlang niets</b>");
    expect(html).toMatch(/data-tf-interval="1d"[^>]*class="is-active">Dag<\/button>/);
    expect(html).toContain(">4 uur</button>");
    expect(html).toMatch(/data-path="ensemble\.trendFilter\.market" checked/);
    expect(html).toContain('<span class="pn-chip pn-chip-acc">aan</span>');

    check("ensemble.trendFilter.coin", true);
    clickData({ tfInterval: "4h" });
    input("ensemble.trendFilter.period", "20");
    click("save");
    await settle();
    expect(server.puts).toEqual([{ ensemble: { trendFilter: { coin: true, interval: "4h", period: 20 } } }]);
    expect(server.config.ensemble.trendFilter).toEqual({ market: true, coin: true, interval: "4h", period: 20 });
  });

  it("marktfilter uit → alleen { market: false }; de huidige Bitcoin-stand uit de snapshot staat erbij", async () => {
    const snap = {
      mode: "paper",
      config: structuredClone(DEFAULT_ENGINE_CONFIG),
      marketFilter: { market: "BTC-EUR", ok: false, close: 1, sma: 2, interval: "1d", period: 50, checkedAt: 1, note: "Bitcoin staat onder zijn gemiddelde: de bot koopt nu niets." },
    };
    const { el, server, click, check } = await mount({ snapshot: snap });
    expect(flat(el.innerHTML)).toContain('class="st-tf-now is-block"');
    expect(flat(el.innerHTML)).toContain("<span>Bitcoin staat onder zijn gemiddelde: de bot koopt nu niets.</span>");
    check("ensemble.trendFilter.market", false);
    click("save");
    await settle();
    expect(server.puts).toEqual([{ ensemble: { trendFilter: { market: false } } }]);
  });

  it("Max. spread (%) staat bij Risicobeheer (0 = uit) en gaat als risk.maxSpreadPct mee", async () => {
    const { el, server, click, input } = await mount();
    const html = flat(el.innerHTML);
    expect(html).toMatch(/Max\. spread <span class="muted st-off">0 = uit<\/span>/);
    expect(html).toContain('data-path="risk.maxSpreadPct"');
    input("risk.maxSpreadPct", "0");
    click("save");
    await settle();
    expect(server.puts).toEqual([{ risk: { maxSpreadPct: 0 } }]);
  });

  it("Standaardwaarden: automatisch 30 munten, marktfilter aan, max. spread 0,3%", async () => {
    const config = {
      ...structuredClone(DEFAULT_ENGINE_CONFIG),
      universe: { mode: "manual" as const, count: 10, minVolumeEur: 0 },
      ensemble: { ...structuredClone(DEFAULT_ENGINE_CONFIG.ensemble), trendFilter: { market: false, coin: false, interval: "4h" as const, period: 20 } },
      risk: { ...DEFAULT_ENGINE_CONFIG.risk, maxSpreadPct: 0 },
    };
    const { server, click } = await mount({ config });
    click("defaults");
    click("save");
    await settle();
    expect(server.puts).toEqual([
      {
        ensemble: { trendFilter: { market: true, interval: "1d", period: 50 } },
        risk: { maxSpreadPct: 0.3 },
        universe: { mode: "auto", count: 30, minVolumeEur: 250_000 },
      },
    ]);
  });
});

describe("ronde 5: mislukte automatische muntkeuze (UI-3)", () => {
  it("staat in het waarschuwingsvak met een gele stip, niet als grijze uitleg onder een groene stip", async () => {
    const note = "Automatische muntkeuze mislukt: Bitvavo-fout bij GET /ticker/24h: fake — de bot gebruikt je eigen lijst (3 markten)";
    const { el } = await mount({
      snapshot: {
        mode: "paper",
        liveArmed: false,
        config: structuredClone(DEFAULT_ENGINE_CONFIG),
        activeMarkets: ["BTC-EUR", "ETH-EUR", "SOL-EUR"],
        universe: { mode: "auto", count: 3, requested: 30, updatedAt: null, note },
      },
    });
    const html = flat(el.innerHTML);
    expect(html).toContain('<div class="st-uni-now is-warn">');
    expect(html).toContain(`<div class="pn-banner pn-banner-warn st-uni-note">${note}</div>`);
    expect(html).not.toContain(`<div class="st-help">${note}</div>`);
    expect(html).not.toContain("eerste automatische keuze zodra hij draait");
  });

  it("nog geen keuze gemaakt: gewone status (groene stip, geen waarschuwingsvak)", async () => {
    const note = "Nog geen automatische keuze gemaakt: de bot gebruikt voorlopig je eigen lijst";
    const { el } = await mount({
      snapshot: {
        mode: "paper",
        liveArmed: false,
        config: structuredClone(DEFAULT_ENGINE_CONFIG),
        activeMarkets: ["BTC-EUR", "ETH-EUR", "SOL-EUR"],
        universe: { mode: "auto", count: 3, requested: 30, updatedAt: null, note },
      },
    });
    const html = flat(el.innerHTML);
    expect(html).toContain('<div class="st-uni-now">');
    expect(html).toContain(`<div class="st-help">${note}</div>`);
    expect(html).not.toContain("st-uni-note");
  });
});

describe("ronde 5: 'Alle markten toevoegen' (UI-6)", () => {
  it("zonder stablecoins/goud/verpakte munten, meeste handel eerst (volumes uit de radar)", async () => {
    const known = new Set(["BTC-EUR", "ETH-EUR", "SOL-EUR", "USDC-EUR", "PAXG-EUR", "WBTC-EUR", "AAA-EUR", "BIG-EUR", "ILQ-EUR"]);
    const radar = [
      { market: "BIG-EUR", volumeQuote24h: 9e8 },
      { market: "SOL-EUR", volumeQuote24h: 5e7 },
      { market: "ILQ-EUR", volumeQuote24h: 20_000 },
      { market: "USDC-EUR", volumeQuote24h: 6e8 },
    ];
    const snapshot = { mode: "paper", liveArmed: false, config: structuredClone(DEFAULT_ENGINE_CONFIG), activeMarkets: ["BIG-EUR", "SOL-EUR"], radar };
    const { el, server, click, clickData, toasts } = await mount({ known, snapshot });
    clickData({ uniMode: "manual" }); // eigen lijst: BTC, ETH, SOL
    const html = flat(el.innerHTML);
    expect(html).toContain("Alle markten toevoegen (3)");
    // knoppen om toe te voegen: meeste handel eerst, stablecoins e.d. achteraan
    expect([...html.matchAll(/data-add="([^"]+)"/g)].map((m) => m[1])).toEqual([
      "BIG-EUR",
      "AAA-EUR",
      "ILQ-EUR",
      "PAXG-EUR",
      "USDC-EUR",
      "WBTC-EUR",
    ]);
    clickData({ act: "markets-all" });
    expect(toasts.at(-1)).toBe(
      "info: 3 munten toegevoegd (6/400), meeste handel eerst. Overgeslagen, net als bij Automatisch: 3 stablecoins, goud- en verpakte munten. Klik op Opslaan om het te bewaren.",
    );
    click("save");
    await settle();
    const put = server.puts[0] as Fake;
    // bekend volume ≥ € 250.000, dan onbekend (op naam), dan te weinig handel; geen USDC/PAXG/WBTC
    expect(put.markets).toEqual(["BTC-EUR", "ETH-EUR", "SOL-EUR", "BIG-EUR", "AAA-EUR", "ILQ-EUR"]);
  });
});

// ── Ronde 6: meerdere bots (elk met een eigen profiel en eigen instellingen) ──

describe("Standaardwaarden op het dashboard van een profiel-bot", () => {
  const scalperInfo = {
    mode: "paper",
    liveArmed: false,
    hasApiKeys: false,
    capitalLimitQuote: 50,
    paperStartingCapital: 25,
    dataSource: "simulated",
    bot: { id: "scalper", name: "Snelle scalper", short: "Scalper", color: "#e0a23a" },
  };

  it("vult de handelsstijl van DIE bot in (5 min, eigen strategieën), niet de algemene 15-minutenbot", async () => {
    const { profileEngineConfig, getProfile } = await import("../../src/bots/profiles");
    const profile = profileEngineConfig(getProfile("scalper")!);
    // de gebruiker heeft eerder de stop en het aantal trades aangepast
    const config = { ...structuredClone(profile), risk: { ...profile.risk, stopAtrMult: 2, maxTradesPerDay: 6 } };
    const { server, click, toasts, el } = await mount({ config, info: scalperInfo, known: new Set([...KNOWN, ...profile.markets]) });
    expect(String(el.innerHTML)).toContain('title="Vul de standaardinstellingen van Snelle scalper in (zijn eigen handelsstijl; nog niet opgeslagen)"');
    click("defaults");
    expect(toasts.at(-1)).toBe("info: Standaardwaarden van Snelle scalper ingevuld. Klik op Opslaan om ze te bewaren.");
    click("save");
    await settle();
    // alleen de eigen aanpassingen gaan terug naar het profiel; interval, strategieën en munten blijven die van de scalper
    expect(server.puts).toEqual([{ risk: { stopAtrMult: 1.2, maxTradesPerDay: 30 } }]);
    expect(server.config.interval).toBe("5m");
    expect(server.config.ensemble.enabled).toEqual(["breakout", "macd-momentum", "ema-trend", "vwap-reversion"]);
    expect(server.config.universe).toEqual({ mode: "auto", count: 60, minVolumeEur: 1_000_000 });
  });

  it("zonder bot-profiel (oudere server): de fabrieksinstellingen, zoals vroeger", async () => {
    const { click, toasts } = await mount();
    click("defaults");
    expect(toasts.at(-1)).toBe("info: Standaardwaarden ingevuld. Klik op Opslaan om ze te bewaren.");
  });
});

describe("Instellingen bij meerdere bots: teksten", () => {
  const dipInfo = {
    mode: "paper",
    liveArmed: false,
    hasApiKeys: false,
    capitalLimitQuote: 50,
    paperStartingCapital: 25,
    dataSource: "simulated",
    bot: { id: "dip", name: "Dip-koper", short: "Dip", color: "#9b6ddf" },
  };
  const four = ["scalper", "trend", "dip", "allround"].map((id) => ({ id, name: id }));

  it("eigen bestand per bot, geen MARKETS/INTERVAL-uitleg, LIVE_BOT in het voorbeeld, budget € 25 in plaats van een limiet van € 50", async () => {
    const { bus, boxes, liveBox } = await mount({ info: dipInfo, boxes: [".st-where"] });
    // één bot (of nog onbekend): de oude tekst
    expect(liveBox.innerHTML).toContain("CAPITAL_LIMIT_EUR=50");
    expect(liveBox.innerHTML).not.toContain("LIVE_BOT");
    bus.emit("bots", { bots: four, error: null, at: 1 });
    const where = String(boxes[".st-where"].innerHTML).replace(/\s+/g, " ");
    expect(where).toContain("Dit zijn de instellingen van <b>Dip-koper</b>; de andere bots hebben elk hun eigen instellingen.");
    expect(where).toContain('<span class="mono">&lt;DATA_DIR&gt;/bots/dip/config.json</span> (standaard <span class="mono">data/bots/dip/config.json</span>)');
    expect(where).not.toContain("MARKETS");
    const live = String(liveBox.innerHTML).replace(/\s+/g, " ");
    expect(live).toContain("TRADING_MODE=live LIVE_BOT=dip BITVAVO_API_KEY=");
    expect(live).toContain("kiest Dip-koper als de enige bot die met echt geld handelt");
    expect(live).toContain('<span class="muted">Budget (oefengeld)</span><span><span class="mono">€ 25,00</span></span>');
    expect(live).not.toContain(">Kapitaallimiet<");
  });

  it("lijst van bots al bekend vóór het mounten (overzicht op /): meteen de teksten van deze bot", async () => {
    const { el, liveBox } = await mount({ info: dipInfo, bots: four });
    expect(String(el.innerHTML)).toContain("&lt;DATA_DIR&gt;/bots/dip/config.json");
    expect(liveBox.innerHTML).toContain("LIVE_BOT=dip");
  });

  it("één bot (BOTS=allround): alles zoals vroeger", async () => {
    const { bus, el, liveBox } = await mount({ info: { ...dipInfo, bot: { id: "allround", name: "Allrounder", short: "Allround", color: "#2fb67c" } } });
    bus.emit("bots", { bots: [{ id: "allround" }], error: null, at: 1 });
    expect(String(el.innerHTML)).toContain("&lt;DATA_DIR&gt;/config.json");
    expect(liveBox.innerHTML).not.toContain("LIVE_BOT");
    expect(liveBox.innerHTML).toContain(">Kapitaallimiet<");
  });
});
