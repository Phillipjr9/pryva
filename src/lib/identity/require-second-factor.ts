import { getEnrolment, twoFactorAvailable } from "@/lib/identity/two-factor";

/**
 * Whether every customer must carry a second factor.
 *
 * ## Why this is off by default and must stay a deliberate choice
 *
 * The two-factor machinery was built for administrators, where the trade is
 * obvious: a handful of operators, one QR scan each, and the account that can
 * approve a withdrawal stops being one phished password away from moving money.
 *
 * Turning the same rule on for *every* customer changes its nature. It is no
 * longer a control an operator opts into; it is a wall in front of the store,
 * and the cost lands on the people least able to pay it:
 *
 *   • a customer with no authenticator app to hand cannot browse, let alone buy;
 *   • a lost or replaced phone becomes a support ticket rather than a password
 *     reset, because a recovery code is the only way back in;
 *   • the recovery codes are themselves a one-time secret a shopper is asked to
 *     write down — the step most people skip, and the step that locks them out.
 *
 * None of that is an argument against requiring a second factor. It is an
 * argument for switching it on deliberately, with a recovery plan, rather than
 * as a side effect of adding a key. `REQUIRE_2FA_FOR_ALL=true` is that
 * deliberate act; anything else — unset, empty, `0`, `no` — leaves the storefront
 * as it was.
 *
 * ## The deadlock this module exists to prevent
 *
 * Enforcement lives in `requireAuth()` and `requireAuthApi()`. The page that
 * fixes a missing factor, `/dashboard/settings`, is *also* behind them. Gating
 * on the mere absence of an enrolment would therefore redirect the fix page to
 * itself, forever — and the enrolment API calls would be refused by the very
 * rule they exist to satisfy.
 *
 * `isSecondFactorExemptPath()` is that escape: the settings page and the two
 * enrolment APIs pass through. Nothing else does. The exemption widens access to
 * the screens that resolve the rule and to nothing else — every exempt route
 * still runs its own authentication, and neither of them can spend money or read
 * an order.
 */

export const SECOND_FACTOR_REQUIRED_MESSAGE =
  "Your account needs two-factor authentication before you can continue. Set it up in your security settings.";

/** The switch. Only the literal string "true" turns the wall on. */
export function secondFactorRequiredForAll(): boolean {
  return process.env.REQUIRE_2FA_FOR_ALL === "true";
}

/**
 * The pages a customer must reach in order to *satisfy* the rule.
 *
 * Kept as path predicates rather than an allowlist of pages, because the
 * enrolment flow spans a page and its API: a rule that could not reach its own
 * API would be a rule nobody could ever satisfy.
 */
export function isSecondFactorExemptPath(pathname: string): boolean {
  return (
    pathname.startsWith("/dashboard/settings") ||
    pathname.startsWith("/api/security/2fa") ||
    pathname.startsWith("/api/auth/2fa") ||
    // Leaving, and asking who you are, must never be blocked — otherwise a stuck
    // customer cannot even sign out to try again.
    pathname.startsWith("/api/auth/logout") ||
    pathname.startsWith("/api/auth/whoami")
  );
}

/**
 * Should this account be stopped at the door for a missing second factor?
 *
 * Mirrors `adminBlockedForMissingSecondFactor`, including its one important
 * concession: when `TWO_FACTOR_KEY` is absent nobody can enrol, so enforcing
 * would lock every customer out of a site that has no way to fix itself. That
 * state is a deployment defect — reported by the admin security page — not a
 * reason to freeze the storefront.
 */
export async function secondFactorGateApplies(userId: string): Promise<boolean> {
  if (!secondFactorRequiredForAll()) return false;
  if (!twoFactorAvailable()) return false;
  const enrolment = await getEnrolment(userId);
  return !enrolment?.enabledAt;
}

/**
 * Where a customer goes to fix a missing factor.
 *
 * Kept here, not in `auth.ts`, because that file must never send an *operator*
 * into the customer dashboard to arm the console — a rule the admin tests
 * enforce by reading the source. Building the URL here keeps the customer
 * redirect and the operator redirect on separate paths that cannot be confused
 * for one another.
 */
export function customerEnrolmentUrl(destination: string): string {
  return `/dashboard/settings?require=2fa&next=${encodeURIComponent(destination)}`;
}
