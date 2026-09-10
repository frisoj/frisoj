// Centralized JSON-LD generation — every structured-data block on the site
// is built here so the shape stays consistent and there is one place to
// validate against schema.org (see scripts/validate-jsonld.mjs).
import { site } from "./site";
import type { BlogPostSummary } from "./blog";
import type { FaqItemRow } from "./supabase/types";

export function organizationJsonLd() {
  return {
    "@context": "https://schema.org",
    "@type": "Organization",
    name: site.legalName,
    alternateName: site.brand,
    url: site.url,
    logo: `${site.url}/images/hero-litterbox.svg`,
    email: site.email,
    contactPoint: {
      "@type": "ContactPoint",
      email: site.email,
      contactType: "customer service",
      areaServed: ["NL", "BE"],
      availableLanguage: ["nl"],
    },
    // Placeholder — add real social profile URLs once they exist.
    sameAs: [] as string[],
  };
}

export function websiteJsonLd() {
  return {
    "@context": "https://schema.org",
    "@type": "WebSite",
    name: site.brand,
    url: site.url,
    inLanguage: "nl-NL",
  };
}

export function breadcrumbJsonLd(items: Array<{ label: string; href?: string }>) {
  return {
    "@context": "https://schema.org",
    "@type": "BreadcrumbList",
    itemListElement: [{ label: "Home", href: "/" }, ...items].map((item, index) => ({
      "@type": "ListItem",
      position: index + 1,
      name: item.label,
      item: `${site.url}${item.href ?? ""}`,
    })),
  };
}

export function productJsonLd() {
  return {
    "@context": "https://schema.org",
    "@type": "Product",
    name: site.productName,
    description:
      "Automatische, zelfreinigende kattenbak met app-bediening voor huishoudens met 1-3 katten in Nederland en België.",
    image: [`${site.url}/images/product-1.svg`],
    sku: site.defaultSku,
    brand: { "@type": "Brand", name: site.brand },
    offers: {
      "@type": "Offer",
      url: `${site.url}/${site.productSlug}`,
      priceCurrency: site.currency,
      price: site.price,
      availability: "https://schema.org/InStock",
      shippingDetails: {
        "@type": "OfferShippingDetails",
        shippingRate: { "@type": "MonetaryAmount", value: "0", currency: site.currency },
        shippingDestination: [
          { "@type": "DefinedRegion", addressCountry: "NL" },
          { "@type": "DefinedRegion", addressCountry: "BE" },
        ],
        deliveryTime: {
          "@type": "ShippingDeliveryTime",
          handlingTime: { "@type": "QuantitativeValue", minValue: 0, maxValue: 1, unitCode: "DAY" },
          transitTime: { "@type": "QuantitativeValue", minValue: 1, maxValue: 4, unitCode: "DAY" },
        },
      },
      hasMerchantReturnPolicy: {
        "@type": "MerchantReturnPolicy",
        applicableCountry: ["NL", "BE"],
        returnPolicyCategory: "https://schema.org/MerchantReturnFiniteReturnWindow",
        merchantReturnDays: 14,
        returnMethod: "https://schema.org/ReturnByMail",
        returnFees: "https://schema.org/FreeReturn",
      },
    },
    // AggregateRating intentionally omitted — no real approved reviews yet
    // (honest-empty-state decision from Phase 1). Add only once real,
    // published reviews exist in `reviews`.
  };
}

export function faqPageJsonLd(items: FaqItemRow[]) {
  return {
    "@context": "https://schema.org",
    "@type": "FAQPage",
    mainEntity: items.map((item) => ({
      "@type": "Question",
      name: item.question,
      acceptedAnswer: { "@type": "Answer", text: item.answer },
    })),
  };
}

export function articleJsonLd(post: BlogPostSummary) {
  return {
    "@context": "https://schema.org",
    "@type": "BlogPosting",
    headline: post.title,
    description: post.meta_description ?? post.excerpt ?? undefined,
    image: post.cover_image_url ? [`${site.url}${post.cover_image_url}`] : undefined,
    author: { "@type": "Organization", name: post.author_name },
    publisher: { "@type": "Organization", name: site.legalName, logo: { "@type": "ImageObject", url: `${site.url}/images/hero-litterbox.svg` } },
    datePublished: post.published_at ?? post.created_at,
    dateModified: post.updated_at,
    mainEntityOfPage: `${site.url}/blog/${post.slug}`,
  };
}

export function JsonLd({ data }: { data: object }) {
  return <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(data) }} />;
}
