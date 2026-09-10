# Runbook

Operational procedures for the PureLitter webshop once it is live. This is
written for whoever is on call — the technical owner, or a developer
brought in to help — not for the shop owner's day-to-day order handling
(that's in README.md, "Handling an order").

## Failed Mollie webhook

**Symptom:** an order stays `pending`/`mislukt` in `/admin/orders` even
though the customer says they paid, or `orders.status` never advances.

1. Check the Mollie Dashboard → the payment in question → "Webhook" tab.
   It shows every delivery attempt and the HTTP status your app returned.
   - `200 {"ok":true}` with no status change: the payment's real status at
     Mollie (refetch it — `payments.get`) doesn't match what you expected.
     Check `payment.status` in the Mollie dashboard directly; the webhook
     handler (`app/api/mollie/webhook/route.ts`) always trusts *that*, not
     the customer's or your own assumption.
   - A non-200 response, or no delivery recorded at all: Mollie couldn't
     reach `MOLLIE_WEBHOOK_URL`. Check it resolves publicly (not
     `localhost`, not behind auth) and matches the deployed domain exactly.
   - `500`: check Vercel's function logs for the request (filter by
     `/api/mollie/webhook`); the route never leaks PII in its own
     `console.error` calls, so the log itself is safe to paste into a bug
     report.
2. **Manual recovery** (webhook genuinely never arrived and won't retry):
   in the Mollie dashboard, click "Test webhook" on the payment to redeliver
   it — the idempotency ledger (`processed_webhook_events`) means this is
   always safe to do even if it's a duplicate; it's a no-op if already
   processed.
3. If Mollie's webhook system itself is down (check
   [status.mollie.com](https://status.mollie.com)), the payment is still
   real and captured on Mollie's side — you just need to reconcile
   manually: find the order in `/admin/orders`, cross-check
   `mollie_payment_id` against the Mollie dashboard's payment status, and
   use the admin status-transition buttons to bring the order in line
   once you've confirmed it really was paid. Do **not** guess — always
   confirm against Mollie's dashboard first.

## Customer says they never got their confirmation/shipping email

1. `/admin/orders` → find the order → confirm the relevant `*_sent_at`
   timestamp is actually set (`paid_at` implies a confirmation email
   should have gone out; check the order detail page).
2. Check Resend's dashboard (Logs) for that email address/order number —
   Resend shows delivery/bounce/spam-complaint status per message. A
   "delivered" status there but no email in the inbox almost always means
   the spam folder — ask the customer to check it, and to add
   `bestellingen@<yourdomain>` (or whatever `RESEND_FROM_EMAIL`/sender you
   configured) to their contacts.
3. If Resend shows the send genuinely failed (bounced, domain issue): check
   Resend's domain verification status (Domains tab) — SPF/DKIM/DMARC all
   need to show green. A newly-added sending domain can take up to 24-48h
   to fully propagate DNS.
4. If the email was never even attempted (no log entry in Resend at all):
   check `RESEND_API_KEY` is set in the relevant Vercel environment — if
   it's missing, `lib/email/send.ts` silently *logs* the email instead of
   sending it (`[email:skip] ... would have sent "<subject>"`), by design
   for local dev, but that's a real problem in production. Check Vercel's
   function logs for that log line to confirm this is what happened, then
   fix the env var and manually resend from `/admin/orders` (the "Verzendmail
   versturen" button re-sends the shipping email; there's no manual resend
   button for the order-confirmation email — see "Handling an order" in
   README.md, or trigger it via a direct Resend dashboard resend of the
   originally-attempted payload if Resend logged it).

## A return

1. Customer contacts you within the 14-day withdrawal period (or your
   stated return window — see `/herroepingsrecht` and
   `/verzending-en-retour` for the exact policy text once the legal review
   placeholders in those pages are filled in).
2. Confirm the order number + email match a real order in `/admin/orders`.
3. Once the item is physically back (per your supplier's return address —
   see `LAUNCH-CHECKLIST.md`, "supplier confirmed" line), go to the order
   detail page and click "Terugbetaling starten". Leave the amount blank
   for a full refund, or enter a partial amount. Confirm the browser
   dialog. This calls `mollie.paymentRefunds.create(...)` directly —
   there is no separate "did the item actually arrive back" gate in the
   software; that's a manual judgment call before you click the button.
4. Confirm in the Mollie dashboard that the refund was created, and that
   `orders.status` became `terugbetaald`.
5. If the refund fails (insufficient balance in your Mollie account,
   payment too old to refund, etc.), Mollie's dashboard will show the
   specific error on the payment. Some payment methods (e.g. certain
   `klarna` flows) have their own refund constraints — check Mollie's docs
   for that method if a refund is rejected.

## Mollie outage

Check [status.mollie.com](https://status.mollie.com) first.

- **Payments can't be created**: checkout will show "Betaling kon niet
  worden gestart. Probeer het opnieuw." to customers (the generic error
  from `app/api/checkout/route.ts`'s catch block) — this is expected,
  correct behavior, not a bug to fix. There's nothing to do but wait for
  Mollie to recover; consider a banner on the homepage if the outage is
  extended (not built — would need a manual content change, e.g. a
  temporary note added to `app/page.tsx`).
- **Webhooks delayed/not arriving**: orders will sit in `pending` longer
  than usual even though the customer did pay. Don't manually mark them
  paid without checking Mollie's dashboard payment status directly first
  — see "Failed Mollie webhook" above.

## Supabase outage

Check [status.supabase.com](https://status.supabase.com).

- **The whole site**: most pages don't depend on Supabase being up at
  request time (product/blog/FAQ content is either static or falls back
  to the in-memory mock store if `NEXT_PUBLIC_SUPABASE_URL` is literally
  unset — but if it's *set* and the project is just down, calls will
  fail/timeout, not silently fall back). Checkout, order tracking, and
  `/admin` will all fail while Supabase is down, since those always need
  a live read/write.
- **`/admin` specifically**: Supabase Auth being down means nobody can log
  in to `/admin` at all (`proxy.ts` calls `supabase.auth.getUser()` on
  every request). No workaround short of Supabase recovering.
- Once Supabase recovers, nothing needs to be manually reconciled on your
  side — no local queue or buffer exists that needs replaying. Orders that
  failed to create during the outage simply never got created (the
  customer would have seen a checkout error and, most likely, not
  completed a payment at all, since checkout creates the order *before*
  redirecting to Mollie).

## Rolling back a bad deploy

Vercel keeps every deployment. In the Vercel dashboard → Deployments →
find the last known-good one → "..." → "Promote to Production". This is
instant and doesn't require a new git push/build.

## Follow-ups noted during the Phase 4 audit, not yet done

- **CSP nonce**: `next.config.ts`'s Content-Security-Policy currently
  allows `'unsafe-inline'` on `script-src` rather than using a per-request
  nonce. Wiring a nonce through Next's inline hydration data, the JSON-LD
  `<script>` blocks (`lib/jsonld.tsx`), and the post-consent analytics
  snippets is a larger, more invasive change than this audit pass covered
  — worth doing as a follow-up if a stricter CSP is desired.
- **Sentry (or equivalent)**: no live account exists yet. `lib/error-
  reporting.ts` is the one call site to wire up:
  1. Create a Sentry project (or use Vercel's own "Observability" /
     runtime logs, which need no separate account since you're already on
     Vercel).
  2. `npm install @sentry/nextjs` and run `npx @sentry/wizard@latest -i
     nextjs` (it will ask for your DSN and wire `sentry.client.config.ts`/
     `sentry.server.config.ts`/`instrumentation.ts` automatically).
  3. In `lib/error-reporting.ts`, replace the `window.Sentry` lookup with
     a real `import * as Sentry from "@sentry/nextjs"` and call
     `Sentry.captureException(error)` directly — remove the dynamic
     lookup, it was only there to avoid depending on an SDK that wasn't
     installed.
  4. Add `SENTRY_DSN`/`NEXT_PUBLIC_SENTRY_DSN` (whichever the wizard
     configures) to Vercel's environment variables for Production and
     Preview.
  5. Confirm it works: throw a test error somewhere (e.g. temporarily add
     `throw new Error("test")` to a page) and confirm it appears in the
     Sentry dashboard within a minute or two, then remove the test throw.
