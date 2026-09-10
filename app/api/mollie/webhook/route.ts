import { NextRequest, NextResponse } from "next/server";
import { getMollieClient } from "@/lib/mollie";
import {
  getOrderByMolliePaymentId,
  isWebhookEventProcessed,
  recordWebhookEvent,
  updateOrderStatus,
} from "@/lib/orders";
import { sendOrderConfirmationEmail, sendOwnerNotificationEmail } from "@/lib/email/send";

// POST /api/mollie/webhook
// Mollie calls this with `id=<payment id>` as a form-encoded body. We NEVER
// trust that body for anything beyond the payment id — the payment is
// always refetched from Mollie's API before any status change is applied.
// Idempotent: re-delivery of the same (paymentId, resultingStatus) pair is
// a no-op (see lib/orders.ts isWebhookEventProcessed/recordWebhookEvent).

export async function POST(request: NextRequest) {
  const mollie = getMollieClient();
  if (!mollie) {
    // Mollie isn't configured in this environment — nothing to verify.
    return NextResponse.json({ ok: true, skipped: "mollie_not_configured" });
  }

  let paymentId: string | null = null;
  try {
    const contentType = request.headers.get("content-type") ?? "";
    if (contentType.includes("application/json")) {
      const body = await request.json();
      paymentId = typeof body?.id === "string" ? body.id : null;
    } else {
      const form = await request.formData();
      const id = form.get("id");
      paymentId = typeof id === "string" ? id : null;
    }
  } catch {
    return NextResponse.json({ error: "Ongeldige aanvraag." }, { status: 400 });
  }

  if (!paymentId) {
    return NextResponse.json({ error: "Geen payment id." }, { status: 400 });
  }

  // Refetch the payment from Mollie — the only source of truth.
  const payment = await mollie.payments.get(paymentId).catch(() => null);
  if (!payment) {
    // Unknown/invalid payment id: acknowledge with 200 so Mollie doesn't
    // keep retrying, but do nothing.
    return NextResponse.json({ ok: true, skipped: "payment_not_found" });
  }

  const order = await getOrderByMolliePaymentId(payment.id);
  if (!order) {
    return NextResponse.json({ ok: true, skipped: "order_not_found" });
  }

  const alreadyProcessed = await isWebhookEventProcessed(payment.id, payment.status);
  if (alreadyProcessed) {
    return NextResponse.json({ ok: true, skipped: "duplicate" });
  }

  if (payment.status === "paid") {
    if (order.status !== "betaald") {
      await updateOrderStatus(order.id, "betaald", "Betaling ontvangen via Mollie.", {
        mollie_payment_status: payment.status,
        paid_at: new Date().toISOString(),
      });
      // Fire-and-forget-ish: awaited, but a mail failure must never fail
      // the webhook response to Mollie (it would cause needless retries).
      await Promise.allSettled([
        sendOrderConfirmationEmail(order.id),
        sendOwnerNotificationEmail(order.id),
      ]);
    }
  } else if (payment.status === "failed" || payment.status === "canceled" || payment.status === "expired") {
    if (order.status === "pending") {
      await updateOrderStatus(order.id, "mislukt", `Betaling ${payment.status} via Mollie.`, {
        mollie_payment_status: payment.status,
      });
    }
  } else if (payment.status === "open") {
    // Leave as "pending" — nothing to do, but still record the event so a
    // redelivered "open" doesn't reprocess either.
  }

  await recordWebhookEvent(payment.id, payment.status, order.id);

  return NextResponse.json({ ok: true });
}
