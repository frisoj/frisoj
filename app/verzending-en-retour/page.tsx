import type { Metadata } from "next";
import Link from "next/link";
import Breadcrumbs from "@/components/Breadcrumbs";
import SectionHeading from "@/components/SectionHeading";
import { site } from "@/lib/site";
import { buildMetadata } from "@/lib/seo";
import { breadcrumbJsonLd, JsonLd } from "@/lib/jsonld";

export const metadata: Metadata = buildMetadata({
  title: "Verzending en retour | PureLitter",
  description: "Levertijd in NL/BE, verzendkosten, hoe je retourneert, wie de retourkosten betaalt en wanneer je je geld terugkrijgt.",
  path: "/verzending-en-retour",
});

export default function ShippingReturnsPage() {
  return (
    <div className="mx-auto max-w-3xl px-4 py-10 sm:py-14">
      <JsonLd data={breadcrumbJsonLd([{ label: "Verzending en retour" }])} />
      <Breadcrumbs items={[{ label: "Verzending en retour" }]} />
      <SectionHeading eyebrow="Service" title="Verzending en retour" />

      <div className="prose-article mt-8 max-w-[70ch] text-[1.05rem] leading-relaxed text-ink">
        <h2>Verzending</h2>
        <ul>
          <li><strong>Levertijd:</strong> 2-5 werkdagen binnen Nederland en België.</li>
          <li><strong>Vervoerder:</strong> [BRON INVULLEN — definitieve vervoerderkeuze].</li>
          <li><strong>Verzendkosten:</strong> gratis, zonder minimale besteldrempel.</li>
          <li><strong>Track & trace:</strong> je ontvangt een trackingcode per e-mail zodra je bestelling is verzonden.</li>
        </ul>

        <h2>Retourneren in 4 stappen</h2>
        <ol>
          <li>Meld je retour binnen 14 dagen na ontvangst via het <Link href="/contact">contactformulier</Link> of {site.email}, met je ordernummer.</li>
          <li>Je ontvangt een bevestiging met retourinstructies.</li>
          <li>Verpak het product zorgvuldig, bij voorkeur in de originele verpakking, en stuur het retour.</li>
          <li>Zodra we het product hebben ontvangen en gecontroleerd, ontvang je je terugbetaling.</li>
        </ol>

        <h2>Wie betaalt de retourkosten?</h2>
        <p>
          Bij herroeping binnen de wettelijke bedenktijd zijn de kosten van
          terugzending voor rekening van de consument, tenzij het product
          niet overeenkomt met de bestelling of defect is afgeleverd — in
          dat geval nemen wij de retourkosten voor onze rekening.
        </p>

        <h2>Staat van het product bij retour</h2>
        <p>
          Retourneer het product zoveel mogelijk in de originele staat en
          verpakking. Onderdelen die met kattenafval in aanraking zijn
          geweest, kunnen om hygiënische redenen zijn uitgesloten van
          herroeping — zie <Link href="/herroepingsrecht">herroepingsrecht</Link>.
          Bij waardevermindering door gebruik dat verder gaat dan
          noodzakelijk om het product te beoordelen, kunnen we een bedrag
          inhouden op de terugbetaling.
        </p>

        <h2>Terugbetalingstermijn</h2>
        <p>
          We betalen terug binnen 14 dagen na ontvangst van je
          herroepingsmelding, met dien verstande dat we mogen wachten met
          terugbetalen totdat we het product hebben terugontvangen of je een
          bewijs van terugzending hebt overlegd. Terugbetaling gebeurt via
          dezelfde betaalmethode als waarmee je hebt betaald.
        </p>
      </div>
    </div>
  );
}
