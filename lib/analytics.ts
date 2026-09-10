"use client";

// Cookie consent. Phase 2 shipped `hasMarketingConsent()` as a stub reading
// a single localStorage flag; Phase 3 adds the real cookie banner
// (components/CookieBanner.tsx) that writes this same flag, so every call
// site that already gated on `hasMarketingConsent()` (conversion tracking
// below, ConversionTracker.tsx) now reflects a real, explicit user choice
// with no code changes needed on their end.
const CONSENT_KEY = "pl_marketing_consent";
export const COOKIE_BANNER_REOPEN_EVENT = "pl:open-cookie-banner";
export const COOKIE_CONSENT_CHANGED_EVENT = "pl:cookie-consent-changed";

export type ConsentValue = "granted" | "denied";

export function hasMarketingConsent(): boolean {
  if (typeof window === "undefined") return false;
  try {
    return window.localStorage.getItem(CONSENT_KEY) === "granted";
  } catch {
    return false;
  }
}

export function getStoredConsent(): ConsentValue | null {
  if (typeof window === "undefined") return null;
  try {
    const value = window.localStorage.getItem(CONSENT_KEY);
    return value === "granted" || value === "denied" ? value : null;
  } catch {
    return null;
  }
}

export function setMarketingConsent(value: ConsentValue) {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(CONSENT_KEY, value);
    window.dispatchEvent(new CustomEvent(COOKIE_CONSENT_CHANGED_EVENT, { detail: value }));
  } catch {
    // localStorage unavailable (private mode/blocked) — consent simply
    // won't persist across reloads; tracking stays off, which is the safe
    // default.
  }
}

/** Reopens the cookie banner (used by the "wijzig voorkeuren" link on /cookiebeleid). */
export function reopenCookieBanner() {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new CustomEvent(COOKIE_BANNER_REOPEN_EVENT));
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
