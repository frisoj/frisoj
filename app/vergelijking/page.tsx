import type { Metadata } from "next";
import Breadcrumbs from "@/components/Breadcrumbs";
import SectionHeading from "@/components/SectionHeading";
import { brandLabels, brands, comparisonRows } from "@/lib/comparison";
import { buildMetadata } from "@/lib/seo";
import { breadcrumbJsonLd, JsonLd } from "@/lib/jsonld";
import { site } from "@/lib/site";

export const metadata: Metadata = buildMetadata({
  title: "Zelfreinigende kattenbak vergelijken | PureLitter",
  description:
    "Vergelijk PureLitter met Litter-Robot, PetKit, Catlink en een premium handmatige kattenbak op prijs, capaciteit, veiligheid, levertijd en garantie.",
  path: "/vergelijking",
});

export default function ComparisonPage() {
  return (
    <div className="mx-auto max-w-6xl px-4 py-10 sm:py-14">
      <JsonLd data={breadcrumbJsonLd([{ label: "Vergelijking" }])} />
      <Breadcrumbs items={[{ label: "Vergelijking" }]} />
      <SectionHeading
        eyebrow="Vergelijking"
        title="PureLitter vergeleken met andere kattenbakken"
        description="Een eerlijke vergelijking — inclusief waar we zelf niet de beste keuze zijn."
      />

      <p className="mt-6 max-w-2xl text-sm text-ink-muted">
        We vergelijken hier alleen kenmerken waar we redelijk zeker van zijn.
        Waar we de exacte specificatie van een concurrent niet kunnen
        verifiëren, staat dat er expliciet bij als{" "}
        <span className="font-semibold text-ink">[CONTROLEREN]</span> — we
        doen geen onderbouwde uitspraken over concurrenten die we niet met
        zekerheid kunnen staven.
      </p>

      {/* Mobile: cards per brand */}
      <div className="mt-8 grid gap-6 sm:hidden">
        {brands.map((brand) => (
          <div key={brand} className="rounded-2xl border border-border bg-surface p-5">
            <p
              className={`font-heading text-lg font-semibold ${
                brand === "purelitter" ? "text-accent" : "text-ink"
              }`}
            >
              {brandLabels[brand]}
            </p>
            <dl className="mt-3 space-y-2 text-sm">
              {comparisonRows.map((row) => (
                <div key={row.feature} className="border-t border-border pt-2 first:border-0 first:pt-0">
                  <dt className="text-xs font-semibold uppercase tracking-wide text-ink-muted">{row.feature}</dt>
                  <dd className="mt-0.5 text-ink">{row.values[brand]}</dd>
                </div>
              ))}
            </dl>
          </div>
        ))}
      </div>

      {/* Desktop / tablet: scrollable table with sticky first column */}
      <div className="mt-8 hidden overflow-x-auto rounded-2xl border border-border sm:block">
        <table className="w-full min-w-[900px] border-collapse text-left text-sm">
          <thead>
            <tr className="bg-cream">
              <th scope="col" className="sticky left-0 z-10 bg-cream px-5 py-3 font-semibold text-ink">
                Kenmerk
              </th>
              {brands.map((brand) => (
                <th
                  key={brand}
                  scope="col"
                  className={`px-5 py-3 font-semibold ${brand === "purelitter" ? "text-accent" : "text-ink"}`}
                >
                  {brandLabels[brand]}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {comparisonRows.map((row, index) => (
              <tr key={row.feature} className={index % 2 === 0 ? "bg-surface" : "bg-cream"}>
                <th
                  scope="row"
                  className={`sticky left-0 z-10 px-5 py-3 font-medium text-ink ${
                    index % 2 === 0 ? "bg-surface" : "bg-cream"
                  }`}
                >
                  {row.feature}
                </th>
                {brands.map((brand) => (
                  <td key={brand} className="px-5 py-3 text-ink-muted">
                    {row.values[brand]}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <section className="mt-12 rounded-2xl border border-dashed border-border bg-surface p-6">
        <h2 className="font-heading text-xl font-semibold text-ink">Wanneer zijn wij niet de beste keuze?</h2>
        <p className="mt-2 max-w-2xl text-ink-muted">
          {site.brand} is ontworpen voor huishoudens met één tot drie katten
          binnen het aangegeven gewichtsbereik (zie de specificaties op de{" "}
          <a href={`/${site.productSlug}`} className="text-accent underline hover:text-accent-dark">
            productpagina
          </a>
          ). Heb je meer dan drie katten in huis, een erg zware kat boven het
          maximumgewicht, of zoek je specifiek een bak met een functie die
          wij niet aanbieden, dan kan een ander model beter passen. We
          vermelden dit liever eerlijk dan dat we net doen alsof één bak voor
          elk huishouden de beste keuze is.
        </p>
      </section>
    </div>
  );
}
