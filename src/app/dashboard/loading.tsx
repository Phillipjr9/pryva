import { SkeletonBlock, SkeletonCard, SkeletonHeading, SkeletonPage } from "@/components/dashboard/Skeleton";

/**
 * Default loading state for every dashboard route. Route-specific files override
 * it where the real page has a distinct shape (orders, wallet).
 */
export default function DashboardLoading() {
  return (
    <SkeletonPage>
      <SkeletonHeading />
      <SkeletonCard rows={2} />
      <div className="grid gap-2.5 sm:grid-cols-2 xl:grid-cols-3">
        {[0, 1, 2].map((index) => (
          <SkeletonCard key={index} rows={2} />
        ))}
      </div>
      <SkeletonBlock className="h-24 w-full rounded-[1.5rem]" />
    </SkeletonPage>
  );
}
