import type { ReactNode } from "react";
import { requireUser } from "@/lib/auth";
import { DashboardShell } from "@/components/dashboard/DashboardShell";

export default async function DashboardLayout({ children }: { children: ReactNode }) {
  const user = await requireUser();

  return (
    <DashboardShell
      user={{ name: user.name, email: user.email, walletBalance: user.walletBalance }}
    >
      {children}
    </DashboardShell>
  );
}
