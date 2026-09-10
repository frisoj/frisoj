import { site } from "@/lib/site";

export default function StickyAddToCart() {
  return (
    <div className="fixed inset-x-0 bottom-0 z-30 border-t border-border bg-surface/95 p-3 backdrop-blur md:hidden">
      <div className="mx-auto flex max-w-6xl items-center justify-between gap-4 px-1">
        <div>
          <p className="text-xs text-ink-muted">Incl. BTW</p>
          <p className="font-heading text-lg font-semibold text-ink">
            €{site.price},-
          </p>
        </div>
        <button
          type="button"
          disabled
          aria-disabled="true"
          title="Bestellen komt beschikbaar in de volgende fase"
          className="flex-1 rounded-full bg-accent px-6 py-3 text-sm font-semibold text-white opacity-90"
        >
          In winkelwagen
        </button>
      </div>
    </div>
  );
}
