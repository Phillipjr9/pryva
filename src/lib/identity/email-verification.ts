import "server-only";

import { createHash, randomBytes } from "node:crypto";
import { and, eq, gt, isNull } from "drizzle-orm";
import { db } from "@/db";
import { emailVerificationTokens, users } from "@/db/schema";
import { emailVerificationEmail } from "@/lib/email/email-templates";
import { authRateLimiter, verificationSendRateLimiter } from "@/lib/platform/rate-limit";
import { canonicalSiteUrl } from "@/lib/platform/net";
import { logger } from "@/lib/platform/logger";
import { readJsonWithLimit } from "@/lib/platform/request-body";

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
 * The hourly ceiling on *sending* a link, as opposed to attempting to.
 *
 * `authRateLimiter` above is five per fifteen minutes and keys the resend route
 * by account — which bounds one account, and says nothing about the per-address
 * cost. Each call mints a token, invalidates the previous one and posts a real
 * message through Resend, so the thing being protected is the sending domain's
 * reputation and the provider's quota, not a password. Twenty an hour for one
 * account is far past what a person recovering a lost email needs, and low
 * enough that a script cannot turn the resend button into an outbound-mail
 * amplifier aimed at a third party's inbox.
 */
export function rateLimitVerificationSend(key: string) {
  return verificationSendRateLimiter(key);
}

/**
 * What happened to the message, reported rather than swallowed.
 *
 * This used to be `Promise<void>` and never looked at the response, so a provider
 * that refused the send was indistinguishable from one that accepted it. Signup
 * has to tolerate that -- the account exists whether or not mail works, and the
 * link can be requested again -- but the in-app resend cannot, because it answers
 * a person who is standing there waiting for something to arrive.
 */
export type VerificationDelivery = {
  delivered: boolean;
  /** A short, human-readable reason. `delivered` means provider acceptance, not inbox delivery. */
  detail: string | null;
};

async function sendVerificationEmail(to: string, name: string, token: string): Promise<VerificationDelivery> {
  const key = process.env.RESEND_API_KEY?.trim();
  const from = process.env.RESEND_FROM_EMAIL?.trim();
  if (!key || !from) {
    logger.error("Verification email not sent: mail is not configured");
    return { delivered: false, detail: "email delivery is not configured on this server" };
  }
  const base = canonicalSiteUrl();
  const link = `${base}/verify-email?token=${encodeURIComponent(token)}`;
  // The shared branded template: gradient header bar, hero image, brand mark,
  // DM Sans/Manrope, a plain-text fallback. This route was sending three bare
  // <p> tags while a 463-line template library sat unused in the repository.
  const template = emailVerificationEmail(name, link);
  try {
    const response = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
      redirect: "error",
      cache: "no-store",
      signal: AbortSignal.timeout(8_000),
      body: JSON.stringify({
        from,
        to,
        subject: template.subject,
        html: template.html,
        text: template.text,
      }),
    });
    if (!response.ok) {
      // Provider bodies can echo recipient addresses or other sensitive data.
      logger.error("Verification email refused by the provider", { status: response.status });
      return { delivered: false, detail: `the mail service refused the message (${response.status})` };
    }
    let messageId: unknown;
    try {
      const reply = await readJsonWithLimit(response, 32_768) as { id?: unknown };
      messageId = reply.id;
    } catch { /* A malformed success is not proof of acceptance. */ }
    if (typeof messageId !== "string" || !messageId || messageId.length > 100) {
      logger.error("Verification email acceptance was not confirmed");
      return { delivered: false, detail: "the mail service did not confirm acceptance" };
    }
    // This is provider acceptance, not a confirmed delivery into the inbox.
    return { delivered: true, detail: null };
  } catch {
    logger.error("Verification email could not be confirmed");
    return { delivered: false, detail: "the mail service could not be reached" };
  }
}

/**
 * Issue a fresh link for an account that has already been identified. Both call
 * sites -- signup and the authenticated resend route -- know the user, so there is
 * no address to enumerate and no need for the generic-message dance the reset flow
 * requires.
 */
export async function issueEmailVerification(
  userId: string,
  email: string,
  name: string,
): Promise<VerificationDelivery> {
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
  // The token exists whether or not the message lands. Returning the delivery
  // outcome lets the caller decide: signup ignores it, the resend route reports
  // it, and the support assistant stops claiming a send it cannot confirm.
  return sendVerificationEmail(email, name, token);
}

export async function confirmEmailVerification(
  token: string,
): Promise<{ ok: true; userId: string; firstVerification: boolean } | { ok: false; error: string }> {
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
  const verifiedNow = await db.transaction(async (tx) => {
    // `returning` is what distinguishes a first verification from a no-op. A
    // second live token (a resend the customer never used) still redeems here,
    // but `isNull` means it updates no row -- and the operator must not get a
    // second "new customer" email for an account they already know about.
    const updated = await tx
      .update(users)
      .set({ emailVerifiedAt: new Date() })
      .where(and(eq(users.id, row.userId), isNull(users.emailVerifiedAt)))
      .returning({ id: users.id });
    await tx
      .update(emailVerificationTokens)
      .set({ usedAt: new Date() })
      .where(eq(emailVerificationTokens.id, row.id));
    return updated.length > 0;
  });
  // The user id is returned so the caller can send the receipt and the welcome
  // without a second lookup. They are deliberately *not* sent from inside the
  // transaction above: mail latency and provider failures have no business
  // holding a row lock on the account that was just verified.
  return { ok: true, userId: row.userId, firstVerification: verifiedNow };
}
