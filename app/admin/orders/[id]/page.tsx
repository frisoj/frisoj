import { notFound } from "next/navigation";
import { getOrderById } from "@/lib/orders";
import { formatEuro } from "@/lib/cart";
import { ORDER_STATUS_LABELS, ORDER_STATUS_TRANSITIONS } from "@/lib/supabase/types";
import {
  changeOrderStatusAction,
  refundOrderAction,
  saveTrackAndTraceAction,
  sendShippingEmailAction,
} from "@/lib/admin-actions";
import ConfirmSubmitButton from "@/components/admin/ConfirmSubmitButton";

export default async function AdminOrderDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const order = await getOrderById(id);
  if (!order) notFound();

  const nextStatuses = ORDER_STATUS_TRANSITIONS[order.status] ?? [];

  return (
    <div>
      <h1 className="text-2xl font-semibold text-ink">{order.order_number}</h1>
      <p className="mt-1 text-sm text-ink-muted">
        Aangemaakt {new Date(order.created_at).toLocaleString("nl-NL")} · status{" "}
        <span className="font-semibold text-ink">{ORDER_STATUS_LABELS[order.status]}</span>
      </p>

      <div className="mt-6 grid gap-6 lg:grid-cols-2">
        <section className="rounded-xl border border-border bg-surface p-5">
          <h2 className="font-semibold text-ink">Klant</h2>
          <dl className="mt-3 space-y-1 text-sm">
            <div className="flex justify-between"><dt className="text-ink-muted">Naam</dt><dd>{order.shipping_address.firstName} {order.shipping_address.lastName}</dd></div>
            <div className="flex justify-between"><dt className="text-ink-muted">E-mail</dt><dd>{order.email}</dd></div>
            <div className="flex justify-between"><dt className="text-ink-muted">Telefoon</dt><dd>{order.phone ?? "-"}</dd></div>
          </dl>
          <h3 className="mt-4 text-sm font-semibold text-ink">Verzendadres</h3>
          <p className="mt-1 text-sm text-ink-muted">
            {order.shipping_address.street} {order.shipping_address.houseNumber}{order.shipping_address.houseNumberAddition}
            <br />
            {order.shipping_address.postalCode} {order.shipping_address.city}, {order.shipping_address.country}
          </p>
          {order.billing_address && (
            <>
              <h3 className="mt-4 text-sm font-semibold text-ink">Factuuradres</h3>
              <p className="mt-1 text-sm text-ink-muted">
                {order.billing_address.firstName} {order.billing_address.lastName}<br />
                {order.billing_address.street} {order.billing_address.houseNumber}{order.billing_address.houseNumberAddition}
                <br />
                {order.billing_address.postalCode} {order.billing_address.city}, {order.billing_address.country}
              </p>
            </>
          )}
        </section>

        <section className="rounded-xl border border-border bg-surface p-5">
          <h2 className="font-semibold text-ink">Producten & betaling</h2>
          <ul className="mt-3 space-y-1 text-sm">
            {order.items.map((item) => (
              <li key={item.id} className="flex justify-between">
                <span>{item.quantity}× {item.product_name}</span>
                <span>{formatEuro(item.total_cents)}</span>
              </li>
            ))}
          </ul>
          <div className="mt-3 flex justify-between border-t border-border pt-2 text-sm font-semibold">
            <span>Totaal</span>
            <span>{formatEuro(order.total_cents)}</span>
          </div>
          <dl className="mt-4 space-y-1 text-sm">
            <div className="flex justify-between"><dt className="text-ink-muted">Betaalmethode</dt><dd>{order.payment_method ?? "-"}</dd></div>
            <div className="flex justify-between"><dt className="text-ink-muted">Mollie payment ID</dt><dd className="break-all">{order.mollie_payment_id ?? "-"}</dd></div>
            <div className="flex justify-between"><dt className="text-ink-muted">Mollie status</dt><dd>{order.mollie_payment_status ?? "-"}</dd></div>
          </dl>
        </section>

        <section className="rounded-xl border border-border bg-surface p-5">
          <h2 className="font-semibold text-ink">Status wijzigen</h2>
          {nextStatuses.length === 0 ? (
            <p className="mt-3 text-sm text-ink-muted">Geen verdere statusovergangen beschikbaar.</p>
          ) : (
            <form action={changeOrderStatusAction} className="mt-3 flex flex-wrap gap-2">
              <input type="hidden" name="orderId" value={order.id} />
              {nextStatuses.map((status) => (
                <button
                  key={status}
                  type="submit"
                  name="nextStatus"
                  value={status}
                  className="rounded-lg border border-border px-3 py-2 text-sm font-medium text-ink hover:border-accent hover:text-accent"
                >
                  → {ORDER_STATUS_LABELS[status]}
                </button>
              ))}
            </form>
          )}
        </section>

        <section className="rounded-xl border border-border bg-surface p-5">
          <h2 className="font-semibold text-ink">Track & trace</h2>
          <form action={saveTrackAndTraceAction} className="mt-3 space-y-2">
            <input type="hidden" name="orderId" value={order.id} />
            <input
              name="carrier"
              defaultValue={order.carrier ?? ""}
              placeholder="Vervoerder (bv. PostNL)"
              className="w-full rounded-lg border border-border bg-cream px-3 py-2 text-sm"
            />
            <input
              name="trackAndTraceCode"
              defaultValue={order.track_and_trace_code ?? ""}
              placeholder="Track & trace code"
              className="w-full rounded-lg border border-border bg-cream px-3 py-2 text-sm"
            />
            <button type="submit" className="rounded-lg bg-accent px-4 py-2 text-sm font-semibold text-white hover:bg-accent-dark">
              Opslaan
            </button>
          </form>

          <form action={sendShippingEmailAction} className="mt-3">
            <input type="hidden" name="orderId" value={order.id} />
            <button
              type="submit"
              disabled={!order.track_and_trace_code}
              className="rounded-lg border border-border px-4 py-2 text-sm font-medium text-ink hover:border-accent hover:text-accent disabled:opacity-50"
            >
              Verzendmail versturen
            </button>
          </form>
          {order.review_invite_sent_at && (
            <p className="mt-2 text-xs text-ink-muted">Review-uitnodiging verstuurd op {new Date(order.review_invite_sent_at).toLocaleDateString("nl-NL")}.</p>
          )}
        </section>

        <section className="rounded-xl border border-border bg-surface p-5 lg:col-span-2">
          <h2 className="font-semibold text-ink">Terugbetaling via Mollie</h2>
          <p className="mt-1 text-sm text-ink-muted">Laat het bedrag leeg voor een volledige terugbetaling ({formatEuro(order.total_cents)}).</p>
          <form
            action={refundOrderAction}
            className="mt-3 flex flex-wrap items-center gap-2"
          >
            <input type="hidden" name="orderId" value={order.id} />
            <input
              name="amount"
              placeholder={(order.total_cents / 100).toFixed(2)}
              className="w-32 rounded-lg border border-border bg-cream px-3 py-2 text-sm"
            />
            <ConfirmSubmitButton
              confirmMessage={`Weet je zeker dat je deze terugbetaling wilt starten voor ${order.order_number}? Dit kan niet ongedaan worden gemaakt.`}
              disabled={!order.mollie_payment_id || order.status === "terugbetaald"}
              className="rounded-lg border border-accent px-4 py-2 text-sm font-semibold text-accent hover:bg-accent-tint disabled:opacity-50"
            >
              Terugbetaling starten
            </ConfirmSubmitButton>
          </form>
        </section>
      </div>
    </div>
  );
}
