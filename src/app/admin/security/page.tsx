import { requireAdmin } from "@/lib/auth";
import { SecurityDashboard } from "./SecurityDashboard";

export const dynamic = "force-dynamic";

export default async function AdminSecurityPage() {
  await requireAdmin();

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-[1.5rem] font-medium tracking-tight">Security Monitoring</h1>
        <p className="mt-1 text-[0.86rem] text-ink-2">
          Monitor and analyze security violations, reverse engineering attempts, and suspicious activity.
        </p>
      </div>

      <SecurityDashboard />
    </div>
  );
}
