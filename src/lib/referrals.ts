import { and, asc, eq, inArray, isNull } from "drizzle-orm";

import { db } from "@/db";
import { orders, referralCodes, referrals, users } from "@/db/schema";
import { logger } from "@/lib/logger";
import { creditWalletInTx } from "@/lib/wallet";
import { recordFraudEvent, sameNetwork } from "@/lib/fraud";
import {
  makeReferralCode,
  normalizeReferralCode,
  readReferralCodeFrom,
  REFERRAL_CODE_LENGTH,
} from "@/lib/referral-code";

export { normalizeReferralCode, makeReferralCode, readReferralCodeFrom, readCookie, REFERRAL_COOKIE, REFERRAL_COOKIE_MAX_AGE_SECONDS } from "@/lib/referral-code";

/**
 * Referrals.
 *
 * The owner's rule: an account invites a friend with a code or a link, and earns
 * **5% of that friend's first order, capped at ₦2,000**, paid into the wallet.
 * Both numbers are configuration (`REFERRAL_REWARD_PERCENT`,
 * `REFERRAL_REWARD_CAP_NGN`) with the approved defaults here, so changing the
 * offer is a deploy-time change rather than a migration.
 *
 * Four properties are load-bearing, and each is enforced by the database rather
 * than by careful code:
 *
 *   1. **One reward per invited account.** `referrals.referee_id` is UNIQUE, so a
 *      second attribution for the same person cannot be inserted at all.
 *   2. **One payout per referral.** Settlement claims the row with a conditional
 *      update (`… WHERE status = 'pending'`) and writes a UNIQUE ledger
 *      reference, so two workers racing over the same row credit once.
 *   3. **The rewarded order is a delivered one.** A pending, refunded or failed
 *      order does not qualify, and a refund after delivery is visible on the row
 *      that no longer matches.
 *   4. **No self-referral.** Checked here *and* by a CHECK constraint, because a
 *      free wallet credit by inviting yourself is the obvious way to abuse this.
 *
 * Nothing here is allowed to fail somebody's purchase: every caller treats the
 * settlement as best effort, and a reward that cannot be paid stays pending for
 * the nightly sweep instead of being dropped.
 */

export const DEFAULT_REWARD_PERCENT = 5;
export const DEFAULT_REWARD_CAP_NGN = 2_000;

/** A delivered order is one the customer actually received something for. */
const QUALIFYING_ORDER_STATUSES = ["active", "delivered"] as const;

export type ReferralRewardConfig = { percent: number; capNgn: number };

/**
 * The offer, as configured.
 *
 * Percent is clamped to 0–100 and the cap to something non-negative; a typo in
 * the environment must move the offer, never make it nonsensical. `0` percent
 * switches the programme off without changing any code, and settlement then
 * simply leaves every invitation pending.
 */
export function referralRewardConfig(env: NodeJS.ProcessEnv = process.env): ReferralRewardConfig {
  const percent = Number(env.REFERRAL_REWARD_PERCENT);
  const cap = Number(env.REFERRAL_REWARD_CAP_NGN);
  return {
    percent: Number.isFinite(percent) && percent >= 0 ? Math.min(Math.floor(percent), 100) : DEFAULT_REWARD_PERCENT,
    capNgn: Number.isFinite(cap) && cap >= 0 ? Math.floor(cap) : DEFAULT_REWARD_CAP_NGN,
  };
}

/** Whole naira, never a fraction, never above the cap. `0` means nothing to pay. */
export function referralRewardFor(amountNgn: number, env: NodeJS.ProcessEnv = process.env): number {
  const { percent, capNgn } = referralRewardConfig(env);
  if (!Number.isFinite(amountNgn) || amountNgn <= 0 || percent <= 0 || capNgn <= 0) return 0;
  return Math.min(Math.max(0, Math.floor((amountNgn * percent) / 100)), capNgn);
}

function isUniqueViolation(error: unknown): boolean {
  return typeof error === "object" && error !== null && (error as { code?: string }).code === "23505";
}

/**
 * The account's code, minted on first use.
 *
 * Collisions are retried rather than reported: two accounts drawing the same
 * eight characters is rare but inevitable at scale, and it must not surface to a
 * customer as an error.
 */
export async function codeForUser(userId: string): Promise<string | null> {
  const [existing] = await db.select({ code: referralCodes.code }).from(referralCodes).where(eq(referralCodes.userId, userId)).limit(1);
  if (existing) return existing.code;

  for (let attempt = 0; attempt < 5; attempt += 1) {
    const code = makeReferralCode();
    try {
      await db.insert(referralCodes).values({ code, userId });
      return code;
    } catch (error) {
      if (!isUniqueViolation(error)) throw error;
      // Either this account got a code from a concurrent request, or the code
      // collided with another account's. Both are retried.
      const [raced] = await db.select({ code: referralCodes.code }).from(referralCodes).where(eq(referralCodes.userId, userId)).limit(1);
      if (raced) return raced.code;
    }
  }
  logger.warn("Could not mint a referral code", { userId });
  return null;
}

export async function resolveReferralCode(code: string): Promise<{ referrerId: string; code: string } | null> {
  const normalized = normalizeReferralCode(code);
  if (!normalized) return null;
  const [row] = await db
    .select({ referrerId: referralCodes.userId, code: referralCodes.code })
    .from(referralCodes)
    .where(eq(referralCodes.code, normalized))
    .limit(1);
  return row ?? null;
}

export type AttributionResult =
  | { ok: true; referrerId: string; code: string }
  | { ok: false; reason: "unknown" | "self" | "already-attributed" };

/**
 * Record that `refereeId` arrived through `code`.
 *
 * Called once, right after an account is created. An unknown or malformed code
 * is not an error the customer should see — they simply get an account with no
 * inviter — so the caller ignores the result.
 */
export async function attributeReferral(input: {
  refereeId: string;
  code: unknown;
}): Promise<AttributionResult> {
  const resolved = await resolveReferralCode(String(input.code ?? ""));
  if (!resolved) return { ok: false, reason: "unknown" };
  if (resolved.referrerId === input.refereeId) return { ok: false, reason: "self" };

  const inserted = await db
    .insert(referrals)
    .values({ referrerId: resolved.referrerId, refereeId: input.refereeId, code: resolved.code, status: "pending" })
    .onConflictDoNothing()
    .returning({ id: referrals.id });

  if (inserted.length === 0) return { ok: false, reason: "already-attributed" };
  return { ok: true, referrerId: resolved.referrerId, code: resolved.code };
}

export type SettlementResult = { credited: number; pending: number; skipped: number; voided: number };

/**
 * Pay every invitation whose referee now has a qualifying order.
 *
 * Idempotent and safe to call from anywhere — after a purchase (so the reward
 * feels immediate) and from the nightly job (so a hand-fulfilled account order
 * that only completes days later still pays out). The claim and the credit
 * commit together: a referral marked paid without a ledger entry, or a credit
 * without a marked row, would be money nobody can explain.
 */
export async function settleReferralRewards(options: { refereeId?: string } = {}): Promise<SettlementResult> {
  const result: SettlementResult = { credited: 0, pending: 0, skipped: 0, voided: 0 };

  const pendingRows = await db
    .select({
      id: referrals.id,
      referrerId: referrals.referrerId,
      refereeId: referrals.refereeId,
    })
    .from(referrals)
    .where(
      options.refereeId
        ? and(eq(referrals.status, "pending"), eq(referrals.refereeId, options.refereeId))
        : eq(referrals.status, "pending"),
    )
    .orderBy(asc(referrals.createdAt))
    .limit(200);

  for (const row of pendingRows) {
    // An invitation from your own network is not a referral: it is the cheapest
    // way to pay yourself. Both accounts must have a signal to compare, so a
    // missing one never blocks a genuine reward.
    const selfNetwork = await sameNetwork(row.referrerId, row.refereeId).catch(() => false);
    if (selfNetwork) {
      const [voided] = await db
        .update(referrals)
        .set({ status: "void" })
        .where(and(eq(referrals.id, row.id), eq(referrals.status, "pending")))
        .returning({ id: referrals.id });
      if (voided) {
        result.voided += 1;
        await recordFraudEvent({
          userId: row.referrerId,
          kind: "referral_same_network",
          severity: "high",
          reasons: ["the invited account was created from the same network as the inviter"],
          reference: row.id,
        });
      }
      continue;
    }

    let credited = 0;
    try {
      credited = await db.transaction(async (tx: any) => {
        // Re-read inside the transaction: another worker may have settled it
        // between the list and this point.
        const [current] = await tx
          .select({ id: referrals.id, status: referrals.status, rewardReference: referrals.rewardReference })
          .from(referrals)
          .where(eq(referrals.id, row.id))
          .limit(1);
        if (!current || current.status !== "pending") return 0;

        const [order] = await tx
          .select({ id: orders.id, amount: orders.amount })
          .from(orders)
          .where(
            and(
              eq(orders.userId, row.refereeId),
              inArray(orders.status, [...QUALIFYING_ORDER_STATUSES]),
              isNull(orders.refundedAt),
            ),
          )
          .orderBy(asc(orders.createdAt))
          .limit(1);
        if (!order) return 0;

        const reward = referralRewardFor(order.amount);
        if (reward <= 0) return 0;

        const rewardReference = `REFL-${row.id.replace(/-/g, "").slice(0, 20).toUpperCase()}`;
        const [claimed] = await tx
          .update(referrals)
          .set({
            status: "credited",
            qualifyingOrderId: order.id,
            rewardAmount: reward,
            rewardReference,
            creditedAt: new Date(),
          })
          .where(and(eq(referrals.id, row.id), eq(referrals.status, "pending")))
          .returning({ id: referrals.id });
        if (!claimed) return 0;

        await creditWalletInTx(tx, {
          userId: row.referrerId,
          amount: reward,
          type: "credit",
          description: "Referral reward — a friend's first order",
          reference: rewardReference,
        });
        return reward;
      });
    } catch (error) {
      // A pending invitation is not lost: the nightly sweep tries again.
      logger.warn("Referral settlement failed", { referralId: row.id, error: error instanceof Error ? error.message : "unknown" });
      result.skipped += 1;
      continue;
    }

    if (credited > 0) result.credited += 1;
    else result.pending += 1;
  }

  return result;
}

export type ReferralInvite = {
  id: string;
  code: string;
  status: string;
  rewardAmount: number | null;
  createdAt: string;
  creditedAt: string | null;
  /** First letter and domain only: the inviter does not get their friend's address. */
  refereeLabel: string;
};

export type ReferralOverview = {
  code: string | null;
  /** Whole naira already paid into this account. */
  earned: number;
  invited: number;
  pending: number;
  percent: number;
  capNgn: number;
  invites: ReferralInvite[];
};

/** `ada@example.com` → `a•••@example.com`. Enough to recognise, not to harvest. */
export function maskEmail(email: string): string {
  const [local, domain] = email.split("@");
  if (!domain) return "a friend";
  const first = local?.slice(0, 1) || "•";
  return `${first}•••@${domain}`;
}

export async function referralOverview(userId: string): Promise<ReferralOverview> {
  const settings = referralRewardConfig();
  const rows = await db
      .select({
        id: referrals.id,
        code: referrals.code,
        status: referrals.status,
        rewardAmount: referrals.rewardAmount,
        createdAt: referrals.createdAt,
        creditedAt: referrals.creditedAt,
        refereeEmail: users.email,
      })
      .from(referrals)
      .innerJoin(users, eq(users.id, referrals.refereeId))
      .where(eq(referrals.referrerId, userId))
    .orderBy(asc(referrals.createdAt))
    .limit(100);

  const code = await codeForUser(userId);
  const invites: ReferralInvite[] = rows.map((row) => ({
    id: row.id,
    code: row.code,
    status: row.status,
    rewardAmount: row.rewardAmount,
    createdAt: row.createdAt.toISOString(),
    creditedAt: row.creditedAt ? row.creditedAt.toISOString() : null,
    refereeLabel: maskEmail(row.refereeEmail),
  }));

  return {
    code,
    earned: invites.reduce((total, invite) => total + (invite.status === "credited" ? invite.rewardAmount ?? 0 : 0), 0),
    invited: invites.length,
    pending: invites.filter((invite) => invite.status === "pending").length,
    percent: settings.percent,
    capNgn: settings.capNgn,
    invites,
  };
}
