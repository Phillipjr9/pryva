"use client";

import { useEffect } from "react";
import Link from "next/link";

/** Unexpected rendering errors are distinct from an unavailable catalogue feed. */
export default function ServicesError({ error, retry }: { error: unknown; retry: () => void }) {
  const digest = error instanceof Error && "digest" in error && typeof error.digest === "string" && /^[a-z0-9_-]{1,64}$/i.test(error.digest)
    ? error.digest : null;
  useEffect(() => {
    // Raw errors can contain private upstream or customer data. The digest, when
    // present, can be matched to the server log without displaying those details.
    console.error("Service page failed to render", { digest });
  }, [digest]);

  return (
    <section role="alert" className="rounded-2xl border border-amber-200 bg-amber-50 p-5 text-ink">
      <h1 className="text-lg font-semibold">We couldn’t load this page</h1>
      <p className="mt-2 text-sm">Try again, or return to your dashboard. If this keeps happening, contact support and share the page and time.</p>
      {digest && <p className="mt-2 text-sm">Reference: {digest}</p>}
      <div className="mt-4 flex flex-wrap items-center gap-4">
        <button type="button" onClick={retry} className="rounded-xl bg-lav-700 px-4 py-2 font-semibold text-white">Try again</button>
        <Link href="/dashboard" className="font-semibold text-lav-700 underline">Back to dashboard</Link>
      </div>
    </section>
  );
}
