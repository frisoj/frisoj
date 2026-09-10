// Order number generation: format KB-2026-000123 (brief-specified format,
// "KB" = "KattenBak" — kept as a short, brand-agnostic prefix so it survives
// a future rename without code changes).
//
// The sequence number is a random 6-digit number rather than a strictly
// incrementing counter, to avoid a race condition between concurrent
// checkouts without a database sequence/lock. Collision probability is
// negligible for this shop's order volume; lib/orders.ts still retries on a
// unique-constraint violation to be safe.

export function generateOrderNumber(date: Date = new Date()): string {
  const year = date.getFullYear();
  const sequence = Math.floor(Math.random() * 900_000 + 100_000); // 100000-999999
  return `KB-${year}-${sequence}`;
}

export function isValidOrderNumber(value: string): boolean {
  return /^KB-\d{4}-\d{6}$/.test(value);
}
