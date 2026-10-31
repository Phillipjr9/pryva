import { and, desc, eq } from "drizzle-orm";

import { db } from "@/db";
import {
  giftCards,
  orders,
  paymentTopups,
  scheduledOrders,
  users,
  userTwoFactor,
  walletTransactions,
  withdrawals,
} from "@/db/schema";
import { issueEmailVerification, rateLimitEmailVerification } from "@/lib/email-verification";
import { isPreviewDatabase } from "@/lib/demo-policy";
import { logger } from "@/lib/logger";
import { isPaystackConfigured } from "@/lib/paystack";
import { purchaseRateLimiter } from "@/lib/rate-limit";
import { resendConfigured } from "@/lib/resend-config";
import { cancelScheduledOrder } from "@/lib/scheduled-orders";
import { reconcileTopUpPayment } from "@/lib/topup-reconciliation";

import type { ActionOutcome, RemedyId, RemedyTarget, SupportFacts } from "./types";

/**
 * The assistant's hands and eyes.
 *
 * Everything with a side effect, or with a database read behind it, lives here.
 * The engine itself (`engine.ts`) is pure: it receives facts and a `runRemedy`
 * function, which is both why it can be tested with plain objects and why an
 * invented capability cannot sneak into a reply — if it is not in this file, the
 * assistant cannot do it.
 *
 * The list is short on purpose:
 *
 *   * **re-send a verification link** — harmless, rate-limited, and the fix for
 *     the single most common account blocker;
 *   * **re-check one deposit with the payment provider** — the same check the
 *     browser-return route performs, through the same idempotent credit path, so
 *     a deposit can be *found* and credited but a payment is never retried;
 *   * **cancel one of the customer's own scheduled orders** — stops a future
 *     debit, moves no money.
 *
 * Anything else — a refund, a withdrawal approval, an unlock, switching off
 * two-factor, crediting a wallet by hand — is deliberately absent. Those change
 * money or change who can get into an account, and they stay with a person.
 */

export const REMEDY_LABELS: Record<RemedyId, string> = {
  resend_verification: "Send a new verification link",
  recheck_topup: "Re-check a deposit with the payment provider",
  cancel_schedule: "Stop a scheduled order",
};

/**
 * Read the account, narrowly.
 *
 * Deliberately no supplier, no wholesale cost, no other customer, no credential
 * and no session token. A fact that is not read here cannot be repeated to the
 * customer, which is what makes the reply trustworthy rather than merely polite.
 */
export async function loadSupportFacts(userId: string, now: Date = new Date()): Promise<SupportFacts> {
  const [account] = await db
    .select({
      id: users.id,
      name: users.name,
      email: users.email,
      emailVerifiedAt: users.emailVerifiedAt,
      walletBalance: users.walletBalance,
      lockedUntil: users.lockedUntil,
      createdAt: users.createdAt,
    })
    .from(users)
    .where(eq(users.id, userId))
    .limit(1);

  if (!account) throw new Error("Support facts requested for an account that does not exist");

  const [twoFactor, ledger, topUps, orderRows, scheduleRows, cardRows, withdrawalRows] = await Promise.all([
    db
      .select({ enabledAt: userTwoFactor.enabledAt })
      .from(userTwoFactor)
      .where(eq(userTwoFactor.userId, userId))
      .limit(1),
    db
      .select({
        type: walletTransactions.type,
        amount: walletTransactions.amount,
        balanceAfter: walletTransactions.balanceAfter,
        description: walletTransactions.description,
        reference: walletTransactions.reference,
        createdAt: walletTransactions.createdAt,
      })
      .from(walletTransactions)
      .where(eq(walletTransactions.userId, userId))
      .orderBy(desc(walletTransactions.createdAt))
      .limit(10),
    db
      .select({
        reference: paymentTopups.reference,
        amount: paymentTopups.amount,
        status: paymentTopups.status,
        createdAt: paymentTopups.createdAt,
        paidAt: paymentTopups.paidAt,
      })
      .from(paymentTopups)
      .where(eq(paymentTopups.userId, userId))
      .orderBy(desc(paymentTopups.createdAt))
      .limit(5),
    db
      .select({
        reference: orders.reference,
        service: orders.service,
        productName: orders.productName,
        amount: orders.amount,
        status: orders.status,
        createdAt: orders.createdAt,
        refundedAt: orders.refundedAt,
      })
      .from(orders)
      .where(eq(orders.userId, userId))
      .orderBy(desc(orders.createdAt))
      .limit(8),
    db
      .select({
        id: scheduledOrders.id,
        service: scheduledOrders.service,
        productSlug: scheduledOrders.productSlug,
        frequency: scheduledOrders.frequency,
        status: scheduledOrders.status,
        nextRunAt: scheduledOrders.nextRunAt,
      })
      .from(scheduledOrders)
      .where(eq(scheduledOrders.userId, userId))
      .orderBy(desc(scheduledOrders.createdAt))
      .limit(10),
    db
      .select({
        code: giftCards.code,
        amount: giftCards.amount,
        status: giftCards.status,
        expiresAt: giftCards.expiresAt,
      })
      .from(giftCards)
      .where(eq(giftCards.purchasedBy, userId))
      .orderBy(desc(giftCards.createdAt))
      .limit(5),
    db
      .select({
        amount: withdrawals.amount,
        status: withdrawals.status,
        createdAt: withdrawals.createdAt,
      })
      .from(withdrawals)
      .where(eq(withdrawals.userId, userId))
      .orderBy(desc(withdrawals.createdAt))
      .limit(5),
  ]);

  return {
    now,
    account: {
      id: account.id,
      name: account.name,
      email: account.email,
      emailVerified: Boolean(account.emailVerifiedAt),
      walletBalance: account.walletBalance,
      twoFactorEnabled: Boolean(twoFactor[0]?.enabledAt),
      lockedUntil: account.lockedUntil ?? null,
      memberSince: account.createdAt,
    },
    ledger,
    topUps,
    orders: orderRows,
    schedules: scheduleRows.map((schedule) => ({
      id: schedule.id,
      service: schedule.service,
      productLabel: schedule.productSlug,
      frequency: schedule.frequency,
      status: schedule.status,
      nextRunAt: schedule.nextRunAt,
    })),
    giftCards: cardRows,
    withdrawals: withdrawalRows,
    paymentsReady: isPaystackConfigured() && !isPreviewDatabase(),
  };
}

/**
 * Run one remedy.
 *
 * Every branch answers with what actually happened, including the branches where
 * nothing did. A remedy that reports success it cannot substantiate is worse
 * than one that refuses, because the customer stops looking for the missing
 * thing.
 */
export async function runSupportRemedy(input: {
  userId: string;
  userEmail: string;
  userName: string;
  remedy: RemedyId;
  target: RemedyTarget;
  facts: SupportFacts;
}): Promise<ActionOutcome> {
  const { userId, userEmail, userName, remedy, target } = input;
  const label = REMEDY_LABELS[remedy];

  switch (remedy) {
    case "resend_verification": {
      if (target.kind !== "verification_email") {
        return { remedy, label, status: "skipped", note: "Wrong target for that remedy." };
      }
      // Never re-send to an address that is not the account's own: this is a
      // signed-in action, and the address is the one privilege is proven
      // against.
      if (target.email.toLowerCase() !== userEmail.toLowerCase()) {
        return { remedy, label, status: "skipped", note: "The address does not match the account." };
      }
      if (!resendConfigured()) {
        return {
          remedy,
          label,
          status: "skipped",
          note: "Email delivery is not configured, so a new link cannot be delivered.",
        };
      }
      const limit = rateLimitEmailVerification(`support-assistant:${userId}`);
      const verdict = await limit;
      if (verdict.unavailable || !verdict.allowed) {
        return {
          remedy,
          label,
          status: "skipped",
          note: "A verification link was requested too recently; the newest one already sent is still valid.",
        };
      }
      const delivery = await issueEmailVerification(userId, userEmail, userName);
      logger.info("Support assistant re-sent a verification link", { userId, delivered: delivery.delivered });
      if (!delivery.delivered) {
        // Issuing a token is not the same as sending a link, and this assistant is
        // the one place that would otherwise tell a customer to check an inbox
        // nothing was sent to.
        return {
          remedy,
          label,
          status: "failed",
          note: `A fresh link was created for ${userEmail}, but ${delivery.detail ?? "it could not be delivered"}. Earlier links stop working; nothing will arrive until delivery is fixed.`,
        };
      }
      return {
        remedy,
        label,
        status: "succeeded",
        note: `Issued a fresh verification link to ${userEmail}; earlier links stop working.`,
      };
    }

    case "recheck_topup": {
      if (target.kind !== "topup") {
        return { remedy, label, status: "skipped", note: "Wrong target for that remedy." };
      }
      const limit = await purchaseRateLimiter(`support-recheck:${userId}`);
      if (limit.unavailable || !limit.allowed) {
        return {
          remedy,
          label,
          status: "skipped",
          note: "Too many provider checks on this account in the last minute.",
        };
      }
      const result = await reconcileTopUpPayment({ reference: target.reference, userId, userEmail });
      switch (result.outcome) {
        case "credited":
          logger.info("Support assistant reconciled a top-up", {
            userId,
            reference: target.reference,
            duplicate: result.duplicate,
          });
          return {
            remedy,
            label,
            status: "succeeded",
            note: result.duplicate
              ? `Deposit ${target.reference} had already been credited (${result.amount}); nothing was added twice.`
              : `Provider confirmed ${result.amount} for ${target.reference}; the wallet is now credited.`,
          };
        case "pending":
          return {
            remedy,
            label,
            status: "skipped",
            note: `The provider has not confirmed ${target.reference} yet (status ${result.providerStatus}).`,
          };
        case "failed":
          return {
            remedy,
            label,
            status: "skipped",
            note: `The provider reports ${target.reference} as ${result.providerStatus}; the wallet was not credited and must not be re-paid.`,
          };
        case "not_configured":
          return {
            remedy,
            label,
            status: "skipped",
            note: "Payments are not configured in this environment, so the provider cannot be asked.",
          };
        case "not_found":
          return { remedy, label, status: "skipped", note: "That deposit is not on this account." };
        case "wrong_customer":
          return {
            remedy,
            label,
            status: "skipped",
            note: "The provider says the payer is a different customer, so this is not ours to credit.",
          };
        case "mismatch":
          return {
            remedy,
            label,
            status: "failed",
            note: `Provider details disagree with what was recorded (${result.details.length} field${result.details.length === 1 ? "" : "s"}). Not credited.`,
          };
        case "credited_status_conflict":
          return {
            remedy,
            label,
            status: "failed",
            note: `Already credited, but the provider now reports ${result.providerStatus}. Needs a person.`,
          };
        case "topup_mismatch":
          return {
            remedy,
            label,
            status: "failed",
            note: "The payment no longer matches a pending deposit record. Needs a person.",
          };
        case "provider_error":
          return {
            remedy,
            label,
            status: "failed",
            note: "The payment provider did not answer usefully. Nothing was credited.",
          };
      }
      return { remedy, label, status: "failed", note: "Unknown outcome." };
    }

    case "cancel_schedule": {
      if (target.kind !== "schedule") {
        return { remedy, label, status: "skipped", note: "Wrong target for that remedy." };
      }
      // The ownership check is in the query, not in the caller: a schedule id
      // from somewhere else cancels nothing.
      const [schedule] = await db
        .select({ id: scheduledOrders.id })
        .from(scheduledOrders)
        .where(and(eq(scheduledOrders.id, target.id), eq(scheduledOrders.userId, userId)))
        .limit(1);
      if (!schedule) return { remedy, label, status: "skipped", note: "That schedule is not on this account." };

      const cancelled = await cancelScheduledOrder(target.id, userId);
      if (!cancelled) {
        return { remedy, label, status: "skipped", note: "The schedule was already stopped." };
      }
      logger.info("Support assistant cancelled a scheduled order", { userId, scheduleId: target.id });
      return { remedy, label, status: "succeeded", note: `Schedule ${target.label} is cancelled.` };
    }

    default:
      return { remedy, label, status: "skipped", note: "No such remedy." };
  }
}
