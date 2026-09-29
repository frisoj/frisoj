// Dashboard-shell (A9): bus + ctx, SSE, tab-routing, marktselectie, toasts,
// modals en het mounten van alle panelen. A10-panelen worden DYNAMISCH
// geïmporteerd zodat een ontbrekend/kapot paneel nooit de pagina breekt.

import { api, connectEvents, setToken, ApiError } from "./api.js";
import { fmt, esc } from "./format.js";
import { createBus } from "./bus.js";
import { mountHeader } from "./header.js";
import { mountLiveChart } from "./liveChart.js";
import { mountTables } from "./tables.js";
import { mountLog } from "./log.js";

const TABS = ["live", "backtest", "scanner", "settings"];
const TAB_TITLES = { live: "Live", backtest: "Backtest-lab", scanner: "Scanner", settings: "Instellingen" };
const MARKET_KEY = "bvt-selected-market";

const $ = (id) => document.getElementById(id);

const store = {
  get(key) {
    try {
      return localStorage.getItem(key);
    } catch {
      return null;
    }
  },
  set(key, value) {
    try {
      localStorage.setItem(key, value);
    } catch {
      /* private mode e.d. */
    }
  },
};

// ─────────────────────────────── Thema ───────────────────────────────

function readTheme() {
  const cs = getComputedStyle(document.documentElement);
  const v = (name, fallback) => cs.getPropertyValue(name).trim() || fallback;
  return {
    bg: v("--bg", "#0a0d13"),
    panel: v("--panel", "#10151f"),
    panel2: v("--panel-2", "#161d2a"),
    border: v("--border", "#222b3c"),
    text: v("--text", "#e3e8f2"),
    muted: v("--muted", "#7e889d"),
    green: v("--green", "#1ec580"),
    greenBg: v("--green-bg", "rgba(30,197,128,0.12)"),
    red: v("--red", "#f2495c"),
    redBg: v("--red-bg", "rgba(242,73,92,0.12)"),
    accent: v("--accent", "#4f86ff"),
    yellow: v("--yellow", "#f4b63a"),
    grid: v("--grid", "#161d29"),
    font: v("--font", "system-ui, sans-serif"),
    fontMono: v("--font-mono", "ui-monospace, monospace"),
  };
}

// ─────────────────────────────── Iconen ───────────────────────────────

const svg = (p) =>
  `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${p}</svg>`;
const ICONS = {
  info: svg('<circle cx="12" cy="12" r="9"/><path d="M12 11v5M12 8h.01"/>'),
  success: svg('<circle cx="12" cy="12" r="9"/><path d="m8 12.5 2.8 2.8L16.5 9.5"/>'),
  warn: svg('<path d="M10.3 3.9 2.4 18a2 2 0 0 0 1.7 3h15.8a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z"/><path d="M12 9v4M12 17h.01"/>'),
  error: svg('<circle cx="12" cy="12" r="9"/><path d="m15 9-6 6M9 9l6 6"/>'),
};

// ─────────────────────────────── Toasts ───────────────────────────────

const MAX_TOASTS = 5;

function toast(message, kind = "info") {
  const root = $("toast-root");
  if (!root) return () => {};
  if (!ICONS[kind]) kind = "info";
  const el = document.createElement("div");
  el.className = `toast toast-${kind}`;
  el.setAttribute("role", kind === "error" ? "alert" : "status");
  el.innerHTML = `<span class="toast-icon">${ICONS[kind]}</span><div class="toast-msg">${esc(message)}</div><button class="toast-close" type="button" aria-label="Sluiten">×</button>`;
  root.appendChild(el);
  while (root.children.length > MAX_TOASTS) root.firstElementChild.remove();

  let timer = null;
  let gone = false;
  const dismiss = () => {
    if (gone) return;
    gone = true;
    clearTimeout(timer);
    el.classList.add("leaving");
    setTimeout(() => el.remove(), 230);
  };
  const ttl = kind === "error" ? 9000 : kind === "warn" ? 6500 : 4500;
  const arm = () => {
    clearTimeout(timer);
    timer = setTimeout(dismiss, ttl);
  };
  el.addEventListener("mouseenter", () => clearTimeout(timer));
  el.addEventListener("mouseleave", arm);
  el.querySelector(".toast-close").addEventListener("click", dismiss);
  arm();
  return dismiss;
}

// ─────────────────────────────── Modal ───────────────────────────────

/**
 * Opent een bevestigingsvenster.
 * @param {object} o
 * @param {string} o.title
 * @param {string} [o.bodyHtml]      vertrouwde HTML (escape zelf dynamische tekst!)
 * @param {string|null} [o.confirmText="Bevestigen"]  null = geen bevestigknop
 * @param {string|null} [o.cancelText="Annuleren"]    null = geen annuleerknop
 * @param {(value: string, modalEl: HTMLElement) => any} [o.onConfirm]
 *        mag async zijn; gooit → foutmelding in het venster; `false` → venster blijft open
 * @param {() => void} [o.onCancel]
 * @param {boolean} [o.danger]       rode bevestigknop/rand
 * @param {boolean} [o.wide]
 * @param {string} [o.requireText]   getypte bevestiging: knop pas actief als invoer exact gelijk is
 * @param {boolean|object} [o.input] tekstveld tonen ({ label, placeholder, value, type })
 * @returns {() => void} close()
 */
function openModal(o = {}) {
  const {
    title = "Bevestigen",
    bodyHtml = "",
    confirmText = "Bevestigen",
    cancelText = "Annuleren",
    onConfirm,
    onCancel,
    danger = false,
    wide = false,
    requireText = null,
  } = o;
  const root = $("modal-root");
  const input = requireText ? { ...(typeof o.input === "object" ? o.input : {}) } : o.input;
  const inputCfg = input ? (typeof input === "object" ? input : {}) : null;

  const backdrop = document.createElement("div");
  backdrop.className = "modal-backdrop";
  const titleId = `modal-t-${Date.now()}`;
  const inputHtml = inputCfg
    ? `<div class="form-row modal-input">
        ${
          inputCfg.label || requireText
            ? `<label for="${titleId}-in">${esc(inputCfg.label || "Typ ter bevestiging:")} ${
                requireText ? `<code>${esc(requireText)}</code>` : ""
              }</label>`
            : ""
        }
        <input id="${titleId}-in" class="input mono" type="${esc(inputCfg.type || "text")}" autocomplete="off" spellcheck="false"
          placeholder="${esc(inputCfg.placeholder || requireText || "")}" value="${esc(inputCfg.value || "")}" />
      </div>`
    : "";
  backdrop.innerHTML = `
    <div class="modal${danger ? " danger" : ""}${wide ? " wide" : ""}" role="dialog" aria-modal="true" aria-labelledby="${titleId}">
      <div class="modal-head">
        ${danger ? `<span class="modal-icon">${ICONS.warn}</span>` : ""}
        <h3 id="${titleId}">${esc(title)}</h3>
        <button type="button" class="modal-x" aria-label="Sluiten">×</button>
      </div>
      <div class="modal-body">${bodyHtml}${inputHtml}</div>
      <div class="modal-error" hidden></div>
      <div class="modal-foot">
        ${cancelText !== null ? `<button type="button" class="btn btn-ghost" data-m="cancel">${esc(cancelText)}</button>` : ""}
        ${
          confirmText !== null
            ? `<button type="button" class="btn ${danger ? "btn-danger solid" : "btn-primary"}" data-m="ok">${esc(confirmText)}</button>`
            : cancelText === null
              ? `<button type="button" class="btn" data-m="cancel">Sluiten</button>`
              : ""
        }
      </div>
    </div>`;
  root.appendChild(backdrop);

  const modal = backdrop.querySelector(".modal");
  const okBtn = backdrop.querySelector('[data-m="ok"]');
  const errEl = backdrop.querySelector(".modal-error");
  const inEl = backdrop.querySelector(".modal-input input");
  const prevFocus = document.activeElement;
  let busy = false;
  let closed = false;

  const refreshOk = () => {
    if (okBtn && requireText) okBtn.disabled = busy || (inEl ? inEl.value.trim() !== requireText : true);
  };
  refreshOk();

  const close = () => {
    if (closed) return;
    closed = true;
    document.removeEventListener("keydown", onKey, true);
    backdrop.classList.add("leaving");
    setTimeout(() => backdrop.remove(), 160);
    if (prevFocus && typeof prevFocus.focus === "function") prevFocus.focus();
  };
  const cancel = () => {
    if (busy) return;
    close();
    try {
      onCancel && onCancel();
    } catch (err) {
      console.error(err);
    }
  };
  const confirm = async () => {
    if (busy || closed) return;
    const value = inEl ? inEl.value.trim() : "";
    if (requireText && value !== requireText) {
      modal.classList.remove("shake");
      void modal.offsetWidth;
      modal.classList.add("shake");
      inEl && inEl.classList.add("invalid");
      return;
    }
    if (!onConfirm) return close();
    busy = true;
    errEl.hidden = true;
    okBtn && okBtn.classList.add("busy");
    refreshOk();
    if (okBtn) okBtn.disabled = true;
    try {
      const res = await onConfirm(value, modal);
      busy = false;
      if (res === false) {
        okBtn && okBtn.classList.remove("busy");
        if (okBtn) okBtn.disabled = false;
        refreshOk();
        return;
      }
      close();
    } catch (err) {
      busy = false;
      okBtn && okBtn.classList.remove("busy");
      if (okBtn) okBtn.disabled = false;
      refreshOk();
      errEl.textContent = (err && err.message) || String(err);
      errEl.hidden = false;
    }
  };
  function onKey(e) {
    if (e.key === "Escape") {
      e.stopPropagation();
      cancel();
    } else if (e.key === "Enter" && inEl && document.activeElement === inEl) {
      e.preventDefault();
      confirm();
    }
  }

  document.addEventListener("keydown", onKey, true);
  backdrop.addEventListener("mousedown", (e) => {
    if (e.target === backdrop) cancel();
  });
  backdrop.querySelector(".modal-x").addEventListener("click", cancel);
  backdrop.querySelectorAll('[data-m="cancel"]').forEach((b) => b.addEventListener("click", cancel));
  okBtn && okBtn.addEventListener("click", confirm);
  if (inEl) {
    inEl.addEventListener("input", () => {
      inEl.classList.remove("invalid");
      refreshOk();
    });
  }
  setTimeout(() => (inEl || okBtn || backdrop.querySelector("button"))?.focus(), 30);
  return close;
}

// ─────────────────────────────── State ───────────────────────────────

const bus = createBus();
let lastSnapshot = null;
let appInfo = null;
let selectedMarket = store.get(MARKET_KEY) || null;
let activeTab = null;
let connStatus = "connecting";

const theme = readTheme();

const ctx = {
  api,
  bus,
  fmt,
  esc,
  getState: () => lastSnapshot,
  getSelectedMarket: () => selectedMarket,
  toast,
  openModal,
  theme,
  LightweightCharts: window.LightweightCharts,
  // Extra's (buiten het minimale contract, optioneel te gebruiken):
  getInfo: () => appInfo,
  getActiveTab: () => activeTab,
  getConnection: () => connStatus,
  selectMarket: (market) => market && bus.emit("market-selected", { market }),
  showTab: (tab) => bus.emit("tab-changed", { tab }),
};
window.__bvt = ctx; // handig voor debuggen in de console

// Kern-handlers EERST registreren, zodat getState()/getSelectedMarket() al
// bijgewerkt zijn wanneer andere handlers voor hetzelfde event draaien.
bus.on("snapshot", (snap) => {
  if (!snap || typeof snap !== "object") return;
  lastSnapshot = snap;
  document.body.classList.toggle("live-armed", snap.mode === "live" && !!snap.liveArmed);
  if (!selectedMarket) {
    const first = snap.config && snap.config.markets && snap.config.markets[0];
    if (first) queueMicrotask(() => bus.emit("market-selected", { market: first }));
  }
});
bus.on("price", (p) => {
  if (lastSnapshot && p && p.market) {
    lastSnapshot.prices = lastSnapshot.prices || {};
    lastSnapshot.prices[p.market] = p.price;
  }
});
bus.on("log", (entry) => {
  if (lastSnapshot && entry) {
    const logs = (lastSnapshot.logs = lastSnapshot.logs || []);
    logs.unshift(entry);
    if (logs.length > 150) logs.length = 150;
  }
});
bus.on("market-selected", (d) => {
  const m = d && d.market;
  if (!m) return;
  selectedMarket = m;
  store.set(MARKET_KEY, m);
});
bus.on("tab-changed", (d) => applyTab(d && d.tab));
bus.on("config-changed", (cfg) => {
  if (lastSnapshot && cfg && typeof cfg === "object") lastSnapshot.config = { ...lastSnapshot.config, ...cfg };
});
bus.on("connection", (d) => setConnection(d && d.status));
bus.on("app-info", (info) => {
  if (info && typeof info === "object") appInfo = { ...(appInfo || {}), ...info };
});

// ─────────────────────────────── Tabs ───────────────────────────────

function tabFromHash() {
  const h = location.hash.replace(/^#\/?/, "").toLowerCase();
  return TABS.includes(h) ? h : "live";
}

function applyTab(tab) {
  if (!TABS.includes(tab)) return;
  activeTab = tab;
  for (const t of TABS) {
    const page = $(`tab-${t}`);
    if (page) page.hidden = t !== tab;
  }
  document.querySelectorAll("[data-tab]").forEach((btn) => {
    const on = btn.dataset.tab === tab;
    btn.classList.toggle("active", on);
    btn.setAttribute("aria-selected", on ? "true" : "false");
  });
  if (location.hash !== `#${tab}`) history.replaceState(null, "", `#${tab}`);
  document.title = tab === "live" ? "Bitvavo Trader" : `${TAB_TITLES[tab]} · Bitvavo Trader`;
}

document.querySelectorAll("[data-tab]").forEach((btn) => {
  btn.addEventListener("click", (e) => {
    e.preventDefault();
    const tab = btn.dataset.tab;
    if (location.hash !== `#${tab}`) location.hash = tab; // → hashchange → tab-changed
    else if (tab !== activeTab) bus.emit("tab-changed", { tab });
  });
});
document.querySelector(".brand")?.addEventListener("click", (e) => {
  e.preventDefault();
  if (location.hash !== "#live") location.hash = "live";
  window.scrollTo({ top: 0, behavior: "smooth" });
});
window.addEventListener("hashchange", () => {
  const t = tabFromHash();
  if (t !== activeTab) bus.emit("tab-changed", { tab: t });
});

// ─────────────────────────────── Verbinding ───────────────────────────────

let everOpen = false;
let lostToast = null;

function setConnection(status) {
  const el = $("conn-status");
  const prev = connStatus;
  connStatus = status || "connecting";
  if (el) {
    el.className = `conn ${connStatus}`;
    const text =
      connStatus === "open" ? "Live verbonden" : connStatus === "closed" ? "Verbinding weg…" : "Verbinden…";
    el.querySelector(".conn-text").textContent = text;
    el.title =
      connStatus === "open"
        ? "Realtime verbinding met de bot actief"
        : connStatus === "closed"
          ? "Geen verbinding met de bot. Er wordt automatisch opnieuw verbonden. Draait de bot nog?"
          : "Verbinden met de bot…";
  }
  if (connStatus === "open") {
    if (everOpen && prev === "closed") {
      lostToast && lostToast();
      lostToast = null;
      toast("Weer verbonden met de bot", "success");
    }
    everOpen = true;
  } else if (connStatus === "closed" && prev === "open") {
    lostToast = toast("Verbinding met de bot verbroken — opnieuw verbinden…", "warn");
  }
}

// ─────────────────────────────── Event-toasts ───────────────────────────────

bus.on("position-opened", (p) => {
  if (!p) return;
  const paper = lastSnapshot && lastSnapshot.mode === "paper";
  toast(
    `${paper ? "Oefen-aankoop" : "Gekocht"}: ${p.market} @ ${fmt.price(p.entryPrice)} · inzet ${fmt.eur(p.costQuote)} · stop ${fmt.price(p.stopPrice)}`,
    "success",
  );
});
bus.on("position-closed", (t) => {
  if (!t) return;
  const paper = lastSnapshot && lastSnapshot.mode === "paper";
  toast(
    `${paper ? "Oefen-verkoop" : "Verkocht"}: ${t.market} ${fmt.eurSigned(t.pnlQuote)} (${fmt.pct(t.pnlPct)}) · ${fmt.exitReason(t.exitReason)}`,
    t.pnlQuote >= 0 ? "success" : "warn",
  );
});
let lastErrToast = { msg: "", at: 0 };
bus.on("log", (entry) => {
  if (!entry || entry.level !== "error") return;
  const now = Date.now();
  if (entry.message === lastErrToast.msg && now - lastErrToast.at < 30_000) return; // geen spam
  lastErrToast = { msg: entry.message, at: now };
  toast(entry.message, "error");
});

// ─────────────────────────────── Mounten ───────────────────────────────

function safeMount(name, fn) {
  try {
    fn();
  } catch (err) {
    console.error(`Kon ${name} niet starten`, err);
  }
}

function fallbackHtml(file, err) {
  return `<div class="panel-fallback">${ICONS.warn}<div>Paneel kon niet laden<small>${esc(file)}${
    err && err.message ? ` — ${esc(err.message)}` : ""
  }</small></div></div>`;
}

safeMount("header", () =>
  mountHeader(ctx, {
    statsEl: $("header-stats"),
    controlsEl: $("bot-controls"),
    bannerEl: $("mode-banner"),
    alertEl: $("alert-banners"),
  }),
);
safeMount("grafiek", () =>
  mountLiveChart(ctx, {
    tabsEl: $("market-tabs"),
    toolbarEl: $("chart-toolbar"),
    stackEl: $("chart-stack"),
    mainEl: $("chart-main"),
    rsiEl: $("chart-rsi"),
    macdEl: $("chart-macd"),
  }),
);
safeMount("tabellen", () => mountTables(ctx, { positionsEl: $("panel-positions"), tradesEl: $("panel-trades") }));
safeMount("logboek", () => mountLog(ctx, $("panel-log")));

const PANELS = [
  ["signals", "mountSignals", "panel-signals"],
  ["risk", "mountRisk", "panel-risk"],
  ["equity", "mountEquity", "panel-equity"],
  ["backtest", "mountBacktest", "backtest-root"],
  ["scanner", "mountScanner", "scanner-root"],
  ["settings", "mountSettings", "settings-root"],
];

const panelsReady = Promise.all(
  PANELS.map(async ([file, fnName, elId]) => {
    const el = $(elId);
    if (!el) return;
    try {
      const mod = await import(`./panels/${file}.js`);
      const fn = mod[fnName];
      if (typeof fn !== "function") throw new Error(`${fnName}() ontbreekt`);
      el.innerHTML = "";
      await fn(ctx, el);
    } catch (err) {
      console.warn(`Paneel "${file}" kon niet laden:`, err);
      el.innerHTML = fallbackHtml(`panels/${file}.js`, err);
    }
  }),
);

// Eerste tab toepassen (na mounten, zodat panelen het event ontvangen)
bus.emit("tab-changed", { tab: tabFromHash() });
if (selectedMarket) bus.emit("market-selected", { market: selectedMarket });

// ─────────────────────────────── Opstarten ───────────────────────────────

function askToken() {
  openModal({
    title: "Dashboard-token nodig",
    bodyHtml:
      "<p>Deze bot is beveiligd met een <strong>DASHBOARD_TOKEN</strong>. Vul het token in dat in je <code>.env</code> staat.</p>",
    input: { label: "Token", placeholder: "token", type: "password" },
    confirmText: "Opslaan en herladen",
    onConfirm: (value) => {
      if (!value) return false;
      setToken(value);
      location.reload();
    },
  });
}

async function boot() {
  let stateOk = false;
  try {
    const [state, info] = await Promise.all([api.getState(), api.info().catch(() => null)]);
    if (info) {
      bus.emit("app-info", info);
      const v = $("footer-version");
      if (v && info.version) v.textContent = `Bitvavo Trader v${info.version}`;
    }
    if (state) {
      bus.emit("snapshot", state);
      stateOk = true;
    }
  } catch (err) {
    console.error("Kon status niet laden", err);
    if (err instanceof ApiError && err.status === 401) {
      askToken();
      return;
    }
    toast(`Kon de bot niet bereiken: ${err.message}`, "error");
    setConnection("closed");
  }

  connectEvents(
    (type, data) => bus.emit(type, data),
    (status) => bus.emit("connection", { status }),
  );

  // Vangnet: panelen die ná de eerste snapshot mounten krijgen hem alsnog.
  panelsReady.then(() => {
    if (stateOk && lastSnapshot) bus.emit("snapshot", lastSnapshot);
  });
}

boot();
