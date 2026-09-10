import { site } from "@/lib/site";

// Minimal server-side price catalog, keyed by variant id. Prices are never
// trusted from the client at checkout — the checkout API route looks the
// price up here by variantId so a tampered cart cookie can't under-pay.
// Phase 1 ships a single product/variant; once the catalog is Supabase-
// backed, replace this with a `product_variants` lookup.

export type CatalogEntry = {
  name: string;
  sku: string;
  unitPriceCents: number;
};

const catalog: Record<string, CatalogEntry> = {
  [site.defaultVariantId]: {
    name: site.productName,
    sku: site.defaultSku,
    unitPriceCents: site.price * 100,
  },
};

export function lookupVariant(variantId: string): CatalogEntry | null {
  return catalog[variantId] ?? null;
}
