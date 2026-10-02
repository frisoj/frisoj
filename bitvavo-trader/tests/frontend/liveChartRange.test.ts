/**
 * Live-grafiek (public/js/liveChart.js): wat de grafiek in beeld zet als er candles van een
 * munt binnenkomen. Gebruikersmelding: bij een illiquide munt (EPIC-EUR: weinig candles, met
 * gaten) stonden een paar candles klein links in de hoek met een grote lege vlakte ernaast.
 * Oorzaak: de weergave (logisch bereik) van de VORIGE munt bleef staan als het verversen bij
 * "terug naar Live" het eerste laden van de nieuwe munt inhaalde (Scanner → "Bekijk grafiek"),
 * en een weergave die gezet werd terwijl Live verborgen was (breedte 0) ging verloren.
 */
import { describe, expect, it, vi } from "vitest";
import { type Fake, fakeNode, installBrowserGlobals, loadPublic, makeBus, settle } from "./helpers";

const { initialRange, keepRange, fillsWidth, BAR_PX, MAX_BAR_PX } = await loadPublic("js/liveChart.js");

describe("initialRange (eerste weergave van een munt)", () => {
  it("genoeg candles: de laatste breedte/7 candles met 5 candles ruimte rechts (zoals altijd)", () => {
    expect(BAR_PX).toBe(7);
    expect(initialRange(300, 1022)).toEqual({ from: 300 - 146, to: 305 });
    // grenzen 40..170 candles
    expect(initialRange(300, 100)).toEqual({ from: 260, to: 305 });
    expect(initialRange(300, 5000)).toEqual({ from: 130, to: 305 });
    // onbekende breedte (verborgen) → 800 px
    expect(initialRange(300, 0)).toEqual(initialRange(300, 800));
  });

  it("illiquide munt (weinig candles): allemaal in beeld over de volle breedte, weinig lege ruimte", () => {
    for (const [n, w] of [
      [12, 1022],
      [12, 368],
      [30, 1022],
      [60, 1022],
      [100, 1022],
    ]) {
      const r = initialRange(n, w);
      // alle candles (index 0..n-1) in beeld
      expect(r.from).toBeLessThanOrEqual(0);
      expect(r.to).toBeGreaterThanOrEqual(n - 1);
      // ruimte links hooguit één candle, rechts hooguit 5 en naar verhouding
      expect(r.from).toBeGreaterThanOrEqual(-1);
      expect(r.to - (n - 1)).toBeLessThanOrEqual(Math.max(2, Math.ceil(n / 20) + 1));
    }
    expect(initialRange(12, 1022)).toEqual({ from: -1, to: 13 });
    // het oude gedrag (from −2, to n+5) liet bij 12 candles ruim een derde leeg
    const r = initialRange(12, 1022);
    expect((12 / (r.to - r.from)) * 100).toBeGreaterThan(80);
  });

  it("een handvol candles: niet breder dan MAX_BAR_PX per candle, nieuwste rechts", () => {
    const r = initialRange(3, 1022);
    expect(1022 / (r.to - r.from)).toBeLessThanOrEqual(MAX_BAR_PX);
    expect(r.to).toBe(4); // nieuwste candle (index 2) met één candle ruimte rechts
    expect(r.from).toBeLessThan(0);
    const one = initialRange(1, 368);
    expect(one.to).toBe(2);
    expect(368 / (one.to - one.from)).toBeLessThanOrEqual(MAX_BAR_PX);
  });

  it("rommel: geen fout", () => {
    expect(initialRange(0, 800)).toEqual({ from: expect.any(Number), to: 1 });
    expect(initialRange(Number.NaN, Number.NaN).to).toBe(1);
  });
});

describe("keepRange (weergave behouden na verversen van dezelfde munt)", () => {
  it("ingezoomd of verschoven: blijft staan", () => {
    expect(keepRange({ from: 120, to: 200 }, 300)).toEqual({ from: 120, to: 200 });
    expect(keepRange({ from: -3, to: 20 }, 300)).toEqual({ from: -3, to: 20 });
  });

  it("bereik waarin (bijna) geen candles vallen: niet behouden", () => {
    // bereik van een munt met 300 candles, nu maar 12 candles: zou klein links in de hoek komen
    expect(keepRange({ from: 157, to: 305 }, 12)).toBeNull();
    expect(keepRange({ from: 11, to: 40 }, 12)).toBeNull(); // maar één candle in beeld
    expect(keepRange({ from: -50, to: 0.5 }, 12)).toBeNull();
    expect(keepRange(null, 12)).toBeNull();
    expect(keepRange({ from: 5, to: 5 }, 12)).toBeNull();
    expect(keepRange({ from: Number.NaN, to: 5 }, 12)).toBeNull();
    expect(keepRange({ from: 0, to: 10 }, 0)).toBeNull();
  });
});

// ───────────── Met de echte module gemount (nep-grafiekbibliotheek die meeschrijft) ─────────────

/** Nep-object: elk veld en elke aanroep geeft weer hetzelfde nep-object */
function anyFake(): Fake {
  const any: Fake = new Proxy(function () {}, {
    get: (_t, k) => (k === "then" || k === Symbol.iterator ? undefined : k === Symbol.toPrimitive ? () => 0 : any),
    apply: () => any,
  });
  return any;
}

/** Grafiekbibliotheek die per grafiek het gezette logische bereik bijhoudt */
function recordingCharts(paneWidth: () => number) {
  const any = anyFake();
  const charts: { ts: Fake; opts: Fake[] }[] = [];
  const lib = new Proxy(
    {},
    {
      get: (_t, k) => {
        if (k === "then") return undefined;
        if (k !== "createChart") return any;
        return () => {
          const ts: Fake = { range: null, sets: [] as unknown[], sizeCbs: [] as (() => void)[] };
          const tsApi = new Proxy(ts, {
            get: (t, k2) => {
              if (k2 === "setVisibleLogicalRange") return (r: Fake) => void (t.range = { ...r }, t.sets.push({ ...r }));
              if (k2 === "getVisibleLogicalRange") return () => (t.range ? { ...t.range } : null);
              if (k2 === "subscribeSizeChange") return (cb: () => void) => void t.sizeCbs.push(cb);
              return any;
            },
          });
          const opts: Fake[] = [];
          const chart = new Proxy(function () {}, {
            get: (_t2, k2) =>
              k2 === "timeScale"
                ? () => tsApi
                : k2 === "paneSize"
                  ? () => ({ width: paneWidth(), height: 300 })
                  : k2 === "applyOptions"
                    ? (o: Fake) => void opts.push(o)
                    : k2 === "then"
                      ? undefined
                      : any,
            apply: () => any,
          });
          charts.push({ ts, opts });
          return chart;
        };
      },
    },
  );
  return { lib, charts };
}

/** Container waarin elk gezocht element bestaat (werkbalk, legendes) */
function looseEl(): Fake {
  const kids: Record<string, Fake> = {};
  const el: Fake = fakeNode({
    querySelector: (sel: string) => (kids[sel] ||= looseEl()),
    querySelectorAll: () => [],
    removeAttribute() {},
    getAttribute: () => null,
  });
  el.style = { setProperty() {}, removeProperty() {} };
  return el;
}

const HOUR = 3_600_000;
/** `n` candles met gaten (zoals Bitvavo zonder handel geen candle geeft) */
function sparseCandles(n: number, gap = 7) {
  return Array.from({ length: n }, (_, i) => {
    const p = 1 + i / 100;
    return { time: 1_700_000_000_000 + i * gap * HOUR, open: p, high: p * 1.01, low: p * 0.99, close: p, volume: 3 };
  });
}

async function mountChart({ width = 1022 } = {}) {
  const env = installBrowserGlobals();
  vi.spyOn(globalThis, "setInterval").mockImplementation((() => 0) as unknown as typeof setInterval);
  let now = 1_800_000_000_000;
  vi.spyOn(Date, "now").mockImplementation(() => now);
  Object.assign((globalThis as unknown as { document: Fake }).document, { addEventListener() {}, removeEventListener() {} });
  const { mountLiveChart } = await loadPublic("js/liveChart.js");
  const { fmt, esc } = await loadPublic("js/format.js");
  const bus = makeBus();
  let visibleWidth = width;
  const els: Fake = { tabsEl: looseEl(), ...Object.fromEntries(["toolbarEl", "stackEl", "mainEl", "rsiEl", "macdEl"].map((k) => [k, looseEl()])) };
  Object.defineProperty(els.mainEl, "clientWidth", { get: () => visibleWidth });
  const { lib, charts } = recordingCharts(() => visibleWidth);
  // Chart-verzoeken (limit 300) wachten tot de test ze afhandelt; de 24u-cijfers niet.
  const pending: { market: string; resolve: (v: unknown) => void }[] = [];
  const getCandles = vi.fn((market: string, _iv: string, limit: number) =>
    limit === 300 ? new Promise((resolve) => pending.push({ market, resolve })) : Promise.resolve({ candles: [] }),
  );
  const snap = { config: { markets: ["BTC-EUR", "EPIC-EUR"], interval: "1h" }, activeMarkets: ["BTC-EUR", "EPIC-EUR"], positions: [], prices: {}, radar: [] };
  let sel = "BTC-EUR";
  bus.on("market-selected", (d: unknown) => {
    sel = (d as { market: string }).market;
  });
  mountLiveChart(
    { api: { getCandles }, bus, fmt, esc, theme: {}, getState: () => snap, getSelectedMarket: () => sel, LightweightCharts: lib },
    els,
  );
  const main = () => charts[0].ts;
  return {
    env,
    bus,
    pending,
    main,
    charts,
    setWidth: (w: number) => (visibleWidth = w),
    advance: (ms: number) => (now += ms),
    /** Beantwoordt verzoek `i` (volgorde van aanvragen) */
    async answer(i: number, candles: unknown[]) {
      pending[i].resolve({ market: pending[i].market, candles, indicators: {} });
      await settle();
    },
  };
}

describe("live-grafiek: weergave bij een illiquide munt", () => {
  it("munt gekozen in de Scanner, verversen bij 'terug naar Live' haalt het laden in: toch alle candles in beeld", async () => {
    const t = await mountChart();
    try {
      // BTC-EUR met 300 candles: laatste 146 in beeld
      expect(t.pending.map((p) => p.market)).toEqual(["BTC-EUR"]);
      await t.answer(0, sparseCandles(300, 1));
      expect(t.main().range).toEqual({ from: 154, to: 305 });

      // Scanner → "Bekijk grafiek": EPIC-EUR (eerste laden, nog onderweg) …
      t.bus.emit("market-selected", { market: "EPIC-EUR" });
      // … en meteen naar Live, ruim een minuut na het vorige laden: verversen
      t.advance(61_000);
      t.bus.emit("tab-changed", { tab: "live" });
      expect(t.pending.map((p) => p.market)).toEqual(["BTC-EUR", "EPIC-EUR", "EPIC-EUR"]);

      // Het verversen komt binnen; het eerste laden telt niet meer (ouder verzoek)
      await t.answer(2, sparseCandles(12));
      await t.answer(1, sparseCandles(12));
      const r = t.main().range;
      // Niet het bereik van BTC-EUR (154–305): dan stonden 12 candles klein links
      expect(r).toEqual(initialRange(12, 1022));
      expect(r).toEqual({ from: -1, to: 13 });
      // alle drie de grafieken (koers, RSI, MACD) hetzelfde bereik
      for (const c of t.charts) expect(c.ts.range).toEqual(r);
    } finally {
      vi.restoreAllMocks();
      t.env.restore();
    }
  });

  it("verversen van dezelfde munt: ingezoomde weergave blijft staan", async () => {
    const t = await mountChart();
    try {
      await t.answer(0, sparseCandles(300, 1));
      // gebruiker zoomt in
      t.main().range = { from: 250, to: 290 };
      t.advance(61_000);
      t.bus.emit("tab-changed", { tab: "live" });
      await t.answer(1, sparseCandles(300, 1));
      expect(t.main().range).toEqual({ from: 250, to: 290 });
      // minder candles dan het bereik (bijv. na een storing): standaardweergave
      t.advance(61_000);
      t.bus.emit("tab-changed", { tab: "live" });
      await t.answer(2, sparseCandles(12));
      expect(t.main().range).toEqual({ from: -1, to: 13 });
    } finally {
      vi.restoreAllMocks();
      t.env.restore();
    }
  });

  it("candles binnen terwijl Live verborgen is: weergave pas zodra de grafiek een breedte heeft", async () => {
    const t = await mountChart({ width: 0 });
    try {
      await t.answer(0, sparseCandles(12));
      // zonder breedte gaat een weergave verloren: nog niets gezet
      expect(t.main().sets).toEqual([]);
      // terug naar Live: de grafiek krijgt een breedte (lightweight-charts meldt de nieuwe maat)
      t.setWidth(368);
      for (const c of t.charts) for (const cb of c.ts.sizeCbs) cb();
      t.env.flushRaf();
      expect(t.main().range).toEqual(initialRange(12, 368));
      // daarna gewoon verversen: blijft staan
      const sets = t.main().sets.length;
      t.bus.emit("tab-changed", { tab: "live" });
      t.env.flushRaf();
      expect(t.main().sets.length).toBe(sets);
    } finally {
      vi.restoreAllMocks();
      t.env.restore();
    }
  });

  it("verborgen en geen maatmelding: bij 'terug naar Live' alsnog gezet", async () => {
    const t = await mountChart({ width: 0 });
    try {
      await t.answer(0, sparseCandles(40));
      expect(t.main().sets).toEqual([]);
      t.setWidth(1022);
      t.bus.emit("tab-changed", { tab: "live" });
      t.env.flushRaf();
      expect(t.main().range).toEqual(initialRange(40, 1022));
      expect(t.main().range.from).toBeLessThanOrEqual(0);
    } finally {
      vi.restoreAllMocks();
      t.env.restore();
    }
  });
});

// Ronde 6: na het groter/kleiner maken van het venster stonden de candles van een illiquide munt
// weer klein rechts (telefoon → desktop: 71% leeg links), want lightweight-charts houdt bij een
// andere breedte de candlebreedte vast. Oplossing: dan de weergave vasthouden
// (timeScale.lockVisibleTimeRangeOnResize), maar alleen als alle candles de breedte vullen.
describe("live-grafiek: weergave blijft bij een andere vensterbreedte", () => {
  it("fillsWidth: alleen bij minder candles dan er in beeld passen", () => {
    expect(fillsWidth(25, 390)).toBe(true);
    expect(fillsWidth(25, 1440)).toBe(true);
    expect(fillsWidth(146, 1022)).toBe(true);
    expect(fillsWidth(147, 1022)).toBe(false);
    expect(fillsWidth(300, 1440)).toBe(false);
    expect(fillsWidth(0, 1022)).toBe(false);
    expect(fillsWidth(Number.NaN, Number.NaN)).toBe(false);
  });

  const lockOf = (c: { opts: Fake[] }) =>
    c.opts.filter((o) => o && o.timeScale && "lockVisibleTimeRangeOnResize" in o.timeScale).map((o) => o.timeScale.lockVisibleTimeRangeOnResize);

  it("illiquide munt: alle drie de grafieken houden hun weergave vast; daarna een gewone munt: weer los", async () => {
    const t = await mountChart({ width: 390 });
    try {
      await t.answer(0, sparseCandles(25));
      expect(t.main().range).toEqual(initialRange(25, 390));
      for (const c of t.charts) expect(lockOf(c)).toEqual([true]);
      // andere munt met genoeg candles: bij een breder venster gewoon meer candles in beeld
      t.bus.emit("market-selected", { market: "EPIC-EUR" });
      await t.answer(1, sparseCandles(300, 1));
      for (const c of t.charts) expect(lockOf(c)).toEqual([true, false]);
      // nog eens een gewone munt: geen overbodige aanroep
      t.advance(61_000);
      t.bus.emit("tab-changed", { tab: "live" });
      await t.answer(2, sparseCandles(300, 1));
      for (const c of t.charts) expect(lockOf(c)).toEqual([true, false]);
    } finally {
      vi.restoreAllMocks();
      t.env.restore();
    }
  });
});
