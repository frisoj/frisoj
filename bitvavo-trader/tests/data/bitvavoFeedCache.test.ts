import { describe, expect, it } from "vitest";
import { BitvavoFeed, CANDLES_TTL_MS, FAST_REQUEST_TIMEOUT_MS } from "../../src/data/bitvavoFeed";
import type { BitvavoClient } from "../../src/exchange/bitvavoClient";
import { INTERVAL_MS, type Candle, type Interval } from "../../src/core/types";

const NOW = Date.UTC(2026, 8, 28, 14, 37, 23, 500);

interface Call {
  market: string;
  interval: Interval;
  limit?: number;
  req: unknown;
  resolve: (c: Candle[]) => void;
  reject: (e: Error) => void;
}

/** Nep-client: elk candles-verzoek blijft hangen tot de test het beantwoordt (of `auto`). */
function gatedClient(opts: { auto?: boolean; syncThrow?: boolean } = {}) {
  const calls: Call[] = [];
  const make = (interval: Interval, limit: number): Candle[] => {
    const step = INTERVAL_MS[interval];
    const last = Math.floor(NOW / step) * step;
    return Array.from({ length: limit }, (_, i) => {
      const t = last - (limit - 1 - i) * step;
      return { time: t, open: 1, high: 2, low: 0.5, close: 1.5, volume: 3 };
    });
  };
  const client = {
    rateLimitRemaining: 1000,
    candles(market: string, interval: Interval, o: { limit?: number } = {}, req?: unknown): Promise<Candle[]> {
      if (opts.syncThrow) throw new Error("synchrone fout");
      return new Promise<Candle[]>((resolve, reject) => {
        const call: Call = { market, interval, limit: o.limit, req, resolve, reject };
        calls.push(call);
        if (opts.auto) resolve(make(interval, o.limit ?? 10));
      });
    },
  };
  return { client: client as unknown as BitvavoClient, calls, make };
}

const tick = () => new Promise<void>((r) => setTimeout(r, 0));

describe("BitvavoFeed.getCandles — gedeeld verzoek en 5 s cache (meerdere bots)", () => {
  it("gelijktijdige gelijke verzoeken delen één verzoek; iedereen krijgt een eigen kopie", async () => {
    const { client, calls, make } = gatedClient();
    const feed = new BitvavoFeed(client, { now: () => NOW });
    const a = feed.getCandles("BTC-EUR", "15m", 10);
    const b = feed.getCandles("BTC-EUR", "15m", 10);
    const c = feed.getCandles("BTC-EUR", "15m", 10);
    await tick();
    expect(calls).toHaveLength(1);
    calls[0].resolve(make("15m", 10));
    const [ra, rb, rc] = await Promise.all([a, b, c]);
    expect(ra).toEqual(make("15m", 10));
    expect(rb).toEqual(ra);
    expect(rc).toEqual(ra);
    expect(ra).not.toBe(rb);
    expect(ra[0]).not.toBe(rb[0]);
    // Aanpassen door één aanroeper verandert de anderen en de cache niet.
    ra[0].close = 999;
    ra.pop();
    const again = await feed.getCandles("BTC-EUR", "15m", 10);
    expect(calls).toHaveLength(1); // uit de cache
    expect(again).toEqual(make("15m", 10));
    expect(rb[0].close).toBe(1.5);
  });

  it("hergebruikt een antwoord ~5 s (klok van de feed), daarna opnieuw ophalen", async () => {
    let now = NOW;
    const { client, calls } = gatedClient({ auto: true });
    const feed = new BitvavoFeed(client, { now: () => now });
    await feed.getCandles("ETH-EUR", "5m", 50);
    now += CANDLES_TTL_MS - 1;
    await feed.getCandles("ETH-EUR", "5m", 50);
    expect(calls).toHaveLength(1);
    now += 1; // precies 5 s oud → verlopen
    await feed.getCandles("ETH-EUR", "5m", 50);
    expect(calls).toHaveLength(2);
    // Klok terug (bijv. tijdcorrectie): niet vertrouwen, opnieuw ophalen
    now -= 60_000;
    await feed.getCandles("ETH-EUR", "5m", 50);
    expect(calls).toHaveLength(3);
    expect(CANDLES_TTL_MS).toBe(5_000);
  });

  it("andere markt, interval of limit = eigen verzoek; de limit telt na begrenzen tot 1440", async () => {
    const { client, calls } = gatedClient({ auto: true });
    const feed = new BitvavoFeed(client, { now: () => NOW });
    await feed.getCandles("BTC-EUR", "15m", 10);
    await feed.getCandles("BTC-EUR", "15m", 11);
    await feed.getCandles("BTC-EUR", "1h", 10);
    await feed.getCandles("ETH-EUR", "15m", 10);
    expect(calls.map((c) => `${c.market}|${c.interval}|${c.limit}`)).toEqual([
      "BTC-EUR|15m|10",
      "BTC-EUR|15m|11",
      "BTC-EUR|1h|10",
      "ETH-EUR|15m|10",
    ]);
    await feed.getCandles("SOL-EUR", "15m", 5000);
    await feed.getCandles("SOL-EUR", "15m", 1440);
    await feed.getCandles("SOL-EUR", "15m", 1440.7);
    expect(calls.filter((c) => c.market === "SOL-EUR")).toHaveLength(1);
  });

  it("een fout gaat naar alle wachtenden van dat verzoek en wordt niet bewaard; de volgende keer opnieuw", async () => {
    const { client, calls, make } = gatedClient();
    const feed = new BitvavoFeed(client, { now: () => NOW });
    const a = feed.getCandles("BTC-EUR", "15m", 10);
    const b = feed.getCandles("BTC-EUR", "15m", 10);
    await tick();
    calls[0].reject(new Error("netwerkfout"));
    await expect(a).rejects.toThrow("netwerkfout");
    await expect(b).rejects.toThrow("netwerkfout");
    const c = feed.getCandles("BTC-EUR", "15m", 10);
    await tick();
    expect(calls).toHaveLength(2);
    calls[1].resolve(make("15m", 10));
    expect(await c).toHaveLength(10);
  });

  it("een synchrone fout van de client laat geen hangend verzoek achter", async () => {
    const { client } = gatedClient({ syncThrow: true });
    const feed = new BitvavoFeed(client, { now: () => NOW });
    await expect(feed.getCandles("BTC-EUR", "15m", 10)).rejects.toThrow("synchrone fout");
    await expect(feed.getCandles("BTC-EUR", "15m", 10)).rejects.toThrow("synchrone fout");
    expect((feed as unknown as { candlesInflight: Map<string, unknown> }).candlesInflight.size).toBe(0);
  });

  it("fast- en priority-verzoeken delen geen lopend verzoek (ze mogen anders mislukken); een gelukt antwoord is voor iedereen", async () => {
    const { client, calls, make } = gatedClient();
    const feed = new BitvavoFeed(client, { now: () => NOW });
    const fast = feed.getCandles("BTC-EUR", "15m", 10, { fast: true });
    const prio = feed.getCandles("BTC-EUR", "15m", 10, { priority: true });
    const plain = feed.getCandles("BTC-EUR", "15m", 10);
    const fast2 = feed.getCandles("BTC-EUR", "15m", 10, { fast: true });
    await tick();
    expect(calls).toHaveLength(3);
    expect(calls.map((c) => c.req)).toEqual([
      { retries: 0, noWait: true, timeoutMs: FAST_REQUEST_TIMEOUT_MS },
      { priority: true },
      undefined,
    ]);
    // Het snelle verzoek mislukt (bijv. rate limit): de stop-loss-vraag heeft zijn eigen verzoek.
    calls[0].reject(new Error("rate limit"));
    await expect(fast).rejects.toThrow("rate limit");
    await expect(fast2).rejects.toThrow("rate limit");
    calls[1].resolve(make("15m", 10));
    expect(await prio).toHaveLength(10);
    calls[2].resolve(make("15m", 10));
    expect(await plain).toHaveLength(10);
    // Nu in de cache: ook een fast-verzoek gebruikt het antwoord
    expect(await feed.getCandles("BTC-EUR", "15m", 10, { fast: true })).toHaveLength(10);
    expect(calls).toHaveLength(3);
  });

  it("een leeg antwoord wordt niet hergebruikt", async () => {
    const { client, calls } = gatedClient();
    const feed = new BitvavoFeed(client, { now: () => NOW });
    const a = feed.getCandles("NEW-EUR", "15m", 10);
    await tick();
    calls[0].resolve([]);
    expect(await a).toEqual([]);
    const b = feed.getCandles("NEW-EUR", "15m", 10);
    await tick();
    expect(calls).toHaveLength(2);
    calls[1].resolve([]);
    expect(await b).toEqual([]);
  });

  it("een stop-loss-verzoek (priority) komt nooit uit de cache, maar deelt wel een lopend stop-loss-verzoek", async () => {
    const { client, calls, make } = gatedClient();
    const feed = new BitvavoFeed(client, { now: () => NOW });
    // Een andere bot haalde net candles op (gewoon verzoek): in de cache
    const plain = feed.getCandles("BTC-EUR", "15m", 10);
    await tick();
    calls[0].resolve(make("15m", 10));
    await plain;
    expect(await feed.getCandles("BTC-EUR", "15m", 10, { fast: true })).toHaveLength(10);
    expect(calls).toHaveLength(1);
    // De stop-loss van een open positie haalt toch vers op
    const p1 = feed.getCandles("BTC-EUR", "15m", 10, { fast: true, priority: true });
    const p2 = feed.getCandles("BTC-EUR", "15m", 10, { fast: true, priority: true });
    await tick();
    expect(calls).toHaveLength(2);
    calls[1].resolve(make("15m", 10));
    expect(await p1).toHaveLength(10);
    expect(await p2).toHaveLength(10);
    // Ook direct daarna: weer een eigen verzoek
    const p3 = feed.getCandles("BTC-EUR", "15m", 10, { fast: true, priority: true });
    await tick();
    expect(calls).toHaveLength(3);
    calls[2].resolve(make("15m", 10));
    await p3;
  });

  it("een antwoord van vóór het sluiten van een candle wordt daarna niet hergebruikt (ook niet als lopend verzoek)", async () => {
    const step = INTERVAL_MS["15m"];
    const close = Math.ceil(NOW / step) * step;
    let now = close - 3_000;
    const { client, calls, make } = gatedClient();
    const feed = new BitvavoFeed(client, { now: () => now });
    const before = feed.getCandles("BTC-EUR", "15m", 10);
    await tick();
    calls[0].resolve(make("15m", 10));
    await before;
    now = close + 1_000; // 4 s later, maar in een nieuwe candle-periode
    const after = feed.getCandles("BTC-EUR", "15m", 10);
    await tick();
    expect(calls).toHaveLength(2);
    calls[1].resolve(make("15m", 10));
    await after;

    // Een verzoek dat vóór de sluiting startte en erna binnenkomt: na de sluiting niet delen…
    now = close + step - 1_000;
    const late = feed.getCandles("ETH-EUR", "15m", 10);
    await tick();
    now = close + step + 500;
    const fresh = feed.getCandles("ETH-EUR", "15m", 10);
    await tick();
    expect(calls).toHaveLength(4);
    calls[3].resolve(make("15m", 10));
    await fresh;
    // …en zijn (oudere) antwoord vervangt het nieuwere in de cache niet
    calls[2].resolve(make("15m", 10));
    await late;
    expect(await feed.getCandles("ETH-EUR", "15m", 10)).toHaveLength(10);
    expect(calls).toHaveLength(4);

    // Alleen een laat antwoord van vóór de sluiting: telt niet als antwoord van na de sluiting
    now = close + 2 * step - 1_000;
    const late2 = feed.getCandles("SOL-EUR", "15m", 10);
    await tick();
    now = close + 2 * step + 500;
    calls[4].resolve(make("15m", 10));
    await late2;
    const again = feed.getCandles("SOL-EUR", "15m", 10);
    await tick();
    expect(calls).toHaveLength(6);
    calls[5].resolve(make("15m", 10));
    await again;
  });

  it("verlopen antwoorden worden opgeruimd (de cache groeit niet onbeperkt)", async () => {
    let now = NOW;
    const { client } = gatedClient({ auto: true });
    const feed = new BitvavoFeed(client, { now: () => now });
    const cache = (feed as unknown as { candlesCache: Map<string, unknown> }).candlesCache;
    for (let i = 0; i < 300; i++) await feed.getCandles(`M${i}-EUR`, "15m", 5);
    expect(cache.size).toBe(300);
    now += CANDLES_TTL_MS;
    await feed.getCandles("NIEUW-EUR", "15m", 5);
    expect(cache.size).toBe(1);
  });
});
