// Logboek (A9): live gebeurtenissen van de bot, nieuwste eerst.

const MAX = 200;
const LS_FILTER = "bvt-log-filter";
const FILTERS = [
  { key: "all", label: "Alles" },
  { key: "trade", label: "Trades" },
  { key: "warn", label: "Waarschuwingen" },
  { key: "error", label: "Fouten" },
];
const LEVEL_LABEL = { info: "INFO", warn: "LET OP", error: "FOUT", trade: "TRADE" };

export function mountLog(ctx, el) {
  const { fmt, esc, bus } = ctx;
  let entries = []; // nieuwste eerst
  let keys = new Set();
  let filter = "all";
  try {
    const f = localStorage.getItem(LS_FILTER);
    if (FILTERS.some((x) => x.key === f)) filter = f;
  } catch {
    /* ignore */
  }

  el.innerHTML = `
    <div class="panel-title">Logboek <span class="count" data-n>0</span>
      <span class="panel-actions panel-sub" data-live></span></div>
    <div class="log-filters" role="group" aria-label="Filter logboek">
      ${FILTERS.map(
        (f) => `<button type="button" class="chip" data-f="${f.key}" aria-pressed="${f.key === filter}">${esc(f.label)}</button>`,
      ).join("")}
    </div>
    <div class="log-scroll"><ol class="log-list" data-list></ol></div>`;
  const list = el.querySelector("[data-list]");
  const countEl = el.querySelector("[data-n]");

  const keyOf = (e) => `${e.time}|${e.level}|${e.message}`;
  const matches = (e) => filter === "all" || e.level === filter;

  function rowHtml(e, isNew) {
    const lvl = LEVEL_LABEL[e.level] ? e.level : "info";
    return `<li class="log-row lvl-${lvl}${isNew ? " is-new" : ""}">
      <time datetime="${new Date(e.time).toISOString()}" title="${esc(fmt.dateTime(e.time))}">${esc(fmt.timeSec(e.time))}</time>
      <span class="lvl">${LEVEL_LABEL[lvl]}</span>
      <span class="msg">${esc(e.message)}</span>
    </li>`;
  }

  function render() {
    const shown = entries.filter(matches);
    countEl.textContent = String(shown.length);
    if (!shown.length) {
      list.innerHTML = `<li class="empty"><b>${entries.length ? "Niets in dit filter" : "Nog geen meldingen"}</b><span>${
        entries.length ? "Kies een ander filter." : "Zodra de bot draait verschijnen hier zijn acties."
      }</span></li>`;
      return;
    }
    list.innerHTML = shown.map((e) => rowHtml(e, false)).join("");
  }

  function trim() {
    if (entries.length > MAX) {
      entries.length = MAX;
      keys = new Set(entries.map(keyOf));
    }
  }

  function valid(e) {
    return e && typeof e.message === "string" && Number.isFinite(e.time);
  }

  /** Voegt entries toe (willekeurige volgorde); geeft de nieuwe terug */
  function merge(items) {
    const fresh = [];
    for (const e of items) {
      if (!valid(e)) continue;
      const k = keyOf(e);
      if (keys.has(k)) continue;
      keys.add(k);
      fresh.push(e);
    }
    if (fresh.length) {
      entries = entries.concat(fresh).sort((a, b) => b.time - a.time);
      trim();
    }
    return fresh;
  }

  function addLive(e) {
    if (!valid(e)) return;
    const fresh = merge([e]);
    if (!fresh.length) return;
    // Alleen bovenaan invoegen als hij echt de nieuwste is; anders volledig renderen
    if (entries[0] === e && matches(e) && list.querySelector(".log-row")) {
      list.insertAdjacentHTML("afterbegin", rowHtml(e, true));
      const rows = list.querySelectorAll(".log-row");
      if (rows.length > MAX) rows[rows.length - 1].remove();
      countEl.textContent = String(entries.filter(matches).length);
    } else {
      render();
    }
  }

  el.querySelector(".log-filters").addEventListener("click", (ev) => {
    const b = ev.target.closest("[data-f]");
    if (!b) return;
    filter = b.dataset.f;
    try {
      localStorage.setItem(LS_FILTER, filter);
    } catch {
      /* ignore */
    }
    el.querySelectorAll("[data-f]").forEach((x) => x.setAttribute("aria-pressed", String(x.dataset.f === filter)));
    render();
  });

  bus.on("snapshot", (snap) => {
    if (!snap || !Array.isArray(snap.logs)) return;
    if (merge(snap.logs).length) render();
  });
  bus.on("log", addLive);

  const snap = ctx.getState();
  if (snap && Array.isArray(snap.logs)) merge(snap.logs);
  render();
}
