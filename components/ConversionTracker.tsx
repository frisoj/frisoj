"use client";

import { useEffect } from "react";
import { hasMarketingConsent, trackPurchase } from "@/lib/analytics";

export default function ConversionTracker({
  orderNumber,
  totalCents,
  alreadyTracked,
}: {
  orderNumber: string;
  totalCents: number;
  alreadyTracked: boolean;
}) {
  useEffect(() => {
    if (alreadyTracked) return;
    if (!hasMarketingConsent()) return;

    trackPurchase({ orderNumber, valueEuros: totalCents / 100, currency: "EUR" });

    fetch("/api/orders/track-conversion", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ orderNumber }),
    }).catch(() => {
      // Best-effort: if this fails, the next page view will retry (the
      // server-side `alreadyTracked` flag is the real source of truth, not
      // this fetch succeeding).
    });
  }, [orderNumber, totalCents, alreadyTracked]);

  return null;
}
