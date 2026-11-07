import "server-only";

import { logger } from "@/lib/platform/logger";

/**
 * Cloudflare Turnstile — the bot challenge on public signup.
 *
 * Signup had no challenge at all: a same-origin check (which a bot satisfies by
 * sending the header), a disposable-domain list, and 10 accounts per IP per
 * hour. Rotating cheap VPS and Tor exits therefore minted accounts all day, and
 * every one of them emailed the operator inbox. This is the layer that makes
 * the account cost something to create.
 *
 * Turnstile rather than a puzzle CAPTCHA: most visitors see nothing at all, and
 * nobody has to identify traffic lights to buy a phone number.
 *
 * ## Configuration policy
 *
 * Verification is enforced **only when both keys are present**. That is
 * deliberate: shipping this code must not lock every customer out of signup
 * before the owner has created the widget in the Cloudflare dashboard. The
 * admin security page reports the gap, and `isTurnstileConfigured()` is the
 * single place that decides.
 *
 * Once configured it fails **closed**. A missing or refused token is a 400, and
 * a Cloudflare outage is a 503 — the same convention the rate limiter uses.
 * Falling open on a network error would hand bots a way to skip the challenge
 * by making our verification call fail.
 */

/** One warning per process is enough; a per-request log would bury everything else. */
let warnedBuildGap = false;

const SITEVERIFY_URL = "https://challenges.cloudflare.com/turnstile/v0/siteverify";
const REQUEST_TIMEOUT_MS = 5_000;
const MAX_TOKEN_LENGTH = 2_048;

/**
 * The two variables this module reads, and nothing else. Narrower than
 * `NodeJS.ProcessEnv` so a caller (or a test) can supply just the pair without
 * pretending to be a whole environment.
 */
export type TurnstileEnv = Record<string, string | undefined>;

/** The publishable half. Read on the server and passed to the signup form. */
export function turnstileSiteKey(env: TurnstileEnv = process.env): string | null {
  const raw = env.NEXT_PUBLIC_TURNSTILE_SITE_KEY?.trim();
  return raw ? raw : null;
}

export function turnstileSecretKey(env: TurnstileEnv = process.env): string | null {
  const raw = env.TURNSTILE_SECRET_KEY?.trim();
  return raw ? raw : null;
}

/**
 * The state a *build* was in, which is not the same question as "are the keys
 * set now".
 *
 * Next inlines `NEXT_PUBLIC_*` into the client bundle when it builds, so a
 * deployment built without the site key ships a signup page that renders no
 * widget — even after the variable is added — until it is rebuilt. The server
 * half reads `process.env` at runtime, so the same deployment can verify tokens
 * for a widget nobody is showing. That combination fails open on the one path
 * this module exists to close, and nothing about it is visible from a dashboard
 * that lists both variables as present.
 *
 * Returns null when there is nothing to complain about, or the sentence an
 * operator needs to read.
 */
export function turnstileBuildGap(
  env: TurnstileEnv = process.env,
  buildSiteKey = process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY,
): string | null {
  const site = turnstileSiteKey(env);
  const secret = turnstileSecretKey(env);
  if (!site && !secret) return null;
  if (!secret) return "NEXT_PUBLIC_TURNSTILE_SITE_KEY is set but TURNSTILE_SECRET_KEY is not, so no token is ever checked.";
  if (!site) return "TURNSTILE_SECRET_KEY is set but NEXT_PUBLIC_TURNSTILE_SITE_KEY is not, so no widget is rendered.";
  const built = buildSiteKey?.trim();
  if (!built) {
    return "This build shipped without NEXT_PUBLIC_TURNSTILE_SITE_KEY, so the signup page renders no challenge until a new deployment is built with it.";
  }
  return null;
}

/**
 * Both halves are needed: a site key with no secret renders a widget the server
 * never checks, which is worse than no widget because it looks protected.
 */
export function isTurnstileConfigured(env: TurnstileEnv = process.env): boolean {
  return Boolean(turnstileSiteKey(env) && turnstileSecretKey(env));
}

export type TurnstileOutcome =
  | { ok: true }
  | { ok: false; reason: "missing" | "rejected" | "unavailable" };

/**
 * Check one token with Cloudflare.
 *
 * `remoteIp` is optional and only tightens the check; it is never trusted for
 * anything else. Tokens are single-use on Cloudflare's side, so a replayed one
 * comes back `timeout-or-duplicate` and is refused here.
 */
export async function verifyTurnstileToken(
  token: unknown,
  remoteIp?: string | null,
  env: TurnstileEnv = process.env,
): Promise<TurnstileOutcome> {
  const secret = turnstileSecretKey(env);
  if (!isTurnstileConfigured(env) || !secret) {
    // Not configured is a deployment state, not a failed check. Say so once in
    // the server log so the gap is visible without failing anybody's signup.
    logger.debug("Turnstile not configured; signup challenge skipped", {});
    return { ok: true };
  }
  // Configured on the server but missing from the build: the token would never
  // arrive because no widget was rendered. Logged at warn, once per process, so
  // the state is discoverable from the deployment's own logs rather than only
  // from /admin/security.
  const gap = turnstileBuildGap(env);
  if (gap && !warnedBuildGap) {
    warnedBuildGap = true;
    logger.warn("Turnstile challenge is configured but the deployed build may not render it", { detail: gap });
  }

  if (typeof token !== "string" || token.length === 0 || token.length > MAX_TOKEN_LENGTH) {
    return { ok: false, reason: "missing" };
  }

  const body = new URLSearchParams({ secret, response: token });
  if (remoteIp && remoteIp !== "unknown") body.set("remoteip", remoteIp);

  try {
    const response = await fetch(SITEVERIFY_URL, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body,
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      cache: "no-store",
    });
    if (!response.ok) {
      logger.warn("Turnstile siteverify returned a non-OK status", { status: response.status });
      return { ok: false, reason: "unavailable" };
    }
    const data = (await response.json()) as { success?: boolean; "error-codes"?: string[] };
    if (data.success === true) return { ok: true };
    // The codes are Cloudflare's own vocabulary and carry no visitor data.
    logger.info("Turnstile refused a signup token", { codes: data["error-codes"] ?? [] });
    return { ok: false, reason: "rejected" };
  } catch (error) {
    logger.warn("Turnstile siteverify could not be reached", {
      error: error instanceof Error ? error.message : String(error),
    });
    return { ok: false, reason: "unavailable" };
  }
}

/** What the customer is told. Never reveals which check failed. */
export const TURNSTILE_MESSAGES = {
  missing: "Please complete the verification challenge and try again.",
  rejected: "That verification expired or did not pass. Please try again.",
  unavailable: "Verification is temporarily unavailable. Please try again shortly.",
} as const;
