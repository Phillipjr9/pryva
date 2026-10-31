import { getEnrolment, twoFactorAvailable } from "@/lib/two-factor";

/**
 * Administrator accounts must carry a second factor.
 *
 * ## Why this is a rule and not a suggestion
 *
 * An administrator can approve a withdrawal, issue a refund and read every
 * customer's ledger. A password alone is one phished page or one reused
 * credential away from all of that, and the audit log would faithfully record
 * the damage afterwards. Requiring a second factor on the accounts that can move
 * money is the single highest-leverage control in this codebase, and it costs the
 * operator one QR scan.
 *
 * ## The escape hatches, and why they exist
 *
 *   * `ADMIN_2FA_REQUIRED=false` turns the rule off. It is there for the case
 *     where the enrolment is broken — a lost phone and lost recovery codes — and
 *     an operator needs in to fix it deliberately, with the change recorded.
 *   * When `TWO_FACTOR_KEY` is not configured, 2FA cannot be *enrolled* at all,
 *     so enforcement would lock every administrator out of a site that has no way
 *     to fix itself. It is skipped, and the runbook treats a missing
 *     `TWO_FACTOR_KEY` in production as a deployment defect rather than a
 *     supported mode.
 */

export const ADMIN_2FA_MESSAGE =
  "Two-factor authentication is required for administrator accounts. Set it up in dashboard security settings.";

/** Default on. Only the literal string "false" disables it. */
export function adminTwoFactorRequired(): boolean {
  return process.env.ADMIN_2FA_REQUIRED !== "false";
}

/** True when this administrator still has to enrol before using admin tools. */
export async function adminBlockedForMissingSecondFactor(userId: string): Promise<boolean> {
  if (!adminTwoFactorRequired()) return false;
  if (!twoFactorAvailable()) return false;
  const enrolment = await getEnrolment(userId);
  return !enrolment?.enabledAt;
}
