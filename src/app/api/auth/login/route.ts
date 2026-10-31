import { eq } from "drizzle-orm";
import { db } from "@/db";
import { users } from "@/db/schema";
import { createSession, isValidEmail, normalizeEmail, verifyPassword } from "@/lib/auth";
import { LOCKOUT_DURATION_MS, clearFailedLogins, lockoutRemainingMs, recordFailedLogin } from "@/lib/account-lockout";
import { checkAuthRateLimit, clearAuthRateLimit } from "@/lib/auth-rate-limit";
import { isSameOriginMutation } from "@/lib/net";
import { isJsonRequest, readJsonWithLimit, RequestBodyTooLargeError } from "@/lib/request-body";
import {
  CHALLENGE_TTL_MS,
  createChallenge,
  getEnrolment,
  twoFactorAvailable,
} from "@/lib/two-factor";

/**
 * One reply for both "this account is locked" and "this address is limited".
 * `Retry-After` is in seconds, as the rate limiter's 429 already is.
 */
function lockedResponse(remainingMs: number) {
  return Response.json(
    {
      ok: false,
      error: "Too many sign-in attempts for this account. Please wait a few minutes and try again.",
    },
    { status: 429, headers: { "Retry-After": String(Math.max(1, Math.ceil(remainingMs / 1000))) } },
  );
}

export async function POST(request: Request) {
  if (!isSameOriginMutation(request)) return Response.json({ ok: false, error: "Invalid origin." }, { status: 403 });
  if (!isJsonRequest(request)) return Response.json({ ok: false, error: "Expected JSON." }, { status: 415 });
  let body: unknown;
  try {
    body = await readJsonWithLimit(request, 8_192);
  } catch (error) {
    return Response.json({ ok: false, error: "Invalid request body." }, { status: error instanceof RequestBodyTooLargeError ? 413 : 400 });
  }
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return Response.json({ ok: false, error: "Invalid request body." }, { status: 400 });
  }

  try {
    const fields = body as { email?: unknown; password?: unknown };
    const email = typeof fields.email === "string" ? normalizeEmail(fields.email) : "";
    const password = typeof fields.password === "string" ? fields.password : "";
    const limited = await checkAuthRateLimit(request, "login", email.length <= 200 ? email : "");
    if (limited) return limited;

    if (email.length > 200 || !isValidEmail(email) || password.length === 0) {
      return Response.json(
        { ok: false, error: "Enter your email and password to continue." },
        { status: 400 },
      );
    }

    const [user] = await db.select().from(users).where(eq(users.email, email)).limit(1);

    // A locked account is refused before the password is compared, so a correct
    // password cannot shortcut the lock. The reply is the same shape and wording
    // the limiter uses for an address that does not exist, so the status cannot
    // be used to learn which emails have accounts here.
    const lockedForMs = user ? lockoutRemainingMs(user) : 0;
    if (lockedForMs > 0) {
      return lockedResponse(lockedForMs);
    }

    // A closed account is not a sign-in that failed; it is an account that no
    // longer exists. Its password was replaced with a random hash, so the branch
    // below would refuse it anyway -- this says why, and keeps a deleted row out of
    // the lockout counters it has no business in.
    if (user?.deletedAt) {
      return Response.json({ ok: false, error: "Those details don't match an account." }, { status: 401 });
    }

    if (!user || !verifyPassword(password, user.passwordHash)) {
      if (user) {
        // Count the failure against the account. A database error here must not
        // turn a wrong password into a 500 — the per-IP and per-email limiters
        // still bound the attempt rate — so it is logged and the answer stays
        // the same 401 the visitor would otherwise receive.
        try {
          const state = await recordFailedLogin(user.id);
          if (state.lockedUntil && state.lockedUntil.getTime() > Date.now()) {
            return lockedResponse(LOCKOUT_DURATION_MS);
          }
        } catch (error) {
          console.error("[auth] failed to record a failed sign-in", error);
        }
      }
      return Response.json({ ok: false, error: "Those details don't match an account." }, { status: 401 });
    }

    // Correct password: the run of failures ends here, whether or not a second
    // factor is enrolled. It is best-effort — a bookkeeping failure must not
    // block a legitimate sign-in — and the lockout check above has already run.
    await clearFailedLogins(user.id).catch((error) => {
      console.error("[auth] failed to clear failed sign-ins", error);
    });

    // A correct password is only the first factor for an account that enabled a
    // second one. No session is issued here: the caller receives a short-lived
    // single-use challenge, and `/api/auth/2fa` spends it. Failing to issue that
    // challenge (no key configured) must not fall back to a session.
    const enrolment = await getEnrolment(user.id);
    if (enrolment?.enabledAt) {
      if (!twoFactorAvailable()) {
        return Response.json(
          { ok: false, error: "Sign-in is temporarily unavailable. Please try again later." },
          { status: 503 },
        );
      }
      const challenge = await createChallenge(user.id);
      return Response.json({
        ok: true,
        twoFactorRequired: true,
        challengeToken: challenge.token,
        expiresInSeconds: Math.floor(CHALLENGE_TTL_MS / 1000),
      });
    }

    await clearAuthRateLimit(request, email);
    await createSession(user.id, request);
    return Response.json({ ok: true });
  } catch {
    return Response.json({ ok: false, error: "Something went wrong. Please try again." }, { status: 500 });
  }
}
