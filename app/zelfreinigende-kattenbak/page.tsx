import Link from "next/link";
import type { Metadata } from "next";
import ProductGallery from "@/components/ProductGallery";
import StickyAddToCart from "@/components/StickyAddToCart";
import SectionHeading from "@/components/SectionHeading";
import FaqItem from "@/components/FaqItem";
import AddToCartButton from "@/components/AddToCartButton";
import Breadcrumbs from "@/components/Breadcrumbs";
import { site } from "@/lib/site";
import { listPublishedFaqs } from "@/lib/faq";
import { buildMetadata } from "@/lib/seo";
import { breadcrumbJsonLd, JsonLd, productJsonLd } from "@/lib/jsonld";

export const metadata: Metadata = buildMetadata({
  title: `${site.productName} — €${site.price} | ${site.brand}`,
  description:
    "De PureLitter zelfreinigende kattenbak: automatische reiniging, app-bediening en geschikt voor 1-3 katten. €179 incl. BTW, levering in 2-5 werkdagen in NL/BE.",
  path: `/${site.productSlug}`,
});

const galleryImages = [
  { src: "/images/product-1.svg", alt: "Placeholder: vooraanzicht van de PureLitter kattenbak" },
  { src: "/images/product-2.svg", alt: "Placeholder: zijaanzicht van de PureLitter kattenbak" },
  { src: "/images/product-3.svg", alt: "Placeholder: app-bediening naast de kattenbak" },
  { src: "/images/product-4.svg", alt: "Placeholder: detail van de opvangbak" },
];

const specs = [
  { label: "Afmetingen", value: "61 x 51 x 47 cm (l x b x h) — placeholder" },
  { label: "Geschikt tot", value: "8 kg per kat — placeholder" },
  { label: "Geluidsniveau", value: "< 45 dB tijdens reiniging — placeholder" },
  { label: "App-functies", value: "Reinigingsstatus, meldingen, gebruikslog — placeholder" },
  { label: "Stroomverbruik", value: "Ca. 15 W gemiddeld — placeholder" },
  { label: "Geschikt voor", value: "1 tot 3 katten in één huishouden" },
  { label: "Kattenbakvulling", value: "Klontvormende vulling aanbevolen" },
];

const boxContents = [
  "1x PureLitter zelfreinigende kattenbak",
  "1x opvangbak met afsluitzakjes (startvoorraad)",
  "1x voedingskabel",
  "Nederlandstalige handleiding",
  "Toegang tot de PureLitter-app",
];

const comparisonRows = [
  { feature: "Dagelijks scheppen nodig", manual: "Ja, 1-2x per dag", purelitter: "Nee, automatisch" },
  { feature: "Geurbeheersing", manual: "Beperkt", purelitter: "Afval direct afgesloten" },
  { feature: "Inzicht in gebruik", manual: "Geen", purelitter: "Via app" },
  { feature: "Tijdsinvestering per week", manual: "± 30-60 minuten", purelitter: "± 5 minuten (legen opvangbak)" },
];

export default async function ProductPage() {
  const allFaqs = await listPublishedFaqs();
  const previewFaqs = allFaqs.slice(0, 5);

  return (
    <div className="pb-24 md:pb-0">
      <div className="mx-auto max-w-6xl px-4 py-10 sm:py-14">
        <JsonLd data={productJsonLd()} />
        <JsonLd data={breadcrumbJsonLd([{ label: site.productName }])} />
        <Breadcrumbs items={[{ label: site.productName }]} />

        <div className="grid gap-10 lg:grid-cols-2">
          <ProductGallery images={galleryImages} />

          <div>
            <h1 className="font-heading text-3xl font-semibold text-ink sm:text-4xl">
              {site.productName}
            </h1>
            <p className="mt-3 text-ink-muted">
              Automatische reiniging na elk toiletbezoek, app-bediening en een
              rustige werking — zodat jij minder tijd kwijt bent aan de
              kattenbak.
            </p>

            <div className="mt-6 flex items-baseline gap-3">
              <span className="font-heading text-4xl font-semibold text-ink">
                €{site.price}
              </span>
              <span className="text-sm text-ink-muted">incl. BTW, excl. verzendkosten (gratis NL/BE)</span>
            </div>

            <ul className="mt-6 space-y-2 text-sm text-ink-muted">
              <li>✓ Gratis verzending naar Nederland en België</li>
              <li>✓ 14 dagen bedenktijd</li>
              <li>✓ 2 jaar garantie</li>
              <li>✓ Levering binnen 2-5 werkdagen</li>
            </ul>

            <div className="hidden sm:block">
              <AddToCartButton
                variantId={site.defaultVariantId}
                sku={site.defaultSku}
                productSlug={site.productSlug}
                name={site.productName}
                unitPriceCents={site.price * 100}
                image="/images/product-1.svg"
                className="mt-8 w-full rounded-full bg-accent px-6 py-3 text-base font-semibold text-white transition-colors hover:bg-accent-dark md:w-auto md:px-10"
              />
            </div>
          </div>
        </div>

        {/* Specs */}
        <section className="mt-16">
          <SectionHeading eyebrow="Specificaties" title="Alle details" />
          <div className="mt-6 overflow-x-auto rounded-2xl border border-border">
            <table className="w-full min-w-[480px] border-collapse text-left text-sm">
              <tbody>
                {specs.map((spec, index) => (
                  <tr
                    key={spec.label}
                    className={index % 2 === 0 ? "bg-surface" : "bg-cream"}
                  >
                    <th
                      scope="row"
                      className="w-1/3 px-5 py-3 font-semibold text-ink"
                    >
                      {spec.label}
                    </th>
                    <td className="px-5 py-3 text-ink-muted">{spec.value}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="mt-3 text-xs text-ink-muted">
            Specificaties zijn placeholders voor Fase 1 — vervang door de
            werkelijke productdata. Zie DECISIONS.md.
          </p>
          <p className="mt-2 text-xs text-ink-muted">
            Productveiligheidsinformatie (EU GPSR): fabrikant — {site.gpsrManufacturer}.
            Verantwoordelijke persoon in de EU — {site.gpsrResponsiblePerson}.
          </p>
        </section>

        {/* Wat zit in de doos */}
        <section className="mt-16">
          <SectionHeading eyebrow="Levering" title="Wat zit er in de doos" />
          <ul className="mt-6 grid gap-3 sm:grid-cols-2">
            {boxContents.map((item) => (
              <li
                key={item}
                className="flex items-center gap-3 rounded-xl border border-border bg-surface px-4 py-3 text-ink-muted"
              >
                <span aria-hidden="true" className="text-accent">
                  ✓
                </span>
                {item}
              </li>
            ))}
          </ul>
        </section>

        {/* Vergelijking */}
        <section className="mt-16">
          <SectionHeading
            eyebrow="Vergelijking"
            title="PureLitter vs. handmatige kattenbak"
          />
          <div className="mt-6 overflow-x-auto rounded-2xl border border-border">
            <table className="w-full min-w-[560px] border-collapse text-left text-sm">
              <thead>
                <tr className="bg-cream">
                  <th scope="col" className="px-5 py-3 font-semibold text-ink">
                    Kenmerk
                  </th>
                  <th scope="col" className="px-5 py-3 font-semibold text-ink">
                    Handmatige kattenbak
                  </th>
                  <th scope="col" className="px-5 py-3 font-semibold text-accent">
                    PureLitter
                  </th>
                </tr>
              </thead>
              <tbody>
                {comparisonRows.map((row, index) => (
                  <tr
                    key={row.feature}
                    className={index % 2 === 0 ? "bg-surface" : "bg-cream"}
                  >
                    <th scope="row" className="px-5 py-3 font-medium text-ink">
                      {row.feature}
                    </th>
                    <td className="px-5 py-3 text-ink-muted">{row.manual}</td>
                    <td className="px-5 py-3 font-medium text-ink">
                      {row.purelitter}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>

        {/* Reviews - honest empty state */}
        <section className="mt-16">
          <SectionHeading eyebrow="Reviews" title="Klantbeoordelingen" />
          <div className="mt-6 rounded-2xl border border-dashed border-border bg-surface p-8 text-center">
            <p className="text-ink-muted">
              Dit product is nieuw en heeft nog geen reviews. Zodra klanten
              hun ervaring delen, tonen we die hier — eerlijk, ook als een
              review kritisch is.
            </p>
          </div>
        </section>

        {/* FAQ preview */}
        <section className="mt-16">
          <SectionHeading eyebrow="Veelgestelde vragen" title="Vragen over dit product" />
          <div className="mt-6 space-y-4">
            {previewFaqs.map((faq) => (
              <FaqItem key={faq.id} question={faq.question} answer={faq.answer} />
            ))}
          </div>
          <Link
            href="/veelgestelde-vragen"
            className="mt-6 inline-block rounded-full border border-border px-5 py-2.5 text-sm font-semibold text-ink hover:border-accent hover:text-accent"
          >
            Alle veelgestelde vragen bekijken →
          </Link>
        </section>
      </div>

      <StickyAddToCart />
    </div>
  );
}
