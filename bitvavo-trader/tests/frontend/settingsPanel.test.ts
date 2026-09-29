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

function fakeServer() {
  let config: EngineConfig = structuredClone(DEFAULT_ENGINE_CONFIG);
  const puts: unknown[] = [];
  const put = (patch: unknown): EngineConfig => {
    const valid = validateConfigPatch(patch, config, {
      knownEurMarkets: KNOWN,
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
    info: async () => ({ mode: "paper", liveArmed: false, hasApiKeys: false, capitalLimitQuote: 50, dataSource: "simulated" }),
    getMarkets: async () => [...KNOWN].map((market) => ({ market })),
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

async function mount() {
  const { mountSettings } = await loadPublic("js/panels/settings.js");
  const { fmt, esc } = await loadPublic("js/format.js");
  const server = fakeServer();
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
  const el = fakeNode({ querySelector: (sel: string) => boxes[sel] ?? null });
  const ctx = {
    fmt,
    esc,
    api: server.api,
    bus,
    toast: (m: string, k: string) => toasts.push(`${k}: ${m}`),
    getInfo: () => null,
    getState: () => null,
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
  return {
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
