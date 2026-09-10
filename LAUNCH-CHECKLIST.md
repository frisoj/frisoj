# Launch checklist

For the human owner to work through before pointing the real domain at
this site. Nothing in this file can be verified or ticked off by an AI
agent — it all needs a live Vercel project, a live Supabase project, real
Mollie/Resend credentials, and a person clicking through the real thing.

Also see: `RUNBOOK.md` (what to do when something breaks after launch),
`README.md` (day-to-day: adding a blog post, handling an order, issuing a
refund), `DECISIONS.md` (why everything is built the way it is).

## 0. Deploy setup (do this first — everything else needs it)

### Vercel

- [ ] Create a Vercel project from this repo. Production branch: `main`.
      Every other branch/PR gets an automatic preview deploy.
- [ ] Environment variables — set per environment (Vercel lets you scope
      each var to Production / Preview / Development separately):

  | Variable | Production | Preview |
  |---|---|---|
  | `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY` | your **prod** Supabase project | your **dev/staging** Supabase project (separate project — see below) |
  | `MOLLIE_API_KEY` | `live_...` | `test_...` |
  | `MOLLIE_WEBHOOK_URL` | `https://www.<yourdomain>/api/mollie/webhook` | leave unset — Preview URLs are unpredictable per-deploy; the code falls back to `${NEXT_PUBLIC_SITE_URL}/api/mollie/webhook`, which won't work for Preview either, so **use Mollie test mode with real payments disabled on Preview**, or don't test real Mollie payments on Preview at all |
  | `RESEND_API_KEY` | your real key | same key is fine (test emails just go to whatever address you use) |
  | `OWNER_NOTIFICATION_EMAIL` | your real inbox | your real inbox, or a throwaway one for preview noise |
  | `ADMIN_EMAILS` | real admin emails | can be the same |
  | `CRON_SECRET` | a real random secret | a real random secret (can differ) |
  | `NEXT_PUBLIC_GA4_ID`, `NEXT_PUBLIC_META_PIXEL_ID`, `NEXT_PUBLIC_TIKTOK_PIXEL_ID` | real IDs | consider leaving unset on Preview so preview clicks don't pollute production analytics |
  | `NEXT_PUBLIC_SITE_URL` | `https://www.<yourdomain>` | leave unset (Vercel provides its own preview URL; some code paths that need an absolute URL, like the Mollie redirect, will use `site.url` from `lib/site.ts` as a fallback — update that placeholder domain too) |
  | `NEXT_PUBLIC_GOOGLE_SITE_VERIFICATION`, `NEXT_PUBLIC_BING_SITE_VERIFICATION` | real verification codes | not needed |

- [ ] Vercel Analytics and Speed Insights: enabled by default the moment
      `@vercel/analytics`/`@vercel/speed-insights` are in the deployed
      bundle (they already are) — just confirm both show "Enabled" under
      the project's Analytics / Speed Insights tabs after the first
      production deploy. No extra code or env var needed.
- [ ] Cron: `vercel.json` already defines the abandoned-cart and
      review-invite crons — confirm they show up under the project's
      "Cron Jobs" tab after the first deploy, and that `CRON_SECRET`
      matches what those routes check.

### Domain

- [ ] At your registrar, point the domain's DNS at Vercel (Vercel's
      project settings → Domains gives you the exact records — typically
      an `A`/`ALIAS` record for the apex and a `CNAME` for `www`).
- [ ] Add both the apex (`purelitter.nl`) and `www` (`www.purelitter.nl`)
      in Vercel's Domains tab. `next.config.ts` already 301-redirects the
      apex to `www` (see DECISIONS.md, "www vs. non-www") — Vercel just
      needs to know about both hostnames so the redirect has something to
      redirect *from*.
- [ ] HTTPS: automatic via Vercel once DNS resolves — no action needed,
      just confirm the padlock shows on both `purelitter.nl` and
      `www.purelitter.nl` after DNS propagates (can take up to 24-48h).
      `next.config.ts`'s `Strict-Transport-Security` header only takes
      effect once you've confirmed HTTPS works reliably — it tells
      browsers to *never* try HTTP again, so don't rely on it until DNS
      has fully settled.

### Supabase

- [ ] Two separate Supabase projects: one for production, one for
      dev/preview/staging. Never point Preview deploys at the production
      database.
- [ ] Apply all three migrations to **both** projects:
      `supabase link --project-ref <ref>` then `supabase db push` (see
      `supabase/README.md`). Confirm all tables + RLS policies exist via
      the Supabase dashboard's Table Editor (RLS shows as a lock icon per
      table).
- [ ] Create the `blog-images` Storage bucket in **both** projects
      manually (Storage → New bucket → public read). Not managed by SQL
      migrations — see DECISIONS.md.
- [ ] Confirm daily backups are enabled (Database → Backups) on the
      **production** project — this is a paid-plan feature on some
      Supabase tiers; confirm your plan includes it, or set up your own
      periodic `pg_dump` via a scheduled job if not.
- [ ] Create your first real admin user (Authentication → Users → Add
      user, with a password) in the production project, and add their
      email to `ADMIN_EMAILS`.
- [ ] **Run a live RLS penetration check** against the production
      project: using the anon/public key only (never the service role
      key), attempt to `select * from orders`, `select * from customers`,
      and insert/update a row in either — every one of these must fail.
      Also attempt to read/moderate an unpublished (`is_published=false`)
      review. This audit reviewed the RLS policies statically (see
      DECISIONS.md, Phase 4 "Security") but could not run this live check
      itself — no live Supabase project existed in that environment.

### Resend (domain verification)

- [ ] Add your sending domain in Resend's dashboard (Domains → Add
      Domain).
- [ ] Add the SPF (`TXT`), DKIM (`TXT`, usually 3 records), and DMARC
      (`TXT`, `_dmarc.<domain>`) records Resend gives you to your DNS
      provider.
- [ ] Wait for Resend to show all records as verified (green) — can take
      up to 24-48h for DNS propagation.
- [ ] Update the sender addresses in `.env.local`/Vercel env if they
      differ from the placeholders (`bestellingen@purelitter.nl`,
      `OWNER_NOTIFICATION_EMAIL`) — see `lib/email/send.ts`.
- [ ] Send yourself a real test email through the checkout flow (see
      section 3 below) and confirm it doesn't land in spam.

### Mollie (going live)

- [ ] Complete Mollie's "request live mode" process in their dashboard
      (business verification — takes them a few days).
- [ ] Once approved, get your `live_...` API key.
- [ ] **Switching without downtime**: set `MOLLIE_API_KEY` to the live key
      in Vercel's **Production** environment only (Preview keeps
      `test_...`) and redeploy. Because `getMollieClient()`
      (`lib/mollie.ts`) reads the env var fresh per server instance with
      no persistent state tying an in-flight checkout to a specific key,
      there's no migration step — any checkout started before the
      redeploy that hasn't yet redirected to Mollie will simply use
      whichever key is live by the time the API route actually runs.
      There's a few-second window during a redeploy where in-flight
      requests could hit either the old or new server instance — normal a
      Vercel deploy behavior, not specific to this app, and not worth
      engineering around for a low-traffic launch.
- [ ] Do the real-money test in section 3 below with the live key before
      announcing the site.

### Google Search Console + Bing Webmaster

- [ ] Add the site as a property in both (domain property, not just
      URL-prefix, so it covers both `www` and non-`www`).
- [ ] Get each platform's verification code and set
      `NEXT_PUBLIC_GOOGLE_SITE_VERIFICATION` /
      `NEXT_PUBLIC_BING_SITE_VERIFICATION` in Vercel, then redeploy —
      `app/layout.tsx` renders them as `<meta>` tags automatically.
      Confirm verification succeeds in each platform's dashboard.
- [ ] Submit `https://www.<yourdomain>/sitemap.xml` in both.

## 1. Content & legal

- [ ] All placeholders filled in — see the full list below.
- [ ] Legal pages (`/algemene-voorwaarden`, `/privacyverklaring`,
      `/cookiebeleid`, `/herroepingsrecht`, `/verzending-en-retour`,
      `/garantie`) reviewed by a qualified jurist — every page carries a
      visible note that this hasn't happened yet.
- [ ] Competitor specs in `/vergelijking` (`lib/comparison.ts`) verified
      against each competitor's actual current spec sheet — every
      unverified claim is marked `[CONTROLEREN]`.
- [ ] Real product photos/video placed (replacing the placeholder SVGs in
      `public/images/`), with accurate `alt` text — check every `<Image>`
      usage in `app/zelfreinigende-kattenbak/page.tsx`,
      `components/ProductGallery.tsx`, `app/page.tsx`,
      `app/blog/[slug]/page.tsx`, and the blog cover images.

## 2. Payments & orders

- [ ] Mollie live mode active (see above).
- [ ] A real €1 iDEAL test order placed and successfully refunded, end to
      end, on the live domain.
- [ ] Order confirmation email, shipping email, and owner notification
      email all actually received in a real inbox for that test order —
      **spam folder checked too**.
- [ ] Supplier confirmed in writing: NL/BE delivery time, return address,
      and who pays return shipping (customer or you) — this isn't in the
      codebase anywhere; it needs to match what `/verzending-en-retour`
      and `/garantie` actually say.

## 3. Cross-browser / device check

- [ ] Cookie banner tested in Chrome, Safari, and Firefox, on both mobile
      and desktop — confirm it appears, both choices work, and it doesn't
      reappear after a choice is made.
- [ ] Full checkout flow tested on a real mobile device (not just a
      resized desktop browser window) in at least Safari iOS and Chrome
      Android.

## 4. Performance & monitoring

- [ ] Lighthouse ≥95 on Performance, Accessibility, Best Practices and
      SEO, mobile, run against the **live** domain (not just a local
      build) — Vercel's own network/CDN characteristics differ from a
      local `next start`.
- [ ] Sitemap submitted to Google Search Console and Bing Webmaster (see
      above), and both show it as successfully processed (not just
      submitted — check back after a day or two).
- [ ] Sentry (or whatever error-monitoring you set up per `RUNBOOK.md`'s
      follow-up section) receives a real test error from the live site.
- [ ] Supabase backup verified — actually restore a backup to a scratch
      project once, to confirm backups are real and restorable, not just
      "enabled" in a settings toggle.

## 5. Final smoke test on the live domain

- [ ] 404 page works (visit a nonsense URL).
- [ ] `/order-volgen` order tracking works with a real order.
- [ ] The withdrawal-form PDF downloads correctly from `/herroepingsrecht`
      and opens as a valid PDF.

---

## Every remaining placeholder marker (file: line)

Search for these exact strings to find them again after this file is out
of date. None of these were removed by the Phase 4 audit — they need real
data from the owner/supplier/jurist, not an AI agent's judgment call.

### Brand & business info — `lib/site.ts`

- `kvk: "[KVK-NUMMER]"`
- `btw: "[BTW-NUMMER]"`
- `address: "[BEDRIJFSADRES]"`
- `phone: "[TELEFOONNUMMER]"`
- `gpsrManufacturer: "[GPSR-FABRIKANT-NAAM-EN-ADRES]"` (new in Phase 4 —
  see DECISIONS.md; EU GPSR requires this and it was missing entirely)
- `gpsrResponsiblePerson: "[GPSR-VERANTWOORDELIJKE-PERSOON-EU-NAAM-EN-ADRES]"`

These four (six) all flow from one file into the footer, legal pages, and
(the two GPSR ones) the product page.

### Team/about content — `app/over-ons/page.tsx`

- Line ~25: `Wij zijn [NAAM], en [NAAM]` — real founder names.
- Line ~60: `foto en een kort persoonlijk woord van het team: [FOTO]` —
  real team photo + words.
- Line ~80: `alt="Placeholder teamfoto — [FOTO]"` — same, on the `<Image>`
  alt text once a real photo replaces the placeholder SVG.

### Comparison page — `lib/comparison.ts`

18 `[CONTROLEREN]` markers across the Litter-Robot/PetKit/Catlink rows
(price positioning, warranty terms, sensor details, delivery time, exact
specs) — every one needs the competitor's actual current spec sheet
checked before publishing that row as fact.

### Legal pages

- `app/algemene-voorwaarden/page.tsx` line ~21: `Laatst bijgewerkt: [DATUM
  INVULLEN]`.
- `app/privacyverklaring/page.tsx` line ~21: `Laatst bijgewerkt: [DATUM
  INVULLEN]`.
- `app/privacyverklaring/page.tsx` line ~77-78: `[BRON INVULLEN —
  overzicht van gesloten verwerkersovereenkomsten]` — confirm which data
  processors (Supabase, Resend, Mollie, analytics platforms) actually
  have a signed verwerkersovereenkomst, and list them.
- `app/verzending-en-retour/page.tsx` line ~26: `[BRON INVULLEN —
  definitieve vervoerderkeuze]` — the actual carrier name (PostNL,
  bpost, DHL, ...).

### Product specs — `app/zelfreinigende-kattenbak/page.tsx`

The entire specs table (afmetingen, gewichtslimiet, geluidsniveau,
app-functies, stroomverbruik) is explicitly labelled as a Fase 1
placeholder in a visible on-page disclaimer — replace with the supplier's
real spec sheet. The "wat zit in de doos" list is a plausible guess, not
confirmed against the real supplier's package contents.

### Product photography

`public/images/hero-litterbox.svg`, `product-1.svg` .. `product-4.svg`,
and all five files in `public/images/blog/` are hand-authored placeholder
SVGs with a visible "Placeholder" caption baked in — replace with real
photography/video before launch (see item 1 above).
