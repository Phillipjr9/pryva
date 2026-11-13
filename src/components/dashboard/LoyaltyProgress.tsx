import { LOYALTY_LEVELS, type LoyaltyLevel } from "@/lib/services/loyalty-policy";

export type LoyaltyProgressData = { eligibleOrders: number; current: LoyaltyLevel; next: LoyaltyLevel | null; remaining: number };

/** Tracking preview only: discounts are not yet connected to any checkout. */
export function LoyaltyProgress({ progress }: { progress: LoyaltyProgressData | null }) {
  if (!progress) return null;
  const start = progress.current.minimumOrders;
  const end = progress.next?.minimumOrders ?? start;
  const percentage = progress.next ? Math.min(100, Math.max(0, ((progress.eligibleOrders - start) / (end - start)) * 100)) : 100;
  return (
    <section aria-labelledby="loyalty-title" className="rounded-[1.5rem] border border-lav-200 bg-lav-50/60 p-4 sm:p-5">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <p className="text-micro font-bold uppercase tracking-[0.16em] text-lav-700">Loyalty progress · preview</p>
          <h2 id="loyalty-title" className="mt-1 text-[1rem] font-semibold text-ink">Level {progress.current.level} of {LOYALTY_LEVELS.length}</h2>
        </div>
        <span className="rounded-full bg-white px-3 py-1 text-meta font-semibold text-ink-2">{progress.eligibleOrders} eligible {progress.eligibleOrders === 1 ? "order" : "orders"}</span>
      </div>
      <div role="progressbar" aria-label="Progress to next loyalty level" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(percentage)} className="mt-3 h-2 overflow-hidden rounded-full bg-lav-100">
        <div className="h-full rounded-full bg-lav-600" style={{ width: `${percentage}%` }} />
      </div>
      <p className="mt-2 text-meta text-ink-2">{progress.next ? `${progress.remaining} more eligible ${progress.remaining === 1 ? "order" : "orders"} to Level ${progress.next.level}.` : "You have reached the highest level."}</p>
      <p className="mt-1 text-meta leading-relaxed text-ink-3">Only eligible completed purchases of at least ₦500 after launch count. Bulk units count individually when eligible; refunded purchases are removed. Discounts are not available yet.</p>
    </section>
  );
}
