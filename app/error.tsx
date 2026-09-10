"use client";

import { useEffect } from "react";
import Link from "next/link";
import { site } from "@/lib/site";
import { reportError } from "@/lib/error-reporting";

// Route-segment error boundary: catches an error thrown while rendering
// any page under the root layout (header/footer/cart drawer still render
// normally) and shows a calm, on-brand recovery page instead of Next's
// default "Application error" screen — no stack trace, digest, or other
// internal detail is shown to the visitor. The digest IS logged
// server-side (via reportError) so the owner/developer can find the
// matching server log entry without exposing it publicly.
export default function ErrorBoundary({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    reportError(error, { boundary: "route" });
  }, [error]);

  return (
    <div className="mx-auto flex max-w-2xl flex-col items-center px-4 py-20 text-center">
      <p className="font-heading text-6xl font-semibold text-accent">!</p>
      <h1 className="mt-4 font-heading text-2xl font-semibold text-ink">Er ging iets mis</h1>
      <p className="mt-3 text-ink-muted">
        Deze pagina kon niet worden geladen. Probeer het opnieuw, of mail ons als het probleem
        blijft bestaan.
      </p>

      <div className="mt-8 flex flex-wrap justify-center gap-3">
        <button
          type="button"
          onClick={reset}
          className="rounded-full bg-accent px-6 py-3 text-sm font-semibold text-white transition-colors hover:bg-accent-dark"
        >
          Probeer opnieuw
        </button>
        <Link
          href="/"
          className="rounded-full border border-border px-6 py-3 text-sm font-semibold text-ink hover:border-accent hover:text-accent"
        >
          Naar de homepage
        </Link>
      </div>

      <p className="mt-8 text-sm text-ink-muted">
        Blijft dit gebeuren? Mail{" "}
        <a href={`mailto:${site.email}`} className="text-accent underline hover:text-accent-dark">
          {site.email}
        </a>
        {error.digest && <> (referentie: {error.digest})</>}.
      </p>
    </div>
  );
}
