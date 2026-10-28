import type { ReactNode } from "react";
import { and, count, eq } from "drizzle-orm";
import { db } from "@/db";
import { notifications } from "@/db/schema";
import { requireUser } from "@/lib/auth";
import { DashboardShell } from "@/components/dashboard/DashboardShell";
import { isPreviewDatabase } from "@/lib/demo-policy";
import { BUILD_ID } from "@/lib/build-id";

export default async function DashboardLayout({ children }: { children: ReactNode }) {
  const user = await requireUser();

  // The bell lives in the shell, so the unread count is fetched once here rather
  // than by every page.
  const [unread] = await db
    .select({ value: count() })
    .from(notifications)
    .where(and(eq(notifications.userId, user.id), eq(notifications.read, 0)));

  return (
    <DashboardShell
      user={{ name: user.name, email: user.email, walletBalance: user.walletBalance }}
      unreadNotifications={Number(unread?.value ?? 0)}
      buildId={BUILD_ID}
    >
      <div role="status" className={`mb-5 rounded-xl border px-4 py-3 text-sm ${isPreviewDatabase() ? "border-lav-200 bg-lav-50 text-lav-800" : "border-amber-200 bg-amber-50 text-amber-900"}`}>
        {isPreviewDatabase()
          ? "Demo mode · Payments, balances and services are simulated. This account is shared, so use fictional details only."
          : "Live number, eSIM, proxy, email, data, bulk and scheduled fulfillment is paused. Contact support about existing orders."}
      </div>
      {children}
    </DashboardShell>
  );
}
