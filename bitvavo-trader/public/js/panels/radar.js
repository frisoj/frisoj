// Paneel "Munten-radar" (live tab): één compacte tegel per munt die de bot volgt
// (tot 400), met prijs, 24u-verandering, een scorebalk (links = verkopen, rechts =
// kopen) en de status (positie, #1 koopkans, tegengehouden, wacht). Bovenaan een
// samenvatting, het marktfilter (Bitcoin-trend) en de voortgang van de ronde.
//
// Snel met 400 tegels: hooguit één keer per seconde tekenen (snapshots komen elke
// ~15 s, prijzen vaker), tegels blijven bestaan (per markt) en alleen wat veranderd
// is wordt bijgewerkt; niets tekenen zolang de Live-tab niet zichtbaar is.

import {
  RADAR_FILTERS,
  RADAR_SORTS,
  radarData,
  radarCounts,
  snapshotSummary,
  marketFilterBadge,
  roundView,
  visibleRows,
  statusView,
  scoreBar,
  scoreColor,
  scoreText,
  rowTitle,
  rowNote,
  rowPrice,
  rowSig,
  baseOf,
  volumeText,
  coinTrendText,
  STATUS_INFO,
} from "./radarLogic.js";
import { isPlainUniverseNote } from "./settingsLogic.js";
import { botMarkets } from "../format.js";

const LS_COLLAPSED = "bvt-radar-collapsed";
const LS_SORT = "bvt-radar-sort";
/** Minimale tijd tussen twee keer tekenen door nieuwe data (ms) */
export const RENDER_THROTTLE_MS = 1000;

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
    /* privémodus e.d.: dan onthouden we het niet */
  }
}

function ensureCss() {
  try {
    if (document.querySelector('link[href$="radar.css"]')) return;
    const l = document.createElement("link");
    l.rel = "stylesheet";
    l.href = new URL("../../css/radar.css", import.meta.url).href;
    document.head.append(l);
  } catch {
    /* zonder stijl werkt het paneel nog steeds */
  }
}

const CHEVRON =
  '<svg class="rd-chev" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m6 9 6 6 6-6"/></svg>';

export function mountRadar(ctx, el) {
  if (!el) return;
  ensureCss();
  const { bus, esc, fmt } = ctx;

  const savedSort = lsGet(LS_SORT);
  const state = {
    filter: "all",
    sort: RADAR_SORTS.some((s) => s.key === savedSort) ? savedSort : "chance",
    query: "",
    collapsed: lsGet(LS_COLLAPSED) === "1",
    mfOpen: false,
    selected: (ctx.getSelectedMarket && ctx.getSelectedMarket()) || null,
  };
  /** market → { el, parts…, sig } — tegels blijven bestaan, ook als ze even verborgen zijn */
  const tiles = new Map();
  /** beslissingen via SSE (alleen nodig voor de eenvoudige weergave zonder snapshot.radar) */
  const liveDecisions = {};
  let shown = [];
  let orderKey = "";
  let selTile = null;
  let rowByMarket = new Map();
  let fallbackMode = false;
  let lastRenderAt = 0;
  let timer = null;
  let dirty = false;
  let detailSig = "";

  el.classList.add("rd");
  el.innerHTML = `
    <div class="panel-title rd-title">
      <button type="button" class="rd-toggle" data-rd="toggle" aria-controls="rd-body">
        ${CHEVRON}<span>Munten-radar</span>
      </button>
      <span class="count" data-rd="count" title="Aantal munten dat de bot volgt">–</span>
      <span class="panel-actions rd-round" data-rd="round" hidden>
        <span class="rd-round-txt" data-rd="roundtxt"></span>
        <span class="rd-round-bar" aria-hidden="true"><i data-rd="roundbar"></i></span>
      </span>
    </div>
    <div class="rd-info">
      <span class="rd-summary" data-rd="summary">Munten laden…</span>
      <button type="button" class="rd-mf" data-rd="mf" hidden aria-expanded="false" aria-controls="rd-mf-note"></button>
    </div>
    <div class="rd-mf-note" id="rd-mf-note" data-rd="mfnote" hidden></div>
    <div class="rd-note" data-rd="note" hidden></div>
    <div class="rd-body" id="rd-body" data-rd="body">
      <div class="rd-tools">
        <div class="rd-chips" data-rd="chips" role="group" aria-label="Welke munten tonen">
          ${RADAR_FILTERS.map(
            (f) =>
              `<button type="button" class="chip" data-f="${f.key}" aria-pressed="${f.key === state.filter}" title="${esc(f.tip)}">${esc(
                f.label,
              )} <span class="rd-n" data-n="${f.key}">0</span></button>`,
          ).join("")}
        </div>
        <div class="rd-tools-right">
          <input type="search" class="input rd-search" data-rd="search" placeholder="Zoek munt…" aria-label="Zoek een munt" autocomplete="off" spellcheck="false" enterkeyhint="search" />
          <label class="rd-sort"><span class="muted">Sorteer</span>
            <select class="select" data-rd="sort" aria-label="Sorteer de munten op">
              ${RADAR_SORTS.map((s) => `<option value="${s.key}"${s.key === state.sort ? " selected" : ""}>${esc(s.label)}</option>`).join("")}
            </select>
          </label>
        </div>
      </div>
      <div class="rd-scroll" data-rd="scroll">
        <div class="rd-detail" data-rd="detail" hidden aria-live="polite"></div>
        <div class="rd-grid" data-rd="grid" aria-label="Munten"></div>
        <div class="rd-empty" data-rd="empty" hidden></div>
      </div>
      <div class="rd-legend muted">
        <span class="rd-legend-bar" aria-hidden="true"><i class="s"></i><i class="b"></i></span>
        <span>Balkje = mening van de bot: naar links verkopen, naar rechts kopen. Tik op een munt voor de grafiek en uitleg.</span>
      </div>
    </div>`;

  const $ = (sel) => el.querySelector(sel);
  const q = {
    toggle: $('[data-rd="toggle"]'),
    count: $('[data-rd="count"]'),
    round: $('[data-rd="round"]'),
    roundTxt: $('[data-rd="roundtxt"]'),
    roundBar: $('[data-rd="roundbar"]'),
    summary: $('[data-rd="summary"]'),
    mf: $('[data-rd="mf"]'),
    mfNote: $('[data-rd="mfnote"]'),
    note: $('[data-rd="note"]'),
    body: $('[data-rd="body"]'),
    chips: $('[data-rd="chips"]'),
    search: $('[data-rd="search"]'),
    sort: $('[data-rd="sort"]'),
    detail: $('[data-rd="detail"]'),
    grid: $('[data-rd="grid"]'),
    empty: $('[data-rd="empty"]'),
    n: Object.fromEntries(RADAR_FILTERS.map((f) => [f.key, $(`[data-n="${f.key}"]`)])),
    chip: Object.fromEntries(RADAR_FILTERS.map((f) => [f.key, $(`[data-f="${f.key}"]`)])),
  };
  if (q.sort) q.sort.value = state.sort;

  /** Alleen schrijven als het anders is (geen onnodige herberekening van de lay-out) */
  const setText = (node, text) => {
    if (node && node.textContent !== text) node.textContent = text;
  };
  const setHidden = (node, hidden) => {
    if (node && node.hidden !== hidden) node.hidden = hidden;
  };

  // ───────────── Tegels ─────────────

  const mk = (tag, cls) => {
    const n = document.createElement(tag);
    if (cls) n.className = cls;
    return n;
  };

  function createTile(market) {
    const tileEl = mk("button", "rd-tile");
    tileEl.type = "button";
    tileEl.dataset.market = market;
    const top = mk("span", "rd-t-row");
    const sym = mk("span", "rd-sym");
    sym.textContent = baseOf(market);
    const chg = mk("span", "rd-chg flat");
    top.append(sym, chg);
    const mid = mk("span", "rd-t-row");
    const price = mk("span", "rd-price");
    const score = mk("span", "rd-score");
    mid.append(price, score);
    const bar = mk("span", "rd-bar");
    const fill = mk("i", "");
    bar.append(fill);
    const st = mk("span", "rd-st");
    const stIco = mk("span", "rd-st-ico");
    const stTxt = mk("span", "rd-st-txt");
    st.append(stIco, stTxt);
    tileEl.append(top, mid, bar, st);
    return { el: tileEl, chg, price, score, fill, stIco, stTxt, sig: "", shownPrice: undefined };
  }

  /** Alleen de prijs (verandert bij bijna elke snapshot) */
  function updateTilePrice(t, price) {
    if (t.shownPrice === price) return;
    t.shownPrice = price;
    t.price.textContent = fmt.price(price);
  }

  /** Alles behalve de prijs (status, 24u, score, uitleg) */
  function updateTile(t, row) {
    const sv = statusView(row);
    t.el.dataset.status = sv.status;
    const c = isNum(row.changePct24h) ? row.changePct24h : null;
    t.chg.textContent = c === null ? "" : fmt.pct(c, 1);
    t.chg.className = `rd-chg ${fmt.pnlClass(c)}`;
    const b = scoreBar(row.score);
    t.fill.style.left = `${b.left.toFixed(1)}%`;
    t.fill.style.width = `${b.width.toFixed(1)}%`;
    t.fill.style.background = scoreColor(row.score);
    t.score.textContent = scoreText(row.score);
    t.stIco.textContent = sv.icon;
    t.stTxt.textContent = sv.text;
    t.el.title = rowTitle(row);
    // ⓘ-markering alleen bij een uitleg van de engine (niet bij de standaardtekst per status)
    t.el.dataset.note = typeof row.note === "string" && row.note.trim() ? "1" : "";
  }

  function applySelected() {
    const t = state.selected ? tiles.get(state.selected) : null;
    const next = t ? t.el : null;
    if (next === selTile) return;
    if (selTile) {
      selTile.classList.remove("sel");
      selTile.setAttribute("aria-pressed", "false");
    }
    if (next) {
      next.classList.add("sel");
      next.setAttribute("aria-pressed", "true");
    }
    selTile = next;
  }

  function renderTiles(snap, rows) {
    const prices = snap && snap.prices ? snap.prices : null;
    const list = visibleRows(rows, state);
    const present = new Set(rows.map((r) => r.market));
    for (const [m, t] of tiles) {
      if (present.has(m)) continue;
      t.el.remove();
      tiles.delete(m);
      if (selTile === t.el) selTile = null;
    }
    const els = new Array(list.length);
    for (let i = 0; i < list.length; i++) {
      const row = list[i];
      let t = tiles.get(row.market);
      if (!t) {
        t = createTile(row.market);
        tiles.set(row.market, t);
      }
      updateTilePrice(t, rowPrice(row, prices));
      const sig = rowSig(row, null);
      if (sig !== t.sig) {
        t.sig = sig;
        updateTile(t, row);
      }
      els[i] = t.el;
    }
    // Volgorde/zichtbaarheid alleen aanpassen als die veranderd is
    const key = list.map((r) => r.market).join(",");
    if (key !== orderKey) {
      const keep = new Set(els);
      for (const e of shown) if (!keep.has(e)) e.remove();
      if (els.length) q.grid.append(...els);
      shown = els;
      orderKey = key;
    }
    applySelected();

    let empty = "";
    if (!rows.length) {
      empty = snap
        ? "Nog geen munten om te tonen. Start de bot, of kies munten bij Instellingen."
        : "Munten laden…";
    } else if (!list.length) {
      empty = state.query.trim()
        ? `Geen munt gevonden voor “${state.query.trim()}”${state.filter !== "all" ? " met dit filter" : ""}.`
        : "Geen munten met dit filter.";
    }
    setText(q.empty, empty);
    setHidden(q.empty, !empty);
  }

  // ───────────── Kop: samenvatting, marktfilter, ronde, meldingen ─────────────

  function renderHead(snap, rows, fallback) {
    const counts = radarCounts(rows);
    const active = botMarkets(snap);
    setText(q.count, snap ? String(active.length || rows.length) : "–");
    setText(q.summary, snap ? snapshotSummary(snap, rows) : "Munten laden…");

    const badge = marketFilterBadge(snap ? snap.marketFilter : undefined);
    setHidden(q.mf, !badge);
    if (badge) {
      q.mf.dataset.kind = badge.kind;
      setText(q.mf, `${badge.icon} ${badge.text}`);
      q.mf.title = `${badge.note} (tik voor uitleg)`;
      setText(q.mfNote, badge.note);
    }
    setHidden(q.mfNote, !(badge && state.mfOpen));
    if (q.mf) q.mf.setAttribute("aria-expanded", badge && state.mfOpen ? "true" : "false");

    const rv = roundView(snap ? snap.scan : null, snap ? !!snap.running : true);
    setHidden(q.round, !rv);
    if (rv) {
      setText(q.roundTxt, rv.text);
      q.round.dataset.busy = rv.busy ? "1" : "";
      if (q.roundBar) q.roundBar.style.width = `${rv.pct === null ? 0 : Math.max(0, Math.min(100, rv.pct)).toFixed(1)}%`;
    }

    const notes = [];
    const uNote = snap && snap.universe && typeof snap.universe.note === "string" ? snap.universe.note.trim() : "";
    if (uNote) notes.push(uNote);
    if (fallback && rows.length) {
      notes.push(
        "Eenvoudige weergave: deze versie van de bot stuurt nog geen radargegevens. Je ziet de munten met hun laatste signaal (zonder 24u-cijfers).",
      );
    }
    setText(q.note, notes.join(" "));
    setHidden(q.note, !notes.length);
    // "Nog geen automatische keuze…" is gewone status; een mislukte keuze e.d. een waarschuwing
    q.note.dataset.kind = uNote && !isPlainUniverseNote(uNote) ? "warn" : "info";

    for (const f of RADAR_FILTERS) {
      setText(q.n[f.key], String(counts[f.key] || 0));
      if (q.chip[f.key]) q.chip[f.key].setAttribute("aria-pressed", String(state.filter === f.key));
    }
  }

  function renderDetail(snap) {
    const row = state.selected ? rowByMarket.get(state.selected) : null;
    if (!row) {
      detailSig = "";
      setHidden(q.detail, true);
      return;
    }
    const price = rowPrice(row, snap && snap.prices);
    const sig = rowSig(row, price);
    if (sig === detailSig && !q.detail.hidden) return;
    detailSig = sig;
    const sv = statusView(row);
    const label = sv.rank !== null ? `${STATUS_INFO[sv.status].label} #${sv.rank}` : STATUS_INFO[sv.status].label;
    const facts = [
      `prijs <b class="mono">${esc(fmt.price(price))}</b>`,
      `score <b class="mono">${esc(scoreText(row.score))}</b>`,
    ];
    if (isNum(row.changePct24h)) facts.push(`24u <b class="mono ${fmt.pnlClass(row.changePct24h)}">${esc(fmt.pct(row.changePct24h))}</b>`);
    if (isNum(row.volumeQuote24h)) facts.push(`volume <b class="mono">${esc(volumeText(row.volumeQuote24h))}</b>`);
    if (isNum(row.spreadPct)) facts.push(`spread <b class="mono">${esc(fmt.pct(row.spreadPct, 2, false))}</b>`);
    if (row.regime) facts.push(`<b>${esc(fmt.regime(row.regime))}</b>`);
    const trend = coinTrendText(row);
    if (trend) facts.push(`<b class="${row.trendOk ? "pos" : "neg"}">${esc(trend)}</b>`);
    const note = rowNote(row);
    q.detail.dataset.status = sv.status;
    q.detail.innerHTML = `
      <div class="rd-d-main">
        <b class="rd-d-mkt">${esc(row.market)}</b>
        <span class="rd-d-st" data-status="${esc(sv.status)}">${esc(STATUS_INFO[sv.status].icon)} ${esc(label)}</span>
        <span class="rd-d-facts">${facts.join('<span class="rd-dot">·</span>')}</span>
        <button type="button" class="btn btn-sm btn-ghost rd-d-chart" data-rd-act="chart" title="Naar de grafiek van ${esc(row.market)}">Grafiek ↑</button>
      </div>
      ${note ? `<div class="rd-d-note">${esc(note)}</div>` : ""}`;
    setHidden(q.detail, false);
  }

  // ───────────── Tekenen (gedrosseld) ─────────────

  function isShown() {
    const tab = ctx.getActiveTab ? ctx.getActiveTab() : null;
    if (tab && tab !== "live") return false;
    return !(typeof document !== "undefined" && document.hidden);
  }

  function render() {
    if (!isShown()) {
      dirty = true;
      return;
    }
    dirty = false;
    lastRenderAt = Date.now();
    const snap = ctx.getState ? ctx.getState() : null;
    const { rows, fallback } = radarData(snap, liveDecisions);
    fallbackMode = fallback;
    rowByMarket = new Map(rows.map((r) => [r.market, r]));
    renderHead(snap, rows, fallback);
    if (state.collapsed) {
      dirty = true; // tegels bijwerken zodra het paneel weer opengaat
      return;
    }
    renderTiles(snap, rows);
    renderDetail(snap);
  }

  /** Nieuwe data: hooguit één keer per RENDER_THROTTLE_MS tekenen */
  function schedule() {
    if (timer) return;
    const wait = Math.max(0, lastRenderAt + RENDER_THROTTLE_MS - Date.now());
    timer = setTimeout(() => {
      timer = null;
      render();
    }, wait);
  }

  /** Actie van de gebruiker: meteen tekenen */
  function renderNow() {
    if (timer) {
      clearTimeout(timer);
      timer = null;
    }
    render();
  }

  function applyCollapsed() {
    el.classList.toggle("is-collapsed", state.collapsed);
    setHidden(q.body, state.collapsed);
    if (q.toggle) {
      q.toggle.setAttribute("aria-expanded", String(!state.collapsed));
      q.toggle.title = state.collapsed ? "Radar uitklappen" : "Radar inklappen";
    }
  }

  // ───────────── Interactie ─────────────

  function selectMarket(market) {
    if (!market) return;
    state.selected = market;
    applySelected();
    renderDetail(ctx.getState ? ctx.getState() : null);
    if (typeof ctx.selectMarket === "function") ctx.selectMarket(market);
    else bus.emit("market-selected", { market });
  }

  q.toggle &&
    q.toggle.addEventListener("click", () => {
      state.collapsed = !state.collapsed;
      lsSet(LS_COLLAPSED, state.collapsed ? "1" : "0");
      applyCollapsed();
      if (!state.collapsed) renderNow();
    });

  q.mf &&
    q.mf.addEventListener("click", () => {
      state.mfOpen = !state.mfOpen;
      setHidden(q.mfNote, !state.mfOpen);
      q.mf.setAttribute("aria-expanded", String(state.mfOpen));
    });

  q.chips &&
    q.chips.addEventListener("click", (e) => {
      const b = e.target && e.target.closest ? e.target.closest("[data-f]") : null;
      if (!b || !b.dataset.f || b.dataset.f === state.filter) return;
      state.filter = b.dataset.f;
      renderNow();
    });

  q.search &&
    q.search.addEventListener("input", () => {
      state.query = String(q.search.value || "");
      renderNow();
    });
  q.search &&
    q.search.addEventListener("keydown", (e) => {
      if (e.key === "Escape" && q.search.value) {
        q.search.value = "";
        state.query = "";
        renderNow();
      } else if (e.key === "Enter") {
        // Enter in het zoekveld: kies de bovenste munt
        const first = shown[0];
        if (first && first.dataset.market) selectMarket(first.dataset.market);
      }
    });

  q.sort &&
    q.sort.addEventListener("change", () => {
      const v = q.sort.value;
      if (!RADAR_SORTS.some((s) => s.key === v)) return;
      state.sort = v;
      lsSet(LS_SORT, v);
      renderNow();
    });

  q.grid &&
    q.grid.addEventListener("click", (e) => {
      const t = e.target && e.target.closest ? e.target.closest("[data-market]") : null;
      if (t && t.dataset.market) selectMarket(t.dataset.market);
    });

  q.detail &&
    q.detail.addEventListener("click", (e) => {
      const b = e.target && e.target.closest ? e.target.closest("[data-rd-act]") : null;
      if (!b) return;
      const chart = typeof document.getElementById === "function" ? document.getElementById("chart-main") : null;
      if (chart && chart.scrollIntoView) chart.scrollIntoView({ behavior: "smooth", block: "center" });
    });

  // ───────────── Events ─────────────

  bus.on("snapshot", schedule);
  bus.on("price", schedule);
  bus.on("config-changed", schedule);
  bus.on("decision", (d) => {
    if (!d || typeof d.market !== "string") return;
    const prev = liveDecisions[d.market];
    if (!prev || !(prev.time > d.time)) liveDecisions[d.market] = d;
    if (fallbackMode) schedule();
  });
  bus.on("market-selected", (d) => {
    const m = d && d.market;
    if (!m || m === state.selected) return;
    state.selected = m;
    applySelected();
    if (isShown() && !state.collapsed) renderDetail(ctx.getState ? ctx.getState() : null);
  });
  bus.on("tab-changed", (d) => {
    if (d && d.tab === "live" && dirty) schedule();
  });
  try {
    document.addEventListener("visibilitychange", () => {
      if (!document.hidden && dirty) schedule();
    });
  } catch {
    /* geen document-events (tests) */
  }

  applyCollapsed();
  render();
}
