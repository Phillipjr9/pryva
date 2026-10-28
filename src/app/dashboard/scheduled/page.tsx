import { ScheduledOrdersManager } from "./ScheduledOrdersManager";
import { requireUser } from "@/lib/auth";
import { isPreviewDatabase } from "@/lib/demo-policy";

export const dynamic = "force-dynamic";

export default async function ScheduledOrdersPage() {
  const user = await requireUser("/dashboard/scheduled");

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-[1.5rem] font-medium tracking-tight text-ink sm:text-[1.7rem]">Scheduled Purchases</h1>
        <p className="mt-1 text-[0.86rem] text-ink-2">
          Explore recurring order schedules in preview mode.
        </p>
      </div>
      <ScheduledOrdersManager user={user} preview={isPreviewDatabase()} />
    </div>
  );
}
