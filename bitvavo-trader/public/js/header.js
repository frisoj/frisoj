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

export function mountHeader(ctx, { statsEl, controlsEl, bannerEl }) {
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
    const pts = (points || []).slice(-240).map((p) => p.equity).filter(Number.isFinite);
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
    const dayStart = a.dayStartEquity;
    const paper = snap.mode === "paper";

    setStat(
      "equity",
      esc(fmt.eur(eq)),
      paper
        ? `start ${esc(fmt.eur(start))}`
        : `limiet ${esc(fmt.eur(info && info.capitalLimitQuote != null ? info.capitalLimitQuote : start))}`,
      "",
      eq,
    );
    renderSpark(snap.equityHistory);

    const dayPnl = Number.isFinite(eq) && Number.isFinite(dayStart) ? eq - dayStart : NaN;
    const dayPct = dayStart ? (dayPnl / dayStart) * 100 : NaN;
    setStat(
      "day",
      esc(fmt.eurSigned(dayPnl)),
      `<span class="${fmt.pnlClass(dayPct)}">${esc(fmt.pct(dayPct))}</span> <span title="Gerealiseerd (afgesloten trades) vandaag: ${esc(
        fmt.eurSigned(a.realizedPnlToday),
      )}">sinds 00:00</span>`,
      fmt.pnlClass(dayPnl),
      dayPnl,
    );

    const totPnl = Number.isFinite(eq) && Number.isFinite(start) ? eq - start : NaN;
    const totPct = start ? (totPnl / start) * 100 : NaN;
    setStat(
      "total",
      esc(fmt.eurSigned(totPnl)),
      `<span class="${fmt.pnlClass(totPct)}">${esc(fmt.pct(totPct))}</span> t.o.v. ${esc(fmt.eur(start))}`,
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
          <li>Met <strong>Noodstop</strong> verkoop je direct alle posities.</li>
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

  /** Voert een actie uit; vanuit een modal (`inModal`) wordt de fout in de modal getoond i.p.v. als toast. */
  async function run(button, fn, okMsg, okKind = "success", inModal = false) {
    busy = true;
    button && button.classList.add("busy");
    renderControls();
    try {
      const res = await fn();
      if (res && typeof res === "object" && res.account) bus.emit("snapshot", res);
      else await refreshState();
      okMsg && ctx.toast(okMsg, okKind);
    } catch (err) {
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
      const total = positions.reduce((s, p) => s + (p.currentPrice * p.amount || 0), 0);
      ctx.openModal({
        title: "Noodstop",
        danger: true,
        bodyHtml: positions.length
          ? `<p>Alle <strong>${positions.length} open ${positions.length === 1 ? "positie wordt" : "posities worden"}</strong> direct tegen marktprijs verkocht (ca. <strong>${esc(
              fmt.eur(total),
            )}</strong>) en de bot stopt.</p><p class="muted">Bij een snelle markt kan de verkoopprijs afwijken.</p>`
          : `<p>Er zijn geen open posities. De bot wordt direct gestopt.</p>`,
        confirmText: "Noodstop uitvoeren",
        onConfirm: () => run(button, api.kill, "Noodstop uitgevoerd — alles verkocht, bot gestopt", "warn", true),
      });
    } else if (act === "reset") {
      const start = snap && snap.account ? snap.account.startingEquity : null;
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
