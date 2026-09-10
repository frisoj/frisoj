# Decisions & placeholders — Phase 1

This file lists every invented placeholder and notable decision made while
building Phase 1 of the PureLitter webshop, so the real client can find and
replace them. Search the codebase for the exact strings/values below.

## Brand & business (all placeholders — replace with real client info)

| Placeholder | Value used | Found in |
|---|---|---|
| Brand name | `PureLitter` | `lib/site.ts`, throughout copy |
| Domain | `purelitter.nl` | `lib/site.ts` (`site.domain`, `site.url`) |
| Legal entity | `PureLitter B.V.` | `lib/site.ts` (`site.legalName`), footer |
| KVK number | `[KVK-NUMMER]` | `lib/site.ts`, footer |
| BTW number | `[BTW-NUMMER]` | `lib/site.ts`, footer |
| Company address | `[BEDRIJFSADRES]` | `lib/site.ts`, footer |
| Company email | `info@purelitter.nl` | `lib/site.ts`, footer |
| Phone number | `[TELEFOONNUMMER]` | `lib/site.ts` (not yet shown in UI, reserved for Phase 2/3 contact page) |
| Tagline | `Nooit meer scheppen` | `lib/site.ts`, hero copy |

All of the above live in one place — `lib/site.ts` — specifically so they can
be updated in a single file once real data is available.

## Product data (placeholders — replace with real specs/photography)

- Product name: "PureLitter Zelfreinigende Kattenbak", slug
  `/zelfreinigende-kattenbak`.
- Price: **€179 incl. BTW** (per the brief). Cost price range €55-80 is noted
  here for context but is not shown anywhere on the public site.
- Specs table on the product page (afmetingen, gewichtslimiet, geluidsniveau,
  app-functies, stroomverbruik) are **invented, realistic-looking
  placeholders**, each explicitly labelled "placeholder" in the source
  (`app/zelfreinigende-kattenbak/page.tsx`) and with a visible disclaimer
  under the table on the page itself. Replace with the supplier's real
  spec sheet before launch.
- "Wat zit in de doos" list is a plausible placeholder based on typical
  self-cleaning litter box bundles (unit, waste bin + liners, power cable,
  manual, app access) — confirm against the actual supplier's package
  contents.
- Comparison table (PureLitter vs. handmatige kattenbak) uses reasonable,
  defensible claims (time saved, odor control, no daily scooping) rather
  than fabricated numbers — still worth validating against real user
  research once available.
- Product photography: **no real photos exist yet**. Hero and gallery use
  hand-authored placeholder SVGs (`public/images/hero-litterbox.svg`,
  `product-1.svg` .. `product-4.svg`) — simple, on-brand vector illustrations
  with a visible "Placeholder" caption baked into each image, so nobody
  mistakes them for final product photography. No external image URLs were
  fetched, per the brief. Replace with real photography via `next/image`
  (same `<Image>` usage already in place).

## Content honesty decisions

- **Social proof / reviews**: Phase 1 explicitly ships with an *honest empty
  state* on both the homepage and product page ("we're new, no reviews yet")
  instead of fabricated testimonials or star ratings, per the brief's "no
  fake reviews" requirement. The `reviews` table and its public-read RLS
  policy are ready for real reviews once customers submit them.
- **No fake urgency/discounts**: no countdown timers, "X left in stock", or
  fake original/sale price pairs anywhere on the site.
- FAQ content on both pages is genuine, realistic Q&A about a self-cleaning
  litter box (compatible litter, cat safety, multi-cat households, delivery,
  returns, warranty) — not placeholder lorem ipsum — but should be reviewed
  by the client/supplier for factual accuracy against the real product.

## Design decisions

- **Color palette** — warm, calm, premium (not a generic SaaS-blue template):
  - Accent (terracotta/clay): `#C05C34`, hover/dark state `#A04A29`, light
    tint `#F3E4D8` (used for the USP bar background and small accents).
  - Background: warm off-white cream `#FAF7F2`; card/surface white `#FFFFFF`.
  - Text: warm near-black ink `#241F1A`, muted warm gray `#6B6459` for
    secondary text.
  - Border: `#E7E0D6`.
  - All tokens are defined once in `app/globals.css` under `:root` and
    exposed to Tailwind v4 via `@theme inline` (Tailwind v4 uses CSS-based
    config rather than a `tailwind.config.ts`, so this file *is* the design
    token configuration referenced in the brief).
- **Typography**:
  - Heading font: **Fraunces** (a characterful, warm serif with personality —
    avoids the generic geometric-sans look of most dropshipping templates),
    loaded via `next/font/google` (self-hosted, no external font requests at
    runtime) in `app/layout.tsx`, weights 500/600/700 incl. italic.
  - Body font: **Inter** for maximum readability at small sizes, also via
    `next/font/google`, weights 400-700.
  - Both are exposed as CSS variables (`--font-fraunces`, `--font-inter`) and
    mapped to Tailwind's `font-heading` / `font-sans` via `@theme inline`.
- **Layout/tone**: generous whitespace, rounded-2xl/3xl cards, soft borders
  instead of heavy shadows, to read as calm/premium rather than a loud
  discount-store aesthetic.

## Technical decisions

- **Next.js 16 / React 19 / Tailwind v4** were installed as "latest stable"
  at the time of building (September 2026). Tailwind v4's CSS-first config
  means there is intentionally no `tailwind.config.ts` — tokens live in
  `app/globals.css`.
- **No cart/checkout logic in Phase 1**, per scope: the "In winkelwagen"
  buttons (product page and sticky mobile bar) are present for the
  interaction pattern and layout, but are `disabled` with a `title`
  explaining checkout arrives in Phase 2.
- **Local-only placeholder images**: gallery/hero images are hand-authored
  local SVGs, not fetched from any external source. `next.config.ts` sets
  `images.dangerouslyAllowSVG` (scoped with a strict `contentSecurityPolicy`)
  so `next/image` can optimize these local placeholder SVGs; this should be
  revisited once real raster photography replaces them (SVG allowance can
  likely be removed at that point unless line-art assets are kept).
- **Supabase**: schema designed as a single migration
  (`supabase/migrations/0001_init.sql`) with RLS enabled on every table.
  Public (anon) read access is limited to `is_published = true` rows on
  `products`, `product_variants` (via parent product), `reviews`, and
  `blog_posts`. `customers`, `orders`, `order_items` have no public access;
  a signed-in customer may read their own record via `auth.uid()`, and all
  other access is intended to go through the `service_role` key from
  trusted server code (Phase 2 checkout/webhook handlers). No live Supabase
  project was created in this phase, per scope — see `supabase/README.md`
  for how to apply the migration when one exists.
- **Nav links**: "Hoe werkt het", "Vergelijking", "Blog", "FAQ", "Contact"
  intentionally 404 for now (Phase 2/3 scope) — only "Home" and "Product"
  resolve in Phase 1, as instructed.
- **Metadata**: per-page `Metadata` (title/description/canonical/OG) is set
  on both the home page and product page; root layout sets the default
  title template, Organization + WebSite JSON-LD (`app/layout.tsx`). Values
  reference the placeholder domain `https://www.purelitter.nl` —
  `NEXT_PUBLIC_SITE_URL` in `.env.example` should become the source of truth
  for this once deployed, and `metadataBase` should be wired to read from it
  in a later phase.

## Verified before handoff (Phase 1)

- `npm run lint` — passes with 0 errors, 0 warnings.
- `npm run build` — passes, all routes (`/`, `/zelfreinigende-kattenbak`)
  prerender as static content.

---

# Decisions & placeholders — Phase 2 (cart, checkout, Mollie, emails, admin)

## Cart persistence

- **Cookie-based, client-only** (`lib/cart-context.tsx`), as instructed —
  "simplest choice". A single JSON cookie (`pl_cart`, 30-day max-age,
  `samesite=lax`) is read/written entirely in the browser via
  `document.cookie`; nothing server-side ever reads it. This was chosen over
  `localStorage` only because the brief named cookies explicitly; either
  would have worked equally well since nothing server-rendered depends on
  cart contents. The cart is hydrated after mount (not during SSR) to avoid
  a server/client markup mismatch — see the `isHydrated` flag exposed by
  `useCart()`.
- Prices are **never trusted from the cart cookie** at checkout — a
  tampered cookie can change what's displayed client-side, but
  `app/api/checkout/route.ts` re-looks-up every line's price server-side via
  `lib/catalog.ts` by `variantId` before creating the order.

## No live Supabase / Mollie / Resend credentials in this environment

None of the three external services have real credentials available here.
Rather than blocking Phase 2 on provisioning them, every integration point
is built against the real SDKs/clients with a clearly-labelled fallback so
the whole flow is testable end-to-end today, and switches over to "real"
behaviour the moment env vars are set — no code changes needed:

- **Supabase** (`lib/supabase/server.ts`, `lib/orders.ts`): if
  `NEXT_PUBLIC_SUPABASE_URL`/`SUPABASE_SERVICE_ROLE_KEY` are unset, every
  data-layer function in `lib/orders.ts` falls back to an in-memory mock
  store (a module-level singleton on `globalThis`, see `mockDb()`). This is
  **not durable** — it resets on every server restart/redeploy — and is only
  meant for local dev/demo/tests. `npm test` runs entirely against this mock
  store. Once a real project exists, set the env vars and nothing else
  changes.
- **Mollie** (`lib/mollie.ts`): if `MOLLIE_API_KEY` is unset,
  `getMollieClient()` returns `null` and the checkout route creates the
  order (status `pending`) but redirects straight to the thank-you page
  instead of to a real payment — the thank-you page then correctly shows the
  "pending" state. No payment can be simulated without a real (test-mode)
  Mollie account; see TESTING.md for the full manual walkthrough once one is
  provisioned.
- **Resend** (`lib/email/send.ts`): if `RESEND_API_KEY` is unset, every
  `send*Email` function logs `[email:skip] ... would have sent "<subject>"`
  instead of calling the API — no PII in that log line, just the subject.
- **Supabase Auth for /admin** (`middleware.ts`→`proxy.ts`,
  `app/admin/login`): needs `NEXT_PUBLIC_SUPABASE_URL` +
  `NEXT_PUBLIC_SUPABASE_ANON_KEY` at minimum (to sign in) plus a real user
  created in Supabase Auth. Without them, `/admin/login` shows an explicit
  "not configured yet" notice instead of a silent failure.

## Order number format & guest lookup

- Format `KB-<year>-<6 random digits>` (`lib/order-number.ts`), e.g.
  `KB-2026-482913`. Random rather than strictly sequential, to avoid a
  race condition between concurrent checkouts without a DB sequence/lock;
  `createPendingOrder` retries a few times on the (very unlikely)
  unique-constraint collision.
- The **thank-you page** (`/bedankt/[ordernummer]`) looks the order up by
  number alone (no email required in the URL) since it's the direct Mollie
  `redirectUrl` target and the number itself isn't guessable in practice
  within a session. **Guest order tracking** (`/order-volgen`) and any other
  "look up my own order" path additionally require the exact email used at
  checkout (`getOrderByNumberAndEmail`) — see the RLS note in
  `supabase/migrations/0002_checkout.sql` for why this check lives in
  server code rather than in an RLS policy.

## Payment / webhook security

- The Mollie webhook (`/api/mollie/webhook`) **never trusts the POST body**
  beyond extracting the payment id — it always refetches the payment from
  Mollie's API before applying any status change, per the brief.
- **Idempotency**: keyed on `(paymentId, resultingStatus)`, recorded in the
  `processed_webhook_events` table (or its mock-store equivalent). This
  means a genuinely new transition (`open`→`paid`) is never blocked by an
  earlier delivery of `open`, but a redelivered `paid` webhook for the same
  payment is a no-op — see `tests/webhook-idempotency.test.ts`.
- **Rate limiting** (`lib/rate-limit.ts`) is a simple in-memory fixed-window
  limiter keyed by client IP, applied to `/api/checkout` and
  `/api/checkout/retry` (8 req/min) and `/api/orders/lookup` (15 req/min).
  This is single-instance only — if the app ever scales to multiple
  serverless instances without shared state, swap this for a shared store
  (e.g. Upstash Redis).
- **No personal data in logs**: server-side `console.error` calls only ever
  log the order number, never email/address/phone (see
  `app/api/checkout/route.ts`, `app/api/checkout/retry/route.ts`).
- **CSRF**: `/api/checkout` and `/api/checkout/retry` use a double-submit
  cookie token (`lib/csrf.ts`) — the checkout/thank-you pages set a
  `csrf_token` cookie server-side and the client must echo it back in an
  `x-csrf-token` header. Admin mutations use Next.js Server Actions
  (`lib/admin-actions.ts`), which have Next's built-in same-origin/Origin
  header CSRF protection.

## Conversion tracking

- `hasMarketingConsent()` (`lib/analytics.ts`) is an explicit **stub** — it
  reads a single `localStorage` flag (`pl_marketing_consent`). The real
  cookie-consent banner is Phase 3 scope; when it ships, only this one
  function needs to change (e.g. to read from the consent-management
  library's API instead), nothing else in the purchase-tracking path.
- Fired at most once per order: `ConversionTracker` only fires
  GA4/Meta/TikTok pixels when `orders.conversion_tracked_at` is still null
  (passed from the server-rendered thank-you page), and then calls
  `/api/orders/track-conversion` to set that flag server-side — so even a
  page reload or a retried fetch can't double-fire.

## Emails via Resend

- Sender `bestellingen@purelitter.nl` and owner recipient
  `orders@purelitter.nl` (overridable via `OWNER_NOTIFICATION_EMAIL`) are
  both **placeholders** pending real domain verification in Resend and a
  real owner inbox — see `.env.example`.
- Templates (`lib/email/templates.ts`) are hand-written table-based HTML
  (for broad email-client support) with inlined colors matching
  `app/globals.css`'s tokens (CSS custom properties don't work reliably in
  email), plus a plain-text fallback for every message — Resend's `text`
  param is always sent alongside `html`.
- **Time-triggered emails use Vercel Cron** (`vercel.json`: abandoned-cart
  hourly, review-invites daily at 08:00 UTC), per the brief's "simplest
  choice" — both routes are protected by an optional `CRON_SECRET` bearer
  token and are idempotent (they only ever pick up orders where the
  relevant `*_sent_at` column is still null, and set it before returning).

## Admin

- Supabase Auth (email/password) gates `/admin/*` via `proxy.ts` (Next.js
  16 renamed the `middleware.ts` convention to `proxy.ts` — migrated during
  this phase; export is now named `proxy` instead of `middleware`), which
  additionally checks the signed-in user's email against `ADMIN_EMAILS` —
  having *any* Supabase Auth account is not sufficient on its own.
- Status transitions are constrained by an explicit forward-only state
  machine (`ORDER_STATUS_TRANSITIONS` in `lib/supabase/types.ts`, guarded by
  `lib/order-transitions.ts`) so the admin UI can only ever offer valid next
  steps — see `tests/admin-status-transitions.test.ts`.
- Refunds call `mollie.paymentRefunds.create(...)` directly from a
  server action, gated by a JS `confirm()` dialog on the button
  (`components/admin/ConfirmSubmitButton.tsx`) per the brief's "with
  confirmation" requirement.
- Deliberately unstyled/utilitarian beyond the shared Tailwind tokens —
  "simple, functional design" was explicit in the brief; no design-system
  polish was spent here.

## Testing

- **Vitest** was added (none was present before) — pinned to `vitest@2` /
  `@types/node@^20` because the latest `vitest@5` requires
  `@types/node@^22`, which conflicts with `@mollie/api-client`'s own
  `@types/node-fetch` peer range in this project; revisit the pin once
  `@types/node` is bumped project-wide.
- `server-only` (which unconditionally throws outside Next's RSC bundler)
  is aliased to a no-op stub in `vitest.config.ts` so `lib/orders.ts` and
  friends can be unit tested directly with plain Node — see
  `tests/stubs/server-only.ts`.
- 24 tests across 4 files: cart price math, checkout zod validation,
  webhook idempotency (against the mock order store), and admin status
  transitions. See TESTING.md for the manual, human-in-the-loop test script
  covering real Mollie test-mode payments, real emails and the admin UI.

## Verified before handoff (Phase 2)

- `npm run lint` — 0 errors, 0 warnings.
- `npm run build` — passes; see the route list in the build output for
  every new page/API route.
- `npm test` — 24/24 passing.
