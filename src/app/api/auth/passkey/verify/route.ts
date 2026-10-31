import { eq } from "drizzle-orm";
import type { AuthenticationResponseJSON } from "@simplewebauthn/server";
import { NextResponse } from "next/server";

import { db } from "@/db";
import { users } from "@/db/schema";
import { createSession } from "@/lib/auth";
import { clientIp } from "@/lib/auth-rate-limit";
import { clearFailedLogins, lockoutRemainingMs } from "@/lib/account-lockout";
import { logger } from "@/lib/logger";
import { isSameOriginMutation } from "@/lib/net";
import { finishAuthentication, relyingPartyFor } from "@/lib/passkeys";
import { passkeyRateLimiter } from "@/lib/rate-limit";
import { isJsonRequest, readJsonWithLimit, RequestBodyTooLargeError } from "@/lib/request-body";

export const dynamic = "force-dynamic";

/**
 * Step two of a passkey sign-in: verify the assertion and open a session.
 *
 * A successful passkey proves two things at once — the device holds the private
 * key, and the person using it passed the device's own check (PIN, fingerprint,
 * face). That is a possession factor *and* a second factor, which is why an
 * account with two-factor switched on is not asked for a TOTP code afterwards.
 * The account lockout is different: it stays in force, because a lockout is
 * about the account being under attack, not about which door was used.
 */
export async function POST(request: Request) {
  if (!isSameOriginMutation(request)) {
    return NextResponse.json({ error: "Invalid origin" }, { status: 403 });
  }
  if (!isJsonRequest(request)) {
    return NextResponse.json({ error: "Expected JSON" }, { status: 415 });
  }

  const limit = await passkeyRateLimiter(`passkey-verify:${clientIp(request)}`);
  if (limit.unavailable) {
    return NextResponse.json({ error: "Passkey sign-in is temporarily unavailable." }, { status: 503 });
  }
  if (!limit.allowed) {
    return NextResponse.json({ error: "Too many attempts. Please wait a moment and try again." }, { status: 429 });
  }

  const rp = relyingPartyFor(request);
  if (!rp) {
    return NextResponse.json({ error: "Passkeys are not available on this address." }, { status: 503 });
  }

  let body: unknown;
  try {
    body = await readJsonWithLimit(request, 32_768);
  } catch (error) {
    return NextResponse.json({ error: "Invalid request" }, { status: error instanceof RequestBodyTooLargeError ? 413 : 400 });
  }
  const response = (body as { response?: unknown })?.response;
  if (!response || typeof response !== "object" || Array.isArray(response)) {
    return NextResponse.json({ error: "Invalid passkey response" }, { status: 400 });
  }

  try {
    const result = await finishAuthentication({ rp, response: response as AuthenticationResponseJSON });

    if (!result.ok) {
      // One message for every failure. Which part of the ceremony failed is not
      // information a caller should be able to probe for.
      logger.info("Passkey sign-in refused", { reason: result.reason });
      return NextResponse.json({ error: "That passkey did not work. Try again, or sign in with your password." }, { status: 401 });
    }

    const [account] = await db
      .select({ id: users.id, lockedUntil: users.lockedUntil })
      .from(users)
      .where(eq(users.id, result.userId))
      .limit(1);
    if (!account) {
      return NextResponse.json({ error: "That passkey did not work. Try again, or sign in with your password." }, { status: 401 });
    }

    const lockedForMs = lockoutRemainingMs(account);
    if (lockedForMs > 0) {
      return NextResponse.json(
        { error: "Too many sign-in attempts for this account. Please wait a few minutes and try again." },
        { status: 429, headers: { "Retry-After": String(Math.max(1, Math.ceil(lockedForMs / 1000))) } },
      );
    }

    // The lockout has already been checked; ending the failure run here is
    // best-effort, exactly as it is for a password sign-in.
    await clearFailedLogins(account.id).catch(() => undefined);
    await createSession(account.id, request);

    logger.info("Passkey sign-in succeeded", { userId: account.id });
    return NextResponse.json({ ok: true }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    logger.error("Passkey sign-in failed", { error });
    return NextResponse.json({ error: "Passkey sign-in is temporarily unavailable." }, { status: 500 });
  }
}
