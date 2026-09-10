import type { Metadata } from "next";
import Breadcrumbs from "@/components/Breadcrumbs";
import SectionHeading from "@/components/SectionHeading";
import ReopenCookieBannerButton from "@/components/ReopenCookieBannerButton";
import { site } from "@/lib/site";
import { buildMetadata } from "@/lib/seo";
import { breadcrumbJsonLd, JsonLd } from "@/lib/jsonld";

export const metadata: Metadata = buildMetadata({
  title: "Cookiebeleid | PureLitter",
  description: "Welke cookies PureLitter gebruikt, per categorie, doel en bewaartermijn, en hoe je je toestemming kunt intrekken.",
  path: "/cookiebeleid",
});

const cookieRows = [
  {
    name: "pl_cart",
    category: "Noodzakelijk",
    purpose: "Onthoudt de inhoud van je winkelwagen tussen paginabezoeken.",
    retention: "30 dagen",
  },
  {
    name: "csrf_token",
    category: "Noodzakelijk",
    purpose: "Beveiligt formulieren (checkout, contact) tegen cross-site request forgery.",
    retention: "2 uur",
  },
  {
    name: "sb-*-auth-token",
    category: "Noodzakelijk",
    purpose: "Houdt beheerders ingelogd op het besloten /admin-gedeelte (Supabase Auth).",
    retention: "Sessie / tot uitloggen",
  },
  {
    name: "pl_marketing_consent (localStorage)",
    category: "Noodzakelijk (voorkeur)",
    purpose: "Onthoudt jouw keuze over marketing- en analysecookies, zodat we niet elk bezoek opnieuw vragen.",
    retention: "Tot je je voorkeur wijzigt of je browsergegevens wist",
  },
  {
    name: "_ga, _ga_*",
    category: "Analytisch (na toestemming)",
    purpose: "Google Analytics 4 — meet bezoekersgedrag en paginaweergaven.",
    retention: "Tot 14 maanden",
  },
  {
    name: "_fbp",
    category: "Marketing (na toestemming)",
    purpose: "Meta (Facebook/Instagram) Pixel — meet advertentie-effectiviteit en conversies.",
    retention: "Tot 90 dagen",
  },
  {
    name: "_ttp",
    category: "Marketing (na toestemming)",
    purpose: "TikTok Pixel — meet advertentie-effectiviteit en conversies.",
    retention: "Tot 13 maanden",
  },
];

export default function CookiePolicyPage() {
  return (
    <div className="mx-auto max-w-3xl px-4 py-10 sm:py-14">
      <JsonLd data={breadcrumbJsonLd([{ label: "Cookiebeleid" }])} />
      <Breadcrumbs items={[{ label: "Cookiebeleid" }]} />
      <SectionHeading eyebrow="Juridisch" title="Cookiebeleid" />

      <div className="prose-article mt-8 max-w-[70ch] text-[1.05rem] leading-relaxed text-ink">
        <p>
          {site.brand} gebruikt cookies en vergelijkbare technieken.
          Noodzakelijke cookies staan altijd aan, omdat de site zonder ze
          niet goed werkt. Analytische en marketingcookies plaatsen we pas
          na jouw expliciete toestemming via de cookiebanner.
        </p>
      </div>

      <div className="mt-8 overflow-x-auto rounded-2xl border border-border">
        <table className="w-full min-w-[640px] border-collapse text-left text-sm">
          <thead>
            <tr className="bg-cream">
              <th className="px-4 py-3 font-semibold text-ink">Naam</th>
              <th className="px-4 py-3 font-semibold text-ink">Categorie</th>
              <th className="px-4 py-3 font-semibold text-ink">Doel</th>
              <th className="px-4 py-3 font-semibold text-ink">Bewaartermijn</th>
            </tr>
          </thead>
          <tbody>
            {cookieRows.map((row, index) => (
              <tr key={row.name} className={index % 2 === 0 ? "bg-surface" : "bg-cream"}>
                <td className="px-4 py-3 font-mono text-xs text-ink">{row.name}</td>
                <td className="px-4 py-3 text-ink-muted">{row.category}</td>
                <td className="px-4 py-3 text-ink-muted">{row.purpose}</td>
                <td className="px-4 py-3 text-ink-muted">{row.retention}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="mt-10 rounded-2xl border border-border bg-surface p-6">
        <p className="font-semibold text-ink">Toestemming intrekken of wijzigen</p>
        <p className="mt-2 text-sm text-ink-muted">
          Je kunt je keuze voor analytische en marketingcookies op elk moment
          wijzigen. Klik hieronder om de cookiebanner opnieuw te openen.
        </p>
        <div className="mt-4">
          <ReopenCookieBannerButton />
        </div>
      </div>
    </div>
  );
}
