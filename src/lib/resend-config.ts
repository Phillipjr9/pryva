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
