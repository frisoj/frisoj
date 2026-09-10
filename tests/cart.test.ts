import { describe, expect, it } from "vitest";
import { calculateCartTotals, cartItemCount, formatEuro, shippingCentsFor, type CartItem } from "@/lib/cart";

const item = (overrides: Partial<CartItem> = {}): CartItem => ({
  variantId: "v1",
  sku: "SKU1",
  productSlug: "product",
  name: "PureLitter Zelfreinigende Kattenbak",
  unitPriceCents: 17900,
  quantity: 1,
  ...overrides,
});

describe("cart price calculation", () => {
  it("sums subtotal across quantities", () => {
    const totals = calculateCartTotals([item({ quantity: 2 })]);
    expect(totals.subtotalCents).toBe(35800);
  });

  it("is free shipping for NL and BE", () => {
    expect(shippingCentsFor("NL")).toBe(0);
    expect(shippingCentsFor("BE")).toBe(0);
  });

  it("extracts the 21% BTW component from a VAT-inclusive total", () => {
    const totals = calculateCartTotals([item({ unitPriceCents: 12100, quantity: 1 })]);
    // 12100 / 1.21 = 10000 -> btw = 2100
    expect(totals.totalCents).toBe(12100);
    expect(totals.btwCents).toBe(2100);
  });

  it("counts total items across distinct lines", () => {
    expect(cartItemCount([item({ quantity: 2 }), item({ variantId: "v2", quantity: 3 })])).toBe(5);
  });

  it("formats cents as euro currency", () => {
    expect(formatEuro(17900)).toContain("179");
  });

  it("adds shipping on top of subtotal in the total", () => {
    const totals = calculateCartTotals([item({ quantity: 1 })]);
    expect(totals.totalCents).toBe(totals.subtotalCents + totals.shippingCents);
  });
});
