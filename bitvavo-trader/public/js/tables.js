// Tabellen (A9): open posities en laatste trades.

import { coinColor } from "./liveChart.js";

const isNum = (n) => typeof n === "number" && Number.isFinite(n);

/** Uitleg bij een onverkoopbare positie (engine-tekst, of een algemene uitleg) */
export function unsellableWhy(p) {
  return (
    (p && typeof p.unsellableReason === "string" && p.unsellableReason.trim()) ||
    "Onverkoopbaar: de waarde ligt onder het Bitvavo-minimum van € 5 per order, dus een verkooporder wordt geweigerd."
  );
}

/** Beursminimum per order als de server geen bedrag noemt (EXCHANGE_MIN_ORDER_QUOTE) */
const EXCHANGE_MIN_EUR = 5;
/**
 * Zoveel tekens (stop + doel samen) passen naast elkaar onder de balk van 124 px
 * (monospace 10,5 px ≈ 6,3 px per teken, met wat ruimte ertussen); meer → doel op een tweede regel.
 */
export const RANGE_LABEL_CHARS = 17;

const posValue = (p) => (Number(p && p.amount) || 0) * (Number(p && p.currentPrice) || 0);

/** Minimumbedrag uit een engine-tekst ("minimum €5,00", "minimum van € 5,00") of null */
function minimumFrom(text) {
  const m = /minimum(?:\s+van)?\s*€\s*(\d[\d.]*(?:,\d+)?)/i.exec(String(text || ""));
  if (!m) return null;
  const v = Number(m[1].replace(/\./g, "").replace(",", "."));
  return v > 0 ? v : null;
}

/** "15m" → 900000 (ms), onbekend → null */
function intervalMs(iv) {
  const m = /^(\d+)([mhdw])$/.exec(String(iv || ""));
  return m ? Number(m[1]) * { m: 60_000, h: 3_600_000, d: 86_400_000, w: 604_800_000 }[m[2]] : null;
}

/**
 * "Toch proberen te verkopen" op een onverkoopbare positie: de engine stuurt geen order
 * en antwoordt 409 "onverkoopbaar: …". Geeft een begrijpelijke uitleg (i.p.v. die ruwe
 * reden) en wat er nu gebeurt: automatisch verkopen zodra het weer kan gebeurt alleen
 * als de bot draait (en in live: live handel is ingeschakeld). Null bij een andere fout.
 * @returns {{ title: string, why: string, next: string } | null}
 */
export function closeRefusalInfo(err, p, snap, fmt) {
  const msg = String((err && err.message) || "").trim();
  if (!/^onverkoopbaar\b/i.test(msg)) return null;
  if (err && err.status !== undefined && err.status !== 409) return null;
  const min = minimumFrom(msg) ?? minimumFrom(p && p.unsellableReason) ?? EXCHANGE_MIN_EUR;
  const base = String((p && p.market) || "").split("-")[0] || "munt";
  const live = !!snap && snap.mode === "live";
  const running = !!snap && !!snap.running;
  const armed = live && !!snap.liveArmed;
  const title = "Verkoop geweigerd: onder het Bitvavo-minimum";
  if (/hoeveelheid/i.test(msg)) {
    // Minimum in munten: een hogere koers helpt niet, deze hoeveelheid blijft te klein
    return {
      title,
      why: `Er is niets verkocht: Bitvavo accepteert geen verkooporder voor zo'n kleine hoeveelheid ${base} (onder het minimum per order).`,
      next: "Een hogere koers verandert daar niets aan, dus ook de bot kan deze positie niet verkopen. Schrijf hem af (knop Afschrijven) — de coins blijven op je account staan.",
    };
  }
  const why = `Er is niets verkocht: Bitvavo accepteert geen verkooporder onder ${fmt.eur(min)}, en deze positie is nu ongeveer ${fmt.eur(
    posValue(p),
  )} waard.`;
  let next;
  if (running && (!live || armed)) {
    next = `De bot onthoudt je verkoopopdracht en verkoopt de positie automatisch zodra die weer minstens ${fmt.eur(
      min,
    )} waard is. Wil je niet wachten, schrijf hem dan af (knop Afschrijven).`;
  } else {
    const need = !running && live ? "de bot draait én live handel is ingeschakeld" : !running ? "de bot draait" : "live handel is ingeschakeld";
    const todo = !running && live ? "Start de bot en schakel live handel in" : !running ? "Start de bot" : "Schakel live handel in";
    next = `Automatisch verkopen zodra de positie weer minstens ${fmt.eur(min)} waard is, gebeurt alleen als ${need}. ${todo}, of schrijf de positie af (knop Afschrijven).`;
  }
  return { title, why, next };
}

/**
 * Afschrijven geweigerd omdat de positie inmiddels wél verkoopbaar is (de server
 * controleert eerst de actuele koers en antwoordt dan 409). Null bij een andere fout.
 * `p` = de positie (bij voorkeur uit de verse staat, voor de actuele waarde).
 * @returns {{ title: string, text: string } | null}
 */
export function writeOffRefusalInfo(err, p, fmt) {
  const msg = String((err && err.message) || "").trim();
  if (err && err.status !== undefined && err.status !== 409) return null;
  if (!/\b(?:inmiddels|weer|wel)\s+(?:(?:wel|weer)\s+)?verkoopbaar|gewoon verkocht worden/i.test(msg)) return null;
  // Waarde volgens de server (verse koers), anders volgens de (verse) staat
  const said = /~\s*€\s*(\d[\d.]*(?:,\d+)?)/.exec(msg);
  const value = said ? Number(said[1].replace(/\./g, "").replace(",", ".")) : posValue(p);
  return {
    title: "Niet afgeschreven: de positie is weer verkoopbaar",
    text: `Er is niets afgeschreven. De koers is intussen gestegen${
      value > 0 ? `: ${(p && p.market) || "de positie"} is nu ongeveer ${fmt.eur(value)} waard` : ""
    }, dus de positie kan gewoon verkocht worden. Wil je hem kwijt, verkoop hem dan met de knop Sluit bij Open posities.`,
  };
}

/** Vervangt de inhoud van een open modal door een uitkomst (geen bevestigknop meer). False zonder modal. */
function showModalResult(modalEl, title, bodyHtml) {
  if (!modalEl || typeof modalEl.querySelector !== "function") return false;
  const h = modalEl.querySelector(".modal-head h3");
  if (h) h.textContent = title;
  const body = modalEl.querySelector(".modal-body");
  if (body) body.innerHTML = bodyHtml;
  const err = modalEl.querySelector(".modal-error");
  if (err) err.hidden = true;
  const ok = modalEl.querySelector('[data-m="ok"]');
  if (ok) ok.remove();
  const cancel = modalEl.querySelector('[data-m="cancel"]');
  if (cancel) {
    cancel.textContent = "Sluiten";
    if (typeof cancel.focus === "function") cancel.focus();
  }
  return true;
}

const EMPTY_POS = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="7" width="18" height="13" rx="2"/><path d="M8 7V5a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>`;
const EMPTY_TRD = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M3 12h4l3-8 4 16 3-8h4"/></svg>`;

export function mountTables(ctx, { positionsEl, tradesEl }) {
  const { fmt, esc, api, bus } = ctx;
  const closing = new Set();
  const writingOff = new Set();
  const shownPrice = new Map();
  const seenTrades = new Set();
  let firstTrades = true;
  let tradesKey = "";

  const marketCell = (m) => {
    const base = String(m || "").split("-")[0];
    return `<button type="button" class="market-link" data-market="${esc(m)}" title="Toon ${esc(m)} in de grafiek">
      <span class="mkt-icon" style="--c:${coinColor(base)}">${esc(base.slice(0, 4))}</span>${esc(m)}</button>`;
  };

  // ───────────── Open posities ─────────────

  positionsEl.innerHTML = `
    <div class="panel-title">Open posities <span class="count" data-pc>0</span>
      <span class="scroll-cue" data-pcue hidden title="De tabel is breder dan het scherm: schuif opzij voor alle kolommen. De knoppen blijven rechts staan.">⇆ schuif opzij voor meer kolommen</span>
      <span class="panel-actions panel-sub" data-psum></span></div>
    <div class="table-wrap pos-wrap" data-pbody></div>`;
  const pBody = positionsEl.querySelector("[data-pbody]");
  const pCount = positionsEl.querySelector("[data-pc]");
  const pSum = positionsEl.querySelector("[data-psum]");
  const pCue = positionsEl.querySelector("[data-pcue]");

  /** Balk stop ↔ doel met de koers erop; stop (links) en doel (rechts) als getal eronder */
  function rangeBar(p, trailing) {
    const stop = p.stopPrice;
    const tp = p.takeProfitPrice;
    const stopTxt = `${fmt.price(stop)}${trailing ? " ↑" : ""}`;
    const tpTxt = fmt.price(tp);
    const labels = `<span class="lbl l neg" title="${trailing ? "Stop is meegeschoven (trailing/break-even)" : "Stop-loss"}">${esc(
      stopTxt,
    )}</span><span class="lbl r pos" title="Doel (take-profit)">${esc(tpTxt)}</span>`;
    // Passen de twee getallen niet naast elkaar (kleine munten: 0,00104874 en 0,00114085), dan het
    // doel op een tweede regel; anders lopen ze in elkaar over
    const tight = stopTxt.length + tpTxt.length > RANGE_LABEL_CHARS ? " tight" : "";
    if (!isNum(stop) || !isNum(tp) || tp <= stop) return `<div class="rangebar no-bar${tight}">${labels}</div>`;
    const span = tp - stop;
    const clamp = (x) => Math.max(0, Math.min(100, x));
    const now = clamp(((p.currentPrice - stop) / span) * 100);
    const entry = clamp(((p.entryPrice - stop) / span) * 100);
    const cls = p.currentPrice >= p.entryPrice ? "pos" : "neg";
    return `<div class="rangebar${tight}" title="Koers tussen stop (${esc(fmt.price(stop))}) en doel (${esc(fmt.price(tp))}): ${Math.round(now)}%">
      <div class="track"></div>
      <div class="entry" style="left:${entry.toFixed(1)}%" title="Entry"></div>
      <div class="now ${cls}" style="left:${now.toFixed(1)}%"></div>
      ${labels}
    </div>`;
  }

  /** Scroll-hint als de tabel toch breder is dan het paneel (actiekolom blijft zichtbaar: sticky) */
  function updateScrollCue() {
    const over = Number(pBody.scrollWidth) > Number(pBody.clientWidth) + 1;
    pBody.classList.toggle("is-scrollx", over);
    if (pCue) pCue.hidden = !over;
  }
  // Ook bij een andere paneelbreedte zonder resize van het venster (tab weer zichtbaar, zijbalk)
  if (typeof ResizeObserver === "function") new ResizeObserver(() => updateScrollCue()).observe(pBody);
  else if (typeof window !== "undefined" && window.addEventListener) window.addEventListener("resize", updateScrollCue);

  function renderPositions() {
    const snap = ctx.getState();
    const positions = (snap && snap.positions) || [];
    pCount.textContent = String(positions.length);
    if (!positions.length) {
      pSum.innerHTML = "";
      pBody.innerHTML = `<div class="empty">${EMPTY_POS}<b>Geen open posities</b>
        <span>${snap && snap.running ? "De bot zoekt naar een koopkans…" : "Start de bot om te beginnen met (oefen)handelen."}</span></div>`;
      updateScrollCue();
      return;
    }
    const totalPnl = positions.reduce((s, p) => s + (Number(p.unrealizedPnl) || 0), 0);
    const totalCost = positions.reduce((s, p) => s + (Number(p.costQuote) || 0), 0);
    pSum.innerHTML = `inzet <b class="mono">${esc(fmt.eur(totalCost))}</b> · P&amp;L <b class="mono ${fmt.pnlClass(totalPnl)}">${esc(
      fmt.eurSigned(totalPnl),
    )}</b>`;
    const now = Date.now();
    const rows = positions
      .map((p) => {
        const cls = fmt.pnlClass(p.unrealizedPnl);
        const trailing = isNum(p.initialStopPrice) && isNum(p.stopPrice) && p.stopPrice > p.initialStopPrice + 1e-12;
        const stuck = !!p.unsellable;
        const why = unsellableWhy(p);
        const busy = closing.has(p.id) || writingOff.has(p.id);
        const base = String(p.market || "").split("-")[0];
        // Compact (past op 1280 px): koers + entry, inzet + hoeveelheid en stop/doel onder de balk samengevoegd
        return `<tr data-id="${esc(p.id)}"${stuck ? ' class="is-unsellable"' : ""}>
          <td class="first" data-label="Markt"><div class="pos-market">${marketCell(p.market)}${
            stuck ? `<span class="badge badge-yellow" title="${esc(why)}">Onverkoopbaar</span>` : ""
          }</div></td>
          <td data-label="Sinds" data-since title="${esc(fmt.dateTime(p.entryTime))}">${esc(fmt.duration(now - p.entryTime))}</td>
          <td class="num" data-label="Koers / entry"><div class="cell-stack"><span class="price-cell" data-price="${esc(p.id)}">${esc(
            fmt.price(p.currentPrice),
          )}</span><small class="muted" title="Entry: gemiddelde aankoopprijs">in ${esc(fmt.price(p.entryPrice))}</small></div></td>
          <td class="num" data-label="Inzet / aantal"><div class="cell-stack"><span>${esc(fmt.eur(p.costQuote))}</span><small class="muted" title="Hoeveelheid">${esc(
            fmt.amount(p.amount),
          )} ${esc(base)}</small></div></td>
          <td class="num ${cls}" data-label="P&amp;L"><div class="cell-stack"><span>${esc(fmt.eurSigned(p.unrealizedPnl))}</span><small>${esc(
            fmt.pct(p.unrealizedPct),
          )}</small></div></td>
          <td class="full" data-label="Stop ↔ doel">${rangeBar(p, trailing)}</td>
          <td class="full col-act" data-label=""><div class="pos-actions"><button type="button" class="btn btn-sm btn-danger${
            closing.has(p.id) ? " busy" : ""
          }" data-close="${esc(p.id)}" ${busy ? "disabled" : ""} title="${esc(
            closing.has(p.id) ? "Bezig met verkopen…" : stuck ? `Verkopen lukt nu niet — ${why}` : "Verkoop deze positie nu tegen marktprijs",
          )}">Sluit</button>${
            stuck
              ? `<button type="button" class="btn btn-sm${writingOff.has(p.id) ? " busy" : ""}" data-writeoff="${esc(p.id)}" ${
                  busy ? "disabled" : ""
                } title="${esc(
                  writingOff.has(p.id)
                    ? "Bezig met afschrijven (actuele koers controleren)…"
                    : "Bot stopt met beheren; de coins blijven op je account; de inleg wordt als verlies geboekt",
                )}">Afschrijven</button>`
              : ""
          }</div></td>
        </tr>`;
      })
      .join("");
    pBody.innerHTML = `<table class="table responsive pos-table">
      <thead><tr>
        <th>Markt</th><th>Sinds</th><th class="num" title="Huidige koers, met daaronder je gemiddelde aankoopprijs (entry)">Koers / entry</th>
        <th class="num" title="Ingelegd bedrag (incl. fee), met daaronder de hoeveelheid">Inzet / aantal</th><th class="num">P&amp;L</th>
        <th title="Waar de koers staat tussen de stop-loss (links) en het doel (rechts)">Stop ↔ doel</th><th class="col-act"><span class="sr-only">Acties</span></th>
      </tr></thead><tbody>${rows}</tbody></table>`;
    updateScrollCue();
    for (const p of positions) {
      const el = pBody.querySelector(`[data-price="${CSS.escape(p.id)}"]`);
      const prev = shownPrice.get(p.id);
      if (el && isNum(prev) && isNum(p.currentPrice) && prev !== p.currentPrice) {
        el.classList.add(p.currentPrice > prev ? "flash-up" : "flash-down");
      }
      shownPrice.set(p.id, p.currentPrice);
    }
  }

  function updateLivePrice(market, price) {
    const snap = ctx.getState();
    for (const p of (snap && snap.positions) || []) {
      if (p.market !== market) continue;
      const el = pBody.querySelector(`[data-price="${CSS.escape(p.id)}"]`);
      if (!el) continue;
      const prev = shownPrice.get(p.id);
      el.textContent = fmt.price(price);
      if (isNum(prev) && prev !== price) {
        el.classList.remove("flash-up", "flash-down");
        void el.offsetWidth;
        el.classList.add(price > prev ? "flash-up" : "flash-down");
      }
      shownPrice.set(p.id, price);
    }
  }

  positionsEl.addEventListener("click", (e) => {
    const m = e.target.closest("[data-market]");
    if (m) {
      bus.emit("market-selected", { market: m.dataset.market });
      document.getElementById("chart-main")?.scrollIntoView({ behavior: "smooth", block: "center" });
      return;
    }
    const b = e.target.closest("[data-close]");
    if (b && !b.disabled) return confirmClose(b.dataset.close);
    const w = e.target.closest("[data-writeoff]");
    if (w && !w.disabled) confirmWriteOff(w.dataset.writeoff);
  });

  async function refreshState() {
    try {
      const s = await api.getState();
      if (s) bus.emit("snapshot", s);
    } catch {
      /* SSE volgt */
    }
  }

  /**
   * Melding na sluiten/afschrijven. Via de gedeelde notifier van het dashboard
   * (`ctx.notifyTradeClosed`, ook gebruikt voor het SSE-event "position-closed")
   * geeft dezelfde trade maar één toast, ongeacht wat het eerst binnenkomt.
   */
  function tradeToast(trade, [fallbackMsg, fallbackKind]) {
    if (typeof ctx.notifyTradeClosed === "function" && trade && typeof trade === "object" && trade.id != null) {
      ctx.notifyTradeClosed(trade);
      return;
    }
    ctx.toast(fallbackMsg, fallbackKind);
  }

  /** Bezig-melding onderaan een open modal (null zonder modal) */
  function busyNote(modalEl, text) {
    const body = modalEl && typeof modalEl.querySelector === "function" ? modalEl.querySelector(".modal-body") : null;
    if (!body || typeof body.appendChild !== "function" || typeof document === "undefined") return null;
    const el = document.createElement("p");
    el.className = "modal-busy muted";
    el.setAttribute("role", "status");
    el.innerHTML = `<span class="spinner"></span> ${esc(text)}`;
    body.appendChild(el);
    return el;
  }

  /**
   * Afschrijven telt als gerealiseerd verlies van vandaag: het kan de dagelijkse
   * verlieslimiet raken (dan vandaag geen nieuwe trades) en start de afkoelperiode
   * na verlies voor deze markt. Getallen uit de risico-instellingen als die er zijn.
   */
  function writeOffRiskHtml(snap, p) {
    const risk = (snap && snap.config && snap.config.risk) || {};
    const limit = isNum(risk.dailyLossLimitPct) && risk.dailyLossLimitPct > 0 ? ` (${esc(fmt.num(risk.dailyLossLimitPct, 1))}%)` : "";
    const n = isNum(risk.cooldownCandlesAfterLoss) ? risk.cooldownCandlesAfterLoss : null;
    const iv = snap && snap.config ? snap.config.interval : null;
    const ms = intervalMs(iv);
    const cool =
      n === 0
        ? ""
        : ` Ook start de <strong>afkoelperiode na verlies</strong> voor ${esc(p.market)}: de bot koopt die markt ${
            n ? `de komende ${esc(n)} ${n === 1 ? "candle" : "candles"}${iv ? ` van ${esc(iv)}` : ""}${ms ? ` (≈ ${esc(fmt.duration(n * ms))})` : ""}` : "een tijdje"
          } niet.`;
    return `Dat verlies telt als <strong>gerealiseerd verlies van vandaag</strong>. Het kan de <strong>dagelijkse verlieslimiet</strong>${limit} laten afgaan: dan opent de bot vandaag <strong>geen nieuwe trades</strong> meer.${cool}`;
  }

  function confirmClose(id) {
    const snap = ctx.getState();
    const p = ((snap && snap.positions) || []).find((x) => x.id === id);
    if (!p) return;
    const live = snap.mode === "live";
    // Onverkoopbaar: uitleggen waarom verkopen nu niet lukt; proberen mag (de koers kan net gestegen zijn)
    const stuckHtml = p.unsellable
      ? `<p class="neg"><strong>Deze positie kan nu waarschijnlijk niet verkocht worden.</strong> ${esc(unsellableWhy(p))}</p>
        <p>Bitvavo weigert verkooporders onder het minimum (ook handmatig). Je kunt het toch proberen, wachten tot de waarde weer boven het minimum
        komt, of de positie <strong>afschrijven</strong> (knop naast Sluit).</p>`
      : "";
    ctx.openModal({
      title: `Positie ${p.market} sluiten?`,
      danger: live,
      bodyHtml: `${stuckHtml}<p>De positie wordt direct <strong>tegen marktprijs verkocht</strong>${live ? " (echt geld)" : " (oefengeld)"}.</p>
        <p>Huidige koers <strong class="mono">${esc(fmt.price(p.currentPrice))}</strong> · geschatte P&amp;L
        <strong class="mono ${fmt.pnlClass(p.unrealizedPnl)}">${esc(fmt.eurSigned(p.unrealizedPnl))} (${esc(
          fmt.pct(p.unrealizedPct),
        )})</strong></p>`,
      confirmText: p.unsellable ? "Toch proberen te verkopen" : "Nu verkopen",
      onConfirm: async (_value, modalEl) => {
        closing.add(id);
        renderPositions();
        try {
          const trade = await api.closePosition(id);
          tradeToast(
            trade,
            trade && isNum(trade.pnlQuote)
              ? [`${p.market} gesloten: ${fmt.eurSigned(trade.pnlQuote)} (${fmt.pct(trade.pnlPct)})`, trade.pnlQuote >= 0 ? "success" : "warn"]
              : [`${p.market} gesloten`, "success"],
          );
          await refreshState();
        } catch (err) {
          // Onder het beursminimum: geen ruwe engine-reden, maar uitleg + wat er nu gebeurt
          const info = closeRefusalInfo(err, p, ctx.getState() || snap, fmt);
          if (!info) throw err;
          await refreshState();
          const now = ctx.getState() || snap;
          const fresh = closeRefusalInfo(err, ((now && now.positions) || []).find((x) => x.id === id) || p, now, fmt) || info;
          const html = `<p class="neg"><strong>${esc(fresh.why)}</strong></p><p>${esc(fresh.next)}</p>`;
          if (!showModalResult(modalEl, fresh.title, html)) throw new Error(`${fresh.why} ${fresh.next}`);
          return false; // venster blijft open met de uitleg (knop Sluiten)
        } finally {
          closing.delete(id);
          renderPositions();
        }
      },
    });
  }

  function confirmWriteOff(id) {
    const snap = ctx.getState();
    const p = ((snap && snap.positions) || []).find((x) => x.id === id);
    if (!p) return;
    const live = snap.mode === "live";
    const base = String(p.market || "").split("-")[0];
    const value = (Number(p.amount) || 0) * (Number(p.currentPrice) || 0);
    ctx.openModal({
      title: `Positie ${p.market} afschrijven?`,
      danger: true,
      bodyHtml: `<p>${esc(unsellableWhy(p))}</p>
        <ul>
          <li>De bot <strong>stopt met het beheren</strong> van deze positie: geen stop-loss, geen take-profit en geen verkooppogingen meer.</li>
          <li>De coins (<span class="mono">${esc(fmt.amount(p.amount))} ${esc(base)}</span>, nu ≈ <span class="mono">${esc(fmt.eur(value))}</span>)
            <strong>blijven op je ${live ? "Bitvavo-account" : "oefenaccount"} staan</strong>${
              live ? " — je kunt ze later zelf op Bitvavo verkopen (of bijkopen tot boven het minimum)" : ""
            }.</li>
          <li>De inleg van <strong class="mono">${esc(fmt.eur(p.costQuote))}</strong> wordt als <strong>verlies</strong> geboekt (−100%) in je P&amp;L en trades.</li>
          <li>${writeOffRiskHtml(snap, p)}</li>
        </ul>
        <p class="muted">Dit kan niet ongedaan worden gemaakt. De bot controleert eerst de actuele koers: is de positie inmiddels weer verkoopbaar, dan wordt er niets afgeschreven.</p>`,
      confirmText: "Afschrijven",
      onConfirm: async (_value, modalEl) => {
        writingOff.add(id);
        renderPositions();
        // De server haalt eerst een verse koers op (live ook het saldo): dat kan even duren
        const note = busyNote(modalEl, "Actuele koers controleren en afschrijven…");
        try {
          const trade = await api.writeOffPosition(id);
          const loss = trade && isNum(trade.pnlQuote) ? trade.pnlQuote : -(Number(p.costQuote) || 0);
          tradeToast(trade, [`${p.market} afgeschreven: ${fmt.eurSigned(loss)} als verlies geboekt; de coins blijven op je account`, "warn"]);
          await refreshState();
        } catch (err) {
          // Geweigerd: de staat kan veranderd zijn (koers gestegen, positie al gesloten)
          await refreshState();
          const now = ctx.getState();
          const fresh = ((now && now.positions) || []).find((x) => x.id === id);
          const info = writeOffRefusalInfo(err, fresh || p, fmt);
          if (!info) throw err;
          if (!showModalResult(modalEl, info.title, `<p>${esc(info.text)}</p>`)) throw new Error(info.text);
          return false; // venster blijft open met de uitleg (knop Sluiten)
        } finally {
          if (note) note.remove();
          writingOff.delete(id);
          renderPositions();
        }
      },
    });
  }

  // ───────────── Trades ─────────────

  tradesEl.innerHTML = `
    <div class="panel-title">Laatste trades <span class="count" data-tc>0</span>
      <span class="panel-actions trades-summary" data-tsum></span></div>
    <div class="tbl-scroll" data-tbody></div>`;
  const tBody = tradesEl.querySelector("[data-tbody]");
  const tCount = tradesEl.querySelector("[data-tc]");
  const tSum = tradesEl.querySelector("[data-tsum]");

  function renderTrades(force = false) {
    const snap = ctx.getState();
    const all = (snap && snap.trades) || [];
    const trades = all.slice(0, 50);
    const key = `${all.length}|${trades[0] ? trades[0].id : ""}`;
    if (!force && key === tradesKey) return;
    tradesKey = key;
    tCount.textContent = String(all.length);
    if (!trades.length) {
      tSum.innerHTML = "";
      tBody.innerHTML = `<div class="empty">${EMPTY_TRD}<b>Nog geen trades</b><span>Afgesloten trades verschijnen hier met winst of verlies.</span></div>`;
      firstTrades = false;
      return;
    }
    const net = all.reduce((s, t) => s + (t.pnlQuote || 0), 0);
    const wins = all.filter((t) => t.pnlQuote > 0).length;
    const fees = all.reduce((s, t) => s + (t.feesQuote || 0), 0);
    tSum.innerHTML = `<span>winst <b class="${wins / all.length >= 0.5 ? "pos" : "neg"}">${esc(
      fmt.pct((wins / all.length) * 100, 0, false),
    )}</b></span><span>netto <b class="${fmt.pnlClass(net)}">${esc(fmt.eurSigned(net))}</b></span><span class="nowrap">fees <b>${esc(
      fmt.eur(fees),
    )}</b></span>`;

    const rows = trades
      .map((t) => {
        const cls = fmt.pnlClass(t.pnlQuote);
        const isNew = !firstTrades && !seenTrades.has(t.id);
        seenTrades.add(t.id);
        const writtenOff = t.exitReason === "write-off";
        const reasonCls =
          t.exitReason === "take-profit"
            ? "pos"
            : t.exitReason === "stop-loss" || t.exitReason === "kill-switch" || writtenOff
              ? "neg"
              : "";
        // Afgeschreven: er is niets verkocht, dus geen exitprijs (de coins staan nog op het account)
        const exitCell = writtenOff
          ? `<span class="muted" title="Afgeschreven: niets verkocht, de coins staan nog op je account">—</span>`
          : esc(fmt.price(t.exitPrice));
        return `<tr class="${isNew ? "row-new" : ""}" title="${esc(t.entryReason ? `Gekocht omdat: ${t.entryReason}` : "")}">
          <td class="first" data-label="Tijd"><span class="mono" title="${esc(fmt.dateTime(t.exitTime))}">${esc(fmt.dateTime(t.exitTime))}</span></td>
          <td data-label="Markt">${marketCell(t.market)}</td>
          <td class="num" data-label="Entry → exit">${esc(fmt.price(t.entryPrice))} <span class="muted">→</span> ${exitCell}</td>
          <td class="num ${cls}" data-label="P&amp;L">${esc(fmt.eurSigned(t.pnlQuote))}</td>
          <td class="num ${cls}" data-label="%">${esc(fmt.pct(t.pnlPct))}</td>
          <td class="num ${fmt.pnlClass(t.rMultiple)}" data-label="R" title="Winst/verlies in veelvouden van het risico">${
            isNum(t.rMultiple) ? `${t.rMultiple > 0 ? "+" : ""}${esc(fmt.num(t.rMultiple, 2))}R` : "–"
          }</td>
          <td data-label="Reden"><span class="reason-pill ${reasonCls}">${esc(fmt.exitReason(t.exitReason))}</span></td>
          <td class="num" data-label="Duur">${esc(fmt.duration(t.exitTime - t.entryTime))}</td>
        </tr>`;
      })
      .join("");
    firstTrades = false;
    tBody.innerHTML = `<table class="table responsive">
      <thead><tr><th>Tijd</th><th>Markt</th><th class="num">Entry → exit</th><th class="num">P&amp;L</th><th class="num">%</th>
      <th class="num">R</th><th>Reden</th><th class="num">Duur</th></tr></thead><tbody>${rows}</tbody></table>`;
  }

  tradesEl.addEventListener("click", (e) => {
    const m = e.target.closest("[data-market]");
    if (m) {
      bus.emit("market-selected", { market: m.dataset.market });
      document.getElementById("chart-main")?.scrollIntoView({ behavior: "smooth", block: "center" });
    }
  });

  // ───────────── Events ─────────────

  bus.on("snapshot", () => {
    renderPositions();
    renderTrades();
  });
  bus.on("price", (p) => p && updateLivePrice(p.market, p.price));
  bus.on("position-closed", () => renderTrades(true));

  // "Sinds"-kolom actueel houden
  setInterval(() => {
    const snap = ctx.getState();
    if (snap && snap.positions && snap.positions.length && !document.hidden) {
      const now = Date.now();
      pBody.querySelectorAll("tr[data-id]").forEach((tr) => {
        const p = snap.positions.find((x) => x.id === tr.dataset.id);
        const cell = tr.querySelector("[data-since]");
        if (p && cell) cell.textContent = fmt.duration(now - p.entryTime);
      });
    }
  }, 15_000);

  if (ctx.getState()) {
    renderPositions();
    renderTrades(true);
  } else {
    pBody.innerHTML = `<div class="panel-loading"><span class="spinner"></span></div>`;
    tBody.innerHTML = `<div class="panel-loading"><span class="spinner"></span></div>`;
  }
}
