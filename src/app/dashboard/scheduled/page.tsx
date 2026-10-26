import { redirect } from "next/navigation";
import { requireAuth } from "@/lib/auth";
import { DashboardShell } from "@/components/dashboard/DashboardShell";
import { ScheduledOrdersManager } from "./ScheduledOrdersManager";

export default async function ScheduledOrdersPage() {
  const user = await requireAuth();
  if (!user) redirect("/login?next=/dashboard/scheduled");

  return (
    <DashboardShell user={user}>
      <div className="space-y-6">
        <div>
          <h1 className="text-[1.75rem] font-medium tracking-tight text-ink dark:text-gray-100">
            Scheduled Purchases
          </h1>
          <p className="mt-2 text-[0.95rem] text-ink-2 dark:text-gray-400">
            Set up automatic recurring purchases for any service.
          </p>
        </div>
        <ScheduledOrdersManager user={user} />
      </div>
    </DashboardShell>
  );
}
