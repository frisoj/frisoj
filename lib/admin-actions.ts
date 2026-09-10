"use server";

import { revalidatePath } from "next/cache";
import { getOrderById, updateOrderStatus, setTrackAndTrace, listAllReviews, setReviewPublished } from "@/lib/orders";
import { sendShippingConfirmationEmail } from "@/lib/email/send";
import { getMollieClient } from "@/lib/mollie";
import type { OrderStatus } from "@/lib/supabase/types";
import { assertValidStatusTransition } from "@/lib/order-transitions";

// Admin server actions. All of these run only on the server, using the
// service-role Supabase client (lib/orders.ts) — never exposed to the
// browser. Access to /admin (and therefore to these actions being
// reachable at all) is already gated by middleware.ts.

export async function changeOrderStatusAction(formData: FormData) {
  const orderId = String(formData.get("orderId"));
  const nextStatus = String(formData.get("nextStatus")) as OrderStatus;

  const order = await getOrderById(orderId);
  if (!order) throw new Error("Bestelling niet gevonden.");

  assertValidStatusTransition(order.status, nextStatus);

  const extra = nextStatus === "geleverd" ? { delivered_at: new Date().toISOString() } : undefined;
  await updateOrderStatus(orderId, nextStatus, "Handmatig gewijzigd via admin.", extra);
  revalidatePath(`/admin/orders/${orderId}`);
  revalidatePath("/admin/orders");
}

export async function saveTrackAndTraceAction(formData: FormData) {
  const orderId = String(formData.get("orderId"));
  const code = String(formData.get("trackAndTraceCode") ?? "").trim();
  const carrier = String(formData.get("carrier") ?? "").trim();
  if (!code || !carrier) throw new Error("Vul zowel track & trace code als vervoerder in.");

  await setTrackAndTrace(orderId, code, carrier);
  revalidatePath(`/admin/orders/${orderId}`);
}

export async function sendShippingEmailAction(formData: FormData) {
  const orderId = String(formData.get("orderId"));
  await sendShippingConfirmationEmail(orderId);
  revalidatePath(`/admin/orders/${orderId}`);
}

export async function refundOrderAction(formData: FormData) {
  const orderId = String(formData.get("orderId"));
  const amountEuros = String(formData.get("amount") ?? "").trim();

  const order = await getOrderById(orderId);
  if (!order) throw new Error("Bestelling niet gevonden.");
  if (!order.mollie_payment_id) throw new Error("Deze bestelling heeft geen Mollie-betaling om terug te betalen.");

  const mollie = getMollieClient();
  if (!mollie) throw new Error("Mollie is niet geconfigureerd.");

  const amount = amountEuros ? amountEuros : (order.total_cents / 100).toFixed(2);

  await mollie.paymentRefunds.create({
    paymentId: order.mollie_payment_id,
    amount: { currency: "EUR", value: Number(amount).toFixed(2) },
  });

  await updateOrderStatus(orderId, "terugbetaald", `Terugbetaling van €${amount} gestart via admin.`);
  revalidatePath(`/admin/orders/${orderId}`);
}

export async function approveReviewAction(formData: FormData) {
  const reviewId = String(formData.get("reviewId"));
  await setReviewPublished(reviewId, true);
  revalidatePath("/admin/reviews");
}

export async function rejectReviewAction(formData: FormData) {
  const reviewId = String(formData.get("reviewId"));
  await setReviewPublished(reviewId, false);
  revalidatePath("/admin/reviews");
}

export async function getReviewsForAdmin() {
  return listAllReviews();
}
