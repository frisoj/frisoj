import type { Metadata } from "next";
import Breadcrumbs from "@/components/Breadcrumbs";
import SectionHeading from "@/components/SectionHeading";
import FaqAccordion from "@/components/FaqAccordion";
import { listPublishedFaqs } from "@/lib/faq";
import { buildMetadata } from "@/lib/seo";
import { breadcrumbJsonLd, faqPageJsonLd, JsonLd } from "@/lib/jsonld";

export const metadata: Metadata = buildMetadata({
  title: "Veelgestelde vragen | PureLitter",
  description:
    "Antwoord op 20+ vragen over de zelfreinigende kattenbak: werking, veiligheid, vulling, bestellen, verzending en retour/garantie.",
  path: "/veelgestelde-vragen",
});

export default async function FaqPage() {
  const items = await listPublishedFaqs();

  return (
    <div className="mx-auto max-w-3xl px-4 py-10 sm:py-14">
      <JsonLd data={breadcrumbJsonLd([{ label: "Veelgestelde vragen" }])} />
      <JsonLd data={faqPageJsonLd(items)} />
      <Breadcrumbs items={[{ label: "Veelgestelde vragen" }]} />
      <SectionHeading eyebrow="Support" title="Veelgestelde vragen" />
      <div className="mt-8">
        <FaqAccordion items={items} />
      </div>
    </div>
  );
}
