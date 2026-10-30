import { createHash } from "node:crypto";
import { and, desc, eq } from "drizzle-orm";
import { db } from "@/db";
import { disposableInboxes, inboxMessages } from "@/db/schema";
import {
  buyFleexaEmail,
  cancelFleexaEmail,
  checkFleexaEmail,
  isFleexaConfigured,
  type FleexaEmailMessage,
} from "@/lib/fleexa";
import { logger } from "@/lib/logger";

/**
 * The free disposable inbox.
 *
 * This is the one thing Pryva gives away, and it is built to be outgrown rather
 * than to compete with the paid catalogue: one inbox a day, alive until the
 * customer discards it, and nothing retained afterwards. The paid tier that will
 * sit beside it sells volume and history, not time — the supplier sets an
 * inbox's own lifetime and sells no duration, which is what made four
 * duration-based tiers undeliverable when they were tried.
 *
 * Two limits are enforced by the database rather than here, because both are
 * decided by two requests arriving at once and creating an inbox spends real
 * money the moment the supplier accepts it. What this module owns is reacting
 * correctly when the database says no.
 */

export const INBOX_PROVIDER = "fleexa";

/** One free inbox per account per day. The database enforces it; this documents it. */
export const FREE_INBOXES_PER_DAY = 1;

export type InboxErrorCode =
  | "NOT_CONFIGURED"
  | "DAILY_LIMIT"
  | "ALREADY_ACTIVE"
  | "NOT_FOUND"
  | "PROVIDER_FAILED"
  | "RECONCILE_FAILED";

export class InboxError extends Error {
  constructor(
    readonly code: InboxErrorCode,
    readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = "InboxError";
  }
}

/**
 * The daily key the unique index counts on.
 *
 * UTC rather than the server's or the customer's local date, so the day a cap
 * resets does not depend on where a request happened to be served from — and so
 * two instances cannot disagree about which day it is and let a customer take two
 * inboxes.
 */
export function dailyKeyFor(userId: string, now: Date = new Date()): string {
  return `${userId}:${now.toISOString().slice(0, 10)}`;
}

/**
 * A hash of the parts of a message that distinguish it from its neighbours.
 *
 * The supplier gives its messages no identity of their own and polling re-reads
 * the entire mailbox, so without a stable fingerprint every refresh would insert
 * the mailbox again. The body is truncated before hashing: it can be large, and
 * only enough of it is needed to tell two messages with the same subject and
 * sender apart.
 */
export function messageFingerprint(message: FleexaEmailMessage): string {
  const material = [
    message.subject ?? "",
    message.from ?? "",
    message.receivedAt ?? "",
    (message.body ?? "").slice(0, 512),
  ].join("\u0000");
  return createHash("sha256").update(material).digest("hex");
}

function parseExpiry(value: string | null): Date | null {
  if (!value) return null;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

/** Which unique index refused the insert, so the customer gets the true reason. */
function classifyUniqueViolation(error: unknown): InboxErrorCode | null {
  const message = error instanceof Error ? error.message : String(error);
  if (message.includes("disposable_inboxes_free_daily_key")) return "DAILY_LIMIT";
  if (message.includes("disposable_inboxes_one_active_free_per_user")) return "ALREADY_ACTIVE";
  return null;
}

export type CreatedInbox = {
  id: string;
  address: string;
  domain: string | null;
  tier: string;
  status: string;
  expiresAt: string | null;
  createdAt: string;
};

/**
 * Buy a free inbox.
 *
 * The supplier is called before the row is written, because the address and the
 * provider's handle only exist once it has accepted the purchase. That order is
 * the reason the compensation below exists: if the database then refuses the row
 * — the customer already used today's free inbox, or two requests raced — we are
 * holding an inbox we have paid for and cannot record. Cancelling it is what
 * keeps a limit from becoming a way to spend money on nothing.
 */
export async function createFreeInbox(userId: string): Promise<CreatedInbox> {
  if (!isFleexaConfigured()) {
    throw new InboxError("NOT_CONFIGURED", 503, "Temporary inboxes are not available yet.");
  }

  const purchased = await buyFleexaEmail();
  const dailyKey = dailyKeyFor(userId);

  try {
    const [row] = await db
      .insert(disposableInboxes)
      .values({
        userId,
        provider: INBOX_PROVIDER,
        providerInboxId: purchased.emailId,
        address: purchased.address,
        domain: null,
        tier: "free",
        status: "active",
        dailyKey,
        expiresAt: parseExpiry(purchased.expiresAt),
      })
      .returning();

    return {
      id: row.id,
      address: row.address,
      domain: row.domain,
      tier: row.tier,
      status: row.status,
      expiresAt: row.expiresAt ? row.expiresAt.toISOString() : null,
      createdAt: row.createdAt.toISOString(),
    };
  } catch (error) {
    const code = classifyUniqueViolation(error);
    if (!code) throw error;

    // Compensate: give the purchased inbox back so the refused request does not
    // consume anything. A failure to cancel is logged and does not change the
    // answer to the customer — the limit still stands either way.
    try {
      await cancelFleexaEmail(purchased.emailId);
    } catch (cancelError) {
      logger.error("Could not cancel an inbox the daily limit refused", {
        userId,
        code,
        reason: cancelError instanceof Error ? cancelError.message : String(cancelError),
      });
    }

    throw new InboxError(
      code,
      429,
      code === "DAILY_LIMIT"
        ? `You have used your free inbox for today. The limit is ${FREE_INBOXES_PER_DAY} per day.`
        : "You already have an active inbox. Discard it before creating another.",
    );
  }
}

export type InboxView = {
  id: string;
  address: string;
  tier: string;
  status: string;
  expiresAt: string | null;
  createdAt: string;
  discardedAt: string | null;
};

function viewOf(row: typeof disposableInboxes.$inferSelect): InboxView {
  return {
    id: row.id,
    address: row.address,
    tier: row.tier,
    status: row.status,
    expiresAt: row.expiresAt ? row.expiresAt.toISOString() : null,
    createdAt: row.createdAt.toISOString(),
    discardedAt: row.discardedAt ? row.discardedAt.toISOString() : null,
  };
}

/** This customer's inboxes, newest first. Never another customer's. */
export async function listInboxes(userId: string, limit = 20): Promise<InboxView[]> {
  const rows = await db
    .select()
    .from(disposableInboxes)
    .where(eq(disposableInboxes.userId, userId))
    .orderBy(desc(disposableInboxes.createdAt))
    .limit(limit);
  return rows.map(viewOf);
}

async function ownInbox(userId: string, inboxId: string) {
  const [row] = await db
    .select()
    .from(disposableInboxes)
    // Ownership is part of the lookup rather than a check afterwards, so there is
    // no path that reads somebody else's inbox and then decides not to return it.
    .where(and(eq(disposableInboxes.id, inboxId), eq(disposableInboxes.userId, userId)))
    .limit(1);
  if (!row) throw new InboxError("NOT_FOUND", 404, "That inbox does not exist.");
  return row;
}

export type InboxMessageView = {
  subject: string | null;
  from: string | null;
  body: string | null;
  code: string | null;
  receivedAt: string | null;
};

export type PollResult = {
  inbox: InboxView;
  messages: InboxMessageView[];
  code: string | null;
  /** Whether the messages came from storage rather than a live provider read. */
  stored: boolean;
};

/**
 * Read what has arrived in an inbox.
 *
 * A free inbox is read live and never stored: keeping nothing is the difference
 * between the free tier and the paid one, and it is also what stops a free
 * mailbox from becoming a permanent store of somebody's verification codes. A
 * paid inbox retains every message, because that retention is the product, and
 * the fingerprint index makes re-reading it idempotent.
 */
export async function pollInbox(userId: string, inboxId: string): Promise<PollResult> {
  const row = await ownInbox(userId, inboxId);
  if (row.status !== "active") {
    // A discarded or expired inbox can still have retained messages worth
    // showing, but there is nothing left to poll at the provider.
    const stored = await storedMessages(row.id);
    return { inbox: viewOf(row), messages: stored, code: stored.find((m) => m.code)?.code ?? null, stored: true };
  }

  const checked = await checkFleexaEmail(row.providerInboxId);

  if (row.tier === "paid") {
    await db
      .insert(inboxMessages)
      .values(
        checked.messages.map((message) => ({
          inboxId: row.id,
          userId,
          fingerprint: messageFingerprint(message),
          subject: message.subject,
          fromAddress: message.from,
          body: message.body,
          code: message.code,
          receivedAt: parseExpiry(message.receivedAt),
        })),
      )
      // The whole point: a repeated poll inserts nothing new.
      .onConflictDoNothing();
    const stored = await storedMessages(row.id);
    return { inbox: viewOf(row), messages: stored, code: checked.code ?? stored.find((m) => m.code)?.code ?? null, stored: true };
  }

  const messages: InboxMessageView[] = checked.messages.map((message) => ({
    subject: message.subject,
    from: message.from,
    body: message.body,
    code: message.code,
    receivedAt: message.receivedAt,
  }));
  return { inbox: viewOf(row), messages, code: checked.code ?? messages.find((m) => m.code)?.code ?? null, stored: false };
}

async function storedMessages(inboxId: string): Promise<InboxMessageView[]> {
  const rows = await db
    .select()
    .from(inboxMessages)
    .where(eq(inboxMessages.inboxId, inboxId))
    .orderBy(desc(inboxMessages.receivedAt));
  return rows.map((row) => ({
    subject: row.subject,
    from: row.fromAddress,
    body: row.body,
    code: row.code,
    receivedAt: row.receivedAt ? row.receivedAt.toISOString() : null,
  }));
}

/**
 * Discard an inbox: cancel it at the supplier and mark it gone.
 *
 * The provider is called first and the row is only marked discarded once that
 * succeeds. The opposite order would let a failed cancellation leave the
 * customer looking at an inbox that is still alive and still receiving mail
 * somewhere they can no longer see — which for a verification code is the one
 * outcome worse than an error.
 *
 * Retained messages are deliberately not deleted: for a paid inbox they are what
 * was purchased, and they go when the account does, by cascade.
 */
export async function discardInbox(userId: string, inboxId: string): Promise<InboxView> {
  const row = await ownInbox(userId, inboxId);
  if (row.status !== "active") return viewOf(row);

  await cancelFleexaEmail(row.providerInboxId);

  const [updated] = await db
    .update(disposableInboxes)
    .set({ status: "discarded", discardedAt: new Date() })
    // Guarded on the status still being active, so two concurrent discards cannot
    // both believe they were the one that closed it.
    .where(and(eq(disposableInboxes.id, row.id), eq(disposableInboxes.status, "active")))
    .returning();

  if (!updated) throw new InboxError("RECONCILE_FAILED", 409, "That inbox changed while you were discarding it.");
  return viewOf(updated);
}
