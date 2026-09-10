"use client";

// Cookie-consent stub. The real cookie banner is Phase 3 scope (see
// DECISIONS.md) — this stub reads a single localStorage flag so the
// conversion-tracking code (GA4/Meta/TikTok Purchase events) already has a
// concrete gate to call, and swapping in a real consent-management banner
// later only means changing this one function's implementation.
export function hasMarketingConsent(): boolean {
  if (typeof window === "undefined") return false;
  try {
    return window.localStorage.getItem("pl_marketing_consent") === "granted";
  } catch {
    return false;
  }
}

type PurchasePayload = {
  orderNumber: string;
  valueEuros: number;
  currency: string;
};

declare global {
  interface Window {
    gtag?: (...args: unknown[]) => void;
    fbq?: (...args: unknown[]) => void;
    ttq?: { track?: (...args: unknown[]) => void };
  }
}

/** Fires GA4 `purchase`, Meta `Purchase` and TikTok `Purchase` — call only once per order, only after consent. */
export function trackPurchase({ orderNumber, valueEuros, currency }: PurchasePayload) {
  if (typeof window === "undefined") return;

  if (process.env.NEXT_PUBLIC_GA4_ID && window.gtag) {
    window.gtag("event", "purchase", { transaction_id: orderNumber, value: valueEuros, currency });
  }
  if (process.env.NEXT_PUBLIC_META_PIXEL_ID && window.fbq) {
    window.fbq("track", "Purchase", { value: valueEuros, currency, content_ids: [orderNumber] });
  }
  if (process.env.NEXT_PUBLIC_TIKTOK_PIXEL_ID && window.ttq?.track) {
    window.ttq.track("Purchase", { value: valueEuros, currency, content_id: orderNumber });
  }
}
