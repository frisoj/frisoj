import type { MetadataRoute } from "next";
import { site } from "@/lib/site";
import { legalNav } from "@/lib/site";
import { listAllPostsForAdmin } from "@/lib/blog";

// Dynamic sitemap: static marketing/service pages plus every blog post
// (published or not — draft posts are excluded below), each with a real
// lastmod so search engines can prioritize re-crawls. /admin, /api,
// /afrekenen and /bedankt are intentionally excluded (see robots.ts) so
// they are not listed here either.
export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const now = new Date();

  const staticPages: MetadataRoute.Sitemap = [
    { url: `${site.url}/`, lastModified: now, changeFrequency: "weekly", priority: 1 },
    { url: `${site.url}/${site.productSlug}`, lastModified: now, changeFrequency: "weekly", priority: 0.9 },
    { url: `${site.url}/blog`, lastModified: now, changeFrequency: "daily", priority: 0.7 },
    { url: `${site.url}/vergelijking`, lastModified: now, changeFrequency: "monthly", priority: 0.6 },
    { url: `${site.url}/veelgestelde-vragen`, lastModified: now, changeFrequency: "monthly", priority: 0.6 },
    { url: `${site.url}/over-ons`, lastModified: now, changeFrequency: "monthly", priority: 0.4 },
    { url: `${site.url}/contact`, lastModified: now, changeFrequency: "monthly", priority: 0.4 },
    { url: `${site.url}/winkelwagen`, lastModified: now, changeFrequency: "monthly", priority: 0.2 },
    { url: `${site.url}/order-volgen`, lastModified: now, changeFrequency: "monthly", priority: 0.2 },
    ...legalNav.map((item) => ({
      url: `${site.url}${item.href}`,
      lastModified: now,
      changeFrequency: "yearly" as const,
      priority: 0.3,
    })),
  ];

  const posts = await listAllPostsForAdmin();
  const blogPages: MetadataRoute.Sitemap = posts
    .filter((p) => p.is_published)
    .map((p) => ({
      url: `${site.url}/blog/${p.slug}`,
      lastModified: new Date(p.updated_at),
      changeFrequency: "monthly" as const,
      priority: 0.5,
    }));

  return [...staticPages, ...blogPages];
}
