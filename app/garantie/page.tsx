import type { Metadata } from "next";
import Link from "next/link";
import Breadcrumbs from "@/components/Breadcrumbs";
import SectionHeading from "@/components/SectionHeading";
import { site } from "@/lib/site";
import { buildMetadata } from "@/lib/seo";
import { breadcrumbJsonLd, JsonLd } from "@/lib/jsonld";

export const metadata: Metadata = buildMetadata({
  title: "Garantie | PureLitter",
  description: "2 jaar wettelijke garantie op de PureLitter kattenbak: wat is en is niet gedekt, en hoe je een garantieclaim indient.",
  path: "/garantie",
});

export default function WarrantyPage() {
  return (
    <div className="mx-auto max-w-3xl px-4 py-10 sm:py-14">
      <JsonLd data={breadcrumbJsonLd([{ label: "Garantie" }])} />
      <Breadcrumbs items={[{ label: "Garantie" }]} />
      <SectionHeading eyebrow="Service" title="Garantie" />

      <div className="prose-article mt-8 max-w-[70ch] text-[1.05rem] leading-relaxed text-ink">
        <p>
          Op {site.productName} zit de in de EU wettelijk verplichte
          conformiteitsgarantie van <strong>2 jaar</strong> vanaf de datum
          van aflevering. Dit is een wettelijk recht, geen extra
          fabrieksservice die je apart moet afsluiten.
        </p>

        <h2>Wat is gedekt</h2>
        <ul>
          <li>Fabricagefouten die al aanwezig waren op het moment van levering, ook als ze pas later zichtbaar worden.</li>
          <li>Onderdelen die niet naar behoren functioneren zonder dat sprake is van normale slijtage of verkeerd gebruik.</li>
        </ul>

        <h2>Wat is niet gedekt</h2>
        <ul>
          <li>Schade door verkeerd gebruik, val- of stootschade, of gebruik in strijd met de handleiding.</li>
          <li>Normale slijtage van onderdelen zoals afdichtingen of filters.</li>
          <li>Schade door gebruik van niet-geadviseerde kattenbakvulling die het mechanisme beschadigt.</li>
          <li>Schade ontstaan door zelf uitgevoerde reparaties door een niet-erkende partij.</li>
        </ul>

        <h2>Hoe je een garantieclaim indient</h2>
        <ol>
          <li>Neem contact op via het <Link href="/contact">contactformulier</Link> of {site.email}, met je ordernummer en een beschrijving (en bij voorkeur foto&apos;s) van het probleem.</li>
          <li>We beoordelen de melding en laten binnen enkele werkdagen weten of het onder garantie valt.</li>
          <li>Valt het onder garantie, dan repareren of vervangen we het product, of ontvang je een terugbetaling als reparatie/vervanging niet mogelijk is.</li>
        </ol>

        <h2>Verhouding tot het herroepingsrecht</h2>
        <p>
          Garantie is iets anders dan het{" "}
          <Link href="/herroepingsrecht">herroepingsrecht</Link>: garantie
          gaat over een gebrek dat zich (soms later) voordoet, terwijl
          herroeping gaat over het recht om zonder reden van een aankoop af
          te zien binnen 14 dagen.
        </p>
      </div>
    </div>
  );
}
