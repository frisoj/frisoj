"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { getSupabaseBrowserClient } from "@/lib/supabase/browser";

export default function AdminLoginPage() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const configured = Boolean(process.env.NEXT_PUBLIC_SUPABASE_URL && process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError(null);
    const supabase = getSupabaseBrowserClient();
    const { error: signInError } = await supabase.auth.signInWithPassword({ email, password });
    setLoading(false);
    if (signInError) {
      setError("Inloggen mislukt. Controleer je e-mailadres en wachtwoord.");
      return;
    }
    router.push("/admin/orders");
    router.refresh();
  }

  return (
    <div className="mx-auto flex min-h-[70vh] max-w-sm items-center px-4">
      <div className="w-full rounded-2xl border border-border bg-surface p-8">
        <h1 className="font-heading text-2xl font-semibold text-ink">Admin inloggen</h1>

        {!configured && (
          <p className="mt-4 rounded-lg border border-accent bg-accent-tint px-3 py-2 text-sm text-accent-dark">
            Er is nog geen Supabase-project gekoppeld (NEXT_PUBLIC_SUPABASE_URL /
            NEXT_PUBLIC_SUPABASE_ANON_KEY ontbreken). Inloggen werkt pas zodra dat is ingesteld — zie
            DECISIONS.md.
          </p>
        )}

        <form onSubmit={handleSubmit} className="mt-6 space-y-4">
          <label className="block text-sm">
            <span className="mb-1 block font-medium text-ink">E-mailadres</span>
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
              className="w-full rounded-lg border border-border bg-cream px-3 py-2 text-ink"
            />
          </label>
          <label className="block text-sm">
            <span className="mb-1 block font-medium text-ink">Wachtwoord</span>
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
              className="w-full rounded-lg border border-border bg-cream px-3 py-2 text-ink"
            />
          </label>
          {error && <p role="alert" className="text-sm text-accent-dark">{error}</p>}
          <button
            type="submit"
            disabled={loading || !configured}
            className="w-full rounded-full bg-accent px-6 py-3 text-sm font-semibold text-white transition-colors hover:bg-accent-dark disabled:opacity-60"
          >
            {loading ? "Bezig..." : "Inloggen"}
          </button>
        </form>
      </div>
    </div>
  );
}
