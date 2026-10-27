import { SkeletonBlock, SkeletonCard, SkeletonHeading, SkeletonPage } from "@/components/dashboard/Skeleton";

export default function WalletLoading() {
  return (
    <SkeletonPage>
      <SkeletonHeading />
      <div className="grid gap-2.5 sm:grid-cols-3">
        <SkeletonBlock className="h-32 rounded-2xl" />
        <SkeletonCard rows={1} />
        <SkeletonCard rows={1} />
      </div>
      <div className="grid gap-4 lg:grid-cols-2">
        <SkeletonCard rows={4} />
        <SkeletonCard rows={5} />
      </div>
    </SkeletonPage>
  );
}
