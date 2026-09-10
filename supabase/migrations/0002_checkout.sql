-- Phase 2 schema additions for PureLitter: checkout, payments, order
-- lifecycle, reviews via token, admin allowlist support and webhook
-- idempotency.
--
-- Apply with the Supabase CLI: `supabase db push` (see supabase/README.md).
-- This migration is additive — it does not modify 0001_init.sql.

-- =========================================================================
-- orders: extra columns needed for checkout, Mollie and conversion tracking
-- =========================================================================
alter table public.orders
  add column if not exists order_number text unique,
  add column if not exists phone text,
  add column if not exists mollie_payment_status text,
  add column if not exists payment_method text,
  add column if not exists btw_cents integer not null default 0 check (btw_cents >= 0),
  add column if not exists newsletter_opt_in boolean not null default false,
  add column if not exists terms_accepted_at timestamptz,
  add column if not exists conversion_tracked_at timestamptz,
  add column if not exists track_and_trace_code text,
  add column if not exists carrier text,
  add column if not exists abandoned_email_sent_at timestamptz,
  add column if not exists review_invite_sent_at timestamptz,
  add column if not exists delivered_at timestamptz,
  add column if not exists paid_at timestamptz;

comment on column public.orders.order_number is 'Human-facing order number, format KB-2026-000123. Generated before payment.';
comment on column public.orders.btw_cents is 'BTW (VAT) portion of total_cents, shown separately at checkout/emails.';

-- Widen status check to the full lifecycle used by the admin flow.
alter table public.orders drop constraint if exists orders_status_check;
alter table public.orders add constraint orders_status_check check (
  status in (
    'pending', 'betaald', 'mislukt', 'besteld_bij_leverancier',
    'verzonden', 'geleverd', 'geretourneerd', 'terugbetaald',
    -- legacy English values kept for backward compatibility with 0001 rows
    'paid', 'processing', 'shipped', 'delivered', 'cancelled', 'refunded'
  )
);

create unique index if not exists orders_order_number_idx on public.orders (order_number);

-- =========================================================================
-- order_status_history
-- =========================================================================
create table if not exists public.order_status_history (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references public.orders (id) on delete cascade,
  status text not null,
  note text,
  created_at timestamptz not null default now()
);

create index if not exists order_status_history_order_id_idx on public.order_status_history (order_id);

comment on table public.order_status_history is 'Audit trail of every status change on an order.';

-- =========================================================================
-- processed_webhook_events
-- Idempotency guard for Mollie webhook deliveries: a payment ID that has
-- already been processed to completion is skipped on redelivery.
-- =========================================================================
create table if not exists public.processed_webhook_events (
  id uuid primary key default gen_random_uuid(),
  provider text not null default 'mollie',
  event_id text not null,
  order_id uuid references public.orders (id) on delete set null,
  resulting_status text,
  created_at timestamptz not null default now(),
  unique (provider, event_id)
);

comment on table public.processed_webhook_events is 'Idempotency ledger for payment webhooks — prevents double-processing an order on duplicate deliveries.';

-- =========================================================================
-- reviews: review-invite tokens tied to a real order
-- =========================================================================
alter table public.reviews
  add column if not exists order_id uuid references public.orders (id) on delete set null,
  add column if not exists review_token text unique;

comment on column public.reviews.review_token is 'One-time token from the review-invite email; only holders of a valid token for a delivered order may submit a review.';

create table if not exists public.review_invites (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references public.orders (id) on delete cascade,
  token text not null unique,
  used_at timestamptz,
  created_at timestamptz not null default now()
);

create index if not exists review_invites_order_id_idx on public.review_invites (order_id);

comment on table public.review_invites is 'Tokens sent in the 7-day-post-delivery review invite email. Redeemable once on /beoordelen/[token].';

-- =========================================================================
-- RLS: enable + policies for the new tables
-- =========================================================================
alter table public.order_status_history enable row level security;
alter table public.processed_webhook_events enable row level security;
alter table public.review_invites enable row level security;

create policy "Service role manages order_status_history"
  on public.order_status_history for all
  to service_role
  using (true)
  with check (true);

create policy "Service role manages processed_webhook_events"
  on public.processed_webhook_events for all
  to service_role
  using (true)
  with check (true);

create policy "Service role manages review_invites"
  on public.review_invites for all
  to service_role
  using (true)
  with check (true);

-- --- guest order lookup (order_number + email) is intentionally NOT exposed
-- via an RLS policy: Postgres RLS policies cannot see application query
-- parameters, so a `using (true)` policy "scoped" to order_number+email in
-- the client query would in fact allow the anon key to read/enumerate every
-- order. Instead, guest flows (/order-volgen, /bedankt/[ordernummer]) call a
-- server-side helper (`getOrderByNumberAndEmail` in lib/orders.ts) that runs
-- with the service_role key ONLY on the server, and itself enforces the
-- order_number+email match before returning a row. No anon policy is added
-- for `orders` or `order_items` beyond what 0001_init.sql already defines
-- (the authenticated "own order" policies for future account-based
-- customers) — every guest checkout read/write goes through server code.
