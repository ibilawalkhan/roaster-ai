"use client";

// Root error boundary — the last line of defence (REQUIREMENTS.md §9).
//
// `error.tsx` cannot catch a failure in the root layout itself; this can, and
// it REPLACES that layout when it fires. So it must supply its own <html> and
// <body>, and it cannot rely on the app's providers, fonts or components —
// anything imported from the layout might be exactly what crashed. Everything
// here is therefore deliberately self-contained with inline styles.

import { useEffect } from "react";
import * as Sentry from "@sentry/nextjs";
import { SENTRY_ENABLED } from "@/lib/observability/sentry-options";

export default function GlobalError({
  error,
  unstable_retry,
}: {
  error: Error & { digest?: string };
  unstable_retry: () => void;
}) {
  useEffect(() => {
    if (SENTRY_ENABLED) Sentry.captureException(error);
    else console.error(error);
  }, [error]);

  return (
    <html lang="en-AU">
      <body
        style={{
          margin: 0,
          minHeight: "100vh",
          display: "grid",
          placeItems: "center",
          padding: "24px",
          background: "#faf7f2",
          color: "#241f1c",
          fontFamily:
            "system-ui, -apple-system, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif",
        }}
      >
        <title>Something went wrong · Rosterly</title>
        <main
          style={{
            width: "100%",
            maxWidth: 420,
            background: "#fff",
            border: "1px solid #e7ded2",
            borderRadius: 16,
            padding: 28,
            textAlign: "center",
            boxShadow: "0 1px 2px rgba(36,31,28,0.05)",
          }}
        >
          <h1 style={{ margin: 0, fontSize: 20, fontWeight: 600 }}>
            Rosterly hit a problem
          </h1>
          <p style={{ margin: "10px 0 0", fontSize: 14, lineHeight: 1.6, color: "#6b615a" }}>
            The app couldn&rsquo;t start. Your roster is safe — nothing has been changed.
            Try reloading; if it keeps happening, please get in touch.
          </p>

          <button
            onClick={() => unstable_retry()}
            style={{
              marginTop: 22,
              minHeight: 44,
              width: "100%",
              padding: "0 20px",
              fontSize: 15,
              fontWeight: 600,
              color: "#fff",
              background: "#d75321",
              border: "none",
              borderRadius: 11,
              cursor: "pointer",
            }}
          >
            Try again
          </button>

          {error.digest && (
            <p style={{ margin: "18px 0 0", fontSize: 12, color: "#9b918a" }}>
              Reference: {error.digest}
            </p>
          )}
        </main>
      </body>
    </html>
  );
}
