"use client";

import { useState } from "react";
import { contactFormSchema } from "@/lib/validation/contact";

type FieldErrors = Record<string, string>;

export default function ContactForm({ csrfToken }: { csrfToken: string }) {
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [orderNumber, setOrderNumber] = useState("");
  const [message, setMessage] = useState("");
  const [honeypot, setHoneypot] = useState("");
  const [errors, setErrors] = useState<FieldErrors>({});
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [sent, setSent] = useState(false);

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    setSubmitError(null);

    const parsed = contactFormSchema.safeParse({ name, email, orderNumber, message, honeypot });
    if (!parsed.success) {
      const fieldErrors: FieldErrors = {};
      for (const issue of parsed.error.issues) {
        const key = issue.path.join(".");
        if (!fieldErrors[key]) fieldErrors[key] = issue.message;
      }
      setErrors(fieldErrors);
      return;
    }
    setErrors({});
    setSubmitting(true);
    try {
      const res = await fetch("/api/contact", {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-csrf-token": csrfToken },
        body: JSON.stringify(parsed.data),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => null);
        setSubmitError(data?.error ?? "Er ging iets mis. Probeer het later opnieuw.");
        return;
      }
      setSent(true);
    } catch {
      setSubmitError("Er ging iets mis. Probeer het later opnieuw.");
    } finally {
      setSubmitting(false);
    }
  }

  if (sent) {
    return (
      <div role="status" className="rounded-2xl border border-border bg-accent-tint p-6 text-ink">
        <p className="font-heading text-lg font-semibold">Bedankt voor je bericht!</p>
        <p className="mt-2 text-sm text-ink-muted">
          We reageren binnen 1-2 werkdagen op je e-mailadres.
        </p>
      </div>
    );
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-5" noValidate>
      {/* Honeypot field: hidden from real visitors via CSS, not `type=hidden`
          (some bots skip those), and never disclosed as a spam trap. */}
      <div className="absolute left-[-9999px]" aria-hidden="true">
        <label htmlFor="website">Website</label>
        <input
          id="website"
          name="website"
          tabIndex={-1}
          autoComplete="off"
          value={honeypot}
          onChange={(e) => setHoneypot(e.target.value)}
        />
      </div>

      <div>
        <label htmlFor="name" className="block text-sm font-medium text-ink">
          Naam
        </label>
        <input
          id="name"
          name="name"
          value={name}
          onChange={(e) => setName(e.target.value)}
          className="mt-1 w-full rounded-lg border border-border bg-surface px-3 py-2 text-ink"
        />
        {errors.name && <p className="mt-1 text-sm text-red-700">{errors.name}</p>}
      </div>

      <div>
        <label htmlFor="email" className="block text-sm font-medium text-ink">
          E-mailadres
        </label>
        <input
          id="email"
          name="email"
          type="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          className="mt-1 w-full rounded-lg border border-border bg-surface px-3 py-2 text-ink"
        />
        {errors.email && <p className="mt-1 text-sm text-red-700">{errors.email}</p>}
      </div>

      <div>
        <label htmlFor="orderNumber" className="block text-sm font-medium text-ink">
          Ordernummer <span className="text-ink-muted">(optioneel)</span>
        </label>
        <input
          id="orderNumber"
          name="orderNumber"
          value={orderNumber}
          onChange={(e) => setOrderNumber(e.target.value)}
          placeholder="KB-2026-482913"
          className="mt-1 w-full rounded-lg border border-border bg-surface px-3 py-2 text-ink"
        />
      </div>

      <div>
        <label htmlFor="message" className="block text-sm font-medium text-ink">
          Bericht
        </label>
        <textarea
          id="message"
          name="message"
          rows={5}
          value={message}
          onChange={(e) => setMessage(e.target.value)}
          className="mt-1 w-full rounded-lg border border-border bg-surface px-3 py-2 text-ink"
        />
        {errors.message && <p className="mt-1 text-sm text-red-700">{errors.message}</p>}
      </div>

      {submitError && <p className="text-sm text-red-700">{submitError}</p>}

      <button
        type="submit"
        disabled={submitting}
        className="w-full rounded-full bg-accent px-6 py-3 text-sm font-semibold text-white transition-colors hover:bg-accent-dark disabled:opacity-60 sm:w-auto"
      >
        {submitting ? "Versturen..." : "Verstuur bericht"}
      </button>
    </form>
  );
}
