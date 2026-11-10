import { requireAdmin } from "@/lib/identity/auth";
import { SecurityDashboard } from "./SecurityDashboard";
import { FraudQueue } from "./FraudQueue";
import { SignupProtection } from "./SignupProtection";
import { CloudflareSecurity } from "./CloudflareSecurity";

export const dynamic = "force-dynamic";

export default async function AdminSecurityPage() {
  await requireAdmin();

  return (
    <div className="min-w-0 space-y-6 pb-8">
      <header className="rounded-2xl border border-line bg-white p-5 sm:p-6">
        <p className="text-xs font-semibold uppercase tracking-wider text-lav-700">Administration</p>
        <h1 className="mt-2 text-2xl font-semibold tracking-tight text-ink">Security monitoring</h1>
        <p className="mt-2 max-w-2xl text-sm leading-relaxed text-ink-2">
          Review edge traffic, signup safeguards and fraud signals in one place. Each source is reported separately.
        </p>
        <nav aria-label="Security sections" className="mt-5 flex flex-wrap gap-2">
          {[
            ["#edge-activity", "Cloudflare activity"],
            ["#signup-protection", "Signup protection"],
            ["#fraud-signals", "Fraud signals"],
            ["#app-reports", "App reports"],
          ].map(([href, label]) => (
            <a key={href} href={href} className="rounded-lg border border-line bg-cream px-3 py-2 text-sm font-medium text-ink-2 hover:text-lav-700 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-lav-600">{label}</a>
          ))}
        </nav>
      </header>

      <div id="edge-activity" className="min-w-0 scroll-mt-6"><CloudflareSecurity /></div>
      <div id="signup-protection" className="min-w-0 scroll-mt-6"><SignupProtection /></div>
      <div id="fraud-signals" className="min-w-0 scroll-mt-6"><FraudQueue /></div>
      <div id="app-reports" className="min-w-0 scroll-mt-6"><SecurityDashboard /></div>
    </div>
  );
}
