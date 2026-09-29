// Pure logica van het Instellingen-paneel (geen DOM), zodat ze los te testen is
// (tests/frontend/settingsLogic.test.ts): velddefinities, validatie, de PUT-patch
// en het samenvoegen van een concept met instellingen die elders zijn gewijzigd.

// Alle RiskConfig-velden met Nederlandse uitleg. scale = weergavefactor (fractie → %).
export const RISK_GROUPS = [
  {
    title: "Positiegrootte",
    fields: [
      { key: "riskPerTradePct", label: "Risico per trade", unit: "%", step: 0.1, min: 0.1, max: 10,
        help: "Hoeveel % van je saldo je maximaal verliest als de stop-loss geraakt wordt. 1–2% is gebruikelijk." },
      { key: "maxPositionPct", label: "Max. positiegrootte", unit: "%", step: 5, min: 1, max: 100,
        help: "Maximaal deel van je saldo in één positie." },
      { key: "maxOpenPositions", label: "Max. open posities", unit: "stuks", step: 1, min: 1, max: 10, int: true,
        help: "Hoeveel posities er tegelijk open mogen staan. Met €50 zijn 1–2 posities realistisch (min. order €5)." },
      { key: "maxTotalExposurePct", label: "Max. totale blootstelling", unit: "%", step: 5, min: 1, max: 100,
        help: "Maximaal deel van je saldo dat in alle posities samen zit; de rest blijft in euro's." },
      { key: "minOrderQuote", label: "Minimale ordergrootte", unit: "€", step: 1, min: 0, max: 100000,
        help: "Bitvavo accepteert geen orders onder €5. Kleinere orders slaat de bot over." },
    ],
  },
  {
    title: "Stop-loss & winst nemen",
    fields: [
      { key: "stopAtrMult", label: "Stop-loss afstand", unit: "× ATR", step: 0.1, min: 0.5, max: 10,
        help: "De stop ligt zoveel keer de gemiddelde candle-beweging (ATR) onder je instap. Groter = meer ademruimte, maar groter verlies per keer." },
      { key: "takeProfitR", label: "Winstdoel", unit: "R", step: 0.1, min: 0.5, max: 10,
        help: "Take-profit op zoveel keer je risico (R). 2R = je mikt op twee keer zoveel winst als je riskeert." },
      { key: "trailingAtrMult", label: "Trailing stop", unit: "× ATR", step: 0.1, min: 0, max: 10, zeroOff: true,
        help: "De stop schuift mee omhoog, op deze afstand onder de hoogste koers. 0 = uit." },
      { key: "breakEvenAtR", label: "Break-even vanaf", unit: "R", step: 0.1, min: 0, max: 5, zeroOff: true,
        help: "Zet de stop op instap + kosten zodra je deze winst hebt, zodat een winnaar geen verliezer meer wordt. 0 = uit." },
      { key: "timeStopCandles", label: "Tijdslimiet", unit: "candles", step: 1, min: 0, max: 10000, int: true, zeroOff: true,
        help: "Sluit een positie na zoveel candles als hij niet in de winst staat. 0 = uit." },
    ],
  },
  {
    title: "Dagelijkse limieten",
    fields: [
      { key: "dailyLossLimitPct", label: "Max. dagverlies", unit: "%", step: 0.5, min: 0.5, max: 50,
        help: "Verlies je vandaag dit % van je saldo, dan stopt de bot met nieuwe trades tot morgen." },
      { key: "maxTradesPerDay", label: "Max. trades per dag", unit: "trades", step: 1, min: 1, max: 100, int: true,
        help: "Voorkomt overtraden: elke trade kost fees." },
      { key: "cooldownCandlesAfterLoss", label: "Afkoelperiode na verlies", unit: "candles", step: 1, min: 0, max: 500, int: true,
        help: "Na een verliestrade zoveel candles niet opnieuw instappen in dezelfde markt (tegen 'revenge trading')." },
    ],
  },
  {
    title: "Kosten",
    fields: [
      { key: "takerFee", label: "Taker fee", unit: "%", scale: 100, step: 0.01, min: 0, max: 1,
        help: "Bitvavo-fee voor market orders (standaard 0,25%). Je betaalt hem bij kopen én verkopen." },
      { key: "makerFee", label: "Maker fee", unit: "%", scale: 100, step: 0.01, min: 0, max: 1,
        help: "Fee voor limit orders die in het orderboek blijven staan (standaard 0,15%)." },
      { key: "slippagePct", label: "Slippage", unit: "%", scale: 100, step: 0.01, min: 0, max: 2,
        help: "Verwacht verschil tussen de koers en je werkelijke vulprijs, per kant." },
      { key: "minEdgeFeeMultiple", label: "Min. winstruimte", unit: "× kosten", step: 0.5, min: 0, max: 20,
        help: "Het winstdoel moet minstens zoveel keer de totale kosten zijn, anders slaat de bot de trade over." },
    ],
  },
];

export const clone = (o) => JSON.parse(JSON.stringify(o ?? null));
export function stable(o) {
  if (Array.isArray(o)) return `[${o.map(stable).join(",")}]`;
  if (o && typeof o === "object") return `{${Object.keys(o).sort().map((k) => `${JSON.stringify(k)}:${stable(o[k])}`).join(",")}}`;
  return JSON.stringify(o);
}
export function getPath(o, path) {
  return path.split(".").reduce((a, k) => (a == null ? undefined : a[k]), o);
}
export function setPath(o, path, v) {
  const ks = path.split(".");
  let cur = o;
  for (let i = 0; i < ks.length - 1; i++) {
    if (cur[ks[i]] == null || typeof cur[ks[i]] !== "object") cur[ks[i]] = {};
    cur = cur[ks[i]];
  }
  cur[ks[ks.length - 1]] = v;
}
function deletePath(o, path) {
  const ks = path.split(".");
  const parent = getPath(o, ks.slice(0, -1).join("."));
  if (parent && typeof parent === "object") delete parent[ks[ks.length - 1]];
}
export const round = (v, d = 8) => (Number.isFinite(v) ? Number(v.toFixed(d)) : v);
export const parseNum = (s) => {
  const n = Number(String(s).trim().replace(",", "."));
  return String(s).trim() === "" ? NaN : n;
};

/** Bereik in de eenheid van het invoerveld: "tussen 0% en 1%", "tussen 5 en 300 sec", "tussen € 0 en € 100". */
function rangeText(fmt, min, max, unit) {
  const a = fmt.num(min, 4);
  const b = fmt.num(max, 4);
  if (unit === "%") return `tussen ${a}% en ${b}%`;
  if (unit === "€") return `tussen € ${a} en € ${b}`;
  return `tussen ${a} en ${b}${unit ? ` ${unit}` : ""}`;
}

/**
 * Valideert een concept-config. Grenzen worden intern (fractie, ms) vergeleken,
 * maar in de meldingen in de eenheid van het veld getoond (%, sec).
 * @returns {{ errors: string[], invalid: Set<string> }}
 */
export function validateDraft(d, { fmt, maxMarkets = 8 }) {
  const errs = [];
  const invalid = new Set();
  if (!d.markets?.length || d.markets.length > maxMarkets) {
    errs.push(`Kies 1 tot ${maxMarkets} markten.`);
    invalid.add("markets");
  }
  const check = (path, label, min, max, { int = false, scale = 1, unit = "", range = "" } = {}) => {
    const v = getPath(d, path);
    if (!Number.isFinite(v)) {
      errs.push(`${label}: vul een getal in.`);
      invalid.add(path);
    } else if ((min !== undefined && v < min - 1e-12) || (max !== undefined && v > max + 1e-12)) {
      errs.push(`${label} moet ${range || rangeText(fmt, min * scale, max * scale, unit)} liggen.`);
      invalid.add(path);
    } else if (int && !Number.isInteger(round(v, 6))) {
      errs.push(`${label} moet een heel getal zijn.`);
      invalid.add(path);
    }
  };
  check("pollMs", "Verversen", 5000, 300000, { scale: 0.001, unit: "sec" });
  check("historyCandles", "Historie per analyse", 100, 1000, { int: true, unit: "candles" });
  for (const g of RISK_GROUPS) {
    for (const f of g.fields) {
      const s = f.scale || 1;
      const v = d.risk?.[f.key];
      if (f.zeroOff && v === 0) continue;
      if (f.key === "trailingAtrMult") {
        check(`risk.${f.key}`, f.label, 0.5, 10, {
          unit: f.unit,
          range: `0 (uit) of ${rangeText(fmt, 0.5, 10, f.unit)}`,
        });
      } else check(`risk.${f.key}`, f.label, f.min / s, f.max / s, { int: f.int, scale: s, unit: f.unit });
    }
  }
  if (!(d.ensemble?.buyThreshold >= 0.05 && d.ensemble?.buyThreshold <= 1)) {
    errs.push("Koopdrempel moet tussen 0,05 en 1 liggen.");
    invalid.add("ensemble.buyThreshold");
  }
  if (!(d.ensemble?.sellThreshold >= -1 && d.ensemble?.sellThreshold <= -0.05)) {
    errs.push("Verkoopdrempel moet tussen −1 en −0,05 liggen.");
    invalid.add("ensemble.sellThreshold");
  }
  if (!d.ensemble?.enabled?.length) errs.push("Zet minstens één strategie aan.");
  if (d.risk?.maxTotalExposurePct < d.risk?.maxPositionPct) {
    errs.push("Max. totale blootstelling is kleiner dan de max. positiegrootte.");
    invalid.add("risk.maxTotalExposurePct");
  }
  return { errors: errs, invalid };
}

/** Bitvavo's standaard taker fee (0,25%) als fractie */
export const BITVAVO_TAKER_FEE = 0.0025;

/** Niet-blokkerende waarschuwingen over de kosteninstellingen. */
export function feeWarnings(risk) {
  const fee = Number(risk?.takerFee);
  if (!Number.isFinite(fee)) return [];
  if (fee === 0)
    return ["Taker fee staat op 0%: paper-trading en backtests rekenen dan zonder handelskosten en zijn veel te rooskleurig. Bitvavo rekent standaard 0,25% per kant."];
  if (fee < BITVAVO_TAKER_FEE - 1e-12)
    return ["Taker fee is lager dan Bitvavo's standaard 0,25%: paper-trading en backtests onderschatten dan de kosten. Vul hem in als percentage (0,25 = 0,25%)."];
  return [];
}

/**
 * PUT-body met alleen wat de gebruiker in het concept (`d`) veranderde ten
 * opzichte van de config waar het concept op gebaseerd is (`base`). Zo worden
 * wijzigingen die elders gedaan zijn (Scanner, Backtest, ander tabblad) nooit
 * teruggedraaid door velden die de gebruiker hier niet aanraakte.
 */
export function buildPatch(d, base) {
  const b = base || {};
  const changed = (x, y) => stable(x) !== stable(y);
  const patch = {};
  if (changed(d.markets, b.markets)) patch.markets = d.markets;
  if (d.interval !== b.interval) patch.interval = d.interval;
  if (Math.round(d.pollMs) !== Math.round(b.pollMs)) patch.pollMs = Math.round(d.pollMs);
  if (Math.round(d.historyCandles) !== Math.round(b.historyCandles)) patch.historyCandles = Math.round(d.historyCandles);

  const de = d.ensemble || {};
  const be = b.ensemble || {};
  const ens = {};
  if (changed([...(de.enabled || [])].sort(), [...(be.enabled || [])].sort())) ens.enabled = de.enabled;
  const weights = {};
  for (const [id, w] of Object.entries(de.weights || {})) if (w !== be.weights?.[id]) weights[id] = w;
  if (Object.keys(weights).length) ens.weights = weights;
  for (const k of ["buyThreshold", "sellThreshold"]) if (round(de[k], 4) !== round(be[k], 4)) ens[k] = round(de[k], 4);
  if (!!de.regimeFilter !== !!be.regimeFilter) ens.regimeFilter = !!de.regimeFilter;
  // Parameter-overrides: alleen gewijzigde strategieën; null = verwijderen
  const bp = be.params || {};
  const dp = de.params || {};
  const params = {};
  for (const id of Object.keys(bp)) if (!(id in dp)) params[id] = null;
  for (const [id, p] of Object.entries(dp)) if (changed(p, bp[id])) params[id] = p;
  if (Object.keys(params).length) ens.params = params;
  if (Object.keys(ens).length) patch.ensemble = ens;

  const risk = {};
  for (const [k, v] of Object.entries(d.risk || {})) if (round(v, 8) !== round(b.risk?.[k], 8)) risk[k] = round(v, 8);
  if (Object.keys(risk).length) patch.risk = risk;
  return patch;
}

/** Drieweg-samenvoegen van een lijst: wijzigingen van beide kanten blijven behouden. */
function mergeList(mine, base, theirs) {
  const added = mine.filter((x) => !base.includes(x));
  const removed = base.filter((x) => !mine.includes(x));
  return [...theirs.filter((x) => !removed.includes(x)), ...added.filter((x) => !theirs.includes(x))];
}

/**
 * Zet een concept met niet-opgeslagen wijzigingen over op een nieuwere
 * serverconfig. Per veld: niet aangeraakt → nieuwe serverwaarde; alleen hier
 * gewijzigd → concept houden; op beide plekken (verschillend) gewijzigd →
 * concept houden en melden in `conflicts`. Lijsten (markten, strategieën)
 * worden samengevoegd.
 * @returns {{ draft: object, conflicts: string[], changed: boolean }}
 */
export function rebaseDraft(draft, base, server) {
  const out = clone(draft);
  const conflicts = [];
  let changed = false;
  const same = (x, y) => stable(x) === stable(y);

  for (const path of ["markets", "ensemble.enabled"]) {
    const dv = getPath(draft, path) || [];
    const bv = getPath(base, path) || [];
    const sv = getPath(server, path) || [];
    if (same(sv, bv) || same(dv, sv)) continue;
    const merged = same(dv, bv) ? [...sv] : mergeList(dv, bv, sv);
    if (!same(merged, dv)) {
      setPath(out, path, merged);
      changed = true;
    }
  }

  const keysOf = (path) =>
    new Set([draft, base, server].flatMap((o) => Object.keys(getPath(o, path) || {})));
  const units = ["interval", "pollMs", "historyCandles", "ensemble.buyThreshold", "ensemble.sellThreshold", "ensemble.regimeFilter"];
  for (const id of keysOf("ensemble.weights")) units.push(`ensemble.weights.${id}`);
  for (const id of keysOf("ensemble.params")) units.push(`ensemble.params.${id}`);
  for (const k of keysOf("risk")) units.push(`risk.${k}`);

  for (const path of units) {
    const dv = getPath(draft, path);
    const bv = getPath(base, path);
    const sv = getPath(server, path);
    if (same(sv, bv) || same(dv, sv)) continue; // elders niets veranderd, of hetzelfde gekozen
    if (same(dv, bv)) {
      // hier niet aangeraakt → de nieuwe serverwaarde overnemen
      if (sv === undefined) deletePath(out, path);
      else setPath(out, path, clone(sv));
      changed = true;
    } else conflicts.push(path); // op beide plekken anders gewijzigd → waarde van de gebruiker houden
  }
  return { draft: out, conflicts, changed };
}
