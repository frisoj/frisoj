import { describe, expect, it } from "vitest";
import { PaperBroker } from "../../src/broker/paperBroker";
import { EXCHANGE_MIN_ORDER_QUOTE } from "../../src/core/defaults";
import type { Balance, MarketInfo, OrderResult } from "../../src/core/types";

const NOW = Date.UTC(2026, 8, 28, 12, 0, 0);
const FEE = 0.0025;
const SLIP = 0.0005;

function broker(startingQuote = 100): PaperBroker {
  return new PaperBroker({ startingQuote, takerFee: FEE, slippagePct: SLIP, now: () => NOW });
}

async function bal(b: PaperBroker, symbol: string): Promise<number> {
  return (await b.getBalances()).find((x) => x.symbol === symbol)?.available ?? 0;
}

function expectRejected(res: OrderResult, pattern: RegExp): void {
  expect(res.status).toBe("rejected");
  expect(res.error).toMatch(pattern);
  expect(res.filledAmount).toBe(0);
  expect(res.filledQuote).toBe(0);
  expect(res.feeQuote).toBe(0);
  expect(res.orderId).toMatch(/^paper_/);
}

describe("PaperBroker", () => {
  it("heeft mode paper en start met alleen EUR", async () => {
    const b = broker(50);
    expect(b.mode).toBe("paper");
    expect(await b.getBalances()).toEqual([{ symbol: "EUR", available: 50, inOrder: 0 }]);
  });

  it("koop: fee = Q − Q/(1+fee), vulprijs = ref×(1+slip), amount = (Q−fee)/vulprijs", async () => {
    const b = broker(100);
    const Q = 40;
    const ref = 91_234.5;
    const res = await b.placeMarketOrder({ market: "BTC-EUR", side: "buy", amountQuote: Q, clientOrderId: "c1" }, ref);
    const fee = Q - Q / (1 + FEE);
    const fill = ref * (1 + SLIP);
    const amount = (Q - fee) / fill;
    expect(res.status).toBe("filled");
    expect(res.error).toBeUndefined();
    expect(res.orderId).toMatch(/^paper_/);
    expect(res.clientOrderId).toBe("c1");
    expect(res.market).toBe("BTC-EUR");
    expect(res.side).toBe("buy");
    expect(res.timestamp).toBe(NOW);
    expect(Math.abs(res.feeQuote - fee)).toBeLessThan(1e-9);
    expect(Math.abs(res.avgPrice - fill)).toBeLessThan(1e-9);
    expect(Math.abs(res.filledAmount - amount)).toBeLessThan(1e-9);
    expect(Math.abs(res.filledQuote - res.filledAmount * res.avgPrice)).toBeLessThan(1e-9);
    // bruto + fee = totaal uitgegeven
    expect(Math.abs(res.filledQuote + res.feeQuote - Q)).toBeLessThan(1e-9);
    expect(Math.abs((await bal(b, "EUR")) - 60)).toBeLessThan(1e-9);
    expect(Math.abs((await bal(b, "BTC")) - amount)).toBeLessThan(1e-9);
  });

  it("verkoop: vulprijs = ref×(1−slip), fee = bruto×fee", async () => {
    const b = broker(100);
    const buy = await b.placeMarketOrder({ market: "ETH-EUR", side: "buy", amountQuote: 50 }, 3500);
    const amount = buy.filledAmount;
    const ref = 3600;
    const res = await b.placeMarketOrder({ market: "ETH-EUR", side: "sell", amount }, ref);
    const fill = ref * (1 - SLIP);
    const gross = amount * fill;
    const fee = gross * FEE;
    expect(res.status).toBe("filled");
    expect(res.side).toBe("sell");
    expect(Math.abs(res.avgPrice - fill)).toBeLessThan(1e-9);
    expect(Math.abs(res.filledAmount - amount)).toBeLessThan(1e-12);
    expect(Math.abs(res.filledQuote - gross)).toBeLessThan(1e-9);
    expect(Math.abs(res.feeQuote - fee)).toBeLessThan(1e-9);
    expect(Math.abs((await bal(b, "EUR")) - (50 + gross - fee))).toBeLessThan(1e-9);
    // alles verkocht: geen ETH-regel meer
    expect((await b.getBalances()).map((x) => x.symbol)).toEqual(["EUR"]);
  });

  it("een round-trip zonder koersverandering kost precies fees + slippage", async () => {
    const b = broker(100);
    const buy = await b.placeMarketOrder({ market: "SOL-EUR", side: "buy", amountQuote: 100 }, 200);
    await b.placeMarketOrder({ market: "SOL-EUR", side: "sell", amount: buy.filledAmount }, 200);
    const expected = (100 / (1 + FEE) / (200 * (1 + SLIP))) * 200 * (1 - SLIP) * (1 - FEE);
    expect(Math.abs((await bal(b, "EUR")) - expected)).toBeLessThan(1e-9);
    expect(await bal(b, "EUR")).toBeLessThan(100);
  });

  it("wijst af (zonder te gooien) met Nederlandse fouten", async () => {
    const b = broker(20);
    expectRejected(await b.placeMarketOrder({ market: "BTC-EUR", side: "buy", amountQuote: 4.99 }, 90000), /minimum/);
    expectRejected(await b.placeMarketOrder({ market: "BTC-EUR", side: "buy", amountQuote: 25 }, 90000), /Onvoldoende EUR/);
    expectRejected(await b.placeMarketOrder({ market: "BTC-EUR", side: "buy" }, 90000), /zonder bedrag/);
    expectRejected(
      await b.placeMarketOrder({ market: "BTC-EUR", side: "buy", amountQuote: Number.NaN }, 90000),
      /Ongeldig bedrag/,
    );
    expectRejected(await b.placeMarketOrder({ market: "BTC-EUR", side: "buy", amountQuote: -10 }, 90000), /Ongeldig bedrag/);
    expectRejected(await b.placeMarketOrder({ market: "BTC-EUR", side: "sell", amount: 0.001 }, 90000), /Onvoldoende BTC/);
    expectRejected(await b.placeMarketOrder({ market: "BTC-EUR", side: "sell" }, 90000), /zonder hoeveelheid/);
    expectRejected(await b.placeMarketOrder({ market: "BTC-EUR", side: "sell", amount: 0 }, 90000), /Ongeldige hoeveelheid/);
    expectRejected(await b.placeMarketOrder({ market: "BTC-EUR", side: "buy", amountQuote: 10 }, 0), /referentiekoers/);
    expectRejected(await b.placeMarketOrder({ market: "BTC-EUR", side: "buy", amountQuote: 10 }, Number.NaN), /referentiekoers/);
    expectRejected(await b.placeMarketOrder({ market: "BTCEUR", side: "buy", amountQuote: 10 }, 100), /Ongeldige markt/);
    expectRejected(await b.placeMarketOrder({ market: "BTC-USDT", side: "buy", amountQuote: 10 }, 100), /alleen EUR/);
    // saldi ongewijzigd
    expect(await b.getBalances()).toEqual([{ symbol: "EUR", available: 20, inOrder: 0 }]);
  });

  it("wijst een verkoop onder €5 orderwaarde af", async () => {
    const b = broker(20);
    const buy = await b.placeMarketOrder({ market: "ADA-EUR", side: "buy", amountQuote: 10 }, 1);
    expect(buy.status).toBe("filled");
    const res = await b.placeMarketOrder({ market: "ADA-EUR", side: "sell", amount: buy.filledAmount / 3 }, 1);
    expectRejected(res, /minimum/);
    // Zelfde voorvoegsel als de LiveBroker: de engine herkent een onverkoopbare positie.
    expect(res.error?.startsWith("ONVERKOOPBAAR:")).toBe(true);
    expect(await bal(b, "ADA")).toBe(buy.filledAmount);
  });

  it("setCosts (Broker-contract): past fee/slippage aan, negeert ongeldige waarden, laat het beursminimum ongemoeid", async () => {
    const b = broker(100);
    b.setCosts(0.001, 0.002);
    const buy = await b.placeMarketOrder({ market: "BTC-EUR", side: "buy", amountQuote: 20 }, 50_000);
    expect(buy.feeQuote).toBeCloseTo(20 - 20 / 1.001, 12);
    expect(buy.avgPrice).toBeCloseTo(50_000 * 1.002, 9);

    // Ongeldig → vorige waarden blijven gelden.
    b.setCosts(Number.NaN, -0.01);
    b.setCosts(0.5, Number.POSITIVE_INFINITY);
    const buy2 = await b.placeMarketOrder({ market: "BTC-EUR", side: "buy", amountQuote: 20 }, 50_000);
    expect(buy2.feeQuote).toBeCloseTo(buy.feeQuote, 12);
    expect(buy2.avgPrice).toBeCloseTo(buy.avgPrice, 9);

    // Het minimum is het beursminimum (€5), ook na setCosts.
    expectRejected(await b.placeMarketOrder({ market: "BTC-EUR", side: "buy", amountQuote: 4.99 }, 50_000), /minimum van €5,00/);
    expect((await b.placeMarketOrder({ market: "BTC-EUR", side: "buy", amountQuote: 5 }, 50_000)).status).toBe("filled");
  });

  it("gebruikt het beursminimum per markt als er marktinfo is (nooit de risico-instelling)", async () => {
    const info = (market: string): MarketInfo | undefined =>
      market === "ETH-EUR"
        ? {
            market,
            base: "ETH",
            quote: "EUR",
            status: "trading",
            minOrderQuote: 10,
            minOrderBase: 0.004,
            pricePrecision: 5,
            quantityDecimals: 4,
            notionalDecimals: 2,
          }
        : market === "XRP-EUR"
          ? { ...(info("ETH-EUR") as MarketInfo), market, base: "XRP", minOrderQuote: 0, minOrderBase: 0 }
          : undefined;
    const b = new PaperBroker({ startingQuote: 100, takerFee: FEE, slippagePct: SLIP, now: () => NOW, getMarketInfo: async (m) => info(m) });
    // ETH: minimum €10
    expectRejected(await b.placeMarketOrder({ market: "ETH-EUR", side: "buy", amountQuote: 8 }, 3000), /minimum van €10,00/);
    const buy = await b.placeMarketOrder({ market: "ETH-EUR", side: "buy", amountQuote: 30 }, 3000);
    expect(buy.status).toBe("filled");
    // Verkoop onder het minimum in base (0,003 ETH ≈ €9 < €10 én < 0,004 ETH)
    const small = await b.placeMarketOrder({ market: "ETH-EUR", side: "sell", amount: 0.003 }, 3000);
    expectRejected(small, /beursminimum/);
    expect(small.error?.startsWith("ONVERKOOPBAAR:")).toBe(true);
    const lowBase = await b.placeMarketOrder({ market: "ETH-EUR", side: "sell", amount: 0.0035 }, 4000); // €14 maar < 0,004 ETH
    expectRejected(lowBase, /0\.004 ETH/);
    expect(lowBase.error?.startsWith("ONVERKOOPBAAR:")).toBe(true);
    // Markt zonder (bruikbaar) minimum in de info, of zonder info: standaard €5
    expectRejected(await b.placeMarketOrder({ market: "XRP-EUR", side: "buy", amountQuote: 4 }, 2), /minimum van €5,00/);
    expectRejected(await b.placeMarketOrder({ market: "SOL-EUR", side: "buy", amountQuote: 4 }, 150), /minimum van €5,00/);
    expect((await b.placeMarketOrder({ market: "SOL-EUR", side: "buy", amountQuote: 5 }, 150)).status).toBe("filled");

    // Marktinfo niet op te halen: standaard beursminimum, geen crash.
    const failing = new PaperBroker({
      startingQuote: 50,
      takerFee: FEE,
      slippagePct: SLIP,
      now: () => NOW,
      getMarketInfo: () => {
        throw new Error("offline");
      },
    });
    expect((await failing.placeMarketOrder({ market: "BTC-EUR", side: "buy", amountQuote: 5 }, 50_000)).status).toBe("filled");
    expectRejected(await failing.placeMarketOrder({ market: "BTC-EUR", side: "buy", amountQuote: 4.5 }, 50_000), /minimum van €5,00/);
  });

  it("een ontbrekend/ongeldig/≤ 0 minimum is ONBEKEND → €5 (EXCHANGE_MIN_ORDER_QUOTE), ook voor verkopen", async () => {
    expect(EXCHANGE_MIN_ORDER_QUOTE).toBe(5);
    const base: MarketInfo = {
      market: "XRP-EUR",
      base: "XRP",
      quote: "EUR",
      status: "trading",
      minOrderQuote: 5,
      minOrderBase: 0,
      pricePrecision: 5,
      quantityDecimals: 6,
      notionalDecimals: 2,
    };
    const bad: Array<number | undefined> = [0, -1, Number.NaN, Number.POSITIVE_INFINITY, undefined];
    for (const minOrderQuote of bad) {
      const info = { ...base, minOrderQuote } as MarketInfo;
      const b = new PaperBroker({ startingQuote: 100, takerFee: FEE, slippagePct: SLIP, now: () => NOW, getMarketInfo: () => info });
      expectRejected(await b.placeMarketOrder({ market: "XRP-EUR", side: "buy", amountQuote: 4 }, 2), /minimum van €5,00/);
      expect((await b.placeMarketOrder({ market: "XRP-EUR", side: "buy", amountQuote: 20 }, 2)).status).toBe("filled");
      // Verkoop van ~€4: geweigerd als onverkoopbaar (geen "geen minimum").
      const sell = await b.placeMarketOrder({ market: "XRP-EUR", side: "sell", amount: 2 }, 2);
      expectRejected(sell, /beursminimum van €5,00/);
      expect(sell.error?.startsWith("ONVERKOOPBAAR:")).toBe(true);
    }
    // Zelfde regel voor de constructor-optie: 0 / negatief / NaN schakelt het minimum niet uit.
    for (const minOrderQuote of [0, -5, Number.NaN]) {
      const b = new PaperBroker({ startingQuote: 100, takerFee: FEE, slippagePct: SLIP, now: () => NOW, minOrderQuote });
      expectRejected(await b.placeMarketOrder({ market: "BTC-EUR", side: "buy", amountQuote: 4.99 }, 50_000), /minimum van €5,00/);
      expect((await b.placeMarketOrder({ market: "BTC-EUR", side: "buy", amountQuote: 10 }, 50_000)).status).toBe("filled");
      const sell = await b.placeMarketOrder({ market: "BTC-EUR", side: "sell", amount: 0.00009 }, 50_000); // €4,50
      expect(sell.error?.startsWith("ONVERKOOPBAAR:")).toBe(true);
    }
  });

  it("precies het hele saldo kopen/verkopen laat geen negatief stof achter", async () => {
    const b = broker(33.333333333333336);
    const cash = await bal(b, "EUR");
    const buy = await b.placeMarketOrder({ market: "XRP-EUR", side: "buy", amountQuote: cash + 1e-12 }, 2.3);
    expect(buy.status).toBe("filled");
    expect(await bal(b, "EUR")).toBe(0);
    const held = await bal(b, "XRP");
    const sell = await b.placeMarketOrder({ market: "XRP-EUR", side: "sell", amount: held * (1 + 1e-12) }, 2.3);
    expect(sell.status).toBe("filled");
    expect(sell.filledAmount).toBe(held);
    expect(await bal(b, "XRP")).toBe(0);
    for (const x of await b.getBalances()) expect(x.available).toBeGreaterThanOrEqual(0);
  });

  it("meerdere posities in verschillende markten", async () => {
    const b = broker(100);
    await b.placeMarketOrder({ market: "BTC-EUR", side: "buy", amountQuote: 30 }, 90000);
    await b.placeMarketOrder({ market: "ETH-EUR", side: "buy", amountQuote: 30 }, 3500);
    const symbols = (await b.getBalances()).map((x) => x.symbol);
    expect(symbols).toEqual(["EUR", "BTC", "ETH"]);
    expect(Math.abs((await bal(b, "EUR")) - 40)).toBeLessThan(1e-9);
  });

  it("restore() zet saldi terug, reset() begint opnieuw", async () => {
    const b = broker(100);
    const saved: Balance[] = [
      { symbol: "EUR", available: 12.5, inOrder: 0 },
      { symbol: "BTC", available: 0.0004, inOrder: 0 },
      { symbol: "ETH", available: -1e-18, inOrder: 0 },
    ];
    b.restore(saved);
    expect(await b.getBalances()).toEqual([
      { symbol: "EUR", available: 12.5, inOrder: 0 },
      { symbol: "BTC", available: 0.0004, inOrder: 0 },
    ]);
    const sell = await b.placeMarketOrder({ market: "BTC-EUR", side: "sell", amount: 0.0004 }, 90000);
    expect(sell.status).toBe("filled");
    expect(await bal(b, "BTC")).toBe(0);

    b.reset(75);
    expect(await b.getBalances()).toEqual([{ symbol: "EUR", available: 75, inOrder: 0 }]);

    // restore zonder EUR-regel → EUR 0
    b.restore([{ symbol: "SOL", available: 1, inOrder: 0 }]);
    expect(await b.getBalances()).toEqual([
      { symbol: "EUR", available: 0, inOrder: 0 },
      { symbol: "SOL", available: 1, inOrder: 0 },
    ]);
  });

  it("getBalances geeft kopieën (extern muteren verandert niets)", async () => {
    const b = broker(10);
    const list = await b.getBalances();
    list[0].available = 1_000_000;
    expect(await bal(b, "EUR")).toBe(10);
  });
});
