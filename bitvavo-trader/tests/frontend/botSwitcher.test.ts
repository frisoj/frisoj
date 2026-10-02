/**
 * Botwisselaar in de kopbalk (v3, public/js/header.js: switcherView, pageTitle,
 * mountBotSwitcher) en de gedeelde hulpjes in public/js/bots.js. Echte modules, nep-DOM.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fakeNode, loadPublic, makeBus, type Fake } from "./helpers";

const norm = (s: string) => s.replace(/\s+/g, " ");

const B = (id: string, short: string, pct: number, over: Fake = {}) => ({
  id,
  name: `${short}-bot`,
  short,
  color: "#3987e5",
  path: `/bot/${id}/`,
  running: true,
  mode: "paper",
  liveArmed: false,
  totalReturnPct: pct,
  ...over,
});
const FOUR = () => [
  B("scalper", "Scalper", -1.84, { color: "#e0a23a" }),
  B("trend", "Trend", 3.24, { mode: "live", liveArmed: true }),
  B("dip", "Dip", 0.48, { running: false }),
  B("allround", "Allround", 0),
];

describe("bots.js", () => {
  it("safeColor: alleen #rgb / #rrggbb, anders een reservekleur op positie", async () => {
    const { safeColor, FALLBACK_COLORS } = await loadPublic("js/bots.js");
    expect(safeColor("#3987E5")).toBe("#3987e5");
    expect(safeColor("#abc")).toBe("#abc");
    expect(safeColor("red")).toBe(FALLBACK_COLORS[0]);
    expect(safeColor("#3987e5;background:url(x)", 2)).toBe(FALLBACK_COLORS[2]);
    expect(safeColor(undefined, 9)).toBe(FALLBACK_COLORS[9 % FALLBACK_COLORS.length]);
  });

  it("botHref: /bot/<id>/ (+ #tab), alleen een veilig pad van de server", async () => {
    const { botHref } = await loadPublic("js/bots.js");
    expect(botHref({ id: "trend", path: "/bot/trend/" })).toBe("/bot/trend/");
    expect(botHref({ id: "trend" }, "settings")).toBe("/bot/trend/#settings");
    expect(botHref({ id: "trend", path: "javascript:alert(1)" })).toBe("/bot/trend/");
    expect(botHref({ id: "a b/c" })).toBe("/bot/a%20b%2Fc/");
  });

  it("normalizeBots: volgorde van de server, zonder lege/dubbele ids, met naam, korte naam en kleur", async () => {
    const { normalizeBots } = await loadPublic("js/bots.js");
    expect(normalizeBots(null)).toBeNull();
    expect(normalizeBots({ error: "x" })).toBeNull();
    const l = normalizeBots([{ id: "b", name: "Bee" }, null, { id: "" }, { id: "a", short: "A", color: "#123456" }, { id: "b" }]);
    expect(l.map((b: Fake) => [b.id, b.name, b.short, b.href])).toEqual([
      ["b", "Bee", "Bee", "/bot/b/"],
      ["a", "A", "A", "/bot/a/"],
    ]);
    expect(l[1].color).toBe("#123456");
    expect(normalizeBots({ bots: [{ id: "x" }] })).toHaveLength(1);
  });

  it("currentBotId: pad /bot/<id>/, anders info.bot (root = standaardbot), anders de eerste", async () => {
    const { currentBotId } = await loadPublic("js/bots.js");
    const bots = FOUR();
    expect(currentBotId(bots, { bot: { id: "trend" } }, "/bot/dip/")).toBe("dip");
    expect(currentBotId(bots, { bot: { id: "trend" } }, "/")).toBe("trend");
    expect(currentBotId(bots, null, "/")).toBe("scalper");
    expect(currentBotId(null, null, "/")).toBe("");
  });
});

describe("switcherView en paginatitel", () => {
  it("verborgen (null) zonder lijst of met één bot", async () => {
    const { switcherView } = await loadPublic("js/header.js");
    const { fmt } = await loadPublic("js/format.js");
    expect(switcherView(null, "", fmt)).toBeNull();
    expect(switcherView([], "", fmt)).toBeNull();
    expect(switcherView([B("dip", "Dip", 1)], "dip", fmt)).toBeNull();
  });

  it("huidige bot + alle bots met totaal rendement; links houden het tabblad (Wedstrijd → Live)", async () => {
    const { switcherView } = await loadPublic("js/header.js");
    const { fmt } = await loadPublic("js/format.js");
    const v = switcherView(FOUR(), "trend", fmt, "settings");
    expect(v.current).toEqual({ id: "trend", name: "Trend-bot", short: "Trend", color: "#3987e5" });
    expect(v.items.map((i: Fake) => [i.short, i.pct, i.cls, i.href, i.current])).toEqual([
      ["Scalper", "-1,84%", "neg", "/bot/scalper/#settings", false],
      ["Trend", "+3,24%", "pos", "/bot/trend/#settings", true],
      ["Dip", "+0,48%", "pos", "/bot/dip/#settings", false],
      ["Allround", "0,00%", "flat", "/bot/allround/#settings", false],
    ]);
    expect(v.items[1].live).toBe(true);
    expect(v.items[2].running).toBe(false);
    expect(switcherView(FOUR(), "trend", fmt, "compete").items[0].href).toBe("/bot/scalper/#live");
    expect(switcherView(FOUR(), "onbekend", fmt, "").current).toBeNull();
  });

  it("paginatitel: korte botnaam eerst, dan het tabblad (niet bij Live)", async () => {
    const { pageTitle } = await loadPublic("js/header.js");
    expect(pageTitle("", "Scalper")).toBe("Scalper · Bitvavo Trader");
    expect(pageTitle("Wedstrijd", "Trend")).toBe("Trend · Wedstrijd · Bitvavo Trader");
    expect(pageTitle("Scanner", "")).toBe("Scanner · Bitvavo Trader");
    expect(pageTitle("", null)).toBe("Bitvavo Trader");
  });

  it("botnaam in de titel alleen bij meerdere bots (één bot: titel zoals vroeger)", async () => {
    const { titleBotShort } = await loadPublic("js/header.js");
    const info = (id: string, short: string) => ({ mode: "paper", bot: { id, name: `${short}-bot`, short, color: "#2fb67c" } });
    // één bot (BOTS=allround): geen naam, ook al stuurt /api/info de bot mee
    expect(titleBotShort(info("allround", "Allround"), [B("allround", "Allround", 0)], "/")).toBe("");
    expect(titleBotShort(info("allround", "Allround"), null, "/")).toBe("");
    // meerdere bots: de bot van deze pagina (pad), anders de standaardbot van /api/info
    expect(titleBotShort(info("trend", "Trend"), FOUR(), "/bot/trend/")).toBe("Trend");
    expect(titleBotShort(info("scalper", "Scalper"), FOUR(), "/")).toBe("Scalper");
    // /bot/<id>/ vóórdat de lijst er is: naam uit /api/info
    expect(titleBotShort(info("dip", "Dip"), null, "/bot/dip/")).toBe("Dip");
    // info van een andere bot dan het pad (kan niet, maar dan liever geen naam dan een verkeerde)
    expect(titleBotShort(info("dip", "Dip"), null, "/bot/trend/")).toBe("");
  });
});

describe("mountBotSwitcher", () => {
  const g = globalThis as Record<string, unknown>;
  let doc: Fake;
  let saved: Record<string, unknown>;
  beforeEach(() => {
    vi.useFakeTimers();
    saved = { document: g.document, location: g.location };
    const listeners: Record<string, ((e: unknown) => void)[]> = {};
    doc = {
      hidden: false,
      listeners,
      body: fakeNode(),
      addEventListener: (t: string, fn: (e: unknown) => void) => (listeners[t] ||= []).push(fn),
      fire: (t: string, e: unknown = {}) => (listeners[t] || []).forEach((fn) => fn(e)),
    };
    g.document = doc;
    g.location = { pathname: "/bot/trend/", hash: "#live" };
  });
  afterEach(() => {
    vi.useRealTimers();
    for (const [k, v] of Object.entries(saved)) {
      if (v === undefined) delete g[k];
      else g[k] = v;
    }
  });

  async function mount(result: Fake[] | Error, tab = "live") {
    const { mountBotSwitcher } = await loadPublic("js/header.js");
    const { fmt, esc } = await loadPublic("js/format.js");
    let current = result;
    let active = tab;
    const api = {
      getBots: vi.fn(async () => {
        if (current instanceof Error) throw current;
        return current;
      }),
    };
    const bus = makeBus();
    const el = fakeNode({ hidden: true });
    mountBotSwitcher({ api, bus, fmt, esc, getActiveTab: () => active, getInfo: () => null }, el);
    await vi.advanceTimersByTimeAsync(0);
    const click = (sel: string) => {
      const ev = { target: { closest: (s: string) => (s === sel ? {} : null) } };
      el.fire("click", ev);
      doc.fire("click", ev); // hetzelfde event bubbelt daarna naar document
    };
    return {
      el,
      bus,
      api,
      html: () => norm(el.innerHTML),
      click,
      setResult: (r: Fake[] | Error) => {
        current = r;
      },
      setTab: (t: string) => {
        active = t;
        bus.emit("tab-changed", { tab: t });
      },
    };
  }

  it("meerdere bots: naam + kleur van deze bot, lijst met rendement, klasse multi-bot op body", async () => {
    const s = await mount(FOUR());
    expect(s.el.hidden).toBe(false);
    expect(doc.body.classList.contains("multi-bot")).toBe(true);
    const h = s.html();
    expect(h).toMatch(/<span class="bs-name">Trend<\/span>/);
    expect(h).toContain('style="background:#3987e5"');
    expect(h).toContain('href="/bot/dip/#live"');
    expect(h).toContain("+3,24%");
    expect(h).toContain("-1,84%");
    expect(h).toContain('aria-current="page"');
    expect(h).toContain("actief · echt geld · je kijkt hier");
    expect(h).toContain("Vergelijk alle bots");
    expect(h).toContain('class="bs-menu" id="bs-menu" hidden');
    expect(s.bus.emitted.some((e) => e.type === "bots" && Array.isArray((e.data as Fake).bots))).toBe(true);
  });

  it("één bot → verborgen; 404 → verborgen (en de fout gaat mee in het event)", async () => {
    const one = await mount([B("dip", "Dip", 1)]);
    expect(one.el.hidden).toBe(true);
    expect(doc.body.classList.contains("multi-bot")).toBe(false);
    const none = await mount(Object.assign(new Error("Niet gevonden"), { status: 404 }));
    expect(none.el.hidden).toBe(true);
    expect(none.bus.emitted.find((e) => e.type === "bots")?.data).toMatchObject({ bots: null, error: { status: 404 } });
  });

  it("server geeft later 404 → wisselaar verdwijnt; tijdelijke fout → laatste lijst blijft", async () => {
    const { SWITCHER_IDLE_MS } = await loadPublic("js/header.js");
    const s = await mount(FOUR());
    s.setResult(new Error("Failed to fetch"));
    await vi.advanceTimersByTimeAsync(SWITCHER_IDLE_MS);
    expect(s.api.getBots).toHaveBeenCalledTimes(2);
    expect(s.el.hidden).toBe(false);
    s.setResult(Object.assign(new Error("Niet gevonden"), { status: 404 }));
    await vi.advanceTimersByTimeAsync(SWITCHER_IDLE_MS);
    expect(s.api.getBots).toHaveBeenCalledTimes(3);
    expect(s.el.hidden).toBe(true);
    // zonder wedstrijd (404) niet elke 15 s opnieuw proberen
    await vi.advanceTimersByTimeAsync(60_000);
    expect(s.api.getBots).toHaveBeenCalledTimes(3);
  });

  it("nog geen lijst (server nog niet klaar): elke 15 s opnieuw, na fouten trager", async () => {
    const s = await mount(new Error("Failed to fetch"));
    expect(s.el.hidden).toBe(true);
    expect(s.api.getBots).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(15_000); // na 1 fout: 15 s
    expect(s.api.getBots).toHaveBeenCalledTimes(2);
    s.setResult(FOUR());
    await vi.advanceTimersByTimeAsync(15_000); // na 2 fouten: 30 s
    expect(s.api.getBots).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(15_000);
    expect(s.api.getBots).toHaveBeenCalledTimes(3);
    expect(s.el.hidden).toBe(false);
  });

  it("openen en sluiten: klik op de knop, klik ernaast, Escape", async () => {
    const s = await mount(FOUR());
    s.click('[data-bs="toggle"]');
    expect(s.html()).toContain('aria-expanded="true"');
    expect(s.html()).not.toContain('id="bs-menu" hidden');
    // klik ergens anders op de pagina
    doc.fire("click", { target: {} });
    expect(s.html()).toContain('aria-expanded="false"');
    s.click('[data-bs="toggle"]');
    doc.fire("keydown", { key: "Escape" });
    expect(s.html()).toContain('aria-expanded="false"');
    // "Vergelijk alle bots" sluit het menu (de link zelf gaat naar #compete)
    s.click('[data-bs="toggle"]');
    s.click('[data-bs="compete"]');
    expect(s.html()).toContain('aria-expanded="false"');
  });

  it("ander tabblad → links naar hetzelfde tabblad van de andere bot", async () => {
    const s = await mount(FOUR());
    s.setTab("settings");
    expect(s.html()).toContain('href="/bot/scalper/#settings"');
    s.setTab("compete");
    expect(s.html()).toContain('href="/bot/scalper/#live"');
  });

  it("menu dicht: hooguit elke 5 min verversen (de knop toont geen cijfers)", async () => {
    const { SWITCHER_IDLE_MS } = await loadPublic("js/header.js");
    expect(SWITCHER_IDLE_MS).toBe(300_000);
    const s = await mount(FOUR());
    expect(s.api.getBots).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(120_000);
    expect(s.api.getBots).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(SWITCHER_IDLE_MS - 120_000);
    expect(s.api.getBots).toHaveBeenCalledTimes(2);
  });

  it("menu open: meteen verse cijfers en daarna elke ~15 s; niet als de pagina verborgen is of Wedstrijd net ververste", async () => {
    const s = await mount(FOUR());
    await vi.advanceTimersByTimeAsync(10_000);
    s.click('[data-bs="toggle"]'); // openen: lijst is 10 s oud → verversen
    await vi.advanceTimersByTimeAsync(0);
    expect(s.api.getBots).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(20_000); // ronde van 15 s na het openen
    expect(s.api.getBots).toHaveBeenCalledTimes(3);
    await vi.advanceTimersByTimeAsync(10_000);
    // het tabblad Wedstrijd haalde net de lijst op (bus-event) → volgende ronde overslaan
    s.bus.emit("bots", { bots: FOUR(), error: null, at: Date.now() });
    await vi.advanceTimersByTimeAsync(5_000);
    expect(s.api.getBots).toHaveBeenCalledTimes(3);
    doc.hidden = true;
    await vi.advanceTimersByTimeAsync(60_000);
    expect(s.api.getBots).toHaveBeenCalledTimes(3);
    doc.hidden = false;
    doc.fire("visibilitychange");
    await vi.advanceTimersByTimeAsync(0);
    expect(s.api.getBots).toHaveBeenCalledTimes(4);
    // weer dicht: terug naar 1× per 5 min
    doc.fire("click", { target: {} });
    await vi.advanceTimersByTimeAsync(60_000);
    expect(s.api.getBots).toHaveBeenCalledTimes(4);
  });

  it("gegevens van elders (bus-event 'bots') tonen zonder zelf op te halen", async () => {
    const s = await mount([B("dip", "Dip", 1)]);
    expect(s.el.hidden).toBe(true);
    s.bus.emit("bots", { bots: FOUR(), error: null, at: Date.now() });
    expect(s.el.hidden).toBe(false);
    expect(s.api.getBots).toHaveBeenCalledTimes(1);
  });
});
