# Supabase schema

This directory contains the SQL migration for PureLitter's database. No live
Supabase project is required for Phase 1 — this is the designed schema, ready
to apply once a project exists.

## Apply the migration

1. Install the Supabase CLI: https://supabase.com/docs/guides/cli
2. Create a Supabase project (dashboard or `supabase projects create`).
3. Link this repo to the project:
   ```bash
   supabase link --project-ref <your-project-ref>
   ```
4. Push the migration:
   ```bash
   supabase db push
   ```
   Or, for local development with the Supabase CLI's local stack:
   ```bash
   supabase start
   supabase db reset   # applies all migrations in supabase/migrations
   ```
5. Copy the project's API URL and keys into `.env.local` (see `.env.example`
   at the repo root).

## What's in `0001_init.sql`

- `products`, `product_variants` — catalog data. Public (anon) read access is
  limited to published rows; all writes go through the `service_role` key
  (used by server-side code / admin tooling only).
- `customers`, `orders`, `order_items` — contain personal data. No public
  read/write access. A signed-in customer (via Supabase Auth) may read their
  own record/orders; all other access is via `service_role` from trusted
  server code (e.g. checkout + Mollie webhook handlers in Phase 2).
- `reviews`, `blog_posts` — public read access limited to published rows,
  matching the "honest, no fake reviews" approach used on the storefront.

Row Level Security is enabled on every table. Review the policies before
going to production and adjust as auth/checkout flows are implemented in
Phase 2/3.
