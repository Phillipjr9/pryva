"use client";

import Link from "next/link";

/** Next logs the underlying exception; customers see only the next safe step. */
export default function PageError({ reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <main className="grid min-h-[55vh] place-items-center px-5 py-12">
      <div role="alert" className="w-full max-w-lg rounded-[1.5rem] border border-line bg-white p-6 shadow-[var(--shadow-card)] sm:p-8">
        <p className="eyebrow">Pryva</p>
        <h1 className="mt-2 text-2xl font-semibold text-ink">We couldn&apos;t load this page</h1>
        <p className="mt-3 text-sm leading-relaxed text-ink-2">
          Please try loading it again. If you just placed an order, check your orders and wallet or contact support before placing another.
        </p>
        <div className="mt-6 flex flex-wrap gap-3">
          <button type="button" onClick={reset} className="btn btn-primary">Try loading again</button>
          <Link href="/" className="btn btn-ghost">Back home</Link>
        </div>
      </div>
    </main>
  );
}
