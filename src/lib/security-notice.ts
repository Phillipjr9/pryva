import "server-only";

import { resendConfigured } from "@/lib/resend-config";
import { logger } from "@/lib/logger";

/**
 * "Something changed on your account."
 *
 * These are the emails people only notice when they are missing. A password
 * change, a new sign-in address or a second factor being switched off are the
 * three things an attacker does first, and the account holder is the only one
 * who can tell us it was not them.
 *
 * Every notice goes to the address on the account *at the time of the event*,
 * never to an address supplied in the request, and a failure to send never fails
 * the action that triggered it — locking somebody out of their own account
 * because Resend is down would be worse than the silence.
 */

export type SecurityEvent =
  | "password_changed"
  | "email_changed"
  | "two_factor_enabled"
  | "two_factor_disabled";

const COPY: Record<SecurityEvent, { subject: string; heading: string; body: string }> = {
  password_changed: {
    subject: "Your Pryva password was changed",
    heading: "Your password was changed",
    body: "Every other session was signed out. If this wasn't you, reset your password immediately and reply to this email.",
  },
  email_changed: {
    subject: "Your Pryva sign-in email was changed",
    heading: "Your sign-in email was changed",
    body: "This address is no longer the one used to sign in. If you didn't make this change, contact support immediately — a changed address is how an account is taken over.",
  },
  two_factor_enabled: {
    subject: "Two-factor authentication is on",
    heading: "Two-factor authentication was turned on",
    body: "From now on, signing in needs a code from your authenticator app. If this wasn't you, change your password and reply to this email.",
  },
  two_factor_disabled: {
    subject: "Two-factor authentication was turned off",
    heading: "Two-factor authentication was turned off",
    body: "Your account is now protected by a password alone. If this wasn't you, turn two-factor back on and change your password.",
  },
};

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[char]!);
}

export function buildSecurityNotice(event: SecurityEvent, name: string, when: Date) {
  const copy = COPY[event];
  const safeName = escapeHtml(name.replace(/[\u0000-\u001f\u007f]/g, " ").trim().slice(0, 80) || "there");
  const at = when.toISOString().replace("T", " ").slice(0, 16) + " UTC";

  const html = `<!doctype html><html lang="en"><body style="margin:0;padding:28px 16px;background:#faf7f1;font-family:'DM Sans',-apple-system,'Segoe UI',Helvetica,Arial,sans-serif;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr><td align="center">
    <table role="presentation" width="520" cellpadding="0" cellspacing="0" style="width:520px;max-width:100%;">
      <tr><td style="padding-bottom:16px;font-family:'Manrope',-apple-system,'Segoe UI',Helvetica,Arial,sans-serif;font-size:20px;font-weight:800;letter-spacing:-1.2px;color:#241b3a;">Pryva</td></tr>
      <tr><td style="border-radius:22px;background:#fffdfa;border:1px solid #e7e0ee;box-shadow:0 22px 40px -26px rgba(45,30,80,0.55);padding:26px 24px;">
        <h1 style="margin:0 0 12px;font-family:'Manrope',-apple-system,'Segoe UI',Helvetica,Arial,sans-serif;font-size:22px;font-weight:800;color:#241b3a;">${escapeHtml(copy.heading)}</h1>
        <p style="margin:0 0 14px;font-size:14px;line-height:1.7;color:#5b4f6b;">Hi ${safeName}, ${escapeHtml(copy.body)}</p>
        <p style="margin:0;font-size:12px;color:#8a7f97;">${escapeHtml(at)} · Pryva Technologies, Lagos</p>
      </td></tr>
    </table>
  </td></tr></table></body></html>`;

  const text = [
    copy.heading,
    "",
    `Hi ${safeName}, ${copy.body}`,
    "",
    at,
    "Pryva Technologies · Lagos, Nigeria",
  ].join("\n");

  return { subject: copy.subject, html, text };
}

export type SecurityNoticeResult = { sent: boolean; detail: string | null };

/** Never throws. A notice is important; the action that triggered it matters more. */
export async function sendSecurityNotice(input: {
  to: string;
  name: string;
  event: SecurityEvent;
  when?: Date;
}): Promise<SecurityNoticeResult> {
  try {
    if (!resendConfigured()) return { sent: false, detail: "mail not configured" };
    if (!/^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/.test(input.to) || input.to.length > 200) {
      return { sent: false, detail: "invalid recipient" };
    }
    const notice = buildSecurityNotice(input.event, input.name, input.when ?? new Date());
    const response = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${process.env.RESEND_API_KEY!.trim()}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ from: process.env.RESEND_FROM_EMAIL!.trim(), to: [input.to], ...notice }),
      signal: AbortSignal.timeout(8_000),
    });
    if (!response.ok) {
      logger.warn("Security notice refused by the mail provider", { event: input.event, status: response.status });
      return { sent: false, detail: `provider ${response.status}` };
    }
    return { sent: true, detail: null };
  } catch (error) {
    logger.warn("Security notice failed", {
      event: input.event,
      error: error instanceof Error ? error.message : String(error),
    });
    return { sent: false, detail: "send failed" };
  }
}
