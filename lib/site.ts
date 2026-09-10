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
  // Placeholder ids for the single Phase 1 product/variant. The product page
  // is still static content (no Supabase fetch yet), so these are fixed
  // constants rather than DB-driven — replace with the real product_variants
  // row id once the catalog is seeded. Used by the cart so line items carry
  // a stable identity across the cart/checkout/order flow.
  defaultVariantId: "00000000-0000-4000-8000-000000000001",
  defaultSku: "PL-KATTENBAK-STD",
  defaultProductId: "00000000-0000-4000-8000-000000000000",
} as const;

export const nav = [
  { href: "/", label: "Home" },
  { href: "/zelfreinigende-kattenbak", label: "Product" },
  { href: "/hoe-werkt-het", label: "Hoe werkt het" },
  { href: "/vergelijking", label: "Vergelijking" },
  { href: "/blog", label: "Blog" },
  { href: "/veelgestelde-vragen", label: "FAQ" },
  { href: "/over-ons", label: "Over ons" },
  { href: "/contact", label: "Contact" },
] as const;

/** Legal/service pages, linked from the footer (not the primary nav). */
export const legalNav = [
  { href: "/algemene-voorwaarden", label: "Algemene voorwaarden" },
  { href: "/privacyverklaring", label: "Privacyverklaring" },
  { href: "/cookiebeleid", label: "Cookiebeleid" },
  { href: "/herroepingsrecht", label: "Herroepingsrecht" },
  { href: "/verzending-en-retour", label: "Verzending en retour" },
  { href: "/garantie", label: "Garantie" },
] as const;
