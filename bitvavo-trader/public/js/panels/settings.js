// Instellingen: munten (automatisch of zelf gekozen), interval, trendfilter,
// risicobeheer, strategieën, live handel (inschakelen/uitschakelen) en het
// dashboard-token. Opslaan via PUT /api/config.

import { setToken, BASE } from "../api.js";
import {
  RISK_GROUPS,
  MAX_MARKETS,
  UNIVERSE_COUNT_PRESETS,
  defaultsFor,
  clone,
  stable,
  getPath,
  setPath,
  round,
  parseNum,
  withDefaults,
  trendFilterActive,
  validateDraft,
  feeWarnings,
  buildPatch,
  rebaseDraft,
  universeStatus,
  chipsView,
  addAllMarkets,
  orderMarketsForAdding,
  isExcludedMarket,
  trendPeriodUnit,
} from "./settingsLogic.js";

const TOKEN_KEY = "bvt-dashboard-token";
const ARM_TEXT = "IK BEGRIJP HET RISICO";
const INTERVALS = ["1m", "5m", "15m", "30m", "1h", "2h", "4h", "6h", "8h", "12h", "1d"];

const FALLBACK_STRATEGIES = [
  { id: "ema-trend", name: "EMA-trend", description: "Volgt de trend met twee voortschrijdende gemiddelden.", preferredRegimes: ["trend-up"] },
  { id: "rsi-reversion", name: "RSI-omkeer", description: "Koopt na een te sterke daling (RSI laag).", preferredRegimes: ["range"] },
  { id: "breakout", name: "Uitbraak", description: "Koopt als de koers boven een recent hoogtepunt uitbreekt.", preferredRegimes: ["trend-up", "volatile"] },
  { id: "macd-momentum", name: "MACD-momentum", description: "Koopt als het momentum toeneemt.", preferredRegimes: ["trend-up"] },
  { id: "vwap-reversion", name: "VWAP-omkeer", description: "Koopt ver onder de gemiddelde handelsprijs van de dag.", preferredRegimes: ["range"] },
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

export function mountSettings(ctx, el) {
  ensureCss();
  const { fmt, esc, api, bus } = ctx;
  if (!el) return;
  el.classList.add("st");

  // `server` = de serverconfig waar het concept (`draft`) op gebaseerd is. Komt er
  // een nieuwere serverconfig binnen, dan wordt het concept daarop overgezet
  // (rebaseDraft) en stuurt Opslaan alleen de eigen wijzigingen (buildPatch).
  const state = {
    server: null,
    draft: null,
    /** Velden die hier én elders gewijzigd zijn (melding boven het formulier) */
    notice: null,
    strategies: FALLBACK_STRATEGIES,
    info: ctx.getInfo?.() || null,
    markets: [],
    marketsError: null,
    errors: [],
    invalid: new Set(),
    saving: false,
    search: "",
    /** Gekozen munten boven de 30 uitgeklapt tonen */
    chipsExpanded: false,
    /** Laatste snapshot (muntkeuze, actieve munten, marktfilter) */
    snap: ctx.getState?.() || null,
    loaded: false,
    /** Aantal bots in dit programma (GET /api/bots via het bus-event "bots"); null = onbekend */
    botCount: Array.isArray(ctx.getBots?.()) ? ctx.getBots().length : null,
  };

  /** Draaien er meerdere bots (elk met eigen instellingen)? Onder /bot/<id>/ altijd. */
  const multiBot = () => !!BASE || (Number.isFinite(state.botCount) && state.botCount > 1);
  /** De bot van dit dashboard ({ id, name }) bij meerdere bots, anders null */
  function thisBot() {
    if (!multiBot()) return null;
    const b = state.info && state.info.bot && typeof state.info.bot === "object" ? state.info.bot : null;
    const id = b && typeof b.id === "string" && /^[A-Za-z0-9_-]+$/.test(b.id) ? b.id : BASE ? BASE.slice("/bot/".length) : "";
    return id ? { id, name: (b && typeof b.name === "string" && b.name) || id } : null;
  }
  /** Waar de instellingen bewaard worden (HTML, alles ge-escapet) */
  function whereHtml() {
    const bot = thisBot();
    if (bot) {
      return `Dit zijn de instellingen van <b>${esc(bot.name)}</b>; de andere bots hebben elk hun eigen instellingen. Wijzigingen gelden pas na <b>Opslaan</b> en worden bewaard in
        <span class="mono">&lt;DATA_DIR&gt;/bots/${esc(bot.id)}/config.json</span> (standaard <span class="mono">data/bots/${esc(bot.id)}/config.json</span>).`;
    }
    return `Pas aan hoe de bot handelt. Wijzigingen gelden pas na <b>Opslaan</b> en worden bewaard in <span class="mono">&lt;DATA_DIR&gt;/config.json</span>
            (standaard <span class="mono">data/config.json</span>). Wat hier is opgeslagen gaat vóór <span class="mono">MARKETS</span> en
            <span class="mono">INTERVAL</span> uit <span class="mono">.env</span>: die worden dan genegeerd.`;
  }
  /** Knop "Standaardwaarden": van deze bot (profiel) of de fabrieksinstellingen */
  function defaultsTitle() {
    const d = defaultsFor(state.info);
    return d.profile && d.name
      ? `Vul de standaardinstellingen van ${d.name} in (zijn eigen handelsstijl; nog niet opgeslagen)`
      : "Vul de fabrieksinstellingen in (nog niet opgeslagen)";
  }

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
        trendFilter: c.ensemble?.trendFilter || null,
      },
      risk: c.risk,
      universe: c.universe || null,
    };
  }

  // ── Opbouw ──
  function numField({ path, key, label, unit, step, min, max, scale = 1, help, zeroOff }) {
    const raw = getPath(state.draft, path);
    const shown = Number.isFinite(raw) ? round(raw * scale, 6) : "";
    const id = `st-${path.replace(/\./g, "-")}`;
    return `<div class="st-field ${state.invalid.has(path) ? "is-invalid" : ""}" data-field="${esc(path)}">
      <label for="${id}">${esc(label)}${zeroOff ? ' <span class="muted st-off">0 = uit</span>' : ""}</label>
      <div class="st-input-wrap${String(unit || "").length > 10 ? " has-long-unit" : ""}">
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
          <p class="pn-hint st-where">${whereHtml()}</p>
        </div>
        <div class="st-top-actions">
          <button type="button" class="btn btn-ghost" data-act="defaults" title="${esc(defaultsTitle())}">↺ Standaardwaarden</button>
          <button type="button" class="btn btn-ghost" data-act="discard">Wijzigingen ongedaan maken</button>
          <button type="button" class="btn btn-primary" data-act="save">Opslaan</button>
        </div>
      </div>
      <div class="st-errors" hidden></div>
      <div class="st-notice" hidden></div>
      <div class="st-grid">
        <div class="st-col">
          <section class="panel st-sec st-sec-markets">
            <div class="pn-head"><div class="panel-title">Munten</div><span class="pn-chip st-mcount">${mcountHtml()}</span></div>
            <div class="st-uni">${universeHtml()}</div>
          </section>

          <section class="panel st-sec st-sec-interval">
            <div class="pn-head"><div class="panel-title">Interval &amp; verversen</div></div>
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
              help: "Aantal candles dat de strategieën per analyse bekijken. Is dat minder dan de opwarmtijd die een strategie nodig heeft (bijv. voor de EMA 200), dan haalt de bot die extra candles zelf op." })}
          </section>

          <section class="panel st-sec st-sec-trend">
            <div class="pn-head"><div class="panel-title">Trendfilter</div><span class="st-tf-chip">${trendChipHtml()}</span></div>
            <div class="st-tf">${trendHtml()}</div>
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
    renderThresholds();
    renderStrategies();
    renderRiskExample();
    renderLive();
    renderToken();
    renderErrors();
    renderNotice();
    updateDirty();
  }

  // ── Munten (automatisch of zelf kiezen) ──
  const base = (m) => String(m).split("-")[0];
  const uniMode = () => (state.draft?.universe?.mode === "auto" ? "auto" : "manual");
  const activeMarkets = () => {
    const s = state.snap;
    return Array.isArray(s?.activeMarkets) ? s.activeMarkets : Array.isArray(s?.config?.markets) ? s.config.markets : null;
  };

  function mcountHtml() {
    if (uniMode() === "auto") {
      const n = Number(state.draft.universe?.count);
      return `automatisch · <b class="mono">${Number.isFinite(n) ? esc(String(n)) : "–"}</b>`;
    }
    return `<b class="mono">${(state.draft.markets || []).length}</b>/${MAX_MARKETS}`;
  }

  function statusHtml() {
    const st = universeStatus(state.snap, uniMode(), fmt);
    const act = activeMarkets();
    const list =
      act?.length && st.text
        ? `<details class="st-uni-list"><summary>Welke munten?</summary><div class="st-uni-names mono">${esc(act.map(base).join(", "))}</div></details>`
        : "";
    return (
      (st.text
        ? `<div class="st-uni-now${st.note ? " is-warn" : ""}"><span class="st-uni-dot" aria-hidden="true"></span><b>${esc(st.text)}</b>${list}</div>`
        : "") +
      (st.detail ? `<div class="st-help">${esc(st.detail)}</div>` : "") +
      (st.note ? `<div class="pn-banner pn-banner-warn st-uni-note">${esc(st.note)}</div>` : "") +
      (st.pending ? `<div class="st-uni-pending">${esc(st.pending)}</div>` : "")
    );
  }

  function posHintHtml() {
    const n = Number(state.draft.risk?.maxOpenPositions);
    return `Met een klein saldo heeft de bot maar een paar posities tegelijk open (nu max. <b>${Number.isFinite(n) ? esc(String(n)) : "–"}</b>, zie Risicobeheer).
      Meer munten = meer keus, niet meer posities: de bot koopt de beste kansen.`;
  }

  function presetsHtml() {
    const n = Number(state.draft.universe?.count);
    return UNIVERSE_COUNT_PRESETS.map(
      (p) => `<button type="button" class="st-mopt st-uni-preset ${p === n ? "is-active" : ""}" data-uni-count="${p}" aria-pressed="${p === n}">${p}</button>`,
    ).join("");
  }

  function autoHtml() {
    const u = state.draft.universe || {};
    const n = Number(u.count);
    const vol = Number(u.minVolumeEur);
    const inv = (p) => (state.invalid.has(p) ? "is-invalid" : "");
    return `
      <p class="st-uni-explain">Elk uur kiest de bot de <b class="mono st-uni-n">${Number.isFinite(n) ? esc(String(n)) : "–"}</b> munten met de meeste handel op Bitvavo, zonder stablecoins en met een kleine spread.</p>
      <div class="st-field ${inv("universe.count")}" data-field="universe.count">
        <label for="st-universe-count">Aantal munten</label>
        <div class="st-uni-count">
          <div class="st-input-wrap"><input id="st-universe-count" class="input mono ${state.invalid.has("universe.count") ? "invalid" : ""}" type="number" inputmode="numeric"
            data-path="universe.count" data-key="count" data-scale="1" step="1" min="1" max="${MAX_MARKETS}" value="${Number.isFinite(n) ? esc(String(n)) : ""}"><span class="st-unit">munten</span></div>
          <div class="st-uni-presets" role="group" aria-label="Snelkeuze aantal munten">${presetsHtml()}</div>
        </div>
        <div class="st-help">1 tot ${MAX_MARKETS}. Met meer munten vindt de bot vaker een goede kans, maar een ronde langs alle munten duurt dan wat langer.</div>
      </div>
      <div class="st-field ${inv("universe.minVolumeEur")}" data-field="universe.minVolumeEur">
        <label for="st-universe-minVolumeEur">Minimaal 24u-volume</label>
        <div class="st-input-wrap"><input id="st-universe-minVolumeEur" class="input mono ${state.invalid.has("universe.minVolumeEur") ? "invalid" : ""}" type="text" inputmode="numeric"
          data-path="universe.minVolumeEur" data-key="minVolumeEur" data-scale="1" data-grouped="1" autocomplete="off" value="${Number.isFinite(vol) ? esc(fmt.num(vol, 2)) : ""}"><span class="st-unit">€</span></div>
        <div class="st-help">Munten waarin de afgelopen 24 uur minder is verhandeld, slaat de bot over: die zijn lastig te kopen en te verkopen voor een eerlijke prijs.</div>
      </div>`;
  }

  /** 24u-volume per markt voor zover bekend: uit /api/markets (als de server het meestuurt) en de radar */
  function knownVolumes() {
    const v = new Map();
    for (const m of state.markets) if (m && Number.isFinite(m.volumeQuote24h)) v.set(m.market, m.volumeQuote24h);
    const radar = Array.isArray(state.snap?.radar) ? state.snap.radar : [];
    for (const r of radar) if (r && typeof r.market === "string" && Number.isFinite(r.volumeQuote24h)) v.set(r.market, r.volumeQuote24h);
    return v;
  }

  /**
   * Alle bekende markten, meeste handel eerst (waar bekend), dan de bekende grote munten;
   * stablecoins, goud en verpakte munten achteraan (zelfde volgorde als de knoppen om toe te voegen)
   */
  function orderedMarkets() {
    return orderMarketsForAdding(
      state.markets.map((m) => m.market),
      { volumes: knownVolumes(), popular: POPULAR, minVolume: Number(state.draft?.universe?.minVolumeEur) || 0 },
    );
  }

  function chipsHtml() {
    const sel = state.draft.markets || [];
    if (!sel.length) return '<span class="neg">Nog geen munten gekozen. Kies er minstens één.</span>';
    const v = chipsView(sel, { query: state.search, expanded: state.chipsExpanded });
    const chips = v.shown
      .map((m) => `<span class="st-mchip"><b>${esc(base(m))}</b><span class="muted">-EUR</span>
        <button type="button" data-remove="${esc(m)}" aria-label="${esc(m)} verwijderen" title="Verwijderen">×</button></span>`)
      .join("");
    const q = state.search.trim();
    const more = v.hidden
      ? `<button type="button" class="st-mopt st-chips-more" data-act="chips-more">+${v.hidden} meer tonen</button>`
      : !q && state.chipsExpanded && sel.length > 30
        ? '<button type="button" class="st-mopt st-chips-more" data-act="chips-less">Minder tonen</button>'
        : "";
    const none = q && !v.shown.length ? `<span class="muted">Geen gekozen munt met "${esc(q)}".</span>` : "";
    return chips + none + more;
  }

  function availHtml() {
    if (state.marketsError) return `<span class="neg">Markten laden mislukt: ${esc(state.marketsError)}</span>`;
    const sel = new Set(state.draft.markets || []);
    const q = state.search.trim().toUpperCase();
    const avail = orderedMarkets().filter((m) => !sel.has(m) && (!q || m.includes(q)));
    const shown = avail.slice(0, q ? 60 : 24);
    const full = sel.size >= MAX_MARKETS;
    return (
      shown.map((m) => `<button type="button" class="st-mopt" data-add="${esc(m)}" ${full ? "disabled" : ""}>+ ${esc(base(m))}</button>`).join("") +
      (avail.length > shown.length ? `<span class="muted st-more">+${avail.length - shown.length} meer — typ om te zoeken</span>` : "") +
      (!avail.length ? `<span class="muted">${q ? "Geen markten gevonden." : "Alle markten zitten al in je lijst."}</span>` : "")
    );
  }

  function bulkHtml() {
    const sel = state.draft.markets || [];
    const n = addAllMarkets(sel, orderedMarkets(), MAX_MARKETS).added;
    const act = activeMarkets();
    const serverAuto = state.server?.universe?.mode === "auto";
    const copyN = act ? Math.min(act.length, MAX_MARKETS) : 0;
    const canCopy = serverAuto && copyN > 0 && stable(act.slice(0, MAX_MARKETS)) !== stable(sel);
    return `<button type="button" class="btn btn-ghost pn-btn-sm" data-act="markets-all" ${n ? "" : "disabled"}
        title="Meeste handel eerst; zonder stablecoins, goud- en verpakte munten (net als Automatisch)">Alle markten toevoegen (${n})</button>
      <button type="button" class="btn btn-ghost pn-btn-sm" data-act="markets-clear" ${sel.length ? "" : "disabled"}>Alles wissen</button>
      ${canCopy ? `<button type="button" class="btn btn-ghost pn-btn-sm pn-btn-wrap" data-act="markets-copy-active" title="Vervang je lijst door de munten die de bot nu automatisch volgt">Neem de ${copyN} munten van de automatische keuze over</button>` : ""}`;
  }

  function manualHtml() {
    const sel = state.draft.markets || [];
    return `
      <div class="st-field ${state.invalid.has("markets") ? "is-invalid" : ""}" data-field="markets">
        <label>Jouw munten <span class="muted st-mcount-inline">${sel.length}/${MAX_MARKETS}</span></label>
        <div class="st-msel">${chipsHtml()}</div>
        <div class="st-help">De bot volgt precies deze munten (maximaal ${MAX_MARKETS}).</div>
      </div>
      <div class="st-madd">
        <input class="input st-msearch" type="search" placeholder="Zoek munt, bijv. XRP…" value="${esc(state.search)}" aria-label="Zoek munt">
        <div class="st-mavail">${availHtml()}</div>
        <div class="st-uni-bulk">${bulkHtml()}</div>
      </div>`;
  }

  function universeHtml() {
    const mode = uniMode();
    const seg = (m, label) =>
      `<button type="button" data-uni-mode="${m}" role="radio" aria-checked="${mode === m}" class="${mode === m ? "is-active" : ""}">${label}</button>`;
    return `
      <div class="pn-seg st-uni-seg" role="radiogroup" aria-label="Hoe kiest de bot zijn munten?">
        ${seg("auto", "Automatisch (meest verhandeld)")}${seg("manual", "Zelf kiezen")}
      </div>
      <div class="st-uni-status" aria-live="polite">${(lastStatus = statusHtml())}</div>
      ${mode === "auto" ? autoHtml() : manualHtml()}
      <p class="st-help st-uni-pos">${posHintHtml()}</p>`;
  }

  /** Alleen de lijsten van "Zelf kiezen" (het zoekveld blijft staan en houdt de focus) */
  function renderMarketLists() {
    const set = (sel, html) => {
      const n = el.querySelector(sel);
      if (n) n.innerHTML = html;
    };
    if (uniMode() !== "manual") return;
    set(".st-msel", chipsHtml());
    set(".st-mavail", availHtml());
    set(".st-uni-bulk", bulkHtml());
    set(".st-mcount-inline", `${(state.draft.markets || []).length}/${MAX_MARKETS}`);
    set(".st-mcount", mcountHtml());
  }

  /** Na typen in de automatische velden: uitleg, snelkeuzes en teller bijwerken zonder de invoer te vervangen */
  function updateUniverseLive() {
    const n = Number(state.draft.universe?.count);
    const t = el.querySelector(".st-uni-n");
    if (t) t.textContent = Number.isFinite(n) ? String(n) : "–";
    const p = el.querySelector(".st-uni-presets");
    if (p) p.innerHTML = presetsHtml();
    const c = el.querySelector(".st-mcount");
    if (c) c.innerHTML = mcountHtml();
  }

  let lastStatus = "";
  function updateStatus() {
    const box = el.querySelector(".st-uni-status");
    if (box) {
      const html = statusHtml();
      if (html !== lastStatus) {
        const open = !!box.querySelector?.(".st-uni-list")?.open;
        box.innerHTML = html;
        if (open) {
          const d = box.querySelector?.(".st-uni-list");
          if (d) d.open = true;
        }
        lastStatus = html;
      }
    }
    const tf = el.querySelector(".st-tf-status");
    if (tf) tf.innerHTML = marketFilterHtml();
  }

  // ── Trendfilter ──
  function trendChipHtml() {
    const on = trendFilterActive(state.draft.ensemble?.trendFilter);
    return `<span class="pn-chip ${on ? "pn-chip-acc" : ""}">${on ? "aan" : "uit"}</span>`;
  }

  function marketFilterHtml() {
    const mf = state.snap?.marketFilter;
    if (!mf || !mf.note) return "";
    const cls = mf.ok === true ? "is-ok" : mf.ok === false ? "is-block" : "is-unknown";
    return `<div class="st-tf-now ${cls}" title="Stand van het marktfilter nu"><span class="st-uni-dot" aria-hidden="true"></span><span>${esc(mf.note)}</span></div>`;
  }

  function trendHtml() {
    const tf = state.draft.ensemble?.trendFilter || {};
    const on = trendFilterActive(tf);
    const sw = (key, title, help) => `<label class="st-switch-row">
        <span class="pn-switch"><input type="checkbox" data-path="ensemble.trendFilter.${key}" ${tf[key] ? "checked" : ""}><i></i></span>
        <span><b>${title}</b><span class="st-help">${help}</span></span>
      </label>`;
    const iv = tf.interval === "4h" ? "4h" : "1d";
    const seg = (v, label) =>
      `<button type="button" data-tf-interval="${v}" role="radio" aria-checked="${iv === v}" class="${iv === v ? "is-active" : ""}">${label}</button>`;
    return `
      <p class="pn-hint">Het trendfilter houdt alleen <b>nieuwe aankopen</b> tegen; verkopen, stop-losses en winstdoelen gaan altijd gewoon door.
        In ons onderzoek op echte dagkoersen (2016–2026) was dit het enige idee dat ook buiten de testperiode standhield, vooral doordat het grote dalingen ontweek.
        Let op: in een dalende markt koopt de bot daardoor soms <b>wekenlang niets</b>. Dat is dan precies de bedoeling.</p>
      ${sw("market", "Marktfilter: alleen kopen als Bitcoin boven zijn gemiddelde staat",
        "Zakt Bitcoin onder zijn gemiddelde, dan koopt de bot geen enkele munt: als Bitcoin daalt, dalen de meeste munten mee. Aanbevolen: aan.")}
      ${sw("coin", "Muntfilter: alleen kopen als de munt zelf boven zijn gemiddelde staat",
        "Strenger: de munt moet zelf ook in een stijgende trend zitten. Dat geeft minder aankopen.")}
      <div class="bt-row2 st-row2 st-tf-params ${on ? "" : "is-off"}">
        <div class="st-field ${state.invalid.has("ensemble.trendFilter.interval") ? "is-invalid" : ""}" data-field="ensemble.trendFilter.interval">
          <label>Tijdschaal</label>
          <div class="pn-seg st-tf-seg" role="radiogroup" aria-label="Tijdschaal van het trendfilter">${seg("1d", "Dag")}${seg("4h", "4 uur")}</div>
          <div class="st-help">Dag is rustig; 4 uur reageert sneller, maar geeft vaker vals alarm.</div>
        </div>
        ${numField({ path: "ensemble.trendFilter.period", key: "period", label: "Gemiddelde over", unit: trendPeriodUnit(iv), step: 1, min: 5, max: 200,
          help: iv === "4h" ? "Aantal blokken van 4 uur (5–200)." : "Aantal dagen (5–200). 50 dagen is gebruikelijk." })}
      </div>
      <div class="st-tf-status">${marketFilterHtml()}</div>`;
  }

  function renderTrend() {
    const box = el.querySelector(".st-tf");
    if (box) box.innerHTML = trendHtml();
    const chip = el.querySelector(".st-tf-chip");
    if (chip) chip.innerHTML = trendChipHtml();
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
          <label for="st-buy">Koopdrempel <b class="mono pos st-val">${esc(buy.toFixed(2).replace(".", ","))}</b></label>
          <input id="st-buy" type="range" class="st-range st-range-buy" min="0.05" max="1" step="0.05" value="${buy}" data-path="ensemble.buyThreshold" data-key="buyThreshold" data-scale="1">
          <div class="st-help">Hoger = strenger: minder, maar sterkere koopsignalen.</div>
        </div>
        <div class="st-field ${state.invalid.has("ensemble.sellThreshold") ? "is-invalid" : ""}" data-field="ensemble.sellThreshold">
          <label for="st-sell">Verkoopdrempel <b class="mono neg st-val">${esc(sell.toFixed(2).replace(".", ",").replace("-", "−"))}</b></label>
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
            <b class="mono st-val">${esc(w.toFixed(1).replace(".", ","))}</b>
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
    warnings.push(...feeWarnings(r));
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
      ["Live handel ingeschakeld", mode === "live" ? (armed ? '<span class="neg"><b>JA — plaatst echte orders</b></span>' : '<span class="pos">Nee — alleen signalen</span>') : '<span class="muted">n.v.t.</span>'],
      // Meerdere bots: een oefenbot heeft zijn eigen budget; de kapitaallimiet geldt alleen voor de live-bot
      mode !== "live" && multiBot()
        ? ["Budget (oefengeld)", info && Number.isFinite(info.paperStartingCapital) ? `<span class="mono">${esc(fmt.eur(info.paperStartingCapital))}</span>` : "–"]
        : ["Kapitaallimiet", info ? `<span class="mono">${esc(fmt.eur(info.capitalLimitQuote))}</span>` : "–"],
      ["Versie", esc(info?.version || "–")],
    ];
    // Meerdere bots: LIVE_BOT kiest de ENE bot die met echt geld handelt (anders start het programma niet)
    const bot = thisBot();
    const env = `TRADING_MODE=live${bot ? `
LIVE_BOT=${bot.id}` : ""}
BITVAVO_API_KEY=jouw-api-key
BITVAVO_API_SECRET=jouw-api-secret
CAPITAL_LIMIT_EUR=50`;
    box.innerHTML = `
      <div class="pn-head"><div class="panel-title">Live handel</div></div>
      <div class="st-kv">${rows.map(([k, v]) => `<div><span class="muted">${esc(k)}</span><span>${v}</span></div>`).join("")}</div>
      ${
        mode === "live"
          ? armed
            ? `<div class="pn-banner pn-banner-bad"><b>Live handel staat AAN.</b> De bot plaatst echte orders met maximaal ${esc(fmt.eur(info?.capitalLimitQuote))} van je saldo.</div>
               <button type="button" class="btn btn-primary st-disarm">Uitschakelen (stop echte orders)</button>`
            : `<div class="pn-banner pn-banner-warn">De bot draait in live mode maar live handel is <b>niet ingeschakeld</b>: hij rekent alles door en logt "zou kopen…", maar plaatst geen echte orders.</div>
               <button type="button" class="btn btn-danger st-arm" ${info && !info.hasApiKeys ? "disabled" : ""}>Live handel inschakelen…</button>
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
              ${
                bot
                  ? `<p class="st-help"><span class="mono">LIVE_BOT=${esc(bot.id)}</span> kiest ${esc(bot.name)} als de enige bot die met echt geld handelt
                     (er mag er maar één zijn); de andere bots blijven oefenen met nep-geld. <span class="mono">CAPITAL_LIMIT_EUR</span> is het budget van die live-bot.</p>`
                  : ""
              }
              <ol start="3">
                <li>Herstart de bot. In live mode start hij nooit vanzelf en plaatst hij pas echte orders nadat je hier (of bovenaan) op <b>Live handel inschakelen…</b> klikt.</li>
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
      title: "Live handel inschakelen",
      danger: true,
      requireText: ARM_TEXT,
      confirmText: "Inschakelen",
      cancelText: "Annuleren",
      bodyHtml: `<p>Na inschakelen plaatst de bot <strong>echte orders met echt geld</strong> op Bitvavo${
        Number.isFinite(limit) ? `, met maximaal <strong>${esc(fmt.eur(limit))}</strong> van je saldo` : ""
      }.</p>
        <ul>
          <li>Je kunt je hele inzet verliezen. Backtests en paper trading zijn geen garantie.</li>
          <li>Fees (0,25% per kant) en slippage gaan van je saldo af.</li>
          <li>Je kunt live handel altijd weer uitschakelen of de noodstop gebruiken.</li>
        </ul>
        <p>Typ hieronder exact <strong>${esc(ARM_TEXT)}</strong> om te bevestigen.</p>`,
      onConfirm: async (value) => {
        const typed = typeof value === "string" && value ? value : document.querySelector(".modal-input input")?.value?.trim() || "";
        if (typed !== ARM_TEXT) throw new Error(`Typ exact: ${ARM_TEXT}`);
        const info = await api.arm(typed);
        state.info = info;
        renderLive();
        bus.emit("app-info", info);
        ctx.toast("Live handel ingeschakeld — de bot handelt nu met echt geld", "warn");
      },
    });
  }

  async function disarm() {
    try {
      const info = await api.disarm();
      state.info = info;
      renderLive();
      bus.emit("app-info", info);
      ctx.toast("Live handel uitgeschakeld — alleen signalen", "success");
    } catch (err) {
      ctx.toast(`Uitschakelen mislukt: ${err?.message || err}`, "error");
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

  function pathLabel(path) {
    const f = RISK_GROUPS.flatMap((g) => g.fields).find((x) => `risk.${x.key}` === path);
    if (f) return f.label;
    const labels = {
      markets: "Munten",
      interval: "Candle-interval",
      pollMs: "Ververs elke",
      historyCandles: "Historie per analyse",
      "ensemble.enabled": "Strategieën",
      "ensemble.buyThreshold": "Koopdrempel",
      "ensemble.sellThreshold": "Verkoopdrempel",
      "ensemble.regimeFilter": "Regimefilter",
      "ensemble.trendFilter.market": "Marktfilter (Bitcoin)",
      "ensemble.trendFilter.coin": "Muntfilter",
      "ensemble.trendFilter.interval": "Tijdschaal trendfilter",
      "ensemble.trendFilter.period": "Periode trendfilter",
      "universe.mode": "Muntkeuze (automatisch / zelf kiezen)",
      "universe.count": "Aantal munten",
      "universe.minVolumeEur": "Minimaal 24u-volume",
    };
    if (labels[path]) return labels[path];
    const m = path.match(/^ensemble\.(weights|params)\.(.+)$/);
    if (m) {
      const name = state.strategies.find((x) => x.id === m[2])?.name || m[2];
      return m[1] === "weights" ? `Gewicht ${name}` : `Parameters ${name}`;
    }
    return path;
  }

  function renderNotice() {
    const box = el.querySelector(".st-notice");
    if (!box) return;
    const n = state.notice;
    box.hidden = !n;
    box.innerHTML = n
      ? `<div class="pn-banner pn-banner-warn" role="status"><b>Instellingen zijn elders gewijzigd</b> (bijv. via Scanner/Backtest of een ander tabblad).
          Die wijzigingen zijn overgenomen; ${
            n.conflicts.length
              ? `bij <b>${esc(n.conflicts.map(pathLabel).join(", "))}</b> is jouw (nog niet opgeslagen) waarde aangehouden. Controleer voor opslaan.`
              : "controleer voor opslaan."
          }</div>`
      : "";
  }

  /** Opnieuw tekenen zonder de focus van het veld waarin je typt te verliezen */
  function rerenderKeepFocus() {
    const a = typeof document !== "undefined" ? document.activeElement : null;
    const path = a && typeof el.contains === "function" && el.contains(a) ? a.dataset?.path : null;
    renderAll();
    if (path && typeof CSS !== "undefined") el.querySelector(`[data-path="${CSS.escape(path)}"]`)?.focus?.();
  }

  /**
   * Nieuwe serverconfig (van dit paneel, Scanner, Backtest of een ander tabblad).
   * Zonder eigen wijzigingen: gewoon overnemen. Met eigen wijzigingen: het concept
   * erop overzetten, zodat Opslaan niets terugdraait wat elders is veranderd.
   * @returns {{ conflicts: string[] }}
   */
  function applyServerConfig(cfg) {
    const next = withDefaults(cfg);
    if (!state.server || stable(next) === stable(state.server)) return { conflicts: [] };
    if (!dirty()) {
      state.server = next;
      state.draft = clone(next);
      state.notice = null;
      renderAll();
      return { conflicts: [] };
    }
    const r = rebaseDraft(state.draft, state.server, next);
    state.server = next;
    state.draft = r.draft;
    if (r.conflicts.length) state.notice = { conflicts: r.conflicts };
    if (r.changed || r.conflicts.length) rerenderKeepFocus();
    else updateDirty();
    return r;
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
    const { errors, invalid } = validateDraft(state.draft, { fmt, maxMarkets: MAX_MARKETS });
    state.invalid = invalid;
    return errors;
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
    // Eerst de actuele serverconfig: is er intussen elders iets gewijzigd?
    state.saving = true;
    updateDirty();
    let fresh = null;
    try {
      fresh = await api.getConfig();
    } catch {
      /* dan tegen de laatst bekende config */
    }
    state.saving = false;
    if (fresh && applyServerConfig(fresh).conflicts.length) {
      updateDirty();
      el.querySelector(".st-notice")?.scrollIntoView({ behavior: "smooth", block: "center" });
      ctx.toast("Instellingen zijn intussen elders gewijzigd — controleer ze en klik opnieuw op Opslaan.", "warn");
      return;
    }
    if (!dirty()) {
      updateDirty();
      ctx.toast("Geen wijzigingen om op te slaan.", "info");
      return;
    }
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
      const next = await api.putConfig(buildPatch(state.draft, state.server));
      state.server = withDefaults(next);
      state.draft = clone(state.server);
      state.notice = null;
      state.errors = [];
      state.invalid.clear();
      state.saving = false;
      renderAll();
      bus.emit("config-changed", next);
      ctx.toast("Instellingen opgeslagen. De bot gebruikt ze vanaf de volgende tick.", "success");
    } catch (err) {
      state.saving = false;
      const msg = err?.message || String(err);
      state.errors = msg.split(/(?<=[.!?)])\s+(?=[A-Z])/).filter(Boolean);
      if (/\b(takerFee|makerFee|slippagePct)\b/.test(msg))
        state.errors.push("Let op: de server noemt fees en slippage als fractie (0,0025 = 0,25%). In dit formulier vul je ze in als percentage.");
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
      renderMarketLists();
      return;
    }
    const path = t.dataset?.path;
    if (!path || !state.draft) return;
    if (t.type === "checkbox") setPath(state.draft, path, t.checked);
    else if (t.tagName === "SELECT") setPath(state.draft, path, t.value);
    else if (t.dataset.grouped) {
      // Bedrag in hele euro's; punten en spaties zijn duizendtallen (250.000), een komma is de decimaal
      const raw = String(t.value).replace(/[.\s€]/g, "").replace(",", ".");
      const n = raw === "" ? NaN : Number(raw);
      setPath(state.draft, path, Number.isFinite(n) ? n : NaN);
    } else {
      const scale = Number(t.dataset.scale) || 1;
      const n = parseNum(t.value);
      setPath(state.draft, path, Number.isFinite(n) ? round(n / scale, 10) : NaN);
    }
    if (state.invalid.has(path)) setInvalid(path, false);
    // Live feedback zonder de invoervelden opnieuw te tekenen
    if (t.type === "range") {
      const v = t.closest(".st-field, .st-weight")?.querySelector(".st-val");
      if (v) v.textContent = Number(t.value).toFixed(path.includes("weights") ? 1 : 2).replace(".", ",").replace("-", "−");
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
    if (path === "risk.maxOpenPositions") {
      const h = el.querySelector(".st-uni-pos");
      if (h) h.innerHTML = posHintHtml();
    }
    if (path.startsWith("universe.")) updateUniverseLive();
    if (path.startsWith("ensemble.trendFilter.")) {
      const on = trendFilterActive(state.draft.ensemble.trendFilter);
      el.querySelector(".st-tf-params")?.classList.toggle("is-off", !on);
      const chip = el.querySelector(".st-tf-chip");
      if (chip) chip.innerHTML = trendChipHtml();
    }
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
    const d = t.dataset;
    const setMarkets = (list) => {
      state.draft.markets = list;
      setInvalid("markets", false);
      renderMarketLists();
      updateDirty();
    };
    if (d.remove) {
      setMarkets((state.draft.markets || []).filter((m) => m !== d.remove));
    } else if (d.add) {
      const cur = state.draft.markets || [];
      if (cur.length >= MAX_MARKETS) return ctx.toast(`Maximaal ${MAX_MARKETS} munten.`, "warn");
      if (!cur.includes(d.add)) setMarkets([...cur, d.add]);
    } else if (d.uniMode) {
      if (d.uniMode === uniMode()) return;
      state.draft.universe = { ...(state.draft.universe || {}), mode: d.uniMode === "auto" ? "auto" : "manual" };
      setInvalid("markets", false);
      renderAll();
      // Focus terug op de schakelaar (toetsenbord), niet naar boven springen
      el.querySelector(`[data-uni-mode="${uniMode()}"]`)?.focus?.({ preventScroll: true });
    } else if (d.uniCount) {
      const n = Number(d.uniCount);
      state.draft.universe = { ...(state.draft.universe || {}), count: n };
      const input = el.querySelector("#st-universe-count");
      if (input) input.value = String(n);
      setInvalid("universe.count", false);
      updateUniverseLive();
      updateDirty();
    } else if (d.tfInterval) {
      state.draft.ensemble.trendFilter = { ...(state.draft.ensemble.trendFilter || {}), interval: d.tfInterval === "4h" ? "4h" : "1d" };
      setInvalid("ensemble.trendFilter.interval", false);
      renderTrend();
      updateDirty();
    } else if (d.act === "chips-more" || d.act === "chips-less") {
      state.chipsExpanded = d.act === "chips-more";
      renderMarketLists();
    } else if (d.act === "markets-all") {
      const all = orderedMarkets();
      const r = addAllMarkets(state.draft.markets, all, MAX_MARKETS);
      if (!r.added) return;
      const had = new Set(state.draft.markets || []);
      const skipped = all.filter((m) => !had.has(m) && isExcludedMarket(m)).length;
      setMarkets(r.markets);
      ctx.toast(
        `${r.added} ${r.added === 1 ? "munt" : "munten"} toegevoegd (${r.markets.length}/${MAX_MARKETS}), meeste handel eerst.` +
          (skipped
            ? ` Overgeslagen, net als bij Automatisch: ${skipped} ${skipped === 1 ? "stablecoin, goud- of verpakte munt" : "stablecoins, goud- en verpakte munten"}.`
            : "") +
          " Klik op Opslaan om het te bewaren.",
        "info",
      );
    } else if (d.act === "markets-clear") {
      state.chipsExpanded = false;
      setMarkets([]);
      ctx.toast("Lijst gewist. Kies minstens één munt voordat je opslaat.", "info");
    } else if (d.act === "markets-copy-active") {
      const act = activeMarkets();
      if (!act?.length) return;
      setMarkets([...new Set(act)].slice(0, MAX_MARKETS));
      ctx.toast("De munten van de automatische keuze staan nu in je eigen lijst. Klik op Opslaan om het te bewaren.", "info");
    } else if (d.act === "save") save();
    else if (t.dataset.act === "discard") {
      state.draft = clone(state.server);
      state.notice = null;
      state.errors = [];
      state.invalid.clear();
      renderAll();
      ctx.toast("Wijzigingen ongedaan gemaakt.", "info");
    } else if (t.dataset.act === "defaults") {
      // De standaard van DEZE bot (zijn profiel), niet de algemene fabrieksinstellingen
      const d = defaultsFor(state.info);
      state.draft = clone(d.config);
      state.errors = [];
      state.invalid.clear();
      renderAll();
      ctx.toast(
        d.profile && d.name
          ? `Standaardwaarden van ${d.name} ingevuld. Klik op Opslaan om ze te bewaren.`
          : "Standaardwaarden ingevuld. Klik op Opslaan om ze te bewaren.",
        "info",
      );
    }
  });

  bus.on("config-changed", (cfg) => {
    if (!cfg || !state.server) return;
    applyServerConfig({ ...state.server, ...cfg });
  });
  /** Teksten die van de bot afhangen bijwerken, zonder het formulier opnieuw te tekenen */
  function renderBotTexts() {
    const where = el.querySelector(".st-where");
    if (where) where.innerHTML = whereHtml();
    const btn = el.querySelector('[data-act="defaults"]');
    if (btn) btn.title = defaultsTitle();
    renderLive();
  }
  bus.on("app-info", (info) => {
    if (info && typeof info === "object") {
      state.info = info;
      renderBotTexts();
    }
  });
  bus.on("bots", (d) => {
    if (!d || !Array.isArray(d.bots)) return;
    const was = multiBot();
    state.botCount = d.bots.length;
    if (multiBot() !== was) renderBotTexts();
  });
  let lastLive = "";
  bus.on("snapshot", (s) => {
    if (s && typeof s === "object") state.snap = s;
    // Config gewijzigd in een ander tabblad/venster: de engine stuurt hem mee in elke snapshot
    if (s?.config && state.server && !state.saving) applyServerConfig(s.config);
    if (state.draft) updateStatus();
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
    // Zorg dat alle risicovelden bestaan (oudere configs)
    state.server = withDefaults(cfg.value);
    state.draft = clone(state.server);
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
