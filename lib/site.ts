// Central place for brand + business placeholders used across metadata,
// JSON-LD, header and footer. ALL values here are placeholders invented for
// Phase 1 — see DECISIONS.md for the full list to replace with real data.

export const site = {
  brand: "PureLitter",
  tagline: "Nooit meer scheppen",
  domain: "purelitter.nl",
  url: "https://www.purelitter.nl",
  legalName: "PureLitter B.V.",
  kvk: "[KVK-NUMMER]",
  btw: "[BTW-NUMMER]",
  address: "[BEDRIJFSADRES]",
  email: "info@purelitter.nl",
  phone: "[TELEFOONNUMMER]",
  productName: "PureLitter Zelfreinigende Kattenbak",
  productSlug: "zelfreinigende-kattenbak",
  price: 179,
  currency: "EUR",
} as const;

export const nav = [
  { href: "/", label: "Home" },
  { href: "/zelfreinigende-kattenbak", label: "Product" },
  { href: "/hoe-werkt-het", label: "Hoe werkt het" },
  { href: "/vergelijking", label: "Vergelijking" },
  { href: "/blog", label: "Blog" },
  { href: "/faq", label: "FAQ" },
  { href: "/contact", label: "Contact" },
] as const;
