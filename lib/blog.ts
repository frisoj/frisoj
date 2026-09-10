import "server-only";
import { getSupabaseServiceClient, isSupabaseConfigured } from "./supabase/server";
import type { BlogPostRow } from "./supabase/types";
import { estimateReadingMinutes } from "./markdown";

import { body as beste2026 } from "./blog-content/beste-zelfreinigende-kattenbak-2026.md";
import { body as investering } from "./blog-content/zelfreinigende-kattenbak-de-investering-waard.md";
import { body as wennen } from "./blog-content/kat-wennen-aan-automatische-kattenbak.md";
import { body as vulling } from "./blog-content/kattenbakvulling-voor-zelfreinigende-kattenbak.md";
import { body as stinkt } from "./blog-content/kattenbak-stinkt-oorzaken-en-oplossingen.md";

// ===========================================================================
// Blog data layer — same fallback pattern as lib/orders.ts (see
// DECISIONS.md, "Phase 3 — blog/kennisbank data layer"): reads/writes go to
// Supabase's `blog_posts` table when a live project is configured, and
// otherwise fall back to an in-memory mock store seeded with 5 real
// articles, so the blog works today without a live database and content
// added via /admin/blog is visible immediately in this process.
// ===========================================================================

const PAGE_SIZE = 6;

const seedPosts: BlogPostRow[] = [
  {
    id: "10000000-0000-4000-8000-000000000001",
    slug: "beste-zelfreinigende-kattenbak-2026",
    title: "Beste zelfreinigende kattenbak 2026: complete koopgids",
    excerpt:
      "Waar moet je op letten bij een zelfreinigende kattenbak? Capaciteit, geluid, app, veiligheid en vulling — met vergelijkingstabel en conclusie.",
    body: beste2026,
    meta_description:
      "Zelfreinigende kattenbak kopen in 2026? Deze gids zet capaciteit, geluid, veiligheid, app en vulling naast elkaar, met vergelijkingstabel.",
    cover_image_url: "/images/blog/beste-zelfreinigende-kattenbak-2026.svg",
    hero_image_alt: "Illustratie van een zelfreinigende kattenbak met keuzecriteria eromheen",
    author_name: "PureLitter-team",
    is_published: true,
    published_at: "2026-01-12T09:00:00.000Z",
    created_at: "2026-01-10T09:00:00.000Z",
    updated_at: "2026-06-02T09:00:00.000Z",
  },
  {
    id: "10000000-0000-4000-8000-000000000002",
    slug: "zelfreinigende-kattenbak-de-investering-waard",
    title: "Is een zelfreinigende kattenbak de investering waard?",
    excerpt:
      "Kosten versus tijdwinst en hygiëne: wanneer een zelfreinigende kattenbak wél en wanneer juist geen goede keuze is.",
    body: investering,
    meta_description:
      "Kost een zelfreinigende kattenbak zich terug? We wegen kosten af tegen tijdwinst en hygiëne, en laten zien wanneer het wel of niet past.",
    cover_image_url: "/images/blog/zelfreinigende-kattenbak-de-investering-waard.svg",
    hero_image_alt: "Weegschaal met een kattenbak op de ene kant en een klok op de andere",
    author_name: "PureLitter-team",
    is_published: true,
    published_at: "2026-02-03T09:00:00.000Z",
    created_at: "2026-02-01T09:00:00.000Z",
    updated_at: "2026-02-03T09:00:00.000Z",
  },
  {
    id: "10000000-0000-4000-8000-000000000003",
    slug: "kat-wennen-aan-automatische-kattenbak",
    title: "Je kat laten wennen aan een automatische kattenbak",
    excerpt:
      "Een stapsgewijs schema van 1-2 weken, veelgemaakte fouten en signalen dat je (tijdelijk) moet terugvallen op de oude bak.",
    body: wennen,
    meta_description:
      "Stapsgewijs wenschema van 1-2 weken om je kat te laten wennen aan een automatische kattenbak, plus veelgemaakte fouten en waarschuwingssignalen.",
    cover_image_url: "/images/blog/kat-wennen-aan-automatische-kattenbak.svg",
    hero_image_alt: "Kat die voorzichtig een zelfreinigende kattenbak besnuffelt",
    author_name: "PureLitter-team",
    is_published: true,
    published_at: "2026-03-10T09:00:00.000Z",
    created_at: "2026-03-08T09:00:00.000Z",
    updated_at: "2026-03-10T09:00:00.000Z",
  },
  {
    id: "10000000-0000-4000-8000-000000000004",
    slug: "kattenbakvulling-voor-zelfreinigende-kattenbak",
    title: "Kattenbakvulling voor een zelfreinigende kattenbak",
    excerpt:
      "Klontvorming, korrelgrootte en wat vaak niet goed werkt — praktische tips voor de juiste vulling.",
    body: vulling,
    meta_description:
      "Welke kattenbakvulling werkt goed in een zelfreinigende kattenbak? Klontvorming, korrelgrootte en praktische tips voor een schone bak.",
    cover_image_url: "/images/blog/kattenbakvulling-voor-zelfreinigende-kattenbak.svg",
    hero_image_alt: "Close-up van fijnkorrelige, klontvormende kattenbakvulling",
    author_name: "PureLitter-team",
    is_published: true,
    published_at: "2026-04-08T09:00:00.000Z",
    created_at: "2026-04-06T09:00:00.000Z",
    updated_at: "2026-04-08T09:00:00.000Z",
  },
  {
    id: "10000000-0000-4000-8000-000000000005",
    slug: "kattenbak-stinkt-oorzaken-en-oplossingen",
    title: "Kattenbak stinkt: 7 oorzaken en oplossingen",
    excerpt:
      "Van een volle opvangbak tot een vervuild mechanisme: zeven veelvoorkomende oorzaken, elk met een concrete oplossing.",
    body: stinkt,
    meta_description:
      "Kattenbak stinkt? Dit zijn 7 veelvoorkomende oorzaken bij een zelfreinigende kattenbak, elk met een concrete oplossing en wanneer je een dierenarts belt.",
    cover_image_url: "/images/blog/kattenbak-stinkt-oorzaken-en-oplossingen.svg",
    hero_image_alt: "Kattenbak met een ventilatie- en checklist-icoon ernaast",
    author_name: "PureLitter-team",
    is_published: true,
    published_at: "2026-05-14T09:00:00.000Z",
    created_at: "2026-05-12T09:00:00.000Z",
    updated_at: "2026-05-14T09:00:00.000Z",
  },
];

const globalKey = "__purelitter_mock_blog__";
type GlobalWithBlog = typeof globalThis & { [globalKey]?: BlogPostRow[] };
const g = globalThis as GlobalWithBlog;

function mockPosts(): BlogPostRow[] {
  if (!g[globalKey]) g[globalKey] = seedPosts.map((p) => ({ ...p }));
  return g[globalKey]!;
}

export type BlogPostSummary = BlogPostRow & { readingMinutes: number };

function withReadingTime(post: BlogPostRow): BlogPostSummary {
  return { ...post, readingMinutes: estimateReadingMinutes(post.body ?? "") };
}

export async function listPublishedPosts(page = 1): Promise<{ posts: BlogPostSummary[]; total: number; pageSize: number }> {
  const from = (page - 1) * PAGE_SIZE;
  const to = from + PAGE_SIZE - 1;

  const supabase = getSupabaseServiceClient();
  if (supabase && isSupabaseConfigured()) {
    const { data, count } = await supabase
      .from("blog_posts")
      .select("*", { count: "exact" })
      .eq("is_published", true)
      .order("published_at", { ascending: false })
      .range(from, to);
    return { posts: (data ?? []).map(withReadingTime), total: count ?? 0, pageSize: PAGE_SIZE };
  }

  const all = mockPosts()
    .filter((p) => p.is_published)
    .sort((a, b) => (b.published_at ?? "").localeCompare(a.published_at ?? ""));
  return { posts: all.slice(from, to + 1).map(withReadingTime), total: all.length, pageSize: PAGE_SIZE };
}

export async function getPostBySlug(slug: string): Promise<BlogPostSummary | null> {
  const supabase = getSupabaseServiceClient();
  if (supabase && isSupabaseConfigured()) {
    const { data } = await supabase.from("blog_posts").select("*").eq("slug", slug).maybeSingle();
    return data ? withReadingTime(data) : null;
  }
  const post = mockPosts().find((p) => p.slug === slug && p.is_published);
  return post ? withReadingTime(post) : null;
}

export async function getRelatedPosts(excludeSlug: string, limit = 3): Promise<BlogPostSummary[]> {
  const { posts } = await listPublishedPosts(1);
  const rest = posts.filter((p) => p.slug !== excludeSlug);
  if (rest.length >= limit) return rest.slice(0, limit);
  // Not enough on page 1 in a real DB with many posts — fetch a bit more.
  const supabase = getSupabaseServiceClient();
  if (supabase && isSupabaseConfigured()) {
    const { data } = await supabase
      .from("blog_posts")
      .select("*")
      .eq("is_published", true)
      .neq("slug", excludeSlug)
      .order("published_at", { ascending: false })
      .limit(limit);
    return (data ?? []).map(withReadingTime);
  }
  return rest;
}

export async function listAllPostsForAdmin(): Promise<BlogPostRow[]> {
  const supabase = getSupabaseServiceClient();
  if (supabase && isSupabaseConfigured()) {
    const { data } = await supabase.from("blog_posts").select("*").order("updated_at", { ascending: false });
    return data ?? [];
  }
  return [...mockPosts()].sort((a, b) => b.updated_at.localeCompare(a.updated_at));
}

export async function getPostByIdForAdmin(id: string): Promise<BlogPostRow | null> {
  const supabase = getSupabaseServiceClient();
  if (supabase && isSupabaseConfigured()) {
    const { data } = await supabase.from("blog_posts").select("*").eq("id", id).maybeSingle();
    return data ?? null;
  }
  return mockPosts().find((p) => p.id === id) ?? null;
}

export type BlogPostInput = {
  slug: string;
  title: string;
  excerpt: string;
  body: string;
  metaDescription: string;
  coverImageUrl: string;
  heroImageAlt: string;
  authorName: string;
  isPublished: boolean;
};

export async function createPost(input: BlogPostInput): Promise<BlogPostRow> {
  const now = new Date().toISOString();
  const row: BlogPostRow = {
    id: crypto.randomUUID(),
    slug: input.slug,
    title: input.title,
    excerpt: input.excerpt,
    body: input.body,
    meta_description: input.metaDescription,
    cover_image_url: input.coverImageUrl || null,
    hero_image_alt: input.heroImageAlt || null,
    author_name: input.authorName || "PureLitter-team",
    is_published: input.isPublished,
    published_at: input.isPublished ? now : null,
    created_at: now,
    updated_at: now,
  };

  const supabase = getSupabaseServiceClient();
  if (supabase && isSupabaseConfigured()) {
    const { data, error } = await supabase.from("blog_posts").insert(row).select("*").single();
    if (error) throw new Error(error.message);
    return data;
  }
  mockPosts().unshift(row);
  return row;
}

export async function updatePost(id: string, input: BlogPostInput): Promise<BlogPostRow> {
  const now = new Date().toISOString();

  const supabase = getSupabaseServiceClient();
  if (supabase && isSupabaseConfigured()) {
    const existing = await getPostByIdForAdmin(id);
    const published_at = input.isPublished ? existing?.published_at ?? now : null;
    const { data, error } = await supabase
      .from("blog_posts")
      .update({
        slug: input.slug,
        title: input.title,
        excerpt: input.excerpt,
        body: input.body,
        meta_description: input.metaDescription,
        cover_image_url: input.coverImageUrl || null,
        hero_image_alt: input.heroImageAlt || null,
        author_name: input.authorName || "PureLitter-team",
        is_published: input.isPublished,
        published_at,
        updated_at: now,
      })
      .eq("id", id)
      .select("*")
      .single();
    if (error) throw new Error(error.message);
    return data;
  }

  const posts = mockPosts();
  const idx = posts.findIndex((p) => p.id === id);
  if (idx === -1) throw new Error("Artikel niet gevonden.");
  const existing = posts[idx];
  const updated: BlogPostRow = {
    ...existing,
    slug: input.slug,
    title: input.title,
    excerpt: input.excerpt,
    body: input.body,
    meta_description: input.metaDescription,
    cover_image_url: input.coverImageUrl || null,
    hero_image_alt: input.heroImageAlt || null,
    author_name: input.authorName || "PureLitter-team",
    is_published: input.isPublished,
    published_at: input.isPublished ? existing.published_at ?? now : null,
    updated_at: now,
  };
  posts[idx] = updated;
  return updated;
}

export async function deletePost(id: string): Promise<void> {
  const supabase = getSupabaseServiceClient();
  if (supabase && isSupabaseConfigured()) {
    await supabase.from("blog_posts").delete().eq("id", id);
    return;
  }
  const posts = mockPosts();
  const idx = posts.findIndex((p) => p.id === id);
  if (idx !== -1) posts.splice(idx, 1);
}
