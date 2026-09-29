import { createHmac } from "node:crypto";
import { describe, expect, it } from "vitest";
import { BitvavoClient } from "../../src/exchange/bitvavoClient";
import { BitvavoApiError } from "../../src/exchange/errors";

const NOW = 1_700_000_000_000;
const SECRET = "test-secret";
const KEY = "a".repeat(64);

interface Call {
  url: string;
  method: string;
  headers: Record<string, string>;
  body: string | undefined;
}

type Reply = { status?: number; body?: unknown; raw?: string; headers?: Record<string, string> } | Error;

/** Mock-fetch: `handler` geeft per call een antwoord (of Error = netwerkfout). */
function mockFetch(handler: (call: Call, index: number) => Reply | Promise<Reply>) {
  const calls: Call[] = [];
  const fetchImpl = (async (input: string | URL | Request, init?: RequestInit) => {
    const call: Call = {
      url: String(input),
      method: init?.method ?? "GET",
      headers: { ...((init?.headers as Record<string, string>) ?? {}) },
      body: typeof init?.body === "string" ? init.body : undefined,
    };
    calls.push(call);
    const reply = await handler(call, calls.length - 1);
    if (reply instanceof Error) throw reply;
    const text = reply.raw ?? (reply.body === undefined ? "" : JSON.stringify(reply.body));
    return new Response(text, { status: reply.status ?? 200, headers: reply.headers ?? {} });
  }) as typeof fetch;
  return { calls, fetchImpl };
}

const sleeps: number[] = [];
function makeClient(fetchImpl: typeof fetch, extra: Partial<ConstructorParameters<typeof BitvavoClient>[0]> = {}) {
  return new BitvavoClient({
    apiKey: KEY,
    apiSecret: SECRET,
    fetchImpl,
    now: () => NOW,
    autoTimeSync: false,
    sleep: async (ms) => {
      sleeps.push(ms);
    },
    ...extra,
  });
}

function expectedSig(ts: string, method: string, path: string, body: string) {
  return createHmac("sha256", SECRET).update(`${ts}${method}${path}${body}`).digest("hex");
}

const rawOrder = {
  orderId: "11111111-2222-3333-4444-555555555555",
  clientOrderId: "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee",
  market: "BTC-EUR",
  created: NOW,
  updated: NOW + 5,
  status: "filled",
  side: "buy",
  orderType: "market",
  amountQuote: "10",
  amountQuoteRemaining: "0",
  onHold: "0",
  onHoldCurrency: "EUR",
  filledAmount: "0.00015",
  filledAmountQuote: "9.975",
  feePaid: "0.025",
  feeCurrency: "EUR",
  fills: [
    { id: "f1", timestamp: NOW, amount: "0.0001", price: "66500", taker: true, fee: "0.016625", feeCurrency: "EUR", settled: true },
    { id: "f2", timestamp: NOW, amount: "0.00005", price: "66500", taker: true, fee: "0.0083125", feeCurrency: "EUR", settled: true },
  ],
  selfTradePrevention: "decrementAndCancel",
  visible: false,
  timeInForce: "IOC",
  postOnly: false,
};

describe("BitvavoClient: authenticatie", () => {
  it("ondertekent GET-verzoeken met de juiste headers", async () => {
    const { calls, fetchImpl } = mockFetch(() => ({ body: [{ symbol: "EUR", available: "50.12", inOrder: "0" }] }));
    const client = makeClient(fetchImpl);
    const balances = await client.balance();
    expect(balances).toEqual([{ symbol: "EUR", available: 50.12, inOrder: 0 }]);

    const c = calls[0];
    expect(c.url).toBe("https://api.bitvavo.com/v2/balance");
    expect(c.method).toBe("GET");
    expect(c.headers["Bitvavo-Access-Key"]).toBe(KEY);
    expect(c.headers["Bitvavo-Access-Timestamp"]).toBe(String(NOW));
    expect(c.headers["Bitvavo-Access-Window"]).toBe("10000");
    expect(c.headers["Content-Type"]).toBe("application/json");
    expect(c.headers["Bitvavo-Access-Signature"]).toBe(expectedSig(String(NOW), "GET", "/v2/balance", ""));
  });

  it("ondertekent POST /order over de exacte body; operatorId is een getal", async () => {
    const { calls, fetchImpl } = mockFetch(() => ({ body: rawOrder }));
    const client = makeClient(fetchImpl, { operatorId: 4242, accessWindow: 5000 });
    const order = await client.placeOrder({
      market: "BTC-EUR",
      side: "buy",
      orderType: "market",
      amountQuote: 10,
      clientOrderId: "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee",
    });
    expect(order.orderId).toBe(rawOrder.orderId);

    const c = calls[0];
    expect(c.method).toBe("POST");
    expect(c.url).toBe("https://api.bitvavo.com/v2/order");
    expect(c.body).toBeDefined();
    const body = JSON.parse(c.body!);
    expect(typeof body.operatorId).toBe("number");
    expect(body.operatorId).toBe(4242);
    expect(body).toMatchObject({
      market: "BTC-EUR",
      side: "buy",
      orderType: "market",
      amountQuote: "10",
      clientOrderId: "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee",
      responseRequired: true,
    });
    expect(body.amount).toBeUndefined();
    expect(c.headers["Bitvavo-Access-Window"]).toBe("5000");
    expect(c.headers["Bitvavo-Access-Signature"]).toBe(expectedSig(String(NOW), "POST", "/v2/order", c.body!));
  });

  it("stuurt bedragen als strings zonder exponent", async () => {
    const { calls, fetchImpl } = mockFetch(() => ({ body: rawOrder }));
    const client = makeClient(fetchImpl);
    await client.placeOrder({ market: "SHIB-EUR", side: "sell", orderType: "market", amount: 1e-7 });
    await client.placeOrder({ market: "BTC-EUR", side: "buy", orderType: "limit", amount: 0.1 + 0.2, price: 0.00000123, postOnly: true, timeInForce: "GTC" });
    const b1 = JSON.parse(calls[0].body!);
    expect(b1.amount).toBe("0.0000001");
    const b2 = JSON.parse(calls[1].body!);
    expect(b2.amount).toBe("0.3");
    expect(b2.price).toBe("0.00000123");
    expect(b2.postOnly).toBe(true);
    expect(b2.timeInForce).toBe("GTC");
  });

  it("stuurt grote hoeveelheden met 16+ significante cijfers exact (nooit meer dan gevraagd)", async () => {
    const { calls, fetchImpl } = mockFetch(() => ({ body: rawOrder }));
    const client = makeClient(fetchImpl);
    await client.placeOrder({ market: "SHIB-EUR", side: "sell", orderType: "market", amount: 12345678.12345678 });
    expect(JSON.parse(calls[0].body!).amount).toBe("12345678.12345678");
  });

  it("DELETE /order heeft operatorId als queryparameter en wordt ondertekend inclusief query", async () => {
    const { calls, fetchImpl } = mockFetch(() => ({ body: { orderId: "abc" } }));
    const client = makeClient(fetchImpl, { operatorId: 7 });
    await client.cancelOrder("BTC-EUR", "abc");
    const c = calls[0];
    expect(c.method).toBe("DELETE");
    const url = new URL(c.url);
    expect(url.pathname).toBe("/v2/order");
    expect(url.searchParams.get("market")).toBe("BTC-EUR");
    expect(url.searchParams.get("orderId")).toBe("abc");
    expect(url.searchParams.get("operatorId")).toBe("7");
    expect(c.body).toBeUndefined();
    expect(c.headers["Bitvavo-Access-Signature"]).toBe(
      expectedSig(String(NOW), "DELETE", `/v2/order${url.search}`, ""),
    );
  });

  it("weigert lokaal ongeldige orders zonder iets te versturen", async () => {
    const { calls, fetchImpl } = mockFetch(() => ({ body: rawOrder }));
    const client = makeClient(fetchImpl);
    await expect(
      client.placeOrder({ market: "BTC-EUR", side: "buy", orderType: "market", amount: 1, amountQuote: 10 }),
    ).rejects.toMatchObject({ kind: "validation" });
    await expect(
      client.placeOrder({ market: "BTC-EUR", side: "buy", orderType: "market", amountQuote: Number.NaN }),
    ).rejects.toBeInstanceOf(BitvavoApiError);
    await expect(client.placeOrder({ market: "BTC-EUR", side: "buy", orderType: "limit", amount: 1 })).rejects.toBeInstanceOf(
      BitvavoApiError,
    );
    expect(calls).toHaveLength(0);
  });

  it("geeft een duidelijke fout zonder API-sleutel", async () => {
    const { calls, fetchImpl } = mockFetch(() => ({ body: [] }));
    const client = new BitvavoClient({ fetchImpl });
    expect(client.hasCredentials).toBe(false);
    await expect(client.balance()).rejects.toMatchObject({ kind: "config" });
    expect(calls).toHaveLength(0);
  });

  it("corrigeert klokverschil via /time vóór het eerste private verzoek", async () => {
    const { calls, fetchImpl } = mockFetch((c) => {
      if (c.url.endsWith("/time")) return { body: { time: NOW + 5000 } };
      return { body: [] };
    });
    const client = makeClient(fetchImpl, { autoTimeSync: true });
    await client.balance();
    await client.balance();
    expect(calls.map((c) => new URL(c.url).pathname)).toEqual(["/v2/time", "/v2/balance", "/v2/balance"]);
    expect(calls[1].headers["Bitvavo-Access-Timestamp"]).toBe(String(NOW + 5000));
    expect(client.clockOffsetMs).toBe(5000);
  });

  it("negeert klein klokverschil (< 1 s)", async () => {
    const { fetchImpl } = mockFetch(() => ({ body: { time: NOW + 400 } }));
    const client = makeClient(fetchImpl);
    await client.syncTime();
    expect(client.clockOffsetMs).toBe(0);
  });
});

describe("BitvavoClient: publieke data", () => {
  it("candles: nieuwste-eerst wordt oplopend en numeriek", async () => {
    const { calls, fetchImpl } = mockFetch(() => ({
      body: [
        [NOW + 1_800_000, "102", "103", "101", "102.5", "1.5"],
        [NOW + 900_000, "101", "102", "100", "102", "2"],
        [NOW, "100", "101", "99", "101", "3.25"],
      ],
    }));
    const client = makeClient(fetchImpl);
    const candles = await client.candles("BTC-EUR", "15m", { limit: 5000, start: NOW, end: NOW + 3_600_000 });
    expect(candles).toEqual([
      { time: NOW, open: 100, high: 101, low: 99, close: 101, volume: 3.25 },
      { time: NOW + 900_000, open: 101, high: 102, low: 100, close: 102, volume: 2 },
      { time: NOW + 1_800_000, open: 102, high: 103, low: 101, close: 102.5, volume: 1.5 },
    ]);
    const url = new URL(calls[0].url);
    expect(url.pathname).toBe("/v2/BTC-EUR/candles");
    expect(url.searchParams.get("interval")).toBe("15m");
    expect(url.searchParams.get("limit")).toBe("1440");
    expect(url.searchParams.get("start")).toBe(String(NOW));
    expect(url.searchParams.get("end")).toBe(String(NOW + 3_600_000));
    // Publiek endpoint: geen auth-headers
    expect(calls[0].headers["Bitvavo-Access-Key"]).toBeUndefined();
  });

  it("markets: parset strings en vult ontbrekende velden aan", async () => {
    const { fetchImpl } = mockFetch(() => ({
      body: [
        {
          market: "BTC-EUR",
          status: "trading",
          base: "BTC",
          quote: "EUR",
          pricePrecision: 5,
          minOrderInQuoteAsset: "5",
          minOrderInBaseAsset: "0.00006100",
          maxOrderInQuoteAsset: "1000000000",
          quantityDecimals: 8,
          notionalDecimals: 2,
          tickSize: "1.00",
          orderTypes: ["market", "limit"],
        },
        { market: "OLD-EUR", status: "halted", minOrderInQuoteAsset: "5", minOrderInBaseAsset: "10" },
        { status: "trading" },
      ],
    }));
    const client = makeClient(fetchImpl);
    const markets = await client.markets();
    expect(markets).toHaveLength(2);
    expect(markets[0]).toEqual({
      market: "BTC-EUR",
      base: "BTC",
      quote: "EUR",
      status: "trading",
      minOrderQuote: 5,
      minOrderBase: 0.000061,
      pricePrecision: 5,
      quantityDecimals: 8,
      notionalDecimals: 2,
      tickSize: 1,
    });
    expect(markets[1]).toEqual({
      market: "OLD-EUR",
      base: "OLD",
      quote: "EUR",
      status: "halted",
      minOrderQuote: 5,
      minOrderBase: 10,
      pricePrecision: 5,
      quantityDecimals: 8,
      notionalDecimals: 2,
    });
    expect(markets[1].tickSize).toBeUndefined();
  });

  it("ticker24h: object en array, null-waarden veilig", async () => {
    const t = {
      market: "BTC-EUR",
      open: "60000",
      high: "61000",
      low: "59000",
      last: "61200",
      volume: "12.5",
      volumeQuote: "750000",
      bid: "61190",
      bidSize: "0.1",
      ask: "61210",
      askSize: "0.2",
      timestamp: NOW,
    };
    const { fetchImpl } = mockFetch((c) =>
      c.url.includes("market=") ? { body: t } : { body: [t, { market: "DEAD-EUR", open: null, high: null, low: null, last: null, volume: null, volumeQuote: null, bid: null, ask: null, timestamp: NOW }] },
    );
    const client = makeClient(fetchImpl);
    const single = await client.ticker24h("BTC-EUR");
    expect(single).toHaveLength(1);
    expect(single[0].changePct).toBeCloseTo(2, 10);
    expect(single[0]).toMatchObject({ market: "BTC-EUR", last: 61200, bid: 61190, ask: 61210, volumeQuote: 750000, timestamp: NOW });

    const all = await client.ticker24h();
    expect(all).toHaveLength(2);
    expect(all[1]).toMatchObject({ market: "DEAD-EUR", last: 0, open: 0, changePct: 0, bid: null, ask: null, volume: 0 });
  });

  it("tickerPrice: object en array", async () => {
    const { fetchImpl } = mockFetch((c) =>
      c.url.includes("market=")
        ? { body: { market: "ETH-EUR", price: "3000.5" } }
        : { body: [{ market: "ETH-EUR", price: "3000.5" }, { market: "X-EUR", price: null }] },
    );
    const client = makeClient(fetchImpl);
    expect(await client.tickerPrice("ETH-EUR")).toEqual([{ market: "ETH-EUR", price: 3000.5 }]);
    expect(await client.tickerPrice()).toEqual([{ market: "ETH-EUR", price: 3000.5 }]);
  });

  it("book: parset niveaus en sorteert", async () => {
    const { calls, fetchImpl } = mockFetch(() => ({
      body: {
        market: "BTC-EUR",
        nonce: 1,
        bids: [["64000", "0.5"], ["64100", "0.1"]],
        asks: [["64200", "0.3"], ["64150", "0.2"]],
      },
    }));
    const client = makeClient(fetchImpl);
    const book = await client.book("BTC-EUR", 10);
    expect(new URL(calls[0].url).searchParams.get("depth")).toBe("10");
    expect(book).toEqual({
      market: "BTC-EUR",
      bids: [
        [64100, 0.1],
        [64000, 0.5],
      ],
      asks: [
        [64150, 0.2],
        [64200, 0.3],
      ],
      timestamp: NOW,
    });
  });

  it("account: fees als getallen", async () => {
    const { fetchImpl } = mockFetch(() => ({ body: { fees: { taker: "0.0025", maker: "0.0015", volume: "123.45" } } }));
    const client = makeClient(fetchImpl);
    expect(await client.account()).toEqual({ takerFee: 0.0025, makerFee: 0.0015, volume: 123.45 });
  });

  it("orders: numerieke velden geparset", async () => {
    const { calls, fetchImpl } = mockFetch(() => ({ body: [rawOrder] }));
    const client = makeClient(fetchImpl);
    const orders = await client.openOrders("BTC-EUR");
    expect(new URL(calls[0].url).searchParams.get("market")).toBe("BTC-EUR");
    const o = orders[0];
    expect(o.filledAmount).toBe(0.00015);
    expect(o.filledAmountQuote).toBe(9.975);
    expect(o.feePaid).toBe(0.025);
    expect(o.amountQuote).toBe(10);
    expect(o.fills[0]).toEqual({
      id: "f1",
      timestamp: NOW,
      amount: 0.0001,
      price: 66500,
      taker: true,
      fee: 0.016625,
      feeCurrency: "EUR",
      settled: true,
    });
    expect(o.status).toBe("filled");
    expect(o.postOnly).toBe(false);
  });
});

describe("BitvavoClient: fouten, retries, rate limit", () => {
  it("vertaalt een Bitvavo-fout naar BitvavoApiError met code", async () => {
    const { fetchImpl } = mockFetch(() => ({ status: 400, body: { errorCode: 216, error: "Balance insufficient" } }));
    const client = makeClient(fetchImpl);
    const err = await client
      .placeOrder({ market: "BTC-EUR", side: "buy", orderType: "market", amountQuote: 10 })
      .catch((e) => e);
    expect(err).toBeInstanceOf(BitvavoApiError);
    expect(err.status).toBe(400);
    expect(err.errorCode).toBe(216);
    expect(err.message).toContain("onvoldoende saldo");
    expect(err.message).toContain("Balance insufficient");
    expect(err.outcomeUnknown).toBe(false);
  });

  it("herhaalt GET bij 500 en slaagt daarna", async () => {
    sleeps.length = 0;
    const { calls, fetchImpl } = mockFetch((_c, i) =>
      i === 0 ? { status: 500, raw: "Internal Server Error" } : { body: [{ market: "BTC-EUR", price: "1" }] },
    );
    const client = makeClient(fetchImpl);
    expect(await client.tickerPrice()).toEqual([{ market: "BTC-EUR", price: 1 }]);
    expect(calls).toHaveLength(2);
    expect(sleeps.length).toBe(1);
  });

  it("geeft op na 2 herhalingen", async () => {
    const { calls, fetchImpl } = mockFetch(() => new TypeError("fetch failed"));
    const client = makeClient(fetchImpl);
    const err = await client.markets().catch((e) => e);
    expect(err).toBeInstanceOf(BitvavoApiError);
    expect(err.kind).toBe("network");
    expect(calls).toHaveLength(3);
  });

  it("herhaalt POST /order NOOIT (ook niet bij 500 of netwerkfout)", async () => {
    const { calls, fetchImpl } = mockFetch(() => ({ status: 500, raw: "oops" }));
    const client = makeClient(fetchImpl);
    const err = await client
      .placeOrder({ market: "BTC-EUR", side: "buy", orderType: "market", amountQuote: 10 })
      .catch((e) => e);
    expect(err).toBeInstanceOf(BitvavoApiError);
    expect(err.outcomeUnknown).toBe(true);
    expect(calls).toHaveLength(1);

    const net = mockFetch(() => new TypeError("socket hang up"));
    const client2 = makeClient(net.fetchImpl);
    const err2 = await client2
      .placeOrder({ market: "BTC-EUR", side: "sell", orderType: "market", amount: 0.001 })
      .catch((e) => e);
    expect(err2.kind).toBe("network");
    expect(err2.outcomeUnknown).toBe(true);
    expect(net.calls).toHaveLength(1);
  });

  it("DELETE wordt niet herhaald", async () => {
    const { calls, fetchImpl } = mockFetch(() => ({ status: 503, raw: "" }));
    const client = makeClient(fetchImpl);
    await expect(client.cancelOrder("BTC-EUR", "x")).rejects.toBeInstanceOf(BitvavoApiError);
    expect(calls).toHaveLength(1);
  });

  it("timeout via AbortController", async () => {
    const fetchImpl = ((_url: string, init?: RequestInit) =>
      new Promise((_resolve, reject) => {
        init?.signal?.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError")));
      })) as unknown as typeof fetch;
    const client = makeClient(fetchImpl, { timeoutMs: 20, maxRetries: 0 });
    const err = await client.time().catch((e) => e);
    expect(err).toBeInstanceOf(BitvavoApiError);
    expect(err.kind).toBe("timeout");
    expect(err.message).toContain("timeout");
  });

  it("houdt rate-limit headers bij en wacht bij < 20 resterend", async () => {
    sleeps.length = 0;
    const { fetchImpl } = mockFetch(() => ({
      body: { time: NOW },
      headers: {
        "bitvavo-ratelimit-remaining": "10",
        "bitvavo-ratelimit-resetat": String(NOW + 30_000),
        "bitvavo-ratelimit-limit": "1000",
      },
    }));
    const client = makeClient(fetchImpl);
    await client.time();
    expect(client.rateLimitRemaining).toBe(10);
    expect(sleeps).toEqual([]);
    await client.time();
    expect(sleeps).toEqual([30_050]);
  });

  it("stopt met verzoeken na een ban (105)", async () => {
    const { calls, fetchImpl } = mockFetch(() => ({
      status: 429,
      body: { errorCode: 105, error: `Your IP or API key has been banned for not respecting the rate limit. The ban expires at ${NOW + 120_000}.` },
    }));
    const client = makeClient(fetchImpl);
    const e1 = await client.markets().catch((e) => e);
    expect(e1.errorCode).toBe(105);
    expect(calls).toHaveLength(1); // 105 wordt niet herhaald
    const e2 = await client.markets().catch((e) => e);
    expect(e2.kind).toBe("rate-limit");
    expect(calls).toHaveLength(1); // niets meer verstuurd
  });

  it("onleesbaar antwoord → invalid-response", async () => {
    const { fetchImpl } = mockFetch(() => ({ status: 200, raw: "<html>" }));
    const client = makeClient(fetchImpl, { maxRetries: 0 });
    const err = await client.markets().catch((e) => e);
    expect(err.kind).toBe("invalid-response");
  });

  it("errorCode in een 200-antwoord is ook een fout", async () => {
    const { fetchImpl } = mockFetch(() => ({ status: 200, body: { errorCode: 205, error: "market parameter is invalid." } }));
    const client = makeClient(fetchImpl);
    const err = await client.getOrder("BTC-EUR", "x").catch((e) => e);
    expect(err.errorCode).toBe(205);
    expect(err.message).toContain("ongeldige parameter");
  });

  it("API-secret komt nooit in de foutmelding", async () => {
    const { fetchImpl } = mockFetch(() => ({ status: 403, body: { errorCode: 309, error: "The signature is invalid." } }));
    const client = makeClient(fetchImpl);
    const err = await client.balance().catch((e) => e);
    expect(err.message).not.toContain(SECRET);
    expect(err.message).toContain("ongeldige handtekening");
  });
});
