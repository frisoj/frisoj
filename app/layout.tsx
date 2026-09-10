import type { Metadata } from "next";
import { Fraunces, Inter } from "next/font/google";
import "./globals.css";
import Header from "@/components/Header";
import Footer from "@/components/Footer";
import CartDrawer from "@/components/CartDrawer";
import { CartProvider } from "@/lib/cart-context";
import { site } from "@/lib/site";

const fraunces = Fraunces({
  variable: "--font-fraunces",
  subsets: ["latin"],
  weight: ["500", "600", "700"],
  style: ["normal", "italic"],
  display: "swap",
});

const inter = Inter({
  variable: "--font-inter",
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
  display: "swap",
});

export const metadata: Metadata = {
  metadataBase: new URL(site.url),
  title: {
    default: `${site.brand} — Zelfreinigende kattenbak | ${site.tagline}`,
    template: `%s | ${site.brand}`,
  },
  description:
    "PureLitter is de zelfreinigende kattenbak voor Nederlandse en Belgische kattenbezitters. Minder scheppen, minder geur, meer tijd. Levering in 2-5 werkdagen.",
  openGraph: {
    title: `${site.brand} — Zelfreinigende kattenbak`,
    description:
      "Nooit meer scheppen. Premium zelfreinigende kattenbak met app-bediening, geleverd in NL/BE.",
    url: site.url,
    siteName: site.brand,
    locale: "nl_NL",
    type: "website",
  },
  alternates: {
    canonical: "/",
  },
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  const organizationJsonLd = {
    "@context": "https://schema.org",
    "@type": "Organization",
    name: site.legalName,
    alternateName: site.brand,
    url: site.url,
    email: site.email,
    logo: `${site.url}/images/hero-litterbox.svg`,
  };

  const websiteJsonLd = {
    "@context": "https://schema.org",
    "@type": "WebSite",
    name: site.brand,
    url: site.url,
    inLanguage: "nl-NL",
  };

  return (
    <html lang="nl" className={`${fraunces.variable} ${inter.variable} h-full`}>
      <body className="flex min-h-full flex-col bg-cream text-ink antialiased">
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{ __html: JSON.stringify(organizationJsonLd) }}
        />
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{ __html: JSON.stringify(websiteJsonLd) }}
        />
        <a href="#main-content" className="skip-link">
          Ga naar inhoud
        </a>
        <CartProvider>
          <Header />
          <main id="main-content" className="flex-1">
            {children}
          </main>
          <Footer />
          <CartDrawer />
        </CartProvider>
      </body>
    </html>
  );
}
