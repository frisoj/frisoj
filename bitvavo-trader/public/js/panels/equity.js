// Paneel "Equity" (live tab): verloop van je totale saldo (cash + posities)
// als baseline-grafiek rond het startkapitaal: groen erboven, rood eronder.

function ensureCss() {
  if (document.querySelector('link[href$="panels.css"]')) return;
  const l = document.createElement("link");
  l.rel = "stylesheet";
  l.href = new URL("../../css/panels.css", import.meta.url).href;
  document.head.append(l);
}

const cssVar = (n) => getComputedStyle(document.documentElement).getPropertyValue(n).trim();

function themeOf(ctx) {
  const t = ctx.theme || {};
  const pick = (k, v, fb) => t[k] || cssVar(v) || fb;
  return {
    border: pick("border", "--border", "#232d3f"),
    text: pick("text", "--text", "#e5e9f0"),
    muted: pick("muted", "--muted", "#8b95a7"),
    green: pick("green", "--green", "#16c784"),
    red: pick("red", "--red", "#ef4655"),
    accent: pick("accent", "--accent", "#4c8dff"),
    grid: t.grid || "rgba(139,149,167,0.10)",
  };
}

function alpha(c, a) {
  c = String(c || "").trim();
  let m = c.match(/^#([0-9a-f]{3,8})$/i);
  if (m) {
    let h = m[1];
    if (h.length <= 4) h = h.split("").map((x) => x + x).join("");
    return `rgba(${parseInt(h.slice(0, 2), 16)},${parseInt(h.slice(2, 4), 16)},${parseInt(h.slice(4, 6), 16)},${a})`;
  }
  m = c.match(/^rgba?\(([^)]+)\)$/i);
  if (m) {
    const p = m[1].split(/[\s,/]+/).filter(Boolean);
    return `rgba(${p[0]},${p[1]},${p[2]},${a})`;
  }
  return c;
}

function tickFormatter(time, type) {
  const d = new Date(Number(time) * 1000);
  if (type === 0) return String(d.getFullYear());
  if (type === 1) return d.toLocaleDateString("nl-NL", { month: "short" });
  if (type === 2) return d.toLocaleDateString("nl-NL", { day: "numeric", month: "short" });
  return d.toLocaleTimeString("nl-NL", { hour: "2-digit", minute: "2-digit" });
}

/** Waarde die de curve toont: equity + (live) cumulatief afgeroomde winst */
export function curveValue(p) {
  return Number(p && p.equity) + (Number(p && p.skimmed) || 0);
}

/**
 * Kerncijfers voor het paneel. Live wordt winst boven de kapitaallimiet
 * afgeroomd: de engine verlaagt dan `startingEquity` met dat bedrag, dus de
 * baseline (oorspronkelijke start) is `startingEquity + skimmedQuote` en de
 * curve toont `equity + skimmed`. Rendement: `account.totalReturnPct` als de
 * server die meestuurt.
 */
export function equityFigures(s) {
  const a = (s && s.account) || {};
  const hist = Array.isArray(s && s.equityHistory) ? s.equityHistory : [];
  const skimmed = Number(s && s.skimmedQuote) > 0 ? Number(s.skimmedQuote) : 0;
  const equity = Number(a.equity);
  const rawStart = Number(a.startingEquity);
  const start = rawStart > 0 ? rawStart + skimmed : hist.length ? curveValue(hist[0]) : 0;
  const pnl = Number.isFinite(rawStart) && rawStart > 0 ? equity - rawStart : equity + skimmed - start;
  const ret = Number.isFinite(a.totalReturnPct) ? a.totalReturnPct : start > 0 ? ((equity + skimmed) / start - 1) * 100 : NaN;
  const now = { equity: equity + skimmed };
  const dd = maxDrawdownPct(hist.length ? hist.map((p) => ({ equity: curveValue(p) })).concat([now]) : [now]);
  return { equity, skimmed, start, pnl, ret, dd };
}

function maxDrawdownPct(points) {
  let peak = -Infinity;
  let dd = 0;
  for (const p of points) {
    if (p.equity > peak) peak = p.equity;
    if (peak > 0) dd = Math.min(dd, (p.equity / peak - 1) * 100);
  }
  return dd;
}

export function mountEquity(ctx, el) {
  ensureCss();
  const { fmt, esc, bus } = ctx;
  if (!el) return;
  el.classList.add("eq");

  el.innerHTML = `
    <div class="pn-head">
      <div class="panel-title">Equity-curve</div>
      <div class="pn-head-meta"><span class="eq-now mono">–</span> <span class="eq-ret mono"></span></div>
    </div>
    <div class="eq-chart-wrap"><div class="eq-chart"></div><div class="eq-empty pn-empty" hidden></div></div>
    <div class="eq-stats">
      <div class="stat"><span class="stat-label">Rendement</span><span class="stat-value eq-s-ret">–</span></div>
      <div class="stat" title="Max. drawdown: grootste daling van een piek naar een dal"><span class="stat-label">Max. daling</span><span class="stat-value eq-s-dd">–</span></div>
      <div class="stat"><span class="stat-label">Trades</span><span class="stat-value eq-s-trades">–</span></div>
      <div class="stat" title="Percentage winnende trades"><span class="stat-label">Winrate</span><span class="stat-value eq-s-win">–</span></div>
    </div>
    <div class="eq-skim" hidden></div>
    <p class="pn-hint">Groen = boven je startkapitaal, rood = eronder. De stippellijn is je startbedrag.</p>`;

  const $ = (s) => el.querySelector(s);
  const chartEl = $(".eq-chart");
  const emptyEl = $(".eq-empty");
  const LC = ctx.LightweightCharts || window.LightweightCharts;
  const t = themeOf(ctx);

  let chart = null;
  let series = null;
  let startLine = null;
  let baseValue = null;
  let lastFirst = null;
  let lastLen = 0;
  let lastTime = null;
  let pending = ctx.getState?.() || null;
  let timer = 0;
  let lastRun = 0;

  if (LC) {
    chart = LC.createChart(chartEl, {
      autoSize: true,
      layout: {
        background: { type: "solid", color: "transparent" },
        textColor: t.muted,
        fontSize: 11,
        fontFamily: cssVar("--font") || undefined,
        attributionLogo: false, // bronvermelding staat in de footer (A9)
      },
      grid: { vertLines: { visible: false }, horzLines: { color: t.grid } },
      rightPriceScale: { borderVisible: false, scaleMargins: { top: 0.12, bottom: 0.08 } },
      timeScale: { borderVisible: false, timeVisible: true, secondsVisible: false, tickMarkFormatter: tickFormatter, minBarSpacing: 0.01 },
      localization: { locale: "nl-NL", timeFormatter: (s) => fmt.dateTime(Number(s) * 1000) },
      crosshair: {
        vertLine: { color: alpha(t.muted, 0.5), labelBackgroundColor: t.border },
        horzLine: { color: alpha(t.muted, 0.5), labelBackgroundColor: t.border },
      },
      handleScroll: { mouseWheel: false, pressedMouseMove: true },
      handleScale: { mouseWheel: false, pinch: true },
    });
    series = chart.addSeries(LC.BaselineSeries, {
      baseValue: { type: "price", price: 0 },
      lineWidth: 2,
      topLineColor: t.green,
      topFillColor1: alpha(t.green, 0.28),
      topFillColor2: alpha(t.green, 0.03),
      bottomLineColor: t.red,
      bottomFillColor1: alpha(t.red, 0.03),
      bottomFillColor2: alpha(t.red, 0.28),
      priceLineVisible: false,
      lastValueVisible: true,
      priceFormat: { type: "custom", minMove: 0.01, formatter: (v) => fmt.eur(v) },
    });
  } else {
    chartEl.innerHTML = '<div class="pn-empty">Grafiekbibliotheek niet geladen.</div>';
  }

  function toData(hist) {
    const bySec = new Map();
    for (const p of hist || []) {
      if (!p || !Number.isFinite(p.time) || !Number.isFinite(curveValue(p))) continue;
      bySec.set(Math.floor(p.time / 1000), curveValue(p));
    }
    return [...bySec.entries()].sort((a, b) => a[0] - b[0]).map(([time, value]) => ({ time, value }));
  }

  function update(s) {
    if (!s || !s.account) return;
    const hist = Array.isArray(s.equityHistory) ? s.equityHistory : [];
    const { equity, skimmed, start, pnl, ret, dd } = equityFigures(s);
    const trades = Array.isArray(s.trades) ? s.trades : [];
    const wins = trades.filter((x) => x.pnlQuote > 0).length;

    $(".eq-now").textContent = fmt.eur(equity);
    const retEl = $(".eq-ret");
    retEl.textContent = fmt.pct(ret, 2);
    retEl.className = `eq-ret mono ${fmt.pnlClass(ret)}`;
    const sr = $(".eq-s-ret");
    sr.textContent = fmt.pct(ret, 2);
    sr.title = `${fmt.eurSigned(pnl)} t.o.v. start ${fmt.eur(start)}`;
    sr.className = `stat-value eq-s-ret ${fmt.pnlClass(ret)}`;
    const sd = $(".eq-s-dd");
    sd.textContent = fmt.pct(dd, 2);
    sd.className = `stat-value eq-s-dd ${dd < -0.005 ? "neg" : "flat"}`;
    $(".eq-s-trades").textContent = trades.length >= 200 ? "200+" : String(trades.length);
    $(".eq-s-win").textContent = trades.length ? fmt.pct((wins / trades.length) * 100, 0, false) : "–";
    // Live: winst boven de kapitaallimiet wordt buiten het handelsbudget gehouden
    const skimEl = $(".eq-skim");
    const showSkim = s.mode === "live" && skimmed > 0;
    skimEl.hidden = !showSkim;
    skimEl.innerHTML = showSkim
      ? `Afgeroomd boven limiet: <b class="mono pos">${esc(fmt.eur(skimmed))}</b>
         <span class="muted">— blijft op je Bitvavo-account, buiten het handelsbudget. De curve telt het mee (equity + afgeroomd).</span>`
      : "";

    if (!series) return;
    const data = toData(hist);
    if (data.length < 2) {
      emptyEl.hidden = false;
      emptyEl.textContent = "Nog te weinig data: de curve verschijnt zodra de bot een tijdje draait.";
    } else {
      emptyEl.hidden = true;
    }
    if (start !== baseValue && start > 0) {
      baseValue = start;
      series.applyOptions({ baseValue: { type: "price", price: start } });
      if (startLine) series.removePriceLine(startLine);
      startLine = series.createPriceLine({
        price: start,
        color: alpha(t.muted, 0.7),
        lineWidth: 1,
        lineStyle: 2,
        axisLabelVisible: false,
        title: "start",
      });
    }
    const first = data[0]?.time ?? null;
    const last = data[data.length - 1]?.time ?? null;
    const extends_ = first === lastFirst && data.length >= lastLen && lastLen > 0 && data.length - lastLen <= 5;
    if (extends_) {
      // Alleen nieuwe/gewijzigde punten bijwerken zodat de zoom behouden blijft
      for (const p of data.slice(Math.max(0, lastLen - 1))) {
        if (lastTime === null || p.time >= lastTime) series.update(p);
      }
    } else {
      series.setData(data);
      chart.timeScale().fitContent();
    }
    lastFirst = first;
    lastLen = data.length;
    lastTime = last;
  }

  function flush() {
    timer = 0;
    lastRun = Date.now();
    const s = pending;
    pending = null;
    try {
      update(s);
    } catch (err) {
      console.error("Equity-paneel:", err);
    }
  }

  // Throttle: hooguit eens per 2 seconden bijwerken
  function schedule() {
    if (timer) return;
    const wait = Math.max(0, 2000 - (Date.now() - lastRun));
    timer = setTimeout(flush, wait);
  }

  bus.on("snapshot", (s) => {
    pending = s;
    schedule();
  });
  bus.on("tab-changed", () => {
    if (chart && series && lastLen) requestAnimationFrame(() => chart.timeScale().fitContent());
  });

  if (pending) flush();
  else {
    emptyEl.hidden = false;
    emptyEl.textContent = "Wachten op gegevens van de bot…";
  }
}
