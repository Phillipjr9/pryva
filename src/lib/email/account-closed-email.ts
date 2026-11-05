import "server-only";

import { after } from "next/server";
import { isPreviewDatabase } from "@/lib/platform/demo-policy";
import { brandedNotificationEmail } from "@/lib/email/email-templates";
import { logger } from "@/lib/platform/logger";
import { readJsonWithLimit } from "@/lib/platform/request-body";
import { resendConfigured } from "@/lib/email/resend-config";

export type AccountClosedNotice = { to: string; when: Date };

/**
 * A confirmation to the formerly verified address, after the closure commits.
 * No name, account id, balances, financial references or sign-in links appear.
 */
export function buildAccountClosedEmail(when: Date) {
  if (!Number.isFinite(when.getTime())) throw new Error("Invalid notification data");
  const at = when.toISOString().replace("T", " ").slice(0, 16) + " UTC";
  return brandedNotificationEmail({
    subject: "Your Pryva account was closed",
    eyebrow: "Account closure",
    title: "Your account is closed",
    intro: "Your Pryva account has been closed and you have been signed out. Some financial and security records are retained as explained when you closed it.",
    hero: "account-closed",
    heroAlt: "A closed door and privacy shield",
    rows: [{ label: "Closed", value: at }],
    ctaPath: "/contact",
    ctaLabel: "Contact support",
    note: "If you did not request this, contact support immediately. Pryva will never ask for your password or security codes by email.",
  });
}

/**
 * One bounded, best-effort attempt; never logs a recipient or provider body.
 * Sending cannot be used as evidence of inbox delivery. No retry record is kept,
 * because that would preserve the address after the user requested its removal.
 */
export async function sendAccountClosedEmail(input: AccountClosedNotice): Promise<boolean> {
  try {
    if (!resendConfigured()) {
      logger.warn("Account closure notice skipped: mail not configured");
      return false;
    }
    if (!/^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/.test(input.to) || input.to.length > 200) {
      logger.warn("Account closure notice skipped: invalid recipient");
      return false;
    }
    const notice = buildAccountClosedEmail(input.when);
    const response = await fetch("https://api.resend.com/emails", {
      method: "POST",
      redirect: "error",
      cache: "no-store",
      headers: {
        Authorization: `Bearer ${process.env.RESEND_API_KEY!.trim()}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ from: process.env.RESEND_FROM_EMAIL!.trim(), to: [input.to], ...notice }),
      signal: AbortSignal.timeout(8_000),
    });
    if (!response.ok) {
      logger.warn("Account closure notice refused", { status: response.status });
      return false;
    }
    let data: unknown;
    try { data = await readJsonWithLimit(response, 32_768); } catch { /* Acceptance is unconfirmed. */ }
    const id = data && typeof data === "object" && !Array.isArray(data) ? (data as { id?: unknown }).id : null;
    if (typeof id !== "string" || id.length === 0 || id.length > 100) {
      logger.warn("Account closure notice acceptance unconfirmed");
      return false;
    }
    return true;
  } catch {
    // Provider errors can include the recipient; do not serialize the error.
    logger.warn("Account closure notice failed or timed out");
    return false;
  }
}

/**
 * The route calls this only after a successful commit and only for a verified
 * address captured under the account lock. `after` holds it in memory briefly;
 * neither a queue nor a log persists it. A lost callback is not retried.
 */
export function scheduleAccountClosedEmail(input: AccountClosedNotice): void {
  if (isPreviewDatabase()) return;
  try {
    after(async () => { await sendAccountClosedEmail(input); });
  } catch {
    logger.warn("Account closure notice could not be scheduled");
  }
}
