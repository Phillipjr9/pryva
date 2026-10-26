import { redirect } from "next/navigation";
import { requireAuth } from "@/lib/auth";
import { DashboardShell } from "@/components/dashboard/DashboardShell";
import { BulkOrdersForm } from "./BulkOrdersForm";

export default async function BulkOrdersPage() {
  const user = await requireAuth();
  if (!user) redirect("/login?next=/dashboard/bulk-orders");

  return (
    <DashboardShell user={user}>
      <div className="space-y-6">
        <div>
          <h1 className="text-[1.75rem] font-medium tracking-tight text-ink dark:text-gray-100">
            Bulk Orders
          </h1>
          <p className="mt-2 text-[0.95rem] text-ink-2 dark:text-gray-400">
            Buy 10+ items and save 5%, or 20+ items and save 10%.
          </p>
        </div>
        <BulkOrdersForm user={user} />
      </div>
    </DashboardShell>
  );
}
