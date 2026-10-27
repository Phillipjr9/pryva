import { SkeletonBlock, SkeletonHeading, SkeletonPage } from "@/components/dashboard/Skeleton";

export default function OrdersLoading() {
  return (
    <SkeletonPage>
      <SkeletonHeading />
      <div className="flex gap-1.5">
        {[0, 1, 2].map((index) => (
          <SkeletonBlock key={index} className="h-8 w-24 rounded-full" />
        ))}
      </div>
      <div className="animate-pulse rounded-[1.5rem] border border-line bg-[#fffdfa] p-4">
        <div className="grid gap-3">
          {[0, 1, 2, 3, 4].map((index) => (
            <div key={index} className="flex items-center justify-between gap-4">
              <div className="grid flex-1 gap-1.5">
                <SkeletonBlock className="h-3.5 w-40 rounded-full" />
                <SkeletonBlock className="h-2.5 w-28 rounded-full" />
              </div>
              <SkeletonBlock className="h-3.5 w-16 rounded-full" />
              <SkeletonBlock className="h-5 w-16 rounded-full" />
            </div>
          ))}
        </div>
      </div>
    </SkeletonPage>
  );
}
