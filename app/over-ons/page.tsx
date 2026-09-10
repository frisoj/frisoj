import type { Metadata } from "next";
import Image from "next/image";
import Link from "next/link";
import Breadcrumbs from "@/components/Breadcrumbs";
import SectionHeading from "@/components/SectionHeading";
import { site } from "@/lib/site";
import { buildMetadata } from "@/lib/seo";
import { breadcrumbJsonLd, JsonLd } from "@/lib/jsonld";

export const metadata: Metadata = buildMetadata({
  title: "Over ons | PureLitter",
  description: "Waarom wij PureLitter begonnen: gemak en hygiëne voor kat en eigenaar, met snelle levering vanuit de EU naar NL/BE.",
  path: "/over-ons",
});

export default function AboutPage() {
  return (
    <div className="mx-auto max-w-3xl px-4 py-10 sm:py-14">
      <JsonLd data={breadcrumbJsonLd([{ label: "Over ons" }])} />
      <Breadcrumbs items={[{ label: "Over ons" }]} />
      <SectionHeading eyebrow="Wie wij zijn" title="Over ons" />

      <div className="prose-article mt-8 max-w-[70ch] text-[1.05rem] leading-relaxed text-ink">
        <p>
          Wij zijn [NAAM], en [NAAM] — samen het kleine team achter{" "}
          {site.brand}. We begonnen dit bedrijf vanuit een heel herkenbare
          ergernis: elke dag scheppen, de geur die daarna toch blijft
          hangen, en het gevoel dat de kattenbak nooit echt <em>klaar</em>{" "}
          is. Toen we zelf overstapten op een zelfreinigende kattenbak,
          merkten we hoeveel tijd en gedoe dat scheelde — en besloten we dat
          meer kattenbezitters in Nederland en België dat gemak
          verdienen, zonder overdreven marketingclaims of een oneerlijk
          hoge prijs.
        </p>

        <h2>Onze missie</h2>
        <p>
          {site.brand} bestaat om twee dingen tegelijk te verbeteren: het
          comfort van de kat en het gemak van de eigenaar. Een schone bak is
          voor je kat prettiger om te gebruiken, en voor jou betekent het
          minder dagelijkse taken en minder geur in huis. We geloven dat die
          twee belangen elkaar niet tegenwerken — een goed ontworpen
          zelfreinigende kattenbak dient ze allebei.
        </p>

        <h2>Waarom levering vanuit de EU</h2>
        <p>
          We kiezen bewust voor levering vanuit de Europese Unie in plaats
          van rechtstreekse verzending van buiten de EU. Dat betekent
          kortere levertijden voor klanten in Nederland en België, geen
          verrassingen met invoerrechten aan de deur, en garantie- en
          retourafhandeling die aansluit bij Nederlandse en Belgische
          consumentenwetgeving.
        </p>

        <h2>Wie wij zijn</h2>
        <p>
          {site.brand} is een klein team; we groeien liever langzaam en
          zorgvuldig dan snel en slordig. Op deze plek komt binnenkort een
          foto en een kort persoonlijk woord van het team: [FOTO].
        </p>

        <h2>Hoe we werken</h2>
        <ul>
          <li>Eerlijke productinformatie — geen verzonnen statistieken of nepreviews.</li>
          <li>Reacties binnen 1-2 werkdagen op elk bericht via het{" "}
            <Link href="/contact">contactformulier</Link>.</li>
          <li>14 dagen bedenktijd en 2 jaar garantie, zoals de wet in de EU voorschrijft.</li>
        </ul>

        <p>
          Vragen, feedback of gewoon even kennismaken? Neem gerust{" "}
          <Link href="/contact">contact</Link> met ons op, of bekijk direct de{" "}
          <Link href={`/${site.productSlug}`}>{site.productName.toLowerCase()}</Link>.
        </p>
      </div>

      <div className="mt-10 flex items-center gap-4 rounded-2xl border border-dashed border-border bg-surface p-6">
        <div className="relative h-20 w-20 flex-shrink-0 overflow-hidden rounded-full border border-border bg-cream">
          <Image src="/images/hero-litterbox.svg" alt="Placeholder teamfoto — [FOTO]" fill className="object-cover opacity-60" />
        </div>
        <p className="text-sm text-ink-muted">
          Placeholder — hier komt een echte teamfoto en naamsvermelding
          zodra beschikbaar. Zie DECISIONS.md.
        </p>
      </div>
    </div>
  );
}
