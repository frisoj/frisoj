// Live-grafiek (A9): marktbalk, candlestick-grafiek met indicatoren, markers
// voor signalen en trades, prijslijnen voor open posities, RSI- en MACD-pane.
// Alle drie de grafieken delen tijdas en crosshair.
//
// Veel munten (v2, tot 400): de marktbalk toont hooguit MAX_TABS tabs (gekozen markt,
// posities, beste koopkansen, dan de volgorde van de bot) plus een knop "Alle munten"
// met een doorzoekbare lijst. 24u-statistieken/sparklines alleen voor de zichtbare tabs.

import { botMarkets } from "./format.js";

const INTERVAL_MS = {
  "1m": 60_000,
  "5m": 300_000,
  "15m": 900_000,
  "30m": 1_800_000,
  "1h": 3_600_000,
  "2h": 7_200_000,
  "4h": 14_400_000,
  "6h": 21_600_000,
  "8h": 28_800_000,
  "12h": 43_200_000,
  "1d": 86_400_000,
};

const LS_TOGGLES = "bvt-chart-toggles";
const DEFAULT_TOGGLES = {
  ema9: true,
  ema21: true,
  ema200: true,
  bb: false,
  vwap: false,
  volume: true,
  signals: true,
  trades: true,
};

const COLORS = {
  ema9: "#f4b63a",
  ema21: "#b57bff",
  ema200: "rgba(227, 232, 242, 0.75)",
  bb: "rgba(56, 189, 248, 0.75)",
  bbMid: "rgba(56, 189, 248, 0.4)",
  vwap: "#ff7ab6",
  rsi: "#a78bfa",
  macd: "#4f86ff",
  macdSignal: "#ff9f43",
};

const TOGGLE_DEFS = [
  { key: "ema9", label: "EMA 9", color: COLORS.ema9, tip: "Snel voortschrijdend gemiddelde (9 candles)" },
  { key: "ema21", label: "EMA 21", color: COLORS.ema21, tip: "Middellang voortschrijdend gemiddelde (21 candles)" },
  { key: "ema200", label: "EMA 200", color: "#cfd6e4", tip: "Lange-termijn trend (200 candles)" },
  { key: "bb", label: "Bollinger", color: "#38bdf8", tip: "Bollinger Bands (20, 2): beweeglijkheidsband rond het gemiddelde" },
  { key: "vwap", label: "VWAP", color: COLORS.vwap, tip: "Volume-gewogen gemiddelde prijs van vandaag" },
  { key: "volume", label: "Volume", color: "#7e889d", tip: "Handelsvolume per candle" },
  { key: "signals", label: "Signalen", color: "#4f86ff", tip: "Koop/verkoop-signalen van de strategieën (bolletjes)" },
  { key: "trades", label: "Trades", color: "#1ec580", tip: "Aan- en verkopen van de bot (pijlen)" },
];

const COIN_COLORS = {
  BTC: "#f7931a",
  ETH: "#8c9eff",
  SOL: "#14f195",
  XRP: "#5ab0e8",
  ADA: "#4a7dff",
  DOGE: "#d4b44a",
  DOT: "#e6007a",
  LINK: "#4a7dff",
  AVAX: "#e84142",
  LTC: "#b8c2d6",
  MATIC: "#8247e5",
  POL: "#8247e5",
  SHIB: "#ffa409",
  TRX: "#ff4d4d",
  BNB: "#f3ba2f",
  PEPE: "#4caf50",
};

export function coinColor(base) {
  if (COIN_COLORS[base]) return COIN_COLORS[base];
  let h = 0;
  for (let i = 0; i < base.length; i++) h = (h * 31 + base.charCodeAt(i)) % 360;
  return `hsl(${h} 70% 62%)`;
}

/** Maximaal aantal markttabs in de marktbalk (de rest via "Alle munten") */
export const MAX_TABS = 12;
/** 24u-cijfers van een tab zijn zo lang "vers"; na een mislukte poging pas na STATS_RETRY_MS opnieuw */
const STATS_TTL_MS = 4.5 * 60_000;
const STATS_RETRY_MS = 60_000;

/**
 * Welke markten als tab in de marktbalk staan (hooguit `max`).
 * Passen alle markten van de bot (plus een losse gekozen markt), dan staan ze er allemaal,
 * in de volgorde van de bot. Anders gaat het op voorrang: de gekozen markt, markten met een
 * open positie, de beste koopkansen (radar-`rank`), dan de volgorde van de bot. Die tabs
 * staan in een vaste volgorde (posities, kansen, de rest in botvolgorde, een losse markt
 * achteraan), zodat een klik op een zichtbare tab de balk niet door elkaar gooit.
 * @param {{ selected?: string|null, active?: string[], positions?: string[], radar?: object[]|null, max?: number }} o
 * @returns {{ tabs: string[], extra: string[], hidden: number, total: number }}
 *   `extra` = tabs die niet bij de bot horen (alleen bekijken), `hidden` = markten van de bot zonder tab
 */
export function pickTabMarkets({ selected = null, active = [], positions = [], radar = null, max = MAX_TABS } = {}) {
  const str = (m) => typeof m === "string" && m.length > 0;
  const act = [...new Set((Array.isArray(active) ? active : []).filter(str))];
  const pos = [...new Set((Array.isArray(positions) ? positions : []).filter(str))];
  const base = [...new Set([...act, ...pos])];
  const baseSet = new Set(base);
  const sel = str(selected) ? selected : null;
  const extraSel = sel && !baseSet.has(sel) ? sel : null;
  const lim = Math.max(1, Math.floor(Number(max)) || MAX_TABS);
  if (base.length + (extraSel ? 1 : 0) <= lim) {
    return { tabs: extraSel ? [...base, extraSel] : base, extra: extraSel ? [extraSel] : [], hidden: 0, total: base.length };
  }
  const ranked = (Array.isArray(radar) ? radar : [])
    .filter(
      (r) =>
        r && str(r.market) && baseSet.has(r.market) && isNum(r.rank) && (r.status === "candidate" || r.status === "blocked"),
    )
    .sort((a, b) => a.rank - b.rank)
    .map((r) => r.market);
  const chosen = new Set();
  for (const m of [sel, ...pos, ...ranked, ...act]) {
    if (chosen.size >= lim) break;
    if (m) chosen.add(m);
  }
  const tabs = [];
  const placed = new Set();
  for (const m of [...pos, ...ranked, ...act]) {
    if (chosen.has(m) && !placed.has(m)) {
      placed.add(m);
      tabs.push(m);
    }
  }
  if (extraSel) tabs.push(extraSel);
  return {
    tabs,
    extra: extraSel ? [extraSel] : [],
    hidden: base.filter((m) => !chosen.has(m)).length,
    total: base.length,
  };
}

/**
 * Zoeken in de lijst "Alle munten": eerst exact symbool ("btc" → BTC-EUR), dan markten die
 * met de zoekterm beginnen, dan markten die hem bevatten; binnen een groep de oorspronkelijke volgorde.
 */
export function filterMarketList(markets, query) {
  const list = (Array.isArray(markets) ? markets : []).filter((m) => typeof m === "string");
  const q = String(query || "")
    .trim()
    .toUpperCase()
    .replace(/[\s/]+/g, "-");
  if (!q) return list.slice();
  const exact = [];
  const starts = [];
  const contains = [];
  for (const m of list) {
    const u = m.toUpperCase();
    const base = u.split("-")[0];
    if (base === q || u === q) exact.push(m);
    else if (base.startsWith(q) || u.startsWith(q)) starts.push(m);
    else if (u.includes(q)) contains.push(m);
  }
  return [...exact, ...starts, ...contains];
}

/** Ruimte tussen een in beeld geschoven tab en de rand van de marktbalk (de vervaagde rand is 32 px) */
export const REVEAL_PAD = 36;

/**
 * Hoeveel pixels de marktbalk horizontaal moet schuiven (negatief = naar links) zodat de tab
 * helemaal in beeld staat, met `pad` ruimte tot de rand (minder als de tab anders niet past).
 * 0 = staat al in beeld. Alleen de dichtstbijzijnde rand telt ("nearest").
 * @param {{ left: number, right: number }} strip  rechthoek van de balk
 * @param {{ left: number, right: number }} tab    rechthoek van de tab
 */
export function revealDelta(strip, tab, pad = REVEAL_PAD) {
  if (!strip || !tab || ![strip.left, strip.right, tab.left, tab.right].every(isNum)) return 0;
  const room = Math.max(0, Math.min(pad, (strip.right - strip.left - (tab.right - tab.left)) / 2));
  if (tab.left < strip.left + room) return tab.left - strip.left - room;
  // rechts eruit: naar links schuiven, maar nooit zo ver dat de linkerkant van de tab wegvalt
  if (tab.right > strip.right - room) return Math.min(tab.right - strip.right + room, tab.left - strip.left - room);
  return 0;
}

/** Standaardbreedte van een candle (px) voor de eerste weergave */
export const BAR_PX = 7;
/** Bij weinig candles worden ze breder, maar niet breder dan dit (px per candle) */
export const MAX_BAR_PX = 80;

/**
 * Welk deel van de grafiek (logische indexen) we tonen als er gegevens van een (andere)
 * munt binnenkomen.
 *  - Genoeg candles: de laatste breedte/7 (40..170), met 5 candles ruimte rechts.
 *  - Minder candles dan dat (een illiquide munt zoals EPIC-EUR: weinig candles, met
 *    gaten waar niet gehandeld is): allemaal tonen over de volle breedte, met een beetje
 *    ruimte rechts, in plaats van klein links met een grote lege vlakte ernaast. Hooguit
 *    MAX_BAR_PX per candle; bij een handvol candles staan ze dus rechts (nieuwste rechts).
 * @param {number} n      aantal candles
 * @param {number} width  breedte van de grafiek in px (0 / onbekend → 800)
 * @returns {{ from: number, to: number }}
 */
export function initialRange(n, width) {
  const count = isNum(n) ? Math.max(0, Math.floor(n)) : 0;
  const w = isNum(width) && width > 0 ? width : 800;
  const bars = Math.max(40, Math.min(170, Math.round(w / BAR_PX)));
  if (count > bars) return { from: count - bars, to: count + 5 };
  const right = Math.min(5, Math.max(1, Math.round(count / 20)));
  const slots = Math.max(count + right + 1, Math.ceil(w / MAX_BAR_PX));
  return { from: count + right - slots, to: count + right };
}

/**
 * Toont initialRange() ALLE candles over de volle breedte (illiquide munt: minder candles
 * dan er in beeld passen)? Dan moet die weergave bij het groter/kleiner maken van het
 * venster blijven (lightweight-charts `lockVisibleTimeRangeOnResize`); anders houdt de
 * grafiek de candlebreedte vast en staan de candles na telefoon → desktop weer klein
 * rechts met tot 71% lege ruimte links. Met genoeg candles niet: dan komen er bij een
 * breder venster gewoon meer candles in beeld.
 */
export function fillsWidth(n, width) {
  const count = isNum(n) ? Math.max(0, Math.floor(n)) : 0;
  const w = isNum(width) && width > 0 ? width : 800;
  const bars = Math.max(40, Math.min(170, Math.round(w / BAR_PX)));
  return count > 0 && count <= bars;
}

/**
 * Mag de huidige weergave na het verversen van DEZELFDE munt blijven staan (de gebruiker
 * kan ingezoomd of verschoven hebben)? Alleen als er dan nog minstens twee candles in
 * beeld zijn; anders null (→ initialRange).
 * @param {{ from: number, to: number } | null} prev
 * @param {number} n  aantal candles na het verversen
 */
export function keepRange(prev, n) {
  if (!prev || !isNum(prev.from) || !isNum(prev.to) || !(prev.to > prev.from)) return null;
  const count = isNum(n) ? Math.floor(n) : 0;
  if (count < 1 || prev.from > count - 2 || prev.to < 1) return null;
  return { from: prev.from, to: prev.to };
}

const nfCache = new Map();
function nf(d) {
  if (!nfCache.has(d)) {
    nfCache.set(d, new Intl.NumberFormat("nl-NL", { minimumFractionDigits: d, maximumFractionDigits: d }));
  }
  return nfCache.get(d);
}
const compactNf = new Intl.NumberFormat("nl-NL", { notation: "compact", maximumFractionDigits: 2 });
const isNum = (n) => typeof n === "number" && Number.isFinite(n);

/** Aantal decimalen voor ~5 significante cijfers (zoals Bitvavo) */
function decimalsFor(price) {
  if (!isNum(price) || price <= 0) return 2;
  const mag = Math.floor(Math.log10(price));
  return Math.max(0, Math.min(8, 4 - mag));
}

function loadToggles() {
  try {
    const raw = JSON.parse(localStorage.getItem(LS_TOGGLES) || "null");
    return { ...DEFAULT_TOGGLES, ...(raw && typeof raw === "object" ? raw : {}) };
  } catch {
    return { ...DEFAULT_TOGGLES };
  }
}
function saveToggles(t) {
  try {
    localStorage.setItem(LS_TOGGLES, JSON.stringify(t));
  } catch {
    /* ignore */
  }
}

// Lokale tijd op de assen (data = UTC-seconden)
function tickMarkFormatter(time, type) {
  const d = new Date(Number(time) * 1000);
  switch (type) {
    case 0:
      return String(d.getFullYear());
    case 1:
      return d.toLocaleDateString("nl-NL", { month: "short" });
    case 2:
      return d.toLocaleDateString("nl-NL", { day: "numeric", month: "short" });
    default:
      return d.toLocaleTimeString("nl-NL", { hour: "2-digit", minute: "2-digit" });
  }
}
function timeFormatter(time) {
  const d = new Date(Number(time) * 1000);
  return `${d.toLocaleDateString("nl-NL", { weekday: "short", day: "numeric", month: "short" })} ${d.toLocaleTimeString(
    "nl-NL",
    { hour: "2-digit", minute: "2-digit" },
  )}`;
}

function sparkPath(values, w, h, pad = 1.5) {
  const v = values.filter(isNum);
  if (v.length < 2) return "";
  let min = Math.min(...v);
  let max = Math.max(...v);
  if (max - min < 1e-12) {
    max += 1;
    min -= 1;
  }
  return v
    .map((x, i) => {
      const px = (i / (v.length - 1)) * w;
      const py = h - pad - ((x - min) / (max - min)) * (h - 2 * pad);
      return `${i ? "L" : "M"}${px.toFixed(1)},${py.toFixed(1)}`;
    })
    .join("");
}

export function mountLiveChart(ctx, els) {
  const { api, bus, fmt, esc, theme } = ctx;
  const LWC = ctx.LightweightCharts || window.LightweightCharts;
  const { tabsEl, toolbarEl, stackEl, mainEl, rsiEl, macdEl } = els;

  const st = {
    market: ctx.getSelectedMarket() || null,
    interval: null,
    markets: [],
    data: null,
    candles: [],
    times: [],
    timeIndex: new Map(),
    decimals: 2,
    reqSeq: 0,
    loadedAt: 0,
    loadedKey: "",
    /** Munt|interval waarvan de candles nu in de grafiek staan (de weergave hoort daarbij) */
    shownKey: "",
    /** Eerste weergave nog niet gezet: de grafiek had geen breedte (tabblad Live verborgen) */
    rangePending: false,
    hoverIdx: null,
    hoverNote: "",
    toggles: loadToggles(),
    stats24: {},
    shownPrice: {},
    posKey: "",
    posLevels: [],
    priceLines: [],
    markerInfo: new Map(),
    refetchTimer: null,
    tabsKey: "",
    tabModel: { tabs: [], extra: [], hidden: 0, total: 0 },
    radarMap: new Map(),
    statsTried: {},
    statsBusy: false,
    statsAgain: false,
    pickerOpen: false,
    pickerList: [],
    pickerIdx: 0,
    revealQueued: false,
  };

  // ───────────── Marktbalk: tabs + "Alle munten" ─────────────

  tabsEl.innerHTML = `
    <div class="market-tabs" role="tablist" aria-label="Markten" data-strip></div>
    <div class="mkt-all-wrap" data-allwrap hidden>
      <button type="button" class="mkt-all" data-all aria-haspopup="listbox" aria-expanded="false" title="Kies uit alle munten die de bot volgt">
        <svg class="mkt-all-ico" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><rect x="4" y="4" width="6" height="6" rx="1.5"/><rect x="14" y="4" width="6" height="6" rx="1.5"/><rect x="4" y="14" width="6" height="6" rx="1.5"/><rect x="14" y="14" width="6" height="6" rx="1.5"/></svg>
        <span class="mkt-all-txt"><b>Alle munten</b><small data-all-n></small></span>
      </button>
      <div class="mkt-pop" data-pop hidden>
        <div class="mkt-pop-head">
          <input type="text" inputmode="search" class="input" data-pop-q placeholder="Zoek munt, bijv. BTC" aria-label="Zoek een munt"
            autocomplete="off" autocapitalize="characters" spellcheck="false" enterkeyhint="go" role="combobox" aria-expanded="true" aria-controls="mkt-pop-list" aria-autocomplete="list" />
          <button type="button" class="mkt-pop-x" data-pop-x aria-label="Sluiten">×</button>
        </div>
        <div class="mkt-pop-meta" data-pop-meta></div>
        <ul class="mkt-pop-list" id="mkt-pop-list" role="listbox" aria-label="Munten" data-pop-list></ul>
      </div>
    </div>`;
  const stripEl = tabsEl.querySelector("[data-strip]") || tabsEl;
  const allWrap = tabsEl.querySelector("[data-allwrap]");
  const allBtn = tabsEl.querySelector("[data-all]");
  const allN = tabsEl.querySelector("[data-all-n]");
  const pop = tabsEl.querySelector("[data-pop]");
  const popQ = tabsEl.querySelector("[data-pop-q]");
  const popMeta = tabsEl.querySelector("[data-pop-meta]");
  const popList = tabsEl.querySelector("[data-pop-list]");

  // ───────────── Overlay (laden / leeg / fout) ─────────────

  const overlay = document.createElement("div");
  overlay.className = "chart-overlay";
  overlay.innerHTML = `<span class="spinner lg"></span><span>Grafiek laden…</span>`;
  stackEl.appendChild(overlay);

  function showOverlay(kind, msg = "") {
    overlay.hidden = false;
    overlay.classList.toggle("soft", kind === "loading" && st.candles.length > 0);
    if (kind === "loading") {
      overlay.innerHTML = `<span class="spinner lg"></span><span>${esc(st.market || "")} laden…</span>`;
    } else if (kind === "empty") {
      overlay.innerHTML = `<svg viewBox="0 0 24 24" width="28" height="28" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" opacity=".6"><path d="M3 3v18h18"/><path d="M7 14h2M11 10h2M15 12h2"/></svg>
        <b>Geen data</b><span class="muted">Er zijn (nog) geen candles voor ${esc(st.market || "deze markt")}.</span>`;
    } else if (kind === "wait") {
      overlay.innerHTML = `<span class="spinner lg"></span><span class="muted">Wachten op de bot…</span>`;
    } else {
      overlay.innerHTML = `<svg viewBox="0 0 24 24" width="28" height="28" fill="none" stroke="#f2495c" stroke-width="1.8" stroke-linecap="round"><circle cx="12" cy="12" r="9"/><path d="M12 8v5M12 16h.01"/></svg>
        <b>Kon grafiek niet laden</b><span class="muted">${esc(msg)}</span>
        <button type="button" class="btn btn-sm" data-retry>Opnieuw proberen</button>`;
      overlay.querySelector("[data-retry]")?.addEventListener("click", () => load(true));
    }
  }
  const hideOverlay = () => (overlay.hidden = true);

  // ───────────── Toolbar ─────────────

  toolbarEl.innerHTML = `
    <div class="ct-row">
      <div class="ct-symbol">
        <span class="mkt-icon" data-ct-icon>–</span>
        <span data-ct-name>–</span>
        <span class="badge badge-accent" data-ct-iv title="Candle-interval van de bot">–</span>
      </div>
      <div class="ct-price" data-ct-price>–</div>
      <div class="ct-change flat" data-ct-chg>–</div>
      <div class="ct-stats" data-ct-stats></div>
    </div>
    <div class="ct-row">
      <div class="ct-toggles" role="group" aria-label="Indicatoren tonen/verbergen">
        <span class="lbl">Tonen</span>
        ${TOGGLE_DEFS.map(
          (t) =>
            `<button type="button" class="chip" data-toggle="${t.key}" aria-pressed="${!!st.toggles[t.key]}" title="${esc(
              t.tip,
            )}" style="--c:${t.color}"><span class="sw"></span>${esc(t.label)}</button>`,
        ).join("")}
      </div>
      <span class="ct-updated" data-ct-upd></span>
    </div>`;
  const tb = (sel) => toolbarEl.querySelector(sel);

  toolbarEl.addEventListener("click", (e) => {
    const b = e.target.closest("[data-toggle]");
    if (!b) return;
    const k = b.dataset.toggle;
    st.toggles[k] = !st.toggles[k];
    b.setAttribute("aria-pressed", String(st.toggles[k]));
    saveToggles(st.toggles);
    applyToggles();
    updateLegend(st.hoverIdx);
  });

  // ───────────── Legendes ─────────────

  const mkLegend = (el) => {
    const l = document.createElement("div");
    l.className = "chart-legend";
    el.appendChild(l);
    return l;
  };
  const legMain = mkLegend(mainEl);
  const legRsi = mkLegend(rsiEl);
  const legMacd = mkLegend(macdEl);

  wireBar();

  if (!LWC || typeof LWC.createChart !== "function") {
    showOverlay("error", "De grafiekbibliotheek (lightweight-charts) is niet geladen.");
    bus.on("snapshot", (s) => {
      st.markets = botMarkets(s);
      noteRadar(s);
      renderTabs();
    });
    return;
  }

  const { LineStyle, CrosshairMode, ColorType } = LWC;
  st.chartReady = true;

  // ───────────── Grafieken ─────────────

  const baseOptions = (timeVisible) => ({
    autoSize: true,
    layout: {
      background: { type: ColorType ? ColorType.Solid : "solid", color: theme.panel },
      textColor: theme.muted,
      fontSize: 11,
      fontFamily: theme.font,
      attributionLogo: false,
    },
    grid: {
      vertLines: { color: theme.grid },
      horzLines: { color: theme.grid },
    },
    crosshair: {
      mode: CrosshairMode ? CrosshairMode.Normal : 0,
      vertLine: { color: "rgba(170, 180, 200, 0.35)", width: 1, style: 3, labelBackgroundColor: "#2e3a50" },
      horzLine: { color: "rgba(170, 180, 200, 0.35)", width: 1, style: 3, labelBackgroundColor: "#2e3a50" },
    },
    rightPriceScale: {
      borderColor: theme.border,
      minimumWidth: 82,
      entireTextOnly: true,
    },
    timeScale: {
      visible: timeVisible,
      borderColor: theme.border,
      timeVisible: true,
      secondsVisible: false,
      rightOffset: 6,
      barSpacing: 7,
      minBarSpacing: 1.5,
      tickMarkFormatter,
    },
    localization: { locale: "nl-NL", timeFormatter },
  });

  const main = LWC.createChart(mainEl, baseOptions(false));
  const rsiChart = LWC.createChart(rsiEl, {
    ...baseOptions(false),
    // Alleen de 30/70-lijnen en de actuele waarde labelen (geen automatische ticks)
    localization: { locale: "nl-NL", timeFormatter, tickmarksPriceFormatter: (prices) => prices.map(() => "") },
    grid: { vertLines: { color: theme.grid }, horzLines: { visible: false } },
  });
  const macdChart = LWC.createChart(macdEl, baseOptions(true));
  const charts = [main, rsiChart, macdChart];

  const fmtP = (p) => (isNum(p) ? nf(st.decimals).format(p) : "–");

  const candleSeries = main.addSeries(LWC.CandlestickSeries, {
    upColor: theme.green,
    downColor: theme.red,
    borderVisible: false,
    wickUpColor: theme.green,
    wickDownColor: theme.red,
    priceLineColor: "rgba(170, 180, 200, 0.5)",
    priceFormat: { type: "custom", formatter: fmtP, minMove: 0.01 },
    autoscaleInfoProvider: (orig) => {
      const r = orig();
      if (!r || !r.priceRange || !st.posLevels.length) return r;
      const levels = st.posLevels.filter(isNum);
      return {
        ...r,
        priceRange: {
          minValue: Math.min(r.priceRange.minValue, ...levels),
          maxValue: Math.max(r.priceRange.maxValue, ...levels),
        },
      };
    },
  });
  main.priceScale("right").applyOptions({ scaleMargins: { top: 0.13, bottom: 0.2 } });

  const volSeries = main.addSeries(LWC.HistogramSeries, {
    priceScaleId: "vol",
    priceFormat: { type: "volume" },
    lastValueVisible: false,
    priceLineVisible: false,
  });
  main.priceScale("vol").applyOptions({ scaleMargins: { top: 0.82, bottom: 0 } });

  const lineOpts = (color, extra = {}) => ({
    color,
    lineWidth: 1,
    lastValueVisible: false,
    priceLineVisible: false,
    crosshairMarkerVisible: false,
    priceFormat: { type: "custom", formatter: fmtP, minMove: 0.01 },
    ...extra,
  });
  const ser = {
    ema9: main.addSeries(LWC.LineSeries, lineOpts(COLORS.ema9)),
    ema21: main.addSeries(LWC.LineSeries, lineOpts(COLORS.ema21)),
    ema200: main.addSeries(LWC.LineSeries, lineOpts(COLORS.ema200, { lineWidth: 2 })),
    bbUpper: main.addSeries(LWC.LineSeries, lineOpts(COLORS.bb)),
    bbMiddle: main.addSeries(LWC.LineSeries, lineOpts(COLORS.bbMid, { lineStyle: LineStyle.Dashed })),
    bbLower: main.addSeries(LWC.LineSeries, lineOpts(COLORS.bb)),
    vwap: main.addSeries(LWC.LineSeries, lineOpts(COLORS.vwap, { lineStyle: LineStyle.Dotted, lineWidth: 2 })),
  };

  let markersApi = null;
  try {
    markersApi = LWC.createSeriesMarkers(candleSeries, [], { zOrder: "top" });
  } catch {
    markersApi = LWC.createSeriesMarkers(candleSeries, []);
  }

  let watermark = null;
  try {
    if (LWC.createTextWatermark) {
      watermark = LWC.createTextWatermark(main.panes()[0], {
        horzAlign: "center",
        vertAlign: "center",
        lines: [{ text: "", color: "rgba(227, 232, 242, 0.035)", fontSize: 72, fontStyle: "bold" }],
      });
    }
  } catch {
    watermark = null;
  }

  // RSI
  const rsiSeries = rsiChart.addSeries(LWC.LineSeries, {
    color: COLORS.rsi,
    lineWidth: 1,
    priceLineVisible: false,
    lastValueVisible: true,
    crosshairMarkerRadius: 3,
    priceFormat: { type: "custom", formatter: (v) => (isNum(v) ? nf(0).format(v) : ""), minMove: 1 },
    autoscaleInfoProvider: () => ({ priceRange: { minValue: 0, maxValue: 100 } }),
  });
  rsiChart.priceScale("right").applyOptions({ scaleMargins: { top: 0.12, bottom: 0.08 } });
  const refLine = (price, color, style, label) =>
    rsiSeries.createPriceLine({
      price,
      color,
      lineWidth: 1,
      lineStyle: style,
      axisLabelVisible: label,
      axisLabelColor: "#1c2433",
      axisLabelTextColor: color,
      title: "",
    });
  refLine(70, "rgba(242, 73, 92, 0.6)", LineStyle.Dashed, true);
  refLine(30, "rgba(30, 197, 128, 0.6)", LineStyle.Dashed, true);
  refLine(50, "rgba(126, 136, 157, 0.3)", LineStyle.Dotted, false);

  // MACD
  let macdDecimals = 2;
  const fmtM = (v) => (isNum(v) ? nf(macdDecimals).format(v) : "–");
  const macdFmt = { type: "custom", formatter: fmtM, minMove: 0.01 };
  const histSeries = macdChart.addSeries(LWC.HistogramSeries, {
    priceLineVisible: false,
    lastValueVisible: false,
    priceFormat: macdFmt,
  });
  const macdSeries = macdChart.addSeries(LWC.LineSeries, {
    color: COLORS.macd,
    lineWidth: 1,
    priceLineVisible: false,
    lastValueVisible: false,
    crosshairMarkerRadius: 3,
    priceFormat: macdFmt,
  });
  const sigSeries = macdChart.addSeries(LWC.LineSeries, {
    color: COLORS.macdSignal,
    lineWidth: 1,
    priceLineVisible: false,
    lastValueVisible: false,
    crosshairMarkerVisible: false,
    priceFormat: macdFmt,
  });
  macdChart.priceScale("right").applyOptions({ scaleMargins: { top: 0.18, bottom: 0.06 } });

  // ───────────── Synchronisatie tijdas + crosshair ─────────────

  let syncingRange = false;
  for (const src of charts) {
    src.timeScale().subscribeVisibleLogicalRangeChange((range) => {
      if (syncingRange || !range) return;
      syncingRange = true;
      try {
        for (const c of charts) if (c !== src) c.timeScale().setVisibleLogicalRange(range);
      } finally {
        syncingRange = false;
      }
    });
  }
  function setRangeAll(range) {
    syncingRange = true;
    try {
      for (const c of charts) c.timeScale().setVisibleLogicalRange(range);
    } finally {
      syncingRange = false;
    }
  }

  /**
   * Breedte van de hoofdgrafiek volgens lightweight-charts zelf (0 = nog niet gemeten of
   * verborgen). Niet timeScale().width(): die is 0 bij een verborgen tijdas (hoofd- en RSI-grafiek).
   */
  function chartWidth() {
    try {
      const s = main.paneSize();
      return s && isNum(s.width) ? s.width : 0;
    } catch {
      return 0;
    }
  }

  /**
   * Eerste weergave voor de candles in de grafiek (initialRange). Zonder breedte (tabblad
   * Live verborgen, bijv. munt gekozen in de Scanner) gaat een weergave verloren: dan
   * later, zodra de grafiek een breedte heeft (subscribeSizeChange / terug naar Live).
   */
  function showInitialRange() {
    const w = mainEl.clientWidth || 0;
    if (!st.candles.length) {
      st.rangePending = false;
      return;
    }
    if (!(w > 0) || !(chartWidth() > 0)) {
      st.rangePending = true;
      return;
    }
    st.rangePending = false;
    setResizeLock(fillsWidth(st.candles.length, w));
    setRangeAll(initialRange(st.candles.length, w));
  }
  /** Weergave vasthouden bij een andere vensterbreedte (alleen als alle candles de breedte vullen, zie fillsWidth) */
  let resizeLock = false;
  function setResizeLock(on) {
    if (on === resizeLock) return;
    resizeLock = on;
    for (const c of charts) {
      try {
        c.applyOptions({ timeScale: { lockVisibleTimeRangeOnResize: on } });
      } catch {
        /* oudere lightweight-charts */
      }
    }
  }
  const pendingRange = () => {
    if (st.rangePending) showInitialRange();
  };
  // Grafiek krijgt (weer) een breedte: in de volgende frame de weergave zetten. Alleen de
  // MACD-grafiek heeft een zichtbare tijdas en meldt dus zelf een nieuwe maat; de
  // ResizeObserver op het vak van de hoofdgrafiek is het vangnet.
  const onSized = () => {
    if (st.rangePending) requestAnimationFrame(pendingRange);
  };
  for (const c of charts) {
    try {
      c.timeScale().subscribeSizeChange(onSized);
    } catch {
      /* oudere lightweight-charts */
    }
  }
  if (typeof ResizeObserver === "function") {
    try {
      new ResizeObserver(onSized).observe(mainEl);
    } catch {
      /* dan bij terugkeer naar Live */
    }
  }

  // Legendes nooit over de prijsschaal (die is op een telefoon breder dan de CSS-marge):
  // rechterrand = actuele breedte van de prijsschaal + marge. De tijdas krimpt/groeit mee
  // als de prijsschaal breder/smaller wordt, dus dat event dekt ook een andere markt.
  const legendCharts = [
    [main, legMain],
    [rsiChart, legRsi],
    [macdChart, legMacd],
  ];
  function syncLegendInsets() {
    for (const [c, l] of legendCharts) {
      try {
        const w = c.priceScale("right").width();
        if (isNum(w) && w > 0) l.style.right = `${Math.ceil(w) + 8}px`;
      } catch {
        /* grafiek nog niet getekend */
      }
    }
  }
  let insetFrame = 0;
  const scheduleLegendInsets = () => {
    if (insetFrame) return;
    insetFrame = requestAnimationFrame(() => {
      insetFrame = 0;
      syncLegendInsets();
    });
  };
  for (const c of charts) {
    try {
      c.timeScale().subscribeSizeChange(scheduleLegendInsets);
    } catch {
      /* oudere lightweight-charts: CSS-marge blijft */
    }
  }

  let activeChart = null;
  [mainEl, rsiEl, macdEl].forEach((el, i) => {
    el.addEventListener("pointerenter", () => (activeChart = charts[i]));
    el.addEventListener("pointerleave", () => {
      if (activeChart === charts[i]) activeChart = null;
      for (const c of charts) c.clearCrosshairPosition();
      st.hoverIdx = null;
      st.hoverNote = "";
      updateLegend(null);
    });
  });

  const valueAt = (arr, i) => {
    const v = arr && arr[i];
    return isNum(v) ? v : null;
  };

  charts.forEach((src) => {
    src.subscribeCrosshairMove((param) => {
      if (src !== activeChart) return;
      const t = param && param.time;
      if (t === undefined || t === null) {
        for (const c of charts) if (c !== src) c.clearCrosshairPosition();
        st.hoverIdx = null;
        st.hoverNote = "";
        updateLegend(null);
        return;
      }
      const idx = st.timeIndex.get(Number(t));
      const ind = (st.data && st.data.indicators) || {};
      const cndl = idx !== undefined ? st.candles[idx] : null;
      const targets = [
        [main, candleSeries, cndl ? cndl.close : null],
        [rsiChart, rsiSeries, valueAt(ind.rsi, idx) ?? 50],
        [macdChart, macdSeries, valueAt(ind.macd, idx) ?? 0],
      ];
      for (const [c, s, v] of targets) {
        if (c === src) continue;
        if (v === null || idx === undefined) c.clearCrosshairPosition();
        else c.setCrosshairPosition(v, t, s);
      }
      const hovered = param.hoveredInfo ? param.hoveredInfo.objectId : param.hoveredObjectId;
      st.hoverNote = hovered && st.markerInfo.has(hovered) ? st.markerInfo.get(hovered) : "";
      st.hoverIdx = idx === undefined ? null : idx;
      updateLegend(st.hoverIdx);
    });
  });

  // ───────────── Data → series ─────────────

  function lineData(arr) {
    const out = new Array(st.times.length);
    for (let i = 0; i < st.times.length; i++) {
      const v = arr ? arr[i] : null;
      out[i] = isNum(v) ? { time: st.times[i], value: v } : { time: st.times[i] };
    }
    return out;
  }

  const volColor = (c) => (c.close >= c.open ? "rgba(30, 197, 128, 0.26)" : "rgba(242, 73, 92, 0.26)");
  const bar = (c, i) => ({ time: st.times[i], open: c.open, high: c.high, low: c.low, close: c.close });

  function histData(hist) {
    const out = new Array(st.times.length);
    let prev = null;
    for (let i = 0; i < st.times.length; i++) {
      const v = hist ? hist[i] : null;
      if (!isNum(v)) {
        out[i] = { time: st.times[i] };
        continue;
      }
      let color;
      if (v >= 0) color = prev === null || v >= prev ? "rgba(30, 197, 128, 0.85)" : "rgba(30, 197, 128, 0.4)";
      else color = prev === null || v <= prev ? "rgba(242, 73, 92, 0.85)" : "rgba(242, 73, 92, 0.4)";
      out[i] = { time: st.times[i], value: v, color };
      prev = v;
    }
    return out;
  }

  function validCandle(c) {
    return c && isNum(c.time) && isNum(c.open) && isNum(c.high) && isNum(c.low) && isNum(c.close);
  }

  function applyData(res, reset) {
    const raw = res && Array.isArray(res.candles) ? res.candles : [];
    st.data = res || null;
    st.loadedAt = Date.now();
    if (!raw.length || !raw.every(validCandle)) {
      st.candles = [];
      st.times = [];
      st.timeIndex = new Map();
      st.shownKey = "";
      st.rangePending = false;
      for (const s of [candleSeries, volSeries, rsiSeries, histSeries, macdSeries, sigSeries, ...Object.values(ser)]) {
        s.setData([]);
      }
      markersApi.setMarkers([]);
      showOverlay("empty");
      renderToolbar();
      updateLegend(null);
      return;
    }

    // De huidige weergave hoort alleen bij de munt die nu in beeld staat. Komt er een
    // verversing binnen voor een ANDERE munt (bijv. munt gekozen in de Scanner: het
    // verversen bij "terug naar Live" haalde het eerste laden in), dan is dit een nieuwe
    // weergave. Anders stonden de candles van een illiquide munt (weinig candles) in het
    // bereik van de vorige munt (bijv. 157–305): klein links met een grote lege vlakte.
    const key = `${st.market}|${st.interval}`;
    const sameView = !reset && st.shownKey === key && !st.rangePending;
    const prevRange = sameView ? main.timeScale().getVisibleLogicalRange() : null;
    st.shownKey = key;
    st.candles = raw.map((c) => ({ ...c, volume: isNum(c.volume) ? c.volume : 0 }));
    st.times = st.candles.map((c) => Math.floor(c.time / 1000));
    st.timeIndex = new Map(st.times.map((t, i) => [t, i]));

    const lastClose = st.candles[st.candles.length - 1].close;
    st.decimals = decimalsFor(lastClose);
    const minMove = Number((10 ** -st.decimals).toFixed(st.decimals));
    candleSeries.applyOptions({ priceFormat: { type: "custom", formatter: fmtP, minMove } });

    const ind = res.indicators || {};
    const maxAbs = Math.max(
      1e-12,
      ...((ind.macd || []).filter(isNum).map(Math.abs)),
      ...((ind.macdHist || []).filter(isNum).map(Math.abs)),
    );
    macdDecimals = Math.max(0, Math.min(8, 2 - Math.floor(Math.log10(maxAbs))));
    const mm = Number((10 ** -macdDecimals).toFixed(macdDecimals));
    for (const s of [histSeries, macdSeries, sigSeries]) s.applyOptions({ priceFormat: { ...macdFmt, minMove: mm } });

    try {
      candleSeries.setData(st.candles.map(bar));
      volSeries.setData(st.candles.map((c, i) => ({ time: st.times[i], value: c.volume, color: volColor(c) })));
      ser.ema9.setData(lineData(ind.emaFast));
      ser.ema21.setData(lineData(ind.emaSlow));
      ser.ema200.setData(lineData(ind.ema200));
      ser.bbUpper.setData(lineData(ind.bbUpper));
      ser.bbMiddle.setData(lineData(ind.bbMiddle));
      ser.bbLower.setData(lineData(ind.bbLower));
      ser.vwap.setData(lineData(ind.vwap));
      rsiSeries.setData(lineData(ind.rsi));
      histSeries.setData(histData(ind.macdHist));
      macdSeries.setData(lineData(ind.macd));
      sigSeries.setData(lineData(ind.macdSignal));
    } catch (err) {
      console.error("Grafiekdata ongeldig", err);
      showOverlay("error", "De ontvangen koersdata is ongeldig.");
      return;
    }

    hideOverlay();
    syncPositions(true);
    applyToggles(); // bouwt ook de markers

    const kept = keepRange(prevRange, st.candles.length);
    if (kept) setRangeAll(kept);
    else showInitialRange();
    if (watermark) {
      try {
        watermark.applyOptions({
          lines: [
            { text: st.market || "", color: "rgba(227, 232, 242, 0.035)", fontSize: 72, fontStyle: "bold" },
          ],
        });
      } catch {
        /* optioneel */
      }
    }
    renderToolbar();
    updateLegend(st.hoverIdx);
    scheduleLegendInsets();
  }

  function applyToggles() {
    const t = st.toggles;
    ser.ema9.applyOptions({ visible: !!t.ema9 });
    ser.ema21.applyOptions({ visible: !!t.ema21 });
    ser.ema200.applyOptions({ visible: !!t.ema200 });
    for (const k of ["bbUpper", "bbMiddle", "bbLower"]) ser[k].applyOptions({ visible: !!t.bb });
    ser.vwap.applyOptions({ visible: !!t.vwap });
    volSeries.applyOptions({ visible: !!t.volume });
    main
      .priceScale("right")
      .applyOptions({ scaleMargins: { top: 0.13, bottom: t.volume ? 0.2 : 0.06 } });
    buildMarkers();
  }

  // ───────────── Markers ─────────────

  /** Tijd (ms) → tijd (s) van de candle waarin dat moment valt, of null */
  function snapTime(ms) {
    const c = st.candles;
    if (!c.length || !isNum(ms) || ms < c[0].time) return null;
    let lo = 0;
    let hi = c.length - 1;
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1;
      if (c[mid].time <= ms) lo = mid;
      else hi = mid - 1;
    }
    return st.times[lo];
  }

  function marketTrades() {
    const byId = new Map();
    const fromData = (st.data && st.data.trades) || [];
    const snap = ctx.getState();
    const fromSnap = ((snap && snap.trades) || []).filter((t) => t.market === st.market);
    for (const t of [...fromData, ...fromSnap]) if (t && t.id) byId.set(t.id, t);
    return [...byId.values()];
  }

  function marketPositions() {
    const snap = ctx.getState();
    if (snap && Array.isArray(snap.positions)) return snap.positions.filter((p) => p.market === st.market);
    return (st.data && st.data.positions) || [];
  }

  function buildMarkers() {
    if (!markersApi) return;
    const out = [];
    const info = new Map();
    const green = theme.green;
    const red = theme.red;
    if (st.toggles.signals && st.data && Array.isArray(st.data.signals)) {
      st.data.signals.forEach((s, i) => {
        const t = snapTime(s.time);
        if (t === null) return;
        const buy = s.action === "buy";
        const id = `sig-${i}`;
        out.push({
          id,
          time: t,
          position: buy ? "belowBar" : "aboveBar",
          shape: "circle",
          color: buy ? "rgba(30, 197, 128, 0.75)" : "rgba(242, 73, 92, 0.75)",
          size: 0.55,
        });
        info.set(
          id,
          `${buy ? "KOOP" : "VERKOOP"}-signaal · score ${nf(2).format(s.score)} · ${fmtP(s.price)}${s.label ? ` · ${s.label}` : ""}`,
        );
      });
    }
    if (st.toggles.trades) {
      for (const tr of marketTrades()) {
        const te = snapTime(tr.entryTime);
        const tx = snapTime(tr.exitTime);
        const win = tr.pnlQuote >= 0;
        if (te !== null) {
          const id = `tre-${tr.id}`;
          out.push({ id, time: te, position: "belowBar", shape: "arrowUp", color: theme.accent, text: "KOOP", size: 1 });
          info.set(id, `Gekocht @ ${fmtP(tr.entryPrice)} · inzet ${fmt.eur(tr.costQuote)}`);
        }
        if (tx !== null) {
          const id = `trx-${tr.id}`;
          // Afgeschreven: er is niets verkocht → geen verkooppijl maar een rondje (uitleg in de tooltip)
          const writtenOff = tr.exitReason === "write-off";
          out.push({
            id,
            time: tx,
            position: "aboveBar",
            shape: writtenOff ? "circle" : "arrowDown",
            color: win ? green : red,
            text: fmt.pct(tr.pnlPct, writtenOff ? 0 : 1),
            size: 1,
          });
          info.set(
            id,
            tr.exitReason === "write-off"
              ? `${fmt.exitReason(tr.exitReason)} (niets verkocht, de coins staan nog op je account) · ${fmt.eurSigned(tr.pnlQuote)} (${fmt.pct(
                  tr.pnlPct,
                )})`
              : `Verkocht @ ${fmtP(tr.exitPrice)} · ${fmt.eurSigned(tr.pnlQuote)} (${fmt.pct(tr.pnlPct)}) · ${fmt.exitReason(
                  tr.exitReason,
                )}`,
          );
        }
      }
      for (const p of marketPositions()) {
        const te = snapTime(p.entryTime);
        if (te === null) continue;
        const id = `pos-${p.id}`;
        out.push({ id, time: te, position: "belowBar", shape: "arrowUp", color: "#ffd166", text: "OPEN", size: 1.2 });
        info.set(id, `Open positie · gekocht @ ${fmtP(p.entryPrice)} · inzet ${fmt.eur(p.costQuote)}`);
      }
    }
    out.sort((a, b) => a.time - b.time);
    st.markerInfo = info;
    markersApi.setMarkers(out);
  }

  // ───────────── Prijslijnen open positie ─────────────

  function syncPositions(force = false) {
    const positions = marketPositions();
    const key = positions.map((p) => [p.id, p.entryPrice, p.stopPrice, p.takeProfitPrice].join(":")).join("|");
    if (!force && key === st.posKey) return;
    const changedSet = key !== st.posKey;
    st.posKey = key;
    for (const l of st.priceLines) {
      try {
        candleSeries.removePriceLine(l);
      } catch {
        /* al weg */
      }
    }
    st.priceLines = [];
    st.posLevels = [];
    for (const p of positions) {
      const mk = (price, color, style, title) =>
        isNum(price) &&
        st.priceLines.push(
          candleSeries.createPriceLine({
            price,
            color,
            lineWidth: 1,
            lineStyle: style,
            axisLabelVisible: true,
            title,
          }),
        );
      mk(p.entryPrice, theme.accent, LineStyle.Solid, "Entry");
      mk(p.stopPrice, theme.red, LineStyle.Dashed, "Stop");
      mk(p.takeProfitPrice, theme.green, LineStyle.Dashed, "Doel");
      st.posLevels.push(p.stopPrice, p.takeProfitPrice);
    }
    if (changedSet) buildMarkers();
  }

  // ───────────── Legende ─────────────

  function updateLegend(idx) {
    const n = st.candles.length;
    if (!n) {
      legMain.innerHTML = st.market ? `<div class="row"><span class="ttl">${esc(st.market)}</span></div>` : "";
      legRsi.innerHTML = `<div class="row"><span class="ttl">RSI 14</span></div>`;
      legMacd.innerHTML = `<div class="row"><span class="ttl">MACD 12 26 9</span></div>`;
      return;
    }
    const i = idx === null || idx === undefined || idx < 0 || idx >= n ? n - 1 : idx;
    const c = st.candles[i];
    const prev = st.candles[i - 1];
    const chg = prev ? ((c.close - prev.close) / prev.close) * 100 : ((c.close - c.open) / c.open) * 100;
    const cls = c.close >= c.open ? "pos" : "neg";
    const ind = (st.data && st.data.indicators) || {};
    const kv = (k, v, extra = "") => `<span><span class="k">${k}</span><span class="v ${extra}">${v}</span></span>`;
    const iv = (label, color, v) =>
      `<span class="ind" style="--c:${color}"><i></i><span class="k">${label}</span><span class="v">${
        isNum(v) ? fmtP(v) : "–"
      }</span></span>`;

    let indRow = "";
    if (st.toggles.ema9) indRow += iv("EMA 9", COLORS.ema9, valueAt(ind.emaFast, i));
    if (st.toggles.ema21) indRow += iv("EMA 21", COLORS.ema21, valueAt(ind.emaSlow, i));
    if (st.toggles.ema200) indRow += iv("EMA 200", "#cfd6e4", valueAt(ind.ema200, i));
    if (st.toggles.bb) {
      const u = valueAt(ind.bbUpper, i);
      const l = valueAt(ind.bbLower, i);
      indRow += `<span class="ind" style="--c:#38bdf8"><i></i><span class="k">BB</span><span class="v">${
        u !== null && l !== null ? `${fmtP(l)} – ${fmtP(u)}` : "–"
      }</span></span>`;
    }
    if (st.toggles.vwap) indRow += iv("VWAP", COLORS.vwap, valueAt(ind.vwap, i));

    const hovering = idx !== null && idx !== undefined;
    legMain.innerHTML = `
      <div class="row">
        <span class="ttl">${esc(st.market || "")} · ${esc(st.interval || "")}</span>
        ${hovering ? `<span class="muted">${esc(timeFormatter(st.times[i]))}</span>` : ""}
        ${kv("O", fmtP(c.open), cls)}${kv("H", fmtP(c.high), cls)}${kv("L", fmtP(c.low), cls)}${kv("C", fmtP(c.close), cls)}
        <span class="v ${fmt.pnlClass(chg)}">${esc(fmt.pct(chg))}</span>
        ${st.toggles.volume ? kv("Vol", esc(compactNf.format(c.volume || 0))) : ""}
      </div>
      ${indRow ? `<div class="row ind-row">${indRow}</div>` : ""}
      ${st.hoverNote ? `<div class="hover-note">${esc(st.hoverNote)}</div>` : ""}`;

    const r = valueAt(ind.rsi, i);
    const zone = r === null ? "" : r >= 70 ? "overgekocht" : r <= 30 ? "oververkocht" : "";
    legRsi.innerHTML = `<div class="row"><span class="ind" style="--c:${COLORS.rsi}"><i></i><span class="ttl">RSI 14</span><span class="v">${
      r === null ? "–" : nf(1).format(r)
    }</span></span>${zone ? `<span class="badge ${r >= 70 ? "badge-red" : "badge-green"}">${zone}</span>` : ""}</div>`;

    const m = valueAt(ind.macd, i);
    const s = valueAt(ind.macdSignal, i);
    const h = valueAt(ind.macdHist, i);
    legMacd.innerHTML = `<div class="row"><span class="ttl">MACD 12 26 9</span>
      <span class="ind" style="--c:${COLORS.macd}"><i></i><span class="v">${fmtM(m)}</span></span>
      <span class="ind" style="--c:${COLORS.macdSignal}"><i></i><span class="v">${fmtM(s)}</span></span>
      <span class="v ${fmt.pnlClass(h)}">${fmtM(h)}</span></div>`;
  }

  // ───────────── Toolbar-waarden ─────────────

  function currentPrice(market) {
    const snap = ctx.getState();
    const p = snap && snap.prices ? snap.prices[market] : undefined;
    if (isNum(p)) return p;
    if (market === st.market && st.candles.length) return st.candles[st.candles.length - 1].close;
    const s = st.stats24[market];
    return s && isNum(s.last) ? s.last : null;
  }

  function flash(el, key, value) {
    const prev = st.shownPrice[key];
    if (isNum(prev) && isNum(value) && value !== prev) {
      el.classList.remove("flash-up", "flash-down");
      void el.offsetWidth;
      el.classList.add(value > prev ? "flash-up" : "flash-down");
    }
    st.shownPrice[key] = value;
  }

  function change24(market, price) {
    // Zelfde getal als in de Munten-radar (24h-tickers van Bitvavo) als de engine dat stuurt
    const r = st.radarMap.get(market);
    if (r && isNum(r.changePct24h)) return r.changePct24h;
    // Oudere server: zelf berekend uit de 1h-candles van de zichtbare tabs
    const s = st.stats24[market];
    if (s && isNum(s.open) && s.open > 0 && isNum(price)) return ((price - s.open) / s.open) * 100;
    return null;
  }

  function renderToolbar() {
    const m = st.market || "";
    const base = m.split("-")[0] || "?";
    const icon = tb("[data-ct-icon]");
    icon.textContent = base.slice(0, 4);
    icon.style.setProperty("--c", coinColor(base));
    tb("[data-ct-name]").textContent = m || "–";
    tb("[data-ct-iv]").textContent = st.interval || "–";
    renderToolbarPrice();
    const s = st.stats24[m];
    const r = st.radarMap.get(m);
    const vol = r && isNum(r.volumeQuote24h) ? r.volumeQuote24h : s ? s.volQuote || 0 : null;
    tb("[data-ct-stats]").innerHTML = s
      ? `<span>24u hoog<b>${esc(fmtP(s.high))}</b></span><span>24u laag<b>${esc(fmtP(s.low))}</b></span><span>Volume 24u<b>€ ${esc(
          compactNf.format(vol || 0),
        )}</b></span>`
      : "";
    renderCountdown();
  }

  function renderCountdown() {
    const el = tb("[data-ct-upd]");
    const iv = INTERVAL_MS[st.interval];
    if (!iv || !st.candles.length) {
      el.textContent = "";
      return;
    }
    const left = iv - (Date.now() % iv);
    const s = Math.floor(left / 1000);
    const hh = Math.floor(s / 3600);
    const mm = Math.floor((s % 3600) / 60);
    const ss = s % 60;
    const pad = (n) => String(n).padStart(2, "0");
    const txt = hh ? `${hh}:${pad(mm)}:${pad(ss)}` : `${pad(mm)}:${pad(ss)}`;
    el.innerHTML = `candle sluit over <b class="mono">${txt}</b>${
      st.loadedAt ? ` · bijgewerkt ${esc(fmt.time(st.loadedAt))}` : ""
    }`;
    el.title = "Pas als een candle gesloten is beoordeelt de bot hem";
  }
  setInterval(() => {
    if (!document.hidden) renderCountdown();
  }, 1000);

  function renderToolbarPrice() {
    const price = currentPrice(st.market);
    if (!st.candles.length && isNum(price)) st.decimals = decimalsFor(price);
    const pe = tb("[data-ct-price]");
    pe.textContent = isNum(price) ? fmtP(price) : "–";
    flash(pe, "__toolbar", price);
    const chg = change24(st.market, price);
    const ce = tb("[data-ct-chg]");
    ce.className = `ct-change ${fmt.pnlClass(chg)}`;
    ce.innerHTML = chg === null ? "" : `${esc(fmt.pct(chg))} <span class="muted">24u</span>`;
  }

  // ───────────── Marktbalk ─────────────

  /** Radar-rijen per markt (24u-verandering, status, rank) uit de laatste snapshot */
  function noteRadar(snap) {
    const map = new Map();
    if (snap && Array.isArray(snap.radar)) for (const r of snap.radar) if (r && typeof r.market === "string") map.set(r.market, r);
    st.radarMap = map;
  }

  function computeTabModel() {
    const snap = ctx.getState();
    return pickTabMarkets({
      selected: st.market,
      active: st.markets,
      positions: snap && Array.isArray(snap.positions) ? snap.positions.map((p) => p && p.market) : [],
      radar: snap && Array.isArray(snap.radar) ? snap.radar : null,
    });
  }

  /** De markten die nu als tab zichtbaar zijn */
  function tabMarkets() {
    return st.tabModel.tabs;
  }

  function renderTabs() {
    st.tabModel = computeTabModel();
    const list = st.tabModel.tabs;
    const extra = new Set(st.tabModel.extra);
    const key = list.join(",") + "|" + st.market + "|" + st.tabModel.extra.join(",");
    let rebuilt = false;
    if (key !== st.tabsKey) {
      st.tabsKey = key;
      rebuilt = true;
      // Stond de toetsenbordfocus op een tab? Dan na het opnieuw tekenen op dezelfde munt terugzetten
      const focusMarket = focusedTabMarket();
      if (!list.length) {
        stripEl.innerHTML = `<div class="mkt-tab" style="cursor:default"><span class="mkt-icon"><span class="spinner"></span></span><span class="mkt-name">Markten laden…</span></div>`;
      } else {
        stripEl.innerHTML = list
          .map((m) => {
            const [base, quote] = m.split("-");
            const isExtra = extra.has(m);
            return `<button type="button" role="tab" class="mkt-tab${m === st.market ? " active" : ""}${isExtra ? " extra" : ""}"
            data-market="${esc(m)}" aria-selected="${m === st.market}" title="${isExtra ? "Niet in de bot-markten (alleen bekijken)" : esc(m)}">
            <span class="mkt-icon" style="--c:${coinColor(base || "")}">${esc((base || "?").slice(0, 4))}</span>
            <span class="mkt-name">${esc(base || m)}<small>/${esc(quote || "")}</small></span>
            <span class="mkt-price" data-p>–</span>
            <span class="mkt-meta"><span class="mkt-chg flat" data-c>–</span><svg class="mkt-spark" viewBox="0 0 64 18" preserveAspectRatio="none" data-s></svg></span>
            <span class="mkt-flags" data-f></span>
          </button>`;
          })
          .join("");
        // Nieuwe tabs (bijv. een nieuwe koopkans): alleen voor die tabs de 24u-cijfers ophalen
        refreshStats24();
      }
      if (focusMarket) focusTab(focusMarket);
    }
    updateTabValues();
    renderAllButton();
    // Pas na de waarden en de knop "Alle munten": die bepalen de breedte van tabs en balk
    if (rebuilt) queueReveal();
  }

  /** Markt van de tab die nu de toetsenbordfocus heeft (of null) */
  function focusedTabMarket() {
    const a = typeof document !== "undefined" ? document.activeElement : null;
    if (!a || a === stripEl || typeof stripEl.contains !== "function" || !stripEl.contains(a)) return null;
    return (a.dataset && a.dataset.market) || null;
  }

  /** Focus op de tab van `market` (anders de gekozen tab), zonder de pagina te laten verspringen */
  function focusTab(market) {
    const tabs = [...stripEl.querySelectorAll("[data-market]")];
    const btn = tabs.find((b) => b.dataset.market === market) || stripEl.querySelector(".mkt-tab.active");
    if (!btn || typeof btn.focus !== "function") return false;
    btn.focus({ preventScroll: true });
    return true;
  }

  /**
   * De gekozen tab in beeld schuiven, maar pas bij de volgende frame: dan staan de prijzen in de
   * tabs en is de knop "Alle munten" zichtbaar (die maakt de balk smaller). Meteen meten gaf
   * verkeerde breedtes, waardoor de gekozen munt op een telefoon buiten beeld bleef.
   */
  function queueReveal() {
    if (st.revealQueued) return;
    st.revealQueued = true;
    const run = () => {
      st.revealQueued = false;
      revealActiveTab();
    };
    if (typeof requestAnimationFrame === "function") requestAnimationFrame(run);
    else setTimeout(run, 0);
  }

  /** De gekozen markt in beeld schuiven als de balk breder is dan het scherm (alleen horizontaal) */
  function revealActiveTab() {
    const btn = stripEl.querySelector(".mkt-tab.active");
    if (!btn || typeof btn.getBoundingClientRect !== "function" || !(stripEl.scrollWidth > stripEl.clientWidth + 1)) return;
    const d = revealDelta(stripEl.getBoundingClientRect(), btn.getBoundingClientRect());
    if (d) stripEl.scrollLeft += d;
  }

  /** Waarden in de tabs bijwerken (alleen `onlyMarket` als die gegeven is) */
  function updateTabValues(onlyMarket = null) {
    const snap = ctx.getState();
    const posSet = new Set(snap && Array.isArray(snap.positions) ? snap.positions.map((p) => p && p.market) : []);
    stripEl.querySelectorAll("[data-market]").forEach((btn) => {
      const m = btn.dataset.market;
      if (onlyMarket && m !== onlyMarket) return;
      const price = currentPrice(m);
      const pe = btn.querySelector("[data-p]");
      pe.textContent = isNum(price) ? fmt.price(price) : "–";
      flash(pe, m, price);
      const chg = change24(m, price);
      const ce = btn.querySelector("[data-c]");
      ce.className = `mkt-chg ${fmt.pnlClass(chg)}`;
      ce.textContent = chg === null ? "–" : fmt.pct(chg, 2);
      const s = st.stats24[m];
      const sp = btn.querySelector("[data-s]");
      if (s && s.spark && s.spark.length > 1 && sp.dataset.k !== String(s.at)) {
        sp.dataset.k = String(s.at);
        const up = s.spark[s.spark.length - 1] >= s.spark[0];
        sp.innerHTML = `<path d="${sparkPath(s.spark, 64, 18)}" fill="none" stroke="${up ? theme.green : theme.red}" stroke-width="1.3" vector-effect="non-scaling-stroke"/>`;
      }
      if (onlyMarket) return;
      const r = st.radarMap.get(m);
      const flags = [];
      if (posSet.has(m)) flags.push(`<span class="mkt-flag open" title="Open positie"></span>`);
      else if (r && r.status === "candidate")
        flags.push(`<span class="mkt-flag buy" title="Koopsignaal${isNum(r.rank) ? ` (#${r.rank} in de kansenlijst)` : ""}"></span>`);
      const fe = btn.querySelector("[data-f]");
      const html = flags.join("");
      if (fe.innerHTML !== html) fe.innerHTML = html;
    });
  }

  // ───────────── "Alle munten": doorzoekbare lijst ─────────────

  /** Alle markten van de bot (plus markten met een positie) voor de lijst */
  function pickerMarkets() {
    const snap = ctx.getState();
    const pos = snap && Array.isArray(snap.positions) ? snap.positions.map((p) => p && p.market).filter(Boolean) : [];
    return [...new Set([...st.markets, ...pos])];
  }

  function renderAllButton() {
    if (!allWrap) return;
    const { hidden, total } = st.tabModel;
    const show = hidden > 0 || st.pickerOpen;
    if (allWrap.hidden === show) {
      allWrap.hidden = !show;
      // De knop verschijnt/verdwijnt naast de balk: die wordt smaller/breder → gekozen tab opnieuw in beeld
      queueReveal();
    }
    if (allN) allN.textContent = `${total} ▾`;
    if (allBtn) {
      allBtn.setAttribute("aria-label", `Alle munten (${total}) — kies een munt`);
      allBtn.classList.toggle("has-sel", !!st.market && !st.tabModel.tabs.includes(st.market));
    }
  }

  function pickerRowHtml(m, i) {
    const [base, quote] = m.split("-");
    const r = st.radarMap.get(m);
    const snap = ctx.getState();
    const hasPos = !!(snap && Array.isArray(snap.positions) && snap.positions.some((p) => p && p.market === m));
    const price = currentPrice(m);
    const chg = change24(m, price);
    let flag = `<span class="mkp-flag"></span>`;
    if (hasPos) flag = `<span class="mkp-flag pos" title="Open positie">●</span>`;
    else if (r && r.status === "candidate") flag = `<span class="mkp-flag buy" title="Koopsignaal">${isNum(r.rank) ? `#${esc(r.rank)}` : "▲"}</span>`;
    else if (r && r.status === "blocked") flag = `<span class="mkp-flag blocked" title="Koopsignaal, maar tegengehouden">⛔</span>`;
    return `<li role="option" id="mkp-${i}" class="mkp-item${i === st.pickerIdx ? " active" : ""}${m === st.market ? " sel" : ""}"
      data-market="${esc(m)}" aria-selected="${m === st.market}">
      <span class="mkt-icon" style="--c:${coinColor(base || "")}">${esc((base || "?").slice(0, 4))}</span>
      <span class="mkp-name">${esc(base || m)}<small>/${esc(quote || "")}</small></span>
      ${flag}
      <span class="mkp-price">${isNum(price) ? esc(fmt.price(price)) : "–"}</span>
      <span class="mkp-chg ${fmt.pnlClass(chg)}">${chg === null ? "" : esc(fmt.pct(chg, 1))}</span>
    </li>`;
  }

  function renderPickerList() {
    if (!popList) return;
    const all = pickerMarkets();
    const list = filterMarketList(all, popQ ? popQ.value : "");
    st.pickerList = list;
    if (st.pickerIdx >= list.length) st.pickerIdx = Math.max(0, list.length - 1);
    popList.innerHTML = list.length
      ? list.map(pickerRowHtml).join("")
      : `<li class="mkp-empty">Geen munt gevonden. De lijst bevat alleen munten die de bot volgt.</li>`;
    if (popMeta) {
      popMeta.textContent =
        list.length === all.length ? `${all.length} munten die de bot volgt` : `${list.length} van ${all.length} munten`;
    }
    if (popQ) {
      if (list.length) popQ.setAttribute("aria-activedescendant", `mkp-${st.pickerIdx}`);
      else popQ.removeAttribute("aria-activedescendant");
    }
  }

  function movePicker(delta) {
    const n = st.pickerList.length;
    if (!n || !popList) return;
    const prev = popList.querySelector(`#mkp-${st.pickerIdx}`);
    st.pickerIdx = (st.pickerIdx + delta + n) % n;
    const next = popList.querySelector(`#mkp-${st.pickerIdx}`);
    if (prev) prev.classList.remove("active");
    if (next) {
      next.classList.add("active");
      if (typeof next.scrollIntoView === "function") next.scrollIntoView({ block: "nearest" });
    }
    if (popQ) popQ.setAttribute("aria-activedescendant", `mkp-${st.pickerIdx}`);
  }

  function onDocPointer(e) {
    if (st.pickerOpen && allWrap && !allWrap.contains(e.target)) closePicker(false);
  }

  function openPicker() {
    if (!pop || st.pickerOpen) return;
    st.pickerOpen = true;
    if (popQ) popQ.value = "";
    const list = filterMarketList(pickerMarkets(), "");
    st.pickerIdx = Math.max(0, list.indexOf(st.market));
    pop.hidden = false;
    allBtn && allBtn.setAttribute("aria-expanded", "true");
    renderPickerList();
    const cur = popList && popList.querySelector(`#mkp-${st.pickerIdx}`);
    if (cur && typeof cur.scrollIntoView === "function") cur.scrollIntoView({ block: "center" });
    // Op een telefoon niet meteen het toetsenbord over de lijst heen
    const fine = typeof window.matchMedia === "function" && window.matchMedia("(pointer: fine)").matches;
    if (fine && popQ) popQ.focus();
    document.addEventListener("pointerdown", onDocPointer, true);
  }

  function closePicker(focusButton = true) {
    if (!st.pickerOpen) return;
    st.pickerOpen = false;
    if (pop) pop.hidden = true;
    allBtn && allBtn.setAttribute("aria-expanded", "false");
    document.removeEventListener("pointerdown", onDocPointer, true);
    if (focusButton && allBtn) allBtn.focus();
    renderAllButton();
  }

  function pickMarket(m) {
    if (!m) return;
    // Zat de focus in de lijst (toetsenbord, zoekveld)? Die verdwijnt zo: zet hem op de tab van de munt
    const a = typeof document !== "undefined" ? document.activeElement : null;
    const hadFocus = !!(a && pop && typeof pop.contains === "function" && pop.contains(a));
    closePicker(false);
    if (m !== st.market) bus.emit("market-selected", { market: m });
    if (hadFocus && !focusTab(m) && allBtn) allBtn.focus();
  }

  /** Klikken/toetsen van de marktbalk (vóór de grafiekcheck aangeroepen: werkt ook zonder grafiekbibliotheek) */
  function wireBar() {
    stripEl.addEventListener("click", (e) => {
      const b = e.target.closest("[data-market]");
      if (!b) return;
      const m = b.dataset.market;
      if (m !== st.market) bus.emit("market-selected", { market: m });
    });
    allBtn && allBtn.addEventListener("click", () => (st.pickerOpen ? closePicker() : openPicker()));
    // Op een touchscherm blijft de focus op de knop (geen autofocus): Escape moet ook dan sluiten
    allBtn &&
      allBtn.addEventListener("keydown", (e) => {
        if (e.key === "Escape" && st.pickerOpen) {
          e.preventDefault();
          e.stopPropagation();
          closePicker();
        }
      });
    tabsEl.querySelector("[data-pop-x]")?.addEventListener("click", () => closePicker());
    popQ &&
      popQ.addEventListener("input", () => {
        st.pickerIdx = 0;
        renderPickerList();
        if (popList) popList.scrollTop = 0;
      });
    popQ &&
      popQ.addEventListener("keydown", (e) => {
        if (e.key === "ArrowDown") {
          e.preventDefault();
          movePicker(1);
        } else if (e.key === "ArrowUp") {
          e.preventDefault();
          movePicker(-1);
        } else if (e.key === "Enter") {
          e.preventDefault();
          pickMarket(st.pickerList[st.pickerIdx]);
        } else if (e.key === "Escape") {
          e.preventDefault();
          e.stopPropagation();
          closePicker();
        }
      });
    pop &&
      pop.addEventListener("keydown", (e) => {
        if (e.key === "Escape") {
          e.stopPropagation();
          closePicker();
        }
      });
    popList &&
      popList.addEventListener("click", (e) => {
        const li = e.target.closest("[data-market]");
        if (li) pickMarket(li.dataset.market);
      });
    setInterval(() => {
      if (!document.hidden) refreshStats24();
    }, 5 * 60_000);
  }

  // 24-uurs statistieken per zichtbare tab (1h-candles; licht voor de server).
  // Alleen voor tabs zonder (verse) cijfers: met 400 munten nooit voor alle markten.
  async function refreshStats24(force = false) {
    if (st.statsBusy) {
      st.statsAgain = true;
      return;
    }
    st.statsBusy = true;
    try {
      for (let pass = 0; pass < 3; pass++) {
        st.statsAgain = false;
        const now = Date.now();
        const todo = tabMarkets().filter((m) => {
          const s = st.stats24[m];
          if (force) return true;
          if (s && now - s.at < STATS_TTL_MS) return false;
          return !(st.statsTried[m] && now - st.statsTried[m] < STATS_RETRY_MS);
        });
        for (const m of todo) {
          st.statsTried[m] = Date.now();
          try {
            const res = await api.getCandles(m, "1h", 25);
            const cs = (res && res.candles) || [];
            if (!cs.length) continue;
            const lastT = cs[cs.length - 1].time;
            const win = cs.filter((c) => c.time > lastT - 24 * 3_600_000);
            const w = win.length ? win : cs;
            st.stats24[m] = {
              open: w[0].open,
              high: Math.max(...w.map((c) => c.high)),
              low: Math.min(...w.map((c) => c.low)),
              volQuote: w.reduce((s, c) => s + (c.volume || 0) * (c.close || 0), 0),
              last: cs[cs.length - 1].close,
              spark: cs.slice(-25).map((c) => c.close),
              at: Date.now(),
            };
          } catch (err) {
            console.warn(`24u-statistieken voor ${m} niet beschikbaar`, err && err.message);
          }
        }
        force = false;
        if (!st.statsAgain) break;
      }
    } finally {
      st.statsBusy = false;
      updateTabValues();
      if (st.chartReady) renderToolbar();
    }
  }

  // ───────────── Laden ─────────────

  async function load(reset) {
    if (!st.market) return;
    if (!st.interval) {
      showOverlay("wait");
      return;
    }
    const seq = ++st.reqSeq;
    const market = st.market;
    const interval = st.interval;
    if (reset) showOverlay("loading");
    try {
      const res = await api.getCandles(market, interval, 300);
      if (seq !== st.reqSeq || market !== st.market || interval !== st.interval) return;
      st.loadedKey = `${market}|${interval}`;
      applyData(res, reset);
    } catch (err) {
      if (seq !== st.reqSeq) return;
      console.warn("Candles laden mislukt", err);
      if (reset || !st.candles.length) showOverlay("error", err.message);
    }
  }

  function scheduleRefetch(ms = 1500) {
    clearTimeout(st.refetchTimer);
    st.refetchTimer = setTimeout(() => load(false), ms);
  }

  setInterval(() => {
    if (document.hidden || (ctx.getActiveTab && ctx.getActiveTab() !== "live")) return;
    if (Date.now() - st.loadedAt >= 55_000) load(false);
  }, 5_000);

  // ───────────── Live updates ─────────────

  function appendCandle(c) {
    const n = st.candles.length;
    const t = Math.floor(c.time / 1000);
    st.candles.push({ ...c, volume: isNum(c.volume) ? c.volume : 0 });
    st.times.push(t);
    st.timeIndex.set(t, n);
    candleSeries.update(bar(st.candles[n], n));
    volSeries.update({ time: t, value: st.candles[n].volume, color: volColor(st.candles[n]) });
    for (const s of [...Object.values(ser), rsiSeries, histSeries, macdSeries, sigSeries]) {
      try {
        s.update({ time: t });
      } catch {
        /* whitespace niet ondersteund: volgende refetch lost het op */
      }
    }
  }

  function updateLast() {
    const n = st.candles.length;
    const c = st.candles[n - 1];
    candleSeries.update(bar(c, n - 1));
    volSeries.update({ time: st.times[n - 1], value: c.volume, color: volColor(c) });
  }

  function onLiveCandle(c) {
    if (!validCandle(c) || !st.candles.length) return;
    const last = st.candles[st.candles.length - 1];
    if (c.time < last.time) return;
    if (c.time === last.time) {
      Object.assign(last, c, { volume: isNum(c.volume) ? c.volume : last.volume });
      updateLast();
    } else {
      appendCandle(c);
      scheduleRefetch(1500); // vorige candle is gesloten → indicatoren/signalen verversen
    }
    if (st.hoverIdx === null) updateLegend(null);
  }

  function onLivePrice(price, timeMs) {
    const n = st.candles.length;
    if (!n || !isNum(price)) return;
    const last = st.candles[n - 1];
    const iv = INTERVAL_MS[st.interval] || 60_000;
    if (isNum(timeMs) && timeMs >= last.time + iv) {
      const t0 = last.time + Math.floor((timeMs - last.time) / iv) * iv;
      onLiveCandle({ time: t0, open: price, high: price, low: price, close: price, volume: 0 });
      return;
    }
    last.close = price;
    if (price > last.high) last.high = price;
    if (price < last.low) last.low = price;
    updateLast();
    if (st.hoverIdx === null) updateLegend(null);
  }

  // ───────────── Bus ─────────────

  /**
   * Markten van de bot + interval bijwerken. `newerConfig` = config uit "config-changed"
   * (bij zelf gekozen munten geldt die lijst meteen, zie botMarkets).
   */
  function onConfigLike(cfg, newerConfig = null) {
    if (!cfg) return;
    const next = botMarkets(ctx.getState(), newerConfig);
    const markets = next.length ? next : st.markets;
    const marketsChanged = markets.join(",") !== st.markets.join(",");
    st.markets = markets;
    const intervalChanged = cfg.interval && cfg.interval !== st.interval;
    if (cfg.interval) st.interval = cfg.interval;
    if (marketsChanged) renderTabs(); // haalt zelf de 24u-cijfers van nieuwe tabs op
    if (intervalChanged) {
      renderToolbar();
      if (st.market) load(true);
    }
  }

  bus.on("snapshot", (snap) => {
    if (!snap) return;
    if (!st.market) st.market = ctx.getSelectedMarket();
    noteRadar(snap);
    onConfigLike(snap.config);
    renderTabs();
    syncPositions();
    if (st.toggles.trades) buildMarkers();
    renderToolbarPrice();
  });

  bus.on("config-changed", (cfg) => onConfigLike(cfg, cfg));

  bus.on("market-selected", (d) => {
    const m = d && d.market;
    if (!m || m === st.market) return;
    st.market = m;
    st.candles = [];
    st.hoverIdx = null;
    st.posKey = "__";
    renderTabs();
    renderToolbar();
    updateLegend(null);
    load(true);
    if (!st.stats24[m]) refreshStats24();
  });

  bus.on("price", (p) => {
    if (!p || !p.market) return;
    if (p.market === st.market) {
      onLivePrice(p.price, p.time);
      renderToolbarPrice();
    }
    // Alleen de tab van deze markt (als die zichtbaar is), niet de hele balk
    updateTabValues(p.market);
  });

  bus.on("candle", (d) => {
    if (!d || d.market !== st.market || (d.interval && d.interval !== st.interval)) return;
    onLiveCandle(d.candle);
    renderToolbarPrice();
  });

  bus.on("position-opened", (p) => {
    if (p && p.market === st.market) scheduleRefetch(800);
  });
  bus.on("position-closed", (t) => {
    if (t && t.market === st.market) scheduleRefetch(800);
  });

  bus.on("tab-changed", (d) => {
    if (!d || d.tab !== "live") return;
    // Munt gekozen terwijl Live verborgen was (bijv. vanuit de Scanner): nu pas is er iets te meten
    queueReveal();
    // …en pas nu kan de grafiek zijn eerste weergave zetten (anders via subscribeSizeChange)
    if (st.rangePending) requestAnimationFrame(pendingRange);
    if (st.market && st.interval && Date.now() - st.loadedAt > 60_000) load(false);
  });

  // ───────────── Start ─────────────

  const snap0 = ctx.getState();
  if (snap0) {
    st.markets = botMarkets(snap0);
    st.interval = (snap0.config && snap0.config.interval) || null;
    noteRadar(snap0);
  }
  renderTabs(); // haalt ook de 24u-cijfers van de zichtbare tabs op
  renderToolbar();
  updateLegend(null);
  if (st.market && st.interval) load(true);
  else showOverlay("wait");
}
