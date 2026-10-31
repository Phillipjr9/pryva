import "server-only";

import type { NextRequest } from "next/server";

/**
 * Which credentials may read a diagnostics report.
 *
 * `DIAGNOSTICS_SECRET` is preferred and `CRON_SECRET` is still accepted, so a
 * deployment that has not been given the new variable keeps working.
 *
 * The split exists because the two credentials authorise very different things.
 * `CRON_SECRET` also opens `/api/cron/auto-refund`, `/api/cron/scheduled-orders`
 * and `/api/cron/wallet-emails` — jobs that credit wallets and send mail. These
 * reports are read-only. Sharing one secret between them means that anyone who
 * needs to read a status report also holds the ability to fire a refund run, and
 * that rotating the secret for one reason silently changes the other. A
 * read-only surface gets a read-only credential, which can be handed out and
 * rotated without ever touching the crons.
 *
 * Shared rather than copied because two copies of an authorisation check drift:
 * one gets a fix, the other keeps the hole.
 */
export function diagnosticsAuthorized(request: NextRequest): boolean {
  const header = request.headers.get("authorization");
  if (!header) return false;
  // Compared as a whole header, exactly as the original route always did: the
  // configured secret is trimmed but the presented one is not, so a bearer with
  // stray whitespace is refused rather than quietly accepted. An empty or unset
  // secret can never match, which is what keeps the endpoint shut when neither
  // variable is configured.
  return [process.env.DIAGNOSTICS_SECRET, process.env.CRON_SECRET].some((value) => {
    const secret = value?.trim();
    return Boolean(secret) && header === `Bearer ${secret}`;
  });
}
