// Backtest-lab: backtest, optimalisatie (grid search + heatmap) en walk-forward.
// Alles wordt server-side berekend (POST /api/backtest|optimize|walkforward);
// dit paneel bouwt het formulier en visualiseert de resultaten.

const INTERVALS = ["1m", "5m", "15m", "30m", "1h", "2h", "4h", "6h", "8h", "12h", "1d"];
const INTERVAL_MS = {
  "1m": 6e4, "5m": 3e5, "15m": 9e5, "30m": 18e5, "1h": 36e5, "2h": 72e5,
  "4h": 144e5, "6h": 216e5, "8h": 288e5, "12h": 432e5, "1d": 864e5,
};
const INTERVAL_LABELS = {
  "1m": "1 minuut", "5m": "5 minuten", "15m": "15 minuten", "30m": "30 minuten", "1h": "1 uur", "2h": "2 uur",
  "4h": "4 uur", "6h": "6 uur", "8h": "8 uur", "12h": "12 uur", "1d": "1 dag",
};
const OBJECTIVES = {
  sharpe: "Sharpe-ratio (rendement per risico)",
  return: "Totaal rendement",
  profitFactor: "Profit factor (winst ÷ verlies)",
  calmar: "Calmar (rendement ÷ drawdown)",
};
const OBJECTIVE_SHORT = { sharpe: "Sharpe", return: "Rendement %", profitFactor: "Profit factor", calmar: "Calmar" };
const FALLBACK_STRATEGIES = [
  { id: "ema-trend", name: "EMA-trend", defaultParams: {} },
  { id: "rsi-reversion", name: "RSI-omkeer", defaultParams: {} },
  { id: "breakout", name: "Uitbraak", defaultParams: {} },
  { id: "macd-momentum", name: "MACD-momentum", defaultParams: {} },
  { id: "vwap-reversion", name: "VWAP-omkeer", defaultParams: {} },
];
const FALLBACK_DEFAULTS = { buyThreshold: 0.35, sellThreshold: -0.3, stopAtrMult: 2, takeProfitR: 2, riskPerTradePct: 1.5 };
const PARAM_LABELS = {
  "ensemble.buyThreshold": "Koopdrempel",
  "ensemble.sellThreshold": "Verkoopdrempel",
  "ensemble.regimeFilter": "Regimefilter",
  "risk.stopAtrMult": "Stop-loss (× ATR)",
  "risk.takeProfitR": "Winstdoel (R)",
  "risk.riskPerTradePct": "Risico per trade (%)",
  "risk.trailingAtrMult": "Trailing stop (× ATR)",
  "risk.breakEvenAtR": "Break-even (R)",
  "risk.timeStopCandles": "Tijdslimiet (candles)",
  "risk.maxPositionPct": "Max. positie (%)",
};
const HONEST_NOTE =
  "Resultaten uit het verleden zijn geen garantie voor de toekomst. Fees (0,25% per kant) en slippage zijn meegerekend.";
const MAX_CANDLES_WARN = 20000;
const FORM_KEY = "bvt-backtest-form";

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
    yellow: pick("yellow", "--yellow", "#f5b83d"),
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
  if (type === 1) return d.toLocaleDateString("nl-NL", { month: "short", year: "2-digit" });
  if (type === 2) return d.toLocaleDateString("nl-NL", { day: "numeric", month: "short" });
  return d.toLocaleTimeString("nl-NL", { hour: "2-digit", minute: "2-digit" });
}

// ── Tooltip (één gedeelde zwevende tooltip voor alle SVG-visuals) ──
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
function bindTip(root, selector, html) {
  const hide = () => (tipEl().style.display = "none");
  root.addEventListener("mousemove", (e) => {
    const target = e.target.closest ? e.target.closest(selector) : null;
    const t = tipEl();
    if (!target || !root.contains(target)) return hide();
    const h = html(target);
    if (!h) return hide();
    t.innerHTML = h;
    t.style.display = "block";
    const r = t.getBoundingClientRect();
    let x = e.clientX + 14;
    let y = e.clientY + 14;
    if (x + r.width > window.innerWidth - 8) x = e.clientX - r.width - 14;
    if (y + r.height > window.innerHeight - 8) y = e.clientY - r.height - 14;
    t.style.left = `${Math.max(4, x)}px`;
    t.style.top = `${Math.max(4, y)}px`;
  });
  root.addEventListener("mouseleave", hide);
}

function niceStep(raw) {
  if (!(raw > 0)) return 1;
  const p = Math.pow(10, Math.floor(Math.log10(raw)));
  const f = raw / p;
  return (f <= 1 ? 1 : f <= 2 ? 2 : f <= 2.5 ? 2.5 : f <= 5 ? 5 : 10) * p;
}

function barPath(x, y, w, h, r) {
  if (h <= 0 || w <= 0) return "";
  r = Math.min(r, w / 2, h);
  return `M${x},${y + h}V${y + r}Q${x},${y} ${x + r},${y}H${x + w - r}Q${x + w},${y} ${x + w},${y + r}V${y + h}Z`;
}

const num = (v) => {
  const n = typeof v === "string" ? Number(v.replace(",", ".")) : Number(v);
  return Number.isFinite(n) ? n : NaN;
};

export function mountBacktest(ctx, el) {
  ensureCss();
  const { fmt, esc, api, bus } = ctx;
  if (!el) return;
  const LC = ctx.LightweightCharts || window.LightweightCharts;
  const T = themeOf(ctx);

  const state = {
    markets: [],
    strategies: FALLBACK_STRATEGIES,
    config: ctx.getState?.()?.config || null,
    info: null,
    running: null,
    results: { backtest: null, optimize: null, walkforward: null },
    view: null,
    charts: [],
    observers: [],
  };

  const stratName = (id) => state.strategies.find((s) => s.id === id)?.name || id;
  const paramLabel = (k) => {
    if (PARAM_LABELS[k]) return PARAM_LABELS[k];
    const i = k.indexOf(".");
    if (i < 0) return k;
    const head = k.slice(0, i);
    const rest = k.slice(i + 1);
    if (head === "ensemble" && rest.startsWith("weights.")) return `Gewicht ${stratName(rest.slice(8))}`;
    return `${stratName(head)} · ${rest}`;
  };
  const fmtParam = (v) => (typeof v === "boolean" ? (v ? "aan" : "uit") : fmt.num(v, 4));
  const fmtScore = (v, objective) => {
    if (!Number.isFinite(v)) return "–";
    if (objective === "return") return fmt.pct(v, 2);
    if (objective === "profitFactor" && v >= 999) return "∞";
    return fmt.num(v, 2);
  };

  el.classList.add("bt");
  el.innerHTML = `
    <aside class="bt-side">
      <form class="panel bt-form" novalidate autocomplete="off">
        <div class="pn-head"><div class="panel-title">Backtest-lab</div><span class="pn-chip">historische test</span></div>
        <p class="pn-hint">Test de bot op koersen uit het verleden — zonder risico. Je ziet wat de instellingen gedaan zouden hebben, inclusief alle kosten.</p>

        <div class="form-row"><label for="bt-market">Markt</label>
          <select id="bt-market" class="select" name="market"><option>Laden…</option></select></div>
        <div class="bt-row2">
          <div class="form-row"><label for="bt-interval">Interval</label>
            <select id="bt-interval" class="select" name="interval">
              ${INTERVALS.map((iv) => `<option value="${iv}">${iv} · ${INTERVAL_LABELS[iv]}</option>`).join("")}
            </select></div>
          <div class="form-row"><label for="bt-days">Periode (dagen)</label>
            <input id="bt-days" class="input" type="number" name="days" min="1" max="365" step="1" value="30"></div>
        </div>
        <div class="form-row"><label for="bt-capital">Startkapitaal (€)</label>
          <input id="bt-capital" class="input" type="number" name="capital" min="10" step="5" value="50"></div>
        <div class="bt-est"></div>

        <details class="bt-adv">
          <summary>Geavanceerd <span class="muted">— drempels, risico, strategieën</span></summary>
          <div class="bt-adv-body">
            <div class="bt-row2">
              <div class="form-row"><label for="bt-buy" title="Score waarboven de bot koopt (0..1)">Koopdrempel</label>
                <input id="bt-buy" class="input" type="number" name="buyThreshold" min="0.05" max="1" step="0.05"></div>
              <div class="form-row"><label for="bt-sell" title="Score waaronder de bot verkoopt (negatief)">Verkoopdrempel</label>
                <input id="bt-sell" class="input" type="number" name="sellThreshold" min="-1" max="-0.05" step="0.05"></div>
              <div class="form-row"><label for="bt-stop" title="Afstand van de stop-loss in ATR (gemiddelde candle-beweging)">Stop-loss (× ATR)</label>
                <input id="bt-stop" class="input" type="number" name="stopAtrMult" min="0.5" max="6" step="0.1"></div>
              <div class="form-row"><label for="bt-tp" title="Winstdoel als veelvoud van je risico (R)">Winstdoel (R)</label>
                <input id="bt-tp" class="input" type="number" name="takeProfitR" min="0.5" max="10" step="0.1"></div>
              <div class="form-row"><label for="bt-risk" title="% van je saldo dat je verliest als de stop geraakt wordt">Risico per trade (%)</label>
                <input id="bt-risk" class="input" type="number" name="riskPerTradePct" min="0.1" max="5" step="0.1"></div>
            </div>
            <div class="form-row"><label>Strategieën</label><div class="bt-strats pn-chips"></div></div>
            <button type="button" class="btn btn-ghost bt-adv-reset">↺ Huidige bot-instellingen</button>
          </div>
        </details>

        <button type="submit" class="btn btn-primary bt-run bt-run-main" data-run="backtest">
          <svg class="pn-ico" viewBox="0 0 15 15" aria-hidden="true"><polygon points="4,2.5 12.5,7.5 4,12.5"/></svg> Backtest</button>

        <div class="bt-sep"><span>Optimaliseren</span></div>
        <p class="pn-hint">Probeert automatisch tientallen combinaties van instellingen en zoekt de beste.</p>
        <div class="bt-row2">
          <div class="form-row"><label for="bt-obj">Doel</label>
            <select id="bt-obj" class="select" name="objective">
              ${Object.entries(OBJECTIVES).map(([k, v]) => `<option value="${k}">${esc(v)}</option>`).join("")}
            </select></div>
          <div class="form-row"><label for="bt-strat">Wat optimaliseren</label>
            <select id="bt-strat" class="select" name="strategy"><option value="">Drempels &amp; risico</option></select></div>
        </div>
        <button type="button" class="btn bt-run" data-run="optimize">
          <svg class="pn-ico" viewBox="0 0 15 15" aria-hidden="true"><rect x="1.5" y="1.5" width="5" height="5"/><rect x="8.5" y="1.5" width="5" height="5"/><rect x="1.5" y="8.5" width="5" height="5"/><rect x="8.5" y="8.5" width="5" height="5"/></svg> Optimaliseer</button>

        <div class="bt-sep"><span>Walk-forward</span></div>
        <p class="pn-hint">De eerlijkste test: optimaliseert op een deel van de data en test op een stuk dat de optimizer níet gezien heeft. Gebruik minstens 60 dagen.</p>
        <div class="bt-row2">
          <div class="form-row"><label for="bt-folds">Folds (vensters)</label>
            <input id="bt-folds" class="input" type="number" name="folds" min="2" max="10" step="1" value="4"></div>
          <div class="form-row"><label for="bt-train">Train-deel</label>
            <input id="bt-train" class="input" type="number" name="trainRatio" min="0.5" max="0.9" step="0.05" value="0.7"></div>
        </div>
        <div class="bt-split" aria-hidden="true"></div>
        <button type="button" class="btn bt-run" data-run="walkforward">
          <svg class="pn-ico" viewBox="0 0 15 15" aria-hidden="true"><polyline points="1.5,10 5,6.5 8,9 13.5,3.5"/><line x1="1.5" y1="13" x2="13.5" y2="13"/></svg> Walk-forward</button>
      </form>
    </aside>
    <section class="bt-main">
      <div class="pn-note bt-honest">
        <svg class="pn-ico" viewBox="0 0 15 15" aria-hidden="true"><circle cx="7.5" cy="7.5" r="6"/><line x1="7.5" y1="6.5" x2="7.5" y2="10.5"/><circle cx="7.5" cy="4.5" r=".5"/></svg>
        <span>${esc(HONEST_NOTE)}</span>
      </div>
      <div class="bt-rtabs" role="tablist" hidden></div>
      <div class="bt-out"></div>
      <div class="bt-busy" hidden>
        <div class="bt-busy-card">
          <span class="spinner"></span>
          <div><b class="bt-busy-title">Bezig…</b><div class="muted bt-busy-sub"></div></div>
          <div class="mono bt-busy-time">0s</div>
        </div>
      </div>
    </section>`;

  const $ = (s) => el.querySelector(s);
  const form = $(".bt-form");
  const out = $(".bt-out");
  const busyEl = $(".bt-busy");
  const rtabs = $(".bt-rtabs");
  const F = (name) => form.elements.namedItem(name);

  // ── Formulier ──
  function saveForm() {
    try {
      const data = {};
      for (const n of ["market", "interval", "days", "capital", "objective", "strategy", "folds", "trainRatio"]) data[n] = F(n)?.value;
      localStorage.setItem(FORM_KEY, JSON.stringify(data));
    } catch {
      /* geen localStorage */
    }
  }
  function loadSavedForm() {
    try {
      return JSON.parse(localStorage.getItem(FORM_KEY) || "null");
    } catch {
      return null;
    }
  }

  function fillAdvanced(cfg) {
    const e = cfg?.ensemble || {};
    const r = cfg?.risk || {};
    F("buyThreshold").value = e.buyThreshold ?? FALLBACK_DEFAULTS.buyThreshold;
    F("sellThreshold").value = e.sellThreshold ?? FALLBACK_DEFAULTS.sellThreshold;
    F("stopAtrMult").value = r.stopAtrMult ?? FALLBACK_DEFAULTS.stopAtrMult;
    F("takeProfitR").value = r.takeProfitR ?? FALLBACK_DEFAULTS.takeProfitR;
    F("riskPerTradePct").value = r.riskPerTradePct ?? FALLBACK_DEFAULTS.riskPerTradePct;
    const enabled = new Set(e.enabled || state.strategies.map((s) => s.id));
    $(".bt-strats").innerHTML = state.strategies
      .map(
        (s) => `<label class="pn-toggle-chip" title="${esc(s.description || "")}">
          <input type="checkbox" name="strat" value="${esc(s.id)}" ${enabled.has(s.id) ? "checked" : ""}><span>${esc(s.name)}</span></label>`,
      )
      .join("");
  }

  function fillSelects() {
    const saved = loadSavedForm() || {};
    const cfg = state.config;
    const preferred = saved.market || ctx.getSelectedMarket?.() || cfg?.markets?.[0] || "BTC-EUR";
    const list = state.markets.length ? state.markets.map((m) => m.market) : cfg?.markets || ["BTC-EUR"];
    if (!list.includes(preferred)) list.unshift(preferred);
    const botMarkets = new Set(cfg?.markets || []);
    const top = list.filter((m) => botMarkets.has(m));
    const rest = list.filter((m) => !botMarkets.has(m));
    const sel = F("market");
    sel.innerHTML =
      (top.length ? `<optgroup label="In de bot">${top.map((m) => `<option value="${esc(m)}">${esc(m)}</option>`).join("")}</optgroup>` : "") +
      `<optgroup label="Alle EUR-markten">${rest.map((m) => `<option value="${esc(m)}">${esc(m)}</option>`).join("")}</optgroup>`;
    sel.value = preferred;
    F("interval").value = saved.interval || cfg?.interval || "15m";
    if (saved.days) F("days").value = saved.days;
    if (saved.capital) F("capital").value = saved.capital;
    if (saved.objective && OBJECTIVES[saved.objective]) F("objective").value = saved.objective;
    if (saved.folds) F("folds").value = saved.folds;
    if (saved.trainRatio) F("trainRatio").value = saved.trainRatio;
    F("strategy").innerHTML =
      `<option value="">Drempels &amp; risico (ensemble)</option>` +
      state.strategies.map((s) => `<option value="${esc(s.id)}">Parameters: ${esc(s.name)}</option>`).join("");
    if (saved.strategy !== undefined) F("strategy").value = saved.strategy;
    fillAdvanced(cfg);
    updateEstimate();
  }

  function updateEstimate() {
    const days = num(F("days").value);
    const iv = F("interval").value;
    const est = $(".bt-est");
    if (!(days > 0) || !INTERVAL_MS[iv]) {
      est.innerHTML = "";
      return;
    }
    const n = Math.round((days * 864e5) / INTERVAL_MS[iv]);
    const heavy = n > MAX_CANDLES_WARN;
    est.className = `bt-est ${heavy ? "is-warn" : ""}`;
    est.innerHTML = `≈ <b class="mono">${esc(fmt.num(n, 0))}</b> candles van ${esc(INTERVAL_LABELS[iv])}` +
      (heavy ? ` — <b>veel data</b>: dit kan lang duren. Kies een groter interval of minder dagen.` : "");
    const tr = num(F("trainRatio").value);
    const r = Number.isFinite(tr) ? Math.max(0.5, Math.min(0.9, tr)) : 0.7;
    const folds = Math.max(2, Math.min(10, Math.round(num(F("folds").value)) || 4));
    $(".bt-split").innerHTML = Array.from({ length: folds }, (_, i) =>
      `<div class="bt-split-fold" title="Fold ${i + 1}"><i style="flex:${r}"></i><b style="flex:${1 - r}"></b></div>`).join("") +
      `<div class="bt-split-lbl"><span><i></i>train ${esc(fmt.num(r * 100, 0))}%</span><span><b></b>test ${esc(fmt.num((1 - r) * 100, 0))}%</span></div>`;
  }

  function readForm(kind) {
    const errors = [];
    const market = F("market").value;
    const interval = F("interval").value;
    const days = Math.round(num(F("days").value));
    const initialCapital = num(F("capital").value);
    if (!market) errors.push("Kies een markt.");
    if (!(days >= 1 && days <= 365)) errors.push("Periode moet tussen 1 en 365 dagen liggen.");
    if (!(initialCapital >= 10)) errors.push("Startkapitaal moet minimaal €10 zijn (Bitvavo-minimum per order is €5).");
    const buy = num(F("buyThreshold").value);
    const sell = num(F("sellThreshold").value);
    const stop = num(F("stopAtrMult").value);
    const tp = num(F("takeProfitR").value);
    const risk = num(F("riskPerTradePct").value);
    if (!(buy > 0 && buy <= 1)) errors.push("Koopdrempel moet tussen 0 en 1 liggen.");
    if (!(sell < 0 && sell >= -1)) errors.push("Verkoopdrempel moet tussen −1 en 0 liggen (negatief).");
    if (!(stop > 0)) errors.push("Stop-loss (× ATR) moet groter dan 0 zijn.");
    if (!(tp > 0)) errors.push("Winstdoel (R) moet groter dan 0 zijn.");
    if (!(risk > 0 && risk <= 10)) errors.push("Risico per trade moet tussen 0 en 10% liggen.");
    const enabled = [...form.querySelectorAll('input[name="strat"]:checked')].map((i) => i.value);
    if (!enabled.length) errors.push("Zet minstens één strategie aan.");
    const req = {
      market,
      interval,
      days,
      initialCapital,
      ensemble: { buyThreshold: buy, sellThreshold: sell, enabled },
      risk: { stopAtrMult: stop, takeProfitR: tp, riskPerTradePct: risk },
    };
    if (kind !== "backtest") {
      req.objective = F("objective").value || "sharpe";
      const s = F("strategy").value;
      if (s) req.strategy = s;
    }
    if (kind === "walkforward") {
      const folds = Math.round(num(F("folds").value));
      const trainRatio = num(F("trainRatio").value);
      if (!(folds >= 2 && folds <= 10)) errors.push("Aantal folds moet tussen 2 en 10 liggen.");
      if (!(trainRatio >= 0.5 && trainRatio <= 0.9)) errors.push("Train-deel moet tussen 0,5 en 0,9 liggen.");
      req.folds = folds;
      req.trainRatio = trainRatio;
      if (days < 30) errors.push("Walk-forward heeft minstens 30 dagen data nodig (liefst 60+).");
    }
    return { req, errors };
  }

  // ── Uitvoeren ──
  let busyTimer = 0;
  function setBusy(kind) {
    state.running = kind;
    for (const b of form.querySelectorAll(".bt-run")) {
      b.disabled = !!kind;
      b.classList.toggle("is-running", b.dataset.run === kind);
    }
    clearInterval(busyTimer);
    if (!kind) {
      busyEl.hidden = true;
      out.classList.remove("is-stale");
      return;
    }
    const titles = {
      backtest: ["Backtest draait…", "Candles ophalen en elke candle doorrekenen met dezelfde logica als de live bot."],
      optimize: ["Optimalisatie draait…", "Tientallen combinaties worden getest. Dit kan een minuut duren."],
      walkforward: ["Walk-forward draait…", "Per venster: optimaliseren op het train-deel, testen op het test-deel. Dit duurt het langst."],
    }[kind];
    $(".bt-busy-title").textContent = titles[0];
    $(".bt-busy-sub").textContent = titles[1];
    const t0 = Date.now();
    const timeEl = $(".bt-busy-time");
    timeEl.textContent = "0s";
    busyTimer = setInterval(() => (timeEl.textContent = fmt.duration(Date.now() - t0)), 500);
    busyEl.hidden = false;
    out.classList.add("is-stale");
  }

  async function run(kind) {
    if (state.running) {
      ctx.toast("Er loopt al een berekening. Even geduld.", "warn");
      return;
    }
    const { req, errors } = readForm(kind);
    if (errors.length) {
      ctx.toast(errors[0], "warn");
      showFormErrors(errors);
      return;
    }
    showFormErrors([]);
    saveForm();
    setBusy(kind);
    try {
      const fn = kind === "backtest" ? api.backtest : kind === "optimize" ? api.optimize : api.walkForward;
      const res = await fn(req);
      state.results[kind] = { req, res, at: Date.now() };
      setBusy(null);
      showView(kind);
      const msg = {
        backtest: `Backtest klaar: ${fmt.pct(res?.metrics?.totalReturnPct)} rendement`,
        optimize: `Optimalisatie klaar: ${res?.combosTested ?? "?"} combinaties getest`,
        walkforward: "Walk-forward klaar",
      }[kind];
      ctx.toast(msg, "success");
    } catch (err) {
      setBusy(null);
      if (err && err.status === 429) {
        ctx.toast("De server is nog bezig met een andere berekening. Probeer het over een minuut opnieuw.", "warn");
      } else {
        ctx.toast(`Mislukt: ${err?.message || err}`, "error");
        showErrorBox(kind, err);
      }
    }
  }

  function showFormErrors(errors) {
    let box = form.querySelector(".bt-form-errors");
    if (!errors.length) {
      box?.remove();
      return;
    }
    if (!box) {
      box = document.createElement("div");
      box.className = "pn-banner pn-banner-bad bt-form-errors";
      form.querySelector(".bt-run-main").before(box);
    }
    box.innerHTML = `<ul>${errors.map((e) => `<li>${esc(e)}</li>`).join("")}</ul>`;
  }

  function showErrorBox(kind, err) {
    destroyVisuals();
    state.view = null;
    renderTabs();
    out.innerHTML = `<div class="pn-banner pn-banner-bad">
      <b>${esc({ backtest: "Backtest", optimize: "Optimalisatie", walkforward: "Walk-forward" }[kind])} mislukt</b>
      <div>${esc(err?.message || String(err))}</div>
      <div class="muted">Controleer de invoer of probeer een kortere periode / groter interval.</div></div>`;
  }

  // ── Resultaat-tabs ──
  function renderTabs() {
    const kinds = ["backtest", "optimize", "walkforward"].filter((k) => state.results[k]);
    rtabs.hidden = kinds.length < 2;
    rtabs.innerHTML = kinds
      .map((k) => {
        const r = state.results[k];
        const label = { backtest: "Backtest", optimize: "Optimalisatie", walkforward: "Walk-forward" }[k];
        return `<button type="button" role="tab" class="bt-rtab ${state.view === k ? "is-active" : ""}" data-view="${k}" aria-selected="${state.view === k}">
          ${esc(label)} <span class="muted">${esc(r.req.market)} · ${esc(fmt.time(r.at))}</span></button>`;
      })
      .join("");
  }

  function destroyVisuals() {
    for (const c of state.charts) {
      try {
        c.remove();
      } catch {
        /* al weg */
      }
    }
    state.charts = [];
    for (const o of state.observers) o.disconnect();
    state.observers = [];
    tipEl().style.display = "none";
  }

  function showView(kind) {
    destroyVisuals();
    state.view = kind;
    renderTabs();
    const r = state.results[kind];
    if (!r) return renderEmpty();
    try {
      if (kind === "backtest") renderBacktest(r);
      else if (kind === "optimize") renderOptimize(r);
      else renderWalkForward(r);
    } catch (err) {
      console.error("Backtest-lab render:", err);
      out.innerHTML = `<div class="pn-banner pn-banner-bad">Kon het resultaat niet tonen: ${esc(err.message)}</div>`;
    }
  }

  function renderEmpty() {
    out.innerHTML = `
      <div class="panel bt-empty">
        <div class="bt-empty-grid">
          <div class="bt-empty-card"><div class="bt-empty-ico">▶</div><b>Backtest</b>
            <p>Speel de bot af op één periode uit het verleden. Je ziet elke trade, de equity-curve en of hij beter was dan gewoon kopen en vasthouden.</p></div>
          <div class="bt-empty-card"><div class="bt-empty-ico">▦</div><b>Optimaliseer</b>
            <p>Test veel combinaties van instellingen. De heatmap laat zien welke gebieden goed werken — zoek een <i>breed</i> groen gebied, niet één toevallige uitschieter.</p></div>
          <div class="bt-empty-card"><div class="bt-empty-ico">↗</div><b>Walk-forward</b>
            <p>De echte toets: werkt het ook op data die de optimizer nooit gezien heeft? Alleen dit resultaat zegt iets over de toekomst.</p></div>
        </div>
        <p class="pn-hint">Kies links een markt en klik op <b>Backtest</b> om te beginnen. Met €50 zijn fees relatief duur: een strategie moet ruim boven de kosten verdienen.</p>
      </div>`;
  }

  // ── Visual helpers ──
  function responsive(container, draw) {
    let lastW = 0;
    const doDraw = () => {
      const w = Math.floor(container.clientWidth);
      if (w > 0 && w !== lastW) {
        lastW = w;
        draw(w);
      }
    };
    const ro = new ResizeObserver(doDraw);
    ro.observe(container);
    state.observers.push(ro);
    doDraw();
  }

  function makeChart(container, extra = {}) {
    if (!LC) {
      container.innerHTML = '<div class="pn-empty">Grafiekbibliotheek niet geladen.</div>';
      return null;
    }
    const chart = LC.createChart(container, {
      autoSize: true,
      layout: {
        background: { type: "solid", color: "transparent" },
        textColor: T.muted,
        fontSize: 11,
        fontFamily: cssVar("--font") || undefined,
        panes: { separatorColor: T.border, separatorHoverColor: alpha(T.accent, 0.15) },
      },
      grid: { vertLines: { color: T.grid }, horzLines: { color: T.grid } },
      rightPriceScale: { borderColor: T.border },
      timeScale: { borderColor: T.border, timeVisible: true, secondsVisible: false, tickMarkFormatter: tickFormatter },
      localization: { locale: "nl-NL", timeFormatter: (s) => fmt.dateTime(Number(s) * 1000) },
      crosshair: {
        vertLine: { color: alpha(T.muted, 0.5), labelBackgroundColor: T.border },
        horzLine: { color: alpha(T.muted, 0.5), labelBackgroundColor: T.border },
      },
      ...extra,
    });
    state.charts.push(chart);
    return chart;
  }

  const toSec = (ms) => Math.floor(Number(ms) / 1000);
  function uniqByTime(points) {
    const m = new Map();
    for (const p of points) if (Number.isFinite(p.time)) m.set(p.time, p);
    return [...m.values()].sort((a, b) => a.time - b.time);
  }

  function quality(kind, m, initial) {
    switch (kind) {
      case "ret":
        return m.totalReturnPct <= 0 ? "bad" : m.totalReturnPct >= m.buyHoldReturnPct ? "good" : "warn";
      case "dd":
        return m.maxDrawdownPct <= 10 ? "good" : m.maxDrawdownPct <= 20 ? "warn" : "bad";
      case "sharpe":
        return m.sharpe >= 1 ? "good" : m.sharpe >= 0.3 ? "warn" : "bad";
      case "win":
        return m.winRatePct >= 50 ? "good" : m.winRatePct >= 35 ? "warn" : "bad";
      case "pf":
        return m.profitFactor >= 1.5 ? "good" : m.profitFactor >= 1 ? "warn" : "bad";
      case "trades":
        return m.trades >= 30 ? "good" : m.trades >= 10 ? "warn" : "bad";
      case "fees":
        return initial > 0 && m.feesPaid / initial > 0.05 ? "warn" : "neutral";
      case "final":
        return m.finalEquity > initial ? "good" : m.finalEquity < initial ? "bad" : "neutral";
      default:
        return "neutral";
    }
  }
  const Q_ICON = { good: "✓", warn: "!", bad: "✕", neutral: "•" };

  function kpiCards(m, initial) {
    if (!m) return "";
    const pf = m.profitFactor >= 999 ? "∞" : fmt.num(m.profitFactor, 2);
    const maxAbs = Math.max(Math.abs(m.totalReturnPct) || 0, Math.abs(m.buyHoldReturnPct) || 0, 0.01);
    const cmpBar = (v, cls, label) => {
      const w = (Math.abs(v) / maxAbs) * 50;
      const left = v >= 0 ? 50 : 50 - w;
      return `<div class="bt-cmp-row"><span>${label}</span><span class="bt-cmp-track"><i class="${cls} ${v >= 0 ? "is-pos" : "is-neg"}" style="left:${left}%;width:${w}%"></i></span><span class="mono">${esc(fmt.pct(v, 1))}</span></div>`;
    };
    const cards = [
      {
        q: quality("ret", m, initial),
        label: "Rendement",
        value: fmt.pct(m.totalReturnPct, 2),
        cls: fmt.pnlClass(m.totalReturnPct),
        subHtml: `<div class="bt-cmp">${cmpBar(m.totalReturnPct, "bt-cmp-s", "Bot")}${cmpBar(m.buyHoldReturnPct, "bt-cmp-b", "Buy &amp; hold")}</div>`,
        help: "Totale winst of verlies over de periode, na alle kosten. Vergeleken met 'buy & hold': gewoon kopen aan het begin en vasthouden.",
      },
      {
        q: quality("dd", m, initial),
        label: "Max. drawdown",
        value: fmt.pct(-Math.abs(m.maxDrawdownPct), 2),
        sub: "grootste daling van piek naar dal",
        help: "De grootste tussentijdse daling van je saldo. Kun je die emotioneel en financieel aan? Onder 10% is prettig.",
      },
      {
        q: quality("sharpe", m, initial),
        label: "Sharpe-ratio",
        value: fmt.num(m.sharpe, 2),
        sub: `Sortino ${fmt.num(m.sortino, 2)} · boven 1 is goed`,
        help: "Rendement per eenheid risico (schommeling). Hoger is beter; onder 0 betekent verlies.",
      },
      {
        q: quality("win", m, initial),
        label: "Winrate",
        value: fmt.pct(m.winRatePct, 0, false),
        sub: `gem. winst ${fmt.pct(m.avgWinPct, 2)} · verlies ${fmt.pct(m.avgLossPct, 2)}`,
        help: "Percentage winnende trades. Een lage winrate kan prima zijn als de winsten groter zijn dan de verliezen.",
      },
      {
        q: quality("pf", m, initial),
        label: "Profit factor",
        value: pf,
        sub: "bruto winst ÷ bruto verlies",
        help: "Boven 1 = winstgevend. Boven 1,5 is goed; onder 1 verlies je geld.",
      },
      {
        q: quality("trades", m, initial),
        label: "Trades",
        value: fmt.num(m.trades, 0),
        sub: m.trades < 10 ? "te weinig voor harde conclusies" : `gem. ${fmt.num(m.avgCandlesHeld, 1)} candles vastgehouden`,
        help: "Aantal afgeronde trades. Minder dan ~30 trades zegt statistisch weinig: het kan toeval zijn.",
      },
      {
        q: quality("fees", m, initial),
        label: "Fees betaald",
        value: fmt.eur(m.feesPaid),
        sub: initial > 0 ? `${fmt.pct((m.feesPaid / initial) * 100, 1, false)} van je startkapitaal` : "",
        help: "Totaal aan Bitvavo-fees (0,25% per kant). Bij een klein account eten fees snel je winst op.",
      },
      {
        q: quality("final", m, initial),
        label: "Eindsaldo",
        value: fmt.eur(m.finalEquity),
        cls: fmt.pnlClass(m.finalEquity - initial),
        sub: `${fmt.eurSigned(m.finalEquity - initial)} t.o.v. ${fmt.eur(initial)}`,
        help: "Wat er van je startkapitaal over zou zijn aan het eind van de periode.",
      },
    ];
    return `<div class="bt-kpis">${cards
      .map(
        (c) => `<div class="bt-kpi" data-q="${c.q}" title="${esc(c.help)}">
          <div class="bt-kpi-lbl"><span class="bt-q" aria-label="${c.q}">${Q_ICON[c.q]}</span>${esc(c.label)}</div>
          <div class="bt-kpi-val ${c.cls || ""}">${esc(c.value)}</div>
          <div class="bt-kpi-sub">${c.subHtml || esc(c.sub || "")}</div>
        </div>`,
      )
      .join("")}</div>`;
  }

  function candleChart(container, candles, markers) {
    const chart = makeChart(container);
    if (!chart) return;
    const s = chart.addSeries(LC.CandlestickSeries, {
      upColor: T.green,
      downColor: T.red,
      wickUpColor: T.green,
      wickDownColor: T.red,
      borderVisible: false,
      priceLineVisible: false,
      priceFormat: { type: "custom", minMove: 1e-8, formatter: (v) => fmt.price(v) },
    });
    const data = uniqByTime(
      (candles || []).map((k) => ({ time: toSec(k.time), open: k.open, high: k.high, low: k.low, close: k.close })),
    );
    s.setData(data);
    if (data.length && Array.isArray(markers) && markers.length) {
      const times = data.map((d) => d.time);
      const snap = (t) => {
        // Grootste candle-tijd <= t (markers kunnen tussen gedownsamplede candles vallen)
        let lo = 0;
        let hi = times.length - 1;
        if (t <= times[0]) return times[0];
        while (lo < hi) {
          const mid = (lo + hi + 1) >> 1;
          if (times[mid] <= t) lo = mid;
          else hi = mid - 1;
        }
        return times[lo];
      };
      const showText = markers.length <= 120;
      const mk = markers
        .map((m) => {
          const buy = m.action === "buy";
          const lbl = String(m.label || "");
          const pos = /\+\d/.test(lbl);
          const neg = /[-−]\d/.test(lbl);
          return {
            time: snap(toSec(m.time)),
            position: buy ? "belowBar" : "aboveBar",
            shape: buy ? "arrowUp" : "arrowDown",
            color: buy ? T.accent : pos ? T.green : neg ? T.red : T.yellow,
            text: showText ? lbl : "",
            size: 1,
          };
        })
        .sort((a, b) => a.time - b.time);
      LC.createSeriesMarkers(s, mk);
    }
    chart.timeScale().fitContent();
  }

  function equityChart(container, curve, initial) {
    const chart = makeChart(container);
    if (!chart) return;
    const pts = uniqByTime((curve || []).map((p) => ({ ...p, time: toSec(p.time) })));
    const eur = { type: "custom", minMove: 0.01, formatter: (v) => fmt.eur(v) };
    const bench = chart.addSeries(LC.LineSeries, {
      color: alpha(T.muted, 0.9),
      lineWidth: 1,
      lineStyle: 2,
      priceLineVisible: false,
      lastValueVisible: true,
      title: "B&H",
      priceFormat: eur,
      crosshairMarkerVisible: false,
    });
    bench.setData(pts.filter((p) => Number.isFinite(p.benchmark)).map((p) => ({ time: p.time, value: p.benchmark })));
    const eq = chart.addSeries(LC.LineSeries, {
      color: T.accent,
      lineWidth: 2,
      priceLineVisible: false,
      title: "Bot",
      priceFormat: eur,
    });
    eq.setData(pts.map((p) => ({ time: p.time, value: p.equity })));
    if (initial > 0) {
      eq.createPriceLine({ price: initial, color: alpha(T.muted, 0.6), lineWidth: 1, lineStyle: 1, axisLabelVisible: false, title: "start" });
    }
    const dd = chart.addSeries(
      LC.AreaSeries,
      {
        lineColor: T.red,
        lineWidth: 1,
        topColor: alpha(T.red, 0.05),
        bottomColor: alpha(T.red, 0.35),
        invertFilledArea: true,
        priceLineVisible: false,
        lastValueVisible: false,
        title: "Drawdown",
        priceFormat: { type: "custom", minMove: 0.01, formatter: (v) => fmt.pct(v, 1) },
      },
      1,
    );
    dd.setData(pts.map((p) => ({ time: p.time, value: Math.min(0, Number(p.drawdownPct) || 0) })));
    try {
      const panes = chart.panes();
      panes[0]?.setStretchFactor(3);
      panes[1]?.setStretchFactor(1);
    } catch {
      /* oudere versie */
    }
    chart.timeScale().fitContent();
  }

  function histogram(container, trades) {
    const vals = (trades || []).map((t) => Number(t.pnlPct)).filter(Number.isFinite);
    if (!vals.length) {
      container.innerHTML = '<div class="pn-empty">Geen trades in deze periode — niets om te tonen.</div>';
      return;
    }
    const mean = vals.reduce((a, b) => a + b, 0) / vals.length;
    responsive(container, (w) => {
      let lo = Math.min(0, ...vals);
      let hi = Math.max(0, ...vals);
      if (hi - lo < 0.5) {
        lo -= 0.25;
        hi += 0.25;
      }
      const step = niceStep((hi - lo) / Math.max(6, Math.min(18, Math.floor(w / 42))));
      const start = Math.floor(lo / step) * step;
      let n = Math.max(1, Math.ceil((hi - start) / step));
      if (start + n * step <= hi) n += 1;
      const bins = Array.from({ length: n }, (_, i) => ({ lo: start + i * step, hi: start + (i + 1) * step, n: 0, win: 0 }));
      for (const v of vals) {
        const i = Math.min(n - 1, Math.max(0, Math.floor((v - start) / step + 1e-9)));
        bins[i].n += 1;
        if (v > 0) bins[i].win += 1;
      }
      const maxN = Math.max(...bins.map((b) => b.n));
      const H = 200;
      const ml = 30;
      const mr = 10;
      const mt = 18;
      const mb = 26;
      const pw = w - ml - mr;
      const ph = H - mt - mb;
      const bw = pw / n;
      const x = (v) => ml + ((v - start) / (n * step)) * pw;
      const y = (c) => mt + ph - (c / maxN) * ph;
      const yStep = Math.max(1, niceStep(maxN / 3));
      let grid = "";
      for (let c = 0; c <= maxN; c += yStep) {
        grid += `<line class="pn-grid" x1="${ml}" x2="${w - mr}" y1="${y(c)}" y2="${y(c)}"/><text class="pn-axis" x="${ml - 6}" y="${y(c) + 3}" text-anchor="end">${c}</text>`;
      }
      const labelEvery = Math.max(1, Math.ceil(48 / bw));
      let xl = "";
      for (let i = 0; i <= n; i += labelEvery) {
        const v = start + i * step;
        xl += `<text class="pn-axis" x="${x(v)}" y="${H - 8}" text-anchor="middle">${esc(fmt.num(v, step < 1 ? 1 : 0))}%</text>`;
      }
      const bars = bins
        .map((b, i) => {
          const cls = b.hi <= 1e-12 ? "is-neg" : b.lo >= -1e-12 ? "is-pos" : "is-mix";
          const bx = ml + i * bw + 1;
          const hitH = ph;
          return `<g class="bt-hbin" data-lo="${b.lo}" data-hi="${b.hi}" data-n="${b.n}" data-win="${b.win}">
            <rect class="bt-hit" x="${ml + i * bw}" y="${mt}" width="${bw}" height="${hitH}"/>
            ${b.n ? `<path class="bt-hbar ${cls}" d="${barPath(bx, y(b.n), Math.max(1, bw - 2), mt + ph - y(b.n), 3)}"/>` : ""}
          </g>`;
        })
        .join("");
      const zx = x(0);
      const mx = x(mean);
      container.innerHTML = `<svg class="bt-hist" width="${w}" height="${H}" viewBox="0 0 ${w} ${H}" role="img" aria-label="Verdeling van trade-rendementen">
        ${grid}${bars}
        <line class="bt-hzero" x1="${zx}" x2="${zx}" y1="${mt - 4}" y2="${mt + ph}"/>
        <line class="bt-hmean" x1="${mx}" x2="${mx}" y1="${mt - 4}" y2="${mt + ph}"/>
        <text class="pn-axis bt-hmean-lbl" x="${Math.min(w - mr - 4, Math.max(ml + 4, mx))}" y="${mt - 6}" text-anchor="middle">gem. ${esc(fmt.pct(mean, 2))}</text>
        <line class="pn-axis-line" x1="${ml}" x2="${w - mr}" y1="${mt + ph}" y2="${mt + ph}"/>
        ${xl}
      </svg>`;
    });
    bindTip(container, ".bt-hbin", (g) => {
      const n = Number(g.dataset.n);
      const winN = Number(g.dataset.win);
      return `<b>${esc(fmt.pct(Number(g.dataset.lo), 1))} tot ${esc(fmt.pct(Number(g.dataset.hi), 1))}</b><br>${n} trade${n === 1 ? "" : "s"}${
        n ? ` · ${winN} winst / ${n - winN} verlies` : ""
      }`;
    });
  }

  function tradesTable(trades) {
    if (!trades?.length) return '<div class="pn-empty">Geen trades.</div>';
    const rows = trades.slice(0, 1000);
    return `<div class="bt-table-wrap"><table class="table bt-trades">
      <thead><tr><th>#</th><th>Instap</th><th>Uitstap</th><th class="r">Instapprijs</th><th class="r">Uitstapprijs</th>
        <th class="r">Resultaat</th><th class="r">€</th><th class="r" title="Winst in veelvouden van het risico">R</th><th>Reden uitstap</th><th class="r">Candles</th></tr></thead>
      <tbody>${rows
        .map(
          (t, i) => `<tr title="${esc(t.entryReason || "")}">
          <td class="muted">${i + 1}</td><td class="mono">${esc(fmt.dateTime(t.entryTime))}</td><td class="mono">${esc(fmt.dateTime(t.exitTime))}</td>
          <td class="r mono">${esc(fmt.price(t.entryPrice))}</td><td class="r mono">${esc(fmt.price(t.exitPrice))}</td>
          <td class="r mono ${fmt.pnlClass(t.pnlPct)}">${esc(fmt.pct(t.pnlPct, 2))}</td>
          <td class="r mono ${fmt.pnlClass(t.pnlQuote)}">${esc(fmt.eurSigned(t.pnlQuote))}</td>
          <td class="r mono ${fmt.pnlClass(t.rMultiple)}">${esc(fmt.num(t.rMultiple, 2))}</td>
          <td><span class="bt-exit" data-r="${esc(t.exitReason)}">${esc(fmt.exitReason(t.exitReason))}</span></td>
          <td class="r mono">${esc(fmt.num(t.candlesHeld, 0))}</td></tr>`,
        )
        .join("")}</tbody></table></div>
      ${trades.length > rows.length ? `<p class="pn-hint">Eerste ${rows.length} van ${trades.length} trades getoond.</p>` : ""}`;
  }

  function simWarning(isSim) {
    return isSim
      ? `<div class="pn-banner pn-banner-warn"><b>Gesimuleerde data.</b> Deze test gebruikt nagemaakte koersen (Bitvavo was niet bereikbaar of de simulator staat aan). De uitkomst zegt niets over de echte markt.</div>`
      : "";
  }

  // ── Backtest-weergave ──
  function renderBacktest({ res }) {
    const m = res.metrics || {};
    const trades = res.trades || [];
    const exitCounts = {};
    for (const t of trades) exitCounts[t.exitReason] = (exitCounts[t.exitReason] || 0) + 1;
    out.innerHTML = `
      <div class="bt-res-head">
        <h3>${esc(res.market)} <span class="muted">· ${esc(res.interval)}</span></h3>
        <div class="muted">${esc(fmt.date(res.from))} → ${esc(fmt.date(res.to))} · ${esc(fmt.num(res.candlesCount, 0))} candles · startkapitaal ${esc(fmt.eur(res.initialCapital))} · berekend in ${esc(fmt.duration(res.durationMs))}</div>
      </div>
      ${simWarning(res.dataSource === "simulated")}
      ${kpiCards(m, res.initialCapital)}
      <div class="panel bt-card">
        <div class="pn-head"><div class="panel-title">Koers &amp; trades</div>
          <div class="pn-legend"><span><i class="lg-arrow up"></i>koop</span><span><i class="lg-arrow down pos"></i>verkoop met winst</span><span><i class="lg-arrow down neg"></i>met verlies</span></div></div>
        <div class="bt-chart bt-chart-lg"></div>
      </div>
      <div class="panel bt-card">
        <div class="pn-head"><div class="panel-title">Equity vs. buy &amp; hold</div>
          <div class="pn-legend"><span><i class="lg-line acc"></i>Bot</span><span><i class="lg-line dash"></i>Buy &amp; hold</span><span><i class="lg-area neg"></i>Drawdown</span></div></div>
        <div class="bt-chart bt-chart-eq"></div>
        <p class="pn-hint">Ligt de blauwe lijn onder de stippellijn, dan had je beter gewoon kunnen kopen en vasthouden. Het rode vlak onderaan toont hoe diep je saldo tussentijds wegzakte.</p>
      </div>
      <div class="bt-2col">
        <div class="panel bt-card">
          <div class="pn-head"><div class="panel-title">Verdeling trade-resultaten</div><div class="pn-head-meta muted">${esc(fmt.num(trades.length, 0))} trades</div></div>
          <div class="bt-hist-wrap"></div>
          <div class="bt-mini-stats">
            <span>Beste <b class="pos mono">${esc(fmt.pct(m.bestTradePct, 2))}</b></span>
            <span>Slechtste <b class="neg mono">${esc(fmt.pct(m.worstTradePct, 2))}</b></span>
            <span>Verwachting <b class="mono ${fmt.pnlClass(m.expectancyQuote)}">${esc(fmt.eurSigned(m.expectancyQuote))}</b>/trade</span>
            <span>In de markt <b class="mono">${esc(fmt.pct(m.exposurePct, 0, false))}</b> v/d tijd</span>
          </div>
        </div>
        <div class="panel bt-card">
          <div class="pn-head"><div class="panel-title">Hoe werden trades gesloten?</div></div>
          <div class="bt-exits">${
            Object.keys(exitCounts).length
              ? Object.entries(exitCounts)
                  .sort((a, b) => b[1] - a[1])
                  .map(
                    ([r, c]) => `<div class="bt-exit-row"><span class="bt-exit" data-r="${esc(r)}">${esc(fmt.exitReason(r))}</span>
                      <span class="pn-bar"><i style="width:${((c / trades.length) * 100).toFixed(1)}%"></i></span><span class="mono">${c}</span></div>`,
                  )
                  .join("")
              : '<div class="pn-empty">Geen trades.</div>'
          }</div>
          <p class="pn-hint">Veel stop-losses en weinig take-profits? Dan is de instap te vroeg of de stop te krap.</p>
        </div>
      </div>
      <div class="panel bt-card">
        <div class="pn-head"><div class="panel-title">Alle trades</div></div>
        ${tradesTable(trades)}
      </div>`;
    candleChart(out.querySelector(".bt-chart-lg"), res.candles, res.markers?.length ? res.markers : tradesToMarkers(trades));
    equityChart(out.querySelector(".bt-chart-eq"), res.equityCurve, res.initialCapital);
    histogram(out.querySelector(".bt-hist-wrap"), trades);
  }

  function tradesToMarkers(trades) {
    const mk = [];
    for (const t of trades || []) {
      mk.push({ time: t.entryTime, action: "buy", price: t.entryPrice, score: 0, label: "KOOP" });
      mk.push({ time: t.exitTime, action: "sell", price: t.exitPrice, score: 0, label: `${t.pnlPct >= 0 ? "+" : ""}${fmt.num(t.pnlPct, 1)}%` });
    }
    return mk;
  }

  // ── Optimalisatie ──
  function paramChips(params) {
    return Object.entries(params || {})
      .map(([k, v]) => `<span class="pn-chip bt-pchip"><span class="muted">${esc(paramLabel(k))}</span> <b class="mono">${esc(fmtParam(v))}</b></span>`)
      .join("");
  }

  function renderOptimize({ req, res }) {
    const rows = (res.rows || []).slice(0, 20);
    const best = res.best || rows[0] || null;
    const obj = res.objective || req.objective;
    const maxScore = Math.max(...rows.map((r) => (Number.isFinite(r.score) ? Math.abs(Math.min(r.score, 999)) : 0)), 1e-9);
    const bm = best?.metrics;
    out.innerHTML = `
      <div class="bt-res-head">
        <h3>Optimalisatie <span class="muted">· ${esc(req.market)} · ${esc(req.interval)} · ${esc(String(req.days))} dagen</span></h3>
        <div class="muted">Doel: ${esc(OBJECTIVES[obj] || obj)} · ${esc(req.strategy ? `parameters van ${stratName(req.strategy)}` : "ensemble-drempels & risico")} · ${esc(fmt.num(res.combosTested, 0))} combinaties in ${esc(fmt.duration(res.durationMs))}</div>
      </div>
      ${simWarning(state.info?.dataSource === "simulated")}
      <div class="pn-banner pn-banner-warn"><b>Pas op voor overfitting.</b> De beste combinatie op het verleden is vaak deels toeval.
        Kies liever instellingen in een <i>breed</i> groen gebied van de heatmap en controleer ze met een walk-forward.</div>
      <div class="bt-opt-top">
        <div class="panel bt-card bt-best">
          <div class="pn-head"><div class="panel-title">Beste combinatie</div>
            ${best ? `<span class="pn-chip">${esc(OBJECTIVE_SHORT[obj] || obj)} <b class="mono">${esc(fmtScore(best.score, obj))}</b></span>` : ""}</div>
          ${
            best
              ? `<div class="bt-best-params">${paramChips(best.params)}</div>
                 <div class="bt-best-stats">
                   <div class="stat"><span class="stat-label">Rendement</span><span class="stat-value ${fmt.pnlClass(bm.totalReturnPct)}">${esc(fmt.pct(bm.totalReturnPct, 2))}</span></div>
                   <div class="stat"><span class="stat-label">Max. drawdown</span><span class="stat-value">${esc(fmt.pct(-Math.abs(bm.maxDrawdownPct), 1))}</span></div>
                   <div class="stat"><span class="stat-label">Trades</span><span class="stat-value">${esc(fmt.num(bm.trades, 0))}</span></div>
                   <div class="stat"><span class="stat-label">Winrate</span><span class="stat-value">${esc(fmt.pct(bm.winRatePct, 0, false))}</span></div>
                 </div>
                 ${bm.totalReturnPct <= 0 ? '<div class="pn-banner pn-banner-bad">Zelfs de beste combinatie verliest geld in deze periode. Niet toepassen.</div>' : ""}
                 ${bm.trades < 10 ? '<div class="pn-banner pn-banner-warn">Minder dan 10 trades: te weinig om op te vertrouwen.</div>' : ""}
                 <button type="button" class="btn btn-primary bt-apply" data-row="best">Pas beste instellingen toe</button>
                 <p class="pn-hint">Zet deze waarden in de bot (je krijgt eerst een overzicht ter bevestiging).</p>`
              : '<div class="pn-empty">Geen geldige combinaties gevonden.</div>'
          }
        </div>
        <div class="panel bt-card bt-hm-card">
          <div class="pn-head"><div class="panel-title">Heatmap</div><div class="pn-head-meta muted">kleur = ${esc(OBJECTIVE_SHORT[obj] || obj)}</div></div>
          <div class="bt-hm"></div>
          <div class="bt-hm-legend"></div>
        </div>
      </div>
      <div class="panel bt-card">
        <div class="pn-head"><div class="panel-title">Top ${rows.length} combinaties</div></div>
        <div class="bt-table-wrap"><table class="table bt-opt-table">
          <thead><tr><th>#</th><th>Parameters</th><th class="r">Score</th><th class="r">Rendement</th><th class="r">Max. DD</th><th class="r">Trades</th><th class="r">Winrate</th><th></th></tr></thead>
          <tbody>${rows
            .map(
              (r, i) => `<tr>
              <td class="muted">${i + 1}</td>
              <td><div class="bt-pchips">${paramChips(r.params)}</div></td>
              <td class="r"><div class="bt-score"><span class="bt-score-bar"><i class="${r.score >= (obj === "profitFactor" ? 1 : 0) ? "is-pos" : "is-neg"}" style="width:${((Math.abs(Math.min(r.score, 999)) / maxScore) * 100).toFixed(1)}%"></i></span><span class="mono">${esc(fmtScore(r.score, obj))}</span></div></td>
              <td class="r mono ${fmt.pnlClass(r.metrics?.totalReturnPct)}">${esc(fmt.pct(r.metrics?.totalReturnPct, 2))}</td>
              <td class="r mono">${esc(fmt.pct(-Math.abs(r.metrics?.maxDrawdownPct ?? NaN), 1))}</td>
              <td class="r mono">${esc(fmt.num(r.metrics?.trades, 0))}</td>
              <td class="r mono">${esc(fmt.pct(r.metrics?.winRatePct, 0, false))}</td>
              <td class="r"><button type="button" class="btn btn-ghost btn-sm bt-apply" data-row="${i}" title="Deze combinatie in de bot zetten">Toepassen</button></td></tr>`,
            )
            .join("")}</tbody></table></div>
      </div>`;
    for (const b of out.querySelectorAll(".bt-apply")) {
      b.addEventListener("click", () => {
        const row = b.dataset.row === "best" ? best : rows[Number(b.dataset.row)];
        if (row) confirmApply(row, req);
      });
    }
    heatmap(out.querySelector(".bt-hm"), out.querySelector(".bt-hm-legend"), res.heatmap, obj);
  }

  function heatmap(container, legend, hm, obj) {
    if (!hm || !hm.xValues?.length || !hm.yValues?.length) {
      container.innerHTML = '<div class="pn-empty">Geen heatmap: er werd maar één parameter gevarieerd.</div>';
      legend.innerHTML = "";
      return;
    }
    const pivot = obj === "profitFactor" ? 1 : 0;
    const cap = (v) => (obj === "profitFactor" ? Math.min(v, 5) : v);
    const vals = hm.values.flat().filter((v) => v !== null && Number.isFinite(v));
    const span = Math.max(1e-9, ...vals.map((v) => Math.abs(cap(v) - pivot)));
    const bestVal = vals.length ? Math.max(...vals) : null;
    const nx = hm.xValues.length;
    const ny = hm.yValues.length;
    const fill = (v) => {
      if (v === null || !Number.isFinite(v)) return "url(#bt-hatch)";
      const t = Math.max(-1, Math.min(1, (cap(v) - pivot) / span));
      const pct = Math.round(8 + Math.abs(t) * 72);
      return `color-mix(in srgb, var(${t >= 0 ? "--green" : "--red"}) ${pct}%, var(--panel-2))`;
    };
    responsive(container, (w) => {
      const ml = 72;
      const mr = 6;
      const mt = 6;
      const mb = 46;
      const cw = (w - ml - mr) / nx;
      const ch = Math.max(24, Math.min(44, cw * 0.62));
      const H = mt + ny * ch + mb;
      const showTxt = cw >= 36 && ch >= 22;
      let cells = "";
      for (let yi = 0; yi < ny; yi++) {
        for (let xi = 0; xi < nx; xi++) {
          const v = hm.values[yi]?.[xi] ?? null;
          const x = ml + xi * cw;
          const y = mt + (ny - 1 - yi) * ch;
          const isBest = v !== null && v === bestVal;
          cells += `<g class="bt-cell ${isBest ? "is-best" : ""}" data-x="${xi}" data-y="${yi}">
            <rect x="${x + 1}" y="${y + 1}" width="${Math.max(0, cw - 2)}" height="${Math.max(0, ch - 2)}" rx="3" style="fill:${fill(v)}"/>
            ${showTxt ? `<text x="${x + cw / 2}" y="${y + ch / 2 + 4}" text-anchor="middle" class="bt-cell-txt">${esc(v === null ? "–" : fmtScore(v, obj))}</text>` : ""}
          </g>`;
        }
      }
      const xEvery = Math.max(1, Math.ceil(40 / cw));
      const xl = hm.xValues
        .map((v, i) => (i % xEvery ? "" : `<text class="pn-axis" x="${ml + i * cw + cw / 2}" y="${mt + ny * ch + 15}" text-anchor="middle">${esc(fmtParam(v))}</text>`))
        .join("");
      const yEvery = Math.max(1, Math.ceil(16 / ch));
      const yl = hm.yValues
        .map((v, i) => (i % yEvery ? "" : `<text class="pn-axis" x="${ml - 8}" y="${mt + (ny - 1 - i) * ch + ch / 2 + 4}" text-anchor="end">${esc(fmtParam(v))}</text>`))
        .join("");
      container.innerHTML = `<svg class="bt-hm-svg" width="${w}" height="${H}" viewBox="0 0 ${w} ${H}" role="img" aria-label="Heatmap van de optimalisatie">
        <defs><pattern id="bt-hatch" width="6" height="6" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
          <rect width="6" height="6" class="bt-hatch-bg"/><line x1="0" y1="0" x2="0" y2="6" class="bt-hatch-line"/></pattern></defs>
        ${cells}${xl}${yl}
        <text class="pn-axis pn-axis-title" x="${ml + (w - ml - mr) / 2}" y="${H - 6}" text-anchor="middle">${esc(paramLabel(hm.xParam))} →</text>
        <text class="pn-axis pn-axis-title" transform="translate(12 ${mt + (ny * ch) / 2}) rotate(-90)" text-anchor="middle">${esc(paramLabel(hm.yParam))} →</text>
      </svg>`;
    });
    bindTip(container, ".bt-cell", (g) => {
      const xi = Number(g.dataset.x);
      const yi = Number(g.dataset.y);
      const v = hm.values[yi]?.[xi] ?? null;
      return `${esc(paramLabel(hm.xParam))}: <b>${esc(fmtParam(hm.xValues[xi]))}</b><br>${esc(paramLabel(hm.yParam))}: <b>${esc(fmtParam(hm.yValues[yi]))}</b><br>` +
        (v === null ? '<span class="muted">niet getest</span>' : `${esc(OBJECTIVE_SHORT[obj] || obj)}: <b>${esc(fmtScore(v, obj))}</b>${v === bestVal ? " ★ beste" : ""}`);
    });
    const lo = pivot - span;
    const hi = pivot + span;
    legend.innerHTML = `<span class="mono">${esc(fmtScore(lo, obj))}</span><span class="bt-hm-grad"></span><span class="mono">${esc(fmtScore(hi, obj))}</span>
      <span class="muted bt-hm-legend-txt">rood = slecht · grijs = neutraal (${esc(fmtScore(pivot, obj))}) · groen = goed · gearceerd = niet getest · wit kader = beste</span>`;
  }

  // ── Toepassen van parameters ──
  function paramsToPartial(params, cfg) {
    const partial = {};
    const ids = new Set(state.strategies.map((s) => s.id));
    for (const [key, value] of Object.entries(params || {})) {
      const i = key.indexOf(".");
      if (i < 0) continue;
      const head = key.slice(0, i);
      const rest = key.slice(i + 1);
      if (head === "ensemble") {
        partial.ensemble ??= {};
        if (rest.startsWith("weights.")) {
          partial.ensemble.weights ??= { ...(cfg?.ensemble?.weights || {}) };
          partial.ensemble.weights[rest.slice(8)] = value;
        } else partial.ensemble[rest] = value;
      } else if (head === "risk") {
        partial.risk ??= {};
        partial.risk[rest] = value;
      } else if (ids.has(head)) {
        partial.ensemble ??= {};
        partial.ensemble.params ??= JSON.parse(JSON.stringify(cfg?.ensemble?.params || {}));
        partial.ensemble.params[head] = { ...(partial.ensemble.params[head] || {}), [rest]: value };
      }
    }
    return partial;
  }

  function currentValue(key, cfg) {
    const i = key.indexOf(".");
    const head = key.slice(0, i);
    const rest = key.slice(i + 1);
    if (head === "ensemble") {
      if (rest.startsWith("weights.")) return cfg?.ensemble?.weights?.[rest.slice(8)];
      return cfg?.ensemble?.[rest];
    }
    if (head === "risk") return cfg?.risk?.[rest];
    const p = cfg?.ensemble?.params?.[head]?.[rest];
    if (p !== undefined) return p;
    return state.strategies.find((s) => s.id === head)?.defaultParams?.[rest];
  }

  async function confirmApply(row, req) {
    let cfg = state.config;
    try {
      cfg = await api.getConfig();
      state.config = cfg;
    } catch {
      /* gebruik bekende config */
    }
    const partial = paramsToPartial(row.params, cfg);
    if (!partial.ensemble && !partial.risk) {
      ctx.toast("Deze parameters kunnen niet automatisch worden toegepast.", "warn");
      return;
    }
    const lines = Object.entries(row.params)
      .map(([k, v]) => {
        const cur = currentValue(k, cfg);
        const same = cur === v;
        return `<tr><td>${esc(paramLabel(k))}</td><td class="mono r">${esc(cur === undefined ? "–" : fmtParam(cur))}</td>
          <td class="mono r ${same ? "muted" : ""}"><b>${esc(fmtParam(v))}</b></td></tr>`;
      })
      .join("");
    const warn = [];
    if (cfg && req.interval !== cfg.interval)
      warn.push(`De bot draait op interval <b>${esc(cfg.interval)}</b>, maar deze waarden zijn getest op <b>${esc(req.interval)}</b>.`);
    if (cfg && !cfg.markets?.includes(req.market))
      warn.push(`<b>${esc(req.market)}</b> staat niet in de markten van de bot.`);
    if (row.metrics?.totalReturnPct <= 0) warn.push("Deze combinatie was verliesgevend in de test.");
    const bodyHtml = `
      <p>De volgende instellingen worden in de bot gezet:</p>
      <table class="table bt-apply-table"><thead><tr><th>Instelling</th><th class="r">Nu</th><th class="r">Nieuw</th></tr></thead><tbody>${lines}</tbody></table>
      ${warn.length ? `<div class="pn-banner pn-banner-warn"><ul>${warn.map((w) => `<li>${w}</li>`).join("")}</ul></div>` : ""}
      <p class="pn-hint">Getest op ${esc(req.market)} · ${esc(req.interval)} · ${esc(String(req.days))} dagen. ${esc(HONEST_NOTE)} Test nieuwe instellingen eerst een tijd met paper trading.</p>`;
    ctx.openModal({
      title: "Instellingen toepassen?",
      bodyHtml,
      confirmText: "Toepassen",
      cancelText: "Annuleren",
      onConfirm: async () => {
        try {
          const next = await api.putConfig(partial);
          state.config = next;
          bus.emit("config-changed", next);
          fillAdvanced(next);
          ctx.toast("Instellingen toegepast op de bot.", "success");
        } catch (err) {
          ctx.toast(`Toepassen mislukt: ${err?.message || err}`, "error");
          return false;
        }
        return true;
      },
    });
  }

  // ── Walk-forward ──
  function verdictLevel(v) {
    const s = String(v || "").toLowerCase();
    if (/niet live|verlies|verliesgevend|negatief|overfit/.test(s)) return "bad";
    if (/robuust/.test(s)) return "good";
    return "warn";
  }

  function renderWalkForward({ req, res }) {
    const folds = res.folds || [];
    const lv = verdictLevel(res.verdict);
    const icon =
      lv === "good"
        ? '<polyline points="3,8 6.5,11 12,4"/>'
        : lv === "bad"
          ? '<line x1="4" y1="4" x2="11" y2="11"/><line x1="11" y1="4" x2="4" y2="11"/>'
          : '<line x1="7.5" y1="3.5" x2="7.5" y2="8.5"/><circle cx="7.5" cy="11.2" r=".6"/>';
    const initial = req.initialCapital || 50;
    out.innerHTML = `
      <div class="bt-res-head">
        <h3>Walk-forward <span class="muted">· ${esc(req.market)} · ${esc(req.interval)} · ${esc(String(req.days))} dagen</span></h3>
        <div class="muted">${esc(String(folds.length))} folds · ${esc(fmt.num(req.trainRatio * 100, 0))}% train / ${esc(fmt.num((1 - req.trainRatio) * 100, 0))}% test · doel ${esc(OBJECTIVE_SHORT[req.objective] || req.objective)} · berekend in ${esc(fmt.duration(res.durationMs))}</div>
      </div>
      <div class="bt-verdict" data-lv="${lv}" role="status">
        <svg class="bt-verdict-ico" viewBox="0 0 15 15" aria-hidden="true">${icon}</svg>
        <div><div class="bt-verdict-lbl">Oordeel</div><div class="bt-verdict-txt">${esc(res.verdict || "Geen oordeel beschikbaar.")}</div></div>
      </div>
      ${simWarning(state.info?.dataSource === "simulated")}
      <h4 class="bt-subh">Out-of-sample resultaat <span class="muted">— alle testperiodes aan elkaar geplakt (de instellingen kenden deze data niet)</span></h4>
      ${kpiCards(res.oosMetrics, initial)}
      <div class="bt-2col">
        <div class="panel bt-card">
          <div class="pn-head"><div class="panel-title">Train vs. test per fold</div>
            <div class="pn-legend"><span><i class="lg-box muted-box"></i>train (in-sample)</span><span><i class="lg-box acc-box"></i>test (out-of-sample)</span></div></div>
          <div class="bt-folds-chart"></div>
          <p class="pn-hint">Is het test-rendement veel lager dan het train-rendement? Dan zijn de instellingen 'overfit': ze passen op het verleden, niet op de toekomst.</p>
        </div>
        <div class="panel bt-card">
          <div class="pn-head"><div class="panel-title">Folds</div></div>
          <div class="bt-table-wrap"><table class="table bt-folds">
            <thead><tr><th>#</th><th>Testperiode</th><th class="r">Train</th><th class="r">Test</th><th class="r">Test DD</th><th class="r">Trades</th><th>Beste parameters</th></tr></thead>
            <tbody>${folds
              .map(
                (f) => `<tr>
                <td class="muted">${f.index + 1}</td>
                <td class="mono" title="Train: ${esc(fmt.date(f.trainFrom))} → ${esc(fmt.date(f.trainTo))}">${esc(fmt.date(f.testFrom))} → ${esc(fmt.date(f.testTo))}</td>
                <td class="r mono ${fmt.pnlClass(f.trainMetrics?.totalReturnPct)}">${esc(fmt.pct(f.trainMetrics?.totalReturnPct, 2))}</td>
                <td class="r mono ${fmt.pnlClass(f.testMetrics?.totalReturnPct)}"><b>${esc(fmt.pct(f.testMetrics?.totalReturnPct, 2))}</b></td>
                <td class="r mono">${esc(fmt.pct(-Math.abs(f.testMetrics?.maxDrawdownPct ?? NaN), 1))}</td>
                <td class="r mono">${esc(fmt.num(f.testMetrics?.trades, 0))}</td>
                <td><div class="bt-pchips">${paramChips(f.bestParams)}</div></td></tr>`,
              )
              .join("")}</tbody></table></div>
        </div>
      </div>
      <div class="panel bt-card">
        <div class="pn-head"><div class="panel-title">Out-of-sample equity (aan elkaar geplakt)</div>
          <div class="pn-legend"><span><i class="lg-line acc"></i>Bot</span><span><i class="lg-line dash"></i>Buy &amp; hold</span><span><i class="lg-area neg"></i>Drawdown</span></div></div>
        <div class="bt-chart bt-chart-eq"></div>
      </div>
      <details class="pn-help"><summary>Wat is walk-forward?</summary>
        <p>De data wordt opgeknipt in ${esc(String(folds.length))} vensters. In elk venster zoekt de optimizer de beste instellingen op het
        <b>train-deel</b> en test ze daarna op het <b>test-deel</b> dat direct volgt. Dat lijkt op echt handelen: je kiest instellingen op basis van het
        verleden en ziet pas daarna hoe de toekomst uitpakt. Alleen het out-of-sample resultaat is een eerlijke schatting.</p></details>`;
    foldsChart(out.querySelector(".bt-folds-chart"), folds);
    equityChart(out.querySelector(".bt-chart-eq"), res.oosEquityCurve, initial);
  }

  function foldsChart(container, folds) {
    if (!folds.length) {
      container.innerHTML = '<div class="pn-empty">Geen folds.</div>';
      return;
    }
    const tr = folds.map((f) => Number(f.trainMetrics?.totalReturnPct) || 0);
    const te = folds.map((f) => Number(f.testMetrics?.totalReturnPct) || 0);
    responsive(container, (w) => {
      const H = 210;
      const ml = 40;
      const mr = 8;
      const mt = 12;
      const mb = 26;
      const all = tr.concat(te, [0]);
      let lo = Math.min(...all);
      let hi = Math.max(...all);
      if (hi - lo < 1) {
        hi += 0.5;
        lo -= 0.5;
      }
      const step = niceStep((hi - lo) / 4);
      lo = Math.floor(lo / step) * step;
      hi = Math.ceil(hi / step) * step;
      const ph = H - mt - mb;
      const y = (v) => mt + ((hi - v) / (hi - lo)) * ph;
      const gw = (w - ml - mr) / folds.length;
      const bw = Math.min(28, (gw - 14) / 2);
      let grid = "";
      for (let v = lo; v <= hi + 1e-9; v += step) {
        grid += `<line class="pn-grid" x1="${ml}" x2="${w - mr}" y1="${y(v)}" y2="${y(v)}"/><text class="pn-axis" x="${ml - 6}" y="${y(v) + 3}" text-anchor="end">${esc(fmt.num(v, step < 1 ? 1 : 0))}%</text>`;
      }
      const bar = (v, x, cls, label, i) => {
        const y0 = y(0);
        const y1 = y(v);
        const top = Math.min(y0, y1);
        const h = Math.max(1, Math.abs(y1 - y0));
        return `<g class="bt-fbar" data-i="${i}" data-k="${label}"><rect class="bt-hit" x="${x - 3}" y="${mt}" width="${bw + 6}" height="${ph}"/>
          <rect class="${cls} ${v >= 0 ? "is-pos" : "is-neg"}" x="${x}" y="${top}" width="${bw}" height="${h}" rx="2"/></g>`;
      };
      let bars = "";
      let xl = "";
      folds.forEach((f, i) => {
        const cx = ml + gw * i + gw / 2;
        bars += bar(tr[i], cx - bw - 1, "bt-fb-train", "train", i) + bar(te[i], cx + 1, "bt-fb-test", "test", i);
        xl += `<text class="pn-axis" x="${cx}" y="${H - 8}" text-anchor="middle">Fold ${f.index + 1}</text>`;
      });
      container.innerHTML = `<svg width="${w}" height="${H}" viewBox="0 0 ${w} ${H}" role="img" aria-label="Train- en testrendement per fold">
        ${grid}<line class="bt-hzero" x1="${ml}" x2="${w - mr}" y1="${y(0)}" y2="${y(0)}"/>${bars}${xl}</svg>`;
    });
    bindTip(container, ".bt-fbar", (g) => {
      const f = folds[Number(g.dataset.i)];
      const isTest = g.dataset.k === "test";
      const m = isTest ? f.testMetrics : f.trainMetrics;
      return `<b>Fold ${f.index + 1} · ${isTest ? "test (out-of-sample)" : "train (in-sample)"}</b><br>
        ${esc(fmt.date(isTest ? f.testFrom : f.trainFrom))} → ${esc(fmt.date(isTest ? f.testTo : f.trainTo))}<br>
        Rendement <b>${esc(fmt.pct(m?.totalReturnPct, 2))}</b> · DD ${esc(fmt.pct(-Math.abs(m?.maxDrawdownPct ?? NaN), 1))} · ${esc(fmt.num(m?.trades, 0))} trades`;
    });
  }

  // ── Events ──
  form.addEventListener("submit", (e) => {
    e.preventDefault();
    run("backtest");
  });
  for (const b of form.querySelectorAll('.bt-run[data-run]:not([type="submit"])')) {
    b.addEventListener("click", () => run(b.dataset.run));
  }
  form.addEventListener("input", (e) => {
    if (["days", "interval", "folds", "trainRatio"].includes(e.target.name)) updateEstimate();
  });
  form.addEventListener("change", (e) => {
    if (e.target.name === "interval") updateEstimate();
  });
  $(".bt-adv-reset").addEventListener("click", () => {
    fillAdvanced(state.config);
    ctx.toast("Geavanceerde velden gelijkgezet aan de huidige bot-instellingen.", "info");
  });
  rtabs.addEventListener("click", (e) => {
    const b = e.target.closest("[data-view]");
    if (b && b.dataset.view !== state.view) showView(b.dataset.view);
  });

  bus.on("config-changed", (c) => {
    if (c) state.config = c;
  });
  bus.on("snapshot", (s) => {
    if (s?.config && !state.config) {
      state.config = s.config;
      fillSelects();
    }
  });
  bus.on("tab-changed", () => {
    for (const c of state.charts) {
      try {
        c.timeScale().fitContent();
      } catch {
        /* chart weg */
      }
    }
  });

  renderEmpty();
  updateEstimate();
  fillAdvanced(state.config);

  Promise.allSettled([api.getMarkets(), api.getStrategies(), api.getConfig(), api.info()]).then(([mk, st, cf, inf]) => {
    if (mk.status === "fulfilled" && Array.isArray(mk.value)) state.markets = mk.value;
    if (st.status === "fulfilled" && Array.isArray(st.value) && st.value.length) state.strategies = st.value;
    if (cf.status === "fulfilled" && cf.value) state.config = cf.value;
    if (inf.status === "fulfilled") state.info = inf.value;
    if (mk.status === "rejected") ctx.toast(`Markten laden mislukt: ${mk.reason?.message || mk.reason}`, "error");
    fillSelects();
  });
}
