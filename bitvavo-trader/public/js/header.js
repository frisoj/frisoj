// Header (A9): accountstatistieken, bot-status, bot-bediening en de mode-banner.

const svg = (p, extra = "") =>
  `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" ${extra}>${p}</svg>`;
const I = {
  play: svg('<path d="M7 4.5v15l12-7.5z" fill="currentColor" stroke="none"/>'),
  pause: svg('<rect x="6" y="5" width="4" height="14" rx="1" fill="currentColor" stroke="none"/><rect x="14" y="5" width="4" height="14" rx="1" fill="currentColor" stroke="none"/>'),
  kill: svg('<path d="M7.9 2h8.2L22 7.9v8.2L16.1 22H7.9L2 16.1V7.9z"/><path d="M8 12h8"/>'),
  reset: svg('<path d="M3 12a9 9 0 1 0 3-6.7L3 8"/><path d="M3 3v5h5"/>'),
  shield: svg('<path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/><path d="m9 12 2 2 4-4"/>'),
  eye: svg('<path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7-10-7-10-7z"/><circle cx="12" cy="12" r="3"/>'),
  bolt: svg('<path d="M13 2 3 14h9l-1 8 10-12h-9z" fill="currentColor" stroke="none"/>'),
  flask: svg('<path d="M9 3h6"/><path d="M10 3v6L4.5 18.5A1.7 1.7 0 0 0 6 21h12a1.7 1.7 0 0 0 1.5-2.5L14 9V3"/>'),
  lock: svg('<rect x="4" y="11" width="16" height="10" rx="2"/><path d="M8 11V7a4 4 0 0 1 8 0v4"/>'),
  key: svg('<circle cx="7.5" cy="15.5" r="4.5"/><path d="m10.7 12.3 9.3-9.3M17 6l3 3M14 9l2 2"/>'),
};

let sparkSeq = 0;

/** Bitvavo weigert orders (ook verkopen) onder dit bedrag */
const MIN_ORDER_EUR = 5;

const posValue = (p) => (Number(p && p.amount) || 0) * (Number(p && p.currentPrice) || 0);
const isNum = (n) => typeof n === "number" && Number.isFinite(n);
/** Positie die nu niet verkocht kan worden (engine-vlag, of waarde onder het minimum) */
const isDust = (p, minOrder) => !!(p && (p.unsellable || posValue(p) < minOrder));

const STILL = "Let op: de bot staat stil, stop-loss en take-profit worden NIET bewaakt.";

/**
 * Uitkomst van een noodstop op basis van het antwoord van POST /api/engine/kill
 * (EngineSnapshot, met `killResult` als de server die meestuurt). De engine stopt
 * de bot óók als verkopen mislukken. Met `killResult.failed` tonen we precies welke
 * posities (of orders met onbekende uitkomst) NIET verkocht zijn en waarom; zonder
 * `killResult` gelden de posities die nog in `res.positions` staan als niet verkocht.
 * @returns {[string, "warn" | "error"]}
 */
export function killOutcome(res, fmt, minOrder = MIN_ORDER_EUR) {
  const left = res && Array.isArray(res.positions) ? res.positions : [];
  const failed = res && res.killResult && Array.isArray(res.killResult.failed) ? res.killResult.failed : null;
  // Vangnet: "niets mislukt" terwijl er nog posities openstaan → die tellen toch als niet verkocht
  if (failed && (failed.length || !left.length)) {
    if (!failed.length) return ["Noodstop uitgevoerd — alles verkocht, bot gestopt", "warn"];
    const byId = new Map(left.map((p) => [p.id, p]));
    const n = failed.length;
    const list = failed
      .map((f) => {
        const p = byId.get(f && f.id);
        const market = (f && f.market) || (p && p.market) || (f && f.id) || "?";
        const value = p ? ` ≈ ${fmt.eur(posValue(p))}` : "";
        return `${market}${value}: ${(f && f.reason) || "reden onbekend (zie het logboek)"}`;
      })
      .join("; ");
    const dust = failed.some((f) => isDust(byId.get(f && f.id), minOrder));
    return [
      `Noodstop: bot gestopt, maar ${n} ${n === 1 ? "positie" : "posities"} NIET verkocht — ${list}. ` +
        (dust
          ? `Een positie onder het Bitvavo-minimum van ${fmt.eur(minOrder)} kan niet verkocht worden: wacht tot de waarde weer boven ${fmt.eur(minOrder)} is of schrijf hem af (knop Afschrijven bij Open posities). `
          : "Controleer je account en sluit handmatig (of probeer de noodstop opnieuw). ") +
        STILL,
      "error",
    ];
  }
  if (!left.length) return ["Noodstop uitgevoerd — alles verkocht, bot gestopt", "warn"];
  const list = left.map((p) => `${p.market} ≈ ${fmt.eur(posValue(p))}`).join(", ");
  const dust = left.some((p) => isDust(p, minOrder));
  const n = left.length;
  return [
    `Noodstop: bot gestopt, maar ${n} ${n === 1 ? "positie" : "posities"} NIET verkocht (${list}). ` +
      (dust
        ? `Waarde onder het Bitvavo-minimum van ${fmt.eur(minOrder)}: die kan niet verkocht worden. Sluit handmatig of wacht tot de waarde weer boven ${fmt.eur(minOrder)} is. `
        : "Controleer je account en sluit handmatig (of probeer de noodstop opnieuw). ") +
      STILL,
    "error",
  ];
}

/**
 * Rendement in % voor de statistiekkaarten: de engine rekent dit zelf uit
 * (`account.totalReturnPct` / `dayReturnPct`, correct ook na het afromen van
 * winst boven de kapitaallimiet); alleen bij een oudere server zelf berekenen.
 * Het oorspronkelijke startbedrag is `startingEquity + skimmedQuote` (de engine
 * verlaagt de start met wat er afgeroomd is).
 * @returns {{ dayPnl: number, dayPct: number, totPnl: number, totPct: number, origStart: number, skimmed: number }}
 */
export function accountReturns(snap) {
  const a = (snap && snap.account) || {};
  const eq = a.equity;
  const start = a.startingEquity;
  const dayStart = a.dayStartEquity;
  const skimmed = isNum(snap && snap.skimmedQuote) && snap.skimmedQuote > 0 ? snap.skimmedQuote : 0;
  // equity − start is ook met afromen de juiste winst in euro's: (equity + afgeroomd) − (start + afgeroomd)
  const dayPnl = isNum(eq) && isNum(dayStart) ? eq - dayStart : NaN;
  const totPnl = isNum(eq) && isNum(start) ? eq - start : NaN;
  const dayPct = isNum(a.dayReturnPct) ? a.dayReturnPct : dayStart ? (dayPnl / dayStart) * 100 : NaN;
  const totPct = isNum(a.totalReturnPct) ? a.totalReturnPct : start ? (totPnl / start) * 100 : NaN;
  return { dayPnl, dayPct, totPnl, totPct, origStart: isNum(start) ? start + skimmed : start, skimmed };
}

export function mountHeader(ctx, { statsEl, controlsEl, bannerEl, alertEl }) {
  const { fmt, esc, api, bus } = ctx;
  let snap = ctx.getState();
  let info = ctx.getInfo ? ctx.getInfo() : null;
  let busy = false;
  const prevValues = {};
  const gradId = `eqg-${++sparkSeq}`;

  // ───────────── Statistiekkaarten ─────────────

  const card = (k, label, extraCls = "", tip = "") => `
    <div class="stat ${extraCls}" data-k="${k}" ${tip ? `title="${esc(tip)}"` : ""}>
      <div class="stat-label">${esc(label)}</div>
      <div class="stat-value" data-v><span class="stat-skeleton"></span></div>
      <div class="stat-sub" data-s>&nbsp;</div>
    </div>`;

  if (statsEl) {
    statsEl.innerHTML = `
      <div class="stat stat-hero" data-k="equity" title="Totale waarde van je account: cash + huidige waarde van open posities">
        <div class="stat-label">Equity</div>
        <div class="stat-value" data-v><span class="stat-skeleton"></span></div>
        <div class="stat-sub" data-s>&nbsp;</div>
        <svg class="spark" data-spark viewBox="0 0 100 34" preserveAspectRatio="none" aria-hidden="true"></svg>
      </div>
      ${card("day", "P&L vandaag", "", "Verandering van je equity sinds middernacht (incl. open posities)")}
      ${card("total", "Totale P&L", "", "Winst/verlies sinds de start van dit account")}
      ${card("cash", "Cash", "", "Vrij beschikbaar geld (niet in een positie)")}
      ${card("open", "Open posities", "", "Aantal open posities / maximum uit de risico-instellingen")}
      ${card("fees", "Betaalde fees", "", "Totaal betaalde handelskosten (Bitvavo taker fee)")}
      ${card("win", "Winrate", "", "Percentage winstgevende trades (laatste 200)")}
      <div class="stat stat-bot" data-k="bot">
        <div class="stat-label">Bot-status</div>
        <div class="bot-state">
          <span class="dot off" data-dot></span><span data-bs>Laden…</span>
          <span class="muted small mono" data-up></span>
          <span class="badge badge-red" data-halt hidden>HALTED</span>
        </div>
        <div class="stat-sub" data-tick>&nbsp;</div>
        <div class="stat-sub halt" data-haltreason hidden></div>
      </div>`;
  }

  const q = (k, sel) => statsEl && statsEl.querySelector(`[data-k="${k}"] ${sel}`);

  function setStat(k, valueHtml, subHtml, cls = "", num = null) {
    const v = q(k, "[data-v]");
    const s = q(k, "[data-s]");
    if (v) {
      v.innerHTML = valueHtml;
      v.className = `stat-value ${cls}`.trim();
      if (num !== null && Number.isFinite(num)) {
        const prev = prevValues[k];
        if (prev !== undefined && Math.abs(num - prev) > 1e-9) {
          v.classList.remove("flash-up", "flash-down");
          void v.offsetWidth;
          v.classList.add(num > prev ? "flash-up" : "flash-down");
        }
        prevValues[k] = num;
      }
    }
    if (s && subHtml !== undefined) s.innerHTML = subHtml;
  }

  function renderSpark(points) {
    const el = statsEl && statsEl.querySelector("[data-spark]");
    if (!el) return;
    // Live: equity + afgeroomde winst, zodat afromen geen nep-daling geeft
    const pts = (points || [])
      .slice(-240)
      .map((p) => p.equity + (Number(p.skimmed) || 0))
      .filter(Number.isFinite);
    if (pts.length < 2) {
      el.innerHTML = "";
      return;
    }
    let min = Math.min(...pts);
    let max = Math.max(...pts);
    const flat = max - min < Math.max(1e-9, Math.abs(max) * 1e-6);
    if (flat) {
      max += 1;
      min -= 1;
    }
    const n = pts.length;
    const xy = pts.map((v, i) => [(i / (n - 1)) * 100, 32 - ((v - min) / (max - min)) * 28]);
    const d = xy.map(([x, y], i) => `${i ? "L" : "M"}${x.toFixed(2)},${y.toFixed(2)}`).join("");
    const up = pts[n - 1] >= pts[0];
    const c = flat ? "var(--muted)" : up ? "var(--green)" : "var(--red)";
    el.innerHTML = `
      <defs><linearGradient id="${gradId}" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0" stop-color="${c}" stop-opacity="0.28"/><stop offset="1" stop-color="${c}" stop-opacity="0"/>
      </linearGradient></defs>
      ${flat ? "" : `<path d="${d}L100,34L0,34Z" fill="url(#${gradId})"/>`}
      <path d="${d}" fill="none" stroke="${c}" stroke-width="1.4" vector-effect="non-scaling-stroke"/>`;
  }

  function renderStats() {
    if (!snap || !statsEl) return;
    const a = snap.account || {};
    const eq = a.equity;
    const start = a.startingEquity;
    const paper = snap.mode === "paper";
    const { dayPnl, dayPct, totPnl, totPct, origStart, skimmed } = accountReturns(snap);

    setStat(
      "equity",
      esc(fmt.eur(eq)),
      paper
        ? `start ${esc(fmt.eur(start))}`
        : `limiet ${esc(fmt.eur(info && info.capitalLimitQuote != null ? info.capitalLimitQuote : origStart))}` +
            (skimmed > 0
              ? ` · <span title="Winst boven je kapitaallimiet: blijft op je Bitvavo-account, buiten het handelsbudget van de bot">afgeroomd ${esc(
                  fmt.eur(skimmed),
                )}</span>`
              : ""),
      "",
      eq,
    );
    renderSpark(snap.equityHistory);

    setStat(
      "day",
      esc(fmt.eurSigned(dayPnl)),
      `<span class="${fmt.pnlClass(dayPct)}">${esc(fmt.pct(dayPct))}</span> <span title="Gerealiseerd (afgesloten trades) vandaag: ${esc(
        fmt.eurSigned(a.realizedPnlToday),
      )}">sinds 00:00</span>`,
      fmt.pnlClass(dayPnl),
      dayPnl,
    );

    setStat(
      "total",
      esc(fmt.eurSigned(totPnl)),
      `<span class="${fmt.pnlClass(totPct)}">${esc(fmt.pct(totPct))}</span> t.o.v. ${esc(fmt.eur(origStart))}`,
      fmt.pnlClass(totPnl),
      totPnl,
    );

    const cashPct = eq > 0 ? (a.cashQuote / eq) * 100 : NaN;
    setStat(
      "cash",
      esc(fmt.eur(a.cashQuote)),
      `${esc(fmt.pct(cashPct, 0, false))} vrij<div class="meter"><i style="width:${
        Number.isFinite(cashPct) ? Math.max(0, Math.min(100, cashPct)).toFixed(1) : 0
      }%"></i></div>`,
    );

    const positions = snap.positions || [];
    const maxOpen = snap.config && snap.config.risk ? snap.config.risk.maxOpenPositions : null;
    const unreal = positions.reduce((s, p) => s + (Number(p.unrealizedPnl) || 0), 0);
    setStat(
      "open",
      `${positions.length}${maxOpen != null ? `<span class="muted"> / ${esc(maxOpen)}</span>` : ""}`,
      positions.length
        ? `open P&L <span class="${fmt.pnlClass(unreal)}">${esc(fmt.eurSigned(unreal))}</span>`
        : "geen open posities",
    );

    const maxTrades = snap.config && snap.config.risk ? snap.config.risk.maxTradesPerDay : null;
    setStat(
      "fees",
      esc(fmt.eur(a.feesPaid)),
      `${esc(a.tradesToday ?? 0)}${maxTrades != null ? ` / ${esc(maxTrades)}` : ""} trades vandaag`,
    );

    const trades = snap.trades || [];
    const wins = trades.filter((t) => t.pnlQuote > 0).length;
    const losses = trades.length - wins;
    const wr = trades.length ? (wins / trades.length) * 100 : NaN;
    setStat(
      "win",
      trades.length ? esc(fmt.pct(wr, 0, false)) : `<span class="muted">–</span>`,
      trades.length
        ? `<span class="pos">${wins} W</span> · <span class="neg">${losses} V</span><div class="meter split"><i style="width:${wr.toFixed(
            1,
          )}%"></i></div>`
        : "nog geen trades",
      !trades.length ? "" : wr >= 50 ? "pos" : "neg",
    );

    renderBot();
  }

  function renderBot() {
    if (!snap || !statsEl) return;
    const dot = q("bot", "[data-dot]");
    const bs = q("bot", "[data-bs]");
    const halt = q("bot", "[data-halt]");
    const tick = q("bot", "[data-tick]");
    const reason = q("bot", "[data-haltreason]");
    const halted = snap.halted && snap.halted.halted;
    if (dot) dot.className = `dot ${snap.running ? (halted ? "warn" : "on") : "off"}`;
    if (bs) bs.textContent = snap.running ? "Actief" : "Gestopt";
    if (halt) {
      halt.hidden = !halted;
      halt.title = halted ? snap.halted.reason || "Handel gepauzeerd door risicobeheer" : "";
    }
    if (reason) {
      reason.hidden = !halted;
      reason.textContent = halted ? snap.halted.reason || "Nieuwe trades gepauzeerd door risicobeheer" : "";
      reason.title = reason.textContent;
    }
    renderTick();
  }

  function renderTick() {
    const tick = q("bot", "[data-tick]");
    if (!tick || !snap) return;
    const now = Date.now();
    const last = snap.lastTickAt;
    const pollMs = (snap.config && snap.config.pollMs) || 15000;
    let text;
    let cls = "stat-sub";
    if (!last) {
      text = snap.running ? "wacht op eerste tick…" : "druk op Start om te beginnen";
    } else {
      const age = Math.max(0, now - last);
      text = `laatste tick ${fmt.duration(age)} geleden`;
      if (snap.running && age > Math.max(3 * pollMs, 45_000)) {
        text += " · vertraagd";
        cls += " warn";
      }
    }
    tick.className = cls;
    tick.textContent = text;
    const up = q("bot", "[data-up]");
    if (up) {
      up.textContent = snap.running && snap.startedAt ? fmt.duration(now - snap.startedAt) : "";
      up.title = snap.running && snap.startedAt ? `Draait sinds ${fmt.dateTime(snap.startedAt)}` : "";
    }
  }
  setInterval(renderTick, 1000);

  // ───────────── Mode-banner ─────────────

  let bannerKey = "";
  function renderBanner() {
    if (!bannerEl || !snap) return;
    const live = snap.mode === "live";
    const armed = live && !!snap.liveArmed;
    const sim = snap.dataSource === "simulated";
    const limit = info && info.capitalLimitQuote != null ? info.capitalLimitQuote : null;
    const noKeys = live && info && info.hasApiKeys === false;
    const key = [snap.mode, armed, sim, limit, noKeys].join("|");
    if (key === bannerKey) return;
    bannerKey = key;

    let cls;
    let html;
    if (!live) {
      cls = "paper";
      html = `<span class="mb-main">${I.flask}<span><b>OEFENMODUS</b> · Oefenmodus met nep-geld — er wordt niets echt gekocht</span></span>`;
    } else if (!armed) {
      cls = "live-safe";
      html = `<span class="mb-main">${I.eye}<span>Live modus — <b>NIET gearmd</b> (alleen signalen)</span></span>
        ${limit != null ? `<span class="mb-chip limit">${I.lock} limiet ${esc(fmt.eur(limit))}</span>` : ""}
        ${noKeys ? `<span class="mb-chip limit">${I.key} geen API-sleutels</span>` : ""}
        <button type="button" class="btn btn-danger" data-banner="arm">Live handel inschakelen…</button>`;
    } else {
      cls = "live-armed";
      html = `<span class="mb-main">${I.bolt}<span><b>LIVE — ECHT GELD</b> · de bot plaatst echte orders</span></span>
        ${limit != null ? `<span class="mb-chip limit">${I.lock} max ${esc(fmt.eur(limit))}</span>` : ""}
        <button type="button" class="btn" data-banner="disarm">Uitschakelen</button>`;
    }
    if (sim) {
      html += `<span class="mb-chip sim" title="De koersen zijn nagebootst (bijv. omdat Bitvavo niet bereikbaar is). Resultaten zeggen niets over de echte markt.">${svg(
        '<path d="M10.3 3.9 2.4 18a2 2 0 0 0 1.7 3h15.8a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z"/><path d="M12 9v4M12 17h.01"/>',
      )} Gesimuleerde marktdata — geen echte koersen</span>`;
    }
    bannerEl.className = `mode-banner ${cls}`;
    bannerEl.innerHTML = html;
  }

  bannerEl &&
    bannerEl.addEventListener("click", (e) => {
      const b = e.target.closest("[data-banner]");
      if (!b) return;
      if (b.dataset.banner === "arm") armLive();
      else if (b.dataset.banner === "disarm") disarmLive(b);
    });

  // ───────────── Waarschuwingsbanners (onder de mode-banner) ─────────────
  // Kooporders met onbekende uitkomst (nieuwe aankopen gepauzeerd) en een
  // onbruikbare opgeslagen staat (lege administratie, live armen geblokkeerd).
  // Ze verdwijnen vanzelf zodra de snapshot ze niet meer bevat.

  const WARN_ICON = svg('<path d="M10.3 3.9 2.4 18a2 2 0 0 0 1.7 3h15.8a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z"/><path d="M12 9v4M12 17h.01"/>');
  const unknownOrdersOf = (s) => (s && Array.isArray(s.unknownOrders) ? s.unknownOrders.filter(Boolean) : []);
  const recoveryOf = (s) => (s && s.stateRecovery && typeof s.stateRecovery === "object" ? s.stateRecovery : null);
  const orderLine = (u) =>
    `${u.market || "?"}${isNum(u.quoteAmount) ? ` · ${fmt.eur(u.quoteAmount)}` : ""}${isNum(u.at) ? ` · ${fmt.dateTime(u.at)}` : ""}`;

  let alertKey = "";
  function renderAlerts() {
    if (!alertEl || !snap) return;
    const unknown = unknownOrdersOf(snap);
    const rec = recoveryOf(snap);
    const live = snap.mode === "live";
    const key = JSON.stringify([unknown, rec, live]);
    if (key === alertKey) return;
    alertKey = key;
    let html = "";
    if (rec) {
      html += `<div class="alert-banner bad" role="alert" data-alert="recovery">
        <span class="ab-main">${WARN_ICON}<span><b>Opgeslagen staat was onbruikbaar</b> — ${esc(rec.reason || "onbekende reden")}.
          De bot begon met een <b>lege administratie</b>${
            live
              ? ": posities van vóór de herstart worden NIET bewaakt. Live handel inschakelen is geblokkeerd tot je dit bevestigt."
              : " (oefengeld)."
          }${rec.quarantinedTo ? ` <span class="ab-sub">Het oude bestand is bewaard als <span class="mono">${esc(rec.quarantinedTo)}</span>.</span>` : ""}</span></span>
        <button type="button" class="btn" data-alert-act="ack-recovery">Ik heb het gecontroleerd</button>
      </div>`;
    }
    if (unknown.length) {
      html += `<div class="alert-banner warn" role="alert" data-alert="unknown-orders">
        <span class="ab-main">${WARN_ICON}<span><b>Onbekende orderuitkomst</b> — nieuwe aankopen zijn gepauzeerd. Controleer je open orders en saldo op Bitvavo.
          <span class="ab-sub">${unknown.map((u) => `<span class="ab-chip mono" title="clientOrderId ${esc(u.clientOrderId || "")}">${esc(orderLine(u))}</span>`).join("")}</span></span></span>
        <button type="button" class="btn" data-alert-act="ack-unknown">Ik heb het gecontroleerd</button>
      </div>`;
    }
    alertEl.innerHTML = html;
    alertEl.hidden = !html;
  }

  alertEl &&
    alertEl.addEventListener("click", (e) => {
      const b = e.target.closest("[data-alert-act]");
      if (!b || b.disabled) return;
      if (b.dataset.alertAct === "ack-unknown") confirmAckUnknown();
      else if (b.dataset.alertAct === "ack-recovery") confirmAckRecovery();
    });

  /** Antwoord van een ack-route (EngineSnapshot) direct doorgeven, anders de staat verversen */
  async function applyAckResult(res) {
    if (res && typeof res === "object" && res.account) bus.emit("snapshot", res);
    else await refreshState();
  }

  function confirmAckUnknown() {
    const unknown = unknownOrdersOf(snap);
    const n = unknown.length;
    ctx.openModal({
      title: "Onbekende orderuitkomst",
      danger: true,
      bodyHtml: `
        <p>De bot weet niet zeker of ${n === 1 ? "deze kooporder" : "deze kooporders"} op Bitvavo ${
          n === 1 ? "is" : "zijn"
        } uitgevoerd:</p>
        <ul>${unknown.map((u) => `<li class="mono">${esc(orderLine(u))}</li>`).join("") || "<li>–</li>"}</ul>
        <p>Zolang dat onduidelijk is, doet de bot <strong>geen nieuwe aankopen</strong> (in geen enkele markt).</p>
        <ul>
          <li>Kijk op Bitvavo bij je <strong>open orders</strong> en je <strong>saldo</strong> of er iets gekocht is.</li>
          <li>Is er toch gekocht? Die coins worden <strong>niet door de bot beheerd</strong> (geen stop-loss, geen take-profit): verkoop ze zelf op Bitvavo.</li>
          <li>Na bevestigen mag de bot weer nieuwe aankopen doen.</li>
        </ul>`,
      confirmText: "Gecontroleerd — aankopen hervatten",
      onConfirm: async () => {
        await applyAckResult(await api.ackUnknownOrders());
        ctx.toast("Bevestigd — de bot mag weer nieuwe aankopen doen", "success");
      },
    });
  }

  function confirmAckRecovery() {
    const rec = recoveryOf(snap);
    const live = !!snap && snap.mode === "live";
    ctx.openModal({
      title: "Herstelmelding bevestigen",
      danger: live,
      bodyHtml: `
        <p>De opgeslagen staat was bij het starten onbruikbaar${rec && rec.reason ? `: <strong>${esc(rec.reason)}</strong>` : ""}. De bot begon met een <strong>lege administratie</strong>.</p>
        ${
          live
            ? `<ul>
                <li>Posities van vóór de herstart worden <strong>niet bewaakt</strong> (geen stop-loss): controleer je saldi op Bitvavo en verkoop zo nodig zelf.</li>
                <li>Na bevestigen gaat de bot verder met de huidige administratie en kun je live handel weer inschakelen.</li>
              </ul>`
            : `<p>Dit is de oefenmodus: er staat geen echt geld op het spel. Na bevestigen gaat de bot verder met de huidige administratie.</p>`
        }
        ${rec && rec.quarantinedTo ? `<p class="muted">Het oude bestand is bewaard als <span class="mono">${esc(rec.quarantinedTo)}</span>.</p>` : ""}`,
      confirmText: "Bevestigen",
      onConfirm: async () => {
        await applyAckResult(await api.ackStateRecovery());
        ctx.toast("Herstelmelding bevestigd", "success");
      },
    });
  }

  function armLive() {
    const limit = info && info.capitalLimitQuote != null ? fmt.eur(info.capitalLimitQuote) : null;
    ctx.openModal({
      title: "Live handel inschakelen",
      danger: true,
      bodyHtml: `
        <p>Na inschakelen plaatst de bot <strong>echte orders met echt geld</strong> op je Bitvavo-account${
          limit ? ` (maximaal <strong>${esc(limit)}</strong>)` : ""
        }.</p>
        <ul>
          <li>Je kunt je <strong>volledige inzet verliezen</strong>. Dit is geen financieel advies.</li>
          <li>Test eerst in de oefenmodus en in het Backtest-lab.</li>
          <li>Met <strong>Noodstop</strong> verkoop je direct alle posities (een positie onder het Bitvavo-minimum van €5 kan niet verkocht worden).</li>
        </ul>`,
      requireText: "IK BEGRIJP HET RISICO",
      confirmText: "Inschakelen",
      onConfirm: async (value) => {
        const res = await api.arm(value);
        if (res && typeof res === "object") bus.emit("app-info", res);
        await refreshState();
        ctx.toast("Live handel ingeschakeld — de bot handelt nu met echt geld", "warn");
      },
    });
  }

  async function disarmLive(btn) {
    btn.disabled = true;
    btn.classList.add("busy");
    try {
      const res = await api.disarm();
      if (res && typeof res === "object") bus.emit("app-info", res);
      await refreshState();
      ctx.toast("Live handel uitgeschakeld — alleen signalen", "success");
    } catch (err) {
      ctx.toast(`Uitschakelen mislukt: ${err.message}`, "error");
      btn.disabled = false;
      btn.classList.remove("busy");
    }
  }

  async function refreshState() {
    try {
      const s = await api.getState();
      if (s) bus.emit("snapshot", s);
    } catch {
      /* SSE levert de volgende snapshot */
    }
  }

  // ───────────── Bot-bediening ─────────────

  if (controlsEl) {
    controlsEl.innerHTML = `
      <button type="button" class="btn btn-success" data-act="start" title="Start de bot">${I.play}<span>Start</span></button>
      <button type="button" class="btn" data-act="stop" title="Stop de bot (posities blijven open)">${I.pause}<span>Stop</span></button>
      <button type="button" class="btn btn-danger" data-act="kill" title="Verkoop alles direct en stop de bot">${I.kill}<span>Noodstop</span></button>
      <button type="button" class="btn btn-ghost" data-act="reset" title="Zet het oefenaccount terug naar het startkapitaal">${I.reset}<span class="lbl-long">Reset oefengeld</span></button>`;
    controlsEl.addEventListener("click", (e) => {
      const b = e.target.closest("[data-act]");
      if (!b || b.disabled || busy) return;
      onAction(b.dataset.act, b);
    });
  }

  function renderControls() {
    if (!controlsEl) return;
    const btn = (a) => controlsEl.querySelector(`[data-act="${a}"]`);
    const running = !!(snap && snap.running);
    const hasPos = !!(snap && snap.positions && snap.positions.length);
    const paper = !snap || snap.mode === "paper";
    btn("start").disabled = busy || !snap || running;
    btn("stop").disabled = busy || !snap || !running;
    btn("kill").disabled = busy || !snap || (!running && !hasPos);
    btn("reset").hidden = !paper;
    btn("reset").disabled = busy || !snap;
  }

  /**
   * Voert een actie uit; vanuit een modal (`inModal`) wordt de fout in de modal getoond i.p.v. als toast.
   * `okMsg` mag een functie `(res) => [bericht, soort]` zijn; soort "error" telt als mislukt
   * (in een modal blijft die dan open met de melding).
   */
  async function run(button, fn, okMsg, okKind = "success", inModal = false) {
    busy = true;
    button && button.classList.add("busy");
    renderControls();
    try {
      const res = await fn();
      if (res && typeof res === "object" && res.account) bus.emit("snapshot", res);
      else await refreshState();
      const [msg, kind] = typeof okMsg === "function" ? okMsg(res) : [okMsg, okKind];
      if (kind === "error" && inModal) throw new Error(msg);
      msg && ctx.toast(msg, kind);
    } catch (err) {
      // De actie kan deels gelukt zijn (bijv. noodstop: bot gestopt, verkoop mislukt): toon de echte staat
      await refreshState();
      if (inModal) throw err;
      ctx.toast(`Mislukt: ${err.message}`, "error");
    } finally {
      busy = false;
      button && button.classList.remove("busy");
      renderControls();
    }
  }

  function onAction(act, button) {
    const positions = (snap && snap.positions) || [];
    const live = snap && snap.mode === "live";
    if (act === "start") {
      if (live && snap.liveArmed) {
        ctx.openModal({
          title: "Bot starten met echt geld?",
          danger: true,
          bodyHtml: `<p>Live handel is <strong>ingeschakeld</strong>. De bot gaat zelfstandig echte orders plaatsen.</p>`,
          confirmText: "Start live",
          onConfirm: () => run(button, api.start, "Bot gestart — LIVE", "warn", true),
        });
        return;
      }
      run(button, api.start, live ? "Bot gestart (alleen signalen)" : "Bot gestart in oefenmodus");
    } else if (act === "stop") {
      if (positions.length) {
        ctx.openModal({
          title: "Bot stoppen?",
          bodyHtml: `<p>Er ${positions.length === 1 ? "staat" : "staan"} nog <strong>${positions.length} open ${
            positions.length === 1 ? "positie" : "posities"
          }</strong>. Na stoppen worden stop-loss en take-profit <strong>niet meer bewaakt</strong>.</p>
          <p class="muted">Wil je alles verkopen? Gebruik dan <strong>Noodstop</strong>.</p>`,
          confirmText: "Toch stoppen",
          onConfirm: () => run(button, api.stop, "Bot gestopt — open posities blijven staan", "warn", true),
        });
        return;
      }
      run(button, api.stop, "Bot gestopt", "info");
    } else if (act === "kill") {
      const total = positions.reduce((s, p) => s + posValue(p), 0);
      const minOrder = Number(snap && snap.config && snap.config.risk && snap.config.risk.minOrderQuote) || MIN_ORDER_EUR;
      const dust = positions.filter((p) => isDust(p, minOrder));
      ctx.openModal({
        title: "Noodstop",
        danger: true,
        bodyHtml: positions.length
          ? `<p>Alle <strong>${positions.length} open ${positions.length === 1 ? "positie wordt" : "posities worden"}</strong> direct tegen marktprijs verkocht (ca. <strong>${esc(
              fmt.eur(total),
            )}</strong>) en de bot stopt.</p><p class="muted">Bij een snelle markt kan de verkoopprijs afwijken.</p>${
              dust.length
                ? `<p class="neg"><strong>Let op:</strong> ${esc(
                    dust.map((p) => `${p.market} ≈ ${fmt.eur(posValue(p))}`).join(", "),
                  )} ${dust.length === 1 ? "is" : "zijn"} minder waard dan het Bitvavo-minimum van ${esc(
                    fmt.eur(minOrder),
                  )} en ${dust.length === 1 ? "kan" : "kunnen"} waarschijnlijk <strong>niet verkocht</strong> worden. Die ${
                    dust.length === 1 ? "positie blijft" : "posities blijven"
                  } dan open terwijl de bot stopt (zonder stop-loss).</p>`
                : ""
            }`
          : `<p>Er zijn geen open posities. De bot wordt direct gestopt.</p>`,
        confirmText: "Noodstop uitvoeren",
        // Antwoord = EngineSnapshot; is het iets anders, dan telt de ververste staat (`snap`)
        onConfirm: () =>
          run(button, api.kill, (res) => killOutcome(res && Array.isArray(res.positions) ? res : snap, fmt, minOrder), "warn", true),
      });
    } else if (act === "reset") {
      // De server reset naar het startkapitaal uit de configuratie (PAPER_STARTING_CAPITAL),
      // niet naar account.startingEquity (dat kan na een eerdere reset afwijken).
      const start = info && isNum(info.paperStartingCapital) ? info.paperStartingCapital : null;
      ctx.openModal({
        title: "Oefengeld resetten?",
        bodyHtml: `<p>Je oefenaccount wordt teruggezet naar het startkapitaal${
          Number.isFinite(start) ? ` (<strong>${esc(fmt.eur(start))}</strong>)` : ""
        } aan nep-geld.</p><p>Alle oefentrades, open oefenposities en de equity-historie worden gewist. Dit kan niet ongedaan worden gemaakt.</p>`,
        confirmText: "Resetten",
        onConfirm: () => run(button, api.resetPaper, "Oefenaccount gereset", "success", true),
      });
    }
  }

  // ───────────── Events ─────────────

  function onSnapshot(s) {
    snap = s;
    renderStats();
    renderBanner();
    renderAlerts();
    renderControls();
  }

  bus.on("snapshot", onSnapshot);
  bus.on("app-info", (i) => {
    if (!i || typeof i !== "object") return;
    info = { ...(info || {}), ...i };
    bannerKey = "";
    renderBanner();
    renderStats();
    // Armen/ontwapenen via een ander paneel: snapshot direct verversen
    if (snap && typeof i.liveArmed === "boolean" && i.liveArmed !== !!snap.liveArmed) refreshState();
  });
  renderControls();
  if (snap) onSnapshot(snap);
}
