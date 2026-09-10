"use client";

import { useEffect } from "react";
import { reportError } from "@/lib/error-reporting";

// Last-resort error boundary: only used if the root layout itself throws
// (rare — a normal page error is caught by app/error.tsx instead, which
// keeps the header/footer). Next.js requires this file to render its own
// complete <html>/<body> since the root layout may be the thing that
// failed. Deliberately plain inline styles, not Tailwind classes/globals.css
// — this is the fallback for when something upstream of normal styling
// already went wrong, so it must not depend on anything else working.
export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    reportError(error, { boundary: "global" });
  }, [error]);

  return (
    <html lang="nl">
      <body
        style={{
          margin: 0,
          minHeight: "100vh",
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
          padding: "2rem",
          fontFamily: "system-ui, sans-serif",
          background: "#faf7f2",
          color: "#241f1a",
          textAlign: "center",
        }}
      >
        <h1 style={{ fontSize: "1.5rem", fontWeight: 600 }}>Er ging iets mis</h1>
        <p style={{ marginTop: "0.75rem", color: "#6b6459", maxWidth: "32rem" }}>
          De site kon niet worden geladen. Probeer de pagina te vernieuwen.
        </p>
        <button
          type="button"
          onClick={reset}
          style={{
            marginTop: "1.5rem",
            borderRadius: "9999px",
            background: "#b0502d",
            color: "#fff",
            padding: "0.75rem 1.5rem",
            fontWeight: 600,
            border: "none",
            cursor: "pointer",
          }}
        >
          Probeer opnieuw
        </button>
        {error.digest && (
          <p style={{ marginTop: "1rem", fontSize: "0.875rem", color: "#6b6459" }}>
            Referentie: {error.digest}
          </p>
        )}
      </body>
    </html>
  );
}
