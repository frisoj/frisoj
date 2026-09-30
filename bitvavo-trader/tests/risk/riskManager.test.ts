import { describe, expect, it } from "vitest";
import { DEFAULT_RISK_CONFIG, EXCHANGE_MIN_ORDER_QUOTE } from "../../src/core/defaults";
import {
  INTERVAL_MS,
  type AccountSnapshot,
  type Candle,
  type EnsembleDecision,
  type MarketInfo,
  type Position,
  type RiskConfig,
} from "../../src/core/types";
import { PaperBroker } from "../../src/broker/paperBroker";
import { RiskManager, roundTripCostPct, validateRiskConfig } from "../../src/risk/riskManager";

// ─────────────────────────────── Fixtures ───────────────────────────────

const NOW = Date.UTC(2026, 8, 28, 12, 0, 0);

function cfg(over: Partial<RiskConfig> = {}): RiskConfig {
  return { ...DEFAULT_RISK_CONFIG, ...over };
}

function rm(over: Partial<RiskConfig> = {}, interval: "15m" | "1h" = "15m"): RiskManager {
  return new RiskManager(cfg(over), interval);
}

function decision(over: Partial<EnsembleDecision> = {}): EnsembleDecision {
  return {
    market: "BTC-EUR",
    time: NOW - INTERVAL_MS["15m"],
    price: 100,
    action: "buy",
    score: 0.5,
    confidence: 0.6,
    regime: "trend-up",
    atr: 1,
    votes: [],
    ...over,
  };
}

function account(over: Partial<AccountSnapshot> = {}): AccountSnapshot {
  return {
    cashQuote: 50,
    equity: 50,
    dayStartEquity: 50,
    tradesToday: 0,
    realizedPnlToday: 0,
    openPositions: [],
    lastLossAt: {},
    ...over,
  };
}

function marketInfo(over: Partial<MarketInfo> = {}): MarketInfo {
  return {
    market: "BTC-EUR",
    base: "BTC",
    quote: "EUR",
    status: "trading",
    minOrderQuote: 5,
    minOrderBase: 0,
    pricePrecision: 5,
    quantityDecimals: 8,
    notionalDecimals: 2,
    ...over,
  };
}

function position(over: Partial<Position> = {}): Position {
  return {
    id: "pos_test",
    market: "BTC-EUR",
    side: "long",
    entryTime: NOW,
    entryPrice: 100,
    amount: 0.2,
    costQuote: 20.05,
    entryFeeQuote: 0.05,
    stopPrice: 96,
    initialStopPrice: 96,
    takeProfitPrice: 108,
    highestPrice: 100,
    candlesHeld: 0,
    entryReason: "test",
    ...over,
  };
}

function candle(open: number, high: number, low: number, close: number): Candle {
  return { time: NOW, open, high, low, close, volume: 1 };
}

/** Verwachte sizing volgens het contract (defaults, tenzij overschreven). */
function expectedSizing(c: RiskConfig, price: number, atr: number, equity: number) {
  const rtc = 2 * c.takerFee + 2 * c.slippagePct;
  const entry = price * (1 + c.slippagePct);
  const stop = entry - c.stopAtrMult * atr;
  const tp = entry + c.takeProfitR * (entry - stop);
  const riskBudget = (equity * c.riskPerTradePct) / 100;
  const lossPerUnit = entry - stop + entry * rtc;
  const quoteByRisk = (riskBudget / lossPerUnit) * entry * (1 + c.takerFee);
  const riskAt = (q: number) => (q / (1 + c.takerFee) / entry) * lossPerUnit;
  return { rtc, entry, stop, tp, riskBudget, lossPerUnit, quoteByRisk, riskAt };
}

// ─────────────────────────────── roundTripCostPct ───────────────────────────────

describe("roundTripCostPct", () => {
  it("is 2× taker fee + 2× slippage als fractie", () => {
    expect(roundTripCostPct(DEFAULT_RISK_CONFIG)).toBeCloseTo(0.006, 12);
    expect(roundTripCostPct(cfg({ takerFee: 0.001, slippagePct: 0 }))).toBeCloseTo(0.002, 12);
  });
});

// ─────────────────────────────── planEntry: sizing ───────────────────────────────

describe("planEntry — sizing", () => {
  it("€50 account met defaults: maxPositionPct (45%) is de bindende cap", () => {
    const r = rm();
    const plan = r.planEntry(decision(), account(), marketInfo(), NOW);
    const e = expectedSizing(DEFAULT_RISK_CONFIG, 100, 1, 50);

    expect(plan.approved).toBe(true);
    expect(plan.market).toBe("BTC-EUR");
    expect(plan.expectedEntryPrice).toBeCloseTo(100.05, 10);
    expect(plan.stopPrice).toBeCloseTo(98.05, 10);
    expect(plan.takeProfitPrice).toBeCloseTo(104.05, 10);
    // Risk-sizing zou ~€28,93 geven, maar 45% van €50 = €22,50 bindt.
    expect(e.quoteByRisk).toBeCloseTo(28.93, 2);
    expect(plan.quoteAmount).toBe(22.5);
    expect(plan.riskQuote).toBeCloseTo(e.riskAt(22.5), 10);
    expect(plan.riskQuote).toBeCloseTo(0.5832, 3);
    expect(plan.riskQuote).toBeLessThanOrEqual(e.riskBudget);
    // Samenvatting bij goedkeuring
    expect(plan.reasons).toHaveLength(1);
    expect(plan.reasons[0]).toContain("Koop €22,50");
  });

  it("rondt het bedrag af naar beneden op centen", () => {
    const plan = rm().planEntry(decision(), account({ equity: 50.37, cashQuote: 50.37 }), marketInfo(), NOW);
    // 45% × 50,37 = 22,6665 → 22,66 (niet 22,67)
    expect(plan.approved).toBe(true);
    expect(plan.quoteAmount).toBe(22.66);
    expect(Math.round(plan.quoteAmount * 100) / 100).toBe(plan.quoteAmount);
  });

  it("risk-based sizing bindt bij grote ATR (en risico ≤ budget)", () => {
    const plan = rm().planEntry(decision({ atr: 3 }), account(), marketInfo(), NOW);
    const e = expectedSizing(DEFAULT_RISK_CONFIG, 100, 3, 50);
    expect(plan.approved).toBe(true);
    expect(plan.quoteAmount).toBe(Math.floor(e.quoteByRisk * 100) / 100);
    expect(plan.quoteAmount).toBe(11.39);
    expect(plan.stopPrice).toBeCloseTo(94.05, 10);
    expect(plan.takeProfitPrice).toBeCloseTo(112.05, 10);
    expect(plan.riskQuote).toBeCloseTo(e.riskAt(11.39), 10);
    expect(plan.riskQuote).toBeLessThanOrEqual(e.riskBudget + 1e-12);
    expect(plan.riskQuote).toBeGreaterThan(e.riskBudget - 0.01);
  });

  it("cash-cap: max 99,5% van de beschikbare cash", () => {
    const other = position({ market: "ETH-EUR", costQuote: 20 });
    const plan = rm().planEntry(
      decision(),
      account({ cashQuote: 8, equity: 50, openPositions: [other] }),
      marketInfo(),
      NOW,
    );
    expect(plan.approved).toBe(true);
    expect(plan.quoteAmount).toBe(7.96); // 8 × 0,995
  });

  it("exposure-cap: maxTotalExposurePct × equity − bestaande blootstelling", () => {
    const other = position({ market: "ETH-EUR", costQuote: 37 });
    const plan = rm().planEntry(
      decision(),
      account({ cashQuote: 13, equity: 50, openPositions: [other] }),
      marketInfo(),
      NOW,
    );
    // 90% × 50 − 37 = 8 (cash-cap 12,935; pos-cap 22,5)
    expect(plan.approved).toBe(true);
    expect(plan.quoteAmount).toBe(8);
  });

  it("hoogt NIET op naar het minimum als het risico dan boven het budget komt", () => {
    // Vroeger: opgehoogd naar precies €5,00 met ~1,2× het risico. Die €5,00 is na
    // fee en slippage ~€4,985 waard en kon dus zelfs zonder koersdaling niet
    // verkocht worden (Bitvavo en PaperBroker weigeren verkopen < €5).
    const plan = rm().planEntry(decision({ atr: 9 }), account(), marketInfo(), NOW);
    const e = expectedSizing(DEFAULT_RISK_CONFIG, 100, 9, 50);
    expect(e.quoteByRisk).toBeLessThan(5);
    expect(e.quoteByRisk).toBeCloseTo(4.0443, 3);
    expect(plan.approved).toBe(false);
    expect(plan.quoteAmount).toBe(0);
    expect(plan.riskQuote).toBe(0);
    expect(plan.reasons).toContain("Te klein: €4,04 < minimum €5,00");
    // Bij de stop (82,05) is minimaal €5 × 1,0025 × 100,05/82,05 × 1,03 = €6,30 nodig
    expect(plan.reasons.some((x) => x.startsWith("Om bij de stop-loss") && x.includes("€6,30"))).toBe(true);
    expect(plan.reasons.some((x) => x.includes("risicobudget (€0,75)"))).toBe(true);
    expect(plan.reasons.join(" ")).not.toContain("opgehoogd");
  });

  it("wijst af onder het minimum als het risico bij de minimale positie > budget is", () => {
    const plan = rm().planEntry(decision({ atr: 9 }), account({ equity: 20, cashQuote: 20 }), marketInfo(), NOW);
    const e = expectedSizing(DEFAULT_RISK_CONFIG, 100, 9, 20);
    expect(e.riskAt(5)).toBeGreaterThan(e.riskBudget);
    expect(plan.approved).toBe(false);
    expect(plan.quoteAmount).toBe(0);
    expect(plan.riskQuote).toBe(0);
    expect(plan.reasons).toContain("Te klein: €1,61 < minimum €5,00");
    expect(plan.reasons.some((x) => x.includes("risicobudget"))).toBe(true);
  });

  it("wijst een positie af die ≥ €5 is maar bij de stop-loss niet meer verkocht kan worden", () => {
    // €50, ATR 6,5%: risk-sizing geeft €5,53, maar bij de stop (−13%) is dat ~€4,80.
    const plan = rm().planEntry(decision({ atr: 6.5 }), account(), marketInfo(), NOW);
    const e = expectedSizing(DEFAULT_RISK_CONFIG, 100, 6.5, 50);
    expect(Math.floor(e.quoteByRisk * 100) / 100).toBe(5.53);
    const valueAtStop = (5.53 / (1 + DEFAULT_RISK_CONFIG.takerFee) / e.entry) * e.stop;
    expect(valueAtStop).toBeLessThan(5);
    expect(plan.approved).toBe(false);
    expect(plan.quoteAmount).toBe(0);
    expect(plan.reasons[0]).toBe(
      "Positie van €5,53 zakt bij de stop-loss onder het beursminimum van €5,00 en kan dan niet verkocht worden (minimaal €5,94 nodig)",
    );
    expect(plan.reasons.some((x) => x.includes("risicobudget"))).toBe(true);
    // Met iets meer risicoruimte past de verkoopbare positie wel
    const ok = rm({ riskPerTradePct: 2 }).planEntry(decision({ atr: 6.5 }), account(), marketInfo(), NOW);
    expect(ok.approved).toBe(true);
    expect(ok.quoteAmount).toBeGreaterThanOrEqual(5.94);
  });

  it("gebruikt het minimum in base (minOrderBase) ook voor de verkoopbaarheid", () => {
    // 0,2 BTC × 100,05 × 1,0025 × 1,03 ≈ €20,67 ≤ pos-cap €22,50 → past
    const fits = rm().planEntry(decision(), account(), marketInfo({ minOrderBase: 0.2 }), NOW);
    expect(fits.approved).toBe(true);
    expect(fits.quoteAmount).toBe(22.5);
    // 0,25 BTC × 100,05 × 1,0025 × 1,03 ≈ €25,83 > pos-cap €22,50 → afwijzen
    const tooBig = rm().planEntry(decision(), account(), marketInfo({ minOrderBase: 0.25 }), NOW);
    expect(tooBig.approved).toBe(false);
    expect(tooBig.reasons[0]).toBe(
      "Positie van €22,50 is minder dan het beursminimum van 0,25 BTC en kan dan niet verkocht worden (minimaal €25,83 nodig)",
    );
    expect(tooBig.reasons.some((x) => x.startsWith("Max. positiegrootte"))).toBe(true);
    // Te klein voor de koop én onder het base-minimum
    const both = rm().planEntry(
      decision(),
      account({ cashQuote: 4, equity: 50 }),
      marketInfo({ minOrderBase: 0.25 }),
      NOW,
    );
    expect(both.approved).toBe(false);
    expect(both.reasons).toContain("Te klein: €3,98 < minimum €5,00");
    expect(both.reasons).toContain("Om het beursminimum van 0,25 BTC te kunnen verkopen is minimaal €25,83 nodig");
  });

  it("wijst af als de cash te laag is voor de minimale order", () => {
    const plan = rm().planEntry(decision(), account({ cashQuote: 4, equity: 50 }), marketInfo(), NOW);
    expect(plan.approved).toBe(false);
    expect(plan.reasons).toContain("Te klein: €3,98 < minimum €5,00");
    expect(plan.reasons.some((x) => x.startsWith("Onvoldoende saldo"))).toBe(true);
  });

  it("wijst af als de max. positiegrootte kleiner is dan het minimum", () => {
    const plan = rm().planEntry(decision(), account({ cashQuote: 10, equity: 10 }), marketInfo(), NOW);
    // 45% × €10 = €4,50 < €5
    expect(plan.approved).toBe(false);
    expect(plan.reasons).toContain("Te klein: €4,50 < minimum €5,00");
    expect(plan.reasons.some((x) => x.startsWith("Max. positiegrootte"))).toBe(true);
  });

  it("minimale order: het strengste van markt-minimum en instelling telt", () => {
    // Markt-minimum €25 > pos-cap €22,50 → afwijzen
    const rejected = rm().planEntry(decision(), account(), marketInfo({ minOrderQuote: 25 }), NOW);
    expect(rejected.approved).toBe(false);
    expect(rejected.reasons).toContain("Te klein: €22,50 < minimum €25,00");
    // Zonder MarketInfo → config-minimum (€5)
    const noMarket = rm().planEntry(decision(), account(), undefined, NOW);
    expect(noMarket.approved).toBe(true);
    expect(noMarket.quoteAmount).toBe(22.5);
    // Config-minimum €30 zonder MarketInfo → afwijzen
    const cfgMin = rm({ minOrderQuote: 30 }).planEntry(decision(), account(), undefined, NOW);
    expect(cfgMin.approved).toBe(false);
  });

  it("instelling minOrderQuote werkt ook als MarketInfo een lager minimum heeft", () => {
    // Vroeger won MarketInfo (€5) altijd, waardoor de instelling geen effect had.
    // ATR 4: risk-sizing ≈ €8,74 → goed voor €5, te klein voor een ingesteld minimum van €10.
    const atr = 4;
    const e = expectedSizing(DEFAULT_RISK_CONFIG, 100, atr, 50);
    expect(Math.floor(e.quoteByRisk * 100) / 100).toBe(8.74);
    const base = rm().planEntry(decision({ atr }), account(), marketInfo({ minOrderQuote: 5 }), NOW);
    expect(base.approved).toBe(true);
    expect(base.quoteAmount).toBe(8.74);

    const strict = rm({ minOrderQuote: 10 }).planEntry(
      decision({ atr }),
      account(),
      marketInfo({ minOrderQuote: 5 }),
      NOW,
    );
    expect(strict.approved).toBe(false);
    expect(strict.quoteAmount).toBe(0);
    expect(strict.reasons).toContain("Te klein: €8,74 < minimum €10,00");
    expect(strict.reasons.some((x) => x.includes("risicobudget"))).toBe(true);

    // Grote positie (ATR 1 → €22,50) voldoet ook aan €10
    const big = rm({ minOrderQuote: 10 }).planEntry(decision(), account(), marketInfo({ minOrderQuote: 5 }), NOW);
    expect(big.approved).toBe(true);
    expect(big.quoteAmount).toBe(22.5);

    // Pos-cap onder het ingestelde minimum (45% × €20 = €9) → afwijzen, ook met MarketInfo
    const capped = rm({ minOrderQuote: 10 }).planEntry(
      decision(),
      account({ equity: 20, cashQuote: 20, dayStartEquity: 20 }),
      marketInfo({ minOrderQuote: 5 }),
      NOW,
    );
    expect(capped.approved).toBe(false);
    expect(capped.reasons).toContain("Te klein: €9,00 < minimum €10,00");
  });

  it("zonder MarketInfo verlaagt een lagere instelling (< €5) het beursminimum niet", () => {
    // Vroeger werd de instelling (€1) dan als beursminimum gebruikt: €4,04 werd goedgekeurd
    // (de broker weigert die koop) en €5,53 ook (bij de stop ~€4,80: onverkoopbaar).
    const low = { minOrderQuote: 1 };
    const small = rm(low).planEntry(decision({ atr: 9 }), account(), undefined, NOW);
    expect(small.approved).toBe(false);
    expect(small.quoteAmount).toBe(0);
    expect(small.reasons).toContain("Te klein: €4,04 < minimum €5,00");

    const atStop = rm(low).planEntry(decision({ atr: 6.5 }), account(), undefined, NOW);
    expect(atStop.approved).toBe(false);
    expect(atStop.reasons[0]).toBe(
      "Positie van €5,53 zakt bij de stop-loss onder het minimum van €5,00 en kan dan niet verkocht worden (minimaal €5,94 nodig)",
    );
    // Precies hetzelfde als met de MarketInfo van Bitvavo (€5).
    const withInfo = rm(low).planEntry(decision({ atr: 6.5 }), account(), marketInfo(), NOW);
    expect(withInfo.approved).toBe(false);
    expect(withInfo.reasons.join(" ")).toContain("minimaal €5,94 nodig");

    // Een ruime positie wordt gewoon goedgekeurd.
    const ok = rm(low).planEntry(decision(), account(), undefined, NOW);
    expect(ok.approved).toBe(true);
    expect(ok.quoteAmount).toBe(22.5);

    // MarketInfo met een lager beursminimum (€1) blijft wél gelden.
    const lowMarket = rm(low).planEntry(decision({ atr: 9 }), account(), marketInfo({ minOrderQuote: 1 }), NOW);
    expect(lowMarket.approved).toBe(true);
    expect(lowMarket.quoteAmount).toBe(4.04);

    // Hogere instelling zonder MarketInfo: die geldt (strengste telt), zoals voorheen.
    const high = rm({ minOrderQuote: 30 }).planEntry(decision(), account(), undefined, NOW);
    expect(high.approved).toBe(false);
    expect(high.reasons).toContain("Te klein: €22,50 < minimum €30,00");
  });

  it("verkoopbaarheid bij de stop rekent met het beursminimum, niet met de (hogere) instelling", () => {
    // Stop −20% (ATR 10): beurs €5 → minimaal €5 × 1,0025 × 100,05/80,05 × 1,03 ≈ €6,46.
    // Met instelling €10 is het minimum dus €10 (niet €10 × 1,29 ≈ €12,90):
    // risk-sizing van €10,95 (risico 4,5%) wordt gewoon goedgekeurd.
    const plan = rm({ minOrderQuote: 10, riskPerTradePct: 4.5 }).planEntry(
      decision({ atr: 10 }),
      account(),
      marketInfo({ minOrderQuote: 5 }),
      NOW,
    );
    expect(plan.approved).toBe(true);
    expect(plan.quoteAmount).toBe(10.95);
  });

  it("ook zonder MarketInfo telt voor de verkoopbaarheid bij de stop het beursminimum (€5), niet de hogere instelling", () => {
    // Vroeger werd zonder MarketInfo max(instelling, €5) = €10 als BEURSminimum gebruikt:
    // dan was bij de stop €12,90 nodig en werd deze €10,95-positie afgewezen.
    const plan = rm({ minOrderQuote: 10, riskPerTradePct: 4.5 }).planEntry(decision({ atr: 10 }), account(), undefined, NOW);
    expect(plan.approved).toBe(true);
    expect(plan.quoteAmount).toBe(10.95);
    // De instelling blijft wél een ondergrens voor de koop zelf.
    const small = rm({ minOrderQuote: 10 }).planEntry(decision({ atr: 4 }), account(), undefined, NOW);
    expect(small.approved).toBe(false);
    expect(small.reasons).toContain("Te klein: €8,74 < minimum €10,00");
  });

  it("een MarketInfo-minimum van 0 / NaN / negatief is ONBEKEND → €5 (EXCHANGE_MIN_ORDER_QUOTE), geen 'geen minimum'", () => {
    expect(EXCHANGE_MIN_ORDER_QUOTE).toBe(5);
    const low = { minOrderQuote: 1 };
    for (const bad of [0, Number.NaN, -1, Number.POSITIVE_INFINITY]) {
      const info = marketInfo({ minOrderQuote: bad });
      // €4,04 is onder het beursminimum: afgewezen (met 0 als "geen minimum" zou €4,04 door de instelling van €1 komen).
      const small = rm(low).planEntry(decision({ atr: 9 }), account(), info, NOW);
      expect(small.approved).toBe(false);
      expect(small.quoteAmount).toBe(0);
      expect(small.reasons).toContain("Te klein: €4,04 < minimum €5,00");
      // €5,53 zakt bij de stop onder €5: ook afgewezen (moet bij de stop verkoopbaar blijven).
      const atStop = rm(low).planEntry(decision({ atr: 6.5 }), account(), info, NOW);
      expect(atStop.approved).toBe(false);
      expect(atStop.reasons.join(" ")).toContain("minimaal €5,94 nodig");
      // Precies hetzelfde als zonder MarketInfo.
      expect(atStop.reasons).toEqual(rm(low).planEntry(decision({ atr: 6.5 }), account(), undefined, NOW).reasons);
      // Een ruime positie gaat gewoon door.
      expect(rm(low).planEntry(decision(), account(), info, NOW).quoteAmount).toBe(22.5);
    }
  });
});

// ─────────────────────────────── planEntry: verkoopbaarheid ───────────────────────────────

describe("planEntry — positie blijft verkoopbaar (min. €5 bij verkopen)", () => {
  /**
   * Koopt het plan met de echte PaperBroker en verkoopt daarna alles op (en iets
   * onder) de stop-loss. PaperBroker (net als Bitvavo en LiveBroker) weigert
   * verkopen onder €5: een goedgekeurde positie moet dus bij de stop nog te
   * verkopen zijn, anders werken stop-loss, handmatig sluiten en noodstop nooit.
   */
  async function sellResultsAtStop(c: RiskConfig, px: number, atr: number, equity: number) {
    const plan = new RiskManager(c, "15m").planEntry(
      decision({ price: px, atr }),
      account({ equity, cashQuote: equity, dayStartEquity: equity }),
      marketInfo(),
      NOW,
    );
    if (!plan.approved) return { plan, results: [] as string[] };
    const results: string[] = [];
    // Gap tot 2,5% door de stop heen moet ook nog lukken (buffer 3%)
    for (const ref of [px, plan.stopPrice, plan.stopPrice * 0.975]) {
      const broker = new PaperBroker({
        startingQuote: equity,
        takerFee: c.takerFee,
        slippagePct: c.slippagePct,
        now: () => NOW,
      });
      const buy = await broker.placeMarketOrder({ market: "BTC-EUR", side: "buy", amountQuote: plan.quoteAmount }, px);
      expect(buy.status).toBe("filled");
      const sell = await broker.placeMarketOrder({ market: "BTC-EUR", side: "sell", amount: buy.filledAmount }, ref);
      results.push(sell.status === "filled" ? "ok" : `${sell.error} (atr ${atr}, equity ${equity}, ref ${ref})`);
    }
    return { plan, results };
  }

  it("de posities uit de review (€50, ATR 6,5–14,5%) worden niet meer goedgekeurd", async () => {
    for (const atr of [6.5, 7, 7.5, 8, 10, 12, 14.5]) {
      const { plan } = await sellResultsAtStop(DEFAULT_RISK_CONFIG, 100, atr, 50);
      expect(plan.approved, `atr ${atr}: ${plan.reasons.join("; ")}`).toBe(false);
      expect(plan.quoteAmount).toBe(0);
    }
    // SOL-EUR @ 150, ATR 8% → vroeger "Koop €5,00 (opgehoogd naar minimum)"
    const sol = rm().planEntry(
      decision({ market: "SOL-EUR", price: 150, atr: 12 }),
      account(),
      marketInfo({ market: "SOL-EUR", base: "SOL" }),
      NOW,
    );
    expect(sol.approved).toBe(false);
  });

  it("ook zonder MarketInfo en met een verlaagde instelling (€1): goedgekeurd = te kopen én bij de stop te verkopen", async () => {
    // Standaard PaperBroker (zonder marktinfo): beursminimum €5, net als Bitvavo.
    const c = cfg({ minOrderQuote: 1 });
    let approved = 0;
    for (const equity of [20, 50, 100]) {
      for (let atrPct = 0.5; atrPct <= 20; atrPct += 0.5) {
        const px = 100;
        const plan = new RiskManager(c, "15m").planEntry(
          decision({ price: px, atr: (px * atrPct) / 100 }),
          account({ equity, cashQuote: equity, dayStartEquity: equity }),
          undefined,
          NOW,
        );
        if (!plan.approved) continue;
        approved++;
        expect(plan.quoteAmount).toBeGreaterThanOrEqual(5);
        for (const ref of [plan.stopPrice, plan.stopPrice * 0.975]) {
          const broker = new PaperBroker({ startingQuote: equity, takerFee: c.takerFee, slippagePct: c.slippagePct, now: () => NOW });
          const buy = await broker.placeMarketOrder({ market: "BTC-EUR", side: "buy", amountQuote: plan.quoteAmount }, px);
          expect(buy.status, `atr ${atrPct}%, equity ${equity}: ${buy.error}`).toBe("filled");
          const sell = await broker.placeMarketOrder({ market: "BTC-EUR", side: "sell", amount: buy.filledAmount }, ref);
          expect(sell.status, `atr ${atrPct}%, equity ${equity}, ref ${ref}: ${sell.error}`).toBe("filled");
        }
      }
    }
    expect(approved).toBeGreaterThan(20);
  });

  it("elke goedgekeurde positie is op én iets onder de stop nog te verkopen, met risico ≤ budget", async () => {
    let approved = 0;
    for (const equity of [20, 30, 50, 100, 250]) {
      for (const riskPerTradePct of [0.5, 1, 1.5, 3]) {
        const c = cfg({ riskPerTradePct });
        for (let atrPct = 0.5; atrPct <= 20; atrPct += 0.5) {
          for (const px of [100, 61234.5, 0.01234]) {
            const atr = (px * atrPct) / 100;
            const { plan, results } = await sellResultsAtStop(c, px, atr, equity);
            if (!plan.approved) continue;
            approved++;
            for (const r of results) expect(r).toBe("ok");
            expect(plan.riskQuote).toBeLessThanOrEqual((equity * riskPerTradePct) / 100 + 1e-9);
          }
        }
      }
    }
    expect(approved).toBeGreaterThan(100);
  });
});

// ─────────────────────────────── planEntry: afwijzingen ───────────────────────────────

describe("planEntry — afwijzingen", () => {
  it("geen koopsignaal", () => {
    for (const action of ["sell", "hold"] as const) {
      const plan = rm().planEntry(decision({ action }), account(), marketInfo(), NOW);
      expect(plan.approved).toBe(false);
      expect(plan.quoteAmount).toBe(0);
      expect(plan.reasons).toEqual([`Geen koopsignaal (actie: ${action})`]);
    }
  });

  it("dagelijkse verlieslimiet bereikt", () => {
    const plan = rm().planEntry(decision(), account({ equity: 47, cashQuote: 47 }), marketInfo(), NOW);
    expect(plan.approved).toBe(false);
    expect(plan.reasons.some((x) => x.startsWith("Dagelijkse verlieslimiet bereikt (-6,0%"))).toBe(true);
  });

  it("max trades per dag", () => {
    const plan = rm().planEntry(decision(), account({ tradesToday: 6 }), marketInfo(), NOW);
    expect(plan.approved).toBe(false);
    expect(plan.reasons).toEqual(["Maximum aantal trades per dag bereikt (6/6)"]);
    expect(rm().planEntry(decision(), account({ tradesToday: 5 }), marketInfo(), NOW).approved).toBe(true);
  });

  it("max open posities", () => {
    const open = [
      position({ id: "a", market: "ETH-EUR", costQuote: 5 }),
      position({ id: "b", market: "SOL-EUR", costQuote: 5 }),
    ];
    const plan = rm().planEntry(decision(), account({ openPositions: open, cashQuote: 40 }), marketInfo(), NOW);
    expect(plan.approved).toBe(false);
    expect(plan.reasons).toEqual(["Maximum aantal open posities bereikt (2/2)"]);
  });

  it("al een positie in deze markt", () => {
    const open = [position({ market: "BTC-EUR", costQuote: 10 })];
    const plan = rm().planEntry(decision(), account({ openPositions: open, cashQuote: 40 }), marketInfo(), NOW);
    expect(plan.approved).toBe(false);
    expect(plan.reasons).toEqual(["Er staat al een positie open in BTC-EUR"]);
  });

  it("afkoelperiode na verlies: exact op de grens", () => {
    const r = rm({ cooldownCandlesAfterLoss: 4 }, "15m");
    const cooldownMs = 4 * INTERVAL_MS["15m"];
    // 1 ms te vroeg → afgewezen
    const early = r.planEntry(
      decision(),
      account({ lastLossAt: { "BTC-EUR": NOW - cooldownMs + 1 } }),
      marketInfo(),
      NOW,
    );
    expect(early.approved).toBe(false);
    expect(early.reasons).toHaveLength(1);
    expect(early.reasons[0]).toContain("Afkoelperiode na verlies in BTC-EUR: nog 1 candle");
    // Precies op de grens → toegestaan
    const exact = r.planEntry(decision(), account({ lastLossAt: { "BTC-EUR": NOW - cooldownMs } }), marketInfo(), NOW);
    expect(exact.approved).toBe(true);
    // Verlies net geleden → nog 4 candles
    const fresh = r.planEntry(decision(), account({ lastLossAt: { "BTC-EUR": NOW } }), marketInfo(), NOW);
    expect(fresh.reasons[0]).toContain("nog 4 candles");
    // Verlies in een andere markt telt niet
    const other = r.planEntry(decision(), account({ lastLossAt: { "ETH-EUR": NOW } }), marketInfo(), NOW);
    expect(other.approved).toBe(true);
    // Interval telt mee: 1h → 4 uur
    const hourly = rm({ cooldownCandlesAfterLoss: 4 }, "1h");
    const h = hourly.planEntry(
      decision(),
      account({ lastLossAt: { "BTC-EUR": NOW - 4 * 3_600_000 + 60_000 } }),
      marketInfo(),
      NOW,
    );
    expect(h.approved).toBe(false);
    // Cooldown 0 → uit
    expect(
      rm({ cooldownCandlesAfterLoss: 0 }).planEntry(decision(), account({ lastLossAt: { "BTC-EUR": NOW } }), marketInfo(), NOW)
        .approved,
    ).toBe(true);
  });

  it("ATR ongeldig (NaN, 0, negatief)", () => {
    for (const atr of [Number.NaN, 0, -1, Number.POSITIVE_INFINITY]) {
      const plan = rm().planEntry(decision({ atr }), account(), marketInfo(), NOW);
      expect(plan.approved).toBe(false);
      expect(plan.quoteAmount).toBe(0);
      expect(plan.reasons).toEqual(["ATR onbekend of 0 (te weinig data voor een stop-loss)"]);
    }
  });

  it("markt niet in status trading", () => {
    const plan = rm().planEntry(decision(), account(), marketInfo({ status: "halted" }), NOW);
    expect(plan.approved).toBe(false);
    expect(plan.reasons).toEqual(["Markt BTC-EUR is niet actief (status: halted)"]);
  });

  it("fee-edge: te weinig winstruimte bij een heel kleine ATR", () => {
    // TP-afstand = 2 × 2 × 0,2 = 0,8 → 0,80% < 3 × 0,6% = 1,8%
    const plan = rm().planEntry(decision({ atr: 0.2 }), account(), marketInfo(), NOW);
    expect(plan.approved).toBe(false);
    expect(plan.reasons).toHaveLength(1);
    expect(plan.reasons[0]).toContain("Te weinig winstruimte t.o.v. kosten");
    expect(plan.reasons[0]).toContain("1,80%");
    // Net boven de grens: 4 × atr / 100,05 ≥ 0,018 ↔ atr ≥ 0,450225
    expect(rm().planEntry(decision({ atr: 0.4503 }), account(), marketInfo(), NOW).approved).toBe(true);
    expect(rm().planEntry(decision({ atr: 0.45 }), account(), marketInfo(), NOW).approved).toBe(false);
    // minEdgeFeeMultiple 0 → check uit
    expect(rm({ minEdgeFeeMultiple: 0 }).planEntry(decision({ atr: 0.2 }), account(), marketInfo(), NOW).approved).toBe(
      true,
    );
  });

  it("stop zou ≤ 0 liggen bij een enorme ATR", () => {
    const plan = rm().planEntry(decision({ atr: 60 }), account(), marketInfo(), NOW);
    expect(plan.approved).toBe(false);
    expect(plan.quoteAmount).toBe(0);
    expect(plan.reasons.some((x) => x.startsWith("Stop-loss zou op of onder 0 liggen"))).toBe(true);
  });

  it("meerdere redenen tegelijk", () => {
    const plan = rm().planEntry(
      decision({ action: "hold", atr: Number.NaN }),
      account({
        equity: 40,
        cashQuote: 40,
        tradesToday: 10,
        openPositions: [position({ market: "BTC-EUR" }), position({ id: "2", market: "ETH-EUR" })],
        lastLossAt: { "BTC-EUR": NOW },
      }),
      marketInfo({ status: "auction" }),
      NOW,
    );
    expect(plan.approved).toBe(false);
    expect(plan.quoteAmount).toBe(0);
    const joined = plan.reasons.join(" | ");
    expect(joined).toContain("Geen koopsignaal");
    expect(joined).toContain("Dagelijkse verlieslimiet bereikt");
    expect(joined).toContain("Maximum aantal trades per dag");
    expect(joined).toContain("Maximum aantal open posities");
    expect(joined).toContain("al een positie open in BTC-EUR");
    expect(joined).toContain("Afkoelperiode");
    expect(joined).toContain("niet actief (status: auction)");
    expect(joined).toContain("ATR onbekend");
    expect(plan.reasons).toHaveLength(8);
  });

  it("ongeldige config → nooit kopen", () => {
    const plan = new RiskManager(cfg({ riskPerTradePct: Number.NaN }), "15m").planEntry(
      decision(),
      account(),
      marketInfo(),
      NOW,
    );
    expect(plan.approved).toBe(false);
    expect(plan.quoteAmount).toBe(0);
    expect(plan.reasons[0]).toContain("Ongeldige risico-instellingen");
    expect(plan.reasons[0]).toContain("riskPerTradePct");
  });

  it("onbekend interval → constructor gooit", () => {
    expect(() => new RiskManager(cfg(), "3m" as never)).toThrow(/Onbekend interval/);
  });

  it("muteert de invoer niet", () => {
    const acc = account({ openPositions: [position({ market: "ETH-EUR", costQuote: 10 })] });
    const dec = decision();
    const before = JSON.stringify({ acc, dec });
    rm().planEntry(dec, acc, marketInfo(), NOW);
    expect(JSON.stringify({ acc, dec })).toBe(before);
  });
});

// ─────────────────────────────── updatePosition ───────────────────────────────

describe("updatePosition", () => {
  // entry 100, stop 96 (R = 4), TP 108, break-even-niveau = 100 × 1,006 = 100,6

  it("stop-loss geraakt → exit op de stop", () => {
    const u = rm().updatePosition(position(), candle(99, 99.5, 95, 97), 1, true);
    expect(u).toMatchObject({ exit: true, exitReason: "stop-loss", exitPrice: 96, stopPrice: 96 });
  });

  it("stop precies aangeraakt (low == stop) → exit", () => {
    const u = rm().updatePosition(position(), candle(98, 98, 96, 97), 1, false);
    expect(u.exit).toBe(true);
    expect(u.exitPrice).toBe(96);
  });

  it("gap down onder de stop → exit op de open", () => {
    const u = rm().updatePosition(position(), candle(94, 95, 93, 94.5), 1, true);
    expect(u).toMatchObject({ exit: true, exitReason: "stop-loss", exitPrice: 94 });
  });

  it("take-profit geraakt → exit op de take-profit", () => {
    const u = rm().updatePosition(position(), candle(105, 109, 104, 106), 1, true);
    expect(u).toMatchObject({ exit: true, exitReason: "take-profit", exitPrice: 108, highestPrice: 109 });
  });

  it("gap up boven de take-profit → exit op de open", () => {
    const u = rm().updatePosition(position(), candle(110, 111, 109, 110.5), 1, true);
    expect(u).toMatchObject({ exit: true, exitReason: "take-profit", exitPrice: 110 });
  });

  it("stop en take-profit in dezelfde candle → stop wint", () => {
    const u = rm().updatePosition(position(), candle(100, 109, 95, 104), 1, true);
    expect(u).toMatchObject({ exit: true, exitReason: "stop-loss", exitPrice: 96 });
  });

  it("geen exit binnen de range; highest wordt bijgewerkt", () => {
    const u = rm().updatePosition(position(), candle(100, 101.5, 99, 101), 1, true);
    expect(u).toEqual({ exit: false, stopPrice: 96, highestPrice: 101.5 });
  });

  it("break-even: stop naar entry × (1 + kosten) vanaf breakEvenAtR × R", () => {
    const r = rm({ trailingAtrMult: 0 });
    // high 103,9 < 104 (= entry + 1R) → nog niet
    const below = r.updatePosition(position(), candle(101, 103.9, 100.5, 103), 1, true);
    expect(below.exit).toBe(false);
    expect(below.stopPrice).toBe(96);
    // high 104 op een gesloten candle → break-even
    const at = r.updatePosition(position(), candle(101, 104, 101, 103), 1, true);
    expect(at.exit).toBe(false);
    expect(at.stopPrice).toBeCloseTo(100.6, 10);
    expect(at.highestPrice).toBe(104);
    // Op een niet-gesloten candle (tick) nog niet: alleen highestPrice loopt op
    const tick = r.updatePosition(position(), candle(101, 104, 101, 103), 1, false);
    expect(tick.exit).toBe(false);
    expect(tick.stopPrice).toBe(96);
    expect(tick.highestPrice).toBe(104);
    // breakEvenAtR 0 → uit
    const off = rm({ trailingAtrMult: 0, breakEvenAtR: 0 }).updatePosition(position(), candle(101, 106, 101, 105), 1, true);
    expect(off.stopPrice).toBe(96);
  });

  it("break-even gebruikt highestPrice uit eerdere candles", () => {
    const r = rm({ trailingAtrMult: 0 });
    const u = r.updatePosition(position({ highestPrice: 104.5 }), candle(102, 102.5, 101.5, 102), 1, true);
    expect(u.stopPrice).toBeCloseTo(100.6, 10);
    expect(u.highestPrice).toBe(104.5);
  });

  it("break-even die tussen candles bereikt wordt, geldt niet met terugwerkende kracht voor die candle", () => {
    // Engine-volgorde: ticks (closedCandle=false) tijdens de candle, daarna de
    // gesloten candle (true) tegen de stop die dan geldt. Entry 100, stop 98
    // (R = 2), break-even-niveau 100,6. De candle dipt eerst naar 100,2, loopt dan
    // op naar 102,6 (+1,3R) en sluit op 101,8: de koers kwam na de stijging nooit
    // meer op of onder 100,6, dus geen exit.
    const r = rm({ trailingAtrMult: 0 });
    const pos = position({ stopPrice: 98, initialStopPrice: 98, takeProfitPrice: 104, highestPrice: 100 });
    for (const px of [100, 100.2, 101.5, 102.6, 102.1, 101.8]) {
      const u = r.updatePosition({ ...pos }, candle(px, px, px, px), 1, false);
      expect(u.exit).toBe(false);
      pos.stopPrice = Math.max(pos.stopPrice, u.stopPrice);
      pos.highestPrice = Math.max(pos.highestPrice, u.highestPrice);
    }
    expect(pos.stopPrice).toBe(98); // ticks verhogen de stop niet
    expect(pos.highestPrice).toBe(102.6);

    const closed = r.updatePosition({ ...pos }, candle(100, 102.6, 100.2, 101.8), 1, true);
    expect(closed.exit).toBe(false);
    // Pas na de slotkoers gaat de stop naar break-even, voor de volgende candles
    expect(closed.stopPrice).toBeCloseTo(100.6, 10);

    // Zelfde uitkomst als de backtester, die per gesloten candle rekent
    const bt = r.updatePosition(
      position({ stopPrice: 98, initialStopPrice: 98, takeProfitPrice: 104, highestPrice: 100 }),
      candle(100, 102.6, 100.2, 101.8),
      1,
      true,
    );
    expect(bt).toEqual(closed);
  });

  it("break-even-stop komt nooit boven de slotkoers (kleine breakEvenAtR)", () => {
    // Entry 100,05, R 0,5 → trigger bij 1R = 100,55; break-even-niveau 100,05 × 1,006 = 100,6503.
    const r = rm({ trailingAtrMult: 0 });
    const pos = position({
      entryPrice: 100.05,
      stopPrice: 99.55,
      initialStopPrice: 99.55,
      takeProfitPrice: 101.05,
      highestPrice: 100.05,
    });
    // High 100,56 ≥ trigger, maar slot 100,53 < 100,6503 → stop blijft staan
    const first = r.updatePosition(pos, candle(100.1, 100.56, 100.0, 100.53), 1, true);
    expect(first.exit).toBe(false);
    expect(first.stopPrice).toBe(99.55);
    expect(first.highestPrice).toBe(100.56);
    // Volgende candle sluit boven het break-even-niveau → nu wel verhogen
    const next = r.updatePosition(
      { ...pos, highestPrice: first.highestPrice },
      candle(100.53, 100.85, 100.4, 100.8),
      1,
      true,
    );
    expect(next.exit).toBe(false);
    expect(next.stopPrice).toBeCloseTo(100.05 * 1.006, 10);
    expect(next.stopPrice).toBeLessThan(100.8);

    // breakEvenAtR 0,5 (vroeger: stop 100,6503 terwijl de high 100,52 was → exit met verlies)
    const half = rm({ trailingAtrMult: 0, breakEvenAtR: 0.5 }).updatePosition(
      position({ entryPrice: 100, stopPrice: 99, initialStopPrice: 99, takeProfitPrice: 102, highestPrice: 100 }),
      candle(100.1, 100.52, 100.05, 100.49),
      1,
      true,
    );
    expect(half.exit).toBe(false);
    expect(half.stopPrice).toBe(99);
  });

  it("na een niet-exit ligt een verhoogde stop altijd onder de slotkoers", () => {
    for (const breakEvenAtR of [0.1, 0.25, 0.5, 1, 2]) {
      const r = rm({ trailingAtrMult: 0, breakEvenAtR });
      for (let close = 100; close <= 104; close += 0.05) {
        const high = close + 0.3;
        const u = r.updatePosition(position(), candle(100, high, 99.9, close), 1, true);
        if (u.exit) continue;
        if (u.stopPrice > 96) expect(u.stopPrice).toBeLessThan(close);
      }
    }
  });

  it("trailing pas na 1R winst", () => {
    const r = rm({ breakEvenAtR: 0 });
    // high 103 < 104 → geen trailing
    const before = r.updatePosition(position(), candle(101, 103, 100.5, 102.5), 1, true);
    expect(before.stopPrice).toBe(96);
    // high 106 ≥ 104 → stop = 106 − 2,5 × 1 = 103,5
    const after = r.updatePosition(position(), candle(102, 106, 101, 105), 1, true);
    expect(after.exit).toBe(false);
    expect(after.stopPrice).toBeCloseTo(103.5, 10);
    expect(after.highestPrice).toBe(106);
  });

  it("trailing alleen op gesloten candles", () => {
    const r = rm({ breakEvenAtR: 0 });
    const open = r.updatePosition(position(), candle(106, 106, 106, 106), 1, false);
    expect(open.exit).toBe(false);
    expect(open.stopPrice).toBe(96);
    expect(open.highestPrice).toBe(106);
    // Ongeldige ATR → geen trailing
    const nanAtr = r.updatePosition(position(), candle(102, 106, 101, 105), Number.NaN, true);
    expect(nanAtr.stopPrice).toBe(96);
  });

  it("break-even + trailing: de hoogste van de twee wint", () => {
    const u = rm().updatePosition(position(), candle(101, 104, 101, 103.5), 1, true);
    // BE 100,6; trailing 104 − 2,5 = 101,5
    expect(u.stopPrice).toBeCloseTo(101.5, 10);
    const wide = rm().updatePosition(position(), candle(101, 104, 101, 103.5), 3, true);
    // trailing 104 − 7,5 = 96,5 < BE 100,6
    expect(wide.stopPrice).toBeCloseTo(100.6, 10);
  });

  it("stops dalen nooit", () => {
    const pos = position({ stopPrice: 103.5, highestPrice: 106 });
    const u = rm().updatePosition(pos, candle(105, 106.5, 104, 105), 2, true);
    // trailing zou 106,5 − 5 = 101,5 zijn → blijft 103,5
    expect(u.exit).toBe(false);
    expect(u.stopPrice).toBe(103.5);
    expect(u.highestPrice).toBe(106.5);
  });

  it("exit-reden: break-even vs trailing-stop", () => {
    const be = rm().updatePosition(position({ stopPrice: 100.6, highestPrice: 104 }), candle(101, 101, 100, 100.2), 1, true);
    expect(be).toMatchObject({ exit: true, exitReason: "break-even" });
    expect(be.exitPrice).toBeCloseTo(100.6, 10);

    const trail = rm().updatePosition(
      position({ stopPrice: 103.5, highestPrice: 106 }),
      candle(103, 103.2, 102, 102.5),
      1,
      true,
    );
    // gap onder de trailing stop → exit op de open (103)
    expect(trail).toMatchObject({ exit: true, exitReason: "trailing-stop", exitPrice: 103 });

    // trailing stop tussen initiële stop en break-even → ook trailing-stop
    const low = rm().updatePosition(position({ stopPrice: 98, highestPrice: 104 }), candle(99, 99, 97, 98), 1, true);
    expect(low).toMatchObject({ exit: true, exitReason: "trailing-stop", exitPrice: 98 });
  });

  it("time-stop: na timeStopCandles gesloten candles zonder winst", () => {
    const r = rm({ timeStopCandles: 48 });
    const pos = position({ candlesHeld: 48 });
    const u = r.updatePosition(pos, candle(100, 100.8, 99.5, 100.5), 1, true);
    expect(u).toMatchObject({ exit: true, exitReason: "time-stop", exitPrice: 100.5 });
    // precies op het kosten-niveau (100,6) → nog steeds time-stop
    expect(r.updatePosition(pos, candle(100, 100.8, 99.5, 100.6), 1, true).exit).toBe(true);
    // in de winst (boven entry + kosten) → geen time-stop
    expect(r.updatePosition(pos, candle(100, 101.2, 99.5, 101), 1, true).exit).toBe(false);
    // te vroeg
    expect(r.updatePosition(position({ candlesHeld: 47 }), candle(100, 100.8, 99.5, 100.5), 1, true).exit).toBe(false);
    // niet-gesloten candle → geen time-stop
    expect(r.updatePosition(pos, candle(100, 100.8, 99.5, 100.5), 1, false).exit).toBe(false);
    // timeStopCandles 0 → uit
    expect(
      rm({ timeStopCandles: 0 }).updatePosition(position({ candlesHeld: 5000 }), candle(100, 100.8, 99.5, 100.5), 1, true)
        .exit,
    ).toBe(false);
  });

  it("stop gaat vóór time-stop", () => {
    const u = rm().updatePosition(position({ candlesHeld: 100 }), candle(97, 97, 95, 96.5), 1, true);
    expect(u.exitReason).toBe("stop-loss");
  });

  it("muteert de positie niet", () => {
    const pos = Object.freeze(position({ highestPrice: 100 }));
    const snapshot = JSON.stringify(pos);
    const u = rm().updatePosition(pos, candle(102, 106, 101, 105), 1, true);
    expect(u.stopPrice).toBeGreaterThan(96);
    rm().updatePosition(pos, candle(99, 99, 90, 91), 1, true);
    rm().updatePosition(pos, candle(105, 110, 104, 109), 1, true);
    expect(JSON.stringify(pos)).toBe(snapshot);
  });

  it("is deterministisch", () => {
    const a = rm().updatePosition(position(), candle(102, 106, 101, 105), 1.3, true);
    const b = rm().updatePosition(position(), candle(102, 106, 101, 105), 1.3, true);
    expect(a).toEqual(b);
  });
});

// ─────────────────────────────── shouldExitOnSignal ───────────────────────────────

describe("shouldExitOnSignal", () => {
  it("alleen bij een sell in dezelfde markt", () => {
    const r = rm();
    expect(r.shouldExitOnSignal(position(), decision({ action: "sell" }))).toBe(true);
    expect(r.shouldExitOnSignal(position(), decision({ action: "hold" }))).toBe(false);
    expect(r.shouldExitOnSignal(position(), decision({ action: "buy" }))).toBe(false);
    expect(r.shouldExitOnSignal(position(), decision({ action: "sell", market: "ETH-EUR" }))).toBe(false);
  });
});

// ─────────────────────────────── haltStatus ───────────────────────────────

describe("haltStatus", () => {
  it("grens van de dagelijkse verlieslimiet", () => {
    const r = rm({ dailyLossLimitPct: 5 });
    const at = r.haltStatus(account({ equity: 47.5, dayStartEquity: 50 }));
    expect(at.halted).toBe(true);
    expect(at.dailyLimit).toBe(true);
    expect(at.reason).toContain("Dagelijkse verlieslimiet bereikt (-5,0%");
    expect(r.haltStatus(account({ equity: 47.51, dayStartEquity: 50 }))).toEqual({ halted: false });
    const below = r.haltStatus(account({ equity: 46.9, dayStartEquity: 50 }));
    expect(below.halted).toBe(true);
    expect(below.dailyLimit).toBe(true);
    expect(below.reason).toContain("(-6,2%");
    expect(r.haltStatus(account({ equity: 55, dayStartEquity: 50 })).halted).toBe(false);
  });

  it("equity ≤ 0 of ongeldig → gestopt", () => {
    const r = rm();
    expect(r.haltStatus(account({ equity: 0, dayStartEquity: 0 })).halted).toBe(true);
    expect(r.haltStatus(account({ equity: -1 })).halted).toBe(true);
    expect(r.haltStatus(account({ equity: Number.NaN })).halted).toBe(true);
    // Dit is niet de dagelijkse verlieslimiet (die geldt de hele dag; deze stops niet per se).
    expect(r.haltStatus(account({ equity: 0, dayStartEquity: 0 })).dailyLimit).toBeUndefined();
    expect(r.haltStatus(account({ equity: Number.NaN })).dailyLimit).toBeUndefined();
  });

  it("dailyLimit: true bij de dagelijkse verlieslimiet; planEntry neemt de reden over", () => {
    const r = rm({ dailyLossLimitPct: 5 });
    expect(r.haltStatus(account({ equity: 40, dayStartEquity: 50 }))).toEqual({
      halted: true,
      reason: "Dagelijkse verlieslimiet bereikt (-20,0%, limiet -5,0%)",
      dailyLimit: true,
    });
    // planEntry neemt de reden over
    const plan = r.planEntry(decision(), account({ equity: 40, cashQuote: 40, dayStartEquity: 50 }), marketInfo(), NOW);
    expect(plan.approved).toBe(false);
    expect(plan.reasons).toContain("Dagelijkse verlieslimiet bereikt (-20,0%, limiet -5,0%)");
  });

  it("dayStartEquity 0 → alleen de equity-check", () => {
    expect(rm().haltStatus(account({ equity: 10, dayStartEquity: 0 })).halted).toBe(false);
  });
});

// ─────────────────────────────── validateRiskConfig ───────────────────────────────

describe("validateRiskConfig", () => {
  it("accepteert de defaults en een lege partial", () => {
    expect(validateRiskConfig(DEFAULT_RISK_CONFIG)).toEqual({ ok: true, errors: [] });
    expect(validateRiskConfig({})).toEqual({ ok: true, errors: [] });
    expect(validateRiskConfig({ trailingAtrMult: 0, breakEvenAtR: 0, timeStopCandles: 0, minOrderQuote: 0 }).ok).toBe(true);
    expect(validateRiskConfig({ riskPerTradePct: 0.1, maxPositionPct: 100, maxOpenPositions: 10 }).ok).toBe(true);
  });

  it("wijst waarden buiten de grenzen af met het veld in de melding", () => {
    const res = validateRiskConfig({ riskPerTradePct: 15 });
    expect(res.ok).toBe(false);
    expect(res.errors).toHaveLength(1);
    expect(res.errors[0]).toContain("riskPerTradePct");
    expect(res.errors[0]).toContain("tussen 0,1 en 10");

    expect(validateRiskConfig({ maxPositionPct: 0.5 }).ok).toBe(false);
    expect(validateRiskConfig({ stopAtrMult: 0.4 }).ok).toBe(false);
    expect(validateRiskConfig({ takeProfitR: 11 }).ok).toBe(false);
    expect(validateRiskConfig({ breakEvenAtR: 6 }).ok).toBe(false);
    expect(validateRiskConfig({ dailyLossLimitPct: 0.1 }).ok).toBe(false);
    expect(validateRiskConfig({ maxTradesPerDay: 0 }).ok).toBe(false);
    expect(validateRiskConfig({ cooldownCandlesAfterLoss: 501 }).ok).toBe(false);
    expect(validateRiskConfig({ minEdgeFeeMultiple: 21 }).ok).toBe(false);
    expect(validateRiskConfig({ takerFee: 0.02 }).ok).toBe(false);
    expect(validateRiskConfig({ makerFee: -0.001 }).ok).toBe(false);
    expect(validateRiskConfig({ slippagePct: 0.05 }).ok).toBe(false);
    expect(validateRiskConfig({ minOrderQuote: -1 }).ok).toBe(false);
    expect(validateRiskConfig({ timeStopCandles: 10001 }).ok).toBe(false);
    expect(validateRiskConfig({ maxTotalExposurePct: 150 }).ok).toBe(false);
  });

  it("trailingAtrMult: 0 (uit) of 0,5–10", () => {
    expect(validateRiskConfig({ trailingAtrMult: 0 }).ok).toBe(true);
    expect(validateRiskConfig({ trailingAtrMult: 0.5 }).ok).toBe(true);
    const bad = validateRiskConfig({ trailingAtrMult: 0.2 });
    expect(bad.ok).toBe(false);
    expect(bad.errors[0]).toContain("trailingAtrMult");
    expect(bad.errors[0]).toContain("0 (uit)");
  });

  it("gehele getallen waar nodig", () => {
    const res = validateRiskConfig({ maxOpenPositions: 2.5 });
    expect(res.ok).toBe(false);
    expect(res.errors[0]).toContain("maxOpenPositions");
    expect(res.errors[0]).toContain("geheel getal");
    expect(validateRiskConfig({ maxTradesPerDay: 3.3 }).ok).toBe(false);
    expect(validateRiskConfig({ timeStopCandles: 1.5 }).ok).toBe(false);
  });

  it("geen getal / niet-eindig / onbekende key", () => {
    const res = validateRiskConfig({
      takerFee: Number.NaN,
      slippagePct: "0.001" as unknown as number,
      riskPerTradePct: Number.POSITIVE_INFINITY,
      foo: 1,
    } as Partial<RiskConfig>);
    expect(res.ok).toBe(false);
    expect(res.errors).toHaveLength(4);
    expect(res.errors.some((e) => e.includes("takerFee") && e.includes("geldig getal"))).toBe(true);
    expect(res.errors.some((e) => e.includes("slippagePct"))).toBe(true);
    expect(res.errors.some((e) => e.includes("riskPerTradePct"))).toBe(true);
    expect(res.errors).toContain("Onbekende risico-instelling: foo");
    expect(validateRiskConfig({ riskPerTradePct: undefined }).ok).toBe(false);
  });

  it("geen object", () => {
    expect(validateRiskConfig(null as unknown as Partial<RiskConfig>).ok).toBe(false);
    expect(validateRiskConfig([] as unknown as Partial<RiskConfig>).ok).toBe(false);
  });
});

// ─────────────────────────────── v2: maxSpreadPct ───────────────────────────────

describe("validateRiskConfig — maxSpreadPct (v2)", () => {
  it("0 (uit) tot en met 5 procent is geldig", () => {
    for (const v of [0, 0.05, 0.3, 1, 5]) expect(validateRiskConfig({ maxSpreadPct: v }).ok).toBe(true);
  });

  it("buiten 0..5 of geen getal → Nederlandse fout met het veld", () => {
    for (const v of [-0.01, 5.01, 50, Number.NaN, Number.POSITIVE_INFINITY]) {
      const res = validateRiskConfig({ maxSpreadPct: v });
      expect(res.ok).toBe(false);
      expect(res.errors[0]).toContain("Max. spread (%) (maxSpreadPct)");
    }
    expect(validateRiskConfig({ maxSpreadPct: 6 }).errors[0]).toContain("tussen 0 en 5");
    expect(validateRiskConfig({ maxSpreadPct: "0.3" as unknown as number }).ok).toBe(false);
  });

  it("optioneel: ontbreken (of undefined) is geldig, verplichte velden niet", () => {
    const { maxSpreadPct: _omit, ...withoutSpread } = DEFAULT_RISK_CONFIG;
    expect(validateRiskConfig(withoutSpread)).toEqual({ ok: true, errors: [] });
    expect(validateRiskConfig({ maxSpreadPct: undefined }).ok).toBe(true);
    expect(validateRiskConfig({ riskPerTradePct: undefined }).ok).toBe(false);
  });

  it("planEntry keurt goed met een config zonder maxSpreadPct (geen spreadlimiet)", () => {
    const { maxSpreadPct: _omit, ...withoutSpread } = DEFAULT_RISK_CONFIG;
    const plan = new RiskManager(withoutSpread as RiskConfig, "15m").planEntry(decision(), account(), marketInfo(), NOW);
    expect(plan.approved).toBe(true);
    expect(plan.reasons.join(" ")).not.toMatch(/Ongeldige risico-instellingen/);
  });

  it("planEntry weigert met een ongeldige maxSpreadPct in de config", () => {
    const plan = rm({ maxSpreadPct: 9 }).planEntry(decision(), account(), marketInfo(), NOW);
    expect(plan.approved).toBe(false);
    expect(plan.reasons.join(" ")).toMatch(/Ongeldige risico-instellingen: .*maxSpreadPct/);
  });
});
