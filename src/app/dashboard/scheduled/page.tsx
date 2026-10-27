import { ScheduledOrdersManager } from "./ScheduledOrdersManager";
import { requireUser } from "@/lib/auth";

export const dynamic = "force-dynamic";

export default async function ScheduledOrdersPage() {
  const user = await requireUser("/dashboard/scheduled");

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-[1.5rem] font-medium tracking-tight">Scheduled Purchases</h1>
        <p className="mt-1 text-[0.86rem] text-ink-2">
          Set up automatic recurring purchases for any service.
        </p>
      </div>
      <ScheduledOrdersManager user={user} />
    </div>
  );
}
