// Tabblad "Wedstrijd" (v3): pure hulpjes zonder DOM, zodat alles in Node getest kan
// worden. Ranglijst, opmaak per bot, de analyse in gewoon Nederlands, de lijnen voor
// de grafiek, lege/fout-staten en de teksten rond "Alles starten / stoppen / Noodstop".
//
// Invoer = BotSummary[] van GET /api/bots (zie src/core/types.ts), liefst eerst door
// normalizeBots() (../bots.js) gehaald.

import { fmt } from "../format.js";
import { safeColor, botHref } from "../bots.js";

/** Verversen van /api/bots zolang het tabblad (en de pagina) zichtbaar is */
export const POLL_MS = 10_000;
/** Onder dit aantal afgesloten trades (alle bots samen) zegt de uitslag nog weinig */
export const FEW_TRADES = 20;
/** Bedragen onder een halve cent tellen als nul */
const CENT = 0.005;

const isNum = (v) => typeof v === "number" && Number.isFinite(v);
const n0 = (v) => (isNum(v) ? v : 0);
const list = (bots) => (Array.isArray(bots) ? bots.filter((b) => b && typeof b === "object") : []);
const nameOf = (b) => (b && (b.name || b.short || b.id)) || "?";
const shortOf = (b) => (b && (b.short || b.name || b.id)) || "?";

/** Totaal resultaat in € (engine) */
const netOf = (b) => n0(b && b.totalPnlQuote);
/** Resultaat vóór kosten (server: grossPnlQuote = totalPnlQuote + feesPaid) */
const grossOf = (b) => (isNum(b && b.grossPnlQuote) ? b.grossPnlQuote : netOf(b) + n0(b && b.feesPaid));

/** "5m" → "5 min", "1h" → "1 uur", "1d" → "1 dag" (onbekend: zoals het is) */
export function intervalLabel(iv) {
  const m = /^(\d+)([mhd])$/.exec(String(iv || ""));
  if (!m) return String(iv || "");
  const n = Number(m[1]);
  if (m[2] === "m") return `${n} min`;
  if (m[2] === "h") return `${n} uur`;
  return `${n} ${n === 1 ? "dag" : "dagen"}`;
}

/** Tempo in gewone taal: "5m" → "elke 5 min", "1h" → "elk uur", "4h" → "elke 4 uur", "1d" → "elke dag" */
export function paceLabel(iv) {
  const m = /^(\d+)([mhd])$/.exec(String(iv || ""));
  if (!m) return "";
  const n = Number(m[1]);
  if (m[2] === "m") return `elke ${n} min`;
  if (m[2] === "h") return n === 1 ? "elk uur" : `elke ${n} uur`;
  return n === 1 ? "elke dag" : `elke ${n} dagen`;
}

/** Nederlandse opsomming: "A", "A en B", "A, B en C" */
export function listNames(names) {
  const a = (names || []).filter(Boolean).map(String);
  if (a.length <= 1) return a[0] || "";
  return `${a.slice(0, -1).join(", ")} en ${a[a.length - 1]}`;
}

const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`;

// ─────────────────────────────── Ranglijst ───────────────────────────────

/** Rendement zoals getoond (2 decimalen); onbekend → -Infinity (achteraan) */
function shownPct(v) {
  return isNum(v) ? Math.round(v * 100) / 100 + 0 : -Infinity;
}

/**
 * Ranglijst op totaal rendement (hoogste eerst). Bots met hetzelfde rendement zoals
 * het getoond wordt (op 0,01% afgerond) delen dezelfde plaats (1, 1, 3, 4). Binnen
 * een gedeelde plaats: hoger resultaat in € eerst, daarna de volgorde van de server.
 * @returns {Array<object & { rank: number, tied: boolean }>}
 */
export function rankBots(bots) {
  const rows = list(bots).map((b, i) => ({ b, i, key: shownPct(b.totalReturnPct) }));
  rows.sort((x, y) => y.key - x.key || netOf(y.b) - netOf(x.b) || x.i - y.i);
  const counts = new Map();
  for (const r of rows) counts.set(r.key, (counts.get(r.key) || 0) + 1);
  let rank = 0;
  return rows.map((r, pos) => {
    if (pos === 0 || r.key !== rows[pos - 1].key) rank = pos + 1;
    return { ...r.b, rank, tied: counts.get(r.key) > 1 };
  });
}

/**
 * Is de wedstrijd al begonnen? Pas als een bot iets gedaan heeft (een trade, een open
 * positie of een resultaat) zijn er plaatsen; daarvoor staat iedereen gelijk op nul.
 */
export function raceStarted(bots) {
  return list(bots).some((b) => n0(b.trades) > 0 || n0(b.openPositions) > 0 || Math.abs(netOf(b)) >= CENT);
}

/**
 * Medaille voor een plaats: goud / zilver / brons, daarna een gewoon nummer.
 * `started` = false (nog niemand gehandeld): een neutrale medaille zonder plaats.
 * `solo` = er draait maar één bot: geen goud voor een wedstrijd zonder tegenstanders.
 */
export function medal(rank, tied = false, started = true, solo = false) {
  if (solo) return { cls: "plain", text: "1", label: "Er draait maar één bot" };
  if (!started) return { cls: "plain", text: "–", label: "Nog geen plaats: er is nog niet gehandeld" };
  const cls = rank === 1 ? "gold" : rank === 2 ? "silver" : rank === 3 ? "bronze" : "plain";
  return { cls, text: String(rank), label: `${rank}e plaats${tied ? " (gedeeld)" : ""}` };
}

// ─────────────────────────────── Per bot ───────────────────────────────

/**
 * Status van een bot: actief / gestopt / gepauzeerd (risicobeheer) / winst vastgezet.
 * `reason` = de Nederlandse reden van de engine (leeg als er geen is).
 */
export function statusView(b) {
  const h = (b && b.halted && typeof b.halted === "object" && b.halted) || {};
  const reason = typeof h.reason === "string" ? h.reason.trim() : "";
  if (h.halted && h.dailyTarget) {
    return { key: "target", label: "Winst vastgezet", cls: "badge-green", dot: "on", reason: reason || "Dagdoel gehaald: de winst is vastgezet tot morgen." };
  }
  if (b && b.running && h.halted) {
    return { key: "halted", label: "Gepauzeerd", cls: "badge-yellow", dot: "warn", reason: reason || "Nieuwe trades gepauzeerd door het risicobeheer." };
  }
  if (b && b.running) return { key: "running", label: "Actief", cls: "badge-green", dot: "on", reason: "" };
  return { key: "stopped", label: "Gestopt", cls: "badge-muted", dot: "off", reason: h.halted ? reason : "" };
}

/** Badge voor de bot die in live modus draait (null = oefengeld) */
export function liveBadge(b) {
  if (!b || b.mode !== "live") return null;
  return b.liveArmed
    ? { text: "Echt geld", cls: "badge-red", title: "Deze bot handelt met echt geld op je Bitvavo-account." }
    : { text: "Live · uit", cls: "badge-yellow", title: "Live modus, maar live handel is niet ingeschakeld: deze bot geeft alleen signalen." };
}

/**
 * Wat de kosten met het resultaat doen (voor de balk op de kaart).
 *  - "none":  nog geen kosten
 *  - "keeps": winst vóór kosten, en de bot houdt er iets van over (`keptPct` + `feePct` = 100)
 *  - "eaten": de kosten zijn even groot of groter dan de winst vóór kosten
 *  - "loss":  ook vóór kosten al verlies; de kosten maken het erger
 */
export function costView(b) {
  const fees = n0(b && b.feesPaid);
  const gross = grossOf(b);
  if (fees < CENT) return { kind: "none", keptPct: 0, feePct: 0, text: "Nog geen kosten betaald" };
  if (gross > CENT && gross - fees > CENT) {
    const feePct = Math.min(100, Math.max(0, (fees / gross) * 100));
    return {
      kind: "keeps",
      keptPct: 100 - feePct,
      feePct,
      text: `${fmt.pct(feePct, 0, false)} van de winst vóór kosten ging naar kosten`,
    };
  }
  if (gross > CENT) return { kind: "eaten", keptPct: 0, feePct: 100, text: "De kosten zijn groter dan de winst vóór kosten" };
  return { kind: "loss", keptPct: 0, feePct: 100, text: "Ook vóór kosten verlies; de kosten maken het erger" };
}

/**
 * Alles wat een kaart op de ranglijst toont, als tekst (Nederlandse opmaak).
 * `b` = een regel uit rankBots(); `currentId` = de bot van dit dashboard; `solo` = er draait maar één bot.
 */
export function cardView(b, currentId = "", started = true, solo = false) {
  const trades = Math.max(0, Math.round(n0(b.trades)));
  const wins = Math.max(0, Math.round(n0(b.wins)));
  const losses = Math.max(0, Math.round(n0(b.losses)));
  const gross = grossOf(b);
  const dd = isNum(b.maxDrawdownPct) ? Math.min(0, b.maxDrawdownPct) : null;
  const ddShown = dd !== null && dd <= -0.005 ? dd : 0;
  const open = Math.max(0, Math.round(n0(b.openPositions)));
  const rank = isNum(b.rank) ? b.rank : 0;
  return {
    id: b.id,
    name: nameOf(b),
    short: shortOf(b),
    description: typeof b.description === "string" ? b.description : "",
    color: safeColor(b.color),
    href: botHref(b, "live"),
    current: !!currentId && b.id === currentId,
    rank,
    medal: medal(rank, !!b.tied, started, solo),
    status: statusView(b),
    live: liveBadge(b),
    paceTip: b.interval ? `Beslist na elke candle van ${intervalLabel(b.interval)}` : "",
    meta: [
      paceLabel(b.interval),
      isNum(b.startingEquity) ? `budget ${fmt.eur(b.startingEquity)}` : "",
      open ? `${plural(open, "positie", "posities")} open` : "",
    ].filter(Boolean),
    resultEur: fmt.eurSigned(b.totalPnlQuote),
    resultPct: fmt.pct(b.totalReturnPct),
    resultCls: fmt.pnlClass(isNum(b.totalReturnPct) ? shownPct(b.totalReturnPct) : b.totalPnlQuote),
    grossEur: fmt.eurSigned(gross),
    grossCls: fmt.pnlClass(Math.abs(gross) < CENT ? 0 : gross),
    fees: fmt.eur(n0(b.feesPaid)),
    cost: costView(b),
    winRate: trades ? fmt.pct(n0(b.winRatePct), 0, false) : "–",
    winLoss: trades ? `${wins}W / ${losses}V` : "nog geen trades",
    winCls: !trades ? "flat" : n0(b.winRatePct) >= 50 ? "pos" : "neg",
    tradesToday: String(Math.max(0, Math.round(n0(b.tradesToday)))),
    tradesTotal: String(trades),
    maxDd: fmt.pct(ddShown),
    ddCls: ddShown ? "neg" : "flat",
    dayEur: fmt.eurSigned(b.dayPnlQuote),
    dayPct: fmt.pct(b.dayReturnPct),
    dayCls: fmt.pnlClass(Math.abs(n0(b.dayPnlQuote)) < CENT ? 0 : b.dayPnlQuote),
  };
}

/** Regel onder de titel: "4 bots · oefengeld · 3 actief · bijgewerkt 14:32:05" */
export function subtitle(bots, at = null) {
  const l = list(bots);
  if (!l.length) return "";
  const parts = [plural(l.length, "bot", "bots")];
  const live = l.filter((b) => b.mode === "live");
  if (!live.length) parts.push("oefengeld");
  else {
    const armed = live.filter((b) => b.liveArmed);
    parts.push(armed.length ? `${listNames(armed.map(shortOf))} met echt geld` : `${listNames(live.map(shortOf))} live (alleen signalen)`);
  }
  const running = l.filter((b) => b.running).length;
  if (running === l.length) parts.push(l.length === 1 ? "actief" : "allemaal actief");
  else if (running === 0) parts.push(l.length === 1 ? "gestopt" : "allemaal gestopt");
  else parts.push(`${running} actief`);
  if (isNum(at)) parts.push(`bijgewerkt ${fmt.timeSec(at)}`);
  return parts.join(" · ");
}

// ─────────────────────────────── Analyse ───────────────────────────────

const toneOf = (v) => (v > CENT ? "pos" : v < -CENT ? "neg" : "flat");

/**
 * De analyse in gewoon Nederlands: wie ligt voor, verdient een bot meer dan zijn
 * kosten, en hoeveel van het resultaat vóór kosten ging naar kosten. Eerlijk: ook
 * als iedereen verliest, en met een waarschuwing als er nog weinig trades zijn.
 * @returns {{ headline: { text: string, tone: "pos"|"neg"|"flat" }, points: { key: string, text: string, tone: "pos"|"neg"|"flat" }[] }}
 */
export function analysis(bots) {
  const l = list(bots);
  if (!l.length) return { headline: { text: "Er draaien geen bots.", tone: "flat" }, points: [] };
  const multi = l.length > 1;
  const totalTrades = l.reduce((s, b) => s + Math.max(0, n0(b.trades)), 0);
  const totalOpen = l.reduce((s, b) => s + Math.max(0, n0(b.openPositions)), 0);
  const points = [];

  const stopped = l.filter((b) => !b.running);
  const stoppedPoint = () => {
    if (!stopped.length) return;
    if (stopped.length === l.length) {
      points.push({
        key: "stopped",
        text: multi ? "Alle bots staan stil. Druk op Alles starten om de wedstrijd (weer) te beginnen." : `${nameOf(l[0])} staat stil.`,
        tone: "flat",
      });
    } else {
      points.push({
        key: "stopped",
        text: `${listNames(stopped.map(nameOf))} ${stopped.length === 1 ? "staat" : "staan"} stil en ${stopped.length === 1 ? "doet" : "doen"} nu niet mee.`,
        tone: "flat",
      });
    }
  };

  // Nog niets gebeurd
  if (totalTrades === 0 && totalOpen === 0) {
    points.push({
      key: "wait",
      text: "Zodra de bots gaan handelen, zie je hier wie voorligt en of de winst opweegt tegen de kosten.",
      tone: "flat",
    });
    stoppedPoint();
    return { headline: { text: "Nog geen trades: de wedstrijd is net begonnen.", tone: "flat" }, points };
  }

  // Wie ligt voor
  const ranked = rankBots(l);
  const top = ranked.filter((b) => b.rank === 1);
  const lead = top[0];
  const leadKey = shownPct(lead.totalReturnPct);
  const res = (b) => `${fmt.pct(b.totalReturnPct)} (${fmt.eurSigned(b.totalPnlQuote)})`;
  let headline;
  if (!multi) {
    headline = { text: `${nameOf(lead)} staat op ${res(lead)}.`, tone: toneOf(leadKey) };
  } else if (top.length === l.length) {
    headline = { text: `Alle bots staan gelijk: ${fmt.pct(lead.totalReturnPct)}.`, tone: toneOf(leadKey) };
  } else if (top.length > 1) {
    headline = { text: `${listNames(top.map(nameOf))} staan samen bovenaan met ${fmt.pct(lead.totalReturnPct)}.`, tone: toneOf(leadKey) };
  } else if (leadKey < 0) {
    headline = { text: `Alle bots staan in de min. ${nameOf(lead)} verliest het minst: ${res(lead)}.`, tone: "neg" };
  } else if (leadKey === 0) {
    headline = { text: `${nameOf(lead)} staat bovenaan, maar zonder winst (${fmt.pct(lead.totalReturnPct)}).`, tone: "flat" };
  } else {
    const second = ranked[1];
    headline = {
      text: `${nameOf(lead)} ligt voor met ${res(lead)}.${second ? ` Daarna volgt ${nameOf(second)} met ${fmt.pct(second.totalReturnPct)}.` : ""}`,
      tone: "pos",
    };
  }

  // Verdient een bot meer dan zijn kosten? (resultaat ná kosten > 0 ⇔ winst vóór kosten > kosten)
  const totalFees = l.reduce((s, b) => s + Math.max(0, n0(b.feesPaid)), 0);
  if (totalTrades > 0 || totalFees >= CENT) {
    const beat = l.filter((b) => netOf(b) > CENT);
    const grossOnly = l.filter((b) => netOf(b) <= CENT && grossOf(b) > CENT);
    if (!multi) {
      const b = l[0];
      points.push(
        beat.length
          ? { key: "costs", text: `${nameOf(b)} verdient meer dan zijn kosten.`, tone: "pos" }
          : grossOnly.length
            ? { key: "costs", text: `${nameOf(b)} maakt vóór kosten winst, maar de kosten eten die op.`, tone: "neg" }
            : { key: "costs", text: `${nameOf(b)} verdient nog niet meer dan zijn kosten.`, tone: "neg" },
      );
    } else if (!beat.length) {
      points.push({ key: "costs", text: "Geen enkele bot verdient nu meer dan zijn kosten.", tone: "neg" });
    } else if (beat.length === l.length) {
      points.push({ key: "costs", text: "Alle bots verdienen meer dan hun kosten.", tone: "pos" });
    } else if (beat.length === 1) {
      points.push({ key: "costs", text: `Alleen ${nameOf(beat[0])} verdient meer dan zijn kosten.`, tone: "pos" });
    } else {
      points.push({ key: "costs", text: `${listNames(beat.map(nameOf))} verdienen meer dan hun kosten.`, tone: "pos" });
    }
    if (multi && grossOnly.length) {
      points.push({
        key: "eaten",
        text: `${listNames(grossOnly.map(nameOf))} ${grossOnly.length === 1 ? "maakt" : "maken"} vóór kosten wel winst, maar de kosten eten die op.`,
        tone: "neg",
      });
    }
  }

  // Welk deel van het resultaat vóór kosten ging naar kosten
  if (totalFees >= CENT) {
    const gross = l.reduce((s, b) => s + grossOf(b), 0);
    const who = multi ? "Alle bots samen: " : "";
    // "Alle bots samen: vóór kosten …" of, met één bot, "Vóór kosten …"
    const withWho = (text) => (who ? who + text : text.charAt(0).toUpperCase() + text.slice(1));
    if (gross > CENT) {
      const share = (totalFees / gross) * 100;
      let text;
      if (share >= 100) {
        text = `${who}${fmt.eur(gross)} winst vóór kosten, maar ${fmt.eur(totalFees)} aan kosten: de kosten zijn groter dan de winst.`;
      } else {
        text = `${who}${fmt.eur(gross)} winst vóór kosten, waarvan ${fmt.eur(totalFees)} (${fmt.pct(share, 0, false)}) naar kosten ging.`;
        if (share >= 50) text += " Dat is meer dan de helft.";
      }
      points.push({ key: "fees", text, tone: share >= 50 ? "neg" : "flat" });
    } else if (gross < -CENT) {
      points.push({
        key: "fees",
        text: withWho(`vóór kosten al ${fmt.eur(-gross)} verlies; de kosten (${fmt.eur(totalFees)}) maken het verlies groter.`),
        tone: "neg",
      });
    } else {
      points.push({
        key: "fees",
        text: withWho(`vóór kosten stond het resultaat op nul; het verlies komt helemaal door de kosten (${fmt.eur(totalFees)}).`),
        tone: "neg",
      });
    }
    if (multi) {
      const most = [...l].sort((a, b) => n0(b.feesPaid) - n0(a.feesPaid))[0];
      if (n0(most.feesPaid) >= CENT) {
        // Kosten worden ook bij het kopen betaald: zonder afgesloten trades geen "bij 0 trades"
        const closed = Math.round(n0(most.trades));
        points.push({
          key: "mostFees",
          text: `${nameOf(most)} betaalde de meeste kosten: ${fmt.eur(most.feesPaid)}${
            closed > 0 ? ` bij ${plural(closed, "afgesloten trade", "afgesloten trades")}` : ""
          }.`,
          tone: "flat",
        });
      }
    }
  }

  if (totalTrades === 0) {
    points.push({
      key: "open",
      text: `Er is nog geen trade afgesloten; het resultaat komt van ${plural(totalOpen, "open positie", "open posities")} en kan nog alle kanten op.`,
      tone: "flat",
    });
  } else if (totalTrades < FEW_TRADES) {
    points.push({
      key: "few",
      text: `Let op: met ${plural(totalTrades, "afgesloten trade", "afgesloten trades")} zegt dit nog weinig; geluk speelt nog een grote rol.`,
      tone: "flat",
    });
  }
  stoppedPoint();
  return { headline, points };
}

// ─────────────────────────────── Grafiek ───────────────────────────────

/** Keuzes voor de grafiek */
export const CHART_MODES = [
  { key: "pct", label: "Rendement %", tip: "Resultaat in procent van het budget van elke bot" },
  { key: "eur", label: "Resultaat €", tip: "Resultaat in euro (winst of verlies sinds de start)" },
];

/**
 * Lijnen voor de grafiek: één per bot, in de kleur van het profiel.
 * `equityHistory` = equity + afgeroomd (EUR, tijd in ms) → tijd in SECONDEN (per seconde
 * één punt, oplopend) en de waarde als resultaat t.o.v. het beginkapitaal:
 *  - "pct": (punt − begin) / startingEquity × 100 (eindigt bij totalReturnPct),
 *  - "eur": punt − begin (eindigt bij totalPnlQuote).
 * "Begin" = startingEquity; alleen na een verhoogde kapitaallimiet (live) is dat het
 * laatste punt − totalPnlQuote, zodat de storting geen nep-verlies wordt.
 * Met `nowMs` komt er een punt "nu" bij met de cijfers van de engine, zodat de lijn
 * precies eindigt bij wat de ranglijst toont.
 * @returns {{ id: string, name: string, short: string, color: string, data: { time: number, value: number }[], last: number | null }[]}
 */
export function chartSeries(bots, mode = "pct", nowMs = null) {
  const eur = mode === "eur";
  return list(bots).map((b, i) => {
    const bySec = new Map();
    for (const p of Array.isArray(b.equityHistory) ? b.equityHistory : []) {
      if (!p || !isNum(p.time) || !isNum(p.value)) continue;
      bySec.set(Math.floor(p.time / 1000), p.value);
    }
    const raw = [...bySec.entries()].sort((x, y) => x[0] - y[0]);
    const start = isNum(b.startingEquity) && b.startingEquity > 0 ? b.startingEquity : raw.length && raw[0][1] > 0 ? raw[0][1] : null;
    let base = start;
    const last = raw.length ? raw[raw.length - 1][1] : null;
    if (start && isNum(b.totalPnlQuote) && isNum(last)) {
      const derived = last - b.totalPnlQuote;
      if (derived > 0 && Math.abs(derived - start) > Math.max(0.01, start * 0.02)) base = derived;
    }
    const data = start ? raw.map(([time, v]) => ({ time, value: eur ? v - base : ((v - base) / start) * 100 })) : [];
    const nowVal = eur ? b.totalPnlQuote : b.totalReturnPct;
    if (isNum(nowMs) && isNum(nowVal)) {
      const t = Math.floor(nowMs / 1000);
      if (!data.length || t > data[data.length - 1].time) data.push({ time: t, value: nowVal });
    }
    return {
      id: b.id,
      name: nameOf(b),
      short: shortOf(b),
      color: safeColor(b.color, i),
      data,
      last: data.length ? data[data.length - 1].value : null,
    };
  });
}

/** Tekst van een waarde in de grafiek */
export function chartValueText(v, mode = "pct") {
  return mode === "eur" ? fmt.eurSigned(v) : fmt.pct(v);
}

/** true als geen enkele lijn minstens twee punten heeft */
export function chartIsEmpty(series) {
  return !(series || []).some((s) => s && Array.isArray(s.data) && s.data.length >= 2);
}

// ─────────────────────────────── Lege staten ───────────────────────────────

/**
 * Wat het tabblad toont.
 *  - "loading":     nog geen antwoord
 *  - "unsupported": 404 → deze server draait één bot (of een oudere versie)
 *  - "auth":        401 → token
 *  - "error":       andere fout, nog geen gegevens
 *  - "empty":       lege lijst
 *  - "single":      één bot (ranglijst van één, met uitleg)
 *  - "ok":          twee of meer bots (`stale` = de laatste verversing mislukte)
 * @param {object[] | null} bots
 * @param {{ status?: number, message?: string } | null} error
 */
export function boardState(bots, error = null) {
  const status = error && isNum(error.status) ? error.status : 0;
  const msg = error ? String(error.message || "onbekende fout") : "";
  if (status === 404) {
    return {
      kind: "unsupported",
      title: "De wedstrijd staat niet aan",
      text:
        "Dit programma draait nu één bot. Wil je bots tegen elkaar laten spelen? Zet in je .env-bestand " +
        "BOTS=scalper,trend,dip,allround en start het programma opnieuw.",
    };
  }
  if (Array.isArray(bots) && bots.length) {
    const stale = error ? `Verversen mislukt (${msg}); je ziet de laatste gegevens.` : "";
    if (bots.length === 1) {
      return {
        kind: "single",
        stale,
        text: "Er draait nu één bot. Voor een wedstrijd: zet BOTS=scalper,trend,dip,allround in je .env-bestand en start het programma opnieuw.",
      };
    }
    return { kind: "ok", stale, text: "" };
  }
  if (status === 401) {
    return { kind: "auth", title: "Geen toegang", text: "Het dashboard-token ontbreekt of klopt niet. Herlaad de pagina en vul het token in." };
  }
  if (error) {
    return { kind: "error", title: "Kon de bots niet ophalen", text: `${msg}. We proberen het elke ${POLL_MS / 1000} seconden opnieuw.` };
  }
  if (Array.isArray(bots)) return { kind: "empty", title: "Er draaien geen bots", text: "De server meldt geen enkele bot." };
  return { kind: "loading", title: "Bots laden…", text: "" };
}

// ─────────────────────────────── Alles starten / stoppen / noodstop ───────────────────────────────

/** Welke knoppen uit staan (true = uitgeschakeld) */
export function bulkDisabled(bots, busy = false) {
  const l = list(bots);
  const none = !l.length || busy;
  return {
    start: none || l.every((b) => b.running),
    stop: none || !l.some((b) => b.running),
    kill: none || !l.some((b) => b.running || n0(b.openPositions) > 0),
  };
}

/**
 * Tekst voor het bevestigingsvenster (platte tekst; het paneel escapet). `warn` = regel
 * die opvalt (echt geld, onbewaakte posities).
 * @param {"start" | "stop" | "kill"} action
 * @returns {{ title: string, lines: { text: string, warn: boolean }[], confirmText: string, danger: boolean }}
 */
export function bulkConfirm(action, bots) {
  const l = list(bots);
  const n = l.length;
  const open = l.reduce((s, b) => s + Math.max(0, Math.round(n0(b.openPositions))), 0);
  const armed = l.filter((b) => b.mode === "live" && b.liveArmed);
  const liveOff = l.filter((b) => b.mode === "live" && !b.liveArmed);
  const line = (text, warn = false) => ({ text, warn });
  if (action === "start") {
    const stopped = l.filter((b) => !b.running);
    const lines = [
      line(
        stopped.length === n
          ? n === 1
            ? `${nameOf(l[0])} gaat handelen.`
            : `Alle ${n} bots gaan handelen.`
          : `${listNames(stopped.map(nameOf))} ${stopped.length === 1 ? "gaat" : "gaan"} (weer) handelen; de andere bots draaien al.`,
      ),
    ];
    for (const b of armed) lines.push(line(`Let op: ${nameOf(b)} handelt met ECHT GELD.`, true));
    for (const b of liveOff) lines.push(line(`${nameOf(b)} staat in live modus zonder ingeschakelde live handel: die geeft alleen signalen.`));
    return { title: "Alle bots starten?", lines, confirmText: "Alles starten", danger: armed.length > 0 };
  }
  if (action === "stop") {
    const lines = [line("Alle bots stoppen met handelen.")];
    if (open) {
      lines.push(
        line(
          `Er ${open === 1 ? "staat" : "staan"} nog ${plural(open, "positie", "posities")} open. ${open === 1 ? "Die blijft" : "Die blijven"} staan en ${
            open === 1 ? "wordt" : "worden"
          } dan niet meer bewaakt (geen stop-loss, geen take-profit).`,
          true,
        ),
      );
      lines.push(line("Wil je alles verkopen? Gebruik dan Noodstop alle bots."));
    }
    return { title: "Alle bots stoppen?", lines, confirmText: "Alles stoppen", danger: false };
  }
  const lines = open
    ? [
        line(`Elke bot verkoopt direct al zijn posities tegen marktprijs (nu ${open} open) en stopt.`),
        line("Bij een snelle markt kan de verkoopprijs afwijken."),
      ]
    : [line("Er staan geen posities open. Alle bots worden direct gestopt.")];
  for (const b of armed) lines.push(line(`${nameOf(b)} handelt met echt geld: die posities worden echt verkocht op Bitvavo.`, true));
  return { title: "Noodstop alle bots", lines, confirmText: "Noodstop uitvoeren", danger: true };
}

const VERB = { start: "starten", stop: "stoppen", kill: "noodstop" };

/**
 * Meldingen na "Alles starten / stoppen / Noodstop": één samenvatting voor wat lukte en
 * één foutmelding per bot die mislukte (bij de noodstop ook per bot met posities die
 * NIET verkocht zijn, met markt en reden).
 * @param {"start" | "stop" | "kill"} action
 * @param {{ results?: { id: string, ok: boolean, error?: string, killResult?: { closed?: number, failed?: { market?: string, reason?: string }[] } }[] }} res
 * `failedIds` = de bots waar iets misging (voor een link naar hun dashboard).
 * @returns {{ toasts: [string, "info" | "success" | "warn" | "error"][], failed: boolean, failedIds: string[] }}
 */
export function bulkOutcome(action, res, bots) {
  const byId = new Map(list(bots).map((b) => [b.id, b]));
  const who = (id) => (byId.has(id) ? shortOf(byId.get(id)) : String(id));
  const results = res && Array.isArray(res.results) ? res.results.filter((r) => r && typeof r.id === "string") : null;
  if (!results) return { toasts: [["Onverwacht antwoord van de server; kijk bij elke bot of het gelukt is.", "warn"]], failed: true, failedIds: [] };
  if (!results.length) return { toasts: [["Er zijn geen bots om te bedienen.", "warn"]], failed: false, failedIds: [] };
  const failedOf = (r) => (r.killResult && Array.isArray(r.killResult.failed) ? r.killResult.failed.filter(Boolean) : []);
  // Noodstop met posities die niet verkocht konden worden: de server geeft dan ok:false
  // (met error "Niet alles verkocht: …") én killResult.failed. De bot IS gestopt; alleen
  // die posities staan nog open → een eigen melding met markt en reden, niet "mislukt".
  const partial = action === "kill" ? results.filter((r) => failedOf(r).length) : [];
  const ok = results.filter((r) => r.ok && !partial.includes(r));
  const bad = results.filter((r) => !r.ok && !partial.includes(r));
  const toasts = [];
  if (ok.length) {
    const all = ok.length === results.length;
    const names = listNames(ok.map((r) => who(r.id)));
    // "Alle 4 bots" of, bij één bot, zijn naam
    const allOf = (cap) => (results.length === 1 ? who(results[0].id) : `${cap ? "Alle" : "alle"} ${results.length} bots`);
    if (action === "start") toasts.push([all ? `${allOf(true)} gestart` : `Gestart: ${names}`, "success"]);
    else if (action === "stop") {
      const open = ok.reduce((s, r) => s + Math.max(0, n0(byId.get(r.id) && byId.get(r.id).openPositions)), 0);
      toasts.push([`${all ? `${allOf(true)} gestopt` : `Gestopt: ${names}`}${open ? " — open posities blijven staan (niet bewaakt)" : ""}`, open ? "warn" : "info"]);
    } else {
      const closed = ok.reduce((s, r) => s + Math.max(0, n0(r.killResult && r.killResult.closed)), 0);
      const what = closed ? "alles verkocht" : "er stonden geen posities open";
      toasts.push([all ? `Noodstop: ${allOf(false)} gestopt, ${what}` : `Noodstop gelukt bij ${names} (${what})`, closed ? "warn" : "info"]);
    }
  }
  for (const r of partial) {
    const f = failedOf(r);
    toasts.push([
      `${who(r.id)}: gestopt, maar ${plural(f.length, "positie", "posities")} NIET verkocht — ${f
        .map((x) => `${x.market || "?"}: ${x.reason || "reden onbekend"}`)
        .join("; ")}. Die ${f.length === 1 ? "positie wordt" : "posities worden"} niet bewaakt: controleer ze in het dashboard van deze bot.`,
      "error",
    ]);
  }
  for (const r of bad) toasts.push([`${who(r.id)}: ${VERB[action] || action} mislukt — ${r.error || "onbekende fout"}`, "error"]);
  const failedIds = [...partial, ...bad].map((r) => r.id);
  return { toasts, failed: failedIds.length > 0, failedIds };
}
