import { redirect } from "next/navigation";
import { requireAdmin } from "@/lib/identity/auth";
import { parseReportPeriod } from "@/lib/admin/dashboard";

export const dynamic = "force-dynamic";
export const metadata = { title: "Dashboard" };

/** Preserve the legacy dashboard URL without maintaining a second overview. */
export default async function AdminDashboardPage({ searchParams }: { searchParams: Promise<{ days?: string }> }) {
  await requireAdmin("/admin/dashboard");
  const { days } = await searchParams;
  redirect(`/admin/overview?days=${parseReportPeriod(days)}`);
}
