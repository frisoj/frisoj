import type { Metadata } from "next";
import Breadcrumbs from "@/components/Breadcrumbs";
import SectionHeading from "@/components/SectionHeading";
import { site } from "@/lib/site";
import { buildMetadata } from "@/lib/seo";
import { breadcrumbJsonLd, JsonLd } from "@/lib/jsonld";

export const metadata: Metadata = buildMetadata({
  title: "Herroepingsrecht | PureLitter",
  description: "14 dagen bedenktijd, uitzonderingen, en het EU-modelformulier om je bestelling te herroepen (ook als download).",
  path: "/herroepingsrecht",
});

export default function WithdrawalRightPage() {
  return (
    <div className="mx-auto max-w-3xl px-4 py-10 sm:py-14">
      <JsonLd data={breadcrumbJsonLd([{ label: "Herroepingsrecht" }])} />
      <Breadcrumbs items={[{ label: "Herroepingsrecht" }]} />
      <SectionHeading eyebrow="Juridisch" title="Herroepingsrecht" />

      <div className="prose-article mt-8 max-w-[70ch] text-[1.05rem] leading-relaxed text-ink">
        <p>
          Je hebt het recht om je bestelling bij {site.brand} binnen{" "}
          <strong>14 dagen</strong> na ontvangst zonder opgave van redenen te
          herroepen. Deze pagina legt uit hoe dat werkt en biedt het
          officiële EU-modelformulier, ook als download.
        </p>

        <h2>Bedenktijd</h2>
        <p>
          De bedenktijd van 14 dagen gaat in op de dag na ontvangst van het
          product. Binnen die termijn kun je de overeenkomst herroepen door
          ons daarvan via een duidelijke verklaring op de hoogte te stellen —
          bijvoorbeeld met het modelformulier hieronder, of via het{" "}
          <a href="/contact">contactformulier</a>.
        </p>

        <h2>Tijdens de bedenktijd</h2>
        <p>
          Je mag het product uitpakken en beoordelen zoals je dat in een
          winkel zou doen. Ga je verder dan noodzakelijk om de aard,
          kenmerken en werking van het product te beoordelen, dan kunnen we
          waardevermindering in rekening brengen.
        </p>

        <h2>Uitzonderingen</h2>
        <p>
          Het herroepingsrecht geldt niet voor producten die om
          hygiënische redenen niet kunnen worden teruggenomen zodra de
          verzegeling is verbroken — dit kan van toepassing zijn op
          onderdelen die met kattenafval in aanraking zijn geweest. Neem bij
          twijfel contact met ons op vóórdat je het product gebruikt.
        </p>

        <h2>Terugbetaling</h2>
        <p>
          Bij een geldige herroeping betalen we het volledige aankoopbedrag,
          inclusief eventuele verzendkosten, terug binnen 14 dagen na
          ontvangst van je herroepingsmelding, met dien verstande dat we
          mogen wachten met terugbetalen totdat we het product hebben
          terugontvangen. Zie{" "}
          <a href="/verzending-en-retour">verzending en retour</a> voor de
          praktische stappen en wie de retourkosten draagt.
        </p>

        <h2>Modelformulier voor herroeping</h2>
        <p>
          Download het formulier hieronder, vul het in en stuur het naar{" "}
          <a href={`mailto:${site.email}`}>{site.email}</a>, of gebruik de
          onlineversie hieronder.
        </p>
        <p>
          <a
            href="/downloads/herroepingsformulier.pdf"
            className="inline-block rounded-full bg-accent px-6 py-2.5 text-sm font-semibold text-white no-underline hover:bg-accent-dark"
          >
            Download modelformulier (PDF)
          </a>
        </p>

        <blockquote>
          <p>
            <strong>Modelformulier voor herroeping</strong>
            <br />
            (dit formulier alleen invullen en terugzenden als u de
            overeenkomst wilt herroepen)
          </p>
          <p>
            Aan: {site.legalName}, {site.address}, {site.email}
          </p>
          <p>
            Ik/Wij deel/delen u hiermee mede dat ik/wij onze overeenkomst
            betreffende de verkoop van {site.productName} herroep/herroepen.
          </p>
          <p>Bestelnummer: ____________________</p>
          <p>Besteld op: ____________ — Ontvangen op: ____________</p>
          <p>Naam consument(en): ____________________</p>
          <p>Adres consument(en): ____________________</p>
          <p>Datum: ____________________</p>
        </blockquote>
      </div>
    </div>
  );
}
