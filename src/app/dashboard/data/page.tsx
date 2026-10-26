import { redirect } from "next/navigation";
import { requireAuth } from "@/lib/auth";
import { DashboardShell } from "@/components/dashboard/DashboardShell";
import { DataPlansForm } from "./DataPlansForm";

export default async function DataPlansPage() {
  const user = await requireAuth();
  if (!user) redirect("/login?next=/dashboard/data");

  return (
    <DashboardShell user={user}>
      <div className="space-y-6">
        <div>
          <h1 className="text-[1.75rem] font-medium tracking-tight text-ink dark:text-gray-100">
            Data Plans
          </h1>
          <p className="mt-2 text-[0.95rem] text-ink-2 dark:text-gray-400">
            Purchase MTN, Airtel, Glo and 9mobile data plans instantly.
          </p>
        </div>
        <DataPlansForm user={user} />
      </div>
    </DashboardShell>
  );
}
