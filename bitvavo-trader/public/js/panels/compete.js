// Tabblad "Wedstrijd" (v3): alle bots naast elkaar. Ranglijst met een kaart per bot,
// één grafiek met de lijnen van alle bots, een analyse in gewoon Nederlands en de knoppen
// "Alles starten", "Alles stoppen" en "Noodstop alle bots".
//
// Gegevens: GET /api/bots (BotSummary[]), elke 10 s zolang dit tabblad én de pagina
// zichtbaar zijn. Andere modules (de botwisselaar in de kopbalk) delen hun gegevens via
// het bus-event "bots" { bots, error, at }; dit paneel stuurt dat event ook na elke
// verversing. Alle logica zonder DOM staat in competeLogic.js.

import {
  POLL_MS,
  CHART_MODES,
  rankBots,
  raceStarted,
  cardView,
  subtitle,
  analysis,
  chartSeries,
  chartValueText,
  chartIsEmpty,
  edgePaddedRange,
  boardState,
  bulkDisabled,
  bulkConfirm,
  bulkOutcome,
} from "./competeLogic.js";
import { normalizeBots, currentBotId, botHref } from "../bots.js";

const LS_MODE = "bvt-compete-chart";

const isNum = (v) => typeof v === "number" && Number.isFinite(v);

function lsGet(key) {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}
function lsSet(key, value) {
  try {
    localStorage.setItem(key, value);
  } catch {
    /* privémodus: dan onthouden we het niet */
  }
}

function ensureCss() {
  try {
    if (document.querySelector('link[href$="compete.css"]')) return;
    const l = document.createElement("link");
    l.rel = "stylesheet";
    l.href = new URL("../../css/compete.css", import.meta.url).href;
    document.head.append(l);
  } catch {
    /* zonder stijl werkt het paneel nog steeds */
  }
}

const cssVar = (n) => {
  try {
    return getComputedStyle(document.documentElement).getPropertyValue(n).trim();
  } catch {
    return "";
  }
};

function alpha(c, a) {
  const m = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(String(c || "").trim());
  if (!m) return c;
  let h = m[1];
  if (h.length === 3) h = h.split("").map((x) => x + x).join("");
  return `rgba(${parseInt(h.slice(0, 2), 16)},${parseInt(h.slice(2, 4), 16)},${parseInt(h.slice(4, 6), 16)},${a})`;
}

function tickFormatter(time, type) {
  const d = new Date(Number(time) * 1000);
  if (type === 0) return String(d.getFullYear());
  if (type === 1) return d.toLocaleDateString("nl-NL", { month: "short" });
  if (type === 2) return d.toLocaleDateString("nl-NL", { day: "numeric", month: "short" });
  return d.toLocaleTimeString("nl-NL", { hour: "2-digit", minute: "2-digit" });
}

const svg = (p) =>
  `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${p}</svg>`;
const I = {
  trophy: svg('<path d="M8 21h8M12 17v4"/><path d="M7 4h10v5a5 5 0 0 1-10 0z"/><path d="M17 6h3v1.5A3.5 3.5 0 0 1 16.6 11M7 6H4v1.5A3.5 3.5 0 0 0 7.4 11"/>'),
  play: svg('<path d="M7 4.5v15l12-7.5z" fill="currentColor" stroke="none"/>'),
  pause: svg('<rect x="6" y="5" width="4" height="14" rx="1" fill="currentColor" stroke="none"/><rect x="14" y="5" width="4" height="14" rx="1" fill="currentColor" stroke="none"/>'),
  kill: svg('<path d="M7.9 2h8.2L22 7.9v8.2L16.1 22H7.9L2 16.1V7.9z"/><path d="M8 12h8"/>'),
  info: svg('<circle cx="12" cy="12" r="9"/><path d="M12 11v5M12 8h.01"/>'),
  warn: svg('<path d="M10.3 3.9 2.4 18a2 2 0 0 0 1.7 3h15.8a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z"/><path d="M12 9v4M12 17h.01"/>'),
  arrow: svg('<path d="M5 12h14M13 6l6 6-6 6"/>'),
  bulb: svg('<path d="M9 18h6M10 21h4"/><path d="M12 3a6 6 0 0 0-3.5 10.9c.6.4 1 1.1 1 1.8V16h5v-.3c0-.7.4-1.4 1-1.8A6 6 0 0 0 12 3z"/>'),
};

export function mountCompete(ctx, el) {
  if (!el) return;
  ensureCss();
  const { api, bus, esc, fmt } = ctx;

  /** @type {object[] | null} */
  let bots = null;
  let error = null;
  let fetchedAt = null;
  let loading = false;
  let busy = false;
  let timer = null;
  let active = !!(ctx.getActiveTab && ctx.getActiveTab() === "compete");
  let mode = lsGet(LS_MODE) === "eur" ? "eur" : "pct";
  const openDesc = new Set();
  const hiddenSeries = new Set();
  let boardKey = "";

  el.classList.add("cp");
  el.innerHTML = `
    <section class="panel cp-head" aria-label="Bot-wedstrijd">
      <div class="cp-head-main">
        <h2 class="cp-title">${I.trophy}<span>Bot-wedstrijd</span></h2>
        <p class="cp-sub" data-cp="sub">Bots laden…</p>
      </div>
      <div class="cp-actions" data-cp="actions">
        <button type="button" class="btn btn-success" data-cp-act="start" disabled title="Start elke bot die stilstaat">${I.play}<span>Alles starten</span></button>
        <button type="button" class="btn" data-cp-act="stop" disabled title="Stop alle bots (open posities blijven staan)">${I.pause}<span>Alles stoppen</span></button>
        <button type="button" class="btn btn-danger" data-cp-act="kill" disabled title="Elke bot verkoopt direct alles en stopt">${I.kill}<span>Noodstop alle bots</span></button>
      </div>
    </section>
    <div class="cp-note" data-cp="note" role="status" hidden></div>
    <div class="cp-board" data-cp="board" aria-label="Ranglijst">
      <div class="cp-state"><span class="spinner"></span> Bots laden…</div>
    </div>
    <div class="cp-lower" data-cp="lower" hidden>
      <section class="panel cp-chart-panel" aria-label="Verloop van alle bots">
        <div class="panel-title cp-chart-title">Verloop
          <span class="panel-actions cp-modes" data-cp="modes" role="group" aria-label="Wat de grafiek toont"></span>
        </div>
        <div class="cp-legend" data-cp="legend"></div>
        <div class="cp-chart-wrap">
          <div class="cp-chart" data-cp="chart"></div>
          <div class="cp-chart-empty" data-cp="chartempty" hidden></div>
        </div>
      </section>
      <section class="panel cp-analysis" data-cp="analysis" aria-label="Wat zien we?" aria-live="polite"></section>
    </div>`;

  const part = (k) => el.querySelector(`[data-cp="${k}"]`);
  const chartEl = part("chart");

  // ───────────── Grafiek ─────────────

  const LC = ctx.LightweightCharts || (typeof window !== "undefined" ? window.LightweightCharts : undefined);
  const t = ctx.theme || {};
  const muted = t.muted || cssVar("--muted") || "#7e889d";
  let chart = null;
  /** bot-id → { series, color } */
  const seriesById = new Map();
  let zeroSeries = null;
  let needFit = true;
  let hover = null; // { time, values: Map } tijdens het bewegen over de grafiek
  let lastSize = "";
  let lastSeries = [];
  /** Aantal verschillende tijden in de grafiek (= logische punten 0 … n−1) */
  let pointCount = 0;

  if (LC && chartEl && typeof LC.createChart === "function") {
    try {
      chart = LC.createChart(chartEl, {
        layout: {
          background: { type: "solid", color: "transparent" },
          textColor: muted,
          fontSize: 11,
          fontFamily: t.font || cssVar("--font") || undefined,
          attributionLogo: false, // bronvermelding staat in de footer
        },
        grid: { vertLines: { visible: false }, horzLines: { color: t.grid || "rgba(126,136,157,0.12)" } },
        rightPriceScale: { borderVisible: false, scaleMargins: { top: 0.12, bottom: 0.1 } },
        timeScale: { borderVisible: false, timeVisible: true, secondsVisible: false, tickMarkFormatter: tickFormatter, minBarSpacing: 0.01 },
        localization: {
          locale: "nl-NL",
          timeFormatter: (s) => fmt.dateTime(Number(s) * 1000),
          priceFormatter: (v) => chartValueText(v, mode),
        },
        crosshair: {
          vertLine: { color: alpha(muted, 0.5), labelBackgroundColor: t.border || "#222b3c" },
          horzLine: { color: alpha(muted, 0.5), labelBackgroundColor: t.border || "#222b3c" },
        },
        handleScroll: { mouseWheel: false, pressedMouseMove: true },
        handleScale: { mouseWheel: false, pinch: true },
      });
      // Onzichtbare lijn op 0 (het startpunt): houdt 0 in beeld en draagt de stippellijn "start"
      zeroSeries = chart.addSeries(LC.LineSeries, {
        color: "rgba(0,0,0,0)",
        lineVisible: false,
        lastValueVisible: false,
        priceLineVisible: false,
        crosshairMarkerVisible: false,
      });
      zeroSeries.createPriceLine({ price: 0, color: alpha(muted, 0.75), lineWidth: 1, lineStyle: 2, axisLabelVisible: false, title: "start" });
      if (typeof chart.subscribeCrosshairMove === "function") chart.subscribeCrosshairMove(onCrosshair);
    } catch (err) {
      console.error("Wedstrijd-grafiek:", err);
      chart = null;
    }
  }
  if (!chart && chartEl) chartEl.innerHTML = '<div class="cp-chart-empty">Grafiekbibliotheek niet geladen.</div>';

  /**
   * Grafiek even groot maken als zijn vak (bij tab-changed, resize en voor het passend
   * maken). Was hij nog nooit zichtbaar (verborgen tabblad of nog geen gegevens), dan
   * daarna ook passend maken: fitContent op breedte 0 geeft een samengedrukte lijn.
   */
  function sizeChart() {
    if (!chart || !chartEl) return;
    const w = Math.floor(chartEl.clientWidth || 0);
    const h = Math.floor(chartEl.clientHeight || 0);
    if (!(w > 0 && h > 0)) return;
    const key = `${w}x${h}`;
    if (key === lastSize) return;
    const first = !lastSize;
    lastSize = key;
    if (typeof chart.resize === "function") chart.resize(w, h);
    else chart.applyOptions({ width: w, height: h });
    if (first) needFit = true;
    if (needFit && seriesById.size) fit();
  }
  function fit() {
    if (!chart || !active) return;
    if (!lastSize) {
      sizeChart();
      if (!lastSize) return; // nog geen afmetingen: later (tab-changed / ResizeObserver)
    }
    const ts = chart.timeScale();
    ts.fitContent();
    // Marge links en rechts, zodat het eerste en laatste tijdlabel heel blijven. Uit het
    // aantal punten (0 … n−1), niet uit getVisibleLogicalRange(): lightweight-charts past
    // fitContent pas bij de volgende tekenbeurt toe.
    try {
      if (pointCount >= 2 && typeof ts.setVisibleLogicalRange === "function") {
        const tw = typeof ts.width === "function" ? Number(ts.width()) : 0;
        const w = tw > 0 ? tw : Math.max(0, (chartEl.clientWidth || 0) - 56);
        const r = edgePaddedRange({ from: 0, to: pointCount - 1 }, w);
        if (r) ts.setVisibleLogicalRange(r);
      }
    } catch {
      /* oudere lightweight-charts: alleen passend maken */
    }
    needFit = false;
  }
  if (chartEl && typeof ResizeObserver === "function") {
    try {
      new ResizeObserver(() => sizeChart()).observe(chartEl);
    } catch {
      /* dan alleen bij tab-changed en resize */
    }
  }
  if (typeof window !== "undefined" && typeof window.addEventListener === "function") window.addEventListener("resize", () => sizeChart());

  function onCrosshair(param) {
    if (param && param.time !== undefined && param.seriesData && typeof param.seriesData.get === "function") {
      const values = new Map();
      for (const [id, e] of seriesById) {
        const d = param.seriesData.get(e.series);
        if (d && isNum(d.value)) values.set(id, d.value);
      }
      hover = values.size ? { time: Number(param.time), values } : null;
    } else hover = null;
    renderLegend();
  }

  function renderChart() {
    const ser = chartSeries(bots || [], mode, fetchedAt);
    lastSeries = ser;
    if (chart) {
      const ids = new Set(ser.map((s) => s.id));
      for (const [id, e] of seriesById) {
        if (ids.has(id)) continue;
        try {
          chart.removeSeries(e.series);
        } catch {
          /* al weg */
        }
        seriesById.delete(id);
        needFit = true;
      }
      let tMin = Infinity;
      let tMax = -Infinity;
      for (const s of ser) {
        let e = seriesById.get(s.id);
        if (!e) {
          e = {
            series: chart.addSeries(LC.LineSeries, {
              color: s.color,
              lineWidth: 2,
              priceLineVisible: false,
              lastValueVisible: true,
              crosshairMarkerRadius: 4,
              priceFormat: { type: "custom", minMove: 0.0001, formatter: (v) => chartValueText(v, mode) },
            }),
            color: s.color,
            visible: true,
          };
          seriesById.set(s.id, e);
          needFit = true;
        } else if (e.color !== s.color) {
          e.series.applyOptions({ color: s.color });
          e.color = s.color;
        }
        e.series.setData(s.data);
        const vis = !hiddenSeries.has(s.id);
        if (vis !== e.visible) {
          e.series.applyOptions({ visible: vis });
          e.visible = vis;
        }
        if (s.data.length) {
          tMin = Math.min(tMin, s.data[0].time);
          tMax = Math.max(tMax, s.data[s.data.length - 1].time);
        }
      }
      if (zeroSeries) {
        const zero = isFinite(tMin) ? (tMax > tMin ? [{ time: tMin, value: 0 }, { time: tMax, value: 0 }] : [{ time: tMin, value: 0 }]) : [];
        zeroSeries.setData(zero);
      }
      const times = new Set();
      for (const s of ser) for (const d of s.data) times.add(d.time);
      pointCount = times.size;
      if (needFit) fit();
    }
    const emptyEl = part("chartempty");
    if (emptyEl) {
      const empty = chartIsEmpty(ser);
      emptyEl.hidden = !empty;
      emptyEl.textContent = empty ? "Nog te weinig gegevens: de lijnen verschijnen zodra de bots een tijdje draaien." : "";
    }
    renderModes();
    renderLegend();
  }

  function renderModes() {
    const m = part("modes");
    if (!m) return;
    m.innerHTML = CHART_MODES.map(
      (c) =>
        `<button type="button" class="cp-chip" data-cp-mode="${c.key}" aria-pressed="${c.key === mode}" title="${esc(c.tip)}">${esc(c.label)}</button>`,
    ).join("");
  }

  function renderLegend() {
    const lg = part("legend");
    if (!lg) return;
    const items = lastSeries.map((s) => {
      const v = hover ? hover.values.get(s.id) : s.last;
      const off = hiddenSeries.has(s.id);
      return `<button type="button" class="cp-leg${off ? " is-off" : ""}" data-cp-leg="${esc(s.id)}" aria-pressed="${!off}" title="${
        off ? "Lijn tonen" : "Lijn verbergen"
      }: ${esc(s.name)}"><span class="cp-leg-dot" style="background:${s.color}"></span><span class="cp-leg-name">${esc(
        s.short,
      )}</span><span class="cp-leg-val mono ${isNum(v) ? fmt.pnlClass(Math.abs(v) < 0.005 ? 0 : v) : "flat"}">${esc(
        isNum(v) ? chartValueText(v, mode) : "–",
      )}</span></button>`;
    });
    const when = hover ? `<span class="cp-leg-time mono">${esc(fmt.dateTime(hover.time * 1000))}</span>` : "";
    lg.innerHTML = when + items.join("");
  }

  // ───────────── Ranglijst, analyse, kop ─────────────

  function currentId() {
    let path = "";
    try {
      path = globalThis.location ? globalThis.location.pathname : "";
    } catch {
      path = "";
    }
    return currentBotId(bots, ctx.getInfo ? ctx.getInfo() : null, path);
  }

  function cardHtml(v) {
    const s = v.status;
    const open = openDesc.has(v.id);
    const cost = v.cost;
    const kept = cost.kind === "keeps" ? cost.keptPct : 0;
    return `<article class="cp-card${v.current ? " is-current" : ""}" data-id="${esc(v.id)}" aria-label="${esc(`${v.medal.label}: ${v.name}`)}">
      <span class="cp-stripe" style="background:${v.color}" aria-hidden="true"></span>
      <div class="cp-card-head">
        <span class="cp-medal ${v.medal.cls}" title="${esc(v.medal.label)}">${esc(v.medal.text)}</span>
        <div class="cp-who">
          <div class="cp-name" title="${esc(v.description || v.name)}"><span class="cp-dot" style="background:${v.color}" aria-hidden="true"></span><span class="cp-name-txt">${esc(
            v.name,
          )}</span></div>
          <div class="cp-badges">
            <span class="badge ${s.cls}"${s.reason ? ` title="${esc(s.reason)}"` : ""}><span class="cp-sdot" aria-hidden="true"></span>${esc(s.label)}</span>
            ${v.live ? `<span class="badge ${v.live.cls}" title="${esc(v.live.title)}">${esc(v.live.text)}</span>` : ""}
            ${v.current ? '<span class="badge badge-accent" title="Je kijkt nu naar het dashboard van deze bot">Hier</span>' : ""}
          </div>
        </div>
      </div>
      <div class="cp-meta">${v.meta.map((m, i) => `<span${i === 0 && v.paceTip ? ` title="${esc(v.paceTip)}"` : ""}>${esc(m)}</span>`).join("")}</div>
      <div class="cp-result">
        <span class="cp-res-eur mono ${v.resultCls}">${esc(v.resultEur)}</span>
        <span class="cp-res-pct mono ${v.resultCls}">${esc(v.resultPct)}</span>
      </div>
      <div class="cp-cost ${cost.kind}" title="Groen = wat de bot overhoudt, rood = wat naar kosten ging">
        <span class="cp-cost-bar" aria-hidden="true"><i style="width:${kept.toFixed(1)}%"></i></span>
        <span class="cp-cost-txt">${esc(cost.text)}</span>
      </div>
      <dl class="cp-stats">
        <div><dt>Vóór kosten</dt><dd class="mono ${v.grossCls}">${esc(v.grossEur)}</dd></div>
        <div><dt>Kosten</dt><dd class="mono">${esc(v.fees)}</dd></div>
        <div><dt>Winrate</dt><dd class="cp-wrap"><span class="mono ${v.winCls}">${esc(v.winRate)}</span> <small>${esc(v.winLoss)}</small></dd></div>
        <div title="Vandaag: trades die de bot vandaag opende. Afgesloten: trades die al verkocht zijn (sinds de start)."><dt>Trades</dt><dd class="cp-wrap"><span><span class="mono">${esc(
          v.tradesToday,
        )}</span> <small>vandaag</small> ·</span> <span><span class="mono">${esc(v.tradesTotal)}</span> <small>afgesloten</small></span></dd></div>
        <div title="Grootste daling van een piek naar een dal"><dt>Max. daling</dt><dd class="mono ${v.ddCls}">${esc(v.maxDd)}</dd></div>
        <div><dt>Vandaag</dt><dd class="cp-wrap"><span class="mono ${v.dayCls}">${esc(v.dayEur)}</span> <small class="${v.dayCls}">${esc(v.dayPct)}</small></dd></div>
      </dl>
      ${s.reason ? `<p class="cp-halt is-${s.key}">${esc(s.reason)}</p>` : ""}
      <div class="cp-card-foot">
        ${
          v.description
            ? `<button type="button" class="cp-desc-btn" data-cp-desc="${esc(v.id)}" aria-expanded="${open}">${I.info}<span>${
                open ? "Verberg uitleg" : "Hoe handelt hij?"
              }</span></button>`
            : "<span></span>"
        }
        <a class="btn btn-sm cp-open" href="${esc(v.href)}">Open dashboard${I.arrow}</a>
      </div>
      ${v.description ? `<p class="cp-desc"${open ? "" : " hidden"}>${esc(v.description)}</p>` : ""}
    </article>`;
  }

  function stateHtml(st) {
    const icon = st.kind === "loading" ? '<span class="spinner"></span>' : st.kind === "unsupported" ? I.bulb : I.warn;
    return `<div class="cp-state is-${st.kind}">
      <span class="cp-state-ico">${icon}</span>
      <div><b>${esc(st.title)}</b>${st.text ? `<p>${esc(st.text)}</p>` : ""}${
        st.kind === "error" || st.kind === "auth" ? '<button type="button" class="btn btn-sm" data-cp-retry>Opnieuw proberen</button>' : ""
      }</div>
    </div>`;
  }

  function renderActions(st) {
    const actions = part("actions");
    const state = st || boardState(bots, error);
    const show = state.kind === "ok" || state.kind === "single";
    if (actions) actions.hidden = !show;
    const dis = bulkDisabled(show ? bots : null, busy);
    for (const k of ["start", "stop", "kill"]) {
      const b = el.querySelector(`[data-cp-act="${k}"]`);
      if (b) b.disabled = dis[k];
    }
  }

  function render() {
    const st = boardState(bots, error);
    const sub = part("sub");
    if (sub) {
      sub.textContent =
        st.kind === "ok" || st.kind === "single"
          ? subtitle(bots, fetchedAt)
          : st.kind === "loading"
            ? "Bots laden…"
            : st.kind === "unsupported"
              ? "Vergelijk meerdere bots met elk een eigen budget en handelsstijl."
              : "";
    }
    renderActions(st);

    const note = part("note");
    const noteText = st.kind === "single" ? [st.text, st.stale].filter(Boolean).join(" ") : st.kind === "ok" ? st.stale : "";
    if (note) {
      note.hidden = !noteText;
      note.className = `cp-note${st.stale ? " is-warn" : ""}`;
      note.textContent = noteText || "";
    }

    const board = part("board");
    const lower = part("lower");
    const hasData = st.kind === "ok" || st.kind === "single";
    if (lower) lower.hidden = !hasData;
    if (!hasData) {
      const key = `state|${st.kind}|${st.title}|${st.text}`;
      if (board && key !== boardKey) {
        board.innerHTML = stateHtml(st);
        boardKey = key;
      }
      return;
    }
    const cur = currentId();
    const started = raceStarted(bots);
    const solo = bots.length === 1;
    const views = rankBots(bots).map((b) => cardView(b, cur, started, solo));
    const key = JSON.stringify([views, [...openDesc]]);
    if (board) board.classList.toggle("is-single", views.length === 1);
    if (board && key !== boardKey) {
      board.innerHTML = views.map(cardHtml).join("");
      boardKey = key;
    }
    renderAnalysis();
    renderChart();
  }

  function renderAnalysis() {
    const box = part("analysis");
    if (!box) return;
    const a = analysis(bots);
    box.innerHTML = `
      <div class="panel-title">Wat zien we?</div>
      <p class="cp-headline ${a.headline.tone}">${esc(a.headline.text)}</p>
      ${
        a.points.length
          ? `<ul class="cp-points">${a.points.map((p) => `<li class="is-${p.tone}" data-key="${esc(p.key)}">${esc(p.text)}</li>`).join("")}</ul>`
          : ""
      }
      <p class="cp-foot">Winst of verlies uit het verleden zegt weinig over de toekomst. Kijk vooral naar een langere periode en veel trades.</p>`;
  }

  // ───────────── Gegevens ophalen ─────────────

  function pageVisible() {
    try {
      return !(typeof document !== "undefined" && document && document.hidden);
    } catch {
      return true;
    }
  }
  const isVisible = () => active && pageVisible();

  async function load() {
    if (loading || !api || typeof api.getBots !== "function") return;
    loading = true;
    let list = null;
    let err = null;
    try {
      list = normalizeBots(await api.getBots());
      if (!list) err = { status: 0, message: "Onverwacht antwoord van de server" };
    } catch (e) {
      err = { status: e && isNum(e.status) ? e.status : 0, message: (e && e.message) || String(e) };
    } finally {
      loading = false;
    }
    // Deelt de gegevens met de botwisselaar (en werkt dit paneel bij via de handler hieronder)
    bus.emit("bots", { bots: list, error: err, at: Date.now() });
  }

  async function tick() {
    timer = null;
    if (!isVisible()) return;
    await load();
    if (isVisible() && !timer) timer = setTimeout(tick, POLL_MS);
  }

  /** Tabblad of pagina (on)zichtbaar geworden: verversen starten of stoppen */
  function onVisibility() {
    if (!isVisible()) {
      if (timer) clearTimeout(timer);
      timer = null;
      return;
    }
    if (timer) return;
    if (loading) {
      timer = setTimeout(tick, POLL_MS);
      return;
    }
    tick();
  }

  async function refreshAll() {
    await load();
    // De kopbalk van dit dashboard toont de staat van de huidige bot: meteen bijwerken
    try {
      const s = api && typeof api.getState === "function" ? await api.getState() : null;
      if (s && typeof s === "object" && s.account) bus.emit("snapshot", s);
    } catch {
      /* de SSE-stream levert de volgende snapshot */
    }
  }

  bus.on("bots", (d) => {
    if (!d || typeof d !== "object") return;
    const list = Array.isArray(d.bots) ? normalizeBots(d.bots) : null;
    const err = d.error && typeof d.error === "object" ? d.error : null;
    if (list) {
      bots = list;
      fetchedAt = isNum(d.at) ? d.at : Date.now();
    } else if (err && err.status === 404) {
      bots = null; // de server heeft (nu) geen wedstrijd
    }
    error = list ? null : err;
    render();
  });

  bus.on("tab-changed", (d) => {
    const was = active;
    active = !!d && d.tab === "compete";
    if (active) {
      const raf = typeof requestAnimationFrame === "function" ? requestAnimationFrame : (fn) => setTimeout(fn, 0);
      raf(() => {
        sizeChart();
        if (!was || needFit) fit();
      });
    }
    onVisibility();
  });

  try {
    if (typeof document !== "undefined" && document && typeof document.addEventListener === "function") {
      document.addEventListener("visibilitychange", onVisibility);
    }
  } catch {
    /* geen document: dan alleen via tab-changed */
  }

  // ───────────── Knoppen ─────────────

  const ACTIONS = { start: "startAll", stop: "stopAll", kill: "killAll" };

  function onBulk(action) {
    if (busy || !bots || !bots.length) return;
    const c = bulkConfirm(action, bots);
    ctx.openModal({
      title: c.title,
      danger: c.danger,
      confirmText: c.confirmText,
      bodyHtml: c.lines.map((l) => `<p${l.warn ? ' class="neg"' : ""}>${l.warn ? `<strong>${esc(l.text)}</strong>` : esc(l.text)}</p>`).join(""),
      onConfirm: (_value, modalEl) => runBulk(action, modalEl),
    });
  }

  async function runBulk(action, modalEl) {
    const fn = api && api[ACTIONS[action]];
    if (typeof fn !== "function") throw new Error("Deze server kent deze actie niet");
    const before = bots;
    busy = true;
    renderActions();
    try {
      let res;
      try {
        res = await fn();
      } catch (err) {
        // Kan deels gelukt zijn: toon de echte staat; de fout verschijnt in het venster
        await refreshAll();
        throw err;
      }
      await refreshAll();
      const out = bulkOutcome(action, res, before || bots || []);
      for (const [msg, kind] of out.toasts) ctx.toast(msg, kind);
      if (out.failed && action === "kill" && modalEl && typeof modalEl.querySelector === "function") {
        const list = before || bots || [];
        const links = (out.failedIds || [])
          .map((id) => list.find((b) => b.id === id))
          .filter(Boolean)
          .map((b) => ({ name: b.name || b.short || b.id, href: botHref(b, "live") }));
        showKillFailures(
          modalEl,
          out.toasts.filter(([, k]) => k === "error").map(([m]) => m),
          links,
        );
        return false;
      }
      return undefined;
    } finally {
      busy = false;
      renderActions();
    }
  }

  /** Noodstop deels mislukt: het venster blijft open met per bot wat er NIET lukte (en een link naar die bot) */
  function showKillFailures(modalEl, lines, links = []) {
    const title = modalEl.querySelector(".modal-head h3");
    if (title) title.textContent = "Noodstop: niet alles gelukt";
    const body = modalEl.querySelector(".modal-body");
    if (body) {
      body.innerHTML = `<p class="neg"><strong>Niet alles is gelukt:</strong></p>
        <ul>${lines.map((l) => `<li>${esc(l)}</li>`).join("")}</ul>
        <p>Open het dashboard van die bot om de posities te controleren en zo nodig zelf te sluiten.</p>${
          links.length
            ? `<p class="cp-kill-links">${links
                .map((l) => `<a class="btn btn-sm" href="${esc(l.href)}">Open ${esc(l.name)}${I.arrow}</a>`)
                .join("")}</p>`
            : ""
        }`;
    }
    const errEl = modalEl.querySelector(".modal-error");
    if (errEl) errEl.hidden = true;
    const ok = modalEl.querySelector('[data-m="ok"]');
    if (ok) ok.remove();
    const cancel = modalEl.querySelector('[data-m="cancel"]');
    if (cancel) {
      cancel.textContent = "Sluiten";
      if (typeof cancel.focus === "function") cancel.focus();
    }
  }

  el.addEventListener("click", (e) => {
    const target = e && e.target;
    if (!target || typeof target.closest !== "function") return;
    const act = target.closest("[data-cp-act]");
    if (act) {
      if (!act.disabled) onBulk(act.dataset.cpAct);
      return;
    }
    const desc = target.closest("[data-cp-desc]");
    if (desc) {
      const id = desc.dataset.cpDesc;
      if (openDesc.has(id)) openDesc.delete(id);
      else openDesc.add(id);
      render();
      return;
    }
    const m = target.closest("[data-cp-mode]");
    if (m) {
      const next = m.dataset.cpMode === "eur" ? "eur" : "pct";
      if (next !== mode) {
        mode = next;
        lsSet(LS_MODE, mode);
        needFit = true;
        renderChart();
      }
      return;
    }
    const leg = target.closest("[data-cp-leg]");
    if (leg) {
      const id = leg.dataset.cpLeg;
      if (hiddenSeries.has(id)) hiddenSeries.delete(id);
      else hiddenSeries.add(id);
      renderChart();
      return;
    }
    if (target.closest("[data-cp-retry]")) load();
  });

  // Eerste weergave; staat dit tabblad al open (bijv. #compete), dan meteen ophalen
  render();
  if (active) {
    const raf = typeof requestAnimationFrame === "function" ? requestAnimationFrame : (fn) => setTimeout(fn, 0);
    raf(() => sizeChart());
  }
  onVisibility();
}
