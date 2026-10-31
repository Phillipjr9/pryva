import { eq } from "drizzle-orm";
import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { users } from "@/db/schema";
import { createSession } from "@/lib/auth";
import { checkAuthRateLimit, clearAuthRateLimit } from "@/lib/auth-rate-limit";
import { isSameOriginMutation } from "@/lib/net";
import { isJsonRequest, readJsonWithLimit, RequestBodyTooLargeError } from "@/lib/request-body";
import { logger } from "@/lib/logger";
import {
  MAX_CHALLENGE_ATTEMPTS,
  consumeChallenge,
  failChallenge,
  findChallenge,
  verifySecondFactor,
} from "@/lib/two-factor";

export const dynamic = "force-dynamic";

/**
 * Second step of a two-factor sign-in.
 *
 * The password step issues a short-lived, single-use challenge instead of a
 * session. This endpoint spends it. Four guards, each closing a different hole:
 *
 *   * the challenge is looked up by a hash, so a database read cannot replay it;
 *   * it expires after five minutes and dies after five wrong codes;
 *   * a TOTP code cannot be reused inside its own window (recorded step), and a
 *     recovery code is spent with a conditional update;
 *   * the IP-level login budget applies here too, so one host cannot grind codes.
 *
 * Failures are deliberately indistinguishable: expired, consumed, unknown and
 * wrong all return the same message, because telling an attacker which one it was
 * helps them and no honest customer needs the distinction.
 */
export async function POST(request: NextRequest) {
  if (!isSameOriginMutation(request)) {
    return NextResponse.json({ ok: false, error: "Invalid origin." }, { status: 403 });
  }
  if (!isJsonRequest(request)) {
    return NextResponse.json({ ok: false, error: "Expected JSON." }, { status: 415 });
  }

  const invalid = () =>
    NextResponse.json(
      { ok: false, error: "That code did not work. Start signing in again if it keeps failing." },
      { status: 401 },
    );

  try {
    // Shares the IP bucket with password attempts; no key bucket, because there is
    // no email in this request and the challenge is unguessable.
    const limited = await checkAuthRateLimit(request, "login", "");
    if (limited) return limited;

    let body: unknown;
    try {
      body = await readJsonWithLimit(request, 4_096);
    } catch (error) {
      return NextResponse.json(
        { ok: false, error: "Invalid request body." },
        { status: error instanceof RequestBodyTooLargeError ? 413 : 400 },
      );
    }
    if (!body || typeof body !== "object" || Array.isArray(body)) {
      return NextResponse.json({ ok: false, error: "Invalid request body." }, { status: 400 });
    }
    const { challengeToken, code } = body as { challengeToken?: unknown; code?: unknown };

    const challenge = await findChallenge(challengeToken);
    if (!challenge || challenge.consumedAt) return invalid();
    if (challenge.expiresAt.getTime() <= Date.now()) return invalid();
    if (challenge.attempts >= MAX_CHALLENGE_ATTEMPTS) return invalid();

    const result = await verifySecondFactor(challenge.userId, code);
    if (!result.ok) {
      // An outage is not a wrong code: do not spend one of the five attempts, and
      // say so plainly, because retrying a correct code is reasonable here.
      if (result.reason === "unavailable") {
        return NextResponse.json(
          { ok: false, error: "Sign-in is temporarily unavailable. Please try again later." },
          { status: 503 },
        );
      }
      await failChallenge(challenge.id, challenge.attempts);
      return invalid();
    }

    // Two concurrent requests must not both get a session from one challenge.
    if (!(await consumeChallenge(challenge.id))) return invalid();

    const [account] = await db
      .select({ email: users.email })
      .from(users)
      .where(eq(users.id, challenge.userId))
      .limit(1);
    if (!account) return invalid();

    await clearAuthRateLimit(request, account.email);
    await createSession(challenge.userId, request);
    logger.info("Two-factor sign-in completed", { userId: challenge.userId, method: result.method });
    return NextResponse.json({ ok: true });
  } catch (error) {
    logger.error("Two-factor sign-in failed unexpectedly", { error });
    return NextResponse.json(
      { ok: false, error: "Sign-in is temporarily unavailable. Please try again later." },
      { status: 500 },
    );
  }
}
