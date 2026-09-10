import Link from "next/link";
import { nav, site } from "@/lib/site";

export default function Header() {
  return (
    <header className="sticky top-0 z-40 border-b border-border bg-surface/95 backdrop-blur">
      <div className="mx-auto flex max-w-6xl items-center justify-between px-4 py-4">
        <Link
          href="/"
          className="font-heading text-xl font-semibold tracking-tight text-ink"
        >
          {site.brand}
        </Link>
        <nav aria-label="Hoofdnavigatie">
          <ul className="hidden items-center gap-6 text-sm font-medium text-ink md:flex">
            {nav.map((item) => (
              <li key={item.href}>
                <Link
                  href={item.href}
                  className="rounded px-1 py-1 transition-colors hover:text-accent"
                >
                  {item.label}
                </Link>
              </li>
            ))}
          </ul>
        </nav>
        <div className="flex items-center gap-3">
          <Link
            href={`/${site.productSlug}`}
            className="rounded-full bg-accent px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-accent-dark"
          >
            Bekijk product
          </Link>
        </div>
      </div>
      <nav aria-label="Mobiele navigatie" className="md:hidden">
        <ul className="flex flex-wrap items-center justify-center gap-4 border-t border-border px-4 py-2 text-sm font-medium text-ink">
          {nav.map((item) => (
            <li key={item.href}>
              <Link
                href={item.href}
                className="rounded px-1 py-1 transition-colors hover:text-accent"
              >
                {item.label}
              </Link>
            </li>
          ))}
        </ul>
      </nav>
    </header>
  );
}
