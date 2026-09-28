// Live-grafiek (A9): marktbalk, candlestick-grafiek met indicatoren, markers
// voor signalen en trades, prijslijnen voor open posities, RSI- en MACD-pane.
// Alle drie de grafieken delen tijdas en crosshair.

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
  };

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

  if (!LWC || typeof LWC.createChart !== "function") {
    showOverlay("error", "De grafiekbibliotheek (lightweight-charts) is niet geladen.");
    bus.on("snapshot", (s) => {
      st.markets = (s && s.config && s.config.markets) || [];
      renderTabs();
    });
    return;
  }

  const { LineStyle, CrosshairMode, ColorType } = LWC;

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
  const rsiChart = LWC.createChart(rsiEl, baseOptions(false));
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
  const refLine = (price, color, style) =>
    rsiSeries.createPriceLine({ price, color, lineWidth: 1, lineStyle: style, axisLabelVisible: false, title: "" });
  refLine(70, "rgba(242, 73, 92, 0.55)", LineStyle.Dashed);
  refLine(30, "rgba(30, 197, 128, 0.55)", LineStyle.Dashed);
  refLine(50, "rgba(126, 136, 157, 0.3)", LineStyle.Dotted);

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

  const volColor = (c) => (c.close >= c.open ? "rgba(30, 197, 128, 0.32)" : "rgba(242, 73, 92, 0.32)");
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
      for (const s of [candleSeries, volSeries, rsiSeries, histSeries, macdSeries, sigSeries, ...Object.values(ser)]) {
        s.setData([]);
      }
      markersApi.setMarkers([]);
      showOverlay("empty");
      renderToolbar();
      updateLegend(null);
      return;
    }

    const prevRange = reset ? null : main.timeScale().getVisibleLogicalRange();
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

    const n = st.candles.length;
    if (reset || !prevRange) {
      const w = mainEl.clientWidth || 800;
      const bars = Math.max(40, Math.min(170, Math.round(w / 7)));
      setRangeAll({ from: Math.max(-2, n - bars), to: n + 5 });
    } else {
      setRangeAll(prevRange);
    }
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
          out.push({
            id,
            time: tx,
            position: "aboveBar",
            shape: "arrowDown",
            color: win ? green : red,
            text: fmt.pct(tr.pnlPct, 1),
            size: 1,
          });
          info.set(
            id,
            `Verkocht @ ${fmtP(tr.exitPrice)} · ${fmt.eurSigned(tr.pnlQuote)} (${fmt.pct(tr.pnlPct)}) · ${fmt.exitReason(
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
    const zone = r === null ? "" : r >= 70 ? "overkocht" : r <= 30 ? "oververkocht" : "";
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
    tb("[data-ct-stats]").innerHTML = s
      ? `<span>24u hoog<b>${esc(fmtP(s.high))}</b></span><span>24u laag<b>${esc(fmtP(s.low))}</b></span><span>Volume 24u<b>€ ${esc(
          compactNf.format(s.volQuote || 0),
        )}</b></span>`
      : "";
    tb("[data-ct-upd]").textContent = st.loadedAt && st.candles.length ? `bijgewerkt ${fmt.timeSec(st.loadedAt)}` : "";
  }

  function renderToolbarPrice() {
    const price = currentPrice(st.market);
    const pe = tb("[data-ct-price]");
    pe.textContent = isNum(price) ? fmtP(price) : "–";
    flash(pe, "__toolbar", price);
    const chg = change24(st.market, price);
    const ce = tb("[data-ct-chg]");
    ce.className = `ct-change ${fmt.pnlClass(chg)}`;
    ce.innerHTML = chg === null ? "" : `${esc(fmt.pct(chg))} <span class="muted">24u</span>`;
  }

  // ───────────── Marktbalk ─────────────

  function tabMarkets() {
    const list = [...st.markets];
    if (st.market && !list.includes(st.market)) list.push(st.market);
    return list;
  }

  function renderTabs() {
    const list = tabMarkets();
    const key = list.join(",") + "|" + st.market;
    if (key !== st.tabsKey) {
      st.tabsKey = key;
      if (!list.length) {
        tabsEl.innerHTML = `<div class="mkt-tab" style="cursor:default"><span class="mkt-icon"><span class="spinner"></span></span><span class="mkt-name">Markten laden…</span></div>`;
        return;
      }
      tabsEl.innerHTML = list
        .map((m) => {
          const [base, quote] = m.split("-");
          const extra = !st.markets.includes(m);
          return `<button type="button" role="tab" class="mkt-tab${m === st.market ? " active" : ""}${extra ? " extra" : ""}"
            data-market="${esc(m)}" aria-selected="${m === st.market}" title="${extra ? "Niet in de bot-markten (alleen bekijken)" : esc(m)}">
            <span class="mkt-icon" style="--c:${coinColor(base || "")}">${esc((base || "?").slice(0, 4))}</span>
            <span class="mkt-name">${esc(base || m)}<small>/${esc(quote || "")}</small></span>
            <span class="mkt-price" data-p>–</span>
            <span class="mkt-meta"><span class="mkt-chg flat" data-c>–</span><svg class="mkt-spark" viewBox="0 0 64 18" preserveAspectRatio="none" data-s></svg></span>
            <span class="mkt-flags" data-f></span>
          </button>`;
        })
        .join("");
    }
    updateTabValues();
  }

  function updateTabValues() {
    const snap = ctx.getState();
    tabsEl.querySelectorAll("[data-market]").forEach((btn) => {
      const m = btn.dataset.market;
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
      const hasPos = snap && Array.isArray(snap.positions) && snap.positions.some((p) => p.market === m);
      btn.querySelector("[data-f]").innerHTML = hasPos ? `<span class="mkt-flag open" title="Open positie"></span>` : "";
    });
  }

  tabsEl.addEventListener("click", (e) => {
    const b = e.target.closest("[data-market]");
    if (!b) return;
    const m = b.dataset.market;
    if (m !== st.market) bus.emit("market-selected", { market: m });
  });

  // 24-uurs statistieken per markt (1h-candles; licht voor de server)
  let statsBusy = false;
  async function refreshStats24() {
    if (statsBusy) return;
    statsBusy = true;
    try {
      for (const m of tabMarkets()) {
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
            spark: cs.map((c) => c.close),
            at: Date.now(),
          };
        } catch (err) {
          console.warn(`24u-statistieken voor ${m} niet beschikbaar`, err.message);
        }
      }
    } finally {
      statsBusy = false;
      updateTabValues();
      renderToolbar();
    }
  }
  setInterval(() => {
    if (!document.hidden) refreshStats24();
  }, 5 * 60_000);

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

  function onConfigLike(cfg) {
    if (!cfg) return;
    const markets = Array.isArray(cfg.markets) ? cfg.markets : st.markets;
    const marketsChanged = markets.join(",") !== st.markets.join(",");
    st.markets = markets;
    const intervalChanged = cfg.interval && cfg.interval !== st.interval;
    if (cfg.interval) st.interval = cfg.interval;
    if (marketsChanged) {
      renderTabs();
      refreshStats24();
    }
    if (intervalChanged) {
      renderToolbar();
      if (st.market) load(true);
    }
  }

  bus.on("snapshot", (snap) => {
    if (!snap) return;
    if (!st.market) st.market = ctx.getSelectedMarket();
    onConfigLike(snap.config);
    renderTabs();
    syncPositions();
    if (st.toggles.trades) buildMarkers();
    renderToolbarPrice();
  });

  bus.on("config-changed", (cfg) => onConfigLike(cfg));

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
    updateTabValues();
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
    if (d && d.tab === "live" && st.market && st.interval && Date.now() - st.loadedAt > 60_000) load(false);
  });

  // ───────────── Start ─────────────

  const snap0 = ctx.getState();
  if (snap0) {
    st.markets = (snap0.config && snap0.config.markets) || [];
    st.interval = (snap0.config && snap0.config.interval) || null;
  }
  renderTabs();
  renderToolbar();
  updateLegend(null);
  if (st.market && st.interval) load(true);
  else showOverlay("wait");
  if (st.markets.length) refreshStats24();
}
