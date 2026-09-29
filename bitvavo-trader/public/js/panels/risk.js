// Paneel "Risico" (live tab): meters voor dagverlies, blootstelling, trades en
// open posities t.o.v. de ingestelde limieten, plus een banner als de bot de
// handel heeft stilgezet. Kleuren schuiven van groen → amber → rood.

function ensureCss() {
  if (document.querySelector('link[href$="panels.css"]')) return;
  const l = document.createElement("link");
  l.rel = "stylesheet";
  l.href = new URL("../../css/panels.css", import.meta.url).href;
  document.head.append(l);
}

const RING_R = 30;
const RING_C = 2 * Math.PI * RING_R;
const RING_VIS = RING_C * 0.75; // 270° boog

function level(ratio) {
  if (!Number.isFinite(ratio)) return "ok";
  if (ratio >= 0.85) return "bad";
  if (ratio >= 0.6) return "warn";
  return "ok";
}

export function mountRisk(ctx, el) {
  ensureCss();
  const { fmt, esc, bus } = ctx;
  if (!el) return;
  el.classList.add("risk");

  let snap = ctx.getState?.() || null;
  let raf = 0;
  let lastSig = "";

  function ring({ key, label, valueText, ratio, limitText, help }) {
    const r = Math.max(0, Math.min(1, Number.isFinite(ratio) ? ratio : 0));
    const lv = level(ratio);
    const icon = lv === "bad" ? "!" : lv === "warn" ? "▲" : "✓";
    return `<div class="risk-g" data-lv="${lv}" data-k="${esc(key)}" title="${esc(help)}">
      <svg viewBox="0 0 80 80" class="risk-ring" aria-hidden="true">
        <circle cx="40" cy="40" r="${RING_R}" class="risk-track" style="stroke-dasharray:${RING_VIS.toFixed(2)} ${RING_C.toFixed(2)}"/>
        <circle cx="40" cy="40" r="${RING_R}" class="risk-val" style="stroke-dasharray:${(RING_VIS * r).toFixed(2)} ${RING_C.toFixed(2)}"/>
      </svg>
      <div class="risk-g-center">
        <div class="risk-g-val mono">${esc(valueText)}</div>
        <div class="risk-g-lim">${esc(limitText)}</div>
      </div>
      <div class="risk-g-lbl"><span class="risk-g-ico" aria-hidden="true">${icon}</span>${esc(label)}</div>
    </div>`;
  }

  function render() {
    raf = 0;
    const s = snap;
    if (!s || !s.account || !s.config) {
      el.innerHTML = `<div class="pn-head"><div class="panel-title">Risico</div></div>
        <div class="pn-empty">Wachten op gegevens van de bot…</div>`;
      lastSig = "";
      return;
    }
    const a = s.account;
    const rc = s.config.risk || {};
    const positions = Array.isArray(s.positions) ? s.positions : [];
    const equity = Number(a.equity) || 0;
    const dayStart = Number(a.dayStartEquity) || equity;
    // Dagresultaat van de engine (live correct na afromen of een gewijzigde limiet: dat
    // is een overboeking, geen verlies; dezelfde % als de dagelijkse verlieslimiet
    // gebruikt). Alleen bij een oudere server zelf rekenen.
    const isNum = (n) => typeof n === "number" && Number.isFinite(n);
    const dayPnl = isNum(a.dayPnlQuote) ? a.dayPnlQuote : equity - dayStart;
    const dayRet = isNum(a.dayReturnPct) ? a.dayReturnPct : dayStart > 0 ? (dayPnl / dayStart) * 100 : 0;
    const dayLossPct = Math.max(0, -dayRet);
    const exposure = positions.reduce(
      (sum, p) => sum + (Number(p.amount) || 0) * (Number(p.currentPrice) || Number(p.entryPrice) || 0),
      0,
    );
    const exposurePct = equity > 0 ? (exposure / equity) * 100 : 0;
    const tradesToday = Number(a.tradesToday) || 0;
    const openCount = positions.length;

    const sig = JSON.stringify([
      dayLossPct.toFixed(2), dayPnl.toFixed(2), exposurePct.toFixed(1), tradesToday, openCount, s.halted, a.feesPaid,
      rc.dailyLossLimitPct, rc.maxTotalExposurePct, rc.maxTradesPerDay, rc.maxOpenPositions, rc.riskPerTradePct,
      equity.toFixed(2), s.mode, s.liveArmed,
    ]);
    if (sig === lastSig) return;
    lastSig = sig;

    const gauges = [
      {
        key: "day",
        label: "Dagverlies",
        valueText: fmt.pct(dayLossPct, 1, false),
        ratio: rc.dailyLossLimitPct > 0 ? dayLossPct / rc.dailyLossLimitPct : 0,
        limitText: `max ${fmt.pct(rc.dailyLossLimitPct, 1, false)}`,
        help: `Verlies vandaag t.o.v. het saldo bij de start van de dag. Bij ${fmt.pct(rc.dailyLossLimitPct, 1, false)} stopt de bot met nieuwe trades tot morgen.`,
      },
      {
        key: "exp",
        label: "In crypto",
        valueText: fmt.pct(exposurePct, 0, false),
        ratio: rc.maxTotalExposurePct > 0 ? exposurePct / rc.maxTotalExposurePct : 0,
        limitText: `max ${fmt.pct(rc.maxTotalExposurePct, 0, false)}`,
        help: `Deel van je saldo dat nu in crypto zit (${fmt.eur(exposure)}). De rest staat veilig als euro's.`,
      },
      {
        key: "trades",
        label: "Trades",
        valueText: `${tradesToday}/${rc.maxTradesPerDay ?? "–"}`,
        ratio: rc.maxTradesPerDay > 0 ? tradesToday / rc.maxTradesPerDay : 0,
        limitText: "per dag",
        help: "Elke trade kost fees. Een daglimiet voorkomt overtraden.",
      },
      {
        key: "pos",
        label: "Posities",
        valueText: `${openCount}/${rc.maxOpenPositions ?? "–"}`,
        ratio: rc.maxOpenPositions > 0 ? openCount / rc.maxOpenPositions : 0,
        limitText: "tegelijk",
        help: "Aantal posities dat tegelijk open staat. Bij het maximum opent de bot geen nieuwe.",
      },
    ];
    const worst = gauges.reduce((m, g) => Math.max(m, Number.isFinite(g.ratio) ? g.ratio : 0), 0);
    const worstLv = level(worst);

    const halted = s.halted?.halted;
    const banner = halted
      ? `<div class="pn-banner pn-banner-bad pn-banner-ico risk-halt" role="alert">
          <svg class="pn-ico pn-ico-lg" viewBox="0 0 15 15" aria-hidden="true"><polygon points="4.6,1 10.4,1 14,4.6 14,10.4 10.4,14 4.6,14 1,10.4 1,4.6"/><line x1="5" y1="7.5" x2="10" y2="7.5"/></svg>
          <div><b>Handel gepauzeerd</b><div>${esc(s.halted.reason || "Een risicolimiet is bereikt.")}</div>
          <div class="muted">De bot opent geen nieuwe posities tot de limiet weer vrij is (meestal morgen).</div></div>
        </div>`
      : `<div class="risk-status" data-lv="${worstLv}">
          <span class="risk-status-dot"></span>
          ${worstLv === "ok" ? "Alle limieten ruim in orde" : worstLv === "warn" ? "Let op: een limiet komt in zicht" : "Een limiet is (bijna) bereikt"}
        </div>`;

    const riskEur = (equity * (Number(rc.riskPerTradePct) || 0)) / 100;
    const feesPct = a.startingEquity > 0 ? ((Number(a.feesPaid) || 0) / a.startingEquity) * 100 : NaN;
    const roundTrip = 2 * ((Number(rc.takerFee) || 0) + (Number(rc.slippagePct) || 0)) * 100;

    el.innerHTML = `
      <div class="pn-head">
        <div class="panel-title">Risico</div>
        <div class="pn-head-meta muted">saldo <span class="mono">${esc(fmt.eur(equity))}</span></div>
      </div>
      ${banner}
      <div class="risk-grid">${gauges.map(ring).join("")}</div>
      <div class="risk-kv">
        <div title="Resultaat sinds de start van de dag (incl. open posities)"><span class="muted">Dagresultaat</span><b class="mono ${fmt.pnlClass(dayPnl)}">${esc(fmt.eurSigned(dayPnl))}</b></div>
        <div title="Totaal betaalde fees sinds de start (Bitvavo rekent ${esc(fmt.pct((rc.takerFee || 0) * 100, 2, false))} per kant)"><span class="muted">Betaalde fees</span><b class="mono">${esc(fmt.eur(a.feesPaid))}${
          Number.isFinite(feesPct) ? ` <small class="muted">(${esc(fmt.pct(feesPct, 1, false))} van start)</small>` : ""
        }</b></div>
        <div title="Wat je maximaal verliest als de stop-loss van één trade geraakt wordt"><span class="muted">Max. risico per trade</span><b class="mono">${esc(fmt.eur(riskEur))} <small class="muted">(${esc(fmt.pct(rc.riskPerTradePct, 1, false))})</small></b></div>
        <div title="Kosten van één keer kopen + verkopen (fee + slippage, beide kanten)"><span class="muted">Kosten per rondje</span><b class="mono">${esc(fmt.pct(roundTrip, 2, false))}</b></div>
      </div>
      <p class="pn-hint">Deze limieten beschermen je saldo. Houd je muis boven een meter voor uitleg; aanpassen kan bij <b>Instellingen → Risicobeheer</b>.</p>`;
  }

  function schedule() {
    if (!raf) raf = requestAnimationFrame(render);
  }

  bus.on("snapshot", (s) => {
    if (!s) return;
    snap = s;
    schedule();
  });
  bus.on("config-changed", (c) => {
    if (c && snap) {
      snap = { ...snap, config: c };
      schedule();
    }
  });

  render();
}
