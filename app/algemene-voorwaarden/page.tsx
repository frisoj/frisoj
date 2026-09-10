import type { Metadata } from "next";
import Link from "next/link";
import Breadcrumbs from "@/components/Breadcrumbs";
import SectionHeading from "@/components/SectionHeading";
import { site } from "@/lib/site";
import { buildMetadata } from "@/lib/seo";
import { breadcrumbJsonLd, JsonLd } from "@/lib/jsonld";

export const metadata: Metadata = buildMetadata({
  title: "Algemene voorwaarden | PureLitter",
  description: "Algemene voorwaarden van PureLitter: bestellen, prijzen, herroepingsrecht, levering, garantie en klachten/geschillen.",
  path: "/algemene-voorwaarden",
});

export default function TermsPage() {
  return (
    <div className="mx-auto max-w-3xl px-4 py-10 sm:py-14">
      <JsonLd data={breadcrumbJsonLd([{ label: "Algemene voorwaarden" }])} />
      <Breadcrumbs items={[{ label: "Algemene voorwaarden" }]} />
      <SectionHeading eyebrow="Juridisch" title="Algemene voorwaarden" />
      <p className="mt-4 text-sm text-ink-muted">Laatst bijgewerkt: [DATUM INVULLEN]. Deze voorwaarden zijn opgesteld in lijn met Nederlands en Belgisch consumentenrecht en dienen vóór publicatie door een jurist te worden gecontroleerd.</p>

      <div className="prose-article mt-8 max-w-[70ch] text-[1.05rem] leading-relaxed text-ink">
        <h2>Artikel 1 — Identiteit van de ondernemer</h2>
        <p>
          {site.legalName}
          <br />
          Vestigingsadres: {site.address}
          <br />
          E-mailadres: {site.email}
          <br />
          KVK-nummer: {site.kvk}
          <br />
          BTW-identificatienummer: {site.btw}
        </p>

        <h2>Artikel 2 — Toepasselijkheid</h2>
        <p>
          Deze algemene voorwaarden zijn van toepassing op elk aanbod van{" "}
          {site.brand} en op elke tot stand gekomen overeenkomst op afstand
          tussen {site.brand} en de consument, voor zover van deze
          voorwaarden niet door partijen uitdrukkelijk en schriftelijk is
          afgeweken.
        </p>

        <h2>Artikel 3 — Het aanbod en prijzen</h2>
        <p>
          Alle vermelde prijzen zijn in euro&apos;s en inclusief BTW. Het
          aanbod bevat een volledige en nauwkeurige omschrijving van de
          aangeboden producten. Kennelijke vergissingen of fouten in het
          aanbod binden {site.brand} niet.
        </p>

        <h2>Artikel 4 — De overeenkomst</h2>
        <p>
          De overeenkomst komt tot stand op het moment van aanvaarding door
          de consument van het aanbod en het voldoen aan de daarbij gestelde
          voorwaarden, oftewel op het moment dat de bestelling en betaling
          zijn afgerond. {site.brand} bevestigt de ontvangst van de
          bestelling per e-mail.
        </p>

        <h2>Artikel 5 — Herroepingsrecht</h2>
        <p>
          Bij de aankoop van producten heeft de consument de mogelijkheid de
          overeenkomst zonder opgave van redenen te ontbinden gedurende{" "}
          <strong>14 dagen</strong>, ingaande op de dag van ontvangst van het
          product door de consument. Tijdens deze termijn dient de consument
          zorgvuldig om te gaan met het product en de verpakking; het
          product mag alleen worden uitgepakt of gebruikt voor zover dat
          nodig is om de aard en kenmerken ervan te beoordelen.
        </p>
        <p>
          Het herroepingsrecht is uitgesloten voor producten die om
          hygiënische redenen niet geschikt zijn om te worden teruggezonden
          en waarvan de verzegeling na levering is verbroken (bijvoorbeeld
          gebruikte kattenbakonderdelen die met afval in aanraking zijn
          geweest). Zie de pagina{" "}
          <Link href="/herroepingsrecht">herroepingsrecht</Link> voor de
          volledige voorwaarden en het modelformulier.
        </p>

        <h2>Artikel 6 — Kosten in geval van herroeping</h2>
        <p>
          Als de consument gebruikmaakt van zijn herroepingsrecht, komen de
          kosten van terugzending voor rekening van de consument, tenzij
          anders vermeld op de pagina{" "}
          <Link href="/verzending-en-retour">verzending en retour</Link>.{" "}
          {site.brand} betaalt het volledige aankoopbedrag, inclusief eventuele
          leveringskosten, zo snel mogelijk en in ieder geval binnen 14 dagen
          na ontvangst van de herroepingsmelding terug, met dien verstande dat
          {" "}{site.brand} mag wachten met terugbetaling totdat het product is
          terugontvangen of de consument een bewijs van terugzending heeft
          overlegd.
        </p>

        <h2>Artikel 7 — Levering en uitvoering</h2>
        <p>
          {site.brand} zal de grootst mogelijke zorgvuldigheid in acht nemen
          bij het in ontvangst nemen en bij de uitvoering van bestellingen.
          Als plaats van levering geldt het adres dat de consument aan{" "}
          {site.brand} heeft opgegeven. Zie{" "}
          <Link href="/verzending-en-retour">verzending en retour</Link> voor
          de verwachte levertermijn. Als levering vertraagd is, of als een
          bestelling niet of slechts gedeeltelijk kan worden uitgevoerd,
          ontvangt de consument hierover uiterlijk 30 dagen na plaatsing van
          de bestelling een bericht.
        </p>

        <h2>Artikel 8 — Conformiteit en garantie</h2>
        <p>
          {site.brand} staat er voor in dat de producten voldoen aan de
          overeenkomst, de in het aanbod vermelde specificaties, aan de
          redelijke eisen van deugdelijkheid en/of bruikbaarheid en de op de
          datum van de totstandkoming van de overeenkomst bestaande
          wettelijke bepalingen. Onverminderd het bovenstaande geldt op
          producten van {site.brand} de in de EU wettelijk verplichte
          conformiteitsgarantie van <strong>2 jaar</strong>. Zie de pagina{" "}
          <Link href="/garantie">garantie</Link> voor meer details en hoe je
          een garantieclaim indient.
        </p>

        <h2>Artikel 9 — Klachten en geschillen</h2>
        <p>
          Klachten over de uitvoering van de overeenkomst dienen binnen
          bekwame tijd, volledig en duidelijk omschreven, te worden ingediend
          bij {site.brand} via het{" "}
          <Link href="/contact">contactformulier</Link> of {site.email}.
          Kom je er met {site.brand} niet uit, dan kun je een klacht indienen
          via het Online Dispute Resolution-platform van de Europese Unie:{" "}
          <a href="https://ec.europa.eu/consumers/odr" target="_blank" rel="noopener noreferrer">
            ec.europa.eu/consumers/odr
          </a>
          .
        </p>

        <h2>Artikel 10 — Toepasselijk recht</h2>
        <p>
          Op overeenkomsten tussen {site.brand} en de consument waarop deze
          algemene voorwaarden betrekking hebben, is uitsluitend Nederlands
          recht van toepassing, ook indien de consument woonachtig is in
          België. Waar dwingend Belgisch consumentenrecht een consument met
          gewone verblijfplaats in België een verdergaande bescherming biedt,
          blijft die bescherming onverkort van toepassing.
        </p>
      </div>
    </div>
  );
}
