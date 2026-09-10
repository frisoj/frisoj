import { describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import {
  createPendingOrder,
  setMolliePayment,
  isWebhookEventProcessed,
  recordWebhookEvent,
  updateOrderStatus,
  getOrderById,
} from "@/lib/orders";

// These tests run against lib/orders.ts's in-memory mock store (no
// NEXT_PUBLIC_SUPABASE_URL/SUPABASE_SERVICE_ROLE_KEY set in the test env),
// which is enough to exercise the idempotency contract the Mollie webhook
// relies on: a duplicate delivery of the same (paymentId, status) must not
// re-process the order.

async function makeOrder() {
  return createPendingOrder({
    email: `test-${randomUUID()}@example.com`,
    shippingAddress: {
      firstName: "Test",
      lastName: "Klant",
      country: "NL",
      street: "Teststraat",
      houseNumber: "1",
      postalCode: "1234 AB",
      city: "Amsterdam",
    },
    billingAddress: null,
    paymentMethod: "ideal",
    newsletterOptIn: false,
    items: [{ productVariantId: "v1", productName: "PureLitter", unitPriceCents: 17900, quantity: 1 }],
    subtotalCents: 17900,
    shippingCents: 0,
    btwCents: 3106,
    totalCents: 17900,
  });
}

describe("mollie webhook idempotency", () => {
  it("is not processed before the event has been recorded", async () => {
    const order = await makeOrder();
    const paymentId = `tr_${randomUUID()}`;
    await setMolliePayment(order.id, paymentId, "open");

    expect(await isWebhookEventProcessed(paymentId, "paid")).toBe(false);
  });

  it("marks an event processed only once recorded, keyed by (paymentId, status)", async () => {
    const order = await makeOrder();
    const paymentId = `tr_${randomUUID()}`;
    await setMolliePayment(order.id, paymentId, "open");

    await recordWebhookEvent(paymentId, "paid", order.id);

    expect(await isWebhookEventProcessed(paymentId, "paid")).toBe(true);
    // A different status on the same payment is a distinct event.
    expect(await isWebhookEventProcessed(paymentId, "failed")).toBe(false);
  });

  it("simulated webhook handler applies the paid status only once across duplicate deliveries", async () => {
    const order = await makeOrder();
    const paymentId = `tr_${randomUUID()}`;
    await setMolliePayment(order.id, paymentId, "open");

    async function simulateWebhookDelivery() {
      const current = await getOrderById(order.id);
      if (!current) throw new Error("order missing");
      const already = await isWebhookEventProcessed(paymentId, "paid");
      if (already) return "skipped";
      if (current.status !== "betaald") {
        await updateOrderStatus(order.id, "betaald", "Betaling ontvangen via Mollie.");
      }
      await recordWebhookEvent(paymentId, "paid", order.id);
      return "processed";
    }

    const first = await simulateWebhookDelivery();
    const second = await simulateWebhookDelivery();
    const third = await simulateWebhookDelivery();

    expect(first).toBe("processed");
    expect(second).toBe("skipped");
    expect(third).toBe("skipped");

    const finalOrder = await getOrderById(order.id);
    expect(finalOrder?.status).toBe("betaald");
  });
});
