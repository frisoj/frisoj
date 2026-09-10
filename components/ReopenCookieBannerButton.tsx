"use client";

import { reopenCookieBanner } from "@/lib/analytics";

export default function ReopenCookieBannerButton() {
  return (
    <button
      type="button"
      onClick={reopenCookieBanner}
      className="rounded-full bg-accent px-5 py-2.5 text-sm font-semibold text-white hover:bg-accent-dark"
    >
      Cookievoorkeuren wijzigen
    </button>
  );
}
