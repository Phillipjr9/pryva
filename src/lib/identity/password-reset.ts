import "server-only";

import { createHash, randomBytes } from "node:crypto";
import { and, eq, gt, isNull } from "drizzle-orm";
import { db } from "@/db";
import { passwordResetTokens, sessions, users } from "@/db/schema";
import { hashPassword, isValidEmail, normalizeEmail } from "@/lib/identity/auth";
import { passwordResetEmail } from "@/lib/email/email-templates";
import { authRateLimiter } from "@/lib/platform/rate-limit";
import { validatePassword } from "@/lib/platform/validation";
import { canonicalSiteUrl } from "@/lib/platform/net";
import { logger } from "@/lib/platform/logger";
import { readJsonWithLimit } from "@/lib/platform/request-body";
import { scheduleWalletEmails } from "@/lib/email/schedule-wallet-emails";
import { queuePasswordChangeEmail } from "@/lib/email/password-change-email";

/** A reset link stays usable for 30 minutes. */
export const RESET_TOKEN_TTL_MS = 30 * 60 * 1000;

/**
 * One message for every failure. Distinguishing "expired" from "already used"
 * from "never existed" would turn the endpoint into an oracle for guessing which
 * links are live.
 */
export const RESET_INVALID_MESSAGE = "That link is no longer valid. Request a new one.";

export const GENERIC_REQUEST_MESSAGE =
  "If that email has an account, we'll try to send a reset link. If it doesn't arrive, try again or contact support.";

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
    logger.error("Password reset email not sent: mail is not configured");
    return;
  }
  // The variables the rest of the app already uses for absolute URLs. SITE_URL was
  // invented in this file and appears nowhere else, so nobody could have known to
  // set it from .env.example -- and an unset base would silently send every reset
  // link to a domain that may not be the one serving the site.
  const base = canonicalSiteUrl();
  const link = `${base}/reset-password?token=${encodeURIComponent(token)}`;
  // The shared branded template, which already existed and was never called.
  const template = passwordResetEmail(name, link);
  try {
    const response = await fetch("https://api.resend.com/emails", {
      method: "POST", redirect: "error", cache: "no-store", signal: AbortSignal.timeout(8_000),
      headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        from,
        to,
        subject: template.subject,
        html: template.html,
        text: template.text,
      }),
    });
    if (!response.ok) {
      logger.error("Password reset email refused by provider", { status: response.status });
    } else {
      const reply = await readJsonWithLimit(response, 32_768).catch(() => null) as { id?: unknown } | null;
      if (typeof reply?.id !== "string" || !reply.id || reply.id.length > 100) {
        logger.error("Password reset email acceptance was not confirmed");
      }
    }
  } catch {
    logger.error("Password reset email could not be sent");
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

  const changed = await db.transaction(async (tx) => {
    // Claim the still-live token inside the transaction. Two concurrent reset
    // requests must not both change the password or queue duplicate notices.
    const [claimed] = await tx.update(passwordResetTokens).set({ usedAt: new Date() })
      .where(and(eq(passwordResetTokens.id, row.id), isNull(passwordResetTokens.usedAt), gt(passwordResetTokens.expiresAt, new Date())))
      .returning({ id: passwordResetTokens.id });
    if (!claimed) return false;
    const [updated] = await tx.update(users)
      .set({ passwordHash: hashPassword(newPassword), failedLoginAttempts: 0, lockedUntil: null })
      .where(and(eq(users.id, row.userId), isNull(users.deletedAt)))
      .returning({ id: users.id, email: users.email, name: users.name });
    if (!updated) return false;
    await tx.delete(sessions).where(eq(sessions.userId, row.userId));
    await queuePasswordChangeEmail(tx, updated);
    return true;
  });
  if (!changed) return { ok: false, error: RESET_INVALID_MESSAGE };
  scheduleWalletEmails();
  return { ok: true };
}
