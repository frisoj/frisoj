// Instellingen: markten & interval, risicobeheer, strategieën, live trading
// (armen/ontwapenen) en het dashboard-token. Opslaan via PUT /api/config.

import { setToken } from "../api.js";

const TOKEN_KEY = "bvt-dashboard-token";
const ARM_TEXT = "IK BEGRIJP HET RISICO";
const MAX_MARKETS = 8;
const INTERVALS = ["1m", "5m", "15m", "30m", "1h", "2h", "4h", "6h", "8h", "12h", "1d"];

// Kopie van src/core/defaults.ts (DEFAULT_ENGINE_CONFIG) voor "Standaardwaarden"
const DEFAULTS = {
  markets: ["BTC-EUR", "ETH-EUR", "SOL-EUR"],
  interval: "15m",
  pollMs: 15000,
  historyCandles: 300,
  ensemble: {
    enabled: ["ema-trend", "rsi-reversion", "breakout", "macd-momentum", "vwap-reversion"],
    weights: { "ema-trend": 1.2, "rsi-reversion": 1, breakout: 1, "macd-momentum": 1, "vwap-reversion": 0.8 },
    params: {},
    buyThreshold: 0.35,
    sellThreshold: -0.3,
    regimeFilter: true,
  },
  risk: {
    riskPerTradePct: 1.5,
    maxPositionPct: 45,
    maxOpenPositions: 2,
    maxTotalExposurePct: 90,
    stopAtrMult: 2,
    takeProfitR: 2,
    trailingAtrMult: 2.5,
    breakEvenAtR: 1,
    dailyLossLimitPct: 5,
    maxTradesPerDay: 6,
    cooldownCandlesAfterLoss: 4,
    minEdgeFeeMultiple: 3,
    takerFee: 0.0025,
    makerFee: 0.0015,
    slippagePct: 0.0005,
    minOrderQuote: 5,
    timeStopCandles: 48,
  },
};

const FALLBACK_STRATEGIES = [
  { id: "ema-trend", name: "EMA-trend", description: "Volgt de trend met twee voortschrijdende gemiddelden.", preferredRegimes: ["trend-up"] },
  { id: "rsi-reversion", name: "RSI-omkeer", description: "Koopt na een te sterke daling (RSI laag).", preferredRegimes: ["range"] },
  { id: "breakout", name: "Uitbraak", description: "Koopt als de koers boven een recent hoogtepunt uitbreekt.", preferredRegimes: ["trend-up", "volatile"] },
  { id: "macd-momentum", name: "MACD-momentum", description: "Koopt als het momentum toeneemt.", preferredRegimes: ["trend-up"] },
  { id: "vwap-reversion", name: "VWAP-omkeer", description: "Koopt ver onder de gemiddelde handelsprijs van de dag.", preferredRegimes: ["range"] },
];

// Alle RiskConfig-velden met Nederlandse uitleg. scale = weergavefactor (fractie → %).
const RISK_GROUPS = [
  {
    title: "Positiegrootte",
    fields: [
      { key: "riskPerTradePct", label: "Risico per trade", unit: "%", step: 0.1, min: 0.1, max: 10,
        help: "Hoeveel % van je saldo je maximaal verliest als de stop-loss geraakt wordt. 1–2% is gebruikelijk." },
      { key: "maxPositionPct", label: "Max. positiegrootte", unit: "%", step: 5, min: 1, max: 100,
        help: "Maximaal deel van je saldo in één positie." },
      { key: "maxOpenPositions", label: "Max. open posities", unit: "stuks", step: 1, min: 1, max: 10, int: true,
        help: "Hoeveel posities er tegelijk open mogen staan. Met €50 zijn 1–2 posities realistisch (min. order €5)." },
      { key: "maxTotalExposurePct", label: "Max. totale blootstelling", unit: "%", step: 5, min: 1, max: 100,
        help: "Maximaal deel van je saldo dat in alle posities samen zit; de rest blijft in euro's." },
      { key: "minOrderQuote", label: "Minimale ordergrootte", unit: "€", step: 1, min: 0, max: 100000,
        help: "Bitvavo accepteert geen orders onder €5. Kleinere orders slaat de bot over." },
    ],
  },
  {
    title: "Stop-loss & winst nemen",
    fields: [
      { key: "stopAtrMult", label: "Stop-loss afstand", unit: "× ATR", step: 0.1, min: 0.5, max: 10,
        help: "De stop ligt zoveel keer de gemiddelde candle-beweging (ATR) onder je instap. Groter = meer ademruimte, maar groter verlies per keer." },
      { key: "takeProfitR", label: "Winstdoel", unit: "R", step: 0.1, min: 0.5, max: 10,
        help: "Take-profit op zoveel keer je risico (R). 2R = je mikt op twee keer zoveel winst als je riskeert." },
      { key: "trailingAtrMult", label: "Trailing stop", unit: "× ATR", step: 0.1, min: 0, max: 10, zeroOff: true,
        help: "De stop schuift mee omhoog, op deze afstand onder de hoogste koers. 0 = uit." },
      { key: "breakEvenAtR", label: "Break-even vanaf", unit: "R", step: 0.1, min: 0, max: 5, zeroOff: true,
        help: "Zet de stop op instap + kosten zodra je deze winst hebt, zodat een winnaar geen verliezer meer wordt. 0 = uit." },
      { key: "timeStopCandles", label: "Tijdslimiet", unit: "candles", step: 1, min: 0, max: 10000, int: true, zeroOff: true,
        help: "Sluit een positie na zoveel candles als hij niet in de winst staat. 0 = uit." },
    ],
  },
  {
    title: "Dagelijkse limieten",
    fields: [
      { key: "dailyLossLimitPct", label: "Max. dagverlies", unit: "%", step: 0.5, min: 0.5, max: 50,
        help: "Verlies je vandaag dit % van je saldo, dan stopt de bot met nieuwe trades tot morgen." },
      { key: "maxTradesPerDay", label: "Max. trades per dag", unit: "trades", step: 1, min: 1, max: 100, int: true,
        help: "Voorkomt overtraden: elke trade kost fees." },
      { key: "cooldownCandlesAfterLoss", label: "Afkoelperiode na verlies", unit: "candles", step: 1, min: 0, max: 500, int: true,
        help: "Na een verliestrade zoveel candles niet opnieuw instappen in dezelfde markt (tegen 'revenge trading')." },
    ],
  },
  {
    title: "Kosten",
    fields: [
      { key: "takerFee", label: "Taker fee", unit: "%", scale: 100, step: 0.01, min: 0, max: 1,
        help: "Bitvavo-fee voor market orders (standaard 0,25%). Je betaalt hem bij kopen én verkopen." },
      { key: "makerFee", label: "Maker fee", unit: "%", scale: 100, step: 0.01, min: 0, max: 1,
        help: "Fee voor limit orders die in het orderboek blijven staan (standaard 0,15%)." },
      { key: "slippagePct", label: "Slippage", unit: "%", scale: 100, step: 0.01, min: 0, max: 2,
        help: "Verwacht verschil tussen de koers en je werkelijke vulprijs, per kant." },
      { key: "minEdgeFeeMultiple", label: "Min. winstruimte", unit: "× kosten", step: 0.5, min: 0, max: 20,
        help: "Het winstdoel moet minstens zoveel keer de totale kosten zijn, anders slaat de bot de trade over." },
    ],
  },
];

const INTERVAL_HELP = {
  "1m": "Zeer kort: veel ruis, veel trades en veel fees. Niet aan te raden met €50.",
  "5m": "Kort: veel signalen, maar fees wegen zwaar bij een klein account.",
  "15m": "Goede balans voor daytrading (aanbevolen om mee te beginnen).",
  "30m": "Rustig daytraden: minder trades, betrouwbaardere signalen.",
  "1h": "Rustiger: minder trades en fees, signalen zijn betrouwbaarder.",
  "2h": "Rustig: enkele trades per dag of minder.",
  "4h": "Swing trading: posities staan vaak een of meer dagen open.",
  "6h": "Swing trading: weinig trades per week.",
  "8h": "Swing trading: weinig trades per week.",
  "12h": "Langzaam: slechts enkele signalen per maand.",
  "1d": "Zeer langzaam: dagcandles, weinig signalen.",
};

const POPULAR = ["BTC", "ETH", "SOL", "XRP", "ADA", "DOGE", "LINK", "DOT", "AVAX", "LTC", "TRX", "MATIC", "POL", "SHIB", "UNI", "ATOM", "NEAR", "BCH", "XLM"];

function ensureCss() {
  if (document.querySelector('link[href$="panels.css"]')) return;
  const l = document.createElement("link");
  l.rel = "stylesheet";
  l.href = new URL("../../css/panels.css", import.meta.url).href;
  document.head.append(l);
}

const clone = (o) => JSON.parse(JSON.stringify(o ?? null));
function stable(o) {
  if (Array.isArray(o)) return `[${o.map(stable).join(",")}]`;
  if (o && typeof o === "object") return `{${Object.keys(o).sort().map((k) => `${JSON.stringify(k)}:${stable(o[k])}`).join(",")}}`;
  return JSON.stringify(o);
}
function getPath(o, path) {
  return path.split(".").reduce((a, k) => (a == null ? undefined : a[k]), o);
}
function setPath(o, path, v) {
  const ks = path.split(".");
  let cur = o;
  for (let i = 0; i < ks.length - 1; i++) {
    if (cur[ks[i]] == null || typeof cur[ks[i]] !== "object") cur[ks[i]] = {};
    cur = cur[ks[i]];
  }
  cur[ks[ks.length - 1]] = v;
}
const round = (v, d = 8) => (Number.isFinite(v) ? Number(v.toFixed(d)) : v);
const parseNum = (s) => {
  const n = Number(String(s).trim().replace(",", "."));
  return String(s).trim() === "" ? NaN : n;
};

export function mountSettings(ctx, el) {
  ensureCss();
  const { fmt, esc, api, bus } = ctx;
  if (!el) return;
  el.classList.add("st");

  const state = {
    server: null,
    draft: null,
    strategies: FALLBACK_STRATEGIES,
    info: ctx.getInfo?.() || null,
    markets: [],
    marketsError: null,
    errors: [],
    invalid: new Set(),
    saving: false,
    search: "",
    loaded: false,
  };

  el.innerHTML = `<div class="panel st-loading"><span class="spinner"></span> Instellingen laden…</div>`;

  const dirty = () => state.server && state.draft && stable(normalize(state.draft)) !== stable(normalize(state.server));
  function normalize(c) {
    return {
      markets: c.markets,
      interval: c.interval,
      pollMs: c.pollMs,
      historyCandles: c.historyCandles,
      ensemble: {
        enabled: [...(c.ensemble?.enabled || [])].sort(),
        weights: c.ensemble?.weights || {},
        params: c.ensemble?.params || {},
        buyThreshold: c.ensemble?.buyThreshold,
        sellThreshold: c.ensemble?.sellThreshold,
        regimeFilter: c.ensemble?.regimeFilter,
      },
      risk: c.risk,
    };
  }

  // ── Opbouw ──
  function numField({ path, key, label, unit, step, min, max, scale = 1, help, zeroOff }) {
    const raw = getPath(state.draft, path);
    const shown = Number.isFinite(raw) ? round(raw * scale, 6) : "";
    const id = `st-${path.replace(/\./g, "-")}`;
    return `<div class="st-field ${state.invalid.has(path) ? "is-invalid" : ""}" data-field="${esc(path)}">
      <label for="${id}">${esc(label)}${zeroOff ? ' <span class="muted st-off">0 = uit</span>' : ""}</label>
      <div class="st-input-wrap">
        <input id="${id}" class="input mono ${state.invalid.has(path) ? "invalid" : ""}" type="number" inputmode="decimal"
          data-path="${esc(path)}" data-key="${esc(key || path.split(".").pop())}" data-scale="${scale}"
          step="${step}" ${min !== undefined ? `min="${min}"` : ""} ${max !== undefined ? `max="${max}"` : ""} value="${esc(String(shown))}">
        <span class="st-unit">${esc(unit || "")}</span>
      </div>
      <div class="st-help">${esc(help || "")}</div>
    </div>`;
  }

  function renderAll() {
    if (!state.draft) return;
    const d = state.draft;
    el.innerHTML = `
      <div class="panel st-top">
        <div>
          <div class="panel-title">Instellingen</div>
          <p class="pn-hint">Pas aan hoe de bot handelt. Wijzigingen gelden pas na <b>Opslaan</b> en worden bewaard in <span class="mono">data/config.json</span>.</p>
        </div>
        <div class="st-top-actions">
          <button type="button" class="btn btn-ghost" data-act="defaults" title="Vul de fabrieksinstellingen in (nog niet opgeslagen)">↺ Standaardwaarden</button>
          <button type="button" class="btn btn-ghost" data-act="discard">Wijzigingen ongedaan maken</button>
          <button type="button" class="btn btn-primary" data-act="save">Opslaan</button>
        </div>
      </div>
      <div class="st-errors" hidden></div>
      <div class="st-grid">
        <div class="st-col">
          <section class="panel st-sec st-sec-markets">
            <div class="pn-head"><div class="panel-title">Markten &amp; interval</div><span class="pn-chip st-mcount"></span></div>
            <div class="st-markets"></div>
            <div class="bt-row2 st-row2">
              <div class="st-field" data-field="interval">
                <label for="st-interval">Candle-interval</label>
                <div class="st-input-wrap"><select id="st-interval" class="select" data-path="interval">
                  ${INTERVALS.map((iv) => `<option value="${iv}" ${d.interval === iv ? "selected" : ""}>${iv}</option>`).join("")}
                </select></div>
                <div class="st-help st-interval-help">${esc(INTERVAL_HELP[d.interval] || "")}</div>
              </div>
              ${numField({ path: "pollMs", key: "pollMs", label: "Ververs elke", unit: "sec", step: 1, min: 5, max: 300, scale: 0.001,
                help: "Hoe vaak de bot koersen ophaalt en stops controleert." })}
            </div>
            ${numField({ path: "historyCandles", key: "historyCandles", label: "Historie per analyse", unit: "candles", step: 50, min: 100, max: 1000,
              help: "Aantal candles dat de strategieën per keer bekijken. Minimaal ~250 zodat ook de EMA 200 klopt." })}
          </section>

          <section class="panel st-sec st-sec-strats">
            <div class="pn-head"><div class="panel-title">Strategieën</div></div>
            <p class="pn-hint">Elke strategie stemt KOOP / VERKOOP / WACHT. Het <b>gewicht</b> bepaalt hoe zwaar die stem telt in de totale score (−1 … +1).</p>
            <div class="st-thresholds"></div>
            <div class="st-strats"></div>
          </section>
        </div>
        <div class="st-col">
          <section class="panel st-sec st-sec-risk">
            <div class="pn-head"><div class="panel-title">Risicobeheer</div></div>
            <div class="st-risk-example"></div>
            ${RISK_GROUPS.map(
              (g) => `<div class="st-group"><div class="st-group-title">${esc(g.title)}</div>
                <div class="st-fields">${g.fields.map((f) => numField({ ...f, path: `risk.${f.key}` })).join("")}</div></div>`,
            ).join("")}
          </section>
          <section class="panel st-sec st-sec-live"></section>
          <section class="panel st-sec st-sec-token"></section>
        </div>
      </div>
      <div class="st-savebar" hidden>
        <span class="st-savebar-dot"></span><span class="st-savebar-txt">Je hebt niet-opgeslagen wijzigingen</span>
        <button type="button" class="btn btn-ghost" data-act="discard">Annuleren</button>
        <button type="button" class="btn btn-primary" data-act="save">Opslaan</button>
      </div>`;
    renderMarkets();
    renderThresholds();
    renderStrategies();
    renderRiskExample();
    renderLive();
    renderToken();
    renderErrors();
    updateDirty();
  }

  function renderMarkets() {
    const box = el.querySelector(".st-markets");
    if (!box) return;
    const sel = state.draft.markets || [];
    el.querySelector(".st-mcount").innerHTML = `<b class="mono">${sel.length}</b>/${MAX_MARKETS}`;
    const all = state.markets.map((m) => m.market);
    const q = state.search.trim().toUpperCase();
    const rank = (m) => {
      const i = POPULAR.indexOf(m.split("-")[0]);
      return i < 0 ? 999 : i;
    };
    const avail = all
      .filter((m) => !sel.includes(m) && (!q || m.includes(q)))
      .sort((a, b) => rank(a) - rank(b) || a.localeCompare(b));
    const shown = avail.slice(0, q ? 60 : 24);
    const full = sel.length >= MAX_MARKETS;
    box.innerHTML = `
      <div class="st-field ${state.invalid.has("markets") ? "is-invalid" : ""}" data-field="markets">
        <label>Markten waarop de bot handelt</label>
        <div class="st-msel">${
          sel.length
            ? sel.map((m) => `<span class="st-mchip"><b>${esc(m.split("-")[0])}</b><span class="muted">-EUR</span>
                <button type="button" data-remove="${esc(m)}" aria-label="${esc(m)} verwijderen" title="Verwijderen">×</button></span>`).join("")
            : '<span class="neg">Kies minstens één markt.</span>'
        }</div>
        <div class="st-help">Maximaal ${MAX_MARKETS}. Met een klein saldo zijn 2–4 liquide markten (BTC, ETH, SOL) verstandig: minder spreiding van je €5-orders.</div>
      </div>
      <div class="st-madd">
        <input class="input st-msearch" type="search" placeholder="Zoek markt om toe te voegen…" value="${esc(state.search)}" aria-label="Zoek markt">
        <div class="st-mavail ${full ? "is-full" : ""}">${
          state.marketsError
            ? `<span class="neg">Markten laden mislukt: ${esc(state.marketsError)}</span>`
            : shown.map((m) => `<button type="button" class="st-mopt" data-add="${esc(m)}" ${full ? "disabled" : ""}>+ ${esc(m.split("-")[0])}</button>`).join("") +
              (avail.length > shown.length ? `<span class="muted st-more">+${avail.length - shown.length} meer — typ om te zoeken</span>` : "") +
              (!avail.length ? '<span class="muted">Geen markten gevonden.</span>' : "")
        }</div>
      </div>`;
    const input = box.querySelector(".st-msearch");
    if (input && state._focusSearch) {
      input.focus();
      input.setSelectionRange(input.value.length, input.value.length);
      state._focusSearch = false;
    }
  }

  function thrPos(v) {
    return ((Math.max(-1, Math.min(1, Number(v) || 0)) + 1) / 2) * 100;
  }

  function updateThresholdVis() {
    const vis = el.querySelector(".st-thr-vis");
    if (!vis) return;
    const e = state.draft.ensemble;
    const ps = thrPos(e.sellThreshold);
    const pb = Math.max(ps, thrPos(e.buyThreshold));
    const set = (sel, left, width) => {
      const n = vis.querySelector(sel);
      if (n) {
        n.style.left = `${left}%`;
        if (width !== undefined) n.style.width = `${Math.max(0, width)}%`;
      }
    };
    set(".st-thr-sell", 0, ps);
    set(".st-thr-hold", ps, pb - ps);
    set(".st-thr-buy", pb, 100 - pb);
    set(".st-thr-l-sell", ps / 2);
    set(".st-thr-l-hold", (ps + pb) / 2);
    set(".st-thr-l-buy", (pb + 100) / 2);
  }

  function renderThresholds() {
    const box = el.querySelector(".st-thresholds");
    if (!box) return;
    const e = state.draft.ensemble;
    const buy = Number(e.buyThreshold);
    const sell = Number(e.sellThreshold);
    box.innerHTML = `
      <div class="st-thr-vis" aria-hidden="true">
        <div class="st-thr-bar">
          <i class="st-thr-sell"></i><i class="st-thr-hold"></i><i class="st-thr-buy"></i>
          <span class="st-thr-zero" style="left:50%"></span>
        </div>
        <div class="st-thr-lbls">
          <span class="st-thr-l-sell">VERKOOP</span><span class="st-thr-l-hold">WACHT</span><span class="st-thr-l-buy">KOOP</span>
        </div>
        <div class="st-thr-axis"><span>−1</span><span>0</span><span>+1</span></div>
      </div>
      <div class="bt-row2 st-row2">
        <div class="st-field ${state.invalid.has("ensemble.buyThreshold") ? "is-invalid" : ""}" data-field="ensemble.buyThreshold">
          <label for="st-buy">Koopdrempel <b class="mono pos st-val">${esc(fmt.num(buy, 2))}</b></label>
          <input id="st-buy" type="range" class="st-range st-range-buy" min="0.05" max="1" step="0.05" value="${buy}" data-path="ensemble.buyThreshold" data-key="buyThreshold" data-scale="1">
          <div class="st-help">Hoger = strenger: minder, maar sterkere koopsignalen.</div>
        </div>
        <div class="st-field ${state.invalid.has("ensemble.sellThreshold") ? "is-invalid" : ""}" data-field="ensemble.sellThreshold">
          <label for="st-sell">Verkoopdrempel <b class="mono neg st-val">${esc(fmt.num(sell, 2))}</b></label>
          <input id="st-sell" type="range" class="st-range st-range-sell" min="-1" max="-0.05" step="0.05" value="${sell}" data-path="ensemble.sellThreshold" data-key="sellThreshold" data-scale="1">
          <div class="st-help">Dichter bij 0 = sneller verkopen bij twijfel.</div>
        </div>
      </div>
      <label class="st-switch-row">
        <span class="pn-switch"><input type="checkbox" data-path="ensemble.regimeFilter" ${e.regimeFilter ? "checked" : ""}><i></i></span>
        <span><b>Regimefilter</b><span class="st-help">Geen aankopen in een dalende trend; strategieën buiten hun favoriete marktfase tellen minder mee. Aanbevolen: aan.</span></span>
      </label>`;
    updateThresholdVis();
  }

  function renderStrategies() {
    const box = el.querySelector(".st-strats");
    if (!box) return;
    const e = state.draft.ensemble;
    const enabled = new Set(e.enabled || []);
    const total = state.strategies.reduce((s, x) => s + (enabled.has(x.id) ? Number(e.weights?.[x.id] ?? 1) : 0), 0) || 1;
    box.innerHTML = state.strategies
      .map((s) => {
        const on = enabled.has(s.id);
        const w = Number(e.weights?.[s.id] ?? 1);
        const share = on ? (w / total) * 100 : 0;
        return `<div class="st-strat ${on ? "" : "is-off"}">
          <div class="st-strat-head">
            <label class="pn-switch" title="${on ? "Uitzetten" : "Aanzetten"}"><input type="checkbox" data-enable="${esc(s.id)}" ${on ? "checked" : ""}><i></i></label>
            <div class="st-strat-name"><b>${esc(s.name)}</b>
              <span class="st-regs">${(s.preferredRegimes || []).map((r) => `<span class="pn-chip">${esc(fmt.regime(r))}</span>`).join("")}</span></div>
            <span class="st-share mono" title="Aandeel in de totale score">${on ? esc(fmt.num(share, 0)) + "%" : "uit"}</span>
          </div>
          <div class="st-strat-desc muted">${esc(s.description || "")}</div>
          <div class="st-weight">
            <span class="muted">Gewicht</span>
            <input type="range" class="st-range" min="0" max="${Math.max(3, w)}" step="0.1" value="${w}" data-path="ensemble.weights.${esc(s.id)}" data-key="weights" data-scale="1" ${on ? "" : "disabled"} aria-label="Gewicht ${esc(s.name)}">
            <b class="mono st-val">${esc(fmt.num(w, 1))}</b>
          </div>
        </div>`;
      })
      .join("");
  }

  function renderRiskExample() {
    const box = el.querySelector(".st-risk-example");
    if (!box) return;
    const r = state.draft.risk;
    const snap = ctx.getState?.();
    const eq = Number(snap?.account?.equity) || 50;
    const rt = 2 * ((Number(r.takerFee) || 0) + (Number(r.slippagePct) || 0)) * 100;
    const items = [
      ["Max. verlies per trade", fmt.eur((eq * r.riskPerTradePct) / 100)],
      ["Max. positie", fmt.eur((eq * r.maxPositionPct) / 100)],
      ["Bot stopt bij dagverlies", fmt.eur((eq * r.dailyLossLimitPct) / 100)],
      ["Kosten per rondje", fmt.pct(rt, 2, false)],
    ];
    const warnings = [];
    if ((eq * r.maxPositionPct) / 100 < 5) warnings.push("Max. positie is kleiner dan het Bitvavo-minimum van €5: de bot kan dan niet kopen.");
    if (r.riskPerTradePct > 3) warnings.push("Meer dan 3% risico per trade is agressief: een paar verliezers op rij kosten veel.");
    if (r.takeProfitR * 1 < 1) warnings.push("Een winstdoel onder 1R betekent dat je winsten kleiner zijn dan je verliezen.");
    box.innerHTML = `<div class="st-example">
        <div class="st-example-title">Wat betekent dit bij een saldo van <b class="mono">${esc(fmt.eur(eq))}</b>?</div>
        <div class="st-example-grid">${items.map(([k, v]) => `<div><span class="muted">${esc(k)}</span><b class="mono">${esc(v)}</b></div>`).join("")}</div>
      </div>
      ${warnings.map((w) => `<div class="pn-banner pn-banner-warn">${esc(w)}</div>`).join("")}`;
  }

  function renderLive() {
    const box = el.querySelector(".st-sec-live");
    if (!box) return;
    const info = state.info;
    const snap = ctx.getState?.();
    const mode = info?.mode || snap?.mode || "paper";
    const armed = info ? !!info.liveArmed : !!snap?.liveArmed;
    const rows = [
      ["Modus", mode === "live" ? '<span class="pn-mode is-live">LIVE — echt geld</span>' : '<span class="pn-mode">PAPER — oefengeld</span>'],
      ["Marktdata", esc(info?.dataSource === "simulated" || snap?.dataSource === "simulated" ? "Gesimuleerd (nep-koersen)" : "Bitvavo (echte koersen)")],
      ["API-sleutels", info ? (info.hasApiKeys ? '<span class="pos">✓ ingesteld</span>' : '<span class="muted">niet ingesteld</span>') : "–"],
      ["Live gewapend", mode === "live" ? (armed ? '<span class="neg"><b>JA — plaatst echte orders</b></span>' : '<span class="pos">Nee — alleen simulatie</span>') : '<span class="muted">n.v.t.</span>'],
      ["Kapitaallimiet", info ? `<span class="mono">${esc(fmt.eur(info.capitalLimitQuote))}</span>` : "–"],
      ["Versie", esc(info?.version || "–")],
    ];
    const env = `TRADING_MODE=live
BITVAVO_API_KEY=jouw-api-key
BITVAVO_API_SECRET=jouw-api-secret
CAPITAL_LIMIT_EUR=50`;
    box.innerHTML = `
      <div class="pn-head"><div class="panel-title">Live trading</div></div>
      <div class="st-kv">${rows.map(([k, v]) => `<div><span class="muted">${esc(k)}</span><span>${v}</span></div>`).join("")}</div>
      ${
        mode === "live"
          ? armed
            ? `<div class="pn-banner pn-banner-bad"><b>Live trading staat AAN.</b> De bot plaatst echte orders met maximaal ${esc(fmt.eur(info?.capitalLimitQuote))} van je saldo.</div>
               <button type="button" class="btn btn-primary st-disarm">Ontwapenen (stop echte orders)</button>`
            : `<div class="pn-banner pn-banner-warn">De bot draait in live mode maar is <b>niet gewapend</b>: hij rekent alles door en logt "zou kopen…", maar plaatst geen echte orders.</div>
               <button type="button" class="btn btn-danger st-arm" ${info && !info.hasApiKeys ? "disabled" : ""}>Arm live trading…</button>
               ${info && !info.hasApiKeys ? '<p class="st-help neg">Geen API-sleutel ingesteld in .env.</p>' : ""}`
          : `<div class="st-paper-info">
              <p><b>Je oefent nu met nep-geld.</b> Dat is precies goed: paper trade eerst minstens <b>enkele weken</b>. Zo zie je zonder risico of de bot
              in jouw markten na alle kosten echt winst maakt, hoe groot de verliesperiodes zijn en of jij je daar prettig bij voelt.</p>
              <p><b>Later overstappen naar live?</b></p>
              <ol>
                <li>Maak op bitvavo.com een API-sleutel met alleen <b>Bekijken</b> en <b>Handelen</b> — <b>nooit opnemen</b> — en zet een IP-whitelist aan.</li>
                <li>Zet in het bestand <span class="mono">.env</span> (in de map bitvavo-trader):</li>
              </ol>
              <pre class="st-code mono">${esc(env)}</pre>
              <ol start="3">
                <li>Herstart de bot. In live mode start hij nooit vanzelf en plaatst hij pas echte orders nadat je hier op <b>Arm live trading</b> klikt.</li>
              </ol>
              <p class="st-help">Zet nooit meer geld in dan je kunt missen. De kapitaallimiet zorgt dat de bot nooit meer dan dat bedrag gebruikt.</p>
            </div>`
      }`;
    box.querySelector(".st-arm")?.addEventListener("click", openArm);
    box.querySelector(".st-disarm")?.addEventListener("click", disarm);
  }

  function openArm() {
    const limit = state.info?.capitalLimitQuote;
    ctx.openModal({
      title: "Live trading armen",
      danger: true,
      requireText: ARM_TEXT,
      confirmText: "Arm live trading",
      cancelText: "Annuleren",
      bodyHtml: `<p>Na het armen plaatst de bot <strong>echte orders met echt geld</strong> op Bitvavo${
        Number.isFinite(limit) ? `, met maximaal <strong>${esc(fmt.eur(limit))}</strong> van je saldo` : ""
      }.</p>
        <ul>
          <li>Je kunt je hele inzet verliezen. Backtests en paper trading zijn geen garantie.</li>
          <li>Fees (0,25% per kant) en slippage gaan van je saldo af.</li>
          <li>Je kunt altijd ontwapenen of de noodstop gebruiken.</li>
        </ul>
        <p>Typ hieronder exact <strong>${esc(ARM_TEXT)}</strong> om te bevestigen.</p>`,
      onConfirm: async (value) => {
        const typed = typeof value === "string" && value ? value : document.querySelector(".modal-input input")?.value?.trim() || "";
        if (typed !== ARM_TEXT) throw new Error(`Typ exact: ${ARM_TEXT}`);
        const info = await api.arm(typed);
        state.info = info;
        renderLive();
        bus.emit("app-info", info);
        ctx.toast("Live trading is gewapend: de bot plaatst nu echte orders.", "warn");
      },
    });
  }

  async function disarm() {
    try {
      const info = await api.disarm();
      state.info = info;
      renderLive();
      bus.emit("app-info", info);
      ctx.toast("Ontwapend: er worden geen echte orders meer geplaatst.", "success");
    } catch (err) {
      ctx.toast(`Ontwapenen mislukt: ${err?.message || err}`, "error");
    }
  }

  function currentToken() {
    try {
      return localStorage.getItem(TOKEN_KEY) || "";
    } catch {
      return "";
    }
  }

  function renderToken() {
    const box = el.querySelector(".st-sec-token");
    if (!box) return;
    const has = !!currentToken();
    box.innerHTML = `
      <div class="pn-head"><div class="panel-title">Dashboard-token</div>
        <span class="pn-chip ${has ? "pn-chip-acc" : ""}">${has ? "ingesteld in deze browser" : "niet ingesteld"}</span></div>
      <p class="pn-hint">Alleen nodig als in <span class="mono">.env</span> een <span class="mono">DASHBOARD_TOKEN</span> staat. Het token wordt alleen in deze browser bewaard.</p>
      <div class="st-token-row">
        <input class="input mono st-token" type="password" autocomplete="off" spellcheck="false" placeholder="${has ? "••••••••" : "token"}" aria-label="Dashboard-token">
        <button type="button" class="btn btn-ghost st-token-show" title="Tonen/verbergen" aria-label="Token tonen of verbergen"><svg class="pn-ico" viewBox="0 0 15 15" aria-hidden="true"><path d="M1 7.5C2.8 4.3 5 3 7.5 3s4.7 1.3 6.5 4.5C12.2 10.7 10 12 7.5 12S2.8 10.7 1 7.5z"/><circle cx="7.5" cy="7.5" r="2"/></svg></button>
        <button type="button" class="btn st-token-save">Opslaan</button>
        <button type="button" class="btn btn-ghost st-token-clear" ${has ? "" : "disabled"}>Wissen</button>
      </div>`;
    const input = box.querySelector(".st-token");
    box.querySelector(".st-token-show").addEventListener("click", () => {
      input.type = input.type === "password" ? "text" : "password";
    });
    box.querySelector(".st-token-save").addEventListener("click", () => {
      const v = input.value.trim();
      if (!v) return ctx.toast("Vul eerst een token in.", "warn");
      setToken(v);
      renderToken();
      ctx.toast("Token opgeslagen. Herlaad de pagina om opnieuw te verbinden.", "success");
    });
    box.querySelector(".st-token-clear").addEventListener("click", () => {
      setToken("");
      renderToken();
      ctx.toast("Token gewist uit deze browser.", "info");
    });
  }

  function renderErrors() {
    const box = el.querySelector(".st-errors");
    if (!box) return;
    if (!state.errors.length) {
      box.hidden = true;
      box.innerHTML = "";
      return;
    }
    box.hidden = false;
    box.innerHTML = `<div class="pn-banner pn-banner-bad" role="alert"><b>Niet opgeslagen — controleer:</b><ul>${state.errors
      .map((e) => `<li>${esc(e)}</li>`)
      .join("")}</ul></div>`;
  }

  function updateDirty() {
    const d = dirty();
    const bar = el.querySelector(".st-savebar");
    if (bar) {
      bar.hidden = !d && !state.errors.length;
      bar.classList.toggle("has-errors", state.errors.length > 0);
      bar.querySelector(".st-savebar-txt").textContent = state.errors.length
        ? `${state.errors.length} probleem${state.errors.length === 1 ? "" : "en"} — zie boven`
        : "Je hebt niet-opgeslagen wijzigingen";
    }
    for (const b of el.querySelectorAll('[data-act="save"]')) {
      b.disabled = state.saving || !d;
      b.classList.toggle("busy", state.saving);
    }
    for (const b of el.querySelectorAll('[data-act="discard"]')) b.disabled = state.saving || !d;
  }

  function setInvalid(path, on) {
    if (on) state.invalid.add(path);
    else state.invalid.delete(path);
    const f = el.querySelector(`[data-field="${CSS.escape(path)}"]`);
    if (f) {
      f.classList.toggle("is-invalid", on);
      f.querySelector("input.input")?.classList.toggle("invalid", on);
    }
  }

  // ── Validatie (client) ──
  function validate() {
    const errs = [];
    const d = state.draft;
    state.invalid.clear();
    if (!d.markets?.length || d.markets.length > MAX_MARKETS) {
      errs.push(`Kies 1 tot ${MAX_MARKETS} markten.`);
      state.invalid.add("markets");
    }
    const check = (path, label, min, max, int) => {
      const v = getPath(d, path);
      if (!Number.isFinite(v)) {
        errs.push(`${label}: vul een getal in.`);
        state.invalid.add(path);
      } else if ((min !== undefined && v < min - 1e-12) || (max !== undefined && v > max + 1e-12)) {
        errs.push(`${label} moet tussen ${fmt.num(min, 4)} en ${fmt.num(max, 4)} liggen.`);
        state.invalid.add(path);
      } else if (int && !Number.isInteger(round(v, 6))) {
        errs.push(`${label} moet een heel getal zijn.`);
        state.invalid.add(path);
      }
    };
    check("pollMs", "Verversen", 5000, 300000);
    check("historyCandles", "Historie per analyse", 100, 1000, true);
    for (const g of RISK_GROUPS) {
      for (const f of g.fields) {
        const s = f.scale || 1;
        const v = d.risk[f.key];
        if (f.zeroOff && v === 0) continue;
        if (f.key === "trailingAtrMult") check(`risk.${f.key}`, f.label, 0.5, 10);
        else check(`risk.${f.key}`, f.label, f.min / s, f.max / s, f.int);
      }
    }
    if (!(d.ensemble.buyThreshold >= 0.05 && d.ensemble.buyThreshold <= 1)) {
      errs.push("Koopdrempel moet tussen 0,05 en 1 liggen.");
      state.invalid.add("ensemble.buyThreshold");
    }
    if (!(d.ensemble.sellThreshold >= -1 && d.ensemble.sellThreshold <= -0.05)) {
      errs.push("Verkoopdrempel moet tussen −1 en −0,05 liggen.");
      state.invalid.add("ensemble.sellThreshold");
    }
    if (!d.ensemble.enabled?.length) errs.push("Zet minstens één strategie aan.");
    if (d.risk.maxTotalExposurePct < d.risk.maxPositionPct) {
      errs.push("Max. totale blootstelling is kleiner dan de max. positiegrootte.");
      state.invalid.add("risk.maxTotalExposurePct");
    }
    return errs;
  }

  function buildPatch() {
    const d = state.draft;
    const s = state.server;
    const patch = {
      markets: d.markets,
      interval: d.interval,
      pollMs: Math.round(d.pollMs),
      historyCandles: Math.round(d.historyCandles),
      ensemble: {
        enabled: d.ensemble.enabled,
        weights: d.ensemble.weights,
        buyThreshold: round(d.ensemble.buyThreshold, 4),
        sellThreshold: round(d.ensemble.sellThreshold, 4),
        regimeFilter: !!d.ensemble.regimeFilter,
      },
      risk: Object.fromEntries(Object.entries(d.risk).map(([k, v]) => [k, round(v, 8)])),
    };
    // Parameter-overrides alleen meesturen als ze veranderd zijn (null = verwijderen)
    const sp = s?.ensemble?.params || {};
    const dp = d.ensemble.params || {};
    if (stable(sp) !== stable(dp)) {
      const params = {};
      for (const id of Object.keys(sp)) if (!(id in dp)) params[id] = null;
      for (const [id, p] of Object.entries(dp)) params[id] = p;
      patch.ensemble.params = params;
    }
    return patch;
  }

  function markServerErrors(msg) {
    const keys = [...el.querySelectorAll("[data-path]")].map((i) => [i.dataset.path, i.dataset.key || i.dataset.path.split(".").pop()]);
    for (const [path, key] of keys) {
      if (msg.includes(`(${key})`) || new RegExp(`\\b${key}\\b`).test(msg)) setInvalid(path, true);
    }
    if (/markt/i.test(msg)) setInvalid("markets", true);
  }

  async function save() {
    if (state.saving) return;
    const errs = validate();
    state.errors = errs;
    if (errs.length) {
      renderAll();
      el.querySelector(".st-errors")?.scrollIntoView({ behavior: "smooth", block: "center" });
      return;
    }
    state.saving = true;
    updateDirty();
    try {
      const next = await api.putConfig(buildPatch());
      state.server = clone(next);
      state.draft = clone(next);
      state.errors = [];
      state.invalid.clear();
      state.saving = false;
      renderAll();
      bus.emit("config-changed", next);
      ctx.toast("Instellingen opgeslagen. De bot gebruikt ze vanaf de volgende tick.", "success");
    } catch (err) {
      state.saving = false;
      const msg = err?.message || String(err);
      state.errors = msg.split(/(?<=[.!?)])\s+(?=[A-Z(])/).filter(Boolean);
      renderAll();
      markServerErrors(msg);
      el.querySelector(".st-errors")?.scrollIntoView({ behavior: "smooth", block: "center" });
      ctx.toast("Opslaan mislukt — zie de meldingen bovenaan.", "error");
    }
  }

  // ── Events ──
  el.addEventListener("input", (e) => {
    const t = e.target;
    if (t.classList.contains("st-msearch")) {
      state.search = t.value;
      state._focusSearch = true;
      renderMarkets();
      return;
    }
    const path = t.dataset?.path;
    if (!path || !state.draft) return;
    if (t.type === "checkbox") setPath(state.draft, path, t.checked);
    else if (t.tagName === "SELECT") setPath(state.draft, path, t.value);
    else {
      const scale = Number(t.dataset.scale) || 1;
      const n = parseNum(t.value);
      setPath(state.draft, path, Number.isFinite(n) ? round(n / scale, 10) : NaN);
    }
    if (state.invalid.has(path)) setInvalid(path, false);
    // Live feedback zonder de invoervelden opnieuw te tekenen
    if (t.type === "range") {
      const v = t.closest(".st-field, .st-weight")?.querySelector(".st-val");
      if (v) v.textContent = fmt.num(Number(t.value), path.includes("weights") ? 1 : 2);
    }
    if (path.startsWith("ensemble.buy") || path.startsWith("ensemble.sell")) updateThresholdVis();
    if (path.startsWith("ensemble.weights")) {
      const e2 = state.draft.ensemble;
      const enabled = new Set(e2.enabled);
      const total = state.strategies.reduce((s, x) => s + (enabled.has(x.id) ? Number(e2.weights?.[x.id] ?? 1) : 0), 0) || 1;
      for (const card of el.querySelectorAll(".st-strat")) {
        const id = card.querySelector("[data-enable]")?.dataset.enable;
        const sh = card.querySelector(".st-share");
        if (id && sh && enabled.has(id)) sh.textContent = `${fmt.num((Number(e2.weights?.[id] ?? 1) / total) * 100, 0)}%`;
      }
    }
    if (path.startsWith("risk.")) renderRiskExample();
    if (path === "interval") {
      const h = el.querySelector(".st-interval-help");
      if (h) h.textContent = INTERVAL_HELP[t.value] || "";
    }
    updateDirty();
  });
  el.addEventListener("change", (e) => {
    const t = e.target;
    if (t.dataset?.enable && state.draft) {
      const set = new Set(state.draft.ensemble.enabled || []);
      if (t.checked) set.add(t.dataset.enable);
      else set.delete(t.dataset.enable);
      // Houd de volgorde van de strategielijst aan
      state.draft.ensemble.enabled = state.strategies.map((s) => s.id).filter((id) => set.has(id));
      renderStrategies();
      updateDirty();
    }
    if (t.dataset?.path === "interval") updateDirty();
  });
  el.addEventListener("click", (e) => {
    const t = e.target.closest("button");
    if (!t || !state.draft) return;
    if (t.dataset.remove) {
      state.draft.markets = state.draft.markets.filter((m) => m !== t.dataset.remove);
      setInvalid("markets", false);
      renderMarkets();
      updateDirty();
    } else if (t.dataset.add) {
      if (state.draft.markets.length >= MAX_MARKETS) return ctx.toast(`Maximaal ${MAX_MARKETS} markten.`, "warn");
      state.draft.markets = [...state.draft.markets, t.dataset.add];
      setInvalid("markets", false);
      renderMarkets();
      updateDirty();
    } else if (t.dataset.act === "save") save();
    else if (t.dataset.act === "discard") {
      state.draft = clone(state.server);
      state.errors = [];
      state.invalid.clear();
      renderAll();
      ctx.toast("Wijzigingen ongedaan gemaakt.", "info");
    } else if (t.dataset.act === "defaults") {
      state.draft = clone(DEFAULTS);
      state.errors = [];
      state.invalid.clear();
      renderAll();
      ctx.toast("Standaardwaarden ingevuld. Klik op Opslaan om ze te bewaren.", "info");
    }
  });

  bus.on("config-changed", (cfg) => {
    if (!cfg || !state.server) return;
    const wasDirty = dirty();
    state.server = clone({ ...state.server, ...cfg });
    if (!wasDirty) {
      state.draft = clone(state.server);
      renderAll();
    } else updateDirty();
  });
  bus.on("app-info", (info) => {
    if (info && typeof info === "object") {
      state.info = info;
      renderLive();
    }
  });
  let lastLive = "";
  bus.on("snapshot", (s) => {
    const sig = `${s?.mode}|${s?.liveArmed}`;
    if (sig === lastLive) return;
    lastLive = sig;
    if (state.info && s) state.info = { ...state.info, mode: s.mode, liveArmed: !!s.liveArmed };
    renderLive();
  });

  // ── Laden ──
  async function load() {
    const [cfg, strats, info, markets] = await Promise.allSettled([api.getConfig(), api.getStrategies(), api.info(), api.getMarkets()]);
    if (strats.status === "fulfilled" && Array.isArray(strats.value) && strats.value.length) state.strategies = strats.value;
    if (info.status === "fulfilled") state.info = info.value;
    if (markets.status === "fulfilled" && Array.isArray(markets.value)) state.markets = markets.value;
    else state.marketsError = markets.reason?.message || "onbekende fout";
    if (cfg.status !== "fulfilled") {
      el.innerHTML = `<div class="panel"><div class="pn-banner pn-banner-bad"><b>Instellingen konden niet geladen worden.</b> ${esc(cfg.reason?.message || "")}</div>
        <button type="button" class="btn st-retry">Opnieuw proberen</button></div>`;
      el.querySelector(".st-retry")?.addEventListener("click", load);
      return;
    }
    state.server = clone(cfg.value);
    state.draft = clone(cfg.value);
    // Zorg dat alle risicovelden bestaan (oudere configs)
    state.draft.risk = { ...DEFAULTS.risk, ...(state.draft.risk || {}) };
    state.draft.ensemble = { ...clone(DEFAULTS.ensemble), ...(state.draft.ensemble || {}) };
    state.server.risk = { ...DEFAULTS.risk, ...(state.server.risk || {}) };
    state.server.ensemble = { ...clone(DEFAULTS.ensemble), ...(state.server.ensemble || {}) };
    // Markten die de bot al gebruikt altijd tonen, ook als /api/markets faalt
    for (const m of state.draft.markets || []) if (!state.markets.some((x) => x.market === m)) state.markets.push({ market: m });
    state.loaded = true;
    renderAll();
  }
  load();

  window.addEventListener("beforeunload", (e) => {
    if (dirty()) {
      e.preventDefault();
      e.returnValue = "";
    }
  });
}
