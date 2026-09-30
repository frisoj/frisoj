// Pure hulpfuncties van de Munten-radar (geen DOM), zodat ze los te testen zijn
// (tests/frontend/radarLogic.test.ts). Gebruikt door panels/radar.js.
//
// Eén rij per munt (RadarRow uit src/core/types.ts): status, prijs, 24u-verandering,
// volume, score van de bot en een korte Nederlandse uitleg. Stuurt de server (nog)
// geen `snapshot.radar`, dan bouwt `fallbackRows` de rijen uit de markten, de
// laatste beslissingen en de prijzen.

import { fmt, botMarkets } from "../format.js";

const isNum = (v) => typeof v === "number" && Number.isFinite(v);
const numOrNull = (v) => (isNum(v) ? v : null);

/** Filterknoppen (volgorde = volgorde op het scherm) */
export const RADAR_FILTERS = [
  { key: "all", label: "Alles", tip: "Alle munten die de bot volgt" },
  { key: "buy", label: "Koopsignaal", tip: "Munten waar de bot nu wil kopen (ook als het tegengehouden wordt)" },
  { key: "position", label: "In positie", tip: "Munten die de bot nu heeft" },
  { key: "blocked", label: "Tegengehouden", tip: "Koopsignaal, maar de bot koopt niet (bijv. trendfilter, spread of risicoregels)" },
];

/** Sorteringen */
export const RADAR_SORTS = [
  { key: "chance", label: "Kans" },
  { key: "change", label: "24u %" },
  { key: "volume", label: "Volume" },
  { key: "name", label: "Naam" },
];

export const RADAR_STATUSES = ["position", "candidate", "blocked", "watching", "pending", "error"];

/** Icoon + tekst per status (tegel en uitleg) */
export const STATUS_INFO = {
  position: { icon: "●", label: "In positie", tone: "accent", help: "De bot heeft deze munt nu." },
  candidate: { icon: "▲", label: "Koopsignaal", tone: "green", help: "De bot wil deze munt kopen." },
  blocked: { icon: "⛔", label: "Tegengehouden", tone: "red", help: "Koopsignaal, maar de bot koopt nu niet." },
  watching: { icon: "○", label: "Wacht", tone: "muted", help: "Bekeken: geen koopsignaal." },
  pending: { icon: "◌", label: "Nog niet bekeken", tone: "dim", help: "De bot heeft deze munt in deze ronde nog niet bekeken." },
  error: { icon: "⚠", label: "Geen data", tone: "yellow", help: "Koersdata ophalen mislukte; de bot probeert het straks opnieuw." },
};

/** Volgorde van de groepen bij sorteren op "Kans" */
const CHANCE_ORDER = { candidate: 0, blocked: 1, position: 2, watching: 3, pending: 4, error: 5 };

/** Geldige status van een rij (onbekend/ontbrekend → afgeleid van de actie) */
export function statusOf(row) {
  const s = row && row.status;
  if (RADAR_STATUSES.includes(s)) return s;
  if (!row) return "pending";
  if (row.action === "buy") return "candidate";
  if (row.action === "sell" || row.action === "hold") return "watching";
  return "pending";
}

/** Symbool zonder quote: "BTC-EUR" → "BTC" */
export function baseOf(market) {
  const m = String(market || "");
  const i = m.indexOf("-");
  return i > 0 ? m.slice(0, i) : m;
}

/**
 * Wat een tegel als status toont.
 * @returns {{ status: string, icon: string, text: string, tone: string, rank: number | null }}
 */
export function statusView(row) {
  const status = statusOf(row);
  const info = STATUS_INFO[status];
  const rank = row && isNum(row.rank) && row.rank >= 1 ? Math.round(row.rank) : null;
  let text = info.label;
  let icon = info.icon;
  if (status === "candidate" && rank !== null) {
    icon = `#${rank}`;
    text = rank === 1 ? "beste kans" : "koopkans";
  }
  return { status, icon, text, tone: info.tone, rank };
}

// ─────────────────────────────── Filteren / zoeken / sorteren ───────────────────────────────

/** Past de zoekterm bij deze markt? ("btc", "BTC-EUR", "btc-eur", "doge" …) */
export function matchesQuery(market, query) {
  const q = String(query || "")
    .trim()
    .toUpperCase()
    .replace(/[\s/]+/g, "-");
  if (!q) return true;
  const m = String(market || "").toUpperCase();
  return m.includes(q);
}

/** Hoort deze rij bij het filter? */
export function matchesFilter(row, filter) {
  const s = statusOf(row);
  switch (filter) {
    case "buy":
      return s === "candidate" || s === "blocked";
    case "position":
      return s === "position";
    case "blocked":
      return s === "blocked";
    default:
      return true;
  }
}

/** Filter + zoekterm (volgorde blijft gelijk) */
export function filterRows(rows, filter = "all", query = "") {
  return (Array.isArray(rows) ? rows : []).filter((r) => r && matchesFilter(r, filter) && matchesQuery(r.market, query));
}

/** Aantallen per status en per filterknop */
export function radarCounts(rows) {
  const c = { total: 0, all: 0, buy: 0, position: 0, blocked: 0, candidate: 0, watching: 0, pending: 0, error: 0 };
  for (const r of Array.isArray(rows) ? rows : []) {
    if (!r) continue;
    const s = statusOf(r);
    c.total++;
    c[s]++;
  }
  c.all = c.total;
  c.buy = c.candidate + c.blocked;
  return c;
}

const byName = (a, b) => String(a.market).localeCompare(String(b.market), "nl");
/** Aflopend, ontbrekende waarden achteraan */
const desc = (x, y) => (x === null && y === null ? 0 : x === null ? 1 : y === null ? -1 : y - x);

/**
 * Nieuwe, gesorteerde lijst.
 * "chance" (Kans): koopsignalen (op plek in de kansenronde, dan score), tegengehouden,
 * posities, wachtend (hoogste score eerst), nog niet bekeken, fouten.
 * "change": 24u % hoog → laag. "volume": 24u-volume hoog → laag. "name": A → Z.
 */
export function sortRows(rows, sort = "chance") {
  const list = (Array.isArray(rows) ? rows : []).filter(Boolean).slice();
  let cmp;
  if (sort === "change") cmp = (a, b) => desc(numOrNull(a.changePct24h), numOrNull(b.changePct24h)) || byName(a, b);
  else if (sort === "volume") cmp = (a, b) => desc(numOrNull(a.volumeQuote24h), numOrNull(b.volumeQuote24h)) || byName(a, b);
  else if (sort === "name") cmp = (a, b) => byName(a, b);
  else {
    const rankOf = (r) => (isNum(r.rank) ? r.rank : Infinity);
    cmp = (a, b) =>
      CHANCE_ORDER[statusOf(a)] - CHANCE_ORDER[statusOf(b)] ||
      rankOf(a) - rankOf(b) ||
      desc(numOrNull(a.score), numOrNull(b.score)) ||
      byName(a, b);
  }
  return list.sort(cmp);
}

/** Filter, zoekterm en sortering in één keer */
export function visibleRows(rows, { filter = "all", query = "", sort = "chance" } = {}) {
  return sortRows(filterRows(rows, filter, query), sort);
}

// ─────────────────────────────── Score → kleur / balk ───────────────────────────────

// Divergerend: rood (verkoopkant) ← grijs (neutraal) → groen (koopkant); zelfde tinten als --red/--muted/--green.
export const SCORE_COLORS = {
  sell: [242, 73, 92],
  neutral: [126, 136, 157],
  buy: [30, 197, 128],
};

/** Score begrensd op −1..1 (ongeldig → null) */
export function clampScore(score) {
  const s = Number(score);
  if (score === null || score === undefined || !Number.isFinite(s)) return null;
  return Math.max(-1, Math.min(1, s));
}

/**
 * Kleur bij een score (−1..1): neutraal grijs rond 0, voller groen naar +1 (kopen) en
 * voller rood naar −1 (verkopen). Leest goed op het donkere thema. Ongeldig → grijs.
 * @returns {string} "rgb(r, g, b)"
 */
export function scoreColor(score) {
  const s = clampScore(score);
  const [nr, ng, nb] = SCORE_COLORS.neutral;
  if (s === null || s === 0) return `rgb(${nr}, ${ng}, ${nb})`;
  const [tr, tg, tb] = s > 0 ? SCORE_COLORS.buy : SCORE_COLORS.sell;
  // kleine scores al zichtbaar gekleurd (wortel), ±1 = de volle themakleur
  const t = Math.sqrt(Math.abs(s));
  const mix = (a, b) => Math.round(a + (b - a) * t);
  return `rgb(${mix(nr, tr)}, ${mix(ng, tg)}, ${mix(nb, tb)})`;
}

/**
 * Balk vanuit het midden: positief naar rechts (kopen), negatief naar links (verkopen).
 * @returns {{ left: number, width: number, side: "buy" | "sell" | "none" }} in % van de balk
 */
export function scoreBar(score) {
  const s = clampScore(score);
  if (s === null || s === 0) return { left: 50, width: 0, side: "none" };
  const w = Math.abs(s) * 50;
  return s > 0 ? { left: 50, width: w, side: "buy" } : { left: 50 - w, width: w, side: "sell" };
}

const NF2 = new Intl.NumberFormat("nl-NL", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

/** "+0,52" / "-0,30" / "0,00" / "–" (zoals de meter in het signaalpaneel) */
export function scoreText(score) {
  const s = clampScore(score);
  if (s === null) return "–";
  return (s > 0 ? "+" : "") + NF2.format(s);
}

// ─────────────────────────────── Teksten ───────────────────────────────

const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`;

/**
 * Samenvatting bovenaan: "30 munten gevolgd (automatisch) · 4 koopsignalen · 1 positie".
 * @param {{ count: number, mode?: string | null, buy: number, positions: number }} v
 */
export function summaryText({ count = 0, mode = null, buy = 0, positions = 0 } = {}) {
  const how = mode === "auto" ? " (automatisch)" : mode === "manual" ? " (zelf gekozen)" : "";
  const coins = `${plural(count, "munt", "munten")} gevolgd${how}`;
  const sig = buy > 0 ? plural(buy, "koopsignaal", "koopsignalen") : "geen koopsignalen";
  const pos = positions > 0 ? plural(positions, "positie", "posities") : "geen posities";
  return `${coins} · ${sig} · ${pos}`;
}

/** Hoe de bot zijn munten kiest: "auto" | "manual" */
export function universeMode(snap) {
  const u = snap && snap.universe;
  if (u && (u.mode === "auto" || u.mode === "manual")) return u.mode;
  const c = snap && snap.config && snap.config.universe;
  if (c && (c.mode === "auto" || c.mode === "manual")) return c.mode;
  return "manual";
}

/** Samenvatting van een hele snapshot (met de rijen die de radar toont) */
export function snapshotSummary(snap, rows) {
  const counts = radarCounts(rows);
  const active = botMarkets(snap);
  const positions = snap && Array.isArray(snap.positions) ? snap.positions.length : counts.position;
  return summaryText({ count: active.length, mode: universeMode(snap), buy: counts.buy, positions });
}

/** "50 dagen" (1d) / "200 uur" (4h: 50 × 4 uur) */
export function trendPeriodText(interval, period) {
  const p = isNum(period) && period > 0 ? Math.round(period) : 50;
  if (interval === "4h") return `${p * 4} uur`;
  if (interval === "1d" || !interval) return plural(p, "dag", "dagen");
  return `${p} candles van ${interval}`;
}

/**
 * Badge van het marktfilter (Bitcoin-trend).
 * `marketFilter` undefined (oudere server) → null (geen badge); null → filter staat uit.
 * @returns {null | { kind: "ok" | "bad" | "unknown" | "off", icon: string, text: string, note: string }}
 */
export function marketFilterBadge(marketFilter) {
  if (marketFilter === undefined) return null;
  if (marketFilter === null || typeof marketFilter !== "object") {
    return {
      kind: "off",
      icon: "○",
      text: "Marktfilter uit",
      note: "De bot kijkt bij het kopen niet naar de trend van Bitcoin. Aanzetten kan bij Instellingen (Trendfilter).",
    };
  }
  const who = !marketFilter.market || /^BTC-/.test(marketFilter.market) ? "Bitcoin" : baseOf(marketFilter.market);
  const avg = `gemiddelde van ${trendPeriodText(marketFilter.interval, marketFilter.period)}`;
  const note = typeof marketFilter.note === "string" ? marketFilter.note.trim() : "";
  if (marketFilter.ok === true) {
    return { kind: "ok", icon: "✓", text: `${who} boven ${avg} — kopen mag`, note: note || `${who} staat boven zijn ${avg}.` };
  }
  if (marketFilter.ok === false) {
    return {
      kind: "bad",
      icon: "✕",
      text: `${who} onder ${avg} — de bot koopt nu niet`,
      note: note || `${who} staat onder zijn ${avg}. Verkopen en stops gaan gewoon door.`,
    };
  }
  return {
    kind: "unknown",
    icon: "?",
    text: `${who}-trend onbekend — de bot koopt nu niet`,
    note: note || `Nog te weinig koersdata van ${who} om de trend te bepalen. Uit voorzorg koopt de bot niet.`,
  };
}

/**
 * Voortgang van de ronde ("Ronde: 280 van 400 munten bekeken").
 * @returns {null | { text: string, pct: number | null, busy: boolean }}
 */
export function roundView(scan, running = true) {
  if (!scan || typeof scan !== "object" || !isNum(scan.total) || scan.total <= 0) return null;
  const total = Math.round(scan.total);
  const done = Math.max(0, Math.min(total, Math.round(isNum(scan.done) ? scan.done : 0)));
  if (running === false) {
    return { text: "Bot staat stil — de munten worden nu niet bekeken", pct: null, busy: false };
  }
  if (done < total) {
    return { text: `Ronde: ${done} van ${total} munten bekeken`, pct: (done / total) * 100, busy: true };
  }
  const at = isNum(scan.lastRoundCompletedAt) ? ` (${fmt.time(scan.lastRoundCompletedAt)})` : "";
  return {
    text: total === 1 ? `Ronde klaar: de munt is bekeken${at}` : `Ronde klaar: alle ${total} munten bekeken${at}`,
    pct: 100,
    busy: false,
  };
}

const compactNf = new Intl.NumberFormat("nl-NL", { notation: "compact", maximumFractionDigits: 1 });

/** "€ 1,2 mln." / "–" */
export function volumeText(v) {
  return isNum(v) ? `€ ${compactNf.format(v)}` : "–";
}

/** Uitleg bij een tegel (tooltip, en de detailregel na een tik) */
export function rowTitle(row) {
  if (!row) return "";
  const sv = statusView(row);
  const parts = [row.market, sv.rank !== null ? `${STATUS_INFO[sv.status].label} #${sv.rank}` : STATUS_INFO[sv.status].label];
  if (clampScore(row.score) !== null) parts.push(`score ${scoreText(row.score)}`);
  if (isNum(row.changePct24h)) parts.push(`24u ${fmt.pct(row.changePct24h)}`);
  if (isNum(row.volumeQuote24h)) parts.push(`volume ${volumeText(row.volumeQuote24h)}`);
  if (isNum(row.spreadPct)) parts.push(`spread ${fmt.pct(row.spreadPct, 2, false)}`);
  const trend = coinTrendText(row);
  if (trend) parts.push(trend);
  let t = parts.join(" · ");
  const note = rowNote(row);
  if (note) t += ` — ${note}`;
  return t;
}

/** Muntfilter (trend van de munt zelf): "munt boven gemiddelde" / "munt onder gemiddelde" / "" (uit of onbekend) */
export function coinTrendText(row) {
  if (!row || typeof row.trendOk !== "boolean") return "";
  return row.trendOk ? "munt boven gemiddelde" : "munt onder gemiddelde";
}

/** De uitleg van de engine, of een korte standaardtekst per status */
export function rowNote(row) {
  if (!row) return "";
  const n = typeof row.note === "string" ? row.note.trim() : "";
  if (n) return n;
  const s = statusOf(row);
  if (s === "watching" || s === "candidate") return "";
  return STATUS_INFO[s].help;
}

// ─────────────────────────────── Rijen ───────────────────────────────

/** Nieuwste van twee beslissingen (op candle-tijd) */
function newer(a, b) {
  if (!a) return b || null;
  if (!b) return a;
  return (Number(b.time) || 0) > (Number(a.time) || 0) ? b : a;
}

/**
 * Rijen zonder `snapshot.radar` (oudere server): de gevolgde markten plus markten met een
 * open positie, met prijs, laatste beslissing en een status afgeleid van die beslissing.
 * `extraDecisions` = beslissingen die via SSE binnenkwamen (market → EnsembleDecision).
 */
export function fallbackRows(snap, extraDecisions = null) {
  if (!snap || typeof snap !== "object") return [];
  const positions = Array.isArray(snap.positions) ? snap.positions.filter((p) => p && p.market) : [];
  const posMarkets = new Set(positions.map((p) => p.market));
  const markets = [...new Set([...botMarkets(snap), ...positions.map((p) => p.market)])];
  const decisions = snap.decisions && typeof snap.decisions === "object" ? snap.decisions : {};
  const prices = snap.prices && typeof snap.prices === "object" ? snap.prices : {};
  return markets.map((m) => {
    const d = newer(decisions[m], extraDecisions && extraDecisions[m]);
    const pos = positions.find((p) => p.market === m);
    const status = posMarkets.has(m) ? "position" : d ? (d.action === "buy" ? "candidate" : "watching") : "pending";
    return {
      market: m,
      price: numOrNull(prices[m]) ?? numOrNull(pos && pos.currentPrice) ?? numOrNull(d && d.price),
      changePct24h: null,
      volumeQuote24h: null,
      spreadPct: null,
      action: d ? d.action : null,
      score: d ? numOrNull(d.score) : null,
      regime: d ? d.regime || null : null,
      evaluatedAt: d ? numOrNull(d.time) : null,
      trendOk: null,
      status,
    };
  });
}

/**
 * De rijen van de radar: `snapshot.radar` als de server die stuurt, anders `fallbackRows`.
 * @returns {{ rows: object[], fallback: boolean }}
 */
export function radarData(snap, extraDecisions = null) {
  if (snap && Array.isArray(snap.radar)) {
    const seen = new Set();
    const rows = [];
    for (const r of snap.radar) {
      if (!r || typeof r.market !== "string" || seen.has(r.market)) continue;
      seen.add(r.market);
      rows.push(r);
    }
    return { rows, fallback: false };
  }
  return { rows: fallbackRows(snap, extraDecisions), fallback: !!snap };
}

/** Actuele prijs van een rij: live prijs uit de snapshot, anders die van de radar */
export function rowPrice(row, prices) {
  const p = prices && row ? prices[row.market] : undefined;
  return isNum(p) ? p : row ? numOrNull(row.price) : null;
}

/** Handtekening van wat een tegel toont (alleen bij een wijziging opnieuw tekenen) */
export function rowSig(row, price = row ? row.price : null) {
  if (!row) return "";
  return [
    row.market,
    statusOf(row),
    row.rank ?? "",
    price ?? "",
    row.changePct24h ?? "",
    row.volumeQuote24h ?? "",
    row.spreadPct ?? "",
    row.score ?? "",
    row.action ?? "",
    row.regime ?? "",
    row.trendOk ?? "",
    row.note ?? "",
  ].join("|");
}
