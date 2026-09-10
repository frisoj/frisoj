"use client";

import Link from "next/link";
import { useCart } from "@/lib/cart-context";

export default function CartIndicator() {
  const { totals } = useCart();

  return (
    <Link
      href="/winkelwagen"
      aria-label={`Winkelwagen${totals.itemCount > 0 ? `, ${totals.itemCount} artikel(en)` : ""}`}
      className="relative rounded-full p-2 text-ink transition-colors hover:bg-cream hover:text-accent"
    >
      <span aria-hidden="true" className="text-xl">🛒</span>
      {totals.itemCount > 0 && (
        <span
          aria-hidden="true"
          className="absolute -right-1 -top-1 flex h-5 min-w-5 items-center justify-center rounded-full bg-accent px-1 text-xs font-semibold text-white"
        >
          {totals.itemCount}
        </span>
      )}
    </Link>
  );
}
