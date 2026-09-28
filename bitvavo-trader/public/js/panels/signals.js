// Paneel "Signaal" (live tab): ensemble-beslissing voor de geselecteerde markt.
// Toont een grote actie-badge, een halve-cirkelmeter van de score (−1..+1) met
// de koop/verkoop-drempels, het marktregime en de stem van elke strategie.

const INTERVAL_MS = {
  "1m": 6e4, "5m": 3e5, "15m": 9e5, "30m": 18e5, "1h": 36e5, "2h": 72e5,
  "4h": 144e5, "6h": 216e5, "8h": 288e5, "12h": 432e5, "1d": 864e5,
};

const FALLBACK_NAMES = {
  "ema-trend": "EMA-trend",
  "rsi-reversion": "RSI-omkeer",
  breakout: "Uitbraak",
  "macd-momentum": "MACD-momentum",
  "vwap-reversion": "VWAP-omkeer",
};

const REGIME_HELP = {
  "trend-up": "De koers stijgt duidelijk: trendvolgende strategieën tellen zwaarder.",
  "trend-down": "De koers daalt: de bot koopt dan niet (regimefilter).",
  range: "De koers beweegt zijwaarts: omkeer-strategieën (RSI, VWAP) werken dan het best.",
  volatile: "Grote, onrustige bewegingen: meer risico, stops worden sneller geraakt.",
  unknown: "Nog te weinig candles om het regime te bepalen.",
};

const NF2 = new Intl.NumberFormat("nl-NL", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

// Gauge-geometrie (SVG viewBox 0 0 240 142)
const CX = 120;
const CY = 122;
const R = 96; // buitenring (zones)
const RI = 78; // binnenring (score-boog)

function ensureCss() {
  if (document.querySelector('link[href$="panels.css"]')) return;
  const l = document.createElement("link");
  l.rel = "stylesheet";
  l.href = new URL("../../css/panels.css", import.meta.url).href;
  document.head.append(l);
}

function regimeIcon(regime) {
  const p = {
    "trend-up": '<polyline points="1.5,11.5 5.5,7 8.5,9.5 13,4"/><polyline points="9.5,4 13,4 13,7.5"/>',
    "trend-down": '<polyline points="1.5,3.5 5.5,8 8.5,5.5 13,11"/><polyline points="9.5,11 13,11 13,7.5"/>',
    range: '<line x1="1.5" y1="7.5" x2="13.5" y2="7.5"/><polyline points="4,5 1.5,7.5 4,10"/><polyline points="11,5 13.5,7.5 11,10"/>',
    volatile: '<polyline points="1,8 3,3.5 5.2,11.5 7.4,2.5 9.6,12 11.8,4.5 14,8"/>',
    unknown: '<circle cx="7.5" cy="7.5" r="6"/><path d="M5.6 5.8a2 2 0 1 1 2.6 1.9c-.5.2-.7.6-.7 1.1v.4"/><circle cx="7.5" cy="11" r=".4"/>',
  }[regime] || "";
  return `<svg class="pn-ico" viewBox="0 0 15 15" aria-hidden="true">${p}</svg>`;
}

function actionIcon(action) {
  if (action === "buy") return '<svg class="pn-ico" viewBox="0 0 15 15" aria-hidden="true"><polyline points="3,9.5 7.5,5 12,9.5"/></svg>';
  if (action === "sell") return '<svg class="pn-ico" viewBox="0 0 15 15" aria-hidden="true"><polyline points="3,5.5 7.5,10 12,5.5"/></svg>';
  return '<svg class="pn-ico" viewBox="0 0 15 15" aria-hidden="true"><line x1="3" y1="7.5" x2="12" y2="7.5"/></svg>';
}

function pt(score, r) {
  const s = Math.max(-1, Math.min(1, score));
  const th = (Math.PI * (1 - s)) / 2;
  return [CX + r * Math.cos(th), CY - r * Math.sin(th)];
}

function arc(s1, s2, r) {
  const [x1, y1] = pt(s1, r);
  const [x2, y2] = pt(s2, r);
  return `M${x1.toFixed(2)} ${y1.toFixed(2)} A${r} ${r} 0 0 1 ${x2.toFixed(2)} ${y2.toFixed(2)}`;
}

export function mountSignals(ctx, el) {
  ensureCss();
  const { fmt, esc, bus, api } = ctx;
  if (!el) return;

  let snap = ctx.getState?.() || null;
  let config = snap?.config || null;
  let market = ctx.getSelectedMarket?.() || config?.markets?.[0] || null;
  const decisions = { ...(snap?.decisions || {}) };
  const names = { ...FALLBACK_NAMES };
  let lastSig = "";
  let lastGaugeSig = "";
  let raf = 0;

  el.classList.add("sig");
  el.innerHTML = `
    <div class="pn-head">
      <div class="panel-title">Signaal <span class="sig-market"></span></div>
      <div class="pn-head-meta sig-time muted"></div>
    </div>
    <div class="sig-body">
      <div class="sig-gauge-wrap">
        <svg class="sig-gauge" viewBox="0 0 240 142" role="img" aria-label="Ensemble-score">
          <g class="sig-zones"></g>
          <path class="sig-inner-track" d="${arc(-1, 1, RI)}"/>
          <path class="sig-value" d="${arc(-1, 1, RI)}" pathLength="1000"/>
          <line class="sig-zero" x1="${CX}" y1="${CY - RI + 7}" x2="${CX}" y2="${CY - RI - 7}"/>
          <g class="sig-ticks"></g>
          <g class="sig-ptr" style="transform:rotate(90deg)">
            <circle cx="${CX - R}" cy="${CY}" r="7.5" class="sig-ptr-dot"/>
          </g>
          <text x="${CX}" y="${CY - 22}" class="sig-score-txt" text-anchor="middle">–</text>
          <text x="${CX}" y="${CY - 4}" class="sig-score-lbl" text-anchor="middle">SCORE</text>
          <text x="${CX - R}" y="${CY + 17}" class="sig-end" text-anchor="middle">−1</text>
          <text x="${CX + R}" y="${CY + 17}" class="sig-end" text-anchor="middle">+1</text>
        </svg>
      </div>
      <div class="sig-side">
        <div class="sig-action" data-a="hold"><span class="sig-action-ico"></span><span class="sig-action-txt">WACHT</span></div>
        <div class="sig-conf"><span class="muted">Zekerheid</span> <b class="sig-conf-val">–</b></div>
        <div class="sig-regime pn-chip" data-r="unknown"></div>
        <div class="sig-price muted"></div>
      </div>
    </div>
    <div class="sig-votes-head"><span>Stemmen per strategie</span><span class="muted">zekerheid</span></div>
    <div class="sig-votes"></div>
    <details class="pn-help">
      <summary>Hoe werkt dit?</summary>
      <p>Vijf strategieën bekijken elke gesloten candle en stemmen <b>KOOP</b>, <b>VERKOOP</b> of <b>WACHT</b>, elk met een zekerheid.
      De gewogen som is de <b>score</b> van −1 tot +1. Komt de score in de groene zone (boven de koopdrempel), dan koopt de bot;
      in de rode zone (onder de verkoopdrempel) verkoopt hij een open positie. Het <b>regime</b> bepaalt welke strategieën zwaarder tellen.</p>
    </details>`;

  const $ = (s) => el.querySelector(s);
  const q = {
    market: $(".sig-market"),
    time: $(".sig-time"),
    zones: $(".sig-zones"),
    ticks: $(".sig-ticks"),
    value: $(".sig-value"),
    ptr: $(".sig-ptr"),
    ptrDot: $(".sig-ptr-dot"),
    scoreTxt: $(".sig-score-txt"),
    action: $(".sig-action"),
    actionIco: $(".sig-action-ico"),
    actionTxt: $(".sig-action-txt"),
    conf: $(".sig-conf-val"),
    regime: $(".sig-regime"),
    price: $(".sig-price"),
    votes: $(".sig-votes"),
    body: $(".sig-body"),
  };

  function thresholds() {
    const e = config?.ensemble || {};
    return {
      buy: Number.isFinite(e.buyThreshold) ? e.buyThreshold : 0.35,
      sell: Number.isFinite(e.sellThreshold) ? e.sellThreshold : -0.3,
    };
  }

  function renderGaugeStatic() {
    const { buy, sell } = thresholds();
    const sig = `${buy}|${sell}`;
    if (sig === lastGaugeSig) return;
    lastGaugeSig = sig;
    q.zones.innerHTML = `
      <path class="sig-track" d="${arc(-1, 1, R)}"/>
      <path class="sig-zone sig-zone-sell" d="${arc(-1, sell, R)}"><title>Verkoopzone (score ≤ ${esc(fmt.num(sell, 2))})</title></path>
      <path class="sig-zone sig-zone-hold" d="${arc(sell, buy, R)}"><title>Wachtzone</title></path>
      <path class="sig-zone sig-zone-buy" d="${arc(buy, 1, R)}"><title>Koopzone (score ≥ ${esc(fmt.num(buy, 2))})</title></path>`;
    const tick = (s, cls, label) => {
      const [x1, y1] = pt(s, R + 9);
      const [x2, y2] = pt(s, R - 9);
      const [lx, ly] = pt(s, R + 19);
      return `<line class="sig-tick ${cls}" x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}"/>
        <text class="sig-tick-lbl ${cls}" x="${lx}" y="${ly + 3}" text-anchor="middle">${esc(label)}</text>`;
    };
    q.ticks.innerHTML =
      tick(sell, "sell", fmt.num(sell, 2)) + tick(buy, "buy", (buy > 0 ? "+" : "") + fmt.num(buy, 2));
  }

  function renderEmpty(msg) {
    q.body.classList.add("is-empty");
    q.scoreTxt.textContent = "–";
    q.value.style.strokeDasharray = "0 1000";
    q.ptr.style.transform = "rotate(90deg)";
    q.ptrDot.dataset.a = "hold";
    q.action.dataset.a = "none";
    q.actionIco.innerHTML = "";
    q.actionTxt.textContent = "GEEN DATA";
    q.conf.textContent = "–";
    q.regime.dataset.r = "unknown";
    q.regime.innerHTML = `${regimeIcon("unknown")}<span>Regime onbekend</span>`;
    q.price.textContent = "";
    q.time.textContent = "";
    q.votes.innerHTML = `<div class="pn-empty">${esc(msg)}</div>`;
  }

  function render() {
    raf = 0;
    renderGaugeStatic();
    q.market.textContent = market ? `· ${market}` : "";
    const d = market ? decisions[market] : null;
    if (!market) return renderEmpty("Nog geen markt geselecteerd.");
    if (!d) {
      lastSig = "";
      return renderEmpty(
        `Nog geen beslissing voor ${market}. De bot beoordeelt alleen gesloten candles — start de bot of wacht op de volgende candle.`,
      );
    }
    const sig = `${market}|${d.time}|${d.score}|${d.action}|${d.regime}|${lastGaugeSig}|${Object.keys(names).length}`;
    if (sig === lastSig) return;
    lastSig = sig;
    q.body.classList.remove("is-empty");

    const score = Math.max(-1, Math.min(1, Number(d.score) || 0));
    // Score-boog vanaf 0 naar de score (pathLength = 1000 → helft = 500)
    const len = Math.abs(score) * 500;
    const start = score >= 0 ? 500 : 500 - len;
    q.value.style.strokeDasharray = `${len.toFixed(1)} 1000`;
    q.value.style.strokeDashoffset = `${(-start).toFixed(1)}`;
    q.value.dataset.a = d.action;
    q.ptr.style.transform = `rotate(${((score + 1) / 2) * 180}deg)`;
    q.ptrDot.dataset.a = d.action;
    q.scoreTxt.textContent = (score > 0 ? "+" : "") + NF2.format(score);
    q.scoreTxt.dataset.a = d.action;

    q.action.dataset.a = d.action;
    q.actionIco.innerHTML = actionIcon(d.action);
    q.actionTxt.textContent = fmt.action(d.action);
    q.conf.textContent = fmt.pct((Number(d.confidence) || 0) * 100, 0, false);
    q.regime.dataset.r = d.regime;
    q.regime.innerHTML = `${regimeIcon(d.regime)}<span>${esc(fmt.regime(d.regime))}</span>`;
    q.regime.title = REGIME_HELP[d.regime] || "";

    const ivMs = INTERVAL_MS[config?.interval] || 0;
    const stale = ivMs && Date.now() - d.time > ivMs * 3;
    q.price.innerHTML = `Slotkoers <span class="mono">${esc(fmt.price(d.price))}</span>` +
      (Number.isFinite(d.atr) ? ` · ATR <span class="mono">${esc(fmt.price(d.atr))}</span>` : "");
    q.time.innerHTML = `candle ${esc(fmt.dateTime(d.time))}${config?.interval ? ` · ${esc(config.interval)}` : ""}` +
      (stale ? ' <span class="pn-chip pn-chip-warn">verouderd</span>' : "");

    const weights = config?.ensemble?.weights || {};
    const votes = Array.isArray(d.votes) ? d.votes : [];
    q.votes.innerHTML = votes.length
      ? votes
          .map((v) => {
            const c = Math.max(0, Math.min(1, Number(v.confidence) || 0));
            const w = weights[v.strategy];
            return `<div class="sig-vote" data-a="${esc(v.action)}">
              <div class="sig-vote-top">
                <span class="sig-vote-name">${esc(names[v.strategy] || v.strategy)}${
                  Number.isFinite(w) ? ` <span class="muted mono sig-vote-w" title="Gewicht in de ensemble-score">×${esc(fmt.num(w, 1))}</span>` : ""
                }</span>
                <span class="sig-pill" data-a="${esc(v.action)}">${esc(fmt.action(v.action))}</span>
                <span class="sig-bar" title="Zekerheid ${esc(fmt.pct(c * 100, 0, false))}"><i style="width:${(c * 100).toFixed(1)}%"></i></span>
                <span class="mono sig-vote-pct">${esc(fmt.num(c * 100, 0))}%</span>
              </div>
              <div class="sig-vote-reason muted">${esc(v.reason || "")}</div>
            </div>`;
          })
          .join("")
      : `<div class="pn-empty">Geen stemmen ontvangen.</div>`;
  }

  function schedule() {
    if (!raf) raf = requestAnimationFrame(render);
  }

  bus.on("snapshot", (s) => {
    if (!s) return;
    snap = s;
    config = s.config || config;
    Object.assign(decisions, s.decisions || {});
    if (!market) market = ctx.getSelectedMarket?.() || config?.markets?.[0] || null;
    schedule();
  });
  bus.on("decision", (d) => {
    if (!d || !d.market) return;
    const prev = decisions[d.market];
    if (!prev || d.time >= prev.time) decisions[d.market] = d;
    if (d.market === market) schedule();
  });
  bus.on("market-selected", (m) => {
    const next = m?.market || m;
    if (typeof next === "string" && next !== market) {
      market = next;
      lastSig = "";
      schedule();
    }
  });
  bus.on("config-changed", (c) => {
    if (c) config = c;
    schedule();
  });

  api
    .getStrategies()
    .then((list) => {
      for (const s of list || []) if (s?.id) names[s.id] = s.name || s.id;
      lastSig = "";
      schedule();
    })
    .catch(() => {});

  render();
}
