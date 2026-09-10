import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { getOrderByNumber } from "@/lib/orders";
import { getCsrfToken } from "@/lib/csrf";
import { formatEuro } from "@/lib/cart";
import { site } from "@/lib/site";
import ConversionTracker from "@/components/ConversionTracker";
import RetryPaymentButton from "@/components/RetryPaymentButton";

export const metadata: Metadata = {
  title: "Bedankt voor je bestelling",
  robots: { index: false, follow: false },
};

export default async function ThankYouPage({
  params,
}: {
  params: Promise<{ ordernummer: string }>;
}) {
  const { ordernummer } = await params;
  const order = await getOrderByNumber(ordernummer);

  if (!order) notFound();

  const csrfToken = await getCsrfToken();

  if (order.status === "mislukt") {
    return (
      <div className="mx-auto max-w-2xl px-4 py-16 text-center">
        <h1 className="font-heading text-3xl font-semibold text-ink">Betaling mislukt</h1>
        <p className="mt-3 text-ink-muted">
          De betaling voor bestelling <strong>{order.order_number}</strong> is niet gelukt, geannuleerd of
          verlopen. Er is nog niets afgeschreven. Je kunt het opnieuw proberen.
        </p>
        <div className="mt-8 flex flex-col items-center gap-3">
          <RetryPaymentButton orderNumber={order.order_number} csrfToken={csrfToken} />
          <Link href="/winkelwagen" className="text-sm text-ink-muted underline hover:text-accent">
            Terug naar winkelwagen
          </Link>
        </div>
        <p className="mt-8 text-sm text-ink-muted">
          Blijft het mislukken? Mail ons op{" "}
          <a href={`mailto:${site.email}`} className="text-accent hover:underline">
            {site.email}
          </a>
          .
        </p>
      </div>
    );
  }

  if (order.status === "pending") {
    return (
      <div className="mx-auto max-w-2xl px-4 py-16 text-center">
        <h1 className="font-heading text-3xl font-semibold text-ink">Betaling in behandeling</h1>
        <p className="mt-3 text-ink-muted">
          We wachten nog op de bevestiging van je betaling voor bestelling{" "}
          <strong>{order.order_number}</strong>. Deze pagina wordt automatisch bijgewerkt zodra dat gelukt is —
          je kunt de pagina ook handmatig verversen.
        </p>
      </div>
    );
  }

  // status === "betaald" (or any later fulfilment stage) — show the paid state.
  return (
    <div className="mx-auto max-w-2xl px-4 py-16">
      <ConversionTracker
        orderNumber={order.order_number}
        totalCents={order.total_cents}
        alreadyTracked={Boolean(order.conversion_tracked_at)}
      />
      <div className="text-center">
        <span aria-hidden="true" className="text-4xl">✓</span>
        <h1 className="mt-3 font-heading text-3xl font-semibold text-ink">Bedankt voor je bestelling!</h1>
        <p className="mt-3 text-ink-muted">
          Bestelnummer <strong>{order.order_number}</strong>. We hebben een bevestiging gestuurd naar{" "}
          {order.email}.
        </p>
      </div>

      <div className="mt-10 rounded-2xl border border-border bg-surface p-6">
        <h2 className="font-heading text-lg font-semibold text-ink">Overzicht</h2>
        <ul className="mt-4 space-y-2 text-sm">
          {order.items.map((item) => (
            <li key={item.id} className="flex justify-between">
              <span className="text-ink-muted">
                {item.quantity}× {item.product_name}
              </span>
              <span className="font-medium text-ink">{formatEuro(item.total_cents)}</span>
            </li>
          ))}
        </ul>
        <div className="mt-4 flex justify-between border-t border-border pt-3 text-sm font-semibold text-ink">
          <span>Totaal (incl. BTW)</span>
          <span>{formatEuro(order.total_cents)}</span>
        </div>
      </div>

      <div className="mt-6 rounded-2xl border border-border bg-surface p-6">
        <h2 className="font-heading text-lg font-semibold text-ink">Wat gebeurt er nu</h2>
        <ol className="mt-4 space-y-2 text-sm text-ink-muted">
          <li>1. We bestellen je PureLitter bij onze leverancier.</li>
          <li>2. Je ontvangt een e-mail met track & trace zodra je pakket is verzonden.</li>
          <li>3. Verwachte levertijd: 2-5 werkdagen in Nederland en België.</li>
        </ol>
      </div>

      <p className="mt-8 text-center text-sm text-ink-muted">
        Vragen over je bestelling? Mail{" "}
        <a href={`mailto:${site.email}`} className="text-accent hover:underline">
          {site.email}
        </a>{" "}
        of bekijk de status via{" "}
        <Link href="/order-volgen" className="text-accent hover:underline">
          Order volgen
        </Link>
        .
      </p>
    </div>
  );
}
