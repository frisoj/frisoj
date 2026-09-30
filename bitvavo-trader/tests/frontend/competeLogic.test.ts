/**
 * Tabblad Wedstrijd (v3): de pure hulpjes in public/js/panels/competeLogic.js —
 * ranglijst (ook gelijke stand), opmaak per bot, de analyse in gewoon Nederlands,
 * de lijnen voor de grafiek, lege staten en de teksten rond de bulkknoppen.
 */
import { describe, expect, it } from "vitest";
import { loadPublic, type Fake } from "./helpers";

/** Intl zet een harde spatie tussen € en het bedrag */
const norm = (s: string) => s.replace(/\s+/g, " ");

const P: Record<string, { name: string; short: string; color: string; interval: string }> = {
  scalper: { name: "Snelle scalper", short: "Scalper", color: "#e0a23a", interval: "5m" },
  trend: { name: "Trendvolger", short: "Trend", color: "#3987e5", interval: "1h" },
  dip: { name: "Dip-koper", short: "Dip", color: "#9b6ddf", interval: "15m" },
  allround: { name: "Allrounder", short: "Allround", color: "#2fb67c", interval: "15m" },
};

/** BotSummary met `pnl` (na kosten) en `fees` op een budget van € 25 */
function bot(id: string, pnl = 0, fees = 0, trades = 0, over: Fake = {}): Fake {
  const start = over.startingEquity ?? 25;
  const wins = over.wins ?? Math.round(trades / 2);
  return {
    id,
    ...P[id],
    description: `Uitleg van ${id}`,
    path: `/bot/${id}/`,
    mode: "paper",
    running: true,
    liveArmed: false,
    startedAt: 1,
    startingEquity: start,
    equity: start + pnl,
    totalPnlQuote: pnl,
    totalReturnPct: (pnl / start) * 100,
    dayPnlQuote: 0,
    dayReturnPct: 0,
    feesPaid: fees,
    grossPnlQuote: pnl + fees,
    trades,
    wins,
    losses: trades - wins,
    winRatePct: trades ? (wins / trades) * 100 : 0,
    avgWinPct: 0,
    avgLossPct: 0,
    profitFactor: 0,
    maxDrawdownPct: 0,
    tradesToday: 0,
    openPositions: 0,
    activeMarkets: 30,
    halted: { halted: false },
    bestMarket: null,
    worstMarket: null,
    equityHistory: [],
    ...over,
  };
}

const L = () => loadPublic("js/panels/competeLogic.js");

describe("ranglijst", () => {
  it("hoogste totaal rendement eerst, plaatsen 1..n", async () => {
    const { rankBots } = await L();
    const r = rankBots([bot("scalper", -0.5), bot("trend", 0.8), bot("dip", 0.1), bot("allround", -0.1)]);
    expect(r.map((b: Fake) => b.id)).toEqual(["trend", "dip", "allround", "scalper"]);
    expect(r.map((b: Fake) => b.rank)).toEqual([1, 2, 3, 4]);
    expect(r.every((b: Fake) => b.tied === false)).toBe(true);
  });

  it("gelijk rendement (zoals getoond, op 0,01%) = gedeelde plaats (1, 1, 3, 4); daarbinnen hoger € eerst", async () => {
    const { rankBots } = await L();
    // trend en dip allebei +2,00% (dip met een groter budget → meer euro); 0,123 en 0,121 tonen allebei 0,12%
    const r = rankBots([
      bot("scalper", 0.0308, 0, 1), // 0,1232% → 0,12%
      bot("trend", 0.5, 0, 1), // 2,00%
      bot("dip", 1, 0, 1, { startingEquity: 50 }), // 2,00%, maar € 1
      bot("allround", 0.03025, 0, 1), // 0,121% → 0,12%
    ]);
    expect(r.map((b: Fake) => [b.id, b.rank, b.tied])).toEqual([
      ["dip", 1, true],
      ["trend", 1, true],
      ["scalper", 3, true],
      ["allround", 3, true],
    ]);
  });

  it("zelfde rendement en zelfde bedrag: volgorde van de server; onbekend rendement achteraan", async () => {
    const { rankBots } = await L();
    const r = rankBots([bot("scalper"), bot("trend", 0, 0, 0, { totalReturnPct: NaN }), bot("dip"), bot("allround", 0.25)]);
    expect(r.map((b: Fake) => `${b.id}:${b.rank}`)).toEqual(["allround:1", "scalper:2", "dip:2", "trend:4"]);
  });

  it("medailles: goud, zilver, brons, daarna een nummer; neutraal zolang er niet gehandeld is", async () => {
    const { medal, raceStarted } = await L();
    expect([1, 2, 3, 4].map((r) => medal(r).cls)).toEqual(["gold", "silver", "bronze", "plain"]);
    expect(medal(1, true).label).toBe("1e plaats (gedeeld)");
    expect(medal(3).text).toBe("3");
    expect(medal(1, true, false)).toMatchObject({ cls: "plain", text: "–" });
    expect(raceStarted([bot("scalper"), bot("trend")])).toBe(false);
    expect(raceStarted([bot("scalper"), bot("trend", 0, 0, 0, { openPositions: 1 })])).toBe(true);
    expect(raceStarted([bot("scalper", 0.01, 0.01, 1)])).toBe(true);
  });
});

describe("opmaak per bot", () => {
  it("kaart: resultaat, vóór kosten, kosten, winrate W/V, trades vandaag/totaal, max. daling, vandaag, link", async () => {
    const { cardView, rankBots } = await L();
    const b = bot("trend", 0.81, 0.18, 6, {
      wins: 4,
      tradesToday: 1,
      maxDrawdownPct: -1.2,
      dayPnlQuote: 0.35,
      dayReturnPct: 1.4,
      openPositions: 2,
    });
    const v = cardView(rankBots([b])[0], "trend");
    expect(norm(v.resultEur)).toBe("+€ 0,81");
    expect(v.resultPct).toBe("+3,24%");
    expect(v.resultCls).toBe("pos");
    expect(norm(v.grossEur)).toBe("+€ 0,99");
    expect(norm(v.fees)).toBe("€ 0,18");
    expect(v.winRate).toBe("67%");
    expect(v.winLoss).toBe("4W / 2V");
    expect([v.tradesToday, v.tradesTotal]).toEqual(["1", "6"]);
    expect(v.maxDd).toBe("-1,20%");
    expect(v.ddCls).toBe("neg");
    expect(norm(v.dayEur)).toBe("+€ 0,35");
    expect(v.dayPct).toBe("+1,40%");
    expect(v.href).toBe("/bot/trend/#live");
    expect(v.current).toBe(true);
    expect(v.medal.cls).toBe("gold");
    expect(v.meta.map(norm)).toEqual(["elk uur", "budget € 25,00", "2 posities open"]);
    expect(v.paceTip).toBe("Beslist na elke candle van 1 uur");
    expect(v.color).toBe("#3987e5");
  });

  it("zonder trades: winrate '–', 'nog geen trades', geen daling", async () => {
    const { cardView } = await L();
    const v = cardView({ ...bot("dip"), rank: 1 }, "trend");
    expect(v.winRate).toBe("–");
    expect(v.winLoss).toBe("nog geen trades");
    expect(v.maxDd).toBe("0,00%");
    expect(v.ddCls).toBe("flat");
    expect(v.current).toBe(false);
    expect(v.cost.kind).toBe("none");
  });

  it("status: actief, gestopt, gepauzeerd met reden, winst vastgezet; live-badge", async () => {
    const { statusView, liveBadge } = await L();
    expect(statusView(bot("dip")).label).toBe("Actief");
    expect(statusView(bot("dip", 0, 0, 0, { running: false }))).toMatchObject({ key: "stopped", label: "Gestopt", reason: "" });
    const halted = statusView(bot("dip", 0, 0, 0, { halted: { halted: true, dailyLimit: true, reason: "Dagelijkse verlieslimiet bereikt" } }));
    expect(halted).toMatchObject({ key: "halted", label: "Gepauzeerd", reason: "Dagelijkse verlieslimiet bereikt" });
    const target = statusView(bot("dip", 0, 0, 0, { halted: { halted: true, dailyTarget: true, reason: "Dagdoel gehaald" } }));
    expect(target).toMatchObject({ key: "target", label: "Winst vastgezet", cls: "badge-green" });
    // gestopt, maar de verlieslimiet geldt nog: reden blijft zichtbaar
    expect(statusView(bot("dip", 0, 0, 0, { running: false, halted: { halted: true, reason: "Limiet" } })).reason).toBe("Limiet");
    expect(liveBadge(bot("dip"))).toBeNull();
    expect(liveBadge(bot("dip", 0, 0, 0, { mode: "live", liveArmed: true })).text).toBe("Echt geld");
    expect(liveBadge(bot("dip", 0, 0, 0, { mode: "live", liveArmed: false })).text).toBe("Live · uit");
  });

  it("kostenbalk: houdt over / kosten eten winst op / ook vóór kosten verlies", async () => {
    const { costView } = await L();
    const keeps = costView(bot("dip", 0.3, 0.1, 5)); // vóór kosten 0,40, kosten 0,10
    expect(keeps.kind).toBe("keeps");
    expect(keeps.feePct).toBeCloseTo(25, 9);
    expect(keeps.keptPct).toBeCloseTo(75, 9);
    expect(keeps.text).toBe("25% van de winst vóór kosten ging naar kosten");
    expect(costView(bot("dip", -0.1, 0.3, 5)).kind).toBe("eaten");
    expect(costView(bot("dip", -0.5, 0.3, 5)).kind).toBe("loss");
  });

  it("tempo, interval en opsomming in gewone taal", async () => {
    const { paceLabel, intervalLabel, listNames } = await L();
    expect(["1m", "5m", "15m", "1h", "4h", "1d"].map(paceLabel)).toEqual([
      "elke 1 min",
      "elke 5 min",
      "elke 15 min",
      "elk uur",
      "elke 4 uur",
      "elke dag",
    ]);
    expect(intervalLabel("15m")).toBe("15 min");
    expect(intervalLabel("1h")).toBe("1 uur");
    expect(listNames(["A"])).toBe("A");
    expect(listNames(["A", "B"])).toBe("A en B");
    expect(listNames(["A", "B", "C"])).toBe("A, B en C");
  });

  it("regel onder de titel: aantal, oefengeld / echt geld, actief, tijd", async () => {
    const { subtitle } = await L();
    const bots = [bot("scalper"), bot("trend", 0, 0, 0, { running: false }), bot("dip"), bot("allround")];
    expect(subtitle(bots)).toBe("4 bots · oefengeld · 3 actief");
    expect(subtitle([bot("scalper"), bot("trend", 0, 0, 0, { mode: "live", liveArmed: true })])).toBe(
      "2 bots · Trend met echt geld · allemaal actief",
    );
    expect(subtitle(bots, Date.UTC(2026, 8, 30, 12, 0, 5))).toMatch(/^4 bots · oefengeld · 3 actief · bijgewerkt \d\d:\d\d:\d\d$/);
    expect(subtitle([])).toBe("");
    // niemand actief: geen "0 actief"
    expect(subtitle([bot("scalper", 0, 0, 0, { running: false }), bot("trend", 0, 0, 0, { running: false })])).toBe(
      "2 bots · oefengeld · allemaal gestopt",
    );
    expect(subtitle([bot("dip", 0, 0, 0, { running: false })])).toBe("1 bot · oefengeld · gestopt");
  });
});

describe("analyse in gewoon Nederlands", () => {
  const texts = (a: Fake) => a.points.map((p: Fake) => norm(p.text));

  it("nog geen trades: de wedstrijd is net begonnen; stilstaande bots genoemd", async () => {
    const { analysis } = await L();
    const a = analysis([bot("scalper"), bot("trend", 0, 0, 0, { running: false }), bot("dip"), bot("allround")]);
    expect(a.headline).toEqual({ text: "Nog geen trades: de wedstrijd is net begonnen.", tone: "flat" });
    expect(texts(a)).toContain("Zodra de bots gaan handelen, zie je hier wie voorligt en of de winst opweegt tegen de kosten.");
    expect(texts(a)).toContain("Trendvolger staat stil en doet nu niet mee.");
    // alles stil
    const still = analysis([bot("scalper", 0, 0, 0, { running: false }), bot("trend", 0, 0, 0, { running: false })]);
    expect(texts(still)).toContain("Alle bots staan stil. Druk op Alles starten om de wedstrijd (weer) te beginnen.");
  });

  it("wie ligt voor (met nummer twee); kostenregels; aandeel kosten; weinig trades", async () => {
    const { analysis } = await L();
    const a = analysis([
      bot("scalper", -0.46, 1.21, 38), // vóór kosten +0,75 → kosten eten winst op
      bot("trend", 0.81, 0.18, 6), // verdient meer dan zijn kosten
      bot("dip", 0.12, 0.3, 11), // verdient meer dan zijn kosten
      bot("allround", -0.15, 0.42, 14), // vóór kosten +0,27 → kosten eten winst op
    ]);
    expect(norm(a.headline.text)).toBe("Trendvolger ligt voor met +3,24% (+€ 0,81). Daarna volgt Dip-koper met +0,48%.");
    expect(a.headline.tone).toBe("pos");
    const t = texts(a);
    expect(t).toContain("Trendvolger en Dip-koper verdienen meer dan hun kosten.");
    expect(t).toContain("Snelle scalper en Allrounder maken vóór kosten wel winst, maar de kosten eten die op.");
    // samen: vóór kosten 2,43, kosten 2,11 → 87%
    expect(t).toContain("Alle bots samen: € 2,43 winst vóór kosten, waarvan € 2,11 (87%) naar kosten ging. Dat is meer dan de helft.");
    expect(t).toContain("Snelle scalper betaalde de meeste kosten: € 1,21 bij 38 afgesloten trades.");
    expect(t.some((x: string) => x.startsWith("Let op:"))).toBe(false); // 69 trades: genoeg
  });

  it("alle bots verliezen: wie verliest het minst; geen enkele bot verdient meer dan zijn kosten", async () => {
    const { analysis } = await L();
    const a = analysis([bot("scalper", -1.9, 1.5, 12), bot("trend", -0.2, 0.1, 3), bot("dip", -0.7, 0.4, 2)]);
    expect(norm(a.headline.text)).toBe("Alle bots staan in de min. Trendvolger verliest het minst: -0,80% (-€ 0,20).");
    expect(a.headline.tone).toBe("neg");
    const t = texts(a);
    expect(t).toContain("Geen enkele bot verdient nu meer dan zijn kosten.");
    // samen vóór kosten: -0,4 + -0,1 + -0,3 = -0,80
    expect(t).toContain("Alle bots samen: vóór kosten al € 0,80 verlies; de kosten (€ 2,00) maken het verlies groter.");
    expect(t).toContain("Let op: met 17 afgesloten trades zegt dit nog weinig; geluk speelt nog een grote rol.");
  });

  it("één bot verdient meer dan zijn kosten; kosten groter dan de winst vóór kosten", async () => {
    const { analysis } = await L();
    const a = analysis([bot("scalper", -1, 1.3, 30), bot("trend", 0.2, 0.1, 4), bot("dip", -0.4, 0.2, 6)]);
    const t = texts(a);
    expect(t).toContain("Alleen Trendvolger verdient meer dan zijn kosten.");
    expect(t).toContain("Snelle scalper maakt vóór kosten wel winst, maar de kosten eten die op.");
    // samen vóór kosten: 0,3 + 0,3 − 0,2 = 0,40 winst, kosten 1,60
    expect(t).toContain("Alle bots samen: € 0,40 winst vóór kosten, maar € 1,60 aan kosten: de kosten zijn groter dan de winst.");
  });

  it("alle bots verdienen meer dan hun kosten; weinig kosten zonder 'meer dan de helft'", async () => {
    const { analysis } = await L();
    const a = analysis([bot("trend", 1.5, 0.1, 10), bot("dip", 0.5, 0.1, 10)]);
    const t = texts(a);
    expect(t).toContain("Alle bots verdienen meer dan hun kosten.");
    expect(t).toContain("Alle bots samen: € 2,20 winst vóór kosten, waarvan € 0,20 (9%) naar kosten ging.");
  });

  it("gelijke stand bovenaan en helemaal gelijk", async () => {
    const { analysis } = await L();
    const tie = analysis([bot("trend", 0.25, 0.05, 2), bot("dip", 0.25, 0.05, 2), bot("allround", -0.1, 0.05, 2)]);
    expect(tie.headline.text).toBe("Trendvolger en Dip-koper staan samen bovenaan met +1,00%.");
    const all = analysis([bot("trend", 0, 0.05, 1), bot("dip", 0, 0.05, 1)]);
    expect(all.headline.text).toBe("Alle bots staan gelijk: 0,00%.");
    const zero = analysis([bot("trend", 0, 0, 1), bot("dip", -0.1, 0.05, 1)]);
    expect(zero.headline.text).toBe("Trendvolger staat bovenaan, maar zonder winst (0,00%).");
  });

  it("alleen open posities: resultaat kan nog alle kanten op", async () => {
    const { analysis } = await L();
    const a = analysis([bot("trend", 0.1, 0.02, 0, { openPositions: 2 }), bot("dip")]);
    expect(norm(a.headline.text)).toBe("Trendvolger ligt voor met +0,40% (+€ 0,10). Daarna volgt Dip-koper met 0,00%.");
    expect(texts(a)).toContain("Er is nog geen trade afgesloten; het resultaat komt van 2 open posities en kan nog alle kanten op.");
  });

  it("één bot: eigen zinnen (geen 'alle bots')", async () => {
    const { analysis } = await L();
    const a = analysis([bot("allround", -0.15, 0.42, 14)]);
    expect(norm(a.headline.text)).toBe("Allrounder staat op -0,60% (-€ 0,15).");
    const t = texts(a);
    expect(t).toContain("Allrounder maakt vóór kosten winst, maar de kosten eten die op.");
    expect(t).toContain("€ 0,27 winst vóór kosten, maar € 0,42 aan kosten: de kosten zijn groter dan de winst.");
    expect(t.some((x: string) => x.includes("meeste kosten"))).toBe(false);
    // ook vóór kosten verlies: de zin begint met een hoofdletter (geen "Alle bots samen:" ervoor)
    const loss = texts(analysis([bot("allround", -0.21, 0.11, 0, { openPositions: 2 })]));
    expect(loss).toContain("Vóór kosten al € 0,10 verlies; de kosten (€ 0,11) maken het verlies groter.");
    const zero = texts(analysis([bot("allround", -0.11, 0.11, 3)]));
    expect(zero).toContain("Vóór kosten stond het resultaat op nul; het verlies komt helemaal door de kosten (€ 0,11).");
  });

  it("één bot: geen gouden medaille (geen wedstrijd zonder tegenstanders)", async () => {
    const { cardView, medal } = await L();
    expect(medal(1, false, true, true)).toEqual({ cls: "plain", text: "1", label: "Er draait maar één bot" });
    const v = cardView({ ...bot("allround", 1, 0.1, 2), rank: 1, tied: false }, "allround", true, true);
    expect(v.medal.cls).toBe("plain");
    expect(cardView({ ...bot("allround", 1, 0.1, 2), rank: 1, tied: false }, "allround", true).medal.cls).toBe("gold");
  });
});

describe("grafiek", () => {
  const T = Date.UTC(2026, 8, 30, 10, 0, 0);

  it("tijd in seconden (per seconde één punt, oplopend), rendement t.o.v. het budget, profielkleur", async () => {
    const { chartSeries } = await L();
    const b = bot("trend", 0.5, 0.1, 2, {
      equityHistory: [
        { time: T + 120_000, value: 25.5 },
        { time: T, value: 25 },
        { time: T + 60_000, value: 24.5 },
        { time: T + 60_400, value: 24.75 }, // zelfde seconde: laatste telt
        { time: T + 90_000, value: Number.NaN },
      ],
    });
    const [s] = chartSeries([b], "pct");
    expect(s.data.map((d: Fake) => d.time)).toEqual([T / 1000, T / 1000 + 60, T / 1000 + 120]);
    expect(s.data.map((d: Fake) => Number(d.value.toFixed(6)))).toEqual([0, -1, 2]);
    expect(s).toMatchObject({ id: "trend", short: "Trend", name: "Trendvolger", color: "#3987e5", last: 2 });
  });

  it("€: resultaat sinds de start; 'nu'-punt met de cijfers van de engine", async () => {
    const { chartSeries } = await L();
    const b = bot("dip", 0.6, 0.1, 2, { equityHistory: [{ time: T, value: 25 }, { time: T + 60_000, value: 25.4 }] });
    const [eur] = chartSeries([b], "eur", T + 180_500);
    expect(eur.data.map((d: Fake) => [d.time, Number(d.value.toFixed(6))])).toEqual([
      [T / 1000, 0],
      [T / 1000 + 60, 0.4],
      [T / 1000 + 180, 0.6],
    ]);
    const [pct] = chartSeries([b], "pct", T + 180_500);
    expect(pct.last).toBeCloseTo(2.4, 9); // totalReturnPct
    // "nu" niet ná het laatste punt → niet toevoegen
    expect(chartSeries([b], "eur", T + 30_000)[0].data).toHaveLength(2);
  });

  it("verhoogde kapitaallimiet: de storting is geen verlies (begin = laatste punt − resultaat)", async () => {
    const { chartSeries } = await L();
    // €50 begonnen, +€3,25 winst, limiet naar €100: startingEquity 100, curve (equity + afgeroomd) blijft rond 53
    const b = bot("trend", 3.25, 0.2, 4, {
      startingEquity: 100,
      equityHistory: [
        { time: T, value: 50 },
        { time: T + 60_000, value: 53.25 },
      ],
    });
    const [s] = chartSeries([b], "pct");
    expect(s.data.map((d: Fake) => Number(d.value.toFixed(4)))).toEqual([0, 3.25]);
  });

  it("ongeldige kleur → reservekleur; geen geschiedenis en geen budget → geen punten; leeg-check", async () => {
    const { chartSeries, chartIsEmpty } = await L();
    const ser = chartSeries([bot("dip", 0, 0, 0, { color: "red; background:url(x)", startingEquity: 0, totalReturnPct: NaN })]);
    expect(ser[0].color).toMatch(/^#[0-9a-f]{6}$/);
    expect(ser[0].data).toEqual([]);
    expect(chartIsEmpty(ser)).toBe(true);
    expect(chartIsEmpty([{ data: [{ time: 1, value: 0 }, { time: 2, value: 1 }] }])).toBe(false);
  });

  it("waarde-tekst per keuze", async () => {
    const { chartValueText, CHART_MODES } = await L();
    expect(chartValueText(1.5, "pct")).toBe("+1,50%");
    expect(norm(chartValueText(-0.25, "eur"))).toBe("-€ 0,25");
    expect(CHART_MODES.map((m: Fake) => m.key)).toEqual(["pct", "eur"]);
  });
});

describe("lege staten", () => {
  it("404 → de wedstrijd staat niet aan (met uitleg over BOTS)", async () => {
    const { boardState } = await L();
    const s = boardState(null, { status: 404, message: "Niet gevonden" });
    expect(s.kind).toBe("unsupported");
    expect(s.text).toContain("BOTS=scalper,trend,dip,allround");
  });

  it("laden, fout, token, leeg, één bot en verouderde gegevens", async () => {
    const { boardState } = await L();
    expect(boardState(null, null).kind).toBe("loading");
    const err = boardState(null, { status: 500, message: "Serverfout" });
    expect(err.kind).toBe("error");
    expect(err.text).toBe("Serverfout. We proberen het elke 10 seconden opnieuw.");
    expect(boardState(null, { status: 401, message: "x" }).kind).toBe("auth");
    expect(boardState([], null).kind).toBe("empty");
    expect(boardState([bot("dip")], null)).toMatchObject({ kind: "single", stale: "" });
    const stale = boardState([bot("dip"), bot("trend")], { status: 0, message: "Failed to fetch" });
    expect(stale.kind).toBe("ok");
    expect(stale.stale).toBe("Verversen mislukt (Failed to fetch); je ziet de laatste gegevens.");
  });
});

describe("Alles starten / stoppen / noodstop", () => {
  it("welke knoppen uit staan", async () => {
    const { bulkDisabled } = await L();
    const running = [bot("dip"), bot("trend")];
    expect(bulkDisabled(running)).toEqual({ start: true, stop: false, kill: false });
    const stopped = [bot("dip", 0, 0, 0, { running: false }), bot("trend", 0, 0, 0, { running: false })];
    expect(bulkDisabled(stopped)).toEqual({ start: false, stop: true, kill: true });
    // gestopt maar met een open positie: noodstop kan nog verkopen
    expect(bulkDisabled([bot("dip", 0, 0, 0, { running: false, openPositions: 1 })]).kill).toBe(false);
    expect(bulkDisabled(running, true)).toEqual({ start: true, stop: true, kill: true });
    expect(bulkDisabled(null)).toEqual({ start: true, stop: true, kill: true });
  });

  it("bevestiging: starten met een live bot is 'danger'; stoppen waarschuwt voor open posities; noodstop", async () => {
    const { bulkConfirm } = await L();
    const bots = [
      bot("scalper", 0, 0, 0, { running: false }),
      bot("trend", 0, 0, 0, { mode: "live", liveArmed: true, openPositions: 2 }),
      bot("dip", 0, 0, 0, { running: false, openPositions: 1 }),
    ];
    const start = bulkConfirm("start", bots);
    expect(start.title).toBe("Alle bots starten?");
    expect(start.danger).toBe(true);
    expect(start.lines).toEqual([
      { text: "Snelle scalper en Dip-koper gaan (weer) handelen; de andere bots draaien al.", warn: false },
      { text: "Let op: Trendvolger handelt met ECHT GELD.", warn: true },
    ]);
    const stop = bulkConfirm("stop", bots);
    expect(stop.danger).toBe(false);
    expect(stop.lines.map((l: Fake) => l.text)).toEqual([
      "Alle bots stoppen met handelen.",
      "Er staan nog 3 posities open. Die blijven staan en worden dan niet meer bewaakt (geen stop-loss, geen take-profit).",
      "Wil je alles verkopen? Gebruik dan Noodstop alle bots.",
    ]);
    const kill = bulkConfirm("kill", bots);
    expect(kill).toMatchObject({ title: "Noodstop alle bots", confirmText: "Noodstop uitvoeren", danger: true });
    expect(kill.lines[0].text).toBe("Elke bot verkoopt direct al zijn posities tegen marktprijs (nu 3 open) en stopt.");
    expect(kill.lines.some((l: Fake) => l.warn && l.text.includes("Trendvolger handelt met echt geld"))).toBe(true);
    expect(bulkConfirm("kill", [bot("dip")]).lines.map((l: Fake) => l.text)).toEqual([
      "Er staan geen posities open. Alle bots worden direct gestopt.",
    ]);
    expect(bulkConfirm("start", [bot("dip", 0, 0, 0, { running: false })]).lines[0].text).toBe("Dip-koper gaat handelen.");
    expect(bulkConfirm("start", [bot("dip", 0, 0, 0, { running: false }), bot("trend", 0, 0, 0, { running: false })]).lines[0].text).toBe(
      "Alle 2 bots gaan handelen.",
    );
  });

  it("meldingen: alles gelukt = één melding; per mislukte bot een foutmelding", async () => {
    const { bulkOutcome } = await L();
    const bots = [bot("scalper"), bot("trend"), bot("dip"), bot("allround")];
    const all = bulkOutcome("start", { results: bots.map((b) => ({ id: b.id, ok: true })) }, bots);
    expect(all).toEqual({ toasts: [["Alle 4 bots gestart", "success"]], failed: false, failedIds: [] });
    const some = bulkOutcome(
      "start",
      {
        results: [
          { id: "scalper", ok: true },
          { id: "trend", ok: true },
          { id: "dip", ok: false, error: "Dagelijkse verlieslimiet" },
          { id: "allround", ok: true },
        ],
      },
      bots,
    );
    expect(some.failed).toBe(true);
    expect(some.toasts).toEqual([
      ["Gestart: Scalper, Trend en Allround", "success"],
      ["Dip: starten mislukt — Dagelijkse verlieslimiet", "error"],
    ]);
  });

  it("stoppen met open posities: waarschuwing dat ze blijven staan", async () => {
    const { bulkOutcome } = await L();
    const bots = [bot("scalper", 0, 0, 0, { openPositions: 1 }), bot("trend")];
    const out = bulkOutcome("stop", { results: [{ id: "scalper", ok: true }, { id: "trend", ok: true }] }, bots);
    expect(out.toasts).toEqual([["Alle 2 bots gestopt — open posities blijven staan (niet bewaakt)", "warn"]]);
  });

  it("noodstop: posities die NIET verkocht zijn per bot, met markt en reden", async () => {
    const { bulkOutcome } = await L();
    const bots = [bot("scalper"), bot("trend"), bot("dip")];
    const out = bulkOutcome(
      "kill",
      {
        results: [
          // zoals de server het stuurt: ok:false + error + killResult.failed (de bot is wel gestopt)
          {
            id: "scalper",
            ok: false,
            error: "Niet alles verkocht: PEPE-EUR (onder het minimum van € 5)",
            killResult: { closed: 1, failed: [{ id: "p1", market: "PEPE-EUR", reason: "onder het minimum van € 5" }] },
          },
          { id: "trend", ok: true, killResult: { closed: 2, failed: [] } },
          { id: "dip", ok: false, error: "Time-out" },
        ],
      },
      bots,
    );
    expect(out.failed).toBe(true);
    const msgs = out.toasts.map(([m, k]: [string, string]) => `${k}: ${norm(m)}`);
    expect(msgs[0]).toBe("warn: Noodstop gelukt bij Trend (alles verkocht)");
    expect(msgs[1]).toContain("error: Scalper: gestopt, maar 1 positie NIET verkocht — PEPE-EUR: onder het minimum van € 5.");
    expect(msgs[2]).toBe("error: Dip: noodstop mislukt — Time-out");
    expect(msgs).toHaveLength(3);
    expect(out.failedIds).toEqual(["scalper", "dip"]);
    // de bot met onverkochte posities is gestopt: geen "noodstop mislukt" voor Scalper
    expect(msgs.some((m: string) => m.includes("Scalper: noodstop mislukt"))).toBe(false);
    const none = bulkOutcome("kill", { results: [{ id: "trend", ok: true, killResult: { closed: 0, failed: [] } }] }, bots);
    expect(none.toasts).toEqual([["Noodstop: Trend gestopt, er stonden geen posities open", "info"]]);
    // oudere vorm (ok:true met failed): net zo
    const old = bulkOutcome(
      "kill",
      { results: [{ id: "dip", ok: true, killResult: { closed: 0, failed: [{ id: "p", market: "EPIC-EUR", reason: "geen koper" }] } }] },
      bots,
    );
    expect(old.failed).toBe(true);
    expect(old.toasts).toHaveLength(1);
    expect(norm(old.toasts[0][0])).toContain("Dip: gestopt, maar 1 positie NIET verkocht — EPIC-EUR: geen koper.");
  });

  it("meeste kosten zonder afgesloten trades: geen 'bij 0 trades' (kosten worden ook bij het kopen betaald)", async () => {
    const { analysis } = await L();
    const texts = (a: Fake) => a.points.map((p: Fake) => norm(p.text));
    const a = analysis([
      bot("scalper", 0, 0, 0),
      bot("trend", -0.05, 0.05, 0, { openPositions: 2 }),
      bot("allround", -0.07, 0.06, 0, { openPositions: 2 }),
    ]);
    const t = texts(a);
    expect(t).toContain("Allrounder betaalde de meeste kosten: € 0,06.");
    expect(t.some((x: string) => x.includes("bij 0"))).toBe(false);
  });

  it("onverwacht antwoord of een onbekende bot-id", async () => {
    const { bulkOutcome } = await L();
    expect(bulkOutcome("start", null, []).failed).toBe(true);
    expect(bulkOutcome("stop", { results: [{ id: "nieuw", ok: false, error: "x" }] }, []).toasts).toEqual([
      ["nieuw: stoppen mislukt — x", "error"],
    ]);
  });
});
