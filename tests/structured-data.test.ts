import { describe, expect, it } from "vitest";
import {
  organizationJsonLd,
  websiteJsonLd,
  breadcrumbJsonLd,
  productJsonLd,
  faqPageJsonLd,
  articleJsonLd,
} from "@/lib/jsonld";
import type { BlogPostSummary } from "@/lib/blog";
import type { FaqItemRow } from "@/lib/supabase/types";

// Lightweight schema.org structural validation: every block must carry a
// valid @context/@type and the required properties for that type. This is
// not a full schema.org vocabulary crawl (no network access here), but it
// catches the most common mistakes — a missing required property, or a
// @type that doesn't match schema.org's spelling.
function assertBasicJsonLd(data: Record<string, unknown>, expectedType: string) {
  expect(data["@context"]).toBe("https://schema.org");
  expect(data["@type"]).toBe(expectedType);
}

describe("structured data (JSON-LD)", () => {
  it("Organization has required identity fields", () => {
    const data = organizationJsonLd();
    assertBasicJsonLd(data, "Organization");
    expect(data.name).toBeTruthy();
    expect(data.url).toMatch(/^https?:\/\//);
    expect(data.logo).toMatch(/^https?:\/\//);
  });

  it("WebSite has name and url", () => {
    const data = websiteJsonLd();
    assertBasicJsonLd(data, "WebSite");
    expect(data.name).toBeTruthy();
    expect(data.url).toMatch(/^https?:\/\//);
  });

  it("BreadcrumbList always starts with Home and has sequential positions", () => {
    const data = breadcrumbJsonLd([{ label: "Blog", href: "/blog" }, { label: "Artikel" }]);
    assertBasicJsonLd(data, "BreadcrumbList");
    const items = data.itemListElement as Array<{ position: number; name: string; item: string }>;
    expect(items).toHaveLength(3);
    expect(items[0].name).toBe("Home");
    items.forEach((item, index) => {
      expect(item.position).toBe(index + 1);
      expect(item.item).toMatch(/^https?:\/\//);
    });
  });

  it("Product has an Offer with EUR price, availability and return policy", () => {
    const data = productJsonLd();
    assertBasicJsonLd(data, "Product");
    expect(data.name).toBeTruthy();
    const offer = data.offers as Record<string, unknown>;
    expect(offer["@type"]).toBe("Offer");
    expect(offer.priceCurrency).toBe("EUR");
    expect(typeof offer.price).toBe("number");
    expect(offer.availability).toBe("https://schema.org/InStock");
    expect(offer.shippingDetails).toBeTruthy();
    const returnPolicy = offer.hasMerchantReturnPolicy as Record<string, unknown>;
    expect(returnPolicy.merchantReturnDays).toBe(14);
    // No AggregateRating without real reviews (honest-empty-state decision).
    expect("aggregateRating" in data).toBe(false);
  });

  it("FAQPage requires at least one Question/Answer pair", () => {
    const items: FaqItemRow[] = [
      {
        id: "1",
        category: "product_werking",
        question: "Werkt het?",
        answer: "Ja.",
        sort_order: 0,
        is_published: true,
        created_at: "2026-01-01T00:00:00.000Z",
        updated_at: "2026-01-01T00:00:00.000Z",
      },
    ];
    const data = faqPageJsonLd(items);
    assertBasicJsonLd(data, "FAQPage");
    const mainEntity = data.mainEntity as Array<Record<string, unknown>>;
    expect(mainEntity).toHaveLength(1);
    expect(mainEntity[0]["@type"]).toBe("Question");
    expect((mainEntity[0].acceptedAnswer as Record<string, unknown>)["@type"]).toBe("Answer");
  });

  it("BlogPosting has headline, author and dates", () => {
    const post: BlogPostSummary = {
      id: "1",
      slug: "test-artikel",
      title: "Test artikel",
      excerpt: "Samenvatting",
      body: "## Kop\n\nInhoud.",
      meta_description: "Beschrijving",
      cover_image_url: "/images/blog/test.svg",
      hero_image_alt: "Alt-tekst",
      author_name: "PureLitter-team",
      is_published: true,
      published_at: "2026-01-01T00:00:00.000Z",
      created_at: "2026-01-01T00:00:00.000Z",
      updated_at: "2026-02-01T00:00:00.000Z",
      readingMinutes: 2,
    };
    const data = articleJsonLd(post);
    assertBasicJsonLd(data, "BlogPosting");
    expect(data.headline).toBe(post.title);
    expect(data.datePublished).toBe(post.published_at);
    expect(data.dateModified).toBe(post.updated_at);
    expect((data.author as Record<string, unknown>).name).toBe(post.author_name);
  });
});
