// Test-only stub for the `server-only` marker package, which unconditionally
// throws when required outside Next's RSC webpack build. Aliased in
// vitest.config.ts so lib/orders.ts etc. can be unit tested with plain
// Node/Vitest without pulling in the whole Next.js runtime.
export default undefined;
