import Link from "next/link";
import { nav, site } from "@/lib/site";

export default function Footer() {
  return (
    <footer className="mt-16 border-t border-border bg-surface">
      <div className="mx-auto max-w-6xl px-4 py-12">
        <div className="grid gap-10 sm:grid-cols-3">
          <div>
            <p className="font-heading text-lg font-semibold text-ink">
              {site.brand}
            </p>
            <p className="mt-2 max-w-xs text-sm text-ink-muted">
              {site.tagline}. Premium, hygiënisch kattengemak — geleverd in
              Nederland en België.
            </p>
          </div>
          <nav aria-label="Footernavigatie">
            <p className="text-sm font-semibold text-ink">Navigatie</p>
            <ul className="mt-3 space-y-2 text-sm text-ink-muted">
              {nav.slice(1).map((item) => (
                <li key={item.href}>
                  <Link
                    href={item.href}
                    className="rounded hover:text-accent"
                  >
                    {item.label}
                  </Link>
                </li>
              ))}
            </ul>
          </nav>
          <div>
            <p className="text-sm font-semibold text-ink">Bedrijfsgegevens</p>
            <ul className="mt-3 space-y-1 text-sm text-ink-muted">
              <li>{site.legalName}</li>
              <li>KVK: {site.kvk}</li>
              <li>BTW: {site.btw}</li>
              <li>{site.address}</li>
              <li>
                <a
                  href={`mailto:${site.email}`}
                  className="rounded hover:text-accent"
                >
                  {site.email}
                </a>
              </li>
            </ul>
          </div>
        </div>
        <div className="mt-10 flex flex-col gap-2 border-t border-border pt-6 text-xs text-ink-muted sm:flex-row sm:items-center sm:justify-between">
          <p>
            © {new Date().getFullYear()} {site.legalName}. Alle rechten
            voorbehouden.
          </p>
          <p>Placeholder bedrijfsgegevens — zie DECISIONS.md.</p>
        </div>
      </div>
    </footer>
  );
}
