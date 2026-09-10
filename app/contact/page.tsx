import type { Metadata } from "next";
import Breadcrumbs from "@/components/Breadcrumbs";
import SectionHeading from "@/components/SectionHeading";
import ContactForm from "@/components/ContactForm";
import { getCsrfToken } from "@/lib/csrf";
import { site } from "@/lib/site";
import { buildMetadata } from "@/lib/seo";
import { breadcrumbJsonLd, JsonLd } from "@/lib/jsonld";

export const metadata: Metadata = buildMetadata({
  title: "Contact | PureLitter",
  description: "Vraag over je bestelling of de kattenbak? Neem contact op via het formulier of e-mail — we reageren binnen 1-2 werkdagen.",
  path: "/contact",
});

export default async function ContactPage() {
  const csrfToken = await getCsrfToken();

  return (
    <div className="mx-auto max-w-3xl px-4 py-10 sm:py-14">
      <JsonLd data={breadcrumbJsonLd([{ label: "Contact" }])} />
      <Breadcrumbs items={[{ label: "Contact" }]} />
      <SectionHeading eyebrow="Support" title="Contact" description="We reageren binnen 1-2 werkdagen." />

      <div className="mt-8 grid gap-10 sm:grid-cols-[1.1fr_0.9fr]">
        <ContactForm csrfToken={csrfToken} />

        <aside className="space-y-6 rounded-2xl border border-border bg-surface p-6 text-sm">
          <div>
            <p className="font-semibold text-ink">E-mail</p>
            <a href={`mailto:${site.email}`} className="text-accent hover:underline">
              {site.email}
            </a>
          </div>
          <div>
            <p className="font-semibold text-ink">Reactietijd</p>
            <p className="text-ink-muted">Binnen 1-2 werkdagen, maandag t/m vrijdag.</p>
          </div>
          <div>
            <p className="font-semibold text-ink">Bedrijfsgegevens</p>
            <address className="mt-1 text-ink-muted not-italic">
              {site.legalName}
              <br />
              {site.address}
              <br />
              KVK: {site.kvk} · BTW: {site.btw}
            </address>
          </div>
        </aside>
      </div>
    </div>
  );
}
