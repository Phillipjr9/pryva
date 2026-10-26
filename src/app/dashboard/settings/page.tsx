import { redirect } from "next/navigation";
import { requireAuth } from "@/lib/auth";
import { DashboardShell } from "@/components/dashboard/DashboardShell";
import { SettingsForm } from "./SettingsForm";

export default async function SettingsPage() {
  const user = await requireAuth();
  if (!user) redirect("/login?next=/dashboard/settings");

  return (
    <DashboardShell user={user}>
      <div className="space-y-6">
        <div>
          <h1 className="text-[1.75rem] font-medium tracking-tight text-ink dark:text-gray-100">
            Settings
          </h1>
          <p className="mt-2 text-[0.95rem] text-ink-2 dark:text-gray-400">
            Manage your account settings and preferences.
          </p>
        </div>
        <SettingsForm user={user} />
      </div>
    </DashboardShell>
  );
}
