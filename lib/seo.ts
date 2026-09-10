import type { Metadata } from "next";
import { site } from "./site";

// Centralized metadata builder: canonical + Open Graph + Twitter card +
// hreflang (nl-NL, nl-BE, x-default) for every page, so each page only has
// to supply title/description/path. Titles are capped at ~60 chars and
// descriptions at ~155 chars by convention in the callers — kept as plain
// strings here rather than enforced/truncated, so content authors stay in
// control of exact wording.
export function buildMetadata({
  title,
  description,
  path,
  ogType = "website",
  image = "/images/hero-litterbox.svg",
}: {
  title: string;
  description: string;
  path: string;
  ogType?: "website" | "article";
  image?: string;
}): Metadata {
  const url = `${site.url}${path}`;
  return {
    title,
    description,
    alternates: {
      canonical: path,
      languages: {
        "nl-NL": `${site.url}${path}`,
        "nl-BE": `${site.url}${path}`,
        "x-default": `${site.url}${path}`,
      },
    },
    openGraph: {
      title,
      description,
      url,
      siteName: site.brand,
      locale: "nl_NL",
      type: ogType,
      images: [{ url: image }],
    },
    twitter: {
      card: "summary_large_image",
      title,
      description,
      images: [image],
    },
  };
}
