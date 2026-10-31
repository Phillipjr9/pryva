import "server-only";

import { createHash, randomBytes } from "node:crypto";
import { and, eq, gt, isNull } from "drizzle-orm";
import { db } from "@/db";
import { emailVerificationTokens, users } from "@/db/schema";
import { emailVerificationEmail } from "@/lib/email-templates";
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
  /** A short, human-readable reason. Null when the message was accepted. */
  detail: string | null;
};

/** The provider's own words, bounded and stripped, so a form can show them. */
function deliveryDetail(status: number, body: string): string {
  const parsed = (() => {
    try {
      return JSON.parse(body) as { message?: unknown };
    } catch {
      return null;
    }
  })();
  const message = typeof parsed?.message === "string" ? parsed.message : "";
  const readable = message.replace(/\s+/g, " ").trim().slice(0, 140);
  if (!readable) return `the mail service refused the message (${status})`;
  return `the mail service refused the message (${status}): ${readable}`;
}

async function sendVerificationEmail(to: string, name: string, token: string): Promise<VerificationDelivery> {
  const key = process.env.RESEND_API_KEY?.trim();
  const from = process.env.RESEND_FROM_EMAIL?.trim();
  if (!key || !from) {
    console.error("[auth] verification email not sent: Resend is not configured");
    return { delivered: false, detail: "email delivery is not configured on this server" };
  }
  const base = (
    process.env.NEXT_PUBLIC_APP_URL?.trim() ||
    process.env.NEXT_PUBLIC_SITE_URL?.trim() ||
    "https://pryva.ng"
  ).replace(/\/$/, "");
  const link = `${base}/verify-email?token=${encodeURIComponent(token)}`;
  // The shared branded template: gradient header bar, hero image, brand mark,
  // DM Sans/Manrope, a plain-text fallback. This route was sending three bare
  // <p> tags while a 463-line template library sat unused in the repository.
  const template = emailVerificationEmail(name, link);
  try {
    const response = await fetch("https://api.resend.com/emails", {
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
    if (!response.ok) {
      const body = await response.text().catch(() => "");
      // The status and the provider's message are logged in full for the owner;
      // what reaches the user is bounded by `deliveryDetail`.
      console.error("[auth] verification email refused", response.status, body.slice(0, 300));
      return { delivered: false, detail: deliveryDetail(response.status, body) };
    }
    return { delivered: true, detail: null };
  } catch (error) {
    console.error("[auth] verification email failed", error);
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
