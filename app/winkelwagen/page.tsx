"use client";

import Link from "next/link";
import Image from "next/image";
import { useCart } from "@/lib/cart-context";
import { formatEuro } from "@/lib/cart";
import QuantityStepper from "@/components/QuantityStepper";

export default function CartPage() {
  const { items, totals, setQuantity, removeItem, isHydrated } = useCart();

  if (isHydrated && items.length === 0) {
    return (
      <div className="mx-auto max-w-2xl px-4 py-20 text-center">
        <h1 className="font-heading text-3xl font-semibold text-ink">Je winkelwagen is leeg</h1>
        <p className="mt-3 text-ink-muted">
          Bekijk de PureLitter zelfreinigende kattenbak en voeg hem toe aan je winkelwagen.
        </p>
        <Link
          href="/zelfreinigende-kattenbak"
          className="mt-8 inline-block rounded-full bg-accent px-6 py-3 text-base font-semibold text-white transition-colors hover:bg-accent-dark"
        >
          Bekijk het product
        </Link>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-5xl px-4 py-10 sm:py-14">
      <h1 className="font-heading text-3xl font-semibold text-ink sm:text-4xl">Winkelwagen</h1>

      <div className="mt-8 grid gap-10 lg:grid-cols-[1fr_320px]">
        <div className="space-y-4">
          {items.map((item) => (
            <div
              key={item.variantId}
              className="flex gap-4 rounded-2xl border border-border bg-surface p-4"
            >
              {item.image && (
                <div className="h-20 w-20 shrink-0 overflow-hidden rounded-xl border border-border bg-cream">
                  <Image src={item.image} alt="" width={80} height={80} className="h-full w-full object-cover" />
                </div>
              )}
              <div className="flex-1">
                <p className="font-medium text-ink">{item.name}</p>
                <p className="mt-1 text-sm text-ink-muted">{formatEuro(item.unitPriceCents)} per stuk</p>
                <div className="mt-3 flex flex-wrap items-center gap-3">
                  <QuantityStepper
                    quantity={item.quantity}
                    onChange={(q) => setQuantity(item.variantId, q)}
                    label={item.name}
                  />
                  <button
                    type="button"
                    onClick={() => removeItem(item.variantId)}
                    className="text-sm text-ink-muted underline hover:text-accent"
                  >
                    Verwijderen
                  </button>
                </div>
              </div>
              <p className="font-heading font-semibold text-ink">
                {formatEuro(item.unitPriceCents * item.quantity)}
              </p>
            </div>
          ))}

          <Link href="/zelfreinigende-kattenbak" className="inline-block font-semibold text-accent hover:underline">
            ← Verder winkelen
          </Link>
        </div>

        <aside className="h-fit rounded-2xl border border-border bg-surface p-6">
          <h2 className="font-heading text-lg font-semibold text-ink">Overzicht</h2>
          <dl className="mt-4 space-y-2 text-sm">
            <div className="flex justify-between">
              <dt className="text-ink-muted">Subtotaal</dt>
              <dd className="text-ink">{formatEuro(totals.subtotalCents)}</dd>
            </div>
            <div className="flex justify-between">
              <dt className="text-ink-muted">Verzending (NL/BE)</dt>
              <dd className="font-semibold text-success">Gratis</dd>
            </div>
            <div className="flex justify-between border-t border-border pt-2">
              <dt className="font-semibold text-ink">Totaal</dt>
              <dd className="font-heading text-lg font-semibold text-ink">{formatEuro(totals.totalCents)}</dd>
            </div>
            <div className="flex justify-between text-xs text-ink-muted">
              <dt>Waarvan BTW (21%)</dt>
              <dd>{formatEuro(totals.btwCents)}</dd>
            </div>
          </dl>
          <Link
            href="/afrekenen"
            className="mt-6 block rounded-full bg-accent px-6 py-3 text-center text-sm font-semibold text-white transition-colors hover:bg-accent-dark"
          >
            Afrekenen
          </Link>
        </aside>
      </div>
    </div>
  );
}
