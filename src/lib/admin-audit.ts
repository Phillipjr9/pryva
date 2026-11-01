import { db } from "@/db";
import { adminAuditLog } from "@/db/schema";
import { logger } from "@/lib/logger";
import type { PublicUser } from "@/lib/auth";

/**
 * The durable record of privileged administrative actions.
 *
 * ## Why it is best-effort rather than transactional
 *
 * The alternative is to require the audit insert to commit with the action, and
 * fail the action when it cannot. For money movement that is the wrong trade: a
 * refund whose wallet credit already committed must not be reported as failed
 * because the audit table is unavailable — the operator would retry and credit
 * twice, which is exactly the bug class this codebase spends its effort avoiding.
 * The wallet ledger is the authoritative financial record; this is the
 * who-did-it record beside it, and a lost entry is logged loudly rather than
 * silently swallowed.
 *
 * The cost is stated plainly: an entry can be missing if the insert fails. Any
 * action that moves money is also logged through `logger` with its identifiers,
 * so there are two places to look. Do not describe this table as complete.
 *
 * ## What must never go into `summary`
 *
 * Credentials, verification codes, full bank account numbers, supplier names and
 * wholesale costs. Write what an operator needs to reconstruct the decision: the
 * action, the target, the amount and the stated reason. The caller builds it.
 */

export type AdminAuditAction =
  | "order.refund"
  | "order.deliver"
  | "order.unavailable"
  | "withdrawal.approve"
  | "withdrawal.reject"
  | "withdrawal.complete"
  | "user.credit"
  | "user.debit"
  | "user.payout_name"
  | "user.payout_name_revoke"
  | "message.status"
  | "review.publish"
  | "review.reject"
  | "support.reply"
  | "fraud.review";

export type AdminAuditTargetType =
  | "order"
  | "withdrawal"
  | "user"
  | "message"
  | "gift_card"
  | "review"
  | "support_ticket"
  | "fraud_event";

type AuditActor = Pick<PublicUser, "id" | "email">;

const MAX_SUMMARY = 2_000;
const MAX_TARGET_ID = 191;

/**
 * Record one admin action. Never throws, never returns a failure to the caller.
 *
 * Resolves `true` when the row was written, so a caller or a test can tell the
 * difference between "recorded" and "could not record", while the action itself
 * has already succeeded either way.
 */
export async function recordAdminAction(params: {
  actor: AuditActor;
  action: AdminAuditAction;
  targetType: AdminAuditTargetType;
  targetId: string;
  summary: string;
}): Promise<boolean> {
  const targetId = params.targetId.slice(0, MAX_TARGET_ID);
  const summary = params.summary.slice(0, MAX_SUMMARY);

  try {
    await db.insert(adminAuditLog).values({
      actorId: params.actor.id,
      actorEmail: params.actor.email.slice(0, 200),
      action: params.action,
      targetType: params.targetType,
      targetId,
      summary,
    });
    return true;
  } catch (error) {
    // Deliberately loud: a missing audit entry is a real gap in the record, and
    // the identifiers here are the ones an operator needs to reconstruct it by
    // hand from the application log.
    logger.error("Failed to record an admin audit entry", {
      action: params.action,
      targetType: params.targetType,
      targetId,
      actorId: params.actor.id,
      error,
    });
    return false;
  }
}
