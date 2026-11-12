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
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <SkeletonBlock className="h-3 w-32 rounded-full bg-white/15" />
            <SkeletonBlock className="mt-3 h-9 w-44 rounded-xl bg-white/20" />
            <SkeletonBlock className="mt-3 h-3 w-48 rounded-full bg-white/15" />
          </div>
          <div className="flex w-full gap-2 sm:w-auto">
            <SkeletonBlock className="h-9 flex-1 rounded-full bg-white/20 sm:w-24 sm:flex-none" />
            <SkeletonBlock className="h-9 flex-1 rounded-full bg-white/15 sm:w-28 sm:flex-none" />
          </div>
        </div>
        <div className="mt-5 flex flex-wrap items-end justify-between gap-4 border-t border-white/10 pt-4">
          <div className="flex items-center gap-3">
            <SkeletonBlock className="h-10 w-10 rounded-xl bg-white/15" />
            <div>
              <SkeletonBlock className="h-3 w-24 rounded-full bg-white/15" />
              <SkeletonBlock className="mt-2 h-2.5 w-20 rounded-full bg-white/10" />
            </div>
          </div>
          <SkeletonBlock className="h-3 w-40 rounded-full bg-white/15" />
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
