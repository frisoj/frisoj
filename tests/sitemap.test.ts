import { describe, expect, it } from "vitest";
import sitemap from "@/app/sitemap";
import { site } from "@/lib/site";

describe("sitemap generation", () => {
  it("includes the homepage and product page with lastmod", async () => {
    const entries = await sitemap();
    const home = entries.find((e) => e.url === `${site.url}/`);
    const product = entries.find((e) => e.url === `${site.url}/${site.productSlug}`);
    expect(home).toBeTruthy();
    expect(home?.lastModified).toBeInstanceOf(Date);
    expect(product).toBeTruthy();
  });

  it("includes every seeded published blog post", async () => {
    const entries = await sitemap();
    const blogEntries = entries.filter((e) => e.url.includes("/blog/"));
    expect(blogEntries.length).toBeGreaterThanOrEqual(5);
    for (const entry of blogEntries) {
      expect(entry.lastModified).toBeInstanceOf(Date);
    }
  });

  it("never lists excluded paths (admin/api/checkout/thank-you)", async () => {
    const entries = await sitemap();
    for (const entry of entries) {
      expect(entry.url).not.toMatch(/\/(admin|api|afrekenen|bedankt)(\/|$)/);
    }
  });

  it("produces unique URLs", async () => {
    const entries = await sitemap();
    const urls = entries.map((e) => e.url);
    expect(new Set(urls).size).toBe(urls.length);
  });
});
