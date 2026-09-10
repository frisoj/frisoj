import "server-only";
import createMollieClient from "@mollie/api-client";
import type { PaymentMethod as CheckoutPaymentMethod } from "@/lib/validation/checkout";

// Server-only Mollie client. MOLLIE_API_KEY is a secret — the client is
// never imported from a client component, and no Mollie call happens
// outside route handlers / server actions (see app/api/mollie/webhook and
// app/api/checkout/route.ts).

let cached: ReturnType<typeof createMollieClient> | null | undefined;

export function isMollieConfigured(): boolean {
  return Boolean(process.env.MOLLIE_API_KEY);
}

export function getMollieClient() {
  if (!isMollieConfigured()) return null;
  if (cached !== undefined) return cached;
  cached = createMollieClient({ apiKey: process.env.MOLLIE_API_KEY! });
  return cached;
}

// Map our checkout payment-method values to Mollie's method identifiers.
// https://docs.mollie.com/reference/payment-methods
const methodMap: Record<CheckoutPaymentMethod, string> = {
  ideal: "ideal",
  bancontact: "bancontact",
  klarna: "klarna",
  creditcard: "creditcard",
  applepay: "applepay",
};

export function toMollieMethod(method: CheckoutPaymentMethod): string {
  return methodMap[method];
}
