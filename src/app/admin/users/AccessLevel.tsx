import { isConfiguredAdminEmail } from "@/lib/auth";

/**
 * Which accounts can open the operator console, and why.
 *
 * Administrator access has no column of its own: it is `ADMIN_EMAILS` AND a
 * verified address (`isAdminUser`). That made the list actively misleading — the
 * operator's own row looked exactly like a customer's, so the reasonable question
 * "is this account an administrator?" could not be answered anywhere in the
 * product, and "it still shows as a user" read like a broken setting when the
 * access was in fact working.
 *
 * The unverified case is shown separately from a plain customer because it is the
 * one state an operator can fix, and the fix is theirs to perform (open the link
 * that was mailed to that address), not something another admin can do.
 */
export function AccessLevel({ email, emailVerifiedAt }: { email: string; emailVerifiedAt: Date | string | null }) {
  const listed = isConfiguredAdminEmail(email);
  const verified = Boolean(emailVerifiedAt);
  if (listed && verified) {
    return (
      <span className="mt-1 inline-flex rounded-full bg-emerald-50 px-2 py-0.5 text-meta font-semibold text-emerald-700">
        Administrator
      </span>
    );
  }
  if (listed) {
    return (
      <span className="mt-1 inline-flex rounded-full bg-amber-50 px-2 py-0.5 text-meta font-semibold text-amber-800">
        Admin · email unverified
      </span>
    );
  }
  return <span className="mt-1 inline-flex rounded-full bg-slate-100 px-2 py-0.5 text-meta font-medium text-ink-2">Customer</span>;
}
