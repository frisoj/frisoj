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

## Verified before handoff

- `npm run lint` — passes with 0 errors, 0 warnings.
- `npm run build` — passes, all routes (`/`, `/zelfreinigende-kattenbak`)
  prerender as static content.
