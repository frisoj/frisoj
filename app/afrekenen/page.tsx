import type { Metadata } from "next";
import { getOrCreateCsrfToken } from "@/lib/csrf";
import CheckoutForm from "@/components/CheckoutForm";

export const metadata: Metadata = {
  title: "Afrekenen",
  robots: { index: false, follow: false },
};

export default async function CheckoutPage() {
  const csrfToken = await getOrCreateCsrfToken();
  return <CheckoutForm csrfToken={csrfToken} />;
}
