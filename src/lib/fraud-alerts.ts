import { and, eq, gte } from "drizzle-orm";

import { db } from "@/db";
import { fraudEvents, users } from "@/db/schema";
import { fraudAlertEmail } from "@/lib/email-templates";
import { logger } from "@/lib/logger";
import { resendConfigured } from "@/lib/resend-config";

/**
 * Email notifications for the fraud controls.
 *
 * The queue at `/admin/security` is the place a decision is made. This module is
 * only the doorbell: it tells an operator that something landed in the queue, and
 * nothing else. Two rules follow from that and are enforced here rather than left
 * to call sites:
 *
 *   • **Only `high` events are mailed.** `warn` and `info` stay in the queue. An
 *     inbox that fires on every two-reason withdrawal stops being read, which is
 *     the same as having no alert at all.
 *   • **One alert per account and signal per window.** A script that trips a
 *     ceiling forty times must not send forty emails; the first one carries the
 *     same information, and the queue holds the rest.
 *
 * Sending is best effort in the strictest sense. It never throws, it runs after
 * the fraud row is committed, and a mail outage cannot fail a purchase, a payout
 * or a referral.
 */

/** Suppress repeats of the same signal on the same account inside this window. */
export const FRAUD_ALERT_WINDOW_MS = 30 * 60 * 1000;

/** An inbox copy for a handful of operators, not a mailing list. */
export const FRAUD_ALERT_MAX_RECIPIENTS = 5;

/**
 * Resend accepts one request per message, so a list is sent to as `to` — which
 * also means every operator sees the others' addresses. Acceptable for an
 * internal alert, and documented in the runbook.
 */
const EMAIL_PATTERN = /^[^\s@,;]+@[^\s@,;]+\.[^\s@,;]{2,}$/;

/**
 * Who receives a fraud alert.
 *
 * `FRAUD_ALERT_EMAIL` exists so alerts can go to a shared security inbox instead
 * of the people who sign in to the console. When it is unset the list falls back
 * to `ADMIN_EMAILS`, the same source the admin gate already trusts, so a fresh
 * deployment with only `ADMIN_EMAILS` configured still gets mail. Junk entries are
 * dropped rather than passed to the mail API, and the list is capped and
 * de-duplicated because a duplicated address means a duplicated alert.
 */
export function fraudAlertRecipients(env: NodeJS.ProcessEnv = process.env): string[] {
  const raw = env.FRAUD_ALERT_EMAIL?.trim() || env.ADMIN_EMAILS?.trim() || "";
  const seen = new Set<string>();
  for (const part of raw.split(/[,;\s]+/)) {
    const address = part.trim().toLowerCase();
    if (!address || seen.has(address) || !EMAIL_PATTERN.test(address)) continue;
    seen.add(address);
    if (seen.size >= FRAUD_ALERT_MAX_RECIPIENTS) break;
  }
  return [...seen];
}

/**
 * Which severities earn an email. Kept as a function so the rule lives in one
 * place and the tests describe it in words.
 */
export function shouldEmailFraudEvent(severity: string | null | undefined): boolean {
  return severity === "high";
}

type AlertRow = {
  id: string;
  kind: string;
  severity: string;
  reasons: string | null;
  amount: number | null;
  reference: string | null;
  userId: string | null;
  createdAt: Date;
};

/**
 * Send the operator alert for one queued event.
 *
 * Returns whether a message was actually handed to Resend. Every early return is
 * a silent, logged no-op: no key, nobody to mail, a low-severity event, a repeat
 * inside the window, an event that no longer exists.
 */
export async function sendFraudAlertForEvent(eventId: string): Promise<boolean> {
  const key = process.env.RESEND_API_KEY?.trim();
  const from = process.env.RESEND_FROM_EMAIL?.trim();
  if (!resendConfigured()) return false;

  const recipients = fraudAlertRecipients();
  if (recipients.length === 0) {
    logger.warn("Fraud alert not emailed: no FRAUD_ALERT_EMAIL or ADMIN_EMAILS configured", { eventId });
    return false;
  }

  try {
    const [event] = (await db
      .select({
        id: fraudEvents.id,
        kind: fraudEvents.kind,
        severity: fraudEvents.severity,
        reasons: fraudEvents.reasons,
        amount: fraudEvents.amount,
        reference: fraudEvents.reference,
        userId: fraudEvents.userId,
        createdAt: fraudEvents.createdAt,
      })
      .from(fraudEvents)
      .where(eq(fraudEvents.id, eventId))
      .limit(1)) as AlertRow[];

    if (!event) return false;
    if (!shouldEmailFraudEvent(event.severity)) return false;

    // One alert per account and signal inside the window. The event just written
    // is inside it, so `> 1` means an earlier one already rang.
    if (event.userId) {
      const recent = await db
        .select({ id: fraudEvents.id })
        .from(fraudEvents)
        .where(
          and(
            eq(fraudEvents.userId, event.userId),
            eq(fraudEvents.kind, event.kind),
            gte(fraudEvents.createdAt, new Date(event.createdAt.getTime() - FRAUD_ALERT_WINDOW_MS)),
          ),
        );
      if (recent.length > 1) return false;
    }

    let accountEmail: string | null = null;
    if (event.userId) {
      const [account] = await db
        .select({ email: users.email })
        .from(users)
        .where(eq(users.id, event.userId))
        .limit(1);
      accountEmail = account?.email ?? null;
    }

    const template = fraudAlertEmail({
      kind: event.kind,
      severity: event.severity === "high" ? "high" : event.severity === "warn" ? "warn" : "info",
      reasons: (event.reasons ?? "").split(";").map((reason) => reason.trim()).filter(Boolean),
      amount: event.amount === null ? null : Number(event.amount),
      reference: event.reference,
      accountEmail,
      detectedAt: event.createdAt,
    });

    await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        from,
        to: recipients,
        subject: template.subject,
        html: template.html,
        text: template.text,
      }),
      // A mail API that hangs must not hold a withdrawal open.
      signal: AbortSignal.timeout(5_000),
    });

    logger.info("Fraud alert emailed", { eventId, kind: event.kind, recipients: recipients.length });
    return true;
  } catch (error) {
    logger.warn("Fraud alert email failed", {
      eventId,
      error: error instanceof Error ? error.message : "unknown",
    });
    return false;
  }
}
