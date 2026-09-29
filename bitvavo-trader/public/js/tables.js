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
      <span class="panel-actions panel-sub" data-psum></span></div>
    <div class="table-wrap" data-pbody></div>`;
  const pBody = positionsEl.querySelector("[data-pbody]");
  const pCount = positionsEl.querySelector("[data-pc]");
  const pSum = positionsEl.querySelector("[data-psum]");

  function rangeBar(p) {
    const stop = p.stopPrice;
    const tp = p.takeProfitPrice;
    if (!isNum(stop) || !isNum(tp) || tp <= stop) return `<span class="muted">–</span>`;
    const span = tp - stop;
    const clamp = (x) => Math.max(0, Math.min(100, x));
    const now = clamp(((p.currentPrice - stop) / span) * 100);
    const entry = clamp(((p.entryPrice - stop) / span) * 100);
    const cls = p.currentPrice >= p.entryPrice ? "pos" : "neg";
    return `<div class="rangebar" title="Koers tussen stop (${esc(fmt.price(stop))}) en doel (${esc(fmt.price(tp))}): ${Math.round(now)}%">
      <div class="track"></div>
      <div class="entry" style="left:${entry.toFixed(1)}%" title="Entry"></div>
      <div class="now ${cls}" style="left:${now.toFixed(1)}%"></div>
    </div>`;
  }

  function renderPositions() {
    const snap = ctx.getState();
    const positions = (snap && snap.positions) || [];
    pCount.textContent = String(positions.length);
    if (!positions.length) {
      pSum.innerHTML = "";
      pBody.innerHTML = `<div class="empty">${EMPTY_POS}<b>Geen open posities</b>
        <span>${snap && snap.running ? "De bot zoekt naar een koopkans…" : "Start de bot om te beginnen met (oefen)handelen."}</span></div>`;
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
        return `<tr data-id="${esc(p.id)}"${stuck ? ' class="is-unsellable"' : ""}>
          <td class="first" data-label="Markt"><div class="pos-market">${marketCell(p.market)}${
            stuck ? `<span class="badge badge-yellow" title="${esc(why)}">Onverkoopbaar</span>` : ""
          }</div></td>
          <td data-label="Sinds" title="${esc(fmt.dateTime(p.entryTime))}">${esc(fmt.duration(now - p.entryTime))}</td>
          <td class="num" data-label="Entry">${esc(fmt.price(p.entryPrice))}</td>
          <td class="num" data-label="Koers"><span class="price-cell" data-price="${esc(p.id)}">${esc(fmt.price(p.currentPrice))}</span></td>
          <td class="num neg" data-label="Stop" title="${trailing ? "Stop is meegeschoven (trailing/break-even)" : "Stop-loss"}">${esc(
            fmt.price(p.stopPrice),
          )}${trailing ? " ↑" : ""}</td>
          <td class="num pos" data-label="Doel">${esc(fmt.price(p.takeProfitPrice))}</td>
          <td class="num" data-label="Hoeveelheid">${esc(fmt.amount(p.amount))}</td>
          <td class="num" data-label="Inzet">${esc(fmt.eur(p.costQuote))}</td>
          <td class="num ${cls}" data-label="P&amp;L"><div class="cell-stack"><span>${esc(fmt.eurSigned(p.unrealizedPnl))}</span><small>${esc(
            fmt.pct(p.unrealizedPct),
          )}</small></div></td>
          <td class="full" data-label="Stop ↔ doel">${rangeBar(p)}</td>
          <td class="full" data-label=""><div class="pos-actions"><button type="button" class="btn btn-sm btn-danger" data-close="${esc(
            p.id,
          )}" ${busy ? "disabled" : ""} title="${esc(
            stuck ? `Verkopen lukt nu niet — ${why}` : "Verkoop deze positie nu tegen marktprijs",
          )}">Sluit</button>${
            stuck
              ? `<button type="button" class="btn btn-sm" data-writeoff="${esc(p.id)}" ${busy ? "disabled" : ""} title="${esc(
                  "Bot stopt met beheren; de coins blijven op je account; de inleg wordt als verlies geboekt",
                )}">Afschrijven</button>`
              : ""
          }</div></td>
        </tr>`;
      })
      .join("");
    pBody.innerHTML = `<table class="table responsive">
      <thead><tr>
        <th>Markt</th><th>Sinds</th><th class="num">Entry</th><th class="num">Koers</th><th class="num">Stop</th>
        <th class="num">Doel</th><th class="num">Hoeveelheid</th><th class="num">Inzet</th><th class="num">P&amp;L</th>
        <th>Stop ↔ doel</th><th></th>
      </tr></thead><tbody>${rows}</tbody></table>`;
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
      onConfirm: async () => {
        closing.add(id);
        renderPositions();
        try {
          const trade = await api.closePosition(id);
          if (trade && isNum(trade.pnlQuote)) {
            ctx.toast(`${p.market} gesloten: ${fmt.eurSigned(trade.pnlQuote)} (${fmt.pct(trade.pnlPct)})`, trade.pnlQuote >= 0 ? "success" : "warn");
          } else {
            ctx.toast(`${p.market} gesloten`, "success");
          }
          await refreshState();
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
        </ul>
        <p class="muted">Dit kan niet ongedaan worden gemaakt.</p>`,
      confirmText: "Afschrijven",
      onConfirm: async () => {
        writingOff.add(id);
        renderPositions();
        try {
          const trade = await api.writeOffPosition(id);
          const loss = trade && isNum(trade.pnlQuote) ? trade.pnlQuote : -(Number(p.costQuote) || 0);
          ctx.toast(`${p.market} afgeschreven: ${fmt.eurSigned(loss)} als verlies geboekt; de coins blijven op je account`, "warn");
          await refreshState();
        } finally {
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
        const reasonCls =
          t.exitReason === "take-profit" ? "pos" : t.exitReason === "stop-loss" || t.exitReason === "kill-switch" ? "neg" : "";
        return `<tr class="${isNew ? "row-new" : ""}" title="${esc(t.entryReason ? `Gekocht omdat: ${t.entryReason}` : "")}">
          <td class="first" data-label="Tijd"><span class="mono" title="${esc(fmt.dateTime(t.exitTime))}">${esc(fmt.dateTime(t.exitTime))}</span></td>
          <td data-label="Markt">${marketCell(t.market)}</td>
          <td class="num" data-label="Entry → exit">${esc(fmt.price(t.entryPrice))} <span class="muted">→</span> ${esc(fmt.price(t.exitPrice))}</td>
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
        const cell = tr.children[1];
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
