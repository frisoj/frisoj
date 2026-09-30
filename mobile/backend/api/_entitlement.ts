// Server-side free quota + RevenueCat entitlement check.
export const FREE_PER_WEEK = 3;
const WEEK_S = 7 * 86_400;

export interface Counter {
  incr(key: string, ttlSeconds: number): Promise<number>;
  decr(key: string): Promise<void>;
}

/** Upstash Redis REST when configured, otherwise per-instance memory (dev only). */
export function makeCounter(env: Record<string, string | undefined> = process.env, fetchFn: typeof fetch = fetch): Counter {
  const url = env.UPSTASH_REDIS_REST_URL;
  const token = env.UPSTASH_REDIS_REST_TOKEN;
  if (url && token) {
    const call = async (cmd: (string | number)[]) => {
      const r = await fetchFn(url, { method: 'POST', headers: { authorization: `Bearer ${token}` }, body: JSON.stringify(cmd) });
      if (!r.ok) throw new Error('redis');
      return ((await r.json()) as { result: number }).result;
    };
    return {
      async incr(key, ttl) {
        const n = await call(['INCR', key]);
        if (n === 1) await call(['EXPIRE', key, ttl]);
        return n;
      },
      async decr(key) { await call(['DECR', key]); },
    };
  }
  const mem = new Map<string, { n: number; exp: number }>();
  return {
    async incr(key, ttl) {
      const now = Date.now();
      const cur = mem.get(key);
      const e = cur && cur.exp > now ? cur : { n: 0, exp: now + ttl * 1000 };
      e.n += 1;
      mem.set(key, e);
      return e.n;
    },
    async decr(key) { const e = mem.get(key); if (e) e.n = Math.max(0, e.n - 1); },
  };
}

export async function hasPro(installId: string, secret: string | undefined, fetchFn: typeof fetch = fetch): Promise<boolean> {
  if (!secret) return false;
  try {
    const r = await fetchFn(`https://api.revenuecat.com/v1/subscribers/${encodeURIComponent(installId)}`, { headers: { authorization: `Bearer ${secret}` } });
    if (!r.ok) return false;
    const pro = ((await r.json()) as any)?.subscriber?.entitlements?.pro;
    if (!pro) return false;
    return pro.expires_date == null || new Date(pro.expires_date).getTime() > Date.now();
  } catch {
    return false;
  }
}

/** Reserve one scan. Returns a release() to call if the analysis fails, or null when over quota. */
export async function reserveScan(installId: string, pro: boolean, counter: Counter): Promise<(() => Promise<void>) | null> {
  if (pro) return async () => {};
  const key = `free:${installId}`;
  const n = await counter.incr(key, WEEK_S);
  if (n > FREE_PER_WEEK) { await counter.decr(key); return null; }
  return () => counter.decr(key);
}
