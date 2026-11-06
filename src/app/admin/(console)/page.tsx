import { redirect } from "next/navigation";
import { requireAdmin } from "@/lib/identity/auth";

export const dynamic = "force-dynamic";
export const metadata = { title: "Operator console" };

/**
 * The console front door now opens on the Raven-style dashboard overview.
 *
 * `/admin/overview` holds the stats grid, recent activity and quick actions.
 * This page simply requires operator auth and sends operators there, so
 * visiting `/admin` shows the dashboard instead of the old queues front door.
 */
export default async function AdminHomePage() {
  await requireAdmin("/admin");
  redirect("/admin/overview");
}
