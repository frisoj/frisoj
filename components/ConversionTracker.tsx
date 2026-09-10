"use client";

import { useEffect } from "react";
import { hasMarketingConsent, trackPurchase } from "@/lib/analytics";

export default function ConversionTracker({
  orderId,
  orderNumber,
  totalCents,
  alreadyTracked,
}: {
  orderId: string;
  orderNumber: string;
  totalCents: number;
  alreadyTracked: boolean;
}) {
  useEffect(() => {
    if (alreadyTracked) return;
    if (!hasMarketingConsent()) return;

    // Marketing pixels get the human-facing order number (used for
    // reconciliation/refund matching in ad platforms); the API call below
    // uses the unguessable order id, since order_number alone must not be
    // usable to look up/flip state on someone else's order.
    trackPurchase({ orderNumber, valueEuros: totalCents / 100, currency: "EUR" });

    fetch("/api/orders/track-conversion", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ orderId }),
    }).catch(() => {
      // Best-effort: if this fails, the next page view will retry (the
      // server-side `alreadyTracked` flag is the real source of truth, not
      // this fetch succeeding).
    });
  }, [orderId, orderNumber, totalCents, alreadyTracked]);

  return null;
}
