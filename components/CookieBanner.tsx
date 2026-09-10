"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import {
  COOKIE_BANNER_REOPEN_EVENT,
  getStoredConsent,
  setMarketingConsent,
} from "@/lib/analytics";

// Minimal real cookie-consent banner. Functional cookies (cart, CSRF token,
// Supabase Auth session for /admin) are always active — they're strictly
// necessary and not subject to consent under the ePrivacy rules this site
// follows. Only marketing/analytics cookies (GA4, Meta, Meta/TikTok pixels,
// purchase conversion tracking) are gated behind an explicit choice here,
// via lib/analytics.ts's `hasMarketingConsent()` — nothing marketing-related
// fires before the visitor accepts.
export default function CookieBanner() {
  // Starts hidden so server-rendered HTML never shows the banner (avoids a
  // hydration mismatch against the visitor's real, client-only
  // localStorage value); the mount effect below reveals it a tick later
  // only if no consent choice has been stored yet. That one extra render is
  // an intentional, unavoidable trade-off for a client-only "have we asked
  // this visitor before?" check.
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    // Reading localStorage (an external system) is only possible after
    // mount, so this genuinely needs a one-time setState-in-effect here.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (getStoredConsent() === null) setVisible(true);
    const reopen = () => setVisible(true);
    window.addEventListener(COOKIE_BANNER_REOPEN_EVENT, reopen);
    return () => window.removeEventListener(COOKIE_BANNER_REOPEN_EVENT, reopen);
  }, []);

  if (!visible) return null;

  function choose(value: "granted" | "denied") {
    setMarketingConsent(value);
    setVisible(false);
  }

  return (
    <div
      role="dialog"
      aria-label="Cookievoorkeuren"
      aria-modal="false"
      className="fixed inset-x-0 bottom-0 z-50 border-t border-border bg-surface p-4 shadow-[0_-4px_16px_rgba(0,0,0,0.08)] sm:p-6"
    >
      <div className="mx-auto flex max-w-4xl flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <p className="text-sm text-ink-muted">
          We gebruiken noodzakelijke cookies om de site te laten werken (o.a.
          winkelwagen). Met jouw toestemming gebruiken we ook analytische en
          marketingcookies om bezoek en aankopen te meten. Lees ons{" "}
          <Link href="/cookiebeleid" className="text-accent underline hover:text-accent-dark">
            cookiebeleid
          </Link>
          .
        </p>
        <div className="flex flex-shrink-0 gap-2">
          <button
            type="button"
            onClick={() => choose("denied")}
            className="rounded-full border border-border px-4 py-2 text-sm font-semibold text-ink hover:border-accent hover:text-accent"
          >
            Alleen noodzakelijk
          </button>
          <button
            type="button"
            onClick={() => choose("granted")}
            className="rounded-full bg-accent px-4 py-2 text-sm font-semibold text-white hover:bg-accent-dark"
          >
            Accepteren
          </button>
        </div>
      </div>
    </div>
  );
}
