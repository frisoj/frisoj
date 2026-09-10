// Minimal, dependency-free error reporting used by app/error.tsx and
// app/global-error.tsx (client-side render/hydration errors — server-side
// route handlers already log their own operational errors directly via
// console.error with no personal data, e.g. app/api/mollie/webhook,
// app/api/checkout).
//
// No Sentry account/DSN exists in this environment, so this intentionally
// does NOT pull in @sentry/nextjs — installing an SDK with nothing to
// point it at would just be dead weight and a false sense of monitoring.
// What this DOES do:
//   - log a structured, PII-free line to the server console (order/page
//     context only, never name/email/address — matches the same rule
//     DECISIONS.md already documents for the checkout/webhook routes).
//   - call `window.Sentry.captureException` IF a Sentry (or Sentry-
//     compatible) snippet is ever added to the page later — this function
//     is the one call site every error boundary already uses, so wiring
//     real error monitoring later is "add the SDK + call reportError",
//     not "find every place an error can happen".
// See RUNBOOK.md ("Monitoring") for the concrete steps to turn this into
// real Sentry (or Vercel's own error/log drains) once an account exists.
export function reportError(error: unknown, context: Record<string, string> = {}) {
  const message = error instanceof Error ? error.message : String(error);
  const digest = error instanceof Error && "digest" in error ? String((error as { digest?: unknown }).digest) : undefined;

  console.error("[client-error]", { message, digest, ...context });

  const sentry = (globalThis as typeof globalThis & { Sentry?: { captureException?: (e: unknown) => void } }).Sentry;
  sentry?.captureException?.(error);
}
