# Manual test script — Phase 2 (cart, checkout, Mollie, emails, admin)

This walks through verifying the whole order flow end to end against a real
**Mollie test-mode** account and a real **Supabase** project. Automated unit
tests (`npm test`) cover cart math, checkout validation, webhook idempotency
and admin status transitions — this document covers everything that needs a
human clicking through the real flow.

## 0. Prerequisites

1. A Supabase project with both migrations applied (`supabase/migrations/0001_init.sql`
   and `0002_checkout.sql`) — see `supabase/README.md`.
2. A Mollie account in **test mode** (toggle in the Mollie dashboard) and its
   test API key (`test_...`).
3. `.env.local` filled in from `.env.example`, at minimum:
   `NEXT_PUBLIC_SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `MOLLIE_API_KEY`,
   `NEXT_PUBLIC_SITE_URL` (use an `ngrok`/similar HTTPS tunnel URL, or a
   Vercel preview URL — Mollie's webhook must be able to reach it over the
   public internet; `localhost` will not work for the webhook, only for the
   redirect).
4. `npm run dev` (or a deployed preview) running at that URL.

## 1. Happy path: iDEAL payment succeeds

1. Go to `/zelfreinigende-kattenbak`, click **In winkelwagen**. Confirm the
   mini-cart drawer opens showing the product, quantity 1, and a subtotal.
2. Reload the page — the cart should still show 1 item (cookie persistence).
3. Go to `/winkelwagen`, increase quantity to 2, confirm subtotal doubles and
   "Verzending: Gratis" is shown. Set it back to 1.
4. Click **Afrekenen**. Fill in the form with a Dutch address
   (postcode `1234 AB`), leave billing address same, check both the terms
   checkbox and (optionally) the newsletter checkbox, choose **iDEAL**.
5. Submit. You should be redirected to Mollie's test-mode iDEAL bank picker.
   Choose any test bank and select **Paid** on Mollie's simulated bank page.
6. You should land back on `/bedankt/KB-2026-XXXXXX` showing the **paid**
   state (order number, item summary, delivery estimate, "wat gebeurt er
   nu"). Reload the page — it should stay in the paid state (this proves the
   status is read from Supabase, not just guessed from the URL).
7. In the Supabase table editor, confirm the `orders` row has
   `status = 'betaald'`, `paid_at` set, `mollie_payment_id` set, and one
   `order_status_history` row per transition.
8. Confirm exactly one row was written to `processed_webhook_events` for this
   payment — this is the idempotency ledger; re-triggering the same webhook
   delivery from the Mollie dashboard ("Webhook" tab on the payment) should
   NOT create a second row and should NOT send a second confirmation email.
9. Check the inbox for the email you checked out with: **order confirmation**
   email should have arrived (subject `Bestelbevestiging KB-2026-XXXXXX`),
   and `OWNER_NOTIFICATION_EMAIL` should have received the **new order**
   notification with the supplier-facing details.
10. If you granted marketing consent (`localStorage.setItem('pl_marketing_consent','granted')`
    in devtools before loading the thank-you page) confirm `orders.conversion_tracked_at`
    gets set, and it is **not** set again on a reload (max once per order).

## 2. Payment fails / is canceled / expires

1. Repeat steps 1-5 above, but on Mollie's test bank page choose **Failed**
   (or **Cancelled**, or let it sit until it **Expired** — Mollie test mode
   lets you pick the outcome).
2. You should land on `/bedankt/KB-2026-XXXXXX` showing the **"Betaling
   mislukt"** state with an **"Opnieuw betalen"** button.
3. Confirm in Supabase: `orders.status = 'mislukt'`.
4. Click **Opnieuw betalen** — this should start a *new* Mollie payment for
   the *same* order (no new order row is created) and redirect you back to
   Mollie. Complete it with **Paid** this time and confirm the thank-you page
   now shows the paid state.

## 3. Guest order tracking

1. Go to `/order-volgen`, enter the order number from step 1 and the email
   used at checkout. Confirm the status is shown.
2. Try a wrong email with the right order number — confirm it returns "Geen
   bestelling gevonden" rather than any order details.

## 4. Admin flow

1. In Supabase Auth, create a user with an email you'll also add to
   `ADMIN_EMAILS` in `.env.local` (comma-separated), and set a password.
2. Go to `/admin/login`, sign in. Confirm a non-allowlisted email (even with
   a valid Supabase Auth password) is redirected back to `/admin/login`.
3. On `/admin/orders`, confirm the order from step 1 appears; filter by
   status `betaald` and search by its order number and by the customer's
   email — all three should find it.
4. Open the order detail page. Click **→ Besteld bij leverancier**, then
   **→ Verzonden**. Fill in a carrier + track & trace code and save, then
   click **Verzendmail versturen** — confirm the shipping confirmation email
   arrives with the track & trace code.
5. Click **→ Geleverd**. Confirm `orders.delivered_at` is set.
6. Wait for (or manually trigger, see below) the review-invite cron 7 days
   later, or temporarily lower `daysSinceDelivery` for a local test — confirm
   the review-invite email arrives with a working `/beoordelen/<token>` link,
   that submitting the form creates a `reviews` row with `is_published =
   false`, and that re-opening the same link afterwards shows "already used".
7. On `/admin/reviews`, click **Goedkeuren** on that review — confirm
   `is_published` flips to true (once the product page is wired to read real
   reviews from Supabase, it would now appear there).
8. Back on the order detail page, click **Terugbetaling starten** (confirm
   the browser confirmation dialog), leave the amount blank for a full
   refund. Confirm in the Mollie dashboard that a refund was created, and
   that `orders.status` becomes `terugbetaald`.

## 5. Abandoned cart email

1. Start a checkout with the newsletter checkbox **checked**, fill in a
   valid email, but do NOT complete the Mollie payment (close the tab).
2. Manually call `GET /api/cron/abandoned-cart` (with the `Authorization:
   Bearer <CRON_SECRET>` header if you set one) — or wait for the hourly
   Vercel Cron. Because the real gate is "24h old", either temporarily lower
   `olderThanHours` in `lib/orders.ts:getOrdersForAbandonedCartEmail` for a
   local test, or backdate the row's `created_at` in Supabase.
3. Confirm the abandoned-cart email arrives, and confirm a second cron run
   does NOT send it again (`abandoned_email_sent_at` is now set).
4. Repeat with the newsletter checkbox **unchecked** — confirm no email is
   ever sent for that order, no matter how old it gets.

## 6. Webhook security checks (can be done without the UI)

1. `curl -X POST https://<your-url>/api/mollie/webhook -d "id=tr_doesnotexist"`
   should return `200` with `{"ok":true,"skipped":"payment_not_found"}` (or
   `"order_not_found"`) — it must never trust the posted body for anything
   beyond looking the real payment up at Mollie.
2. Re-post the exact same webhook body for a real, already-processed payment
   twice in a row — the second call should return `{"ok":true,"skipped":"duplicate"}`
   and must not send a second confirmation email or change the order twice.
