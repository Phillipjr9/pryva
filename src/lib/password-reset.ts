import "server-only";

import { createHash, randomBytes } from "node:crypto";
import { and, eq, gt, isNull } from "drizzle-orm";
import { db } from "@/db";
import { passwordResetTokens, sessions, users } from "@/db/schema";
import { hashPassword, isValidEmail, normalizeEmail } from "@/lib/auth";
import { passwordResetEmail } from "@/lib/email-templates";
import { authRateLimiter } from "@/lib/rate-limit";
import { validatePassword } from "@/lib/validation";

/** A reset link stays usable for 30 minutes. */
export const RESET_TOKEN_TTL_MS = 30 * 60 * 1000;

/**
 * One message for every failure. Distinguishing "expired" from "already used"
 * from "never existed" would turn the endpoint into an oracle for guessing which
 * links are live.
 */
export const RESET_INVALID_MESSAGE = "That link is no longer valid. Request a new one.";

export const GENERIC_REQUEST_MESSAGE =
  "If that email has an account, a reset link is on its way.";

export function rateLimitPasswordReset(key: string) {
  // authRateLimiter was exported but unused; this gives it the job it was sized
  // for -- 5 attempts per 15 minutes is generous for a human, hopeless for a bot.
  return authRateLimiter(key);
}

function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

export function generateResetToken(): string {
  return randomBytes(32).toString("base64url");
}

/**
 * Best effort, and deliberately silent about failure.
 *
 * The caller must return the same response whether or not mail was sent, so an
 * observer cannot learn which addresses have accounts by watching for errors.
 * Unlike a wallet receipt -- a financial record that needs guaranteed delivery
 * and therefore the retrying outbox -- a reset link can simply be requested
 * again, so it does not justify that machinery.
 */
async function sendResetEmail(to: string, name: string, token: string): Promise<void> {
  const key = process.env.RESEND_API_KEY?.trim();
  const from = process.env.RESEND_FROM_EMAIL?.trim();
  if (!key || !from) {
    console.error("[auth] reset email not sent: Resend is not configured");
    return;
  }
  // The variables the rest of the app already uses for absolute URLs. SITE_URL was
  // invented in this file and appears nowhere else, so nobody could have known to
  // set it from .env.example -- and an unset base would silently send every reset
  // link to a domain that may not be the one serving the site.
  const base = (
    process.env.NEXT_PUBLIC_APP_URL?.trim() ||
    process.env.NEXT_PUBLIC_SITE_URL?.trim() ||
    "https://pryva.ng"
  ).replace(/\/$/, "");
  const link = `${base}/reset-password?token=${encodeURIComponent(token)}`;
  // The shared branded template, which already existed and was never called.
  const template = passwordResetEmail(name, link);
  try {
    await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        from,
        to,
        subject: template.subject,
        html: template.html,
        text: template.text,
      }),
    });
  } catch (error) {
    console.error("[auth] reset email failed", error);
  }
}

/**
 * Resolve identically whether or not the address belongs to an account.
 *
 * A token is generated and hashed on every call, including the ones that find no
 * user, so the two paths do comparable work and differ less in timing. The
 * residual difference is real — the found path writes rows and sends mail — and
 * is noted rather than pretended away.
 */
export async function requestPasswordReset(rawEmail: string): Promise<void> {
  const token = generateResetToken();
  const tokenHash = hashToken(token);
  const email = normalizeEmail(rawEmail);
  if (!isValidEmail(email) || email.length > 200) return;

  const [user] = await db
    .select({ id: users.id, name: users.name })
    .from(users)
    .where(eq(users.email, email))
    .limit(1);
  if (!user) return;

  // Supersede any outstanding token so only the newest link works.
  await db
    .update(passwordResetTokens)
    .set({ usedAt: new Date() })
    .where(and(eq(passwordResetTokens.userId, user.id), isNull(passwordResetTokens.usedAt)));
  await db.insert(passwordResetTokens).values({
    userId: user.id,
    tokenHash,
    expiresAt: new Date(Date.now() + RESET_TOKEN_TTL_MS),
  });
  await sendResetEmail(email, user.name, token);
}

export async function resetPassword(
  token: string,
  newPassword: string,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const passwordError = validatePassword(newPassword);
  if (passwordError) return { ok: false, error: passwordError };
  if (typeof token !== "string" || token.length < 20 || token.length > 200) {
    return { ok: false, error: RESET_INVALID_MESSAGE };
  }

  const [row] = await db
    .select({ id: passwordResetTokens.id, userId: passwordResetTokens.userId })
    .from(passwordResetTokens)
    .where(
      and(
        eq(passwordResetTokens.tokenHash, hashToken(token)),
        isNull(passwordResetTokens.usedAt),
        gt(passwordResetTokens.expiresAt, new Date()),
      ),
    )
    .limit(1);
  if (!row) return { ok: false, error: RESET_INVALID_MESSAGE };

  await db.transaction(async (tx) => {
    // A completed reset also releases an account lockout: the token proves
    // control of the mailbox, which is a stronger signal than a forgotten
    // password, and leaving the lock on would refuse the sign-in the customer
    // just earned.
    await tx
      .update(users)
      .set({ passwordHash: hashPassword(newPassword), failedLoginAttempts: 0, lockedUntil: null })
      .where(eq(users.id, row.userId));
    await tx.update(passwordResetTokens).set({ usedAt: new Date() }).where(eq(passwordResetTokens.id, row.id));
    // Every existing session dies. If someone else had already got in, this is
    // what locks them out — resetting the password alone would not.
    await tx.delete(sessions).where(eq(sessions.userId, row.userId));
  });
  return { ok: true };
}
