import type { ReactNode } from "react";

/**
 * One skeleton vocabulary for the dashboard.
 *
 * Nothing under /dashboard had a loading state, so every navigation dropped to a
 * blank pause while the server component resolved. These blocks keep the page's
 * shape on screen so the shell never disappears.
 */

export function SkeletonBlock({ className = "" }: { className?: string }) {
  return (
    <div
      aria-hidden="true"
      className={`animate-pulse rounded-xl bg-ink/[0.06] ${className}`}
    />
  );
}

export function SkeletonCard({ rows = 3, className = "" }: { rows?: number; className?: string }) {
  return (
    <div
      aria-hidden="true"
      className={`animate-pulse rounded-[1.5rem] border border-line bg-[#fffdfa] p-5 ${className}`}
    >
      <SkeletonBlock className="h-4 w-32 rounded-full" />
      <div className="mt-4 grid gap-2.5">
        {Array.from({ length: rows }).map((_, index) => (
          <SkeletonBlock key={index} className="h-10 w-full" />
        ))}
      </div>
    </div>
  );
}

export function SkeletonHeading() {
  return (
    <div aria-hidden="true" className="animate-pulse">
      <SkeletonBlock className="h-3 w-20 rounded-full" />
      <SkeletonBlock className="mt-2.5 h-6 w-56 rounded-lg" />
    </div>
  );
}

/** Wraps a skeleton page with the same spacing the real pages use. */
export function SkeletonPage({ children }: { children: ReactNode }) {
  return (
    <div className="grid gap-4" aria-busy="true" aria-live="polite">
      <span className="sr-only">Loading…</span>
      {children}
    </div>
  );
}
