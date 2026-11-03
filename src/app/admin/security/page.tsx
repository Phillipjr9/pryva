import { requireAdmin } from "@/lib/auth";
import { SecurityDashboard } from "./SecurityDashboard";
import { FraudQueue } from "./FraudQueue";
import { SecurityControls } from "./SecurityControls";

export const dynamic = "force-dynamic";

export default async function AdminSecurityPage() {
  await requireAdmin();

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-[1.5rem] font-medium tracking-tight">Security Monitoring</h1>
        <p className="mt-1 text-[0.86rem] text-ink-2">
          Suspicious activity as the shop sees it: the fraud queue, the violation counts, and which of the
          controls below are actually running. Client-side detection is not installed, so the counts only
          move if a report is filed another way.
        </p>
      </div>

      <FraudQueue />

      <SecurityDashboard />

      <SecurityControls />
    </div>
  );
}
