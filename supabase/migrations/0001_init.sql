-- Phase 1 schema for PureLitter (D2C dropshipping webshop).
-- This defines the tables + Row Level Security needed once orders/checkout
-- (Phase 2) and blog/content (Phase 3) land. No cart/checkout logic yet —
-- this migration only establishes structure and access policies.
--
-- Apply with the Supabase CLI: `supabase db push` (see supabase/README.md).

-- Required for gen_random_uuid()
create extension if not exists "pgcrypto";

-- =========================================================================
-- customers
-- One row per customer account/guest checkout identity. No auth linkage is
-- assumed yet in Phase 1; `auth_user_id` is nullable for future Supabase
-- Auth integration (guest checkout support).
-- =========================================================================
create table if not exists public.customers (
  id uuid primary key default gen_random_uuid(),
  auth_user_id uuid unique references auth.users (id) on delete set null,
  email text not null unique,
  first_name text,
  last_name text,
  phone text,
  marketing_opt_in boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table public.customers is 'Customer identities. Contains PII — never exposed via public read policies.';

-- =========================================================================
-- products
-- =========================================================================
create table if not exists public.products (
  id uuid primary key default gen_random_uuid(),
  slug text not null unique,
  name text not null,
  short_description text,
  description text,
  is_published boolean not null default false,
  base_price_cents integer not null check (base_price_cents >= 0),
  currency text not null default 'EUR',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table public.products is 'Sellable products. base_price_cents stores price in EUR cents (e.g. 17900 = €179,00) incl. BTW.';

-- =========================================================================
-- product_variants
-- Phase 1 ships one variant per product; schema supports future
-- color/size variants.
-- =========================================================================
create table if not exists public.product_variants (
  id uuid primary key default gen_random_uuid(),
  product_id uuid not null references public.products (id) on delete cascade,
  sku text not null unique,
  name text not null default 'Standaard',
  price_cents integer not null check (price_cents >= 0),
  compare_at_price_cents integer check (compare_at_price_cents is null or compare_at_price_cents >= 0),
  stock_status text not null default 'in_stock' check (stock_status in ('in_stock', 'preorder', 'out_of_stock')),
  is_default boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists product_variants_product_id_idx on public.product_variants (product_id);

comment on table public.product_variants is 'Variants of a product (color/size in later phases). Phase 1: one default variant per product.';

-- =========================================================================
-- orders
-- Phase 2 will populate these via Mollie checkout; table exists now so the
-- schema is ready.
-- =========================================================================
create table if not exists public.orders (
  id uuid primary key default gen_random_uuid(),
  customer_id uuid references public.customers (id) on delete set null,
  status text not null default 'pending' check (
    status in ('pending', 'paid', 'processing', 'shipped', 'delivered', 'cancelled', 'refunded')
  ),
  mollie_payment_id text unique,
  subtotal_cents integer not null check (subtotal_cents >= 0),
  shipping_cents integer not null default 0 check (shipping_cents >= 0),
  total_cents integer not null check (total_cents >= 0),
  currency text not null default 'EUR',
  email text not null,
  shipping_address jsonb,
  billing_address jsonb,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists orders_customer_id_idx on public.orders (customer_id);

comment on table public.orders is 'Customer orders. Contains PII (addresses, email) — never exposed via public read policies.';

-- =========================================================================
-- order_items
-- =========================================================================
create table if not exists public.order_items (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references public.orders (id) on delete cascade,
  product_variant_id uuid references public.product_variants (id) on delete set null,
  product_name text not null,
  variant_name text,
  unit_price_cents integer not null check (unit_price_cents >= 0),
  quantity integer not null check (quantity > 0),
  total_cents integer not null check (total_cents >= 0),
  created_at timestamptz not null default now()
);

create index if not exists order_items_order_id_idx on public.order_items (order_id);

comment on table public.order_items is 'Line items belonging to an order. Snapshot of product/variant name+price at time of purchase.';

-- =========================================================================
-- reviews
-- =========================================================================
create table if not exists public.reviews (
  id uuid primary key default gen_random_uuid(),
  product_id uuid not null references public.products (id) on delete cascade,
  customer_id uuid references public.customers (id) on delete set null,
  author_name text not null,
  rating smallint not null check (rating between 1 and 5),
  title text,
  body text,
  is_published boolean not null default false,
  created_at timestamptz not null default now()
);

create index if not exists reviews_product_id_idx on public.reviews (product_id);

comment on table public.reviews is 'Customer reviews. Only is_published=true rows are readable publicly.';

-- =========================================================================
-- blog_posts
-- =========================================================================
create table if not exists public.blog_posts (
  id uuid primary key default gen_random_uuid(),
  slug text not null unique,
  title text not null,
  excerpt text,
  body text,
  cover_image_url text,
  is_published boolean not null default false,
  published_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table public.blog_posts is 'Blog/knowledge-base content (Phase 3). Only is_published=true rows are readable publicly.';

-- =========================================================================
-- Row Level Security
-- =========================================================================
alter table public.customers enable row level security;
alter table public.products enable row level security;
alter table public.product_variants enable row level security;
alter table public.orders enable row level security;
alter table public.order_items enable row level security;
alter table public.reviews enable row level security;
alter table public.blog_posts enable row level security;

-- --- products: public read of published products, no public write ---
create policy "Public can read published products"
  on public.products for select
  to anon, authenticated
  using (is_published = true);

create policy "Service role manages products"
  on public.products for all
  to service_role
  using (true)
  with check (true);

-- --- product_variants: public read when parent product is published ---
create policy "Public can read variants of published products"
  on public.product_variants for select
  to anon, authenticated
  using (
    exists (
      select 1 from public.products p
      where p.id = product_variants.product_id
        and p.is_published = true
    )
  );

create policy "Service role manages product_variants"
  on public.product_variants for all
  to service_role
  using (true)
  with check (true);

-- --- reviews: public read of published reviews only ---
create policy "Public can read published reviews"
  on public.reviews for select
  to anon, authenticated
  using (is_published = true);

create policy "Service role manages reviews"
  on public.reviews for all
  to service_role
  using (true)
  with check (true);

-- --- blog_posts: public read of published posts only ---
create policy "Public can read published blog posts"
  on public.blog_posts for select
  to anon, authenticated
  using (is_published = true);

create policy "Service role manages blog_posts"
  on public.blog_posts for all
  to service_role
  using (true)
  with check (true);

-- --- customers: no public access; a customer may read/update own row ---
create policy "Customers can read own record"
  on public.customers for select
  to authenticated
  using (auth_user_id = auth.uid());

create policy "Customers can update own record"
  on public.customers for update
  to authenticated
  using (auth_user_id = auth.uid())
  with check (auth_user_id = auth.uid());

create policy "Service role manages customers"
  on public.customers for all
  to service_role
  using (true)
  with check (true);

-- --- orders: no public access; a customer may read own orders ---
create policy "Customers can read own orders"
  on public.orders for select
  to authenticated
  using (
    customer_id in (
      select id from public.customers where auth_user_id = auth.uid()
    )
  );

create policy "Service role manages orders"
  on public.orders for all
  to service_role
  using (true)
  with check (true);

-- --- order_items: no public access; readable via owning order ---
create policy "Customers can read own order items"
  on public.order_items for select
  to authenticated
  using (
    order_id in (
      select o.id from public.orders o
      join public.customers c on c.id = o.customer_id
      where c.auth_user_id = auth.uid()
    )
  );

create policy "Service role manages order_items"
  on public.order_items for all
  to service_role
  using (true)
  with check (true);
