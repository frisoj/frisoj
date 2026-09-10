import Link from "next/link";
import { site } from "@/lib/site";

export type Crumb = { label: string; href?: string };

/** Visible breadcrumb trail + matching BreadcrumbList JSON-LD. Omit on the home page. */
export default function Breadcrumbs({ items }: { items: Crumb[] }) {
  const jsonLd = {
    "@context": "https://schema.org",
    "@type": "BreadcrumbList",
    itemListElement: [{ label: "Home", href: "/" }, ...items].map((item, index) => ({
      "@type": "ListItem",
      position: index + 1,
      name: item.label,
      item: `${site.url}${item.href ?? ""}`,
    })),
  };

  return (
    <nav aria-label="Broodkruimel" className="mb-6 text-sm text-ink-muted">
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }} />
      <ol className="flex flex-wrap items-center gap-1">
        <li>
          <Link href="/" className="hover:text-accent">
            Home
          </Link>
        </li>
        {items.map((item, index) => (
          <li key={item.href ?? item.label} className="flex items-center gap-1">
            <span aria-hidden="true">/</span>
            {item.href && index < items.length - 1 ? (
              <Link href={item.href} className="hover:text-accent">
                {item.label}
              </Link>
            ) : (
              <span className="text-ink" aria-current="page">
                {item.label}
              </span>
            )}
          </li>
        ))}
      </ol>
    </nav>
  );
}
