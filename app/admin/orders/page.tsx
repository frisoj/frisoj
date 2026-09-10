import Link from "next/link";
import { listOrders } from "@/lib/orders";
import { formatEuro } from "@/lib/cart";
import { ORDER_STATUS_LABELS, type OrderStatus } from "@/lib/supabase/types";

export default async function AdminOrdersPage({
  searchParams,
}: {
  searchParams: Promise<{ status?: string; q?: string }>;
}) {
  const params = await searchParams;
  const status = params.status as OrderStatus | undefined;
  const orders = await listOrders({ status, search: params.q });

  return (
    <div>
      <h1 className="text-2xl font-semibold text-ink">Bestellingen</h1>

      <form className="mt-4 flex flex-wrap gap-3" method="get">
        <input
          type="search"
          name="q"
          defaultValue={params.q ?? ""}
          placeholder="Zoek op ordernummer, e-mail of naam"
          className="min-w-64 rounded-lg border border-border bg-surface px-3 py-2 text-sm text-ink"
        />
        <select name="status" defaultValue={status ?? ""} className="rounded-lg border border-border bg-surface px-3 py-2 text-sm text-ink">
          <option value="">Alle statussen</option>
          {Object.entries(ORDER_STATUS_LABELS).map(([value, label]) => (
            <option key={value} value={value}>{label}</option>
          ))}
        </select>
        <button type="submit" className="rounded-lg bg-accent px-4 py-2 text-sm font-semibold text-white hover:bg-accent-dark">
          Filteren
        </button>
      </form>

      <div className="mt-6 overflow-x-auto rounded-xl border border-border bg-surface">
        <table className="w-full min-w-[720px] border-collapse text-left text-sm">
          <thead>
            <tr className="border-b border-border bg-cream text-ink-muted">
              <th className="px-4 py-2">Ordernummer</th>
              <th className="px-4 py-2">Datum</th>
              <th className="px-4 py-2">Klant</th>
              <th className="px-4 py-2">Status</th>
              <th className="px-4 py-2 text-right">Totaal</th>
            </tr>
          </thead>
          <tbody>
            {orders.length === 0 && (
              <tr>
                <td colSpan={5} className="px-4 py-6 text-center text-ink-muted">
                  Geen bestellingen gevonden.
                </td>
              </tr>
            )}
            {orders.map((order) => (
              <tr key={order.id} className="border-b border-border last:border-0 hover:bg-cream">
                <td className="px-4 py-2">
                  <Link href={`/admin/orders/${order.id}`} className="font-semibold text-accent hover:underline">
                    {order.order_number}
                  </Link>
                </td>
                <td className="px-4 py-2 text-ink-muted">{new Date(order.created_at).toLocaleDateString("nl-NL")}</td>
                <td className="px-4 py-2 text-ink">
                  {order.shipping_address?.firstName} {order.shipping_address?.lastName}
                  <div className="text-xs text-ink-muted">{order.email}</div>
                </td>
                <td className="px-4 py-2">
                  <span className="rounded-full bg-accent-tint px-2 py-1 text-xs font-semibold text-accent-dark">
                    {ORDER_STATUS_LABELS[order.status] ?? order.status}
                  </span>
                </td>
                <td className="px-4 py-2 text-right font-medium text-ink">{formatEuro(order.total_cents)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
