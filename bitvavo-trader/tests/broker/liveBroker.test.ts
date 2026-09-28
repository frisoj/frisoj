import { describe, expect, it } from "vitest";
import type { MarketInfo } from "../../src/core/types";
import { LiveBroker, mapOrderStatus, orderToResult, toClientOrderUuid } from "../../src/broker/liveBroker";
import { BitvavoClient, parseOrder } from "../../src/exchange/bitvavoClient";

const NOW = 1_700_000_000_000;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

const BTC: MarketInfo = {
  market: "BTC-EUR",
  base: "BTC",
  quote: "EUR",
  status: "trading",
  minOrderQuote: 5,
  minOrderBase: 0.00006,
  pricePrecision: 5,
  quantityDecimals: 8,
  notionalDecimals: 2,
};

interface Call {
  url: URL;
  method: string;
  body: Record<string, unknown> | undefined;
}

type Reply = { status?: number; body?: unknown } | Error;

function setup(handler: (call: Call, calls: Call[]) => Reply, market: MarketInfo | undefined = BTC) {
  const calls: Call[] = [];
  const fetchImpl = (async (input: string | URL | Request, init?: RequestInit) => {
    const call: Call = {
      url: new URL(String(input)),
      method: init?.method ?? "GET",
      body: typeof init?.body === "string" ? JSON.parse(init.body) : undefined,
    };
    calls.push(call);
    const reply = handler(call, calls);
    if (reply instanceof Error) throw reply;
    return new Response(reply.body === undefined ? "" : JSON.stringify(reply.body), { status: reply.status ?? 200 });
  }) as typeof fetch;
  const sleeps: number[] = [];
  const client = new BitvavoClient({
    apiKey: "k".repeat(64),
    apiSecret: "s",
    fetchImpl,
    now: () => NOW,
    autoTimeSync: false,
    sleep: async () => {},
  });
  const broker = new LiveBroker(client, {
    getMarketInfo: async (m) => (market && m === market.market ? market : undefined),
    sleep: async (ms) => {
      sleeps.push(ms);
    },
    now: () => NOW,
  });
  return { broker, client, calls, sleeps, posts: () => calls.filter((c) => c.method === "POST") };
}

function order(over: Record<string, unknown> = {}) {
  return {
    orderId: "order-1",
    clientOrderId: "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee",
    market: "BTC-EUR",
    created: NOW,
    updated: NOW + 10,
    status: "filled",
    side: "buy",
    orderType: "market",
    filledAmount: "0",
    filledAmountQuote: "0",
    feePaid: "0",
    feeCurrency: "EUR",
    fills: [],
    ...over,
  };
}

describe("LiveBroker.placeMarketOrder", () => {
  it("koopt met amountQuote (afgerond naar beneden) en mapt fills", async () => {
    const t = setup((c) => {
      if (c.method === "POST") {
        return {
          body: order({
            clientOrderId: c.body?.clientOrderId,
            filledAmount: "0.00015",
            filledAmountQuote: "9.975",
            feePaid: "0.025",
            fills: [
              { id: "f1", timestamp: NOW, amount: "0.0001", price: "66000", taker: true, fee: "0.0165", feeCurrency: "EUR", settled: true },
              { id: "f2", timestamp: NOW, amount: "0.00005", price: "67000", taker: true, fee: "0.008375", feeCurrency: "EUR", settled: true },
            ],
          }),
        };
      }
      return { status: 404, body: { errorCode: 110, error: "Invalid endpoint." } };
    });
    const res = await t.broker.placeMarketOrder({ market: "BTC-EUR", side: "buy", amountQuote: 10.0099 }, 66300);

    const post = t.posts()[0];
    expect(post.body).toMatchObject({ market: "BTC-EUR", side: "buy", orderType: "market", amountQuote: "10", operatorId: 1 });
    expect(typeof post.body?.operatorId).toBe("number");
    expect(post.body?.amount).toBeUndefined();
    expect(post.body?.clientOrderId).toMatch(UUID_RE);

    expect(res.status).toBe("filled");
    expect(res.orderId).toBe("order-1");
    expect(res.clientOrderId).toBe(post.body?.clientOrderId);
    expect(res.filledAmount).toBeCloseTo(0.00015, 12);
    expect(res.filledQuote).toBeCloseTo(0.0001 * 66000 + 0.00005 * 67000, 10); // 9.95
    expect(res.avgPrice).toBeCloseTo(9.95 / 0.00015, 6);
    expect(res.feeQuote).toBeCloseTo(0.024875, 10);
    expect(res.timestamp).toBe(NOW + 10);
    expect(res.error).toBeUndefined();
  });

  it("verkoopt met amount (gefloord op quantityDecimals) en rekent fee in base om naar EUR", async () => {
    const t = setup((c) => ({
      body: order({
        side: "sell",
        clientOrderId: c.body?.clientOrderId,
        fills: [{ id: "f1", timestamp: NOW, amount: "0.12", price: "3000", taker: true, fee: "0.0003", feeCurrency: "ETH", settled: true }],
        market: "ETH-EUR",
      }),
    }), { ...BTC, market: "ETH-EUR", base: "ETH", quantityDecimals: 4, minOrderBase: 0.001 });
    const res = await t.broker.placeMarketOrder({ market: "ETH-EUR", side: "sell", amount: 0.123456789 }, 3000);
    expect(t.posts()[0].body).toMatchObject({ side: "sell", amount: "0.1234" });
    expect(t.posts()[0].body?.amountQuote).toBeUndefined();
    expect(res.side).toBe("sell");
    expect(res.filledAmount).toBe(0.12);
    expect(res.filledQuote).toBeCloseTo(360, 10);
    expect(res.feeQuote).toBeCloseTo(0.9, 10);
  });

  it("gebruikt een meegegeven UUID als clientOrderId en zet andere ids deterministisch om", async () => {
    const t = setup((c) => ({ body: order({ clientOrderId: c.body?.clientOrderId, fills: [{ id: "f", timestamp: NOW, amount: "0.0002", price: "50000", taker: true, fee: "0.025", feeCurrency: "EUR", settled: true }] }) }));
    const uuid = "12345678-1234-4234-8234-123456789abc";
    await t.broker.placeMarketOrder({ market: "BTC-EUR", side: "buy", amountQuote: 10, clientOrderId: uuid }, 50000);
    expect(t.posts()[0].body?.clientOrderId).toBe(uuid);
    await t.broker.placeMarketOrder({ market: "BTC-EUR", side: "buy", amountQuote: 10, clientOrderId: "pos_abc123" }, 50000);
    expect(t.posts()[1].body?.clientOrderId).toBe(toClientOrderUuid("pos_abc123"));
    expect(toClientOrderUuid("pos_abc123")).toMatch(UUID_RE);
    expect(toClientOrderUuid("pos_abc123")).toBe(toClientOrderUuid("pos_abc123"));
  });

  it("valt terug op filledAmount/filledAmountQuote/feePaid zonder fills", async () => {
    const t = setup(() => ({ body: order({ filledAmount: "0.0002", filledAmountQuote: "10", feePaid: "0.025" }) }));
    const res = await t.broker.placeMarketOrder({ market: "BTC-EUR", side: "buy", amountQuote: 10 }, 50000);
    expect(res.filledAmount).toBe(0.0002);
    expect(res.filledQuote).toBe(10);
    expect(res.avgPrice).toBeCloseTo(50000, 6);
    expect(res.feeQuote).toBe(0.025);
  });

  it("pollt getOrder zolang de order nog 'new' is", async () => {
    let gets = 0;
    const t = setup((c) => {
      if (c.method === "POST") return { body: order({ status: "new" }) };
      gets++;
      expect(c.url.searchParams.get("orderId")).toBe("order-1");
      if (gets < 3) return { body: order({ status: "new" }) };
      return {
        body: order({
          fills: [{ id: "f", timestamp: NOW, amount: "0.0002", price: "50000", taker: true, fee: "0.025", feeCurrency: "EUR", settled: true }],
        }),
      };
    });
    const res = await t.broker.placeMarketOrder({ market: "BTC-EUR", side: "buy", amountQuote: 10 }, 50000);
    expect(gets).toBe(3);
    expect(t.sleeps).toEqual([400, 400, 400]);
    expect(res.status).toBe("filled");
    expect(res.filledAmount).toBe(0.0002);
    expect(t.posts()).toHaveLength(1);
  });

  it("geeft 'new' met melding als de order na het pollen nog niet gevuld is", async () => {
    const t = setup(() => ({ body: order({ status: "new" }) }));
    const res = await t.broker.placeMarketOrder({ market: "BTC-EUR", side: "buy", amountQuote: 10 }, 50000);
    expect(res.status).toBe("new");
    expect(res.error).toContain("nog niet gevuld");
    expect(t.calls.filter((c) => c.method === "GET")).toHaveLength(5);
  });

  it("mapt een Bitvavo-afwijzing naar status rejected (gooit niet)", async () => {
    const t = setup(() => ({ status: 400, body: { errorCode: 216, error: "Balance insufficient" } }));
    const res = await t.broker.placeMarketOrder({ market: "BTC-EUR", side: "buy", amountQuote: 10 }, 50000);
    expect(res.status).toBe("rejected");
    expect(res.error).toContain("onvoldoende saldo");
    expect(res.error).toContain("Balance insufficient");
    expect(res.filledAmount).toBe(0);
    expect(t.calls).toHaveLength(1); // geen lookup bij een definitieve afwijzing
  });

  it("weigert lokaal onder het minimum (quote en base) zonder iets te versturen", async () => {
    const t = setup(() => ({ body: order() }));
    const r1 = await t.broker.placeMarketOrder({ market: "BTC-EUR", side: "buy", amountQuote: 4.999 }, 50000);
    expect(r1.status).toBe("rejected");
    expect(r1.error).toContain("minimum");
    expect(r1.error).toContain("€ 5,00");
    expect(r1.error).toContain("€ 4,99");

    const r2 = await t.broker.placeMarketOrder({ market: "BTC-EUR", side: "sell", amount: 0.00005 }, 50000);
    expect(r2.status).toBe("rejected");
    expect(r2.error).toContain("minimum");

    const r3 = await t.broker.placeMarketOrder({ market: "BTC-EUR", side: "sell", amount: 0.00009 }, 50000); // €4,50
    expect(r3.status).toBe("rejected");
    expect(r3.error).toContain("€ 4,50");

    const r4 = await t.broker.placeMarketOrder({ market: "BTC-EUR", side: "buy" }, 50000);
    expect(r4.status).toBe("rejected");

    const r5 = await t.broker.placeMarketOrder({ market: "DOGE-EUR", side: "buy", amountQuote: 10 }, 0.1);
    expect(r5.status).toBe("rejected");
    expect(r5.error).toContain("onbekende markt");

    expect(t.calls).toHaveLength(0);
  });

  it("weigert markten die niet 'trading' zijn", async () => {
    const t = setup(() => ({ body: order() }), { ...BTC, status: "halted" });
    const res = await t.broker.placeMarketOrder({ market: "BTC-EUR", side: "buy", amountQuote: 10 }, 50000);
    expect(res.status).toBe("rejected");
    expect(res.error).toContain("halted");
    expect(t.calls).toHaveLength(0);
  });

  it("zoekt de order op via clientOrderId na een netwerkfout (en plaatst hem NIET opnieuw)", async () => {
    let sentClientId: unknown;
    const t = setup((c) => {
      if (c.method === "POST") {
        sentClientId = c.body?.clientOrderId;
        return new TypeError("socket hang up");
      }
      expect(c.url.pathname).toBe("/v2/order");
      expect(c.url.searchParams.get("clientOrderId")).toBe(sentClientId);
      expect(c.url.searchParams.get("market")).toBe("BTC-EUR");
      return {
        body: order({
          clientOrderId: sentClientId,
          fills: [{ id: "f", timestamp: NOW, amount: "0.0002", price: "50000", taker: true, fee: "0.025", feeCurrency: "EUR", settled: true }],
        }),
      };
    });
    const res = await t.broker.placeMarketOrder({ market: "BTC-EUR", side: "buy", amountQuote: 10 }, 50000);
    expect(t.posts()).toHaveLength(1);
    expect(res.status).toBe("filled");
    expect(res.filledAmount).toBe(0.0002);
    expect(res.clientOrderId).toBe(sentClientId);
  });

  it("meldt 'waarschijnlijk niet geplaatst' als de lookup steeds 'niet gevonden' geeft", async () => {
    const t = setup((c) => {
      if (c.method === "POST") return new TypeError("fetch failed");
      return { status: 404, body: { errorCode: 240, error: "No order found." } };
    });
    const res = await t.broker.placeMarketOrder({ market: "BTC-EUR", side: "buy", amountQuote: 10 }, 50000);
    expect(t.posts()).toHaveLength(1);
    expect(res.status).toBe("rejected");
    expect(res.error).toContain("niet teruggevonden");
    expect(t.calls.filter((c) => c.method === "GET")).toHaveLength(5);
  });

  it("meldt UITKOMST ONBEKEND als ook de lookup mislukt", async () => {
    const t = setup(() => new TypeError("fetch failed"));
    const res = await t.broker.placeMarketOrder({ market: "BTC-EUR", side: "buy", amountQuote: 10 }, 50000);
    expect(t.posts()).toHaveLength(1);
    expect(res.status).toBe("new");
    expect(res.error).toContain("UITKOMST ONBEKEND");
  });

  it("waarschuwt bij te grote slippage maar geeft het resultaat wel terug", async () => {
    const t = setup(() => ({
      body: order({
        fills: [{ id: "f", timestamp: NOW, amount: "0.0002", price: "52000", taker: true, fee: "0.026", feeCurrency: "EUR", settled: true }],
      }),
    }));
    const res = await t.broker.placeMarketOrder({ market: "BTC-EUR", side: "buy", amountQuote: 10.43 }, 50000);
    expect(res.status).toBe("filled");
    expect(res.avgPrice).toBe(52000);
    expect(res.error).toContain("Waarschuwing");
    expect(res.error).toContain("4%");
  });

  it("rapporteert een deels gevulde, daarna geannuleerde order als partiallyFilled", async () => {
    const t = setup(() => ({
      body: order({
        status: "canceledMarketProtection",
        fills: [{ id: "f", timestamp: NOW, amount: "0.0001", price: "50000", taker: true, fee: "0.0125", feeCurrency: "EUR", settled: true }],
      }),
    }));
    const res = await t.broker.placeMarketOrder({ market: "BTC-EUR", side: "buy", amountQuote: 10 }, 50000);
    expect(res.status).toBe("partiallyFilled");
    expect(res.filledAmount).toBe(0.0001);
    expect(res.error).toContain("deels gevuld");
  });

  it("verlaagt een verkoop naar het beschikbare saldo bij een klein tekort", async () => {
    const sellFill = (c: Call) =>
      order({
        side: "sell",
        clientOrderId: c.body?.clientOrderId,
        fills: [{ id: "f", timestamp: NOW, amount: String(c.body?.amount), price: "50000", taker: true, fee: "0.025", feeCurrency: "EUR", settled: true }],
      });
    const t = setup((c) => {
      if (c.url.pathname === "/v2/balance") return { body: [{ symbol: "BTC", available: "0.00019950", inOrder: "0" }] };
      return { body: sellFill(c) };
    });
    const res = await t.broker.placeMarketOrder({ market: "BTC-EUR", side: "sell", amount: 0.0002 }, 50000);
    expect(t.posts()[0].body?.amount).toBe("0.0001995");
    expect(res.status).toBe("filled");
    expect(res.filledAmount).toBe(0.0001995);
    expect(res.error).toContain("verlaagd");

    // Groot tekort: niet stilletjes aanpassen, Bitvavo beslist.
    const t2 = setup((c) => {
      if (c.url.pathname === "/v2/balance") return { body: [{ symbol: "BTC", available: "0.0001", inOrder: "0" }] };
      return { status: 400, body: { errorCode: 216, error: "Balance insufficient" } };
    });
    const res2 = await t2.broker.placeMarketOrder({ market: "BTC-EUR", side: "sell", amount: 0.0002 }, 50000);
    expect(t2.posts()[0].body?.amount).toBe("0.0002");
    expect(res2.status).toBe("rejected");

    // Saldo niet op te halen: gewoon doorgaan met de gevraagde hoeveelheid.
    const t3 = setup((c) => {
      if (c.url.pathname === "/v2/balance") return { status: 503, body: { error: "down" } };
      return { body: sellFill(c) };
    });
    const res3 = await t3.broker.placeMarketOrder({ market: "BTC-EUR", side: "sell", amount: 0.0002 }, 50000);
    expect(t3.posts()[0].body?.amount).toBe("0.0002");
    expect(res3.status).toBe("filled");
    expect(res3.error).toBeUndefined();
  });

  it("haalt marktinfo zelf op via client.markets() als getMarketInfo ontbreekt", async () => {
    const calls: string[] = [];
    const fetchImpl = (async (input: string | URL | Request, init?: RequestInit) => {
      const url = new URL(String(input));
      calls.push(`${init?.method ?? "GET"} ${url.pathname}`);
      if (url.pathname === "/v2/markets") {
        return new Response(
          JSON.stringify([{ market: "BTC-EUR", status: "trading", base: "BTC", quote: "EUR", minOrderInQuoteAsset: "5", minOrderInBaseAsset: "0.00006", pricePrecision: 5, quantityDecimals: 8, notionalDecimals: 2 }]),
        );
      }
      return new Response(JSON.stringify(order({ fills: [{ id: "f", timestamp: NOW, amount: "0.0002", price: "50000", taker: true, fee: "0.025", feeCurrency: "EUR", settled: true }] })));
    }) as typeof fetch;
    const client = new BitvavoClient({ apiKey: "k".repeat(64), apiSecret: "s", fetchImpl, autoTimeSync: false });
    const broker = new LiveBroker(client, { sleep: async () => {} });
    const r1 = await broker.placeMarketOrder({ market: "BTC-EUR", side: "buy", amountQuote: 10 }, 50000);
    const r2 = await broker.placeMarketOrder({ market: "BTC-EUR", side: "buy", amountQuote: 3 }, 50000);
    expect(r1.status).toBe("filled");
    expect(r2.status).toBe("rejected");
    expect(calls).toEqual(["GET /v2/markets", "POST /v2/order"]); // markten gecachet
  });
});

describe("LiveBroker overig", () => {
  it("getBalances → client.balance()", async () => {
    const t = setup(() => ({ body: [{ symbol: "EUR", available: "49.5", inOrder: "0.5" }] }));
    expect(t.broker.mode).toBe("live");
    expect(await t.broker.getBalances()).toEqual([{ symbol: "EUR", available: 49.5, inOrder: 0.5 }]);
    expect(t.calls[0].url.pathname).toBe("/v2/balance");
  });

  it("mapOrderStatus", () => {
    expect(mapOrderStatus("filled")).toBe("filled");
    expect(mapOrderStatus("partiallyFilled")).toBe("partiallyFilled");
    for (const s of ["canceled", "canceledAuction", "canceledSelfTradePrevention", "canceledIOC", "canceledFOK", "canceledMarketProtection", "canceledPostOnly"]) {
      expect(mapOrderStatus(s)).toBe("cancelled");
    }
    expect(mapOrderStatus("expired")).toBe("expired");
    expect(mapOrderStatus("rejected")).toBe("rejected");
    expect(mapOrderStatus("new")).toBe("new");
    expect(mapOrderStatus("awaitingTrigger")).toBe("new");
  });

  it("orderToResult gebruikt feePaid als fills nog niet settled zijn", () => {
    const o = parseOrder(
      order({
        feePaid: "0.03",
        fills: [{ id: "f", timestamp: NOW, amount: "0.0002", price: "50000", taker: true, settled: false }],
      }),
    );
    const r = orderToResult(o, "EUR", NOW);
    expect(r.feeQuote).toBe(0.03);
    expect(r.filledQuote).toBe(10);
  });
});
