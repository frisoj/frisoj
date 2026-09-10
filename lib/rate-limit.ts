import "server-only";

// Minimal in-memory fixed-window rate limiter for the checkout/payment
// creation endpoint. Good enough for a single-instance deployment; if the
// app scales to multiple serverless instances without shared state, swap
// this for a shared store (e.g. Upstash Redis) — noted in DECISIONS.md.

type Bucket = { count: number; resetAt: number };

const globalKey = "__purelitter_rate_limit__";
type GlobalWithBuckets = typeof globalThis & { [globalKey]?: Map<string, Bucket> };
const g = globalThis as GlobalWithBuckets;

function buckets(): Map<string, Bucket> {
  if (!g[globalKey]) g[globalKey] = new Map();
  return g[globalKey]!;
}

export function rateLimit(key: string, limit: number, windowMs: number): { allowed: boolean; remaining: number } {
  const now = Date.now();
  const store = buckets();
  const existing = store.get(key);

  if (!existing || existing.resetAt <= now) {
    store.set(key, { count: 1, resetAt: now + windowMs });
    return { allowed: true, remaining: limit - 1 };
  }

  if (existing.count >= limit) {
    return { allowed: false, remaining: 0 };
  }

  existing.count += 1;
  return { allowed: true, remaining: limit - existing.count };
}

export function clientIpFrom(headers: Headers): string {
  const forwarded = headers.get("x-forwarded-for");
  if (forwarded) return forwarded.split(",")[0].trim();
  return headers.get("x-real-ip") ?? "unknown";
}
