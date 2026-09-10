"use client";

import { useState } from "react";
import { useCart } from "@/lib/cart-context";

export default function AddToCartButton({
  variantId,
  sku,
  productSlug,
  name,
  unitPriceCents,
  image,
  className,
  full = true,
}: {
  variantId: string;
  sku: string;
  productSlug: string;
  name: string;
  unitPriceCents: number;
  image?: string;
  className?: string;
  full?: boolean;
}) {
  const { addItem } = useCart();
  const [justAdded, setJustAdded] = useState(false);

  function handleClick() {
    addItem({ variantId, sku, productSlug, name, unitPriceCents, quantity: 1, image });
    setJustAdded(true);
    setTimeout(() => setJustAdded(false), 1500);
  }

  return (
    <button
      type="button"
      onClick={handleClick}
      className={
        className ??
        `${full ? "w-full md:w-auto" : ""} mt-8 rounded-full bg-accent px-6 py-3 text-base font-semibold text-white transition-colors hover:bg-accent-dark md:px-10`
      }
    >
      {justAdded ? "Toegevoegd ✓" : "In winkelwagen"}
    </button>
  );
}
