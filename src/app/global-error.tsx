"use client";

import Link from "next/link";

/** A self-contained fallback for failures in the root layout itself. */
export default function GlobalError({ reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <html lang="en">
      <body style={{ margin: 0, background: "#faf7f1", color: "#242132", fontFamily: "system-ui, sans-serif" }}>
        <main style={{ minHeight: "100vh", display: "grid", placeItems: "center", padding: "24px", boxSizing: "border-box" }}>
          <div role="alert" style={{ maxWidth: "480px", padding: "28px", border: "1px solid #e5e0ea", borderRadius: "24px", background: "white" }}>
            <strong>Pryva</strong>
            <h1>We couldn&apos;t load this page</h1>
            <p style={{ lineHeight: 1.6 }}>
              Please try loading it again. If you just placed an order, check your orders and wallet or contact support before placing another.
            </p>
            <button type="button" onClick={reset} style={{ background: "#6d48be", color: "white", padding: "12px 18px", border: 0, borderRadius: "12px", cursor: "pointer" }}>Try loading again</button>{" "}
            <Link href="/" style={{ color: "#6d48be", marginLeft: "8px" }}>Back home</Link>
          </div>
        </main>
      </body>
    </html>
  );
}
