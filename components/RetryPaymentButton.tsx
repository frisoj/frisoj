"use client";

import { useState } from "react";

export default function RetryPaymentButton({ orderNumber, csrfToken }: { orderNumber: string; csrfToken: string }) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleClick() {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/checkout/retry", {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-csrf-token": csrfToken },
        body: JSON.stringify({ orderNumber }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? "Betalen mislukt. Probeer het opnieuw.");
        setLoading(false);
        return;
      }
      window.location.href = data.redirectUrl;
    } catch {
      setError("Verbindingsfout. Probeer het opnieuw.");
      setLoading(false);
    }
  }

  return (
    <div>
      <button
        type="button"
        onClick={handleClick}
        disabled={loading}
        className="rounded-full bg-accent px-6 py-3 text-base font-semibold text-white transition-colors hover:bg-accent-dark disabled:opacity-60"
      >
        {loading ? "Bezig..." : "Opnieuw betalen"}
      </button>
      {error && <p role="alert" className="mt-2 text-sm text-accent-dark">{error}</p>}
    </div>
  );
}
