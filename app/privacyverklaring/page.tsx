import type { Metadata } from "next";
import Link from "next/link";
import Breadcrumbs from "@/components/Breadcrumbs";
import SectionHeading from "@/components/SectionHeading";
import { site } from "@/lib/site";
import { buildMetadata } from "@/lib/seo";
import { breadcrumbJsonLd, JsonLd } from "@/lib/jsonld";

export const metadata: Metadata = buildMetadata({
  title: "Privacyverklaring | PureLitter",
  description: "Welke persoonsgegevens PureLitter verwerkt, waarom, hoe lang we ze bewaren, welke verwerkers we gebruiken en welke rechten je hebt (AVG/GDPR).",
  path: "/privacyverklaring",
});

export default function PrivacyPage() {
  return (
    <div className="mx-auto max-w-3xl px-4 py-10 sm:py-14">
      <JsonLd data={breadcrumbJsonLd([{ label: "Privacyverklaring" }])} />
      <Breadcrumbs items={[{ label: "Privacyverklaring" }]} />
      <SectionHeading eyebrow="Juridisch" title="Privacyverklaring" />
      <p className="mt-4 text-sm text-ink-muted">Laatst bijgewerkt: [DATUM INVULLEN]. Deze verklaring dient vóór publicatie door een jurist te worden gecontroleerd op volledigheid.</p>

      <div className="prose-article mt-8 max-w-[70ch] text-[1.05rem] leading-relaxed text-ink">
        <p>
          {site.legalName} ({site.address}, KVK {site.kvk}) verwerkt
          persoonsgegevens van bezoekers en klanten van {site.brand}. Deze
          verklaring legt uit welke gegevens dat zijn, waarom we ze
          verwerken, hoe lang we ze bewaren, met wie we ze delen en welke
          rechten je hebt.
        </p>

        <h2>Welke gegevens we verwerken</h2>
        <ul>
          <li><strong>Bestelgegevens:</strong> naam, e-mailadres, telefoonnummer (optioneel), afleveradres, factuuradres, bestelde producten, betaalstatus.</li>
          <li><strong>Contactgegevens:</strong> naam, e-mailadres en de inhoud van je bericht wanneer je het contactformulier gebruikt.</li>
          <li><strong>Reviewgegevens:</strong> naam en beoordeling wanneer je een review achterlaat.</li>
          <li><strong>Accountgegevens (alleen voor beheerders):</strong> e-mailadres en inloggegevens voor toegang tot het beheerpaneel.</li>
          <li><strong>Gebruiksgegevens en cookies:</strong> zie ons <Link href="/cookiebeleid">cookiebeleid</Link> voor het volledige overzicht.</li>
        </ul>

        <h2>Waarom we deze gegevens verwerken en op welke grondslag</h2>
        <table>
          <thead>
            <tr><th>Doel</th><th>Grondslag (AVG)</th></tr>
          </thead>
          <tbody>
            <tr><td>Bestelling verwerken, leveren en factureren</td><td>Uitvoering van de overeenkomst</td></tr>
            <tr><td>Klantenservice en contactformulier beantwoorden</td><td>Uitvoering van de overeenkomst / gerechtvaardigd belang</td></tr>
            <tr><td>Wettelijke administratie- en bewaarplicht (o.a. facturen)</td><td>Wettelijke verplichting</td></tr>
            <tr><td>Reviews publiceren na moderatie</td><td>Toestemming</td></tr>
            <tr><td>Nieuwsbrief / marketing-e-mail</td><td>Toestemming (opt-in bij checkout)</td></tr>
            <tr><td>Analytics en advertentiepixels (GA4, Meta, TikTok)</td><td>Toestemming (cookiebanner)</td></tr>
          </tbody>
        </table>

        <h2>Bewaartermijnen</h2>
        <ul>
          <li>Bestel- en factuurgegevens: 7 jaar (Nederlandse/Belgische fiscale bewaarplicht).</li>
          <li>Contactformulierberichten: maximaal 2 jaar na afhandeling, tenzij een langere termijn wettelijk vereist is.</li>
          <li>Reviews: bewaard zolang het product wordt aangeboden, of tot verwijdering op verzoek.</li>
          <li>Marketingtoestemming: tot je deze intrekt via het <Link href="/cookiebeleid">cookiebeleid</Link>.</li>
        </ul>

        <h2>Verwerkers en derde partijen</h2>
        <p>We delen gegevens uitsluitend met partijen die ze nodig hebben om onze dienst te leveren:</p>
        <ul>
          <li><strong>Supabase</strong> — hosting van onze database (orders, klanten, reviews, content).</li>
          <li><strong>Mollie</strong> — verwerking van betalingen.</li>
          <li><strong>Resend</strong> — verzending van transactionele e-mail (orderbevestiging, verzendbevestiging, reviewuitnodiging).</li>
          <li><strong>Vercel</strong> — hosting van de website.</li>
          <li><strong>Google (GA4)</strong> — websiteanalyse, alleen na jouw toestemming.</li>
          <li><strong>Meta (Facebook/Instagram Pixel)</strong> — advertentiemeting, alleen na jouw toestemming.</li>
          <li><strong>TikTok</strong> — advertentiemeting, alleen na jouw toestemming.</li>
        </ul>
        <p>
          Met elke verwerker die als verwerker in de zin van de AVG optreedt,
          is of wordt een verwerkersovereenkomst gesloten. [BRON INVULLEN —
          overzicht van gesloten verwerkersovereenkomsten].
        </p>

        <h2>Jouw rechten</h2>
        <p>Onder de AVG/GDPR heb je het recht op:</p>
        <ul>
          <li>Inzage in de gegevens die we van je verwerken.</li>
          <li>Correctie van onjuiste gegevens.</li>
          <li>Verwijdering van je gegevens (&ldquo;recht op vergetelheid&rdquo;), voor zover geen wettelijke bewaarplicht van toepassing is.</li>
          <li>Beperking van de verwerking.</li>
          <li>Overdraagbaarheid van gegevens (dataportabiliteit).</li>
          <li>Bezwaar tegen verwerking op basis van gerechtvaardigd belang of voor marketingdoeleinden.</li>
          <li>Intrekking van eerder gegeven toestemming, met werking voor de toekomst.</li>
        </ul>
        <p>
          Je kunt deze rechten uitoefenen door een e-mail te sturen naar{" "}
          <a href={`mailto:${site.email}`}>{site.email}</a>. We reageren binnen
          4 weken. Ben je niet tevreden met hoe we je verzoek afhandelen, dan
          kun je een klacht indienen bij de Autoriteit Persoonsgegevens
          (Nederland) of de Gegevensbeschermingsautoriteit (België).
        </p>

        <h2>Beveiliging</h2>
        <p>
          We nemen passende technische en organisatorische maatregelen om
          persoonsgegevens te beveiligen tegen verlies of onrechtmatige
          verwerking, waaronder toegangsbeperking tot gegevens (o.a. Row
          Level Security in onze database) en versleutelde verbindingen
          (HTTPS).
        </p>

        <h2>Contact</h2>
        <p>
          Vragen over deze privacyverklaring? Neem contact op via{" "}
          <a href={`mailto:${site.email}`}>{site.email}</a> of het{" "}
          <Link href="/contact">contactformulier</Link>.
        </p>
      </div>
    </div>
  );
}
