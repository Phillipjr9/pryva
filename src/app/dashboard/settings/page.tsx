import { requireUser } from "@/lib/auth";
import { resendConfigured } from "@/lib/resend-config";
import { SettingsForm } from "./SettingsForm";
import { SecuritySection } from "./SecuritySection";

// The dashboard layout already provides the shell — nesting it here rendered a
// second sidebar inside the content column.
export const metadata = { title: "Settings" };

export default async function SettingsPage({
  searchParams,
}: {
  searchParams: Promise<{ require?: string; next?: string }>;
}) {
  const user = await requireUser("/dashboard/settings");
  const params = await searchParams;
  // Set by `requireAdmin` when an administrator has no second factor yet: the
  // admin tools stay closed until the second factor exists, and the reason is
  // shown here rather than as a 403 on a page they cannot open.
  const needsSecondFactor = params.require === "2fa";

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-[1.5rem] font-medium tracking-tight text-ink sm:text-[1.7rem]">
          Settings
        </h1>
        <p className="mt-2 text-[0.95rem] text-ink-2">
          Manage your account, and how it is protected.
        </p>
      </div>

      {needsSecondFactor && (
        <div
          role="status"
          className="rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-[0.86rem] text-amber-900"
        >
          <p className="font-semibold">Administrator tools are locked until two-factor is on.</p>
          <p className="mt-1">
            Your account can approve withdrawals and issue refunds, so it needs a second factor
            before it can do either. Turn it on below
            {params.next ? ` and you will be returned to ${params.next}` : ""} — if this deployment
            has no two-factor key configured, tell the operator instead of trying again.
          </p>
        </div>
      )}

      <SettingsForm user={user} canSendVerification={resendConfigured()} />

      <SecuritySection user={user} />
    </div>
  );
}
