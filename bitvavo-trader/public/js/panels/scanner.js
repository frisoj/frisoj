// Marktscanner: overzicht van de meest verhandelde EUR-markten met signaal,
// score, RSI, volatiliteit en een mini-grafiek. Twee weergaven: tabel en
// heatmap (tegels gekleurd op 24u-verandering, grootte ≈ volume).

import { MAX_MARKETS, isAutoUniverse, botMarketsOf, addPlan, planPatch } from "./scannerLogic.js";

const REFRESH_MS = 60_000;

function ensureCss() {
  if (document.querySelector('link[href$="panels.css"]')) return;
  const l = document.createElement("link");
  l.rel = "stylesheet";
  l.href = new URL("../../css/panels.css", import.meta.url).href;
  document.head.append(l);
}

function tipEl() {
  let t = document.getElementById("a10-tip");
  if (!t) {
    t = document.createElement("div");
    t.id = "a10-tip";
    t.className = "pn-tip";
    t.setAttribute("role", "tooltip");
    document.body.append(t);
  }
  return t;
}

function regimeIcon(regime) {
  const p = {
    "trend-up": '<polyline points="1.5,11.5 5.5,7 8.5,9.5 13,4"/><polyline points="9.5,4 13,4 13,7.5"/>',
    "trend-down": '<polyline points="1.5,3.5 5.5,8 8.5,5.5 13,11"/><polyline points="9.5,11 13,11 13,7.5"/>',
    range: '<line x1="1.5" y1="7.5" x2="13.5" y2="7.5"/><polyline points="4,5 1.5,7.5 4,10"/><polyline points="11,5 13.5,7.5 11,10"/>',
    volatile: '<polyline points="1,8 3,3.5 5.2,11.5 7.4,2.5 9.6,12 11.8,4.5 14,8"/>',
    unknown: '<circle cx="7.5" cy="7.5" r="6"/><path d="M5.6 5.8a2 2 0 1 1 2.6 1.9c-.5.2-.7.6-.7 1.1v.4"/>',
  }[regime] || "";
  return `<svg class="pn-ico" viewBox="0 0 15 15" aria-hidden="true">${p}</svg>`;
}

const nf2 = new Intl.NumberFormat("nl-NL", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const signed2 = (v) => (v > 0 ? "+" : "") + nf2.format(v);

const compactEur = new Intl.NumberFormat("nl-NL", {
  style: "currency",
  currency: "EUR",
  notation: "compact",
  maximumFractionDigits: 1,
});

function sparkline(values, w = 96, h = 28) {
  const v = (values || []).filter(Number.isFinite);
  if (v.length < 2) return '<span class="muted">–</span>';
  const min = Math.min(...v);
  const max = Math.max(...v);
  const rng = max - min || 1;
  const pts = v.map((y, i) => [(i / (v.length - 1)) * (w - 2) + 1, h - 3 - ((y - min) / rng) * (h - 6)]);
  const line = pts.map((p) => `${p[0].toFixed(1)},${p[1].toFixed(1)}`).join(" ");
  const up = v[v.length - 1] >= v[0];
  const last = pts[pts.length - 1];
  return `<svg class="sc-spark ${up ? "is-up" : "is-down"}" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}" aria-hidden="true">
    <polygon class="sc-spark-area" points="1,${h} ${line} ${w - 1},${h}"/>
    <polyline class="sc-spark-line" points="${line}"/>
    <circle cx="${last[0].toFixed(1)}" cy="${last[1].toFixed(1)}" r="2"/>
  </svg>`;
}

// Squarified treemap (Bruls et al.) — geeft rechthoeken voor items met .value
function squarify(items, x, y, w, h) {
  const total = items.reduce((s, it) => s + it.value, 0) || 1;
  const scale = (w * h) / total;
  const rest = items.map((it) => ({ it, area: it.value * scale })).filter((r) => r.area > 0);
  const rects = [];
  let row = [];
  const worst = (r, side) => {
    const s = r.reduce((a, b) => a + b.area, 0);
    let mx = 0;
    let mn = Infinity;
    for (const b of r) {
      mx = Math.max(mx, b.area);
      mn = Math.min(mn, b.area);
    }
    return Math.max((side * side * mx) / (s * s), (s * s) / (side * side * mn));
  };
  const layout = (r) => {
    const s = r.reduce((a, b) => a + b.area, 0);
    if (w >= h) {
      const cw = s / h;
      let yy = y;
      for (const b of r) {
        const ih = b.area / cw;
        rects.push({ it: b.it, x, y: yy, w: cw, h: ih });
        yy += ih;
      }
      x += cw;
      w -= cw;
    } else {
      const rh = s / w;
      let xx = x;
      for (const b of r) {
        const iw = b.area / rh;
        rects.push({ it: b.it, x: xx, y, w: iw, h: rh });
        xx += iw;
      }
      y += rh;
      h -= rh;
    }
  };
  while (rest.length) {
    const side = Math.min(w, h);
    const next = rest[0];
    if (!row.length || worst(row.concat(next), side) <= worst(row, side)) {
      row.push(next);
      rest.shift();
    } else {
      layout(row);
      row = [];
    }
  }
  if (row.length) layout(row);
  return rects;
}

const COLUMNS = [
  { key: "market", label: "Markt", get: (r) => r.market, str: true },
  { key: "price", label: "Prijs", get: (r) => r.price, r: true },
  { key: "changePct24h", label: "24u", get: (r) => r.changePct24h, r: true, help: "Koersverandering in de afgelopen 24 uur" },
  { key: "volumeQuote24h", label: "Volume 24u", get: (r) => r.volumeQuote24h, r: true, help: "Handelsvolume in euro's. Hoger = makkelijker kopen/verkopen tegen een eerlijke prijs" },
  { key: "volatilityPct", label: "Volatiliteit", get: (r) => r.volatilityPct, r: true, help: "Gemiddelde beweging per candle (ATR%). Hoger = grotere kansen én grotere risico's" },
  { key: "spreadPct", label: "Spread", get: (r) => r.spreadPct, r: true, help: "Verschil tussen koop- en verkoopprijs. Een verborgen kostenpost: lager is beter" },
  { key: "regime", label: "Regime", get: (r) => r.regime, str: true },
  { key: "action", label: "Signaal", get: (r) => ({ buy: 2, hold: 1, sell: 0 })[r.action] ?? 1 },
  { key: "score", label: "Score", get: (r) => r.score, help: "Ensemble-score −1 (sterk verkopen) tot +1 (sterk kopen)" },
  { key: "rsi", label: "RSI", get: (r) => r.rsi, help: "Relative Strength Index: onder 30 'oversold' (mogelijk te ver gedaald), boven 70 'overbought'" },
  { key: "sparkline", label: "Koers (laatste 48)", get: null },
];

export function mountScanner(ctx, el) {
  ensureCss();
  const { fmt, esc, api, bus } = ctx;
  if (!el) return;
  el.classList.add("sc");

  const state = {
    rows: [],
    loading: false,
    error: null,
    loadedAt: 0,
    sortKey: "score",
    sortDir: -1,
    view: "table",
    filter: "",
    activeTab: ctx.getActiveTab?.() || null,
    config: ctx.getState?.()?.config || null,
    /** Laatste snapshot: `activeMarkets` = de munten die de bot nu volgt */
    snapshot: ctx.getState?.() || null,
  };
  try {
    const v = localStorage.getItem("bvt-scanner-view");
    if (v === "heatmap" || v === "table") state.view = v;
  } catch {
    /* geen localStorage */
  }

  el.innerHTML = `
    <div class="panel sc-bar">
      <div class="sc-bar-left">
        <div class="panel-title">Marktscanner</div>
        <p class="pn-hint">De populairste EUR-markten op Bitvavo, beoordeeld door dezelfde strategieën als de bot. Klik op een markt om hem toe te voegen of te bekijken.</p>
      </div>
      <div class="sc-bar-right">
        <input class="input sc-search" type="search" placeholder="Zoek markt…" aria-label="Zoek markt">
        <div class="pn-seg" role="tablist" aria-label="Weergave">
          <button type="button" data-view="table" role="tab">Tabel</button>
          <button type="button" data-view="heatmap" role="tab">Heatmap</button>
        </div>
        <button type="button" class="btn sc-refresh" title="Nu vernieuwen">
          <svg class="pn-ico" viewBox="0 0 15 15" aria-hidden="true"><path d="M12.5 7.5a5 5 0 1 1-1.5-3.6"/><polyline points="11.5,1.5 11.5,4.2 8.8,4.2"/></svg>
          Vernieuwen</button>
        <div class="sc-status muted"></div>
      </div>
    </div>
    <div class="sc-summary"></div>
    <div class="panel sc-body"></div>
    <div class="sc-pop" hidden></div>`;

  const $ = (s) => el.querySelector(s);
  const body = $(".sc-body");
  const statusEl = $(".sc-status");
  const pop = $(".sc-pop");
  const summary = $(".sc-summary");

  /** De munten die de bot nu volgt (automatische keuze of eigen lijst) */
  function botMarkets() {
    return botMarketsOf(state.snapshot || ctx.getState?.(), state.config);
  }

  function isVisible() {
    if (document.visibilityState === "hidden") return false;
    if (state.activeTab) return state.activeTab === "scanner";
    return el.getClientRects().length > 0;
  }

  function setView(v) {
    state.view = v;
    try {
      localStorage.setItem("bvt-scanner-view", v);
    } catch {
      /* ignore */
    }
    for (const b of el.querySelectorAll(".pn-seg [data-view]")) {
      b.classList.toggle("is-active", b.dataset.view === v);
      b.setAttribute("aria-selected", String(b.dataset.view === v));
    }
    render();
  }

  function sortedRows() {
    const f = state.filter.trim().toUpperCase();
    let rows = state.rows.filter((r) => !f || r.market.toUpperCase().includes(f));
    const col = COLUMNS.find((c) => c.key === state.sortKey);
    if (col?.get) {
      rows = rows.slice().sort((a, b) => {
        const va = col.get(a);
        const vb = col.get(b);
        const na = va === null || va === undefined || (typeof va === "number" && !Number.isFinite(va));
        const nb = vb === null || vb === undefined || (typeof vb === "number" && !Number.isFinite(vb));
        if (na && nb) return 0;
        if (na) return 1;
        if (nb) return -1;
        if (col.str) return String(va).localeCompare(String(vb)) * state.sortDir;
        return (va - vb) * state.sortDir;
      });
    }
    return rows;
  }

  function scoreBar(s) {
    const v = Math.max(-1, Math.min(1, Number(s) || 0));
    const w = Math.abs(v) * 50;
    return `<div class="sc-score" title="Score ${esc(signed2(v))}">
      <span class="sc-score-track"><i class="${v >= 0 ? "is-pos" : "is-neg"}" style="left:${v >= 0 ? 50 : 50 - w}%;width:${w}%"></i></span>
      <span class="mono">${esc(signed2(v))}</span></div>`;
  }

  function rsiBar(rsi) {
    if (!Number.isFinite(rsi)) return '<span class="muted">–</span>';
    const zone = rsi < 30 ? "low" : rsi > 70 ? "high" : "mid";
    return `<div class="sc-rsi" data-z="${zone}" title="RSI ${esc(fmt.num(rsi, 0))}${zone === "low" ? " — oversold" : zone === "high" ? " — overbought" : ""}">
      <span class="sc-rsi-track"><i style="left:${Math.max(0, Math.min(100, rsi))}%"></i></span><span class="mono">${esc(fmt.num(rsi, 0))}</span></div>`;
  }

  function renderSummary() {
    if (!state.rows.length) {
      summary.innerHTML = "";
      return;
    }
    const n = state.rows.length;
    const buy = state.rows.filter((r) => r.action === "buy").length;
    const sell = state.rows.filter((r) => r.action === "sell").length;
    const up = state.rows.filter((r) => r.changePct24h > 0).length;
    const avg = state.rows.reduce((s, r) => s + (Number(r.changePct24h) || 0), 0) / n;
    const regimes = {};
    for (const r of state.rows) regimes[r.regime] = (regimes[r.regime] || 0) + 1;
    const topRegime = Object.entries(regimes).sort((a, b) => b[1] - a[1])[0]?.[0];
    const best = state.rows.slice().sort((a, b) => b.score - a.score)[0];
    summary.innerHTML = `
      <div class="sc-sum"><span class="stat-label">Markten</span><span class="stat-value">${n}</span></div>
      <div class="sc-sum"><span class="stat-label">Koopsignalen</span><span class="stat-value pos">${buy}</span></div>
      <div class="sc-sum"><span class="stat-label">Verkoopsignalen</span><span class="stat-value neg">${sell}</span></div>
      <div class="sc-sum" title="Aantal markten dat vandaag gestegen is"><span class="stat-label">Stijgers / dalers</span>
        <span class="stat-value"><span class="pos">${up}</span> / <span class="neg">${n - up}</span></span>
        <span class="sc-breadth"><i style="width:${((up / n) * 100).toFixed(1)}%"></i></span></div>
      <div class="sc-sum"><span class="stat-label">Gem. 24u</span><span class="stat-value ${fmt.pnlClass(avg)}">${esc(fmt.pct(avg, 2))}</span></div>
      <div class="sc-sum"><span class="stat-label" title="Het regime dat het vaakst voorkomt">Hoofdregime</span><span class="stat-value sc-sum-reg" data-r="${esc(topRegime)}">${regimeIcon(topRegime)} ${esc(fmt.regime(topRegime))}</span></div>
      ${best ? `<div class="sc-sum"><span class="stat-label">Hoogste score</span><span class="stat-value">${esc(best.market)} <small class="mono ${fmt.pnlClass(best.score)}">${esc(signed2(best.score))}</small></span></div>` : ""}`;
  }

  function renderTable(rows) {
    const inBot = new Set(botMarkets());
    const head = COLUMNS.map((c) => {
      const sortable = !!c.get;
      const active = state.sortKey === c.key;
      const arrow = active ? (state.sortDir < 0 ? "▼" : "▲") : "";
      return `<th class="${c.r ? "r" : ""} ${sortable ? "sc-sortable" : ""} ${active ? "is-sorted" : ""}" ${sortable ? `data-sort="${c.key}" tabindex="0"` : ""}
        ${c.help ? `title="${esc(c.help)}"` : ""} aria-sort="${active ? (state.sortDir < 0 ? "descending" : "ascending") : "none"}">${esc(c.label)}<span class="sc-arrow">${arrow}</span></th>`;
    }).join("");
    const bodyRows = rows
      .map(
        (r) => `<tr class="sc-row" data-market="${esc(r.market)}" tabindex="0">
        <td><span class="sc-mkt">${esc(r.market.split("-")[0])}</span><span class="muted">-${esc(r.market.split("-")[1] || "EUR")}</span>${
          inBot.has(r.market) ? ' <span class="pn-chip pn-chip-acc" title="Deze markt wordt door de bot verhandeld">in bot</span>' : ""
        }</td>
        <td class="r mono">${esc(fmt.price(r.price))}</td>
        <td class="r mono ${fmt.pnlClass(r.changePct24h)}">${esc(fmt.pct(r.changePct24h, 2))}</td>
        <td class="r mono">${esc(Number.isFinite(r.volumeQuote24h) ? compactEur.format(r.volumeQuote24h) : "–")}</td>
        <td class="r mono">${esc(fmt.pct(r.volatilityPct, 2, false))}</td>
        <td class="r mono ${r.spreadPct > 0.2 ? "sc-warn" : ""}">${esc(r.spreadPct === null ? "–" : fmt.pct(r.spreadPct, 3, false))}</td>
        <td><span class="sc-reg" data-r="${esc(r.regime)}">${regimeIcon(r.regime)}${esc(fmt.regime(r.regime))}</span></td>
        <td><span class="sig-pill" data-a="${esc(r.action)}">${esc(fmt.action(r.action))}</span></td>
        <td>${scoreBar(r.score)}</td>
        <td>${rsiBar(r.rsi)}</td>
        <td>${sparkline(r.sparkline)}</td>
      </tr>`,
      )
      .join("");
    body.innerHTML = `<div class="sc-table-wrap"><table class="table sc-table"><thead><tr>${head}</tr></thead><tbody>${
      bodyRows || `<tr><td colspan="${COLUMNS.length}" class="pn-empty">Geen markten gevonden.</td></tr>`
    }</tbody></table></div>
    <p class="pn-hint sc-foot">Klik op een kolomkop om te sorteren. De score en het signaal zijn berekend op het interval van de bot (${esc(state.config?.interval || "–")}). Een koopsignaal hier betekent niet dat de bot koopt: alleen markten die in de bot staan worden verhandeld.${
      isAutoUniverse(state.config) ? " De bot kiest zijn munten nu automatisch (de meest verhandelde); het label \"in bot\" staat bij de munten die hij op dit moment volgt." : ""
    }</p>`;
  }

  function renderHeatmap(rows) {
    // body heeft 6px padding links/rechts, .sc-heat 4px marge
    const w = Math.floor(body.clientWidth - 12 - 8) || 1000;
    const h = Math.max(380, Math.min(620, Math.round(w * 0.46)));
    const items = rows
      .filter((r) => Number.isFinite(r.volumeQuote24h) && r.volumeQuote24h > 0)
      .map((r) => ({ ...r, value: Math.sqrt(r.volumeQuote24h) }))
      .sort((a, b) => b.value - a.value);
    if (!items.length) {
      body.innerHTML = '<div class="pn-empty">Geen markten om te tonen.</div>';
      return;
    }
    const rects = squarify(items, 0, 0, w, h);
    const inBot = new Set(botMarkets());
    const tiles = rects
      .map(({ it, x, y, w: tw, h: th }) => {
        const c = Number(it.changePct24h) || 0;
        const t = Math.max(-1, Math.min(1, c / 6));
        const pct = Math.round(10 + Math.abs(t) * 70);
        const bg = `color-mix(in srgb, var(${t >= 0 ? "--green" : "--red"}) ${pct}%, var(--panel-2))`;
        const size = tw * th > 16000 ? "lg" : tw * th > 5000 ? "md" : tw > 44 && th > 30 ? "sm" : "xs";
        return `<div class="sc-tile" data-size="${size}" data-market="${esc(it.market)}" tabindex="0"
          style="left:${x.toFixed(1)}px;top:${y.toFixed(1)}px;width:${Math.max(0, tw - 2).toFixed(1)}px;height:${Math.max(0, th - 2).toFixed(1)}px;background:${bg}">
          <div class="sc-tile-name">${esc(it.market.split("-")[0])}${inBot.has(it.market) ? '<span class="sc-tile-dot" title="in bot"></span>' : ""}</div>
          <div class="sc-tile-chg mono">${esc(fmt.pct(c, 2))}</div>
          <div class="sc-tile-px mono">${esc(fmt.price(it.price))}</div>
          <div class="sc-tile-sig"><span class="sig-pill" data-a="${esc(it.action)}">${esc(fmt.action(it.action))}</span></div>
        </div>`;
      })
      .join("");
    body.innerHTML = `<div class="sc-heat" style="height:${h}px">${tiles}</div>
      <div class="sc-heat-legend">
        <span class="mono">−6%</span><span class="sc-heat-grad"></span><span class="mono">+6%</span>
        <span class="muted">Kleur = koersverandering 24u · grootte ≈ handelsvolume (wortelschaal) · stip = in de bot</span>
      </div>`;
  }

  function render() {
    closePop();
    renderSummary();
    if (state.error && !state.rows.length) {
      body.innerHTML = `<div class="pn-banner pn-banner-bad"><b>Scanner laden mislukt.</b> ${esc(state.error)}</div>`;
      return;
    }
    if (!state.rows.length) {
      body.innerHTML = state.loading
        ? '<div class="pn-empty"><span class="spinner"></span> Markten scannen… (de eerste keer kan dit even duren)</div>'
        : '<div class="pn-empty">Nog geen gegevens.</div>';
      return;
    }
    const rows = sortedRows();
    if (state.view === "heatmap") renderHeatmap(rows);
    else renderTable(rows);
    body.classList.toggle("is-stale", state.loading);
  }

  function renderStatus() {
    if (state.loading) {
      statusEl.innerHTML = '<span class="spinner sc-spin"></span> laden…';
      return;
    }
    if (!state.loadedAt) {
      statusEl.textContent = "";
      return;
    }
    const left = Math.max(0, Math.ceil((REFRESH_MS - (Date.now() - state.loadedAt)) / 1000));
    statusEl.innerHTML = `bijgewerkt ${esc(fmt.time(state.loadedAt))}${
      isVisible() ? ` · <span title="Wordt elke minuut automatisch ververst zolang dit tabblad open staat">vernieuwt over ${left}s</span>` : " · gepauzeerd"
    }${state.error ? ` · <span class="neg" title="${esc(state.error)}">fout bij laatste poging</span>` : ""}`;
  }

  async function load() {
    if (state.loading) return;
    state.loading = true;
    renderStatus();
    if (!state.rows.length) render();
    else body.classList.add("is-stale");
    try {
      const rows = await api.getScanner(30);
      state.rows = Array.isArray(rows) ? rows : [];
      state.error = null;
      state.loadedAt = Date.now();
    } catch (err) {
      state.error = err?.message || String(err);
      state.loadedAt = Date.now();
      if (err?.status !== 429) ctx.toast(`Scanner: ${state.error}`, "error");
    } finally {
      state.loading = false;
      body.classList.remove("is-stale");
      render();
      renderStatus();
    }
  }

  // ── Popover met acties ──
  function closePop() {
    pop.hidden = true;
    pop.innerHTML = "";
    delete pop.dataset.market;
  }

  function popHint(plan, market) {
    const n = plan.count;
    if (plan.kind === "in-bot")
      return plan.auto
        ? "De bot volgt deze munt nu automatisch (hij hoort bij de meest verhandelde). Bekijk hem live in de grafiek."
        : "Deze markt wordt al verhandeld. Bekijk hem live in de grafiek.";
    if (plan.kind === "full")
      return plan.auto
        ? `De bot volgt al het maximum van ${MAX_MARKETS} munten. Er kan er geen meer bij.`
        : `De bot volgt al het maximum van ${MAX_MARKETS} munten. Verwijder er eerst één bij Instellingen.`;
    if (plan.kind === "switch") {
      const want = Number(state.config?.universe?.count);
      return `De bot kiest zijn munten nu <b>automatisch</b>: elk uur de ${
        Number.isFinite(want) ? esc(String(want)) : ""
      } munten met de meeste handel. ${esc(market)} hoort daar nu niet bij. Wil je hem er toch bij? Schakel dan over naar <b>Zelf kiezen</b>: de bot houdt de ${n} munten die hij nu volgt en krijgt ${esc(market)} erbij.`;
    }
    return `Na toevoegen gaat de bot deze munt ook verhandelen (${n}/${MAX_MARKETS} munten). De live grafiek is beschikbaar zodra de munt in de bot zit.`;
  }

  function openPop(market, anchor) {
    const r = state.rows.find((x) => x.market === market);
    if (!r) return;
    const plan = addPlan(market, { snapshot: state.snapshot || ctx.getState?.(), config: state.config });
    const inBot = plan.kind === "in-bot";
    const addBtn =
      plan.kind === "switch"
        ? `<button type="button" class="btn btn-primary" data-act="switch" title="Schakelt over naar Zelf kiezen (je krijgt eerst een bevestiging)">+ Toevoegen…</button>`
        : `<button type="button" class="btn btn-primary" data-act="add" ${plan.kind === "add" ? "" : "disabled"}>
          ${inBot ? "✓ Zit al in de bot" : "+ Toevoegen aan bot"}</button>`;
    pop.dataset.market = market;
    pop.innerHTML = `
      <div class="sc-pop-head">
        <div><b>${esc(market)}</b> <span class="sig-pill" data-a="${esc(r.action)}">${esc(fmt.action(r.action))}</span></div>
        <button type="button" class="btn btn-ghost sc-pop-x" aria-label="Sluiten">✕</button>
      </div>
      <div class="sc-pop-stats">
        <span>Prijs <b class="mono">${esc(fmt.price(r.price))}</b></span>
        <span>24u <b class="mono ${fmt.pnlClass(r.changePct24h)}">${esc(fmt.pct(r.changePct24h, 2))}</b></span>
        <span>Score <b class="mono">${esc(signed2(r.score))}</b></span>
        <span>Regime <b>${esc(fmt.regime(r.regime))}</b></span>
      </div>
      <div class="sc-pop-spark">${sparkline(r.sparkline, 260, 54)}</div>
      <div class="sc-pop-actions">
        ${addBtn}
        <button type="button" class="btn" data-act="chart" ${inBot ? "" : "disabled"}>Bekijk grafiek</button>
      </div>
      <p class="pn-hint ${plan.kind === "switch" ? "sc-pop-auto" : ""}">${popHint(plan, market)}</p>`;
    pop.hidden = false;
    const host = el.getBoundingClientRect();
    const a = anchor.getBoundingClientRect();
    const pw = pop.offsetWidth || 320;
    let left = a.left - host.left + Math.min(a.width / 2, 220) - 40;
    left = Math.max(8, Math.min(left, el.clientWidth - pw - 8));
    let top = a.bottom - host.top + 6;
    const ph = pop.offsetHeight || 220;
    if (a.bottom + ph + 12 > window.innerHeight && a.top - host.top - ph - 6 > 0) top = a.top - host.top - ph - 6;
    pop.style.left = `${left}px`;
    pop.style.top = `${top}px`;
    pop.querySelector("[data-act]:not([disabled])")?.focus();
  }

  async function freshConfig() {
    try {
      const cfg = await api.getConfig();
      if (cfg) state.config = cfg;
    } catch {
      /* val terug op bekende config */
    }
    return state.config;
  }

  async function addMarket(market) {
    const cfg = await freshConfig();
    const plan = addPlan(market, { snapshot: state.snapshot || ctx.getState?.(), config: cfg });
    if (plan.kind === "in-bot") return ctx.toast(`${market} zit al in de bot.`, "info");
    if (plan.kind === "full") return ctx.toast(`Maximaal ${MAX_MARKETS} munten. Verwijder er eerst één bij Instellingen.`, "warn");
    // Intussen (elders) op Automatisch gezet: eerst uitleggen en bevestigen
    if (plan.kind === "switch") return confirmSwitch(market);
    try {
      const next = await api.putConfig(planPatch(plan));
      state.config = next;
      bus.emit("config-changed", next);
      ctx.toast(`${market} toegevoegd aan de bot.`, "success");
      render();
    } catch (err) {
      ctx.toast(`Toevoegen mislukt: ${err?.message || err}`, "error");
    }
  }

  /**
   * Automatische muntkeuze: overschakelen naar "Zelf kiezen" met de munten die de
   * bot nu volgt plus deze, na bevestiging.
   */
  async function confirmSwitch(market) {
    const cfg = await freshConfig();
    const snap = () => state.snapshot || ctx.getState?.();
    const plan = addPlan(market, { snapshot: snap(), config: cfg });
    if (plan.kind !== "switch") {
      if (plan.kind === "add") return addMarket(market);
      if (plan.kind === "in-bot") return ctx.toast(`${market} zit al in de bot.`, "info");
      return ctx.toast(`Maximaal ${MAX_MARKETS} munten.`, "warn");
    }
    const names = plan.markets.slice(0, -1).map((m) => m.split("-")[0]);
    const shown = names.slice(0, 12).join(", ") + (names.length > 12 ? ` en nog ${names.length - 12}` : "");
    ctx.openModal({
      title: "Zelf munten kiezen?",
      confirmText: `Overschakelen en ${market} toevoegen`,
      cancelText: "Annuleren",
      bodyHtml: `<p>De bot kiest zijn munten nu <strong>automatisch</strong> (de munten met de meeste handel). Om ${esc(market)} toe te voegen,
          schakel je over naar <strong>Zelf kiezen</strong>.</p>
        <ul>
          <li>De bot houdt de <strong>${plan.count}</strong> munten die hij nu volgt${shown ? ` (${esc(shown)})` : ""} en krijgt <strong>${esc(market)}</strong> erbij.</li>
          <li>Daarna kiest hij niet meer elk uur zelf: jij bepaalt de lijst.</li>
          <li>Terug naar automatisch kan altijd bij <strong>Instellingen → Munten</strong>.</li>
        </ul>`,
      onConfirm: async () => {
        // Op het moment van bevestigen opnieuw bepalen (de automatische keuze kan intussen veranderd zijn)
        const now = addPlan(market, { snapshot: snap(), config: state.config });
        const patch = planPatch(now);
        if (!patch) {
          ctx.toast(now.kind === "in-bot" ? `${market} zit al in de bot.` : `Maximaal ${MAX_MARKETS} munten.`, "info");
          return true;
        }
        try {
          const next = await api.putConfig(patch);
          state.config = next;
          bus.emit("config-changed", next);
          ctx.toast(`Je kiest nu zelf de munten: ${now.markets.length} munten, met ${market} erbij.`, "success");
          render();
        } catch (err) {
          ctx.toast(`Overschakelen mislukt: ${err?.message || err}`, "error");
          return false;
        }
        return true;
      },
    });
  }

  function viewChart(market) {
    if (!botMarkets().includes(market)) {
      ctx.toast("Voeg de markt eerst toe aan de bot om hem live te volgen.", "info");
      return;
    }
    bus.emit("market-selected", { market });
    const btn = document.querySelector('[data-tab="live"]');
    if (btn) btn.click();
    else location.hash = "#live";
  }

  // ── Events ──
  el.addEventListener("click", (e) => {
    const sortTh = e.target.closest("th[data-sort]");
    if (sortTh) {
      const k = sortTh.dataset.sort;
      if (state.sortKey === k) state.sortDir *= -1;
      else {
        state.sortKey = k;
        state.sortDir = COLUMNS.find((c) => c.key === k)?.str ? 1 : -1;
      }
      render();
      return;
    }
    const act = e.target.closest(".sc-pop [data-act]");
    if (act) {
      const m = pop.dataset.market;
      closePop();
      if (act.dataset.act === "add") addMarket(m);
      else if (act.dataset.act === "switch") confirmSwitch(m);
      else viewChart(m);
      return;
    }
    if (e.target.closest(".sc-pop-x")) return closePop();
    if (e.target.closest(".sc-pop")) return;
    const row = e.target.closest("[data-market]");
    if (row && !row.classList.contains("sc-pop")) {
      if (pop.dataset.market === row.dataset.market && !pop.hidden) closePop();
      else openPop(row.dataset.market, row);
      return;
    }
    closePop();
  });
  el.addEventListener("keydown", (e) => {
    if (e.key === "Escape") return closePop();
    if (e.key !== "Enter" && e.key !== " ") return;
    const th = e.target.closest("th[data-sort]");
    const row = e.target.closest(".sc-row, .sc-tile");
    if (th || row) {
      e.preventDefault();
      e.target.click();
    }
  });
  document.addEventListener("click", (e) => {
    if (!pop.hidden && !el.contains(e.target)) closePop();
  });
  el.addEventListener("mousemove", (e) => {
    const tile = e.target.closest(".sc-tile");
    const t = tipEl();
    if (!tile) {
      if (t.dataset.owner === "sc") t.style.display = "none";
      return;
    }
    const r = state.rows.find((x) => x.market === tile.dataset.market);
    if (!r) return;
    t.dataset.owner = "sc";
    t.innerHTML = `<b>${esc(r.market)}</b><br>Prijs ${esc(fmt.price(r.price))} · 24u <b>${esc(fmt.pct(r.changePct24h, 2))}</b><br>
      Volume ${esc(compactEur.format(r.volumeQuote24h))} · ${esc(fmt.regime(r.regime))}<br>Signaal ${esc(fmt.action(r.action))} (score ${esc(fmt.num(r.score, 2))})`;
    t.style.display = "block";
    const rr = t.getBoundingClientRect();
    let x = e.clientX + 14;
    let y = e.clientY + 14;
    if (x + rr.width > window.innerWidth - 8) x = e.clientX - rr.width - 14;
    if (y + rr.height > window.innerHeight - 8) y = e.clientY - rr.height - 14;
    t.style.left = `${x}px`;
    t.style.top = `${y}px`;
  });
  el.addEventListener("mouseleave", () => {
    const t = tipEl();
    if (t.dataset.owner === "sc") t.style.display = "none";
  });
  $(".sc-search").addEventListener("input", (e) => {
    state.filter = e.target.value;
    render();
  });
  $(".sc-refresh").addEventListener("click", () => load());
  for (const b of el.querySelectorAll(".pn-seg [data-view]")) b.addEventListener("click", () => setView(b.dataset.view));

  let lastWidth = 0;
  new ResizeObserver(() => {
    const w = body.clientWidth;
    if (state.view === "heatmap" && w > 0 && Math.abs(w - lastWidth) > 4 && state.rows.length) render();
    lastWidth = w;
  }).observe(body);

  bus.on("tab-changed", (d) => {
    state.activeTab = d?.tab || null;
    if (isVisible() && (!state.loadedAt || Date.now() - state.loadedAt >= REFRESH_MS)) load();
    renderStatus();
  });
  bus.on("config-changed", (c) => {
    if (c) state.config = c;
    if (state.rows.length && isVisible()) render();
  });
  bus.on("snapshot", (s) => {
    if (s && typeof s === "object") state.snapshot = s;
    if (s?.config) state.config = s.config;
  });
  document.addEventListener("visibilitychange", () => {
    if (isVisible() && state.loadedAt && Date.now() - state.loadedAt >= REFRESH_MS) load();
  });

  setInterval(() => {
    if (!isVisible()) return;
    if (!state.loadedAt || Date.now() - state.loadedAt >= REFRESH_MS) load();
    else renderStatus();
  }, 1000);

  setView(state.view);
  // Initieel alleen laden als het tabblad zichtbaar is (lazy); anders bij "tab-changed"
  requestAnimationFrame(() => {
    if (isVisible() || location.hash === "#scanner") load();
  });
}
