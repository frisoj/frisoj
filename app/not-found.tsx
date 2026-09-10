import Link from "next/link";
import { nav, site } from "@/lib/site";

export default function NotFound() {
  return (
    <div className="mx-auto flex max-w-2xl flex-col items-center px-4 py-20 text-center">
      <p className="font-heading text-6xl font-semibold text-accent">404</p>
      <h1 className="mt-4 font-heading text-2xl font-semibold text-ink">
        Deze pagina bestaat niet (meer)
      </h1>
      <p className="mt-3 text-ink-muted">
        Het lijkt erop dat de link verkeerd is, of de pagina is verplaatst.
        Gebruik de navigatie hieronder, of ga direct naar het product.
      </p>

      <Link
        href={`/${site.productSlug}`}
        className="mt-8 rounded-full bg-accent px-6 py-3 text-sm font-semibold text-white transition-colors hover:bg-accent-dark"
      >
        Bekijk {site.productName}
      </Link>

      <nav aria-label="Snelle links" className="mt-10">
        <ul className="flex flex-wrap justify-center gap-3 text-sm">
          {nav.map((item) => (
            <li key={item.href}>
              <Link
                href={item.href}
                className="rounded-full border border-border px-4 py-2 text-ink hover:border-accent hover:text-accent"
              >
                {item.label}
              </Link>
            </li>
          ))}
        </ul>
      </nav>
    </div>
  );
}
