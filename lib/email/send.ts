import "server-only";
import { Resend } from "resend";
import { site } from "@/lib/site";
import { getOrderById, markAbandonedEmailSent, markReviewInviteSent, createReviewInvite } from "@/lib/orders";
import {
  abandonedCartEmail,
  orderConfirmationEmail,
  ownerNotificationEmail,
  reviewInviteEmail,
  shippingConfirmationEmail,
  type EmailContent,
} from "@/lib/email/templates";

// Sender address is a placeholder pending domain verification in Resend —
// see DECISIONS.md. Owner notification recipient is likewise a placeholder
// until the real owner inbox is provided.
const FROM_ADDRESS = `${site.brand} <bestellingen@${site.domain}>`;
const OWNER_EMAIL = process.env.OWNER_NOTIFICATION_EMAIL || `orders@${site.domain}`;

let cached: Resend | null | undefined;

function client(): Resend | null {
  if (!process.env.RESEND_API_KEY) return null;
  if (cached !== undefined) return cached;
  cached = new Resend(process.env.RESEND_API_KEY);
  return cached;
}

async function deliver(to: string, content: EmailContent) {
  const resend = client();
  if (!resend) {
    // No RESEND_API_KEY configured: log without any PII beyond the fact an
    // email would have been sent, so the flow is still observable/testable.
    console.info(`[email:skip] RESEND_API_KEY not set — would have sent "${content.subject}"`);
    return;
  }
  await resend.emails.send({ from: FROM_ADDRESS, to, subject: content.subject, html: content.html, text: content.text });
}

export async function sendOrderConfirmationEmail(orderId: string) {
  const order = await getOrderById(orderId);
  if (!order) return;
  await deliver(order.email, orderConfirmationEmail(order));
}

export async function sendOwnerNotificationEmail(orderId: string) {
  const order = await getOrderById(orderId);
  if (!order) return;
  await deliver(OWNER_EMAIL, ownerNotificationEmail(order));
}

export async function sendShippingConfirmationEmail(orderId: string) {
  const order = await getOrderById(orderId);
  if (!order) return;
  await deliver(order.email, shippingConfirmationEmail(order));
}

export async function sendReviewInviteEmail(orderId: string) {
  const order = await getOrderById(orderId);
  if (!order) return;
  const token = await createReviewInvite(orderId);
  const reviewUrl = `${process.env.NEXT_PUBLIC_SITE_URL ?? site.url}/beoordelen/${token}`;
  await deliver(order.email, reviewInviteEmail(order, reviewUrl));
  await markReviewInviteSent(orderId);
}

export async function sendAbandonedCartEmail(orderId: string) {
  const order = await getOrderById(orderId);
  if (!order) return;
  await deliver(order.email, abandonedCartEmail(order));
  await markAbandonedEmailSent(orderId);
}
