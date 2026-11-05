import "server-only";
import { and, desc, eq, gt, inArray, sql } from "drizzle-orm";

import { db } from "@/db";
import { emailDeliveryEvents, onboardingEmailLog, walletEmailOutbox } from "@/db/schema";
import { logger } from "@/lib/platform/logger";
import type { EmailOutcome } from "@/lib/email/resend-webhook";

/**
 * A receipt for every delivery event Resend reports, so "did it arrive?" is a
 * fact rather than an assumption.
 *
 * `wallet_email_outbox.status = 'sent'` means Resend accepted the message. It does
 * not mean a mailbox received it: a hard bounce, a spam foldering and an address
 * that never existed are indistinguishable at that point. The first evidence of
 * any of them was a customer asking where the code was.
 *
 * Same contract as `recordWebhookEvent`, for the same reasons:
 *
 *  • best-effort and never in front of anything that matters — a logging outage
 *    must not turn an acknowledged webhook into a provider retry storm;
 *  • an unverified body stores no event name, no message id and no domain,
 *    because it is an attacker's text, not data;
 *  • no address is kept, only the recipient's domain.
 */

const MAX_ID = 100;
const MAX_DOMAIN = 200;

function bounded(value: unknown, max: number): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (!trimmed || trimmed.length > max) return null;
  return trimmed;
}

export async function recordEmailDeliveryEvent(params: {
  /** The Svix message id, which collapses provider redeliveries. */
  providerEventId: unknown;
  event: string | null;
  messageId?: unknown;
  recipientDomain?: string | null;
  signatureValid: boolean;
  outcome: EmailOutcome;
}): Promise<void> {
  try {
    const providerEventId = params.signatureValid
      ? bounded(params.providerEventId, MAX_ID)
      : null;
    const messageId = params.signatureValid ? bounded(params.messageId, MAX_ID) : null;
    const domain = params.signatureValid
      ? bounded(params.recipientDomain, MAX_DOMAIN)
      : null;

    await db
      .insert(emailDeliveryEvents)
      .values({
        providerEventId,
        // An unverified body contributes no text at all.
        event: params.signatureValid ? (params.event ?? "unknown") : "unverified",
        messageId,
        recipientDomain: domain,
        signatureValid: params.signatureValid,
        outcome: params.outcome,
      })
      // At-least-once delivery: the same Svix id may arrive twice. The second is a
      // no-op rather than a second bounce.
      .onConflictDoNothing();
  } catch (error) {
    logger.warn("Email delivery event could not be recorded", {
      outcome: params.outcome,
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

export type EmailHealthVerdict = "silent" | "receiving" | "delivering" | "failing";

/**
 * The one verdict an operator needs, and the counts behind it.
 *
 * `silent` means no event has ever arrived: the webhook is not configured at
 * Resend, or the endpoint fails before it can record anything. `failing` means
 * events arrive but bounces and complaints dominate — usually a sender address
 * that does not match the verified domain.
 */
export async function recentEmailActivity(options: { sinceHours?: number } = {}) {
  const sinceHours = options.sinceHours ?? 24 * 7;
  const since = new Date(Date.now() - sinceHours * 3_600_000);

  const counts = await db
    .select({ outcome: emailDeliveryEvents.outcome, total: sql<number>`count(*)::int` })
    .from(emailDeliveryEvents)
    .where(gt(emailDeliveryEvents.receivedAt, since))
    .groupBy(emailDeliveryEvents.outcome);

  const latest = await db
    .select({
      event: emailDeliveryEvents.event,
      outcome: emailDeliveryEvents.outcome,
      recipientDomain: emailDeliveryEvents.recipientDomain,
      signatureValid: emailDeliveryEvents.signatureValid,
      receivedAt: emailDeliveryEvents.receivedAt,
    })
    .from(emailDeliveryEvents)
    .orderBy(desc(emailDeliveryEvents.receivedAt))
    .limit(15);

  const refused = await countRefused(since);

  const byOutcome = Object.fromEntries(counts.map((row) => [row.outcome, Number(row.total)]));
  const delivered = byOutcome.delivered ?? 0;
  const failed = (byOutcome.bounced ?? 0) + (byOutcome.complained ?? 0);
  const total = Object.values(byOutcome).reduce((sum, n) => sum + n, 0);

  const verdict: EmailHealthVerdict =
    total === 0 ? "silent" : failed > 0 && failed >= delivered ? "failing" : delivered > 0 ? "delivering" : "receiving";

  return {
    windowHours: sinceHours,
    verdict,
    explanation:
      verdict === "silent"
        ? "No delivery event has been recorded in this window. Either the webhook URL is not saved in Resend, or the endpoint is failing before it can log. Until then 'sent' only means Resend accepted the message."
        : verdict === "failing"
          ? "Events are arriving but bounces or complaints equal or exceed deliveries. Check that RESEND_FROM_EMAIL uses the verified domain and that its DNS records still validate in Resend."
          : verdict === "delivering"
            ? "Deliveries are being confirmed by the provider."
            : "Events are arriving, but none of them is a confirmed delivery yet.",
    counts: byOutcome,
    refusedSignatures: refused,
    latest,
  };
}

async function countRefused(since: Date): Promise<number> {
  try {
    const [row] = await db
      .select({ total: sql<number>`count(*)::int` })
      .from(emailDeliveryEvents)
      .where(
        and(
          eq(emailDeliveryEvents.signatureValid, false),
          gt(emailDeliveryEvents.receivedAt, since),
        ),
      );
    return Number(row?.total ?? 0);
  } catch {
    return 0;
  }
}

/**
 * Aggregate the durable queue for operators without exposing addresses, order
 * details or saved message bodies. Review jobs require a human decision; pending
 * failures may recover on the next worker retry. Both must be visible even when
 * no Resend webhook was ever delivered.
 */
export async function emailQueueStatus() {
  const groups = await db.select({
    status: walletEmailOutbox.status,
    eventKind: walletEmailOutbox.eventKind,
    reason: walletEmailOutbox.lastError,
    total: sql<number>`count(*)::int`,
  }).from(walletEmailOutbox)
    .where(inArray(walletEmailOutbox.status, ["pending", "sending", "review"]))
    .groupBy(walletEmailOutbox.status, walletEmailOutbox.eventKind, walletEmailOutbox.lastError);
  const counts = { pending: 0, sending: 0, review: 0 };
  for (const group of groups) {
    if (group.status in counts) counts[group.status as keyof typeof counts] += Number(group.total);
  }
  const onboarding = await db.select({
    status: onboardingEmailLog.status,
    kind: onboardingEmailLog.kind,
    total: sql<number>`count(*)::int`,
  }).from(onboardingEmailLog)
    .where(inArray(onboardingEmailLog.status, ["pending", "refused", "skipped", "review"]))
    .groupBy(onboardingEmailLog.status, onboardingEmailLog.kind);
  return {
    ...counts,
    groups: groups.map((group) => ({ ...group, total: Number(group.total) })),
    onboarding: onboarding.map((group) => ({ ...group, total: Number(group.total) })),
  };
}
