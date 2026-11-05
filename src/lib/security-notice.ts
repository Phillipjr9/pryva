import "server-only";

import { resendConfigured } from "@/lib/resend-config";
import { logger } from "@/lib/logger";
import { brandedNotificationEmail, type NotificationHero } from "@/lib/email-templates";
import { readJsonWithLimit } from "@/lib/request-body";

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
  | "two_factor_disabled"
  | "passkey_added"
  | "passkey_removed";

const COPY: Record<SecurityEvent, { subject: string; heading: string; body: string; hero: NotificationHero }> = {
  password_changed: {
    subject: "Your Pryva password was changed",
    heading: "Your password was changed",
    body: "Every other session was signed out. If this wasn't you, reset your password immediately and contact support.",
    hero: "password",
  },
  email_changed: {
    subject: "Your Pryva sign-in email was changed",
    heading: "Your sign-in email was changed",
    body: "This address is no longer the one used to sign in. If you didn't make this change, contact support immediately — a changed address is how an account is taken over.",
    hero: "email-changed",
  },
  two_factor_enabled: {
    subject: "Two-factor authentication is on",
    heading: "Two-factor authentication was turned on",
    body: "Signing in with a password now needs a code from your authenticator app. If this wasn't you, change your password and contact support.",
    hero: "two-factor-on",
  },
  two_factor_disabled: {
    subject: "Two-factor authentication was turned off",
    heading: "Two-factor authentication was turned off",
    body: "An authenticator code is no longer required when signing in with a password. If this wasn't you, turn two-factor back on and contact support.",
    hero: "two-factor-off",
  },
  passkey_added: {
    subject: "A passkey was added to your Pryva account",
    heading: "A passkey was added",
    body: "A new passkey can now be used to sign in. If you didn't add it, review your security settings and contact support immediately.",
    hero: "passkey-added",
  },
  passkey_removed: {
    subject: "A passkey was removed from your Pryva account",
    heading: "A passkey was removed",
    body: "A passkey was removed from your account. If you didn't remove it, review your security settings and contact support immediately.",
    hero: "passkey-removed",
  },
};

export function buildSecurityNotice(event: SecurityEvent, name: string, when: Date) {
  const copy = COPY[event];
  const displayName = name.replace(/[\u0000-\u001f\u007f]/g, " ").trim().slice(0, 80) || "there";
  const at = when.toISOString().replace("T", " ").slice(0, 16) + " UTC";
  return brandedNotificationEmail({
    subject: copy.subject,
    eyebrow: "Account security",
    title: copy.heading,
    intro: `Hi ${displayName}, ${copy.body}`,
    hero: copy.hero,
    heroAlt: copy.heading,
    rows: [{ label: "Recorded", value: at }],
    ctaPath: event === "password_changed" || event === "email_changed" ? "/forgot-password" : "/dashboard/security",
    ctaLabel: event === "password_changed" || event === "email_changed" ? "Secure my account" : "Review security",
    note: "Pryva will never ask for your password or security codes by email. If you didn't make this change, contact support immediately.",
  });
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
    if (!resendConfigured()) {
      logger.warn("Security notice skipped: mail not configured", { event: input.event });
      return { sent: false, detail: "mail not configured" };
    }
    if (!/^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/.test(input.to) || input.to.length > 200) {
      return { sent: false, detail: "invalid recipient" };
    }
    const notice = buildSecurityNotice(input.event, input.name, input.when ?? new Date());
    const response = await fetch("https://api.resend.com/emails", {
      method: "POST", redirect: "error", cache: "no-store",
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
    let data: unknown;
    try { data = await readJsonWithLimit(response, 32_768); } catch { /* Acceptance is unconfirmed. */ }
    const id = data && typeof data === "object" && !Array.isArray(data) ? (data as { id?: unknown }).id : null;
    if (typeof id !== "string" || id.length === 0 || id.length > 100) {
      logger.warn("Security notice acceptance unconfirmed", { event: input.event });
      return { sent: false, detail: "acceptance unconfirmed" };
    }
    return { sent: true, detail: null };
  } catch {
    logger.warn("Security notice failed or timed out", { event: input.event });
    return { sent: false, detail: "send failed" };
  }
}
