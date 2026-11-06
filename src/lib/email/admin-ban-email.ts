import "server-only";

import { after } from "next/server";
import { isPreviewDatabase } from "@/lib/platform/demo-policy";
import { brandedNotificationEmail } from "@/lib/email/email-templates";
import { logger } from "@/lib/platform/logger";
import { readJsonWithLimit } from "@/lib/platform/request-body";
import { resendConfigured } from "@/lib/email/resend-config";

export type AdminBanNotice = {
  to: string;
  when: Date;
  confirmUrl: string;
  reason: string | null;
  bannedBy: string;
};

/**
 * A confirmation notice to the account whose closure an operator requested.
 * No credentials, balances, or financial references appear here.
 */
export function buildAdminBanEmail(input: AdminBanNotice) {
  if (!Number.isFinite(input.when.getTime())) throw new Error("Invalid notification data");
  const at = input.when.toISOString().replace("T", " ").slice(0, 16) + " UTC";
  const reasonLine = input.reason ? `Reason: ${input.reason}` : "No reason was given.";
  return brandedNotificationEmail({
    subject: "Your Pryva account is being closed",
    eyebrow: "Account closure requested",
    title: "Confirm account closure",
    intro: `An administrator acting as ${input.bannedBy} has requested that your Pryva account be closed. To confirm, open this link:\n${input.confirmUrl}\n\nYour account will be closed and you will be signed out when you confirm. Financial and security records are retained as required for disputes and legal obligations. ${reasonLine}`,
    hero: "account-closed",
    heroAlt: "A closed door and privacy shield",
    rows: [
      { label: "Requested", value: at },
      { label: "Confirm by", value: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString().replace("T", " ").slice(0, 16) + " UTC" },
    ],
    ctaPath: "/contact",
    ctaLabel: "Contact support",
    note: `Confirm the closure by clicking the link in this email. If you did not request this, contact support immediately and do not click the button. The link expires in 24 hours. Pryva will never ask for your password or security codes by email.`,
  });
}

/**
 * One bounded, best-effort send. Never logs a recipient or provider body.
 */
export async function sendAdminBanEmail(input: AdminBanNotice): Promise<boolean> {
  try {
    if (!resendConfigured()) {
      logger.warn("Admin ban notice skipped: mail not configured");
      return false;
    }
    if (!/^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/.test(input.to) || input.to.length > 200) {
      logger.warn("Admin ban notice skipped: invalid recipient");
      return false;
    }
    const notice = buildAdminBanEmail(input);
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
      logger.warn("Admin ban notice refused", { status: response.status });
      return false;
    }
    let data: unknown;
    try { data = await readJsonWithLimit(response, 32_768); } catch { /* Acceptance is unconfirmed. */ }
    const id = data && typeof data === "object" && !Array.isArray(data) ? (data as { id?: unknown }).id : null;
    if (typeof id !== "string" || id.length === 0 || id.length > 100) {
      logger.warn("Admin ban notice acceptance unconfirmed");
      return false;
    }
    return true;
  } catch {
    logger.warn("Admin ban notice failed or timed out");
    return false;
  }
}

/**
 * Holds the send in memory after the ban request commits. A lost callback is
 * not retried; the ban request remains pending and can be re-initiated.
 */
export function scheduleAdminBanEmail(input: AdminBanNotice): void {
  if (isPreviewDatabase()) return;
  try {
    after(async () => { await sendAdminBanEmail(input); });
  } catch {
    logger.warn("Admin ban notice could not be scheduled");
  }
}
