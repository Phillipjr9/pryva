import { SkeletonBlock, SkeletonCard, SkeletonPage } from "@/components/dashboard/Skeleton";

/**
 * Mirrors the overview's real order: the balance card first, then whatever is on
 * a timer, then the lists. The previous skeleton opened with a heading block, so
 * the page appeared to start with something other than the balance and then
 * jumped when the real content streamed in.
 */
export default function DashboardLoading() {
  return (
    <SkeletonPage>
      <div className="animate-pulse rounded-[1.75rem] border border-ink bg-ink p-5 sm:p-6">
        <SkeletonBlock className="h-3 w-32 rounded-full bg-white/15" />
        <SkeletonBlock className="mt-3 h-9 w-44 rounded-xl bg-white/20" />
        <div className="mt-5 grid grid-cols-3 gap-2 border-t border-white/10 pt-4">
          {[0, 1, 2].map((index) => (
            <div key={index}>
              <SkeletonBlock className="h-2.5 w-14 rounded-full bg-white/15" />
              <SkeletonBlock className="mt-2 h-4 w-16 rounded-md bg-white/20" />
            </div>
          ))}
        </div>
        <div className="mt-4 flex gap-2">
          <SkeletonBlock className="h-9 w-24 rounded-full bg-white/20" />
          <SkeletonBlock className="h-9 w-28 rounded-full bg-white/15" />
        </div>
      </div>

      <SkeletonCard rows={2} />

      <div className="grid min-w-0 grid-cols-1 gap-4 lg:grid-cols-[minmax(0,1.25fr)_minmax(0,0.75fr)]">
        <SkeletonCard rows={4} />
        <SkeletonCard rows={4} />
      </div>
    </SkeletonPage>
  );
}
