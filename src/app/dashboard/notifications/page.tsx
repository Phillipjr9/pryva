import { redirect } from "next/navigation";
import { requireAuth } from "@/lib/auth";
import { DashboardShell } from "@/components/dashboard/DashboardShell";
import { Bell } from "@/components/icons";

export default async function NotificationsPage() {
  const user = await requireAuth();
  if (!user) redirect("/login?next=/dashboard/notifications");

  return (
    <DashboardShell user={user}>
      <div className="space-y-6">
        <div>
          <h1 className="text-[1.75rem] font-medium tracking-tight text-ink dark:text-gray-100">
            Notifications
          </h1>
          <p className="mt-2 text-[0.95rem] text-ink-2 dark:text-gray-400">
            View your recent notifications and alerts.
          </p>
        </div>

        <div className="rounded-2xl border border-line bg-white p-12 text-center dark:bg-gray-800 dark:border-gray-700">
          <Bell className="mx-auto h-16 w-16 text-ink-3 dark:text-gray-600 mb-4" />
          <h2 className="text-[1.1rem] font-semibold text-ink dark:text-gray-100 mb-2">
            No notifications yet
          </h2>
          <p className="text-[0.9rem] text-ink-2 dark:text-gray-400 max-w-md mx-auto">
            You'll see notifications here when you receive orders, wallet top-ups, gift card redemptions, and other account activity.
          </p>
        </div>
      </div>
    </DashboardShell>
  );
}
