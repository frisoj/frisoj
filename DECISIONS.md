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

---

# Decisions & placeholders — Phase 3 (blog, comparison, FAQ, legal, admin, SEO)

## Blog/kennisbank data layer

- `lib/blog.ts` follows the exact same mock/Supabase fallback pattern as
  `lib/orders.ts` (Phase 2): reads/writes go to Supabase's `blog_posts`
  table when `NEXT_PUBLIC_SUPABASE_URL` + `SUPABASE_SERVICE_ROLE_KEY` are
  set, and otherwise fall back to an in-memory mock store (module-level
  singleton on `globalThis`), seeded with the 5 real articles below. This
  means `/blog` and `/admin/blog` both work today with **no live Supabase
  project**, and content added via `/admin/blog` is visible immediately in
  that same server process — it is **not durable** across restarts without
  a real database, exactly like the Phase 2 order mock store.
- `supabase/migrations/0003_blog_faq.sql` extends `blog_posts` (from
  `0001_init.sql`) with `meta_description`, `hero_image_alt`,
  `author_name`, and adds a new `faq_items` table with the same
  mock/Supabase pattern (`lib/faq.ts`).
- The 5 seeded articles (`lib/blog-content/*.md.ts`) are real, hand-written
  Dutch content (1000-1500 words each), not lorem ipsum: a 2026 buying
  guide, a cost/benefit analysis, a wenschema, a kattenbakvulling guide,
  and a "why does it smell" troubleshooting guide. Every numeric claim
  either comes from the Phase 1 placeholder spec sheet (already flagged
  there) or is explicitly hedged/omitted — no invented statistics. Where a
  number genuinely couldn't be estimated responsibly (e.g. exact vulling
  quantities, which vary per bak model), the article says so explicitly
  rather than inventing one. All health/medical framing points to "raadpleeg
  een dierenarts" — no diagnostic or treatment claims are made anywhere.
- `lib/markdown.ts` is a small, dependency-free Markdown→HTML renderer
  (headings, paragraphs, bold/italic, links, lists, GFM-style tables,
  blockquotes) rather than pulling in `remark`/`react-markdown` — the
  content set is fully controlled (seed data + the `/admin/blog` editor
  behind the auth-gated `/admin`), so a general CommonMark parser wasn't
  needed. Its output is only ever rendered via `dangerouslySetInnerHTML`
  for content that is either seeded by us or entered by an authenticated
  admin — never raw public user input.
- Blog cover images are hand-authored placeholder SVGs
  (`public/images/blog/*.svg`), following the exact same "Placeholder"
  caption convention as the Phase 1 product images — replace with real
  photography/illustration per article before launch.

## Comparison page (`/vergelijking`)

- Our own row uses the Phase 1 placeholder specs already on the product
  page (clearly labelled there as placeholders). Competitor
  (Litter-Robot, PetKit, Catlink, one premium manual box) specs are only
  asserted where we're reasonably confident from general market
  positioning (e.g. "most models have an app"); anything we can't verify
  is marked **`[CONTROLEREN]`** in `lib/comparison.ts` rather than guessed
  — search that string before publishing to find every row that needs a
  human to check the competitor's actual current spec sheet. No negative
  or unverifiable claims about any competitor are made.
- Includes an explicit, honest "wanneer zijn wij niet de beste keuze"
  section (households with >3 cats, very heavy cats) per the brief.

## FAQ (`/veelgestelde-vragen`)

- 26 seeded questions across the 6 requested categories
  (`lib/faq.ts`), editable via `/admin/faq`. Rendered as native
  `<details>`/`<summary>` (via the existing `FaqItem` component) grouped by
  category — fully readable and navigable with JavaScript disabled; the
  rotate-icon affordance is CSS-only progressive enhancement.
- The product page's 5-question preview now reads from this same data
  layer (`listPublishedFaqs().slice(0, 5)`) instead of a separate hardcoded
  list, so editing a question in `/admin/faq` updates both places.

## Cookie consent

- Phase 2 shipped `hasMarketingConsent()` as a stub reading one
  localStorage flag with no UI to set it. Phase 3 adds a real, minimal
  cookie banner (`components/CookieBanner.tsx`): "Alleen noodzakelijk" vs.
  "Accepteren", writing the same flag via new `setMarketingConsent()` /
  `getStoredConsent()` helpers in `lib/analytics.ts`. **No code changes**
  were needed at any existing call site (`ConversionTracker.tsx`,
  GA4/Meta/TikTok gating) — they already gated on `hasMarketingConsent()`.
  `/cookiebeleid` can reopen the banner via `reopenCookieBanner()`
  (a `CustomEvent`), so a visitor can change their mind at any time.
- Only marketing/analytics cookies are gated; functional cookies (cart,
  CSRF, Supabase Auth admin session) are always active as strictly
  necessary cookies, consistent with ePrivacy guidance.

## Legal/service pages

- All six pages (`algemene-voorwaarden`, `privacyverklaring`,
  `cookiebeleid`, `herroepingsrecht`, `verzending-en-retour`, `garantie`)
  pull business identity from the single central `lib/site.ts` config
  established in Phase 1 (`site.legalName`, `site.kvk`, `site.btw`,
  `site.address`, `site.email`) — updating that one file updates every
  legal page at once. Additional placeholders specific to this content:
  - `[DATUM INVULLEN]` — "laatst bijgewerkt" date on
    `algemene-voorwaarden` and `privacyverklaring`; needs a real date once
    the text is legally reviewed and published.
  - `[BRON INVULLEN]` — the definitive carrier name (verzending-en-retour)
    and confirmation of which verwerkersovereenkomsten are actually signed
    (privacyverklaring).
  - Every legal page carries a visible note that it needs review by a
    qualified jurist before publication — this is boilerplate written to
    match Dutch/Belgian consumer law (herroepingsrecht 14 days, 2-year
    conformity warranty, EU ODR link) but is **not a substitute for legal
    review**.
- `/herroepingsrecht` includes a downloadable EU model withdrawal form as
  a real, valid PDF (`public/downloads/herroepingsformulier.pdf`),
  hand-generated with a small dependency-free PDF writer
  (`scripts` used only at authoring time, not shipped) rather than pulling
  in a PDF library for one static document.
- Footer (Phase 1) now links to all six pages via a new `legalNav` export
  in `lib/site.ts`, plus payment-method name badges (iDEAL, Bancontact,
  Creditcard, Apple Pay, Klarna) — no real payment-network logo assets
  were fetched from anywhere; only their names are shown as plain text
  badges. Replace with real logo SVGs (with the appropriate usage
  permissions) before launch if a more branded look is wanted.

## Admin extensions

- `/admin/blog`: Markdown editor with a Schrijven/Voorvertoning tab toggle
  (client-side preview via `lib/markdown.ts`, no round-trip needed). Hero
  image accepts either a plain URL/path (always available) or a file
  upload to Supabase Storage bucket `blog-images` via `lib/storage.ts` —
  upload is disabled in the UI and throws a clear error if attempted
  without a live Supabase project, per the same degrade-gracefully
  contract as the rest of the app. The `blog-images` bucket itself is
  **not** created by any migration here (Supabase Storage buckets aren't
  managed by SQL migrations) — create it manually (public read) once a
  real project exists.
- `/admin/faq`: inline add/edit/delete per question, category dropdown,
  numeric sort order, published toggle.

## SEO

- `app/sitemap.ts` / `app/robots.ts` (Next.js Metadata Route conventions)
  generate `/sitemap.xml` / `/robots.txt` dynamically — the sitemap always
  reflects whatever is actually published in `lib/blog.ts`, static pages
  included by hand. `/admin`, `/api`, `/afrekenen`, `/bedankt` are
  disallowed, matching the brief.
- `lib/jsonld.tsx` centralizes every JSON-LD block (Organization, WebSite,
  BreadcrumbList, Product/Offer, FAQPage, BlogPosting) — the root layout's
  previously-inline Organization/WebSite objects now call this file too.
  `AggregateRating` is intentionally never emitted (no real reviews exist
  yet — same honest-empty-state decision as Phase 1/2); add it only once
  real, published reviews exist.
- `lib/seo.ts`'s `buildMetadata()` is the one place canonical + OG/Twitter
  + hreflang (`nl-NL`, `nl-BE`, `x-default` — all three currently point at
  the same URL, since there is only one, non-localized version of the
  site; revisit if NL/BE ever get distinct content) are generated; adopted
  on the home page, product page and every new Phase 3 page.
- **www vs. non-www**: `www.purelitter.nl` was chosen as canonical (it was
  already `site.url` in Phase 1) — `next.config.ts` now 301-redirects the
  apex domain to `www` via a host-matched redirect rule. Trailing slash is
  explicitly `false` (Next's default), stated in `next.config.ts` rather
  than left implicit.
- Google Search Console / Bing Webmaster verification are wired via
  `NEXT_PUBLIC_GOOGLE_SITE_VERIFICATION` / `NEXT_PUBLIC_BING_SITE_VERIFICATION`
  env vars (rendered as `<meta>` tags in `app/layout.tsx`); both are empty
  by default and simply omitted from the HTML until set.
- Fixed two real broken links surfaced by the new internal-link checker:
  the homepage's "Hoe werkt het?" button pointed at `/hoe-werkt-het`,
  which has never existed as a page (an intentional Phase 1 scope
  decision) — it now anchors to the existing on-page section instead
  (`#hoe-werkt-het`); a stray `/faq` link now points directly at
  `/veelgestelde-vragen` (a 301 redirect from `/faq` also still exists for
  any external/bookmarked links).
- `scripts/check-internal-links.mjs` and `scripts/validate-jsonld.mjs` are
  standalone, dependency-free Node scripts (also wrapped as
  `tests/internal-links.test.ts` / exercised via
  `tests/structured-data.test.ts` so they run in CI with `npm test`).
  Neither one crawls a live site over HTTP — they're static/structural
  checks against the source tree and the real JSON-LD generator
  functions, respectively.
- Breadcrumbs (`components/Breadcrumbs.tsx`, paired with
  `breadcrumbJsonLd()`) were added to every new Phase 3 page plus
  `/winkelwagen` and `/order-volgen`. The checkout/payment/post-payment
  pages themselves (`/afrekenen`, `/bedankt/[ordernummer]`,
  `/beoordelen/[token]`) were deliberately left untouched, per this
  phase's explicit "do not change the checkout or payment flow"
  instruction — those stay noindex'd (see `robots: { index: false }` on
  each) and are excluded from the sitemap/robots.txt anyway, so the SEO
  value of adding breadcrumbs there is minimal.

## Testing (Phase 3 additions)

- `tests/contact-validation.test.ts` — zod schema for the contact form,
  including the honeypot rejection path.
- `tests/sitemap.test.ts` — asserts the generated sitemap includes the
  homepage/product page, every seeded published blog post, excludes
  admin/api/checkout/thank-you paths, and has no duplicate URLs.
- `tests/structured-data.test.ts` — structural validation of every
  `lib/jsonld.tsx` generator against the required schema.org properties
  for its `@type`.
- `tests/internal-links.test.ts` — wraps
  `scripts/check-internal-links.mjs`; fails the suite if any `href`/`src`
  in `app/`, `components/` or `lib/blog-content/` points at a route or
  public asset that doesn't exist.

## Verified before handoff (Phase 3)

- `npm run lint` — 0 errors, 0 warnings.
- `npm run build` — passes; see the route list in the build output,
  including the new `/blog`, `/vergelijking`, `/veelgestelde-vragen`,
  `/over-ons`, `/contact`, six legal pages, `/admin/blog`, `/admin/faq`,
  `/sitemap.xml` and `/robots.txt` routes.
- `npm test` — 41/41 passing (24 Phase 2 + 17 new Phase 3 tests).
- `npm run check:links` / `npm run check:jsonld` — both pass.

---

# Decisions & fixes — Phase 4 (production-readiness audit)

Phase 4 was an audit pass, not a feature phase: **no new functionality was
added** (the one content exception is the EU GPSR disclosure below, which
is legally-required text, not a feature). Everything here is either a real
bug found and fixed, a genuine performance/accessibility/security gap
closed, or infrastructure (CI, error pages, monitoring hooks) needed for a
production launch. See the PR/commit history on this branch for the exact
diffs — this section summarizes *why* each change was made.

## Real bugs found and fixed

- **`/afrekenen` and `/contact` 500'd under `next start`** (never caught by
  `npm run dev` or the unit-test suite — only surfaced by a Lighthouse
  smoke test against a real production build). Root cause: those Server
  Components (plus `/bedankt/[ordernummer]`) called
  `getOrCreateCsrfToken()`, which tries to *set* a cookie — Next.js only
  allows mutating cookies from a Server Action or Route Handler, not a
  Server Component render. Fixed by moving CSRF-cookie creation into
  `proxy.ts` (middleware), which already runs before these pages render;
  `lib/csrf.ts` now also exposes a read-only `getCsrfToken()` for the pages
  themselves to call. This was launch-blocking: it broke the checkout page
  itself in production.
- **Checkout's "no Mollie configured" fallback sent the browser an
  absolute redirect URL** built from `NEXT_PUBLIC_SITE_URL`/`site.url`.
  Anywhere that env var doesn't match the actual host — every preview
  deploy, and this local dev/audit environment, which has neither set —
  the shopper's browser was sent to the placeholder production domain
  instead of staying on the real host. Now uses a relative path for the
  browser's own navigation; the real Mollie API calls still get (and
  require) the absolute URL.
- **Zod silently dropped the postcode-format error whenever any other
  field also failed on the same submit** — most commonly the terms
  checkbox, unchecked by default, so a very common first-submit shape (bad
  postcode + box not yet ticked) showed only the terms error. Root cause:
  Zod does not run an object's own `.superRefine()`/`.check()` at all if
  any field on that same object already has an issue. Fixed by moving the
  postcode-format check onto the address sub-schema itself (decoupling it
  from unrelated top-level fields like `acceptedTerms`/`email`). A
  narrower residual case remains and is deliberately documented rather
  than silently left as a surprise: a bad *billing* postcode combined with
  an unrelated error can still be suppressed on that one submit, since the
  "billing fields required if different" logic still lives in the
  top-level check (this only affects the minority of shoppers who tick
  "Factuuradres is anders"). See the `[known limitation]` test in
  `tests/checkout-validation.test.ts`.
- **WCAG AA color contrast**: the brief-chosen accent `#C05C34` failed
  4.5:1 both as white-on-accent (4.36:1, e.g. every primary button) and as
  accent-on-cream body text (4.08:1) — found by Lighthouse's
  `color-contrast` audit on the homepage. Darkened to `#B0502D` (5.21:1 /
  4.87:1), same hue, no other design token touched.
- **Inline links relying on color alone**: several links embedded inside a
  sentence of surrounding text (cookie banner, `/vergelijking`, the
  thank-you page, `/contact`, the checkout terms checkbox label) used
  `hover:underline` — invisible as a link until hovered, which fails
  axe's `link-in-text-block` rule (color contrast between the link and
  the surrounding muted text was only 1.12:1, nowhere near the 3:1 this
  rule requires when there's no other distinguishing style). Changed to a
  permanent `underline`.
- **Mini-cart drawer had no real focus trap** despite `aria-modal="true"`
  (Tab could reach the page behind the overlay) and **never returned focus
  to the triggering element on close** (e.g. the "In winkelwagen" button).
  `lib/cart-context.tsx` now tracks whatever had focus when the drawer
  opened and restores it on close; `CartDrawer.tsx` traps Tab/Shift+Tab
  within the dialog. Escape-to-close already worked.
- **Missing EU GPSR manufacturer/importer disclosure** on the product
  page — a legal requirement for physical consumer products sold in the
  EU (in force since 13 Dec 2024), absent from Phase 1-3 entirely. Added
  as two new placeholders in `lib/site.ts` (`gpsrManufacturer`,
  `gpsrResponsiblePerson`), same convention as `kvk`/`btw`/`address`.

## Performance

- `priority` on `next/image` was not, by itself, enough to get
  `fetchpriority="high"` onto the actual `<img>`/preload `<link>` in this
  Next.js version (confirmed by reading `get-img-props.js` — `priority`
  only sets `loading="eager"` and adds the preload; `fetchPriority` is an
  entirely separate prop). Added `fetchPriority="high"` alongside
  `priority` on the three real hero/gallery images (home hero, product
  gallery, and the blog article cover image, which had no `priority` at
  all before this). Home mobile LCP: 3.0s → 2.4s (simulated slow-4G
  throttling via Lighthouse's own `--throttling-method=simulate`, not a
  real-device measurement).
- `/afrekenen` and `/winkelwagen` rendered the *full* page before the cart
  cookie was readable (client-only, read after mount), then collapsed to a
  short "cart is empty" message once hydration confirmed 0 items — a 0.62
  Cumulative Layout Shift on `/afrekenen` in Lighthouse. Both now show a
  stable, minimally-sized placeholder until hydration resolves, so there
  is at most one small→real content transition rather than a big
  form→tiny-message reversal. CLS: 0.621 → 0.094.
- `CartDrawer` and `CookieBanner` (root layout, every single page, render
  nothing on first paint) are now loaded via `next/dynamic({ ssr: false })`
  through a small client wrapper (`components/DeferredWidgets.tsx`)
  instead of being bundled into every page's initial hydration payload.
  Admin's own JS is already excluded from public-page bundles for free —
  Next's App Router code-splits per route segment, so `/admin/*` chunks
  were never shipped to `/`, `/zelfreinigende-kattenbak`, etc.
- `npm audit`: upgraded `vitest` 2 → 5 (+ `@types/node` 20 → 22, + `vite` 7
  as a direct devDependency, `--legacy-peer-deps`) to clear 5
  vulnerabilities (1 critical, 1 high, 3 moderate) in `@vitest/mocker`/
  `vite`/`esbuild`'s dev server — all dev-only, never shipped to
  production, but worth clearing anyway. Production dependencies had 0
  vulnerabilities before and after.
- Lighthouse (desktop preset + mobile/simulated-throttled, against a real
  `next build && next start`, Chromium via Playwright's bundled browser)
  on `/`, `/zelfreinigende-kattenbak`, a blog article, `/vergelijking` and
  `/afrekenen` — see the session's final report for the full before/after
  score table. All five pages now score ≥92 on every category on mobile,
  ≥96 on desktop; the one outlier (`/afrekenen` SEO 66) is the *intended*
  `noindex` on the checkout page, not a regression — Lighthouse correctly
  flags a noindex'd page as "not crawlable" and there is no reason to
  index it.
- No original image asset in `public/images/` exceeds 300KB — they are all
  hand-authored placeholder SVGs (Phase 1/3 decision), which `next/image`
  further optimizes at request time.

## Accessibility

- axe-core (`@axe-core/playwright`) scanned across all 16 public pages
  plus the cookie banner and mini-cart drawer as their own dialogs — zero
  critical/serious violations after the contrast/link-underline/focus-trap
  fixes above (see `tests/e2e/accessibility.spec.ts`).
- Checkout and contact form fields now wire their error message to the
  input via `aria-describedby` + `aria-invalid`, not just visual proximity
  plus a one-time `role="alert"` announcement — a screen reader tabbing
  back into an already-invalid field now hears why, not just silence.
- Skip link, keyboard navigation home → product → cart → checkout, and
  `prefers-reduced-motion` were manually re-verified; no further gaps
  found beyond what's fixed above.

## Security

- **Security headers** (`next.config.ts`, new `headers()` function):
  Content-Security-Policy (script-src limited to self + Google Tag
  Manager + Meta Pixel + TikTok Pixel, since those are the only
  third-party scripts this site ever loads, and only after cookie
  consent), Strict-Transport-Security, X-Content-Type-Options,
  X-Frame-Options, Referrer-Policy, Permissions-Policy, plus an explicit
  `X-Robots-Tag: noindex` on `/admin/*` as defense-in-depth on top of the
  existing per-page `robots` metadata. The CSP uses `'unsafe-inline'` on
  `script-src` rather than a nonce — wiring a nonce through every inline
  script (Next's own hydration data, JSON-LD blocks, the post-consent
  analytics snippets) is a larger change than this audit pass covers; it's
  called out as a follow-up in RUNBOOK.md.
- **Admin login moved off the browser Supabase SDK onto a new server route**
  (`app/api/admin/login/route.ts`) so sign-in attempts are rate-limited
  per IP (8/5min) — every other public form (checkout, contact, order
  lookup) already had this, admin login did not. The allowlist check now
  also runs before a session cookie is ever set, not only on the next
  `/admin` request via `proxy.ts`.
- **`/api/reviews/submit` was missing rate limiting** — every other public
  POST endpoint already had it (checkout 8/min, checkout/retry 8/min,
  contact — see below, order lookup 15/min). Added 10/min per IP.
- **Row Level Security reviewed** across all three migrations
  (`supabase/migrations/*.sql`): every table has RLS enabled; the only
  `for all`/write policies are `to service_role`; the only `authenticated`
  policies are strictly "read/update your own row via `auth.uid()`"; guest
  order lookup (no Supabase Auth session) deliberately has **no** RLS
  policy at all — `supabase/migrations/0002_checkout.sql` explains why
  (Postgres RLS can't see the client's claimed order_number/email pair, so
  a `using (true)` policy "scoped" to it would actually let the anon key
  enumerate every order). Guest lookup instead goes through a server-side
  helper using the service-role key, which itself enforces the
  order_number+email match. No live Supabase project exists in this
  environment to run an actual anon-key RLS penetration test against —
  this is a static read of the policies, not a live test. Running that
  live test against a real project is a `LAUNCH-CHECKLIST.md` item.
- **Mollie webhook idempotency/never-trust-the-body re-verified**
  (`app/api/mollie/webhook/route.ts`, `tests/webhook-idempotency.test.ts`)
  — unchanged from Phase 2, still correct: the payment is always refetched
  from Mollie by id before any status change, and a redelivered
  `(paymentId, status)` pair is a no-op recorded in
  `processed_webhook_events`.
- **`npm audit`**: 0 vulnerabilities in production dependencies (before
  and after this phase); 5 dev-only vulnerabilities (1 critical, 1 high, 3
  moderate, all in the Vitest/Vite/esbuild dev-server toolchain, never
  shipped) fixed by upgrading Vitest — see Performance above.
- **Error pages** (`app/error.tsx`, `app/global-error.tsx`, new): there was
  no error boundary anywhere, so an unhandled render error fell through to
  Next's default screen. Both now show a calm, on-brand page with only the
  Next-generated opaque `digest` (explicitly designed by Next to be shown
  to users as a support reference) — never the message or stack trace.
  `lib/error-reporting.ts` logs PII-free to the server console, matching
  the rule the checkout/webhook routes already followed.
- Verified (unchanged from Phase 2): the Supabase service-role key is only
  ever imported by `lib/supabase/server.ts` (marked `import "server-only"`,
  which throws if bundled into client code) and every `NEXT_PUBLIC_*` env
  var in `.env.example` is genuinely a public value (Supabase anon key,
  GA4/Meta/TikTok IDs, Search Console verification codes, site URL) — none
  of them are secrets.

## Testing

- **Playwright** (`@playwright/test` + `@axe-core/playwright`, new
  devDependencies) added as `tests/e2e/`: full home→product→cart→checkout
  →thank-you (against this environment's documented no-live-Mollie
  "pending" fallback — a real Mollie test-mode payment still needs a human
  with real credentials, per `TESTING.md`), checkout validation (bad
  postcode, missing terms checkbox), guest order tracking (correct vs.
  wrong email), cookie-banner consent + no-marketing-requests-before-or-
  after-consent (no pixel IDs are configured in this environment, so this
  is verified structurally — no `googletagmanager.com`/
  `connect.facebook.net`/`analytics.tiktok.com` request ever fires), admin
  fail-closed/rate-limited/noindex behavior, and the full axe accessibility
  sweep above. 27/27 passing.
- 3 new Vitest regression tests for the postcode-validation bug above
  (`tests/checkout-validation.test.ts`), including one explicitly named
  `[known limitation]` for the narrower residual case.
- `.github/workflows/ci.yml` (new): lint, `tsc --noEmit`, unit tests,
  link/JSON-LD checks, production build, and the full Playwright suite on
  every PR and push to `main`. Needs no secrets — every integration
  degrades to its documented mock behavior without credentials.
- **Total after Phase 4**: 44/44 Vitest tests, 27/27 Playwright tests,
  `npm run lint` 0 errors/warnings, `npm run build` clean, `npm run
  check:links`/`check:jsonld` clean.

## Monitoring & analytics

- **No live Sentry account/DSN exists in this environment.** Rather than
  install `@sentry/nextjs` with nothing to configure it against (dead
  weight, and a false "monitoring is set up" impression), added
  `lib/error-reporting.ts` as the single call site both new error
  boundaries use — it already logs PII-free to the server console, and
  will forward to `window.Sentry.captureException` the moment a Sentry (or
  Sentry-compatible) snippet is added, with zero other code changes
  needed. See `RUNBOOK.md` for the concrete steps to wire a real Sentry
  project (or a lighter alternative) once an account exists.
- **`@vercel/analytics` + `@vercel/speed-insights`** (new dependencies)
  added to the root layout — both are first-party and cookieless per
  Vercel's own privacy design (no cookie, no cross-site tracking), so they
  are *not* gated behind the cookie-consent banner, unlike GA4/Meta/
  TikTok. Both are inert until the project is actually deployed on Vercel
  with Analytics/Speed Insights turned on in the dashboard for it.
- GA4/Meta/TikTok event firing (`view_item`, `add_to_cart`,
  `begin_checkout`, `purchase`) was not re-implemented (Phase 2/3 code,
  unchanged) — no pixel IDs are configured in this environment so nothing
  can fire to verify live. `TESTING.md` documents how the owner checks
  each platform's own debug tool once real IDs are set.

## Documentation

- `RUNBOOK.md` (new): what to do for a failed webhook, a missing-email
  complaint, a return/refund, and a Mollie/Supabase outage.
- `LAUNCH-CHECKLIST.md` (new): the pre-launch checklist for the human
  owner.
- This Phase 4 section.
- Full remaining-placeholder list: see `LAUNCH-CHECKLIST.md` — it's kept
  there rather than duplicated here so there is exactly one place a
  non-technical owner needs to check before launch.

## Verified before handoff (Phase 4)

- `npm run lint` — 0 errors, 0 warnings.
- `npm run build` — passes, all 39 routes.
- `npm test` — 44/44 passing.
- `npx playwright test` — 27/27 passing.
- `npm run check:links` / `npm run check:jsonld` — both pass.
- `npm audit` — 0 vulnerabilities.
