import { site } from "@/lib/site";
import AddToCartButton from "@/components/AddToCartButton";

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
        <AddToCartButton
          variantId={site.defaultVariantId}
          sku={site.defaultSku}
          productSlug={site.productSlug}
          name={site.productName}
          unitPriceCents={site.price * 100}
          image="/images/product-1.svg"
          className="flex-1 rounded-full bg-accent px-6 py-3 text-sm font-semibold text-white transition-colors hover:bg-accent-dark"
        />
      </div>
    </div>
  );
}
