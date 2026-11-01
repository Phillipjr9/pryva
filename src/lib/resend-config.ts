/**
 * Whether transactional mail can be sent at all.
 *
 * Every email path in this app posts to Resend, so a missing key or sender
 * address means nothing can be delivered -- not verification links, not password
 * resets, not wallet receipts.
 *
 * Callers that tell a user "check your inbox" must consult this first. Returning
 * a success response while delivery is impossible is worse than an error: the
 * person waits for a message that was never queued, and the only evidence is a
 * server-side log line they cannot see.
 *
 * The sender address is validated the same way the wallet outbox has always
 * validated it -- bounded length and no CR/LF, which would otherwise allow
 * header injection into the Resend payload.
 */
export function resendConfigured(): boolean {
  const key = process.env.RESEND_API_KEY?.trim();
  const from = process.env.RESEND_FROM_EMAIL?.trim();
  return Boolean(key && from && from.length <= 255 && !/[\r\n]/.test(from));
}

/**
 * The one place a payout asks "is this account's address real?".
 *
 * Email verification has always been advisory: a link is mailed at signup, a
 * banner appears until it is clicked, and nothing else cares. That is tolerable
 * for browsing and buying -- the goods appear on the order page whether or not
 * mail works -- but not for money leaving. A payout to an account whose address
 * nobody has proven they control is an account we cannot reach, cannot warn and
 * cannot recover if a session is stolen, and the address was never checked.
 *
 * Two conditions, both deliberate:
 *
 *  • only when mail is configured, because a gate nobody can satisfy is a lockout
 *    -- if Resend is unset the link cannot be sent, so it cannot be required;
 *  • only on the way out, not on deposits or purchases, so the rule costs a
 *    customer nothing until they ask us to send money to a bank.
 */
export const UNVERIFIED_EMAIL_PAYOUT_MESSAGE =
  "Verify your email before withdrawing. We can only send money out of an account whose address we can reach — open the link we emailed you, or request a new one from Security. Nothing was deducted.";

export function unverifiedEmailBlocksPayout(user: {
  emailVerifiedAt: Date | string | null;
}): string | null {
  if (!resendConfigured()) return null;
  if (user.emailVerifiedAt) return null;
  return UNVERIFIED_EMAIL_PAYOUT_MESSAGE;
}
