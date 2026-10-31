import "server-only";
import { and, desc, eq, gt, sql } from "drizzle-orm";

import { db } from "@/db";
import { webhookEvents } from "@/db/schema";
import { logger } from "@/lib/logger";

/**
 * A receipt for every webhook delivery, so "is it arriving?" is a fact.
 *
 * The endpoint can fail in ways that leave no trace on the delivery itself: a
 * wrong URL, a deployment error, a signature computed with a rotated key, an event
 * type that was filtered at the provider. From the outside all of them look the
 * same — nothing happens — and until this table existed the only way to notice was
 * a customer asking why their payout still said "Sent to bank".
 *
 * ## Never in front of the money
 *
 * `recordWebhookEvent` is best-effort and swallows its own failures: it runs after
 * the settlement decision, and a logging outage must not turn a settled payout into
 * a redelivered event. The settlement row and the ledger are the record of what
 * happened; this is the record of what *arrived*.
 *
 * ## What is deliberately not stored
 *
 * No payload, no bank details, no customer name, no email. A refused signature
 * stores neither the claimed event nor its reference, because an unverified body is
 * an attacker's text, not data.
 */

export type WebhookOutcome =
  | "settled"
  | "refunded"
  | "sent"
  | "already_settled"
  | "already_failed"
  | "held"
  | "unknown_reference"
  | "mismatch"
  | "credited"
  | "duplicate"
  | "ignored"
  | "rejected_signature"
  | "rejected_details";

const MAX_EVENT = 60;
const MAX_REFERENCE = 60;

/** The provider sends an event name; ours is a closed vocabulary, capped in size. */
function normalise(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (!trimmed || trimmed.length > MAX_EVENT) return null;
  return trimmed;
}

export async function recordWebhookEvent(params: {
  /** The event name as delivered. Ignored when the signature failed. */
  event: unknown;
  reference?: unknown;
  signatureValid: boolean;
  outcome: WebhookOutcome;
}): Promise<void> {
  try {
    const event = params.signatureValid ? normalise(params.event) : null;
    const reference = params.signatureValid && typeof params.reference === "string" && params.reference.length <= MAX_REFERENCE
      ? params.reference
      : null;

    await db.insert(webhookEvents).values({
      // An unverified body is not trusted, so it contributes no text at all.
      event: event ?? (params.signatureValid ? "unknown" : "unverified"),
      reference,
      signatureValid: params.signatureValid,
      outcome: params.outcome,
    });
  } catch (error) {
    logger.warn("Webhook delivery could not be recorded", {
      outcome: params.outcome,
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

/**
 * What arrived recently, and the one verdict an operator needs.
 *
 * `silent` is the state that matters: no delivery at all means the endpoint is not
 * wired (or the provider is not sending), and every payout will then depend on the
 * nightly sweep. `only_topups` means the endpoint works but transfer events are not
 * subscribed — top-ups settle in seconds while payouts wait for a person.
 */
export async function recentWebhookActivity(options: { sinceHours?: number } = {}) {
  const sinceHours = options.sinceHours ?? 24 * 7;
  const since = new Date(Date.now() - sinceHours * 3_600_000);

  const counts = await db
    .select({ event: webhookEvents.event, total: sql<number>`count(*)::int` })
    .from(webhookEvents)
    .where(gt(webhookEvents.receivedAt, since))
    .groupBy(webhookEvents.event);

  const latest = await db
    .select({
      event: webhookEvents.event,
      reference: webhookEvents.reference,
      signatureValid: webhookEvents.signatureValid,
      outcome: webhookEvents.outcome,
      receivedAt: webhookEvents.receivedAt,
    })
    .from(webhookEvents)
    .orderBy(desc(webhookEvents.receivedAt))
    .limit(15);

  const [lastOfAll] = await db
    .select({ receivedAt: webhookEvents.receivedAt })
    .from(webhookEvents)
    .orderBy(desc(webhookEvents.receivedAt))
    .limit(1);

  const byEvent = Object.fromEntries(counts.map((row) => [row.event, Number(row.total)]));
  const transfers = Object.entries(byEvent)
    .filter(([name]) => name.startsWith("transfer."))
    .reduce((sum, [, total]) => sum + total, 0);
  const topups = byEvent["charge.success"] ?? 0;
  const refused = await countRefused(since);

  const verdict = !lastOfAll ? "silent" : transfers > 0 ? "receiving" : topups > 0 ? "only_topups" : "silent";

  return {
    windowHours: sinceHours,
    verdict,
    explanation:
      verdict === "silent"
        ? "No signed delivery has been recorded in this window. Either the webhook URL is not saved at the provider, or the endpoint is failing before it can log. Until then, payouts settle only through the nightly sweep."
        : verdict === "only_topups"
          ? "Top-ups are arriving but no transfer event has been seen. The endpoint works; the provider is not sending payout events to it, so payouts wait for the nightly sweep. Check that transfer events are enabled for this webhook."
          : "Signed deliveries are arriving, including payout events.",
    lastDeliveryAt: lastOfAll?.receivedAt ?? null,
    counts: byEvent,
    refusedSignatures: refused,
    latest,
  };
}

async function countRefused(since: Date): Promise<number> {
  try {
    // Only deliveries in the window: an old forged request is history, a new one is
    // a signal that the key the sender is signing with is not the one we hold.
    const [row] = await db
      .select({ total: sql<number>`count(*)::int` })
      .from(webhookEvents)
      .where(and(eq(webhookEvents.signatureValid, false), gt(webhookEvents.receivedAt, since)));
    return Number(row?.total ?? 0);
  } catch {
    return 0;
  }
}

/**
 * Bound the table: a forged-request flood must not grow it without limit.
 * The settlement records are elsewhere and untouched by this.
 */
export async function pruneWebhookEvents(retainDays = 30): Promise<number> {
  const cutoff = new Date(Date.now() - retainDays * 86_400_000);
  const deleted = await db
    .delete(webhookEvents)
    .where(sql`${webhookEvents.receivedAt} < ${cutoff.toISOString()}`)
    .returning({ id: webhookEvents.id });
  return deleted.length;
}
