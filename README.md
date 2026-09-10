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
