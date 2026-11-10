import { requireAdmin } from "@/lib/identity/auth";
import { SecurityDashboard } from "./SecurityDashboard";
import { FraudQueue } from "./FraudQueue";
import { SignupProtection } from "./SignupProtection";
import { CloudflareSecurity } from "./CloudflareSecurity";

export const dynamic = "force-dynamic";

export default async function AdminSecurityPage() {
  await requireAdmin();

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-[1.5rem] font-medium tracking-tight">Security Monitoring</h1>
        <p className="mt-1 text-[0.86rem] text-ink-2">
          Review Cloudflare edge events, app reports, and fraud signals separately.
        </p>
      </div>

      <SignupProtection />

      <CloudflareSecurity />

      <FraudQueue />

      <SecurityDashboard />
    </div>
  );
}
