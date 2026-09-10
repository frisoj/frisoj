// Cart types + pure price-calculation helpers. Kept framework-free so they
// are trivially unit-testable (see tests/cart.test.ts) and reusable from
// both the client cart context and the server checkout code.

export type CartItem = {
  variantId: string;
  sku: string;
  productSlug: string;
  name: string;
  /** Unit price incl. BTW, in whole euro cents. */
  unitPriceCents: number;
  quantity: number;
  image?: string;
};

export type CartTotals = {
  subtotalCents: number;
  shippingCents: number;
  /** BTW portion of subtotal+shipping, shown separately (NL/BE = 21%). */
  btwCents: number;
  /** Total incl. BTW, incl. shipping. */
  totalCents: number;
  itemCount: number;
};

/** NL/BE standard BTW rate. */
export const BTW_RATE = 0.21;

/** Shipping is free to NL and BE, per the brief. Kept explicit + visible in the UI rather than silently zero. */
export function shippingCentsFor(country: "NL" | "BE"): number {
  if (country === "NL" || country === "BE") return 0;
  return 0; // shop only ships NL/BE for now; no other country is offered at checkout
}

export function cartSubtotalCents(items: CartItem[]): number {
  return items.reduce((sum, item) => sum + item.unitPriceCents * item.quantity, 0);
}

export function cartItemCount(items: CartItem[]): number {
  return items.reduce((sum, item) => sum + item.quantity, 0);
}

/**
 * All prices stored/displayed in this app are incl. BTW (as advertised on
 * the product page: "€179 incl. BTW"). The BTW component shown separately
 * at checkout is therefore extracted from the incl.-BTW total, not added on
 * top of it: btw = total - total / (1 + rate).
 */
export function calculateCartTotals(
  items: CartItem[],
  country: "NL" | "BE" = "NL",
): CartTotals {
  const subtotalCents = cartSubtotalCents(items);
  const shippingCents = shippingCentsFor(country);
  const totalCents = subtotalCents + shippingCents;
  const btwCents = Math.round(totalCents - totalCents / (1 + BTW_RATE));

  return {
    subtotalCents,
    shippingCents,
    btwCents,
    totalCents,
    itemCount: cartItemCount(items),
  };
}

export function formatEuro(cents: number): string {
  return new Intl.NumberFormat("nl-NL", {
    style: "currency",
    currency: "EUR",
  }).format(cents / 100);
}
