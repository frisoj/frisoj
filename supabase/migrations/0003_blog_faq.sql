-- Phase 3: blog/kennisbank + FAQ content management.
--
-- Extends blog_posts (from 0001_init.sql) with the fields the /admin/blog
-- editor and the public blog pages need (meta description, hero image alt
-- text, author, explicit updated_at already existed). Adds a faq_items
-- table for /admin/faq and the public FAQ page.

alter table public.blog_posts
  add column if not exists meta_description text,
  add column if not exists hero_image_alt text,
  add column if not exists author_name text not null default 'PureLitter-team';

comment on column public.blog_posts.meta_description is 'Max ~155 chars, used for <meta name="description"> and OG description on the article page.';
comment on column public.blog_posts.hero_image_alt is 'Alt text for the hero/cover image — required for accessible, SEO-friendly images.';

-- =========================================================================
-- faq_items
-- =========================================================================
create table if not exists public.faq_items (
  id uuid primary key default gen_random_uuid(),
  category text not null check (
    category in (
      'product_werking', 'veiligheid_kat', 'vulling_onderhoud',
      'bestellen_betalen', 'verzending', 'retour_garantie'
    )
  ),
  question text not null,
  answer text not null,
  sort_order integer not null default 0,
  is_published boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists faq_items_category_sort_idx on public.faq_items (category, sort_order);

comment on table public.faq_items is 'FAQ content for /veelgestelde-vragen and the product-page preview. Editable via /admin/faq.';

alter table public.faq_items enable row level security;

create policy "Public can read published faq items"
  on public.faq_items for select
  to anon, authenticated
  using (is_published = true);

create policy "Service role manages faq_items"
  on public.faq_items for all
  to service_role
  using (true)
  with check (true);
