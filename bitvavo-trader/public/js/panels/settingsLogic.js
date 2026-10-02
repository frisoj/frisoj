// Pure logica van het Instellingen-paneel (geen DOM), zodat ze los te testen is
// (tests/frontend/settingsLogic.test.ts): velddefinities, validatie, de PUT-patch
// en het samenvoegen van een concept met instellingen die elders zijn gewijzigd.

/** Zelfde als MAX_MARKETS in src/core/defaults.ts: maximaal aantal munten dat de bot volgt */
export const MAX_MARKETS = 400;
/** Snelkeuzes voor het aantal munten bij "Automatisch" */
export const UNIVERSE_COUNT_PRESETS = [10, 30, 100, 400];
/** Tot zoveel gekozen munten worden als chips getoond; daarboven ingeklapt ("+N meer tonen") */
export const CHIPS_COLLAPSE_AT = 30;
/** Tijdschalen van het trendfilter (TREND_FILTER_INTERVALS in src/core/types.ts) */
export const TREND_INTERVALS = ["1d", "4h"];

/**
 * Kopie van DEFAULT_ENGINE_CONFIG (src/core/defaults.ts) voor de knop
 * "Standaardwaarden". Een test bewaakt dat ze gelijk blijven.
 */
export const FACTORY_DEFAULTS = {
  markets: ["BTC-EUR", "ETH-EUR", "SOL-EUR"],
  interval: "15m",
  pollMs: 15000,
  historyCandles: 300,
  ensemble: {
    enabled: ["ema-trend", "rsi-reversion", "breakout", "macd-momentum", "vwap-reversion"],
    weights: { "ema-trend": 1.2, "rsi-reversion": 1, breakout: 1, "macd-momentum": 1, "vwap-reversion": 0.8 },
    params: {},
    buyThreshold: 0.35,
    sellThreshold: -0.3,
    regimeFilter: true,
    trendFilter: { market: true, coin: false, interval: "1d", period: 50 },
  },
  risk: {
    riskPerTradePct: 1.5,
    maxPositionPct: 45,
    maxOpenPositions: 2,
    maxTotalExposurePct: 90,
    stopAtrMult: 2,
    takeProfitR: 2,
    trailingAtrMult: 2.5,
    breakEvenAtR: 1,
    dailyLossLimitPct: 5,
    maxTradesPerDay: 6,
    cooldownCandlesAfterLoss: 4,
    minEdgeFeeMultiple: 3,
    takerFee: 0.0025,
    makerFee: 0.0015,
    slippagePct: 0.0005,
    minOrderQuote: 5,
    timeStopCandles: 48,
    maxSpreadPct: 0.3,
    dailyProfitTargetPct: 1,
  },
  universe: { mode: "auto", count: 30, minVolumeEur: 250_000 },
};

/**
 * Kopie van de handelsstijl per bot-profiel (BOT_PROFILES[].engine in src/bots/profiles.ts),
 * voor "Standaardwaarden" op het dashboard van een bot: anders werd de Snelle scalper
 * (5 min, eigen strategieën, krappe stop) daarmee een gewone 15-minutenbot, en kon je zijn
 * stijl alleen terugkrijgen door data/bots/scalper/config.json met de hand te wissen.
 * Een test bewaakt dat profileDefaults(id) gelijk is aan profileEngineConfig(getProfile(id)).
 */
export const PROFILE_ENGINE = {
  scalper: {
    interval: "5m",
    ensemble: {
      enabled: ["breakout", "macd-momentum", "ema-trend", "vwap-reversion"],
      weights: { breakout: 1.3, "macd-momentum": 1.2, "ema-trend": 1, "vwap-reversion": 0.6 },
      buyThreshold: 0.3,
      sellThreshold: -0.25,
      regimeFilter: true,
      trendFilter: { market: false, coin: false, interval: "1d", period: 50 },
    },
    risk: {
      stopAtrMult: 1.2,
      takeProfitR: 1.5,
      trailingAtrMult: 1.5,
      breakEvenAtR: 0.8,
      maxTradesPerDay: 30,
      cooldownCandlesAfterLoss: 6,
      timeStopCandles: 36,
      maxSpreadPct: 0.15,
    },
    universe: { mode: "auto", count: 60, minVolumeEur: 1_000_000 },
  },
  trend: {
    interval: "1h",
    ensemble: {
      enabled: ["ema-trend", "breakout", "macd-momentum"],
      weights: { "ema-trend": 1.5, breakout: 1.2, "macd-momentum": 1 },
      buyThreshold: 0.35,
      regimeFilter: true,
      trendFilter: { market: true, coin: true, interval: "1d", period: 50 },
    },
    risk: { riskPerTradePct: 2, stopAtrMult: 2.5, takeProfitR: 3, trailingAtrMult: 3, breakEvenAtR: 1.5, maxTradesPerDay: 6, timeStopCandles: 72 },
    universe: { mode: "auto", count: 100, minVolumeEur: 250_000 },
  },
  dip: {
    interval: "15m",
    ensemble: {
      enabled: ["rsi-reversion", "vwap-reversion"],
      weights: { "rsi-reversion": 1.4, "vwap-reversion": 1.2 },
      buyThreshold: 0.3,
      sellThreshold: -0.25,
      regimeFilter: true,
      trendFilter: { market: true, coin: false, interval: "1d", period: 50 },
    },
    risk: { stopAtrMult: 1.5, takeProfitR: 1.5, trailingAtrMult: 0, breakEvenAtR: 1, maxTradesPerDay: 12, timeStopCandles: 32, maxSpreadPct: 0.25 },
    universe: { mode: "auto", count: 100, minVolumeEur: 250_000 },
  },
  allround: {
    interval: "15m",
    risk: { stopAtrMult: 1.5, maxTradesPerDay: 20 },
    universe: { mode: "auto", count: 150, minVolumeEur: 250_000 },
  },
};

/**
 * De standaardinstellingen van een bot-profiel: FACTORY_DEFAULTS met het profiel eroverheen,
 * zoals profileEngineConfig() op de server. null = onbekend profiel.
 */
export function profileDefaults(id) {
  const e = typeof id === "string" && Object.prototype.hasOwnProperty.call(PROFILE_ENGINE, id) ? PROFILE_ENGINE[id] : null;
  if (!e) return null;
  const c = clone(FACTORY_DEFAULTS);
  if (e.interval) c.interval = e.interval;
  if (e.pollMs !== undefined) c.pollMs = e.pollMs;
  if (e.risk) c.risk = { ...c.risk, ...clone(e.risk) };
  if (e.universe) c.universe = { ...c.universe, ...clone(e.universe) };
  if (e.ensemble) {
    const ens = clone(e.ensemble);
    c.ensemble = {
      ...c.ensemble,
      ...(ens.enabled ? { enabled: ens.enabled } : {}),
      // een profiel legt ALLE gewichten vast
      ...(ens.weights ? { weights: ens.weights } : {}),
      ...(ens.buyThreshold !== undefined ? { buyThreshold: ens.buyThreshold } : {}),
      ...(ens.sellThreshold !== undefined ? { sellThreshold: ens.sellThreshold } : {}),
      ...(ens.regimeFilter !== undefined ? { regimeFilter: ens.regimeFilter } : {}),
      ...(ens.trendFilter ? { trendFilter: ens.trendFilter } : {}),
    };
  }
  return c;
}

/**
 * Wat "↺ Standaardwaarden" invult: de standaard van DEZE bot (van de server als die ze
 * meestuurt in `info.bot.defaults`, anders zijn profiel), en alleen zonder bot-profiel
 * (oudere server) de fabrieksinstellingen.
 * @returns {{ config: object, name: string, profile: boolean }}
 */
export function defaultsFor(info) {
  const bot = info && info.bot && typeof info.bot === "object" ? info.bot : null;
  const name = bot && typeof bot.name === "string" ? bot.name : "";
  if (bot && bot.defaults && typeof bot.defaults === "object") return { config: withDefaults(bot.defaults), name, profile: true };
  const prof = bot ? profileDefaults(bot.id) : null;
  if (prof) return { config: prof, name, profile: true };
  return { config: clone(FACTORY_DEFAULTS), name: "", profile: false };
}

/**
 * Wat een ontbrekend veld BETEKENT (contract v2): een config zonder `universe` is
 * "zelf kiezen", een ensemble zonder `trendFilter` heeft geen trendfilter en een
 * risicoconfig zonder `maxSpreadPct` geen spreadlimiet (en zonder `dailyProfitTargetPct` geen dagdoel). Dus niet de fabriekswaarden
 * invullen, maar deze "uit"-waarden (met nette standaarden voor de overige velden).
 */
const UNIVERSE_WHEN_MISSING = { mode: "manual", count: 30, minVolumeEur: 250_000 };
const TREND_WHEN_MISSING = { market: false, coin: false, interval: "1d", period: 50 };

/** Oudere/onvolledige configs aanvullen, zodat het concept altijd dezelfde vorm heeft. */
export function withDefaults(cfg) {
  const c = clone(cfg) || {};
  c.risk = { ...FACTORY_DEFAULTS.risk, maxSpreadPct: 0, dailyProfitTargetPct: 0, ...(c.risk || {}) };
  const tf = c.ensemble?.trendFilter;
  c.ensemble = { ...clone(FACTORY_DEFAULTS.ensemble), ...(c.ensemble || {}) };
  c.ensemble.trendFilter = { ...TREND_WHEN_MISSING, ...(tf && typeof tf === "object" ? tf : {}) };
  c.universe = { ...UNIVERSE_WHEN_MISSING, ...(c.universe && typeof c.universe === "object" ? c.universe : {}) };
  return c;
}

/** Staat er een trendfilter aan (markt of munt)? */
export const trendFilterActive = (tf) => !!tf && (tf.market === true || tf.coin === true);

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
        help: "Kleinste bedrag waarmee de bot een positie opent. Bitvavo eist minimaal €5; de bot gebruikt altijd minstens dat, en maakt een positie bovendien zo groot dat hij bij de stop-loss nog boven €5 verkocht kan worden. Is de berekende positie kleiner, dan slaat de bot de trade over." },
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
      { key: "dailyProfitTargetPct", label: "Dagdoel", unit: "%", step: 0.1, min: 0.1, max: 50, zeroOff: true, optional: true,
        help: "Winstgrens: haal je vandaag dit % (ná verkoopkosten), dan handelt de bot gewoon door. Zakt je dagwinst daarna terug tot dit %, dan verkoopt hij alles om de winst vast te zetten en doet hij tot morgen niets meer. Het maakt de bot niet vaker winstgevend: het beschermt een goede dag. 0 = uit." },
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
      { key: "maxSpreadPct", label: "Max. spread", unit: "%", step: 0.05, min: 0, max: 5, zeroOff: true, optional: true,
        help: "De spread is het verschil tussen de koop- en verkoopprijs: een verborgen kostenpost, vooral bij kleine munten. Is hij groter dan dit, dan koopt de bot die munt niet. De automatische muntkeuze slaat zulke munten ook over. 0 = uit." },
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
export function validateDraft(d, { fmt, maxMarkets = MAX_MARKETS }) {
  const errs = [];
  const invalid = new Set();
  const mode = d.universe?.mode ?? "manual";
  const nMarkets = Array.isArray(d.markets) ? d.markets.length : 0;
  if (nMarkets > maxMarkets) {
    errs.push(`Je kunt hoogstens ${maxMarkets} munten kiezen (nu ${nMarkets}).`);
    invalid.add("markets");
  } else if (!nMarkets && mode !== "auto") {
    // Bij "Automatisch" mag de eigen lijst leeg zijn: dan blijft de opgeslagen lijst staan (zie buildPatch)
    errs.push("Kies minstens één munt, of zet Munten op Automatisch.");
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
      if (f.optional && v === undefined) continue;
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
  if (d.universe) {
    if (d.universe.mode !== "auto" && d.universe.mode !== "manual") {
      errs.push("Kies hoe de bot zijn munten kiest: Automatisch of Zelf kiezen.");
      invalid.add("universe.mode");
    }
    check("universe.count", "Aantal munten", 1, maxMarkets, { int: true, unit: "munten" });
    check("universe.minVolumeEur", "Minimaal 24u-volume", 0, 1e12, { unit: "€" });
  }
  const tf = d.ensemble?.trendFilter;
  if (tf) {
    if (!TREND_INTERVALS.includes(tf.interval)) {
      errs.push("Kies voor het trendfilter de tijdschaal Dag of 4 uur.");
      invalid.add("ensemble.trendFilter.interval");
    }
    check("ensemble.trendFilter.period", "Periode van het trendfilter", 5, 200, {
      int: true,
      unit: tf.interval === "4h" ? "blokken van 4 uur" : "dagen",
    });
  }
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
  const auto = d.universe?.mode === "auto";
  // Bij "Automatisch" een leeggemaakte eigen lijst niet meesturen: de opgeslagen lijst blijft dan staan
  if (changed(d.markets, b.markets) && !(auto && !d.markets?.length)) patch.markets = d.markets;
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
  // Trendfilter: alleen de gewijzigde velden (de server voegt per veld samen)
  if (de.trendFilter) {
    const dt = de.trendFilter;
    const bt = be.trendFilter || {};
    const tf = {};
    for (const k of ["market", "coin"]) if (!!dt[k] !== !!bt[k] || bt[k] === undefined) tf[k] = !!dt[k];
    if (dt.interval !== bt.interval) tf.interval = dt.interval;
    if (Math.round(dt.period) !== Math.round(bt.period)) tf.period = Math.round(dt.period);
    if (Object.keys(tf).length) ens.trendFilter = tf;
  }
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

  // Muntkeuze: alleen de gewijzigde velden
  if (d.universe) {
    const du = d.universe;
    const bu = b.universe || {};
    const uni = {};
    if (du.mode !== bu.mode) uni.mode = du.mode;
    if (Math.round(du.count) !== Math.round(bu.count)) uni.count = Math.round(du.count);
    if (round(du.minVolumeEur, 2) !== round(bu.minVolumeEur, 2)) uni.minVolumeEur = round(du.minVolumeEur, 2);
    if (Object.keys(uni).length) patch.universe = uni;
  }
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
  for (const k of keysOf("ensemble.trendFilter")) units.push(`ensemble.trendFilter.${k}`);
  for (const k of keysOf("universe")) units.push(`universe.${k}`);

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

// ── Munten (v2) ──

const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`;
const sameDay = (a, b) => new Date(a).toDateString() === new Date(b).toDateString();

/**
 * Uitleg van de engine (`snapshot.universe.note`) die gewone status is, geen waarschuwing:
 * "Nog geen automatische keuze gemaakt…" en "Opgeslagen automatische keuze…" (zie
 * universeView in src/engine/tradingEngine.ts). Al het andere (bijv. "Automatische
 * muntkeuze mislukt: …" of "Maar 12 munten voldoen…") is een waarschuwing.
 */
export function isPlainUniverseNote(note) {
  const n = String(note ?? "").trim();
  // De engine plakt een capaciteitswaarschuwing achter de gewone zin: dan is het een waarschuwing
  if (/Te veel munten/i.test(n)) return false;
  return /^Nog geen automatische keuze\b/i.test(n) || /^Opgeslagen automatische keuze\b/i.test(n);
}

/**
 * Korte Nederlandse status van de muntkeuze uit de snapshot, bijv.
 * "Nu actief: 30 munten, gekozen om 14:05". `draftMode` = de stand in het
 * formulier: wijkt die af van de server, dan staat in `pending` wat er na
 * Opslaan gebeurt.
 * @returns {{ text: string, detail: string, note: string, pending: string }}
 */
export function universeStatus(snap, draftMode, fmt, now = Date.now()) {
  const u = snap?.universe;
  const active = Array.isArray(snap?.activeMarkets) ? snap.activeMarkets : null;
  const serverMode = snap?.config?.universe?.mode ?? u?.mode ?? (snap?.config ? "manual" : null);
  const out = { text: "", detail: "", note: "", pending: "" };
  const count = Number.isFinite(u?.count) ? u.count : active ? active.length : null;
  if (count !== null) {
    if ((u?.mode ?? serverMode) === "auto") {
      if (Number.isFinite(u?.updatedAt)) {
        const at = sameDay(u.updatedAt, now) ? fmt.time(u.updatedAt) : fmt.dateTime(u.updatedAt);
        out.text = `Nu actief: ${plural(count, "munt", "munten")}, gekozen om ${at}`;
        if (Number.isFinite(u.requested) && u.requested > count)
          out.detail = `Je vroeg er ${u.requested}, maar er voldoen er nu maar ${count} aan het minimale volume en de spread.`;
      } else {
        out.text = `Nu actief: ${plural(count, "munt", "munten")}`;
        out.detail = "De bot maakt zijn eerste automatische keuze zodra hij draait.";
      }
    } else {
      out.text = `Nu actief: ${plural(count, "zelfgekozen munt", "zelfgekozen munten")}`;
    }
  }
  if (u?.note) {
    // Nog geen (eigen) automatische keuze: die uitleg is gewone status. Een mislukte keuze is
    // altijd een waarschuwing, ook vóór de eerste gelukte keuze.
    if ((u.mode ?? serverMode) === "auto" && isPlainUniverseNote(u.note)) {
      // (de standaardzin "maakt zijn eerste keuze…" vervangen, een "Je vroeg er …" houden)
      out.detail = Number.isFinite(u.updatedAt) && out.detail ? `${out.detail} ${String(u.note)}` : String(u.note);
    } else {
      out.note = String(u.note);
      // "maakt zijn eerste keuze zodra hij draait" klopt niet als hij het al probeerde en dat mislukte
      if (!Number.isFinite(u.updatedAt)) out.detail = "";
    }
  }
  if (serverMode && draftMode && draftMode !== serverMode) {
    out.pending =
      draftMode === "auto"
        ? "Nog niet opgeslagen. Na Opslaan kiest de bot binnen een paar minuten zelf zijn munten."
        : "Nog niet opgeslagen. Na Opslaan volgt de bot precies jouw eigen lijst.";
  }
  return out;
}

/**
 * Welke gekozen munten als chip getoond worden. Boven `limit` ingeklapt, tenzij
 * uitgeklapt of er gezocht wordt (dan alle treffers).
 * @returns {{ shown: string[], hidden: number, total: number }}
 */
export function chipsView(selected, { query = "", expanded = false, limit = CHIPS_COLLAPSE_AT } = {}) {
  const list = Array.isArray(selected) ? selected : [];
  const q = String(query || "").trim().toUpperCase();
  const matches = q ? list.filter((m) => m.toUpperCase().includes(q)) : list;
  if (q || expanded || matches.length <= limit) return { shown: matches, hidden: 0, total: matches.length };
  return { shown: matches.slice(0, limit), hidden: matches.length - limit, total: matches.length };
}

/**
 * Kopie van EXCLUDED_BASES in src/engine/universe.ts (een test bewaakt dat ze gelijk blijven):
 * stablecoins, goud-tokens en verpakte BTC/ETH. De automatische muntkeuze slaat ze over, en
 * "Alle markten toevoegen" dus ook (los toevoegen via zoeken kan nog wel).
 */
export const EXCLUDED_BASES = new Set([
  // stablecoins (dollar / euro)
  "USDT", "USDC", "DAI", "TUSD", "BUSD", "USDP", "PYUSD", "FDUSD", "USDE", "USDS", "GUSD", "FRAX",
  "LUSD", "USDD", "RLUSD", "USD1", "USDG", "EURC", "EURS", "EURT", "EUROC", "EURI", "EURR", "EUROP", "EURCV",
  // goud-tokens
  "PAXG", "XAUT",
  // verpakte / liquid-staking varianten van BTC en ETH
  "WBTC", "CBBTC", "WETH", "STETH", "WSTETH", "CBETH", "RETH", "WEETH",
]);

/** Symbool in hoofdletters: "usdc-eur" → "USDC" */
const baseUpper = (m) => {
  const s = String(m || "");
  const i = s.indexOf("-");
  return (i > 0 ? s.slice(0, i) : s).toUpperCase();
};

/** Stablecoin, goud-token of verpakte BTC/ETH? */
export const isExcludedMarket = (market) => EXCLUDED_BASES.has(baseUpper(market));

/**
 * Volgorde van de markten om toe te voegen (knoppen en "Alle markten toevoegen"), zoals de
 * automatische muntkeuze: meeste handel eerst.
 * 1. 24u-volume bekend en minstens `minVolume` → hoog naar laag;
 * 2. volume onbekend → de bekende grote munten (`popular`), dan op naam;
 * 3. volume bekend maar onder `minVolume` (lastig te verhandelen) → hoog naar laag;
 * 4. stablecoins, goud en verpakte munten → op naam.
 * @param {string[]} markets
 * @param {{ volumes?: Record<string, number> | Map<string, number> | null, popular?: string[], minVolume?: number }} o
 */
export function orderMarketsForAdding(markets, { volumes = null, popular = [], minVolume = 0 } = {}) {
  const vol = (m) => {
    const v = volumes instanceof Map ? volumes.get(m) : volumes ? volumes[m] : undefined;
    return typeof v === "number" && Number.isFinite(v) && v >= 0 ? v : null;
  };
  const min = Number.isFinite(minVolume) && minVolume > 0 ? minVolume : 0;
  const pop = (m) => {
    const i = popular.indexOf(baseUpper(m));
    return i < 0 ? Infinity : i;
  };
  const tier = (m) => (isExcludedMarket(m) ? 3 : vol(m) === null ? 1 : vol(m) >= min ? 0 : 2);
  const list = [...new Set((Array.isArray(markets) ? markets : []).filter((m) => typeof m === "string" && m))];
  return list
    .map((m) => ({ m, t: tier(m), v: vol(m), p: pop(m) }))
    .sort((a, b) => a.t - b.t || (a.t === 0 || a.t === 2 ? b.v - a.v : 0) || (a.t === 1 ? a.p - b.p : 0) || a.m.localeCompare(b.m))
    .map((x) => x.m);
}

/**
 * "Alle markten toevoegen": de eigen lijst plus alle nog niet gekozen markten
 * (in de volgorde van `all`), tot hoogstens `max`. Stablecoins, goud en verpakte
 * munten (EXCLUDED_BASES) worden overgeslagen, net als bij de automatische keuze;
 * staan ze al in de eigen lijst, dan blijven ze staan.
 * @returns {{ markets: string[], added: number }}
 */
export function addAllMarkets(selected, all, max = MAX_MARKETS) {
  const cur = Array.isArray(selected) ? [...selected] : [];
  const have = new Set(cur);
  const room = Math.max(0, max - cur.length);
  const extra = [];
  for (const m of all || []) {
    if (extra.length >= room) break;
    if (!have.has(m) && !isExcludedMarket(m)) {
      have.add(m);
      extra.push(m);
    }
  }
  return { markets: [...cur, ...extra], added: extra.length };
}

/** Eenheid van de trendfilter-periode zoals de gebruiker hem ziet ("80 blokken van 4 uur", zoals overal) */
export const trendPeriodUnit = (interval) => (interval === "4h" ? "blokken van 4 uur" : "dagen");
