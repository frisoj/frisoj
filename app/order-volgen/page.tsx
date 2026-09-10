"use client";

import { useState } from "react";

type LookupResult = {
  orderNumber: string;
  status: string;
  statusLabel: string;
  trackAndTraceCode: string | null;
  carrier: string | null;
};

export default function OrderTrackingPage() {
  const [orderNumber, setOrderNumber] = useState("");
  const [email, setEmail] = useState("");
  const [result, setResult] = useState<LookupResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError(null);
    setResult(null);
    try {
      const res = await fetch("/api/orders/lookup", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ orderNumber, email }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? "Er ging iets mis.");
      } else {
        setResult(data);
      }
    } catch {
      setError("Verbindingsfout. Probeer het opnieuw.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="mx-auto max-w-xl px-4 py-14 sm:py-20">
      <h1 className="font-heading text-3xl font-semibold text-ink sm:text-4xl">Order volgen</h1>
      <p className="mt-3 text-ink-muted">Vul je ordernummer en e-mailadres in om de status van je bestelling te bekijken.</p>

      <form onSubmit={handleSubmit} className="mt-8 space-y-4">
        <label className="block text-sm">
          <span className="mb-1 block font-medium text-ink">Ordernummer</span>
          <input
            value={orderNumber}
            onChange={(e) => setOrderNumber(e.target.value)}
            placeholder="KB-2026-000123"
            required
            className="w-full rounded-lg border border-border bg-surface px-3 py-2 text-ink"
          />
        </label>
        <label className="block text-sm">
          <span className="mb-1 block font-medium text-ink">E-mailadres</span>
          <input
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required
            className="w-full rounded-lg border border-border bg-surface px-3 py-2 text-ink"
          />
        </label>
        <button
          type="submit"
          disabled={loading}
          className="w-full rounded-full bg-accent px-6 py-3 text-base font-semibold text-white transition-colors hover:bg-accent-dark disabled:opacity-60"
        >
          {loading ? "Bezig..." : "Bekijk status"}
        </button>
      </form>

      {error && (
        <p role="alert" className="mt-6 rounded-xl border border-accent bg-accent-tint px-4 py-3 text-sm text-accent-dark">
          {error}
        </p>
      )}

      {result && (
        <div className="mt-6 rounded-2xl border border-border bg-surface p-6">
          <p className="text-sm text-ink-muted">Bestelling</p>
          <p className="font-heading text-lg font-semibold text-ink">{result.orderNumber}</p>
          <p className="mt-2 text-ink">
            Status: <strong>{result.statusLabel}</strong>
          </p>
          {result.trackAndTraceCode && (
            <p className="mt-2 text-sm text-ink-muted">
              Track & trace: {result.carrier ? `${result.carrier} — ` : ""}
              {result.trackAndTraceCode}
            </p>
          )}
        </div>
      )}
    </div>
  );
}
