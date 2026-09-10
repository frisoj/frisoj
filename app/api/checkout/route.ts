import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { checkoutFormSchema } from "@/lib/validation/checkout";
import { lookupVariant } from "@/lib/catalog";
import { calculateCartTotals, shippingCentsFor, type CartItem } from "@/lib/cart";
import { createPendingOrder, setMolliePayment } from "@/lib/orders";
import { getMollieClient, toMollieMethod } from "@/lib/mollie";
import { rateLimit, clientIpFrom } from "@/lib/rate-limit";
import { verifyCsrfToken, CSRF_COOKIE_NAME } from "@/lib/csrf";
import { site } from "@/lib/site";

// POST /api/checkout
// Body: { form: CheckoutFormInput, cart: { variantId, quantity }[] }
// Creates a pending order (status "pending"), then a Mollie payment for it.
// All Mollie calls are server-side only; no personal data is logged.

const cartLineSchema = z.object({
  variantId: z.string().min(1),
  quantity: z.number().int().min(1).max(20),
});

const requestSchema = z.object({
  form: checkoutFormSchema,
  cart: z.array(cartLineSchema).min(1, "Winkelwagen is leeg."),
});

export async function POST(request: NextRequest) {
  const csrfCookie = request.cookies.get(CSRF_COOKIE_NAME)?.value;
  const csrfHeader = request.headers.get("x-csrf-token");
  if (!verifyCsrfToken(csrfCookie, csrfHeader)) {
    return NextResponse.json({ error: "Ongeldig verzoek (CSRF-token ontbreekt of komt niet overeen)." }, { status: 403 });
  }

  const ip = clientIpFrom(request.headers);
  const { allowed } = rateLimit(`checkout:${ip}`, 8, 60_000);
  if (!allowed) {
    return NextResponse.json(
      { error: "Te veel pogingen. Probeer het over een minuut opnieuw." },
      { status: 429 },
    );
  }

  const json = await request.json().catch(() => null);
  const parsed = requestSchema.safeParse(json);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Ongeldige gegevens.", issues: parsed.error.issues },
      { status: 400 },
    );
  }

  const { form, cart } = parsed.data;

  // Recompute every line server-side from the trusted catalog — never trust
  // a client-supplied price.
  const items: CartItem[] = [];
  for (const line of cart) {
    const entry = lookupVariant(line.variantId);
    if (!entry) {
      return NextResponse.json({ error: "Onbekend product in winkelwagen." }, { status: 400 });
    }
    items.push({
      variantId: line.variantId,
      sku: entry.sku,
      productSlug: site.productSlug,
      name: entry.name,
      unitPriceCents: entry.unitPriceCents,
      quantity: line.quantity,
    });
  }

  const totals = calculateCartTotals(items, form.shipping.country);

  const order = await createPendingOrder({
    email: form.email,
    phone: form.phone || undefined,
    shippingAddress: form.shipping,
    billingAddress: form.billingDifferent && form.billing
      ? {
          firstName: form.billing.firstName!,
          lastName: form.billing.lastName!,
          country: form.billing.country!,
          street: form.billing.street!,
          houseNumber: form.billing.houseNumber!,
          houseNumberAddition: form.billing.houseNumberAddition ?? "",
          postalCode: form.billing.postalCode!,
          city: form.billing.city!,
        }
      : null,
    paymentMethod: form.paymentMethod,
    newsletterOptIn: form.newsletterOptIn,
    items: items.map((item) => ({
      productVariantId: item.variantId,
      productName: item.name,
      unitPriceCents: item.unitPriceCents,
      quantity: item.quantity,
    })),
    subtotalCents: totals.subtotalCents,
    shippingCents: shippingCentsFor(form.shipping.country),
    btwCents: totals.btwCents,
    totalCents: totals.totalCents,
  });

  const siteUrl = process.env.NEXT_PUBLIC_SITE_URL ?? site.url;
  // The thank-you page is keyed by the order's random UUID `id`, not its
  // 6-digit `order_number` — the order number alone is guessable/enumerable
  // and must never double as an access credential for the order's personal
  // data. See lib/order-number.ts isValidUuid and lib/orders.ts getOrderById.
  //
  // Absolute — Mollie requires a fully-qualified redirectUrl/webhookUrl.
  const redirectUrl = `${siteUrl}/bedankt/${order.id}`;
  // Relative — used for the browser's own client-side navigation below
  // (no Mollie involved). Using the absolute `redirectUrl` there would
  // silently navigate the shopper to whatever NEXT_PUBLIC_SITE_URL/
  // site.url happens to point at instead of staying on the host they're
  // actually on — harmless in production once that env var matches the
  // real domain, but it broke every preview/staging deploy and this exact
  // local environment (no NEXT_PUBLIC_SITE_URL set) outright.
  const thankYouPath = `/bedankt/${order.id}`;

  const mollie = getMollieClient();
  if (!mollie) {
    // No Mollie API key configured in this environment: the order is
    // created (status "pending") but no real payment can be started. Send
    // the shopper straight to the thank-you page, which will show the
    // correct "pending" state and explain payment isn't set up yet — see
    // DECISIONS.md. This keeps the whole flow testable without live keys.
    return NextResponse.json({ redirectUrl: thankYouPath, mollieConfigured: false, orderNumber: order.order_number });
  }

  try {
    const payment = await mollie.payments.create({
      amount: { currency: "EUR", value: (totals.totalCents / 100).toFixed(2) },
      description: `PureLitter bestelling ${order.order_number}`,
      redirectUrl,
      webhookUrl: process.env.MOLLIE_WEBHOOK_URL || `${siteUrl}/api/mollie/webhook`,
      method: toMollieMethod(form.paymentMethod) as never,
      metadata: { orderNumber: order.order_number, orderId: order.id },
    });

    await setMolliePayment(order.id, payment.id, payment.status);

    const checkoutUrl = payment.getCheckoutUrl();
    return NextResponse.json({ redirectUrl: checkoutUrl ?? redirectUrl, mollieConfigured: true, orderNumber: order.order_number });
  } catch {
    // Never log personal data (order email/address) — log only the safe,
    // non-PII order number for operational debugging.
    console.error(`Mollie payment creation failed for order ${order.order_number}`);
    return NextResponse.json(
      { error: "Betaling kon niet worden gestart. Probeer het opnieuw.", redirectUrl: thankYouPath },
      { status: 502 },
    );
  }
}
