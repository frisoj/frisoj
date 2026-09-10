"use client";

import { useState } from "react";

export default function ReviewForm({ token }: { token: string }) {
  const [authorName, setAuthorName] = useState("");
  const [rating, setRating] = useState(5);
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [submitted, setSubmitted] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/reviews/submit", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token, authorName, rating, title, body }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? "Er ging iets mis.");
      } else {
        setSubmitted(true);
      }
    } catch {
      setError("Verbindingsfout. Probeer het opnieuw.");
    } finally {
      setLoading(false);
    }
  }

  if (submitted) {
    return (
      <div className="mt-8 rounded-2xl border border-border bg-surface p-6 text-center">
        <p className="font-heading text-lg font-semibold text-ink">Bedankt voor je review!</p>
        <p className="mt-2 text-sm text-ink-muted">
          We controleren nieuwe reviews voordat ze op de website verschijnen.
        </p>
      </div>
    );
  }

  return (
    <form onSubmit={handleSubmit} className="mt-8 space-y-4">
      <label className="block text-sm">
        <span className="mb-1 block font-medium text-ink">Naam (zoals getoond bij je review)</span>
        <input
          value={authorName}
          onChange={(e) => setAuthorName(e.target.value)}
          required
          className="w-full rounded-lg border border-border bg-surface px-3 py-2 text-ink"
        />
      </label>
      <fieldset>
        <legend className="mb-1 text-sm font-medium text-ink">Beoordeling</legend>
        <div className="flex gap-2">
          {[1, 2, 3, 4, 5].map((n) => (
            <label
              key={n}
              className={`flex h-10 w-10 cursor-pointer items-center justify-center rounded-full border text-sm font-semibold ${
                rating === n ? "border-accent bg-accent-tint text-accent" : "border-border text-ink-muted"
              }`}
            >
              <input type="radio" name="rating" value={n} checked={rating === n} onChange={() => setRating(n)} className="sr-only" />
              {n}
            </label>
          ))}
        </div>
      </fieldset>
      <label className="block text-sm">
        <span className="mb-1 block font-medium text-ink">Titel (optioneel)</span>
        <input value={title} onChange={(e) => setTitle(e.target.value)} className="w-full rounded-lg border border-border bg-surface px-3 py-2 text-ink" />
      </label>
      <label className="block text-sm">
        <span className="mb-1 block font-medium text-ink">Je review</span>
        <textarea value={body} onChange={(e) => setBody(e.target.value)} rows={5} className="w-full rounded-lg border border-border bg-surface px-3 py-2 text-ink" />
      </label>
      {error && <p role="alert" className="text-sm text-accent-dark">{error}</p>}
      <button
        type="submit"
        disabled={loading}
        className="rounded-full bg-accent px-6 py-3 text-sm font-semibold text-white transition-colors hover:bg-accent-dark disabled:opacity-60"
      >
        {loading ? "Bezig..." : "Review versturen"}
      </button>
    </form>
  );
}
