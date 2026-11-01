import "server-only";

import { createHash, randomBytes } from "node:crypto";
import { and, eq, gt, isNull, ne, sql } from "drizzle-orm";
import { db } from "@/db";
import { emailChangeRequests, users } from "@/db/schema";
import { logger } from "@/lib/logger";
import { resendConfigured } from "@/lib/resend-config";

/**
 * Changing the sign-in address, with proof of control of the new one.
 *
 * Every other security control hangs off this address: password resets, security
 * notices, the verification link. Letting a stolen session move it would hand an
 * attacker the account permanently, so the change only commits when a link sent
 * to the *new* address comes back — a link to the old address proves the wrong
 * thing.
 *
 * Same shape as the reset flow: 32 random bytes, only the hash is stored, one
 * live request per account (asking again replaces the link), and a short life.
 */

export const EMAIL_CHANGE_TTL_MS = 2 * 60 * 60 * 1000;
export const EMAIL_CHANGE_SENT = "Check the new address for a link to confirm it.";
export const EMAIL_CHANGE_INVALID = "That link is no longer valid. Start the change again.";

const EMAIL_SHAPE = /^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]{2,}$/;

function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

export function normaliseEmail(raw: string): string {
  return raw.trim().toLowerCase();
}

function siteUrl(): string {
  return (process.env.NEXT_PUBLIC_APP_URL?.trim() || process.env.NEXT_PUBLIC_SITE_URL?.trim() || "https://pryva.ng").replace(/\/$/, "");
}

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[char]!);
}

async function sendConfirmation(to: string, link: string, name: string): Promise<boolean> {
  const sender = process.env.RESEND_FROM_EMAIL?.trim();
  if (!sender) return false;
  const safeName = escapeHtml(name.slice(0, 80) || "there");
  const html = `<!doctype html><html lang="en"><body style="margin:0;padding:28px 16px;background:#faf7f1;font-family:'DM Sans',-apple-system,'Segoe UI',Helvetica,Arial,sans-serif;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr><td align="center">
    <table role="presentation" width="520" cellpadding="0" cellspacing="0" style="width:520px;max-width:100%;">
      <tr><td style="padding-bottom:16px;font-family:'Manrope',-apple-system,'Segoe UI',Helvetica,Arial,sans-serif;font-size:20px;font-weight:800;letter-spacing:-1.2px;color:#241b3a;">Pryva</td></tr>
      <tr><td style="border-radius:22px;background:#fffdfa;border:1px solid #e7e0ee;box-shadow:0 22px 40px -26px rgba(45,30,80,0.55);padding:26px 24px;">
        <h1 style="margin:0 0 12px;font-family:'Manrope',-apple-system,'Segoe UI',Helvetica,Arial,sans-serif;font-size:22px;font-weight:800;color:#241b3a;">Confirm your new email</h1>
        <p style="margin:0 0 18px;font-size:14px;line-height:1.7;color:#5b4f6b;">Hi ${safeName}, confirm this address to use it for signing in to Pryva. The link works for two hours.</p>
        <table role="presentation" cellpadding="0" cellspacing="0"><tr>
          <td style="border-radius:14px;background:linear-gradient(135deg,#8266C9,#6f52b8 55%,#9a7ee0);box-shadow:0 14px 26px -10px rgba(60,40,110,0.75),inset 0 1px 0 rgba(255,255,255,0.45);">
            <a href="${escapeHtml(link)}" style="display:inline-block;padding:13px 24px;font-size:13px;font-weight:700;color:#ffffff;text-decoration:none;">Confirm this email</a>
          </td>
        </tr></table>
        <p style="margin:18px 0 0;font-size:12px;line-height:1.7;color:#8a7f97;">If you didn't ask for this, ignore this email — your address stays as it is.</p>
      </td></tr>
    </table>
  </td></tr></table></body></html>`;

  try {
    const response = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { Authorization: `Bearer ${process.env.RESEND_API_KEY!.trim()}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        from: sender,
        to: [to],
        subject: "Confirm your new Pryva email",
        text: `Confirm this address to use it for signing in to Pryva. The link works for two hours:\n\n${link}\n\nIf you didn't ask for this, ignore this email.`,
        html,
      }),
      signal: AbortSignal.timeout(8_000),
    });
    return response.ok;
  } catch (error) {
    logger.warn("Email change confirmation failed to send", {
      error: error instanceof Error ? error.message : String(error),
    });
    return false;
  }
}

export type RequestResult = { ok: true; message: string } | { ok: false; error: string; status: number };

export async function requestEmailChange(input: { userId: string; newEmail: string }): Promise<RequestResult> {
  const email = normaliseEmail(input.newEmail);
  if (!EMAIL_SHAPE.test(email) || email.length > 320) {
    return { ok: false, error: "Enter a valid email address.", status: 400 };
  }

  const [user] = await db
    .select({ id: users.id, email: users.email, name: users.name })
    .from(users)
    .where(eq(users.id, input.userId))
    .limit(1);
  if (!user) return { ok: false, error: "Account not found.", status: 404 };
  if (normaliseEmail(user.email) === email) {
    return { ok: false, error: "That is already your sign-in address.", status: 409 };
  }

  const [taken] = await db
    .select({ id: users.id })
    .from(users)
    .where(sql`lower(${users.email}) = ${email}`)
    .limit(1);
  if (taken) return { ok: false, error: "That address is already in use.", status: 409 };

  // Without mail there is no way to prove control of the new address, and
  // switching without proof is exactly the takeover this flow exists to stop.
  if (!resendConfigured()) {
    return { ok: false, error: "We can't confirm a new address right now. Please contact support.", status: 503 };
  }

  const token = randomBytes(32).toString("base64url");
  await db
    .delete(emailChangeRequests)
    .where(and(eq(emailChangeRequests.userId, user.id), isNull(emailChangeRequests.consumedAt)));
  await db.insert(emailChangeRequests).values({
    userId: user.id,
    newEmail: email,
    tokenHash: hashToken(token),
    expiresAt: new Date(Date.now() + EMAIL_CHANGE_TTL_MS),
  });

  const link = `${siteUrl()}/confirm-email?token=${encodeURIComponent(token)}`;
  const sent = await sendConfirmation(email, link, user.name);
  if (!sent) {
    return { ok: false, error: "We couldn't send the confirmation email. Try again in a moment.", status: 502 };
  }
  return { ok: true, message: EMAIL_CHANGE_SENT };
}

export type ConfirmResult =
  | { ok: true; email: string; previousEmail: string }
  | { ok: false; error: string };

export async function confirmEmailChange(rawToken: string): Promise<ConfirmResult> {
  const token = rawToken.trim();
  if (!token || token.length > 200) return { ok: false, error: EMAIL_CHANGE_INVALID };

  const [request] = await db
    .select()
    .from(emailChangeRequests)
    .where(
      and(
        eq(emailChangeRequests.tokenHash, hashToken(token)),
        isNull(emailChangeRequests.consumedAt),
        gt(emailChangeRequests.expiresAt, new Date()),
      ),
    )
    .limit(1);
  if (!request) return { ok: false, error: EMAIL_CHANGE_INVALID };

  const [user] = await db
    .select({ id: users.id, email: users.email, name: users.name })
    .from(users)
    .where(eq(users.id, request.userId))
    .limit(1);
  if (!user) return { ok: false, error: EMAIL_CHANGE_INVALID };

  // The address was free when the link was sent; it may not be now.
  const [taken] = await db
    .select({ id: users.id })
    .from(users)
    .where(and(sql`lower(${users.email}) = ${request.newEmail}`, ne(users.id, user.id)))
    .limit(1);
  if (taken) return { ok: false, error: "That address is already in use. Start the change again." };

  try {
    await db.transaction(async (tx) => {
      // Optimistic: only apply against the address we read, so a concurrent
      // change cannot be silently overwritten.
      const [updated] = await tx
        .update(users)
        .set({ email: request.newEmail, emailVerifiedAt: new Date() })
        .where(and(eq(users.id, user.id), eq(users.email, user.email)))
        .returning({ id: users.id });
      if (!updated) throw new Error("address changed while confirming");
      await tx
        .update(emailChangeRequests)
        .set({ consumedAt: new Date() })
        .where(eq(emailChangeRequests.id, request.id));
    });
  } catch (error) {
    logger.warn("Email change could not be applied", {
      error: error instanceof Error ? error.message : String(error),
    });
    return { ok: false, error: EMAIL_CHANGE_INVALID };
  }

  return { ok: true, email: request.newEmail, previousEmail: user.email };
}
