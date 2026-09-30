/**
 * Risicobeheer (A4): positiegrootte, stops, take-profit, trailing/break-even,
 * time-stop, dagelijkse verlieslimiet en validatie van risico-instellingen.
 *
 * Zowel de backtester als de live/paper-engine gebruiken deze klasse, dus alles
 * is deterministisch en muteert NOOIT de invoer.
 *
 * Kapitaalbehoud gaat boven alles: bij twijfel wordt een entry afgewezen.
 */
import {
  INTERVAL_MS,
  type AccountSnapshot,
  type Candle,
  type EnsembleDecision,
  type EntryPlan,
  type ExitReason,
  type HaltStatus,
  type Interval,
  type MarketInfo,
  type Position,
  type PositionUpdate,
  type RiskConfig,
  type RiskManagerLike,
} from "../core/types";
import { exchangeMinBase, exchangeMinQuote } from "../exchange/minimums";

// ─────────────────────────────── Helpers ───────────────────────────────

/** Totale round-trip kosten als fractie: 2 × taker fee + 2 × slippage. */
export function roundTripCostPct(cfg: RiskConfig): number {
  return 2 * cfg.takerFee + 2 * cfg.slippagePct;
}

/** Deel van de cash dat maximaal gebruikt wordt (marge voor afronding/fees). */
const CASH_USAGE = 0.995;
/**
 * Bij ophogen naar de minimale positie mag het risico max. dit × het budget zijn.
 * 1 = nooit meer risico dan "Risico per trade" (de README belooft max. 1,5%).
 * Een positie die alleen met extra risico groot genoeg wordt, wordt overgeslagen
 * (met 1 wordt een te kleine positie in de praktijk dus niet meer opgehoogd).
 */
const MAX_BUMP_RISK_MULTIPLE = 1;
/**
 * Marge bovenop de kleinste positie die bij de stop-loss nog verkocht kan
 * worden: dekt een koers die door de stop heen gapt, een iets andere vulprijs
 * dan gepland en het afronden van de hoeveelheid.
 */
const SELL_MIN_BUFFER = 1.03;
/** Relatieve tolerantie voor het herkennen van stop-niveaus (initieel / break-even). */
const LEVEL_REL_EPS = 1e-6;
function isNum(x: unknown): x is number {
  return typeof x === "number" && Number.isFinite(x);
}

/** Naar beneden afronden op centen (robuust tegen 0.29 * 100 = 28.999…). */
function floorCents(x: number): number {
  if (!isNum(x) || x <= 0) return 0;
  return Math.floor(x * 100 + 1e-7) / 100;
}

/** Naar boven afronden op centen. */
function ceilCents(x: number): number {
  if (!isNum(x) || x <= 0) return 0;
  return Math.ceil(x * 100 - 1e-7) / 100;
}

/** Nederlands getal: 1234.5 → "1234,50" (vaste decimalen). */
function nl(x: number, decimals: number): string {
  if (!Number.isFinite(x)) return String(x);
  return x.toFixed(decimals).replace(".", ",");
}

function eur(x: number): string {
  return `€${nl(x, 2)}`;
}

function pct(x: number, decimals = 1): string {
  return `${nl(x, decimals)}%`;
}

/** Leesbare prijs voor zowel BTC (60000) als SHIB (0,00001234). */
function price(x: number): string {
  if (!Number.isFinite(x)) return String(x);
  const a = Math.abs(x);
  if (a >= 1000) return nl(x, 2);
  if (a >= 1) return nl(x, 4);
  if (a === 0) return "0";
  return x.toPrecision(5).replace(".", ",");
}

/** Hoeveelheid zonder exponent en zonder overbodige nullen: 0.00001234 → "0,00001234". */
function qty(x: number): string {
  if (!Number.isFinite(x)) return String(x);
  return x.toFixed(10).replace(/\.?0+$/, "").replace(".", ",");
}

/** Getal zonder overbodige nullen, met komma: 0.5 → "0,5", 10 → "10". */
function num(x: number): string {
  return String(x).replace(".", ",");
}

// ─────────────────────────────── Validatie ───────────────────────────────

interface Bound {
  label: string;
  min: number;
  max: number;
  integer?: boolean;
  /** 0 is ook toegestaan (functie uit), anders [min, max] */
  zeroAllowed?: boolean;
}

const BOUNDS: Record<keyof RiskConfig, Bound> = {
  riskPerTradePct: { label: "Risico per trade (%)", min: 0.1, max: 10 },
  maxPositionPct: { label: "Max. positiegrootte (%)", min: 1, max: 100 },
  maxOpenPositions: { label: "Max. open posities", min: 1, max: 10, integer: true },
  maxTotalExposurePct: { label: "Max. totale blootstelling (%)", min: 1, max: 100 },
  stopAtrMult: { label: "Stop-loss (× ATR)", min: 0.5, max: 10 },
  takeProfitR: { label: "Take-profit (× R)", min: 0.5, max: 10 },
  trailingAtrMult: { label: "Trailing stop (× ATR)", min: 0.5, max: 10, zeroAllowed: true },
  breakEvenAtR: { label: "Break-even vanaf (× R)", min: 0, max: 5 },
  dailyLossLimitPct: { label: "Dagelijkse verlieslimiet (%)", min: 0.5, max: 50 },
  maxTradesPerDay: { label: "Max. trades per dag", min: 1, max: 100, integer: true },
  cooldownCandlesAfterLoss: { label: "Afkoelperiode na verlies (candles)", min: 0, max: 500, integer: true },
  minEdgeFeeMultiple: { label: "Minimale winstruimte (× kosten)", min: 0, max: 20 },
  takerFee: { label: "Taker fee (fractie)", min: 0, max: 0.01 },
  makerFee: { label: "Maker fee (fractie)", min: 0, max: 0.01 },
  slippagePct: { label: "Slippage (fractie)", min: 0, max: 0.02 },
  minOrderQuote: { label: "Minimale orderwaarde (EUR)", min: 0, max: Number.POSITIVE_INFINITY },
  timeStopCandles: { label: "Tijdstop (candles)", min: 0, max: 10000, integer: true },
  maxSpreadPct: { label: "Max. spread (%)", min: 0, max: 5 },
  dailyProfitTargetPct: { label: "Dagdoel (%)", min: 0.1, max: 50, zeroAllowed: true },
};

const RISK_KEYS = Object.keys(BOUNDS) as (keyof RiskConfig)[];

/**
 * Optionele instellingen: ontbreken (of `undefined`) is geldig en betekent
 * "uit" (bijv. geen spreadlimiet). Een opgegeven waarde moet wel binnen de
 * grenzen liggen.
 */
const OPTIONAL_KEYS: ReadonlySet<keyof RiskConfig> = new Set<keyof RiskConfig>(["maxSpreadPct", "dailyProfitTargetPct"]);

function checkValue(key: keyof RiskConfig, value: unknown): string | null {
  if (value === undefined && OPTIONAL_KEYS.has(key)) return null;
  const b = BOUNDS[key];
  const name = `${b.label} (${key})`;
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return `${name} moet een geldig getal zijn (nu: ${JSON.stringify(value) ?? String(value)})`;
  }
  if (b.integer && !Number.isInteger(value)) {
    return `${name} moet een geheel getal zijn (nu: ${num(value)})`;
  }
  if (b.zeroAllowed && value === 0) return null;
  if (value < b.min || value > b.max) {
    if (b.max === Number.POSITIVE_INFINITY) {
      return `${name} moet ${num(b.min)} of hoger zijn (nu: ${num(value)})`;
    }
    const range = `tussen ${num(b.min)} en ${num(b.max)}`;
    return b.zeroAllowed
      ? `${name} moet 0 (uit) of ${range} zijn (nu: ${num(value)})`
      : `${name} moet ${range} liggen (nu: ${num(value)})`;
  }
  return null;
}

/**
 * Valideer (een deel van) de risico-instellingen. Elke opgegeven key moet een
 * bekende instelling zijn met een eindig getal binnen verstandige grenzen.
 * Foutmeldingen zijn Nederlands en noemen het veld.
 */
export function validateRiskConfig(partial: Partial<RiskConfig>): { ok: boolean; errors: string[] } {
  const errors: string[] = [];
  if (partial === null || typeof partial !== "object" || Array.isArray(partial)) {
    return { ok: false, errors: ["Risico-instellingen moeten een object zijn"] };
  }
  for (const key of Object.keys(partial)) {
    if (!Object.prototype.hasOwnProperty.call(BOUNDS, key)) {
      errors.push(`Onbekende risico-instelling: ${key}`);
      continue;
    }
    const err = checkValue(key as keyof RiskConfig, (partial as Record<string, unknown>)[key]);
    if (err) errors.push(err);
  }
  return { ok: errors.length === 0, errors };
}

/** Volledige config-check (alle keys verplicht, onbekende keys genegeerd). */
function validateFullConfig(cfg: RiskConfig): string[] {
  if (cfg === null || typeof cfg !== "object") return ["Risico-instellingen ontbreken"];
  const errors: string[] = [];
  for (const key of RISK_KEYS) {
    const err = checkValue(key, (cfg as unknown as Record<string, unknown>)[key]);
    if (err) errors.push(err);
  }
  return errors;
}

// ─────────────────────────────── RiskManager ───────────────────────────────

export class RiskManager implements RiskManagerLike {
  readonly cfg: RiskConfig;
  readonly interval: Interval;
  private readonly intervalMs: number;

  constructor(cfg: RiskConfig, interval: Interval) {
    const ms = INTERVAL_MS[interval];
    if (!isNum(ms)) throw new Error(`Onbekend interval: ${String(interval)}`);
    this.cfg = cfg;
    this.interval = interval;
    this.intervalMs = ms;
  }

  /** Round-trip kosten (fractie) voor de huidige config. */
  get roundTripCost(): number {
    return roundTripCostPct(this.cfg);
  }

  // ───────────── Entry ─────────────

  planEntry(
    decision: EnsembleDecision,
    account: AccountSnapshot,
    market: MarketInfo | undefined,
    now: number,
  ): EntryPlan {
    const cfg = this.cfg;
    const reasons: string[] = [];
    const marketName = decision.market;
    const openPositions = Array.isArray(account.openPositions) ? account.openPositions : [];

    // Config-sanity: met een kapotte config wordt er nooit gekocht.
    const cfgErrors = validateFullConfig(cfg);
    if (cfgErrors.length > 0) {
      reasons.push(`Ongeldige risico-instellingen: ${cfgErrors.join("; ")}`);
    }
    const rtc = roundTripCostPct(cfg);

    // 1. Signaal
    if (decision.action !== "buy") {
      reasons.push(`Geen koopsignaal (actie: ${decision.action})`);
    }

    // 2. Dagelijkse verlieslimiet / equity
    const halt = this.haltStatus(account);
    if (halt.halted) reasons.push(halt.reason ?? "Handel gestopt door risicobeheer");

    // 3. Trades per dag
    if (!(account.tradesToday < cfg.maxTradesPerDay)) {
      reasons.push(`Maximum aantal trades per dag bereikt (${account.tradesToday}/${cfg.maxTradesPerDay})`);
    }

    // 4. Aantal open posities
    if (!(openPositions.length < cfg.maxOpenPositions)) {
      reasons.push(`Maximum aantal open posities bereikt (${openPositions.length}/${cfg.maxOpenPositions})`);
    }

    // 5. Al een positie in deze markt
    if (openPositions.some((p) => p.market === marketName)) {
      reasons.push(`Er staat al een positie open in ${marketName}`);
    }

    // 6. Afkoelperiode na verlies
    const lastLoss = account.lastLossAt?.[marketName];
    if (isNum(lastLoss) && cfg.cooldownCandlesAfterLoss > 0) {
      const cooldownMs = cfg.cooldownCandlesAfterLoss * this.intervalMs;
      const elapsed = now - lastLoss;
      if (elapsed < cooldownMs) {
        const left = Math.max(1, Math.ceil((cooldownMs - elapsed) / this.intervalMs));
        const minutes = Math.ceil((cooldownMs - elapsed) / 60_000);
        reasons.push(
          `Afkoelperiode na verlies in ${marketName}: nog ${left} ${left === 1 ? "candle" : "candles"} (~${minutes} min) wachten`,
        );
      }
    }

    // 7. Marktstatus
    if (market && market.status !== "trading") {
      reasons.push(`Markt ${marketName} is niet actief (status: ${market.status})`);
    }

    // 8. Koers en ATR
    const refPrice = decision.price;
    const atr = decision.atr;
    const priceOk = isNum(refPrice) && refPrice > 0;
    const atrOk = isNum(atr) && atr > 0;
    if (!priceOk) reasons.push(`Ongeldige koers voor ${marketName} (${String(refPrice)})`);
    if (!atrOk) reasons.push("ATR onbekend of 0 (te weinig data voor een stop-loss)");

    let entry = 0;
    let stop = 0;
    let takeProfit = 0;
    let quoteAmount = 0;
    let riskQuote = 0;
    let bumped = false;

    if (priceOk && atrOk) {
      entry = refPrice * (1 + cfg.slippagePct);
      const stopDist = cfg.stopAtrMult * atr;
      stop = entry - stopDist;
      takeProfit = entry + cfg.takeProfitR * stopDist;

      // 9. Stop moet boven 0 liggen
      const stopOk = isNum(stop) && stop > 0;
      if (!stopOk) {
        reasons.push(`Stop-loss zou op of onder 0 liggen (${price(stop)}): ATR te groot t.o.v. de koers`);
      }

      // 10. Fee-edge: afstand naar take-profit moet de kosten ruim dekken
      const edge = (takeProfit - entry) / entry;
      const requiredEdge = cfg.minEdgeFeeMultiple * rtc;
      if (!(edge >= requiredEdge - 1e-12)) {
        reasons.push(
          `Te weinig winstruimte t.o.v. kosten: doel +${pct(edge * 100, 2)} < ${num(cfg.minEdgeFeeMultiple)}× kosten (${pct(requiredEdge * 100, 2)})`,
        );
      }

      // 11. Positiegrootte
      if (stopOk) {
        const equity = isNum(account.equity) ? account.equity : 0;
        const cash = isNum(account.cashQuote) ? account.cashQuote : 0;
        const riskBudget = Math.max(0, equity) * (cfg.riskPerTradePct / 100);
        const lossPerUnit = stopDist + entry * rtc;
        const riskAt = (q: number): number => (q / (1 + cfg.takerFee) / entry) * lossPerUnit;

        const quoteByRisk = (riskBudget / lossPerUnit) * entry * (1 + cfg.takerFee);
        const posCap = Math.max(0, equity) * (cfg.maxPositionPct / 100);
        const exposure = openPositions.reduce((s, p) => s + (isNum(p.costQuote) ? p.costQuote : 0), 0);
        const exposureCap = Math.max(0, Math.max(0, equity) * (cfg.maxTotalExposurePct / 100) - exposure);
        const cashCap = Math.max(0, cash * CASH_USAGE);

        const raw = Math.min(quoteByRisk, posCap, exposureCap, cashCap);
        let q = floorCents(raw);

        // Minimale orderwaarde. Het beursminimum geldt voor kopen ÉN verkopen:
        // Bitvavo weigert ook verkopen onder €5. Het komt uit MarketInfo; zonder
        // (geldig, > 0) minimum in MarketInfo is het het standaardminimum van €5
        // (EXCHANGE_MIN_ORDER_QUOTE) — zelfde regel als de brokers en de
        // backtest. De instelling minOrderQuote vervangt het beursminimum NOOIT
        // (een lagere verlaagt het niet, een hogere telt niet voor verkopen):
        // het is alleen een extra ondergrens voor instappen; het strengste van
        // de twee telt voor de koop.
        const cfgMin = isNum(cfg.minOrderQuote) && cfg.minOrderQuote >= 0 ? cfg.minOrderQuote : 0;
        const hasMarketMin = isNum(market?.minOrderQuote) && market.minOrderQuote > 0;
        const exchangeMin = exchangeMinQuote(market);
        const minOrder = Math.max(exchangeMin, cfgMin);

        // De positie moet bij de stop-loss nog boven het beursminimum verkocht
        // kunnen worden, anders werken stop-loss, handmatig sluiten en noodstop
        // nooit. Hoeveelheid = q / (1 + fee) / entry, waarde bij de stop =
        // hoeveelheid × stop. Ook het minimum in base (hoeveelheid) telt mee.
        const minBase = exchangeMinBase(market);
        const sellMinByQuote = exchangeMin * (1 + cfg.takerFee) * (entry / stop) * SELL_MIN_BUFFER;
        const sellMinByBase = minBase > 0 ? minBase * entry * (1 + cfg.takerFee) * SELL_MIN_BUFFER : 0;
        const sellMin = ceilCents(Math.max(sellMinByQuote, sellMinByBase));
        const required = Math.max(ceilCents(minOrder), sellMin, 0.01);

        if (!(q >= required - 1e-9) || q <= 0) {
          const bump = required;
          const eps = 1e-9;
          const fitsPos = bump <= posCap + eps;
          const fitsExposure = bump <= exposureCap + eps;
          const fitsCash = bump <= cashCap + eps;
          const bumpRisk = riskAt(bump);
          const riskOk = bumpRisk <= MAX_BUMP_RISK_MULTIPLE * riskBudget + eps;
          if (fitsPos && fitsExposure && fitsCash && riskOk) {
            q = bump;
            bumped = true;
          } else {
            const baseBinds = sellMinByBase > sellMinByQuote;
            const exchLabel = `${hasMarketMin ? "beursminimum" : "minimum"} van ${eur(exchangeMin)}`;
            const baseMin = `${qty(minBase)} ${market?.base ?? ""}`.trimEnd();
            if (q > 0 && q >= minOrder - 1e-9) {
              // Groot genoeg om te kopen, maar (bij de stop) niet meer verkoopbaar.
              reasons.push(
                baseBinds
                  ? `Positie van ${eur(q)} is minder dan het beursminimum van ${baseMin} en kan dan niet verkocht worden (minimaal ${eur(bump)} nodig)`
                  : `Positie van ${eur(q)} zakt bij de stop-loss onder het ${exchLabel} en kan dan niet verkocht worden (minimaal ${eur(bump)} nodig)`,
              );
            } else {
              reasons.push(`Te klein: ${eur(q)} < minimum ${eur(minOrder)}`);
              if (bump > ceilCents(minOrder) + 1e-9) {
                reasons.push(
                  baseBinds
                    ? `Om het beursminimum van ${baseMin} te kunnen verkopen is minimaal ${eur(bump)} nodig`
                    : `Om bij de stop-loss (${price(stop)}) nog boven het ${exchLabel} te kunnen verkopen is minimaal ${eur(bump)} nodig`,
                );
              }
            }
            if (!fitsCash) {
              reasons.push(
                `Onvoldoende saldo: ${eur(cash)} beschikbaar (max. ${eur(cashCap)} bruikbaar), minimaal ${eur(bump)} nodig`,
              );
            }
            if (!fitsPos) {
              reasons.push(
                `Max. positiegrootte (${pct(cfg.maxPositionPct, 0)} van equity = ${eur(posCap)}) is kleiner dan het minimum ${eur(bump)}`,
              );
            }
            if (!fitsExposure) {
              reasons.push(
                `Max. totale blootstelling (${pct(cfg.maxTotalExposurePct, 0)}): nog ${eur(exposureCap)} ruimte, minimum is ${eur(bump)}`,
              );
            }
            if (!riskOk) {
              const limit =
                MAX_BUMP_RISK_MULTIPLE === 1
                  ? `het risicobudget (${eur(riskBudget)})`
                  : `${num(MAX_BUMP_RISK_MULTIPLE)}× het risicobudget (${eur(riskBudget)})`;
              reasons.push(`Risico bij de minimale positie van ${eur(bump)} (${eur(bumpRisk)}) is meer dan ${limit}`);
            }
            q = 0;
          }
        }
        quoteAmount = q;
        riskQuote = q > 0 ? riskAt(q) : 0;
      }
    }

    const approved = reasons.length === 0;
    if (approved) {
      const stopPct = ((stop - entry) / entry) * 100;
      const tpPct = ((takeProfit - entry) / entry) * 100;
      reasons.push(
        `Koop ${eur(quoteAmount)}${bumped ? " (opgehoogd naar minimum)" : ""} ${marketName} @ ~${price(entry)}` +
          ` | stop ${price(stop)} (${pct(stopPct, 2)})` +
          ` | doel ${price(takeProfit)} (+${pct(tpPct, 2)})` +
          ` | risico ${eur(riskQuote)}`,
      );
    }

    return {
      approved,
      reasons,
      market: marketName,
      // Afgewezen → nooit een bedrag teruggeven dat per ongeluk uitgevoerd kan worden.
      quoteAmount: approved ? quoteAmount : 0,
      expectedEntryPrice: isNum(entry) ? entry : 0,
      stopPrice: isNum(stop) ? stop : 0,
      takeProfitPrice: isNum(takeProfit) ? takeProfit : 0,
      riskQuote: approved ? riskQuote : 0,
    };
  }

  // ───────────── Positiebeheer ─────────────

  updatePosition(pos: Position, candle: Candle, atr: number, closedCandle: boolean): PositionUpdate {
    const cfg = this.cfg;
    const rtc = roundTripCostPct(cfg);

    const prevHigh = isNum(pos.highestPrice) ? pos.highestPrice : pos.entryPrice;
    const highest = isNum(candle.high) ? Math.max(prevHigh, candle.high) : prevHigh;
    const currentStop = isNum(pos.stopPrice) ? pos.stopPrice : pos.initialStopPrice;

    // 1. Stop (altijd eerst: bij stop én take-profit in één candle wint de stop)
    if (isNum(currentStop) && isNum(candle.low) && candle.low <= currentStop) {
      const exitPrice = isNum(candle.open) ? Math.min(candle.open, currentStop) : currentStop;
      return {
        exit: true,
        exitReason: this.classifyStop(pos, currentStop, rtc),
        exitPrice,
        stopPrice: currentStop,
        highestPrice: highest,
      };
    }

    // 2. Take-profit
    const tp = pos.takeProfitPrice;
    if (isNum(tp) && tp > 0 && isNum(candle.high) && candle.high >= tp) {
      const exitPrice = isNum(candle.open) ? Math.max(candle.open, tp) : tp;
      return { exit: true, exitReason: "take-profit", exitPrice, stopPrice: currentStop, highestPrice: highest };
    }

    // 3. Time-stop (alleen op gesloten candles; caller heeft candlesHeld al opgehoogd)
    if (
      closedCandle &&
      cfg.timeStopCandles > 0 &&
      pos.candlesHeld >= cfg.timeStopCandles &&
      isNum(candle.close) &&
      candle.close <= pos.entryPrice * (1 + rtc)
    ) {
      return {
        exit: true,
        exitReason: "time-stop",
        exitPrice: candle.close,
        stopPrice: currentStop,
        highestPrice: highest,
      };
    }

    // 4. Stop verhogen voor volgende candles (nooit verlagen).
    //    Alleen op gesloten candles, net als de backtester: een verhoging tijdens
    //    een candle mag niet met terugwerkende kracht gelden voor de low van die
    //    candle (die kan vóór de stijging gevallen zijn). Tussentijdse ticks
    //    werken wel highestPrice bij en controleren de stop die al gold.
    let newStop = currentStop;
    const R = pos.entryPrice - pos.initialStopPrice;
    if (closedCandle && isNum(R) && R > 0) {
      // Break-even alleen als dat niveau onder de slotkoers ligt: een stop
      // boven de markt zou meteen met verlies (als "break-even") verkopen.
      const breakEven = pos.entryPrice * (1 + rtc);
      if (
        cfg.breakEvenAtR > 0 &&
        highest >= pos.entryPrice + cfg.breakEvenAtR * R &&
        isNum(candle.close) &&
        candle.close > breakEven
      ) {
        newStop = Math.max(newStop, breakEven);
      }
      if (cfg.trailingAtrMult > 0 && isNum(atr) && atr > 0 && highest >= pos.entryPrice + R) {
        newStop = Math.max(newStop, highest - cfg.trailingAtrMult * atr);
      }
    }

    return { exit: false, stopPrice: newStop, highestPrice: highest };
  }

  /** Welke soort stop werd geraakt: initiële stop, break-even of trailing. */
  private classifyStop(pos: Position, stop: number, rtc: number): ExitReason {
    const eps = Math.abs(pos.entryPrice) * LEVEL_REL_EPS;
    if (!isNum(pos.initialStopPrice) || stop <= pos.initialStopPrice + eps) return "stop-loss";
    const breakEven = pos.entryPrice * (1 + rtc);
    if (Math.abs(stop - breakEven) <= eps) return "break-even";
    return "trailing-stop";
  }

  shouldExitOnSignal(pos: Position, decision: EnsembleDecision): boolean {
    return decision.action === "sell" && decision.market === pos.market;
  }

  // ───────────── Dagelijkse limiet ─────────────

  haltStatus(account: AccountSnapshot): HaltStatus {
    const equity = account.equity;
    if (!isNum(equity)) {
      return { halted: true, reason: "Equity onbekend: handel gestopt uit voorzorg" };
    }
    if (equity <= 0) {
      return { halted: true, reason: `Equity is ${eur(equity)}: geen kapitaal meer om mee te handelen` };
    }
    const dayStart = account.dayStartEquity;
    if (isNum(dayStart) && dayStart > 0) {
      const changePct = ((equity - dayStart) / dayStart) * 100;
      if (-changePct >= this.cfg.dailyLossLimitPct - 1e-9) {
        return {
          halted: true,
          reason: `Dagelijkse verlieslimiet bereikt (${pct(changePct)}, limiet -${pct(this.cfg.dailyLossLimitPct)})`,
          dailyLimit: true,
        };
      }
      // Dagdoel: pas gehaald als de winst ook na het verkopen van de open posities er is.
      const target = this.cfg.dailyProfitTargetPct;
      const exitCost = isNum(account.exitCostQuote) && account.exitCostQuote > 0 ? account.exitCostQuote : 0;
      const netPct = ((equity - exitCost - dayStart) / dayStart) * 100;
      if (isNum(target) && target > 0 && netPct >= target - 1e-9) {
        return {
          halted: true,
          reason: `Dagdoel gehaald (+${pct(netPct, 2)} vandaag, doel +${pct(target, Number.isInteger(target) ? 0 : 2)}): geen nieuwe trades meer tot morgen`,
          dailyTarget: true,
        };
      }
    }
    return { halted: false };
  }
}
