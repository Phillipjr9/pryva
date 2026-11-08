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

/**
 * Why a request was refused. The response body stays a bare 401 — a caller who
 * cannot authenticate learns nothing about the configuration — but the server
 * log names the cause.
 *
 * It matters in practice: a `sensitive` Vercel variable cannot be read back, and
 * a production-only variable does not exist in a preview deployment, so
 * "Unauthorized" on its own cannot distinguish "wrong secret" (rotate it) from
 * "this environment has no secret at all" (nothing to guess: the variable is
 * missing, or the request is hitting the wrong deployment).
 */
export type DiagnosticsDenial = "missing-header" | "no-secret-configured" | "secret-mismatch";

/** Configured, non-blank secrets. An empty variable can never match. */
function configuredSecrets(): string[] {
  return [process.env.DIAGNOSTICS_SECRET, process.env.CRON_SECRET]
    .map((value) => value?.trim())
    .filter((secret): secret is string => Boolean(secret));
}

/**
 * The refusal reason, or `null` when the request is authorised.
 *
 * Compared as a whole header, exactly as the original route always did: the
 * configured secret is trimmed, and the presented header is compared as it
 * arrived. Nothing is normalised beyond that, so `bearer` in the wrong case or a
 * header with internal whitespace is refused rather than repaired. (Whitespace
 * around the value is stripped by the Headers implementation before it gets
 * here, which is why a secret stored with a trailing newline still matches.)
 */
export function diagnosticsDenial(request: NextRequest): DiagnosticsDenial | null {
  const header = request.headers.get("authorization");
  if (!header) return "missing-header";
  const secrets = configuredSecrets();
  if (secrets.length === 0) return "no-secret-configured";
  return secrets.some((secret) => header === `Bearer ${secret}`) ? null : "secret-mismatch";
}

export function diagnosticsAuthorized(request: NextRequest): boolean {
  return diagnosticsDenial(request) === null;
}

/**
 * Safe log context for a refused request: never the header, never either
 * secret, only which credentials this deployment was given.
 */
export function diagnosticsDenialContext(request: NextRequest): Record<string, unknown> {
  return {
    reason: diagnosticsDenial(request),
    presentsBearer: Boolean(request.headers.get("authorization")),
    hasDiagnosticsSecret: Boolean(process.env.DIAGNOSTICS_SECRET?.trim()),
    hasCronSecret: Boolean(process.env.CRON_SECRET?.trim()),
  };
}
