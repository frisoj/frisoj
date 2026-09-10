# PureLitter webshop

Next.js (App Router, TypeScript, Tailwind v4) D2C webshop for a self-cleaning
cat litter box, targeting the Netherlands and Belgium. `PureLitter` is a
placeholder brand — see `DECISIONS.md` for every invented placeholder to
replace before launch.

## Getting started

```bash
npm install
cp .env.example .env.local   # fill in real values — see below
npm run dev
```

Open [http://localhost:3000](http://localhost:3000).

### What works without any external credentials

The site, cart, and checkout form all work out of the box — the checkout API
creates an order and, without a Mollie key, redirects straight to the
thank-you page in a clearly-labelled "pending" state. See `DECISIONS.md`
("No live Supabase / Mollie / Resend credentials in this environment") for
exactly how each integration degrades gracefully.

### What needs real credentials

| Service | Env vars | Needed for |
|---|---|---|
| Supabase | `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY` | Durable orders/reviews (otherwise an in-memory mock is used), `/admin` login |
| Mollie | `MOLLIE_API_KEY`, `MOLLIE_WEBHOOK_URL` | Real payments (otherwise checkout skips straight to the thank-you page) |
| Resend | `RESEND_API_KEY`, `OWNER_NOTIFICATION_EMAIL` | Real transactional emails (otherwise they're logged, not sent) |
| Admin | `ADMIN_EMAILS`, `CRON_SECRET` | Who may sign in to `/admin`; securing the cron routes |
| Analytics | `NEXT_PUBLIC_GA4_ID`, `NEXT_PUBLIC_META_PIXEL_ID`, `NEXT_PUBLIC_TIKTOK_PIXEL_ID` | Purchase conversion events (only fire after a visitor accepts the cookie banner) |
| Search Console / Bing | `NEXT_PUBLIC_GOOGLE_SITE_VERIFICATION`, `NEXT_PUBLIC_BING_SITE_VERIFICATION` | Domain ownership verification meta tags |

See `.env.example` for the full, commented list.

## Database

Schema + Row Level Security lives in `supabase/migrations/`:

- `0001_init.sql` — products, variants, customers, orders, order_items,
  reviews, blog_posts.
- `0002_checkout.sql` — order lifecycle columns, order_status_history,
  processed_webhook_events (Mollie idempotency), review_invites.
- `0003_blog_faq.sql` — blog_posts metadata columns (meta description,
  hero image alt, author) + the new faq_items table.

Apply with the Supabase CLI: `supabase db push` (see `supabase/README.md`).
Blog hero-image uploads via `/admin/blog` additionally need a public
`blog-images` Storage bucket, created manually in the Supabase dashboard
(buckets aren't managed by SQL migrations) — without one, `/admin/blog`
still works with a plain image URL/path instead of a file upload.

## Scripts

```bash
npm run dev          # local dev server
npm run build        # production build
npm run lint          # ESLint
npm test              # Vitest unit tests
npm run test:e2e      # Playwright E2E + axe accessibility suite (builds + starts its own server on :3100)
npm run check:links   # static internal link/image checker (app/, components/, lib/blog-content/)
npm run check:jsonld  # structural JSON-LD validation against lib/jsonld.tsx
```

## Key routes

- `/`, `/zelfreinigende-kattenbak` — marketing + product pages.
- `/blog`, `/blog/[slug]` — kennisbank (5 seeded articles), paginated index.
- `/vergelijking` — honest comparison vs. 3-4 known competitor brands.
- `/veelgestelde-vragen` — full FAQ (26 questions, 6 categories).
- `/over-ons`, `/contact` — company story + contact form (Resend, spam-protected).
- `/algemene-voorwaarden`, `/privacyverklaring`, `/cookiebeleid`,
  `/herroepingsrecht`, `/verzending-en-retour`, `/garantie` — legal/service
  pages, linked from the footer.
- `/winkelwagen` — cart page; the mini-cart drawer is available from any
  page via the header's cart icon.
- `/afrekenen` — guest checkout (no account required).
- `/bedankt/[ordernummer]` — thank-you / payment-status page.
- `/order-volgen` — guest order tracking (order number + email).
- `/beoordelen/[token]` — review submission via a one-time emailed link.
- `/sitemap.xml`, `/robots.txt` — generated dynamically from the same
  content the site actually serves.
- `/admin` — order management, track & trace, refunds, review moderation,
  blog editor, FAQ editor (Supabase Auth + `ADMIN_EMAILS` allowlist).

See `DECISIONS.md` for the full rationale behind every architectural choice,
and `TESTING.md` for the manual test script covering real Mollie test-mode
payments end to end.

## Architecture overview

- **Next.js 16 App Router, TypeScript, Tailwind v4**, deployed on Vercel.
  Public marketing/content pages are static (`○`) or server-rendered
  on-demand (`ƒ`) — see the route list from `npm run build`'s output for
  which is which. There is no client-side SPA routing layer beyond what
  Next's App Router provides.
- **Data layer**: every table-backed feature (`lib/orders.ts`,
  `lib/blog.ts`, `lib/faq.ts`) reads/writes Supabase directly via the
  service-role key when `NEXT_PUBLIC_SUPABASE_URL` +
  `SUPABASE_SERVICE_ROLE_KEY` are set, and otherwise falls back to an
  in-memory mock store (same shape, not durable across restarts) — so the
  whole app is runnable and testable with zero external credentials. See
  DECISIONS.md, "No live Supabase / Mollie / Resend credentials".
- **Cart**: a client-only cookie (`lib/cart-context.tsx`), never read by
  the server — prices are always re-looked-up server-side at checkout from
  `lib/catalog.ts` by variant id, never trusted from the cookie.
- **Payments**: Mollie, created server-side (`app/api/checkout/route.ts`),
  confirmed via a webhook that always refetches the payment from Mollie's
  API (`app/api/mollie/webhook/route.ts`) — never trusts the webhook body.
- **Email**: Resend, with a mock/no-op fallback (logs instead of sending)
  when `RESEND_API_KEY` is unset.
- **Auth**: Supabase Auth gates `/admin/*` (`proxy.ts`), additionally
  checked against an `ADMIN_EMAILS` allowlist — a valid Supabase Auth
  account alone is not sufficient.
- **CI**: `.github/workflows/ci.yml` runs lint, typecheck, unit tests,
  link/JSON-LD checks, a production build, and the full Playwright E2E
  suite on every PR and push to `main`. No secrets required — everything
  above degrades gracefully without credentials.

## Deploying to production

See `LAUNCH-CHECKLIST.md` for the full step-by-step: Vercel project setup
(env vars per environment, production branch `main`), domain/DNS,
Supabase (separate prod/dev projects, migrations, backups, the
`blog-images` bucket), Resend domain verification, going live with Mollie,
and Search Console/Bing sitemap submission. `RUNBOOK.md` covers what to do
when something breaks after launch (a failed webhook, a missing email, a
return, a Mollie/Supabase outage).

## Monitoring & analytics

- **Vercel Analytics + Speed Insights** are wired into the root layout
  already (`app/layout.tsx`) — they activate automatically once the
  project is deployed on Vercel with both features enabled in the
  dashboard (Project → Analytics / Speed Insights tabs). No env var
  needed.
- **Error monitoring**: no live Sentry account exists yet. `lib/error-
  reporting.ts` is the single call site `app/error.tsx`/`app/global-
  error.tsx` already use — see `RUNBOOK.md`'s "Follow-ups" section for the
  exact steps to wire a real Sentry project (or Vercel's own runtime
  logs/Observability, which need no separate account) once one exists.
- **GA4 / Meta Pixel / TikTok Pixel**: fire only after a visitor accepts
  the cookie banner (`lib/analytics.ts`'s `hasMarketingConsent()`), and at
  most once per order for `purchase` (gated by
  `orders.conversion_tracked_at`, set server-side after the first fire —
  see `components/ConversionTracker.tsx`). To verify each fires correctly
  once real pixel IDs are configured:
  - **GA4**: open the site with `?gtm_debug=1` or use the GA4 DebugView
    (Admin → DebugView, with the
    [GA Debugger extension](https://chromewebstore.google.com/detail/google-analytics-debugger/jnkmfdileelhofjcijamephohjechhna)
    or a debug-mode cookie) — walk through view_item → add_to_cart →
    begin_checkout → purchase and confirm each event appears exactly once
    with `currency: "EUR"` and the correct `value`.
  - **Meta**: install the
    [Meta Pixel Helper](https://chromewebstore.google.com/detail/meta-pixel-helper/fdgfkebogiimcoedlicjlajpkdmockpc)
    Chrome extension; it shows every PageView/AddToCart/InitiateCheckout/
    Purchase event fired on the current page with its parameters.
  - **TikTok**: use TikTok's
    [Pixel Helper](https://chromewebstore.google.com/detail/tiktok-pixel-helper/aelgobmabdmlfmiblddjfnfjeklbibje)
    extension the same way.
  - In every case, first reload with dev tools' Network tab open and
    confirm **no** request to `googletagmanager.com`/
    `connect.facebook.net`/`analytics.tiktok.com` fires before the cookie
    banner is accepted (`tests/e2e/cookie-consent.spec.ts` checks this
    structurally in CI, but only because no pixel IDs are configured in
    that environment — re-check it manually once real IDs are live).
- **Uptime**: no monitor is configured (would need a live domain). Once
  deployed, add the homepage and `/api/mollie/webhook` (a `GET` to it
  should return a `405`/`400`, not a timeout — that alone confirms the
  function is alive) to a free monitor such as
  [UptimeRobot](https://uptimerobot.com) or
  [Better Uptime](https://betterstack.com/better-uptime), checking every
  5 minutes, alerting to the owner's email/phone.

## Adding a blog post

Via `/admin/blog` (Supabase Auth required) → "Nieuw artikel": write in
Markdown (a Schrijven/Voorvertoning tab toggles a live preview), set the
slug/meta description/hero image, and publish. See DECISIONS.md ("Blog/
kennisbank data layer") for the Markdown renderer's supported syntax
(headings, bold/italic, links, lists, tables, blockquotes) and the
`blog-images` Storage bucket requirement for file uploads (a plain image
URL/path always works even without one).

## Adding/editing an FAQ entry

Via `/admin/faq` → add/edit inline: question, answer, category, numeric
sort order, published toggle. The product page's 5-question preview and
the full `/veelgestelde-vragen` page both read from this same data, so one
edit updates both.

## Handling an order (day to day)

1. `/admin/orders` — filter by status or search by order number/customer
   email.
2. Open an order → move it through the lifecycle with the status buttons
   (besteld bij leverancier → verzonden → geleverd) — the UI only offers
   valid next steps (`lib/order-transitions.ts` enforces this).
3. When marking "Verzonden", fill in the carrier + track & trace code,
   save, then click "Verzendmail versturen" to send the shipping
   confirmation email with that code.
4. `/order-volgen` lets the customer check status themselves (order
   number + email) without contacting you.

## Issuing a refund

On the order's detail page in `/admin/orders`, click "Terugbetaling
starten" — confirm the browser dialog. Leave the amount blank for a full
refund, or enter a partial amount. This calls Mollie's refund API
directly; there's no separate "confirm the item was returned" step in the
software — that's a manual judgment call before clicking the button (see
`RUNBOOK.md`, "A return", for the fuller procedure).
