import Link from "next/link";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { userTwoFactor } from "@/db/schema";
import { requireAdmin } from "@/lib/identity/auth";
import { remainingRecoveryCodes, twoFactorAvailable } from "@/lib/identity/two-factor";
import { TwoFactorCard } from "@/app/dashboard/settings/TwoFactorCard";
import { safeRedirectPath } from "@/lib/platform/safe-redirect";
import { Shield } from "@/components/icons";

export const dynamic = "force-dynamic";
export const metadata = { title: "Operator account" };

/**
 * The operator's own security, inside the console.
 *
 * Administrator access requires a second factor, and the page that arms it used to
 * live only at `/dashboard/settings#security`. That meant an operator who had just
 * been appointed was bounced out of the console into the customer storefront to
 * finish arming it, then had to find their way back — for a control that exists
 * because of the console in the first place.
 *
 * Same card, same endpoints, mounted where the operator already is.
 */
export default async function OperatorAccountPage({
  searchParams,
}: {
  searchParams: Promise<{ require?: string; next?: string }>;
}) {
  const operator = await requireAdmin("/admin/account", { allowUnenrolled: true });
  const { require: required, next } = await searchParams;
  const back = safeRedirectPath(next, "/admin");

  const [enrolment] = await db
    .select({ enabledAt: userTwoFactor.enabledAt })
    .from(userTwoFactor)
    .where(eq(userTwoFactor.userId, operator.id))
    .limit(1);
  const enabled = Boolean(enrolment?.enabledAt);
  const remaining = enabled ? await remainingRecoveryCodes(operator.id) : 0;

  return (
    <div className="mx-auto max-w-2xl space-y-5">
      <div>
        <h1 className="text-[1.4rem] font-medium tracking-tight">Operator account</h1>
        <p className="mt-1 text-[0.875rem] leading-relaxed text-ink-2">
          Signing in as <span className="font-medium text-ink">{operator.email}</span>.
        </p>
      </div>

      {required === "2fa" && !enabled && (
        <div
          role="alert"
          className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-[0.875rem] text-amber-900"
        >
          <strong className="font-semibold">A second factor is required before you can operate.</strong>{" "}
          Set it up below, then continue — you will be returned to{" "}
          <span className="font-medium">{back}</span>.
        </div>
      )}

      {!twoFactorAvailable() && (
        <div className="rounded-xl border border-line bg-white px-4 py-3 text-[0.875rem] text-ink-2">
          <p className="flex items-center gap-1.5 font-medium text-ink">
            <Shield className="h-4 w-4 text-lav-700" /> Two-factor cannot be enrolled on this deployment
          </p>
          <p className="mt-1 leading-relaxed">
            <code className="text-[0.8125rem]">TWO_FACTOR_KEY</code> is not configured, so no secret can be
            encrypted. The requirement is skipped rather than locking every operator out of a site with
            no way to fix itself — treat this as a deployment defect.
          </p>
        </div>
      )}

      <TwoFactorCard initialEnabled={enabled} available={twoFactorAvailable()} remainingCodes={remaining} />

      {enabled && required === "2fa" && (
        <Link
          href={back}
          className="inline-flex items-center gap-1.5 rounded-lg bg-lav-700 px-4 py-2 text-[0.8125rem] font-semibold text-white hover:bg-lav-800"
        >
          Continue to {back}
        </Link>
      )}
    </div>
  );
}
