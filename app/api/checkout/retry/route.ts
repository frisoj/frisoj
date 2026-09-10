import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getOrderByNumber, setMolliePayment } from "@/lib/orders";
import { getMollieClient, toMollieMethod } from "@/lib/mollie";
import { rateLimit, clientIpFrom } from "@/lib/rate-limit";
import { verifyCsrfToken, CSRF_COOKIE_NAME } from "@/lib/csrf";
import { site } from "@/lib/site";
import type { PaymentMethod } from "@/lib/validation/checkout";

// POST /api/checkout/retry — "Opnieuw betalen" on the thank-you page for an
// order whose payment failed/expired/was canceled. Starts a brand new
// Mollie payment for the same order; does not create a new order.

const schema = z.object({ orderNumber: z.string().min(1) });

export async function POST(request: NextRequest) {
  const csrfCookie = request.cookies.get(CSRF_COOKIE_NAME)?.value;
  const csrfHeader = request.headers.get("x-csrf-token");
  if (!verifyCsrfToken(csrfCookie, csrfHeader)) {
    return NextResponse.json({ error: "Ongeldig verzoek." }, { status: 403 });
  }

  const ip = clientIpFrom(request.headers);
  const { allowed } = rateLimit(`checkout-retry:${ip}`, 8, 60_000);
  if (!allowed) {
    return NextResponse.json({ error: "Te veel pogingen. Probeer het later opnieuw." }, { status: 429 });
  }

  const parsed = schema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Ongeldig verzoek." }, { status: 400 });

  const order = await getOrderByNumber(parsed.data.orderNumber);
  if (!order) return NextResponse.json({ error: "Bestelling niet gevonden." }, { status: 404 });
  if (order.status === "betaald") {
    return NextResponse.json({ error: "Deze bestelling is al betaald." }, { status: 400 });
  }

  const siteUrl = process.env.NEXT_PUBLIC_SITE_URL ?? site.url;
  const redirectUrl = `${siteUrl}/bedankt/${order.order_number}`;

  const mollie = getMollieClient();
  if (!mollie) {
    return NextResponse.json({ error: "Betalen is momenteel niet beschikbaar." }, { status: 503 });
  }

  try {
    const payment = await mollie.payments.create({
      amount: { currency: "EUR", value: (order.total_cents / 100).toFixed(2) },
      description: `PureLitter bestelling ${order.order_number}`,
      redirectUrl,
      webhookUrl: process.env.MOLLIE_WEBHOOK_URL || `${siteUrl}/api/mollie/webhook`,
      method: toMollieMethod((order.payment_method ?? "ideal") as PaymentMethod) as never,
      metadata: { orderNumber: order.order_number, orderId: order.id },
    });
    await setMolliePayment(order.id, payment.id, payment.status);
    return NextResponse.json({ redirectUrl: payment.getCheckoutUrl() ?? redirectUrl });
  } catch {
    console.error(`Mollie retry payment failed for order ${order.order_number}`);
    return NextResponse.json({ error: "Betaling kon niet worden gestart." }, { status: 502 });
  }
}
