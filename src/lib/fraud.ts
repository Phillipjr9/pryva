import { createHash } from "node:crypto";
import { and, desc, eq, gte, inArray, isNull, sql } from "drizzle-orm";

import { db } from "@/db";
import {
  accountSignals,
  bankAccounts,
  fraudEvents,
  giftCards,
  orders,
  paymentTopups,
  users,
  withdrawals,
} from "@/db/schema";
import { clientIp } from "@/lib/auth-rate-limit";
import { sendFraudAlertForEvent } from "@/lib/fraud-alerts";
import { logger } from "@/lib/logger";

/**
 * Fraud controls.
 *
 * Three jobs, kept apart on purpose:
 *
 *   1. **Signals** — where an account came from, stored as a salted hash. This is
 *      the only record that makes multi-accounting visible; the raw address is
 *      never written down, so a backup cannot become a location history.
 *   2. **Assessment** — a money action is scored against facts the database
 *      already knows (account age, whether this payout account has ever been paid,
 *      deposit history, velocity, how many accounts share this network). The
 *      result is advisory: an operator reads it, no automated payment decision
 *      does.
 *   3. **Velocity** — hard ceilings that a script hits: purchases per hour, gift
 *      card redemptions per day. These are counted from the database rather than
 *      from memory, because an in-process counter is per-instance and a serverless
 *      deployment runs several.
 *
 * Every write here is best effort. A fraud control that can break a purchase, a
 * withdrawal or a signup is a bigger liability than the fraud it prevents.
 */

export type RiskLevel = "low" | "warn" | "high";
export type FraudSeverity = "info" | "warn" | "high";

export const PURCHASES_PER_HOUR = 40;
export const GIFT_CARDS_PER_DAY = 10;
export const WITHDRAWALS_PER_DAY = 3;
/** More than this many accounts on one network is a cluster worth reading. */
export const SHARED_NETWORK_ACCOUNTS = 3;

const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;

/**
 * A one-way fingerprint of a signup's network or device.
 *
 * Salted so that a hash cannot be matched against a precomputed table of IPv4
 * addresses — there are only 2^32 of them. Rotating `FRAUD_HASH_SALT` makes every
 * stored hash incomparable with new ones, which is why it is documented rather
 * than rotated casually.
 */
export function hashSignal(value: string | null | undefined, env: NodeJS.ProcessEnv = process.env): string | null {
  if (!value) return null;
  const trimmed = value.trim();
  if (!trimmed || trimmed === "unknown") return null;
  const salt = env.FRAUD_HASH_SALT?.trim() || "pryva-fraud-signal-v1";
  return createHash("sha256").update(`${salt}:${trimmed}`).digest("hex");
}

/** Record where an account was created from. Best effort, once per account. */
export async function recordSignupSignal(request: Request, userId: string): Promise<void> {
  try {
    const ipHash = hashSignal(clientIp(request));
    const userAgentHash = hashSignal(request.headers.get("user-agent"));
    if (!ipHash && !userAgentHash) return;
    await db.insert(accountSignals).values({ userId, ipHash, userAgentHash }).onConflictDoNothing();
  } catch (error) {
    logger.warn("Could not record signup signal", { error: error instanceof Error ? error.message : "unknown" });
  }
}

/** How many accounts were created from the same network as this one. */
export async function sharedNetworkAccounts(userId: string): Promise<{ accounts: number; ipHash: string | null }> {
  const [signal] = await db
    .select({ ipHash: accountSignals.ipHash })
    .from(accountSignals)
    .where(eq(accountSignals.userId, userId))
    .limit(1);
  if (!signal?.ipHash) return { accounts: 0, ipHash: null };
  const [row] = await db
    .select({ count: sql<number>`count(*)` })
    .from(accountSignals)
    .where(eq(accountSignals.ipHash, signal.ipHash));
  return { accounts: Number(row?.count ?? 0), ipHash: signal.ipHash };
}

/** Whether two accounts were created from the same network. */
export async function sameNetwork(a: string, b: string): Promise<boolean> {
  const [first] = await db
    .select({ ipHash: accountSignals.ipHash })
    .from(accountSignals)
    .where(eq(accountSignals.userId, a))
    .limit(1);
  const [second] = await db
    .select({ ipHash: accountSignals.ipHash })
    .from(accountSignals)
    .where(eq(accountSignals.userId, b))
    .limit(1);
  return Boolean(first?.ipHash && second?.ipHash && first.ipHash === second.ipHash);
}

export type RiskAssessment = {
  level: RiskLevel;
  severity: FraudSeverity;
  reasons: string[];
  ipHash: string | null;
};

/**
 * Score one withdrawal request.
 *
 * Nothing here blocks the request: every reason is a sentence an operator can
 * check in a few seconds, and the row keeps its `pending` status so the existing
 * approval flow is untouched. A request with no reasons is `low` and behaves
 * exactly as it did before this existed.
 */
export async function assessWithdrawal(input: {
  userId: string;
  amount: number;
  bankAccountId: string;
}): Promise<RiskAssessment> {
  const since24h = new Date(Date.now() - DAY_MS);
  const since72h = new Date(Date.now() - 3 * DAY_MS);

  const [account] = await db
    .select({ createdAt: users.createdAt })
    .from(users)
    .where(eq(users.id, input.userId))
    .limit(1);
  const [destination] = await db
    .select({ createdAt: bankAccounts.createdAt })
    .from(bankAccounts)
    .where(and(eq(bankAccounts.id, input.bankAccountId), eq(bankAccounts.userId, input.userId)))
    .limit(1);

  const [recent] = await db
    .select({ count: sql<number>`count(*)` })
    .from(withdrawals)
    .where(and(eq(withdrawals.userId, input.userId), gte(withdrawals.createdAt, since24h)));
  const [settledToDestination] = await db
    .select({ count: sql<number>`count(*)` })
    .from(withdrawals)
    .where(
      and(
        eq(withdrawals.userId, input.userId),
        eq(withdrawals.bankAccountId, input.bankAccountId),
        inArray(withdrawals.status, ["processing", "completed"]),
      ),
    );
  const [deposits] = await db
    .select({ total: sql<number>`coalesce(sum(${paymentTopups.amount}), 0)` })
    .from(paymentTopups)
    .where(and(eq(paymentTopups.userId, input.userId), inArray(paymentTopups.status, ["paid", "completed"])));

  const reasons: string[] = [];
  const accountAgeMs = account ? Date.now() - account.createdAt.getTime() : 0;
  const destinationAgeMs = destination ? Date.now() - destination.createdAt.getTime() : 0;
  const lifetimeDeposits = Number(deposits?.total ?? 0);

  if (account && accountAgeMs < 3 * DAY_MS && accountAgeMs >= 0) reasons.push("account is less than three days old");
  if (accountAgeMs >= 3 * DAY_MS && accountAgeMs < 7 * DAY_MS) reasons.push("account is less than a week old");
  if (destination && destinationAgeMs < DAY_MS) reasons.push("payout account was added in the last 24 hours");
  if (Number(settledToDestination?.count ?? 0) === 0) reasons.push("this payout account has never been paid before");
  if (lifetimeDeposits > 0 && input.amount >= Math.floor(lifetimeDeposits * 0.8)) {
    reasons.push("request is almost everything this account has ever deposited");
  }
  if (Number(recent?.count ?? 0) >= WITHDRAWALS_PER_DAY) reasons.push("three or more withdrawal requests in 24 hours");

  const network = await sharedNetworkAccounts(input.userId).catch(() => ({ accounts: 0, ipHash: null }));
  if (network.accounts > SHARED_NETWORK_ACCOUNTS) {
    reasons.push(`more than ${SHARED_NETWORK_ACCOUNTS} accounts share this network`);
  }

  const level: RiskLevel = reasons.length === 0 ? "low" : reasons.length >= 3 ? "high" : "warn";
  const severity: FraudSeverity = level === "high" ? "high" : level === "warn" ? "warn" : "info";
  return { level, severity, reasons, ipHash: network.ipHash };
}

/**
 * Write a signal to the operator's queue, and ring the doorbell.
 *
 * Never throws. It is called from inside money paths, and a failed audit insert
 * is not a reason to fail a purchase or a payout — the log records it and the
 * action stands.
 *
 * The email is sent after the row is committed and every failure inside it is
 * swallowed by `sendFraudAlertForEvent`, so a mail outage is invisible to the
 * caller in the only way that matters: the money path still completes.
 */
export async function recordFraudEvent(input: {
  userId?: string | null;
  kind: string;
  severity?: FraudSeverity;
  reasons: string[];
  amount?: number | null;
  reference?: string | null;
  ipHash?: string | null;
}): Promise<void> {
  try {
    const [row] = await db
      .insert(fraudEvents)
      .values({
        userId: input.userId ?? null,
        kind: input.kind,
        severity: input.severity ?? "warn",
        reasons: input.reasons.join("; ").slice(0, 2_000),
        amount: input.amount ?? null,
        reference: input.reference ?? null,
        ipHash: input.ipHash ?? null,
      })
      .returning({ id: fraudEvents.id });
    if (row?.id) await sendFraudAlertForEvent(row.id);
  } catch (error) {
    logger.warn("Could not record fraud event", { kind: input.kind, error: error instanceof Error ? error.message : "unknown" });
  }
}

/** Purchases in the last hour, counted from the database rather than memory. */
export async function purchaseVelocity(userId: string): Promise<{ allowed: boolean; count: number; limit: number }> {
  const [row] = await db
    .select({ count: sql<number>`count(*)` })
    .from(orders)
    .where(and(eq(orders.userId, userId), gte(orders.createdAt, new Date(Date.now() - HOUR_MS))));
  const count = Number(row?.count ?? 0);
  return { allowed: count < PURCHASES_PER_HOUR, count, limit: PURCHASES_PER_HOUR };
}

/** Gift cards redeemed in the last day. A stolen card is monetised by redeeming it. */
export async function giftCardVelocity(userId: string): Promise<{ allowed: boolean; count: number; limit: number }> {
  const [row] = await db
    .select({ count: sql<number>`count(*)` })
    .from(giftCards)
    .where(and(eq(giftCards.redeemedBy, userId), gte(giftCards.redeemedAt, new Date(Date.now() - DAY_MS))));
  const count = Number(row?.count ?? 0);
  return { allowed: count < GIFT_CARDS_PER_DAY, count, limit: GIFT_CARDS_PER_DAY };
}

export type FraudQueueRow = {
  id: string;
  kind: string;
  severity: string;
  reasons: string;
  amount: number | null;
  reference: string | null;
  createdAt: string;
  reviewedAt: string | null;
  userEmail: string | null;
};

export async function listFraudEvents(options: { limit?: number; openOnly?: boolean } = {}): Promise<FraudQueueRow[]> {
  const rows = await db
    .select({
      id: fraudEvents.id,
      kind: fraudEvents.kind,
      severity: fraudEvents.severity,
      reasons: fraudEvents.reasons,
      amount: fraudEvents.amount,
      reference: fraudEvents.reference,
      createdAt: fraudEvents.createdAt,
      reviewedAt: fraudEvents.reviewedAt,
      userEmail: users.email,
    })
    .from(fraudEvents)
    .leftJoin(users, eq(users.id, fraudEvents.userId))
    .where(options.openOnly ? isNull(fraudEvents.reviewedAt) : undefined)
    .orderBy(desc(fraudEvents.createdAt))
    .limit(Math.min(options.limit ?? 50, 200));

  return rows.map((row) => ({
    ...row,
    createdAt: row.createdAt.toISOString(),
    reviewedAt: row.reviewedAt ? row.reviewedAt.toISOString() : null,
  }));
}

/** Mark one event dealt with. Returns false when it was already reviewed. */
export async function markFraudEventReviewed(id: string, adminId: string): Promise<boolean> {
  const [updated] = await db
    .update(fraudEvents)
    .set({ reviewedAt: new Date(), reviewedBy: adminId })
    .where(and(eq(fraudEvents.id, id), isNull(fraudEvents.reviewedAt)))
    .returning({ id: fraudEvents.id });
  return Boolean(updated);
}
