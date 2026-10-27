import type { ReactNode } from "react";
import { and, count, eq } from "drizzle-orm";
import { db } from "@/db";
import { notifications } from "@/db/schema";
import { requireUser } from "@/lib/auth";
import { DashboardShell } from "@/components/dashboard/DashboardShell";

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
    >
      {children}
    </DashboardShell>
  );
}
