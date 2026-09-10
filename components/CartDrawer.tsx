"use client";

import Link from "next/link";
import { useEffect, useRef } from "react";
import { useCart } from "@/lib/cart-context";
import { formatEuro } from "@/lib/cart";
import QuantityStepper from "@/components/QuantityStepper";

export default function CartDrawer() {
  const { items, totals, isDrawerOpen, closeDrawer, setQuantity, removeItem } = useCart();
  const closeButtonRef = useRef<HTMLButtonElement>(null);
  const dialogRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (isDrawerOpen) closeButtonRef.current?.focus();
  }, [isDrawerOpen]);

  // Escape closes; Tab/Shift+Tab is trapped inside the dialog (aria-modal
  //="true" implies exactly this) so keyboard focus never silently lands on
  // page content hidden behind the overlay.
  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") {
        closeDrawer();
        return;
      }
      if (e.key !== "Tab" || !dialogRef.current) return;
      const focusable = dialogRef.current.querySelectorAll<HTMLElement>(
        'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
      );
      if (focusable.length === 0) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    }
    if (isDrawerOpen) document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [isDrawerOpen, closeDrawer]);

  if (!isDrawerOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex justify-end">
      <button
        type="button"
        aria-label="Winkelwagen sluiten"
        onClick={closeDrawer}
        className="absolute inset-0 bg-ink/30"
      />
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-label="Winkelwagen"
        className="relative flex h-full w-full max-w-md flex-col bg-surface shadow-xl"
      >
        <div className="flex items-center justify-between border-b border-border px-5 py-4">
          <h2 className="font-heading text-lg font-semibold text-ink">Winkelwagen</h2>
          <button
            ref={closeButtonRef}
            type="button"
            onClick={closeDrawer}
            aria-label="Sluiten"
            className="rounded-full p-2 text-ink-muted hover:bg-cream hover:text-ink"
          >
            ✕
          </button>
        </div>

        <div className="flex-1 overflow-y-auto px-5 py-4">
          {items.length === 0 ? (
            <div className="mt-10 text-center">
              <p className="text-ink-muted">Je winkelwagen is nog leeg.</p>
              <Link
                href="/zelfreinigende-kattenbak"
                onClick={closeDrawer}
                className="mt-4 inline-block font-semibold text-accent hover:underline"
              >
                Bekijk het product →
              </Link>
            </div>
          ) : (
            <ul className="space-y-4">
              {items.map((item) => (
                <li key={item.variantId} className="flex gap-3 border-b border-border pb-4">
                  <div className="flex-1">
                    <p className="font-medium text-ink">{item.name}</p>
                    <p className="mt-1 text-sm text-ink-muted">{formatEuro(item.unitPriceCents)} / stuk</p>
                    <div className="mt-2 flex items-center gap-3">
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
                  <p className="font-semibold text-ink">{formatEuro(item.unitPriceCents * item.quantity)}</p>
                </li>
              ))}
            </ul>
          )}
        </div>

        {items.length > 0 && (
          <div className="border-t border-border px-5 py-4">
            <div className="flex items-center justify-between text-sm text-ink-muted">
              <span>Subtotaal</span>
              <span className="font-semibold text-ink">{formatEuro(totals.subtotalCents)}</span>
            </div>
            <div className="mt-3 grid grid-cols-2 gap-3">
              <Link
                href="/zelfreinigende-kattenbak"
                onClick={closeDrawer}
                className="rounded-full border border-border px-4 py-3 text-center text-sm font-semibold text-ink hover:border-accent hover:text-accent"
              >
                Verder winkelen
              </Link>
              <Link
                href="/afrekenen"
                onClick={closeDrawer}
                className="rounded-full bg-accent px-4 py-3 text-center text-sm font-semibold text-white hover:bg-accent-dark"
              >
                Afrekenen
              </Link>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
