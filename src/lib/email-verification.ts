import "server-only";

import { createHash, randomBytes } from "node:crypto";
import { and, eq, gt, isNull } from "drizzle-orm";
import { db } from "@/db";
import { emailVerificationTokens, users } from "@/db/schema";
import { authRateLimiter } from "@/lib/rate-limit";

/**
 * Verification is not urgent the way a password reset is, so the link lasts a day
 * rather than 30 minutes. A short TTL here would mostly generate support requests
 * from people who opened the email the next morning.
 */
export const VERIFY_TOKEN_TTL_MS = 24 * 60 * 60 * 1000;

/** One message for every failure, for the same reason the reset flow uses one. */
export const VERIFY_INVALID_MESSAGE = "That link is no longer valid. Request a new one.";

export const VERIFY_GENERIC_SENT_MESSAGE = "Check your inbox for a link to confirm your email.";

function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

export function generateVerificationToken(): string {
  return randomBytes(32).toString("base64url");
}

/**
 * Throttled per account rather than per IP. Both routes are authenticated or
 * token-bearing, so the account is the better identity, and a shared NAT would
 * otherwise let one user exhaust another's allowance.
 */
export function rateLimitEmailVerification(key: string) {
  return authRateLimiter(key);
}

/**
 * Best effort and silent about failure, matching the reset flow: mail delivery is
 * not a condition of the account existing, and the link can be requested again.
 * A wallet receipt is different -- that is a financial record needing guaranteed
 * delivery, which is why it uses the retrying outbox instead.
 */
async function sendVerificationEmail(to: string, token: string): Promise<void> {
  const key = process.env.RESEND_API_KEY?.trim();
  const from = process.env.RESEND_FROM_EMAIL?.trim();
  if (!key || !from) {
    console.error("[auth] verification email not sent: Resend is not configured");
    return;
  }
  const base = (
    process.env.NEXT_PUBLIC_APP_URL?.trim() ||
    process.env.NEXT_PUBLIC_SITE_URL?.trim() ||
    "https://pryva.ng"
  ).replace(/\/$/, "");
  const link = `${base}/verify-email?token=${encodeURIComponent(token)}`;
  try {
    await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        from,
        to,
        subject: "Confirm your Pryva email",
        html: `<p>Welcome to Pryva.</p><p><a href="${link}">Confirm your email address</a></p><p>This link expires in 24 hours and can only be used once. If you did not create an account, you can ignore this email.</p>`,
      }),
    });
  } catch (error) {
    console.error("[auth] verification email failed", error);
  }
}

/**
 * Issue a fresh link for an account that has already been identified. Both call
 * sites -- signup and the authenticated resend route -- know the user, so there is
 * no address to enumerate and no need for the generic-message dance the reset flow
 * requires.
 */
export async function issueEmailVerification(userId: string, email: string): Promise<void> {
  const token = generateVerificationToken();
  // Supersede any outstanding token so only the newest link works.
  await db
    .update(emailVerificationTokens)
    .set({ usedAt: new Date() })
    .where(and(eq(emailVerificationTokens.userId, userId), isNull(emailVerificationTokens.usedAt)));
  await db.insert(emailVerificationTokens).values({
    userId,
    tokenHash: hashToken(token),
    expiresAt: new Date(Date.now() + VERIFY_TOKEN_TTL_MS),
  });
  await sendVerificationEmail(email, token);
}

export async function confirmEmailVerification(
  token: string,
): Promise<{ ok: true } | { ok: false; error: string }> {
  if (typeof token !== "string" || token.length < 20 || token.length > 200) {
    return { ok: false, error: VERIFY_INVALID_MESSAGE };
  }

  const [row] = await db
    .select({ id: emailVerificationTokens.id, userId: emailVerificationTokens.userId })
    .from(emailVerificationTokens)
    .where(
      and(
        eq(emailVerificationTokens.tokenHash, hashToken(token)),
        isNull(emailVerificationTokens.usedAt),
        gt(emailVerificationTokens.expiresAt, new Date()),
      ),
    )
    .limit(1);
  if (!row) return { ok: false, error: VERIFY_INVALID_MESSAGE };

  // One transaction: marking the token used and recording the verification must
  // not be separable, or a crash between them leaves a live token for an account
  // that is already verified -- replayable forever.
  await db.transaction(async (tx) => {
    await tx
      .update(users)
      .set({ emailVerifiedAt: new Date() })
      .where(and(eq(users.id, row.userId), isNull(users.emailVerifiedAt)));
    await tx
      .update(emailVerificationTokens)
      .set({ usedAt: new Date() })
      .where(eq(emailVerificationTokens.id, row.id));
  });
  return { ok: true };
}
