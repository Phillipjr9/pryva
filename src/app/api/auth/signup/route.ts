import { eq } from "drizzle-orm";
import { db } from "@/db";
import { users } from "@/db/schema";
import { createSession, hashPassword, isConfiguredAdminEmail, isValidEmail, normalizeEmail } from "@/lib/identity/auth";
import { creditWallet } from "@/lib/payments/wallet";
import { checkAuthRateLimit, clientIp } from "@/lib/identity/auth-rate-limit";
import { issueEmailVerification } from "@/lib/identity/email-verification";
import { DISPOSABLE_EMAIL_ERROR, isDisposableEmailAddress } from "@/lib/services/email-otp/disposable-domains";
import { isSameOriginMutation } from "@/lib/platform/net";
import { isJsonRequest, readJsonWithLimit, RequestBodyTooLargeError } from "@/lib/platform/request-body";
import { attributeReferral, readReferralCodeFrom } from "@/lib/content/referrals";
import { assessSignupRisk, recordFraudEvent, recordSignupSignal } from "@/lib/admin/fraud";
import { noteSignupAndMaybeAlert } from "@/lib/admin/signup-spike";
import { previewOperatorBootstrapEnabled } from "@/lib/platform/preview-operator";
import { TURNSTILE_MESSAGES, verifyTurnstileToken } from "@/lib/platform/turnstile";

export async function POST(request: Request) {
  // Host matching alone does not establish where a browser mutation came from.
  // Accept an explicit same-origin browser fetch as well as an Origin header;
  // reject requests with neither signal on these session-creating endpoints.
  if ((!request.headers.get("origin") && request.headers.get("sec-fetch-site") !== "same-origin") || !isSameOriginMutation(request)) {
    return Response.json({ ok: false, error: "Invalid origin." }, { status: 403 });
  }
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
    const fields = body as {
      name?: unknown;
      email?: unknown;
      password?: unknown;
      ref?: unknown;
      captchaToken?: unknown;
      fax?: unknown;
    };
    const name = typeof fields.name === "string" ? fields.name.trim() : "";
    const email = typeof fields.email === "string" ? normalizeEmail(fields.email) : "";
    const password = typeof fields.password === "string" ? fields.password : "";

    const limited = await checkAuthRateLimit(request, "signup");
    if (limited) return limited;
    // The honeypot. A real browser leaves this empty because no person can see
    // or tab to it. Answered with the same generic failure as any other bad
    // body so a bot cannot learn which field gave it away.
    if (typeof fields.fax === "string" && fields.fax.trim().length > 0) {
      return Response.json({ ok: false, error: "Could not create that account." }, { status: 400 });
    }
    if (name.length < 2 || name.length > 120) {
      return Response.json({ ok: false, error: "Enter a name between 2 and 120 characters." }, { status: 400 });
    }
    if (email.length > 200 || !isValidEmail(email)) {
      return Response.json({ ok: false, error: "That email doesn't look right." }, { status: 400 });
    }
    // A throwaway inbox is the one address an account cannot depend on: it is
    // deleted by design, taking the verification link, receipts and every
    // password reset with it. Refused before the row is created, so the answer
    // is the same whether or not the address has been tried before.
    if (isDisposableEmailAddress(email)) {
      return Response.json({ ok: false, error: DISPOSABLE_EMAIL_ERROR }, { status: 400 });
    }
    if (isConfiguredAdminEmail(email) && !previewOperatorBootstrapEnabled()) {
      return Response.json({ ok: false, error: "This account cannot be created through public signup." }, { status: 403 });
    }
    if (password.length < 8 || password.length > 128) {
      return Response.json({ ok: false, error: "Use a password between 8 and 128 characters." }, { status: 400 });
    }

    // The bot challenge, checked before the account is written. Deliberately
    // after the cheap field validation so malformed posts never spend a
    // Cloudflare call, and before the insert so a refused challenge cannot
    // leave a half-created account behind.
    const challenge = await verifyTurnstileToken(fields.captchaToken, clientIp(request));
    if (!challenge.ok) {
      return Response.json(
        { ok: false, error: TURNSTILE_MESSAGES[challenge.reason] },
        { status: challenge.reason === "unavailable" ? 503 : 400 },
      );
    }

    const existing = await db.select({ id: users.id }).from(users).where(eq(users.email, email)).limit(1);
    if (existing.length > 0) {
      return Response.json({ ok: false, error: "An account with this email already exists. Try signing in." }, { status: 409 });
    }

    // Preview operator bootstrap: this address is in ADMIN_EMAILS, so it cannot
    // be created above unless both preview locks are on -- and once created it
    // has no mailbox to verify from. Marking it verified here is what lets the
    // operator actually reach /admin on a preview. `isAdminUser` still demands
    // the address be in ADMIN_EMAILS, so this grants nothing to anyone else.
    const operatorBootstrap = isConfiguredAdminEmail(email) && previewOperatorBootstrapEnabled();

    const [created] = await db.insert(users)
      .values({
        name,
        email,
        passwordHash: hashPassword(password),
        walletBalance: 0,
        ...(operatorBootstrap ? { emailVerifiedAt: new Date() } : {}),
      })
      .returning({ id: users.id });
    if (!created) return Response.json({ ok: false, error: "Could not create that account." }, { status: 500 });

    await createSession(created.id, request);

    // Attribution is best effort and silent: a bad code must never be the reason
    // somebody cannot sign up. The code arrives in the body (a link on the signup
    // page) or in the short-lived cookie the page sets, which is what lets a
    // Google signup hours later still be attributed.
    // Where this account came from, as salted hashes. Best effort and silent:
    // a missing signal costs one fraud check, never an account.
    await recordSignupSignal(request, created.id);

    // Score the signup for spam-like signals and queue anything suspicious so
    // an operator can judge it. Never blocks account creation.
    const risk = await assessSignupRisk(request, created.id, email).catch(() => ({
      level: "low" as const,
      reasons: [] as string[],
      ipHash: null as string | null,
    }));
    if (risk.level !== "low") {
      await recordFraudEvent({
        userId: created.id,
        kind: "suspicious_signup",
        severity: risk.level === "high" ? "high" : "warn",
        reasons: risk.reasons,
        ipHash: risk.ipHash ?? null,
      }).catch((error) => {
        console.error("[auth] fraud event recording failed", error instanceof Error ? error.message : String(error));
      });
    }

    // Aggregate detection, not per-account scoring. Whether or not this one
    // looked suspicious, the question an operator needs answered is "how many
    // accounts an hour are we creating" -- the shape a single bot signup never
    // shows. Best effort and never awaited by the person signing up.
    await noteSignupAndMaybeAlert();

    const referralCode = readReferralCodeFrom(request, fields.ref);
    if (referralCode) {
      await attributeReferral({ refereeId: created.id, code: referralCode }).catch((error) => {
        console.error("[referrals] attribution failed", error instanceof Error ? error.message : String(error));
      });
    }
    // Best effort: the account exists whether or not mail is configured, and the
    // link can be re-requested from /verify-email. Signup must not fail because
    // Resend is down. `created` returns only the id; `email` is the normalized
    // address in scope.
    // The operator alert no longer fires here. It moved to the moment the
    // address is confirmed (/api/auth/verify-email/confirm), because an
    // unverified signup is not a customer -- it is usually a bot, and mailing
    // the owner one email per bot turned their own inbox into the spam.
    if (!operatorBootstrap) {
      await issueEmailVerification(created.id, email, name).catch((error) => {
        console.error("[auth] signup verification email failed", error instanceof Error ? error.message : String(error));
      });
    }
    return Response.json({ ok: true });
  } catch (error) {
    console.error("[auth] signup failed", error);
    return Response.json({ ok: false, error: "Something went wrong. Please try again." }, { status: 500 });
  }
}
