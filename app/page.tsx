import Image from "next/image";
import Link from "next/link";
import type { Metadata } from "next";
import UspBar from "@/components/UspBar";
import SectionHeading from "@/components/SectionHeading";
import FaqItem from "@/components/FaqItem";
import { site } from "@/lib/site";
import { buildMetadata } from "@/lib/seo";

export const metadata: Metadata = buildMetadata({
  title: `${site.brand} — zelfreinigende kattenbak die écht werkt`,
  description:
    "Minder scheppen, minder geur, meer rust voor jou en je kat. Levering in NL/BE binnen 2-5 werkdagen, 14 dagen bedenktijd.",
  path: "/",
});

const steps = [
  {
    title: "Je kat gebruikt de bak zoals gewoonlijk",
    description:
      "Geen aanpassingen nodig — PureLitter werkt met de kattenbakvulling die je al gebruikt.",
  },
  {
    title: "De sensor detecteert wanneer je kat klaar is",
    description:
      "Na een korte, veilige wachttijd start de reiniging automatisch en rustig.",
  },
  {
    title: "Afval gaat direct naar de gesloten opvangbak",
    description:
      "Jij leegt de opvangbak eens in de paar dagen — schone bak, geen geschep.",
  },
];

const benefits = [
  {
    title: "Minder scheppen, meer tijd",
    description:
      "De bak reinigt zichzelf na elk bezoek, zodat jij niet dagelijks hoeft te scheppen.",
  },
  {
    title: "Minder geur in huis",
    description:
      "Afval wordt direct afgesloten in de opvangbak, weg van je woonruimte.",
  },
  {
    title: "Bediening via de app",
    description:
      "Bekijk reinigingscycli en status van je kattenbak vanaf je telefoon.",
  },
  {
    title: "Rustig en veilig voor je kat",
    description:
      "Sensoren zorgen dat reiniging alleen start als je kat de bak heeft verlaten.",
  },
];

const faqs = [
  {
    question: "Werkt PureLitter met de kattenbakvulling die ik nu gebruik?",
    answer:
      "In veel gevallen wel. PureLitter werkt het best met klontvormende, klonterende kattenbakvulling. In de handleiding (bij levering) staat precies welke soorten wij aanraden voor de beste werking.",
  },
  {
    question: "Is de zelfreinigende bak veilig voor mijn kat?",
    answer:
      "Ja. Ingebouwde sensoren zorgen dat de reiniging alleen start wanneer je kat de bak volledig heeft verlaten, met een korte veiligheidswachttijd erbovenop.",
  },
  {
    question: "Hoeveel katten kunnen één bak gebruiken?",
    answer:
      "De bak is geschikt voor huishoudens met 1 tot 3 katten. Bij meerdere katten raden we aan de opvangbak iets vaker te legen.",
  },
  {
    question: "Hoe snel wordt mijn bestelling geleverd?",
    answer:
      "Bestellingen worden vanuit onze EU-leverancier verzonden en komen doorgaans binnen 2 tot 5 werkdagen aan in Nederland en België.",
  },
];

export default function HomePage() {
  return (
    <>
      {/* Hero */}
      <section className="bg-cream">
        <div className="mx-auto grid max-w-6xl items-center gap-10 px-4 py-14 sm:py-20 lg:grid-cols-2">
          <div>
            <p className="text-sm font-semibold uppercase tracking-wide text-accent">
              {site.brand}
            </p>
            <h1 className="mt-3 font-heading text-4xl font-semibold leading-tight text-ink sm:text-5xl">
              Nooit meer scheppen.
            </h1>
            <p className="mt-4 max-w-xl text-lg text-ink-muted">
              De zelfreinigende kattenbak die vuil direct opruimt, geur
              wegneemt en jou uren per maand teruggeeft. Ontworpen voor
              druk-bezette kattenouders in Nederland en België.
            </p>
            <div className="mt-8 flex flex-wrap items-center gap-4">
              <Link
                href={`/${site.productSlug}`}
                className="rounded-full bg-accent px-6 py-3 text-base font-semibold text-white transition-colors hover:bg-accent-dark"
              >
                Bekijk de kattenbak — €{site.price}
              </Link>
              <Link
                href="#hoe-werkt-het"
                className="rounded-full border border-border px-6 py-3 text-base font-semibold text-ink transition-colors hover:border-accent hover:text-accent"
              >
                Hoe werkt het?
              </Link>
            </div>
          </div>
          <div className="overflow-hidden rounded-3xl border border-border bg-surface">
            <Image
              src="/images/hero-litterbox.svg"
              alt="Placeholder productfoto van de PureLitter zelfreinigende kattenbak"
              width={800}
              height={800}
              className="h-auto w-full"
              priority
            />
          </div>
        </div>
      </section>

      <UspBar />

      {/* Hoe het werkt */}
      <section id="hoe-werkt-het" className="mx-auto max-w-6xl px-4 py-16 sm:py-20">
        <SectionHeading
          eyebrow="Simpel & snel"
          title="Hoe het werkt in 3 stappen"
          center
        />
        <div className="mt-10 grid gap-8 sm:grid-cols-3">
          {steps.map((step, index) => (
            <div key={step.title} className="rounded-2xl border border-border bg-surface p-6">
              <span className="flex h-10 w-10 items-center justify-center rounded-full bg-accent-tint font-heading text-lg font-semibold text-accent">
                {index + 1}
              </span>
              <h3 className="mt-4 font-heading text-xl font-semibold text-ink">
                {step.title}
              </h3>
              <p className="mt-2 text-ink-muted">{step.description}</p>
            </div>
          ))}
        </div>
      </section>

      {/* Voordelen */}
      <section className="bg-surface py-16 sm:py-20">
        <div className="mx-auto max-w-6xl px-4">
          <SectionHeading
            eyebrow="Waarom PureLitter"
            title="Gemak dat je écht merkt"
            description="PureLitter is gebouwd voor het dagelijks leven van kattenbezitters die weinig tijd hebben, maar wel het beste voor hun kat willen."
          />
          <div className="mt-10 grid gap-6 sm:grid-cols-2">
            {benefits.map((benefit) => (
              <div
                key={benefit.title}
                className="flex gap-4 rounded-2xl border border-border p-5"
              >
                <span
                  aria-hidden="true"
                  className="mt-1 h-2.5 w-2.5 shrink-0 rounded-full bg-accent"
                />
                <div>
                  <h3 className="font-heading text-lg font-semibold text-ink">
                    {benefit.title}
                  </h3>
                  <p className="mt-1 text-ink-muted">{benefit.description}</p>
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Social proof - honest empty state */}
      <section className="mx-auto max-w-6xl px-4 py-16 sm:py-20">
        <SectionHeading
          eyebrow="Klantervaringen"
          title="We zijn net gestart"
          center
        />
        <div className="mx-auto mt-8 max-w-xl rounded-2xl border border-dashed border-border bg-surface p-8 text-center">
          <p className="text-ink-muted">
            PureLitter is nieuw in Nederland en België. We hebben nog geen
            klantreviews te tonen — zodra klanten hun ervaringen delen,
            publiceren we die hier eerlijk en ongefilterd. Liever eerst zelf
            vragen stellen?{" "}
            <Link href="/contact" className="font-semibold text-accent">
              Neem contact op
            </Link>
            .
          </p>
        </div>
      </section>

      {/* FAQ preview */}
      <section className="bg-surface py-16 sm:py-20">
        <div className="mx-auto max-w-3xl px-4">
          <SectionHeading eyebrow="Veelgestelde vragen" title="Nog vragen?" center />
          <div className="mt-10 space-y-4">
            {faqs.map((faq) => (
              <FaqItem key={faq.question} question={faq.question} answer={faq.answer} />
            ))}
          </div>
          <div className="mt-8 text-center">
            <Link href="/veelgestelde-vragen" className="font-semibold text-accent hover:underline">
              Bekijk alle veelgestelde vragen →
            </Link>
          </div>
        </div>
      </section>

      {/* CTA */}
      <section className="mx-auto max-w-6xl px-4 py-16 sm:py-20">
        <div className="rounded-3xl bg-accent px-8 py-14 text-center text-white sm:px-16">
          <h2 className="font-heading text-3xl font-semibold sm:text-4xl">
            Klaar om te stoppen met scheppen?
          </h2>
          <p className="mx-auto mt-4 max-w-xl text-white/90">
            Bestel de PureLitter zelfreinigende kattenbak en geniet van een
            schone, geurloze kattenbak — zonder er zelf naar om te kijken.
          </p>
          <Link
            href={`/${site.productSlug}`}
            className="mt-8 inline-block rounded-full bg-white px-8 py-3 text-base font-semibold text-accent transition-colors hover:bg-cream"
          >
            Bekijk de kattenbak
          </Link>
        </div>
      </section>
    </>
  );
}
