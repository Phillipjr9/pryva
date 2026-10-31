import { randomBytes } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { and, eq, gte, sql } from "drizzle-orm";
import { db } from "@/db";
import { users, withdrawals, walletTransactions, bankAccounts } from "@/db/schema";
import { getCurrentUser } from "@/lib/auth";
import { isSameOriginMutation } from "@/lib/net";
import { isPreviewDatabase } from "@/lib/demo-policy";
import { logger } from "@/lib/logger";
import { isJsonRequest, readJsonWithLimit, RequestBodyTooLargeError } from "@/lib/request-body";
import { purchaseRateLimiter } from "@/lib/rate-limit";
import {
  comparePayoutNames,
  depositorNameFor,
  PAYOUT_NAME_MESSAGES,
} from "@/lib/withdrawal-name-check";
import { MAX_WITHDRAWAL, MIN_WITHDRAWAL, withdrawalFee } from "@/lib/withdrawal";
import { scheduleWalletEmails } from "@/lib/schedule-wallet-emails";
import { assessWithdrawal, recordFraudEvent, type RiskAssessment } from "@/lib/fraud";
import { isPaystackConfigured } from "@/lib/paystack";
import { paystackTransferReference } from "@/lib/paystack-transfer-reference";
import { sendPayout } from "@/lib/payouts";

export const dynamic = "force-dynamic";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
class InsufficientWithdrawalBalance extends Error {}
type Withdrawal = typeof withdrawals.$inferSelect;

/**
 * What the customer is told, and why it depends on the row and not on the call.
 *
 * A payout now leaves the moment it is asked for, so there are three honest
 * endings: it went (the provider accepted it — money has left, and the status
 * updates when the bank confirms), it did not and the money is back, or we do not
 * know yet and are still checking. The message has to be one of those three —
 * "submitted for review" would be a lie now.
 */
function receiptMessage(withdrawal: Withdrawal): string {
  switch (withdrawal.status) {
    case "completed":
      return "Payout sent and confirmed by the payment provider.";
    case "processing":
      return "Payout sent to your bank. It usually lands within a minute; this page updates when the bank confirms it.";
    case "failed":
      return "The payout could not be completed, so the amount and fee were returned to your wallet.";
    case "rejected":
      return "This request was rejected and the amount and fee were returned to your wallet.";
    default:
      return "Your request is queued for payout. A request is not confirmation of settlement.";
  }
}

function receipt(withdrawal: Withdrawal, amount: number, bankAccountId: string, replayed: boolean, newBalance?: number) {
  if (withdrawal.amount !== amount || withdrawal.bankAccountId !== bankAccountId) {
    return NextResponse.json({ error: "This request ID belongs to a different withdrawal." }, { status: 409 });
  }
  return NextResponse.json({
    ok: true,
    replayed,
    withdrawal: {
      id: withdrawal.id,
      reference: withdrawal.reference,
      amount: withdrawal.amount,
      fee: withdrawal.fee,
      status: withdrawal.status,
      bankName: withdrawal.bankName,
      accountNumber: withdrawal.accountNumber,
      accountName: withdrawal.accountName,
      createdAt: withdrawal.createdAt,
    },
    // A historical balance is not necessarily the current balance on a replay.
    ...(newBalance === undefined ? {} : { newBalance }),
    message: replayed
      ? "The existing withdrawal request was found. Check its current status; this is not confirmation of settlement."
      : receiptMessage(withdrawal),
  }, { headers: { "Cache-Control": "private, no-store" } });
}

/** Request a withdrawal and reserve the amount atomically. */
export async function POST(request: NextRequest) {
  try {
    const user = await getCurrentUser();
    if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    if (!isSameOriginMutation(request)) return NextResponse.json({ error: "Cross-origin request denied" }, { status: 403 });
    if (!isJsonRequest(request)) return NextResponse.json({ error: "Expected JSON" }, { status: 415 });
    if (isPreviewDatabase()) return NextResponse.json({ error: "Withdrawals are unavailable with preview funds" }, { status: 503 });
    // Payouts are sent on request now, so without a provider there is nothing to
    // send: refusing up front is honest, and it never debits a wallet it cannot pay.
    if (!isPaystackConfigured()) {
      return NextResponse.json({ error: "Withdrawals are temporarily unavailable. Nothing was deducted." }, { status: 503 });
    }
    const limit = await purchaseRateLimiter(`withdrawal:${user.id}`);
    if (limit.unavailable) return NextResponse.json({ error: "Withdrawals are temporarily unavailable." }, { status: 503 });
    if (!limit.allowed) return NextResponse.json({ error: "Too many attempts. Try again later." }, { status: 429 });

    let body: unknown;
    try {
      body = await readJsonWithLimit(request, 2_048);
    } catch (error) {
      return NextResponse.json({ error: "Invalid request body" }, { status: error instanceof RequestBodyTooLargeError ? 413 : 400 });
    }
    if (!body || typeof body !== "object" || Array.isArray(body)) return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
    const { amount, bankAccountId: rawBankAccountId, requestId: rawRequestId } = body as { amount?: unknown; bankAccountId?: unknown; requestId?: unknown };
    if (typeof amount !== "number" || !Number.isSafeInteger(amount) || amount < MIN_WITHDRAWAL || amount > MAX_WITHDRAWAL) {
      return NextResponse.json({ error: "Enter a whole-naira amount between ₦1,000 and ₦5,000,000" }, { status: 400 });
    }
    if (typeof rawBankAccountId !== "string" || !UUID.test(rawBankAccountId) || typeof rawRequestId !== "string" || !UUID.test(rawRequestId)) {
      return NextResponse.json({ error: "A valid bank account and request ID are required" }, { status: 400 });
    }
    const bankAccountId = rawBankAccountId.toLowerCase();
    const requestId = rawRequestId.toLowerCase();
    const requestCondition = and(eq(withdrawals.userId, user.id), eq(withdrawals.requestId, requestId));

    // Look up a retry before checking the bank account: it may have been removed
    // since the original request was committed.
    const [existing] = await db.select().from(withdrawals).where(requestCondition).limit(1);
    if (existing) return receipt(existing, amount, bankAccountId, true);

    const [bankAccount] = await db.select().from(bankAccounts)
      .where(and(eq(bankAccounts.id, bankAccountId), eq(bankAccounts.userId, user.id))).limit(1);
    if (!bankAccount) return NextResponse.json({ error: "Bank account not found" }, { status: 404 });
    // A payout cannot be sent without a provider recipient, and a request that
    // cannot be paid must not debit anything. Accounts added since recipients were
    // stored always have one; a legacy row has to be re-added once.
    if (!bankAccount.recipientCode) {
      return NextResponse.json({ error: "This bank account needs to be added again before it can receive a payout. Nothing was deducted." }, { status: 409 });
    }

    // Money may only leave in the name it arrived in. This runs before any write
    // -- no withdrawal row, no debit, no ledger entry -- because a check that
    // runs after the balance has moved would need a rollback to be worth
    // anything. The reference is the name frozen on the first settled deposit,
    // not `users.name`, which the profile endpoint can change at any time.
    const nameCheck = comparePayoutNames(await depositorNameFor(user.id), bankAccount.accountName);
    if (!nameCheck.ok) {
      // Reason and identifiers only: bank account names are not logged.
      logger.warn("Withdrawal refused: destination name does not match the depositor", {
        userId: user.id,
        bankAccountId,
        reason: nameCheck.reason,
      });
      return NextResponse.json({ error: PAYOUT_NAME_MESSAGES[nameCheck.reason] }, { status: 403 });
    }

    // Advisory risk score for the operator's queue. It never blocks the request
    // and a failure here defaults to "no opinion" rather than to a refusal: a
    // customer must not be unable to withdraw because a scoring query failed.
    let risk: RiskAssessment = { level: "low", severity: "warn", reasons: [], ipHash: null };
    try {
      risk = await assessWithdrawal({ userId: user.id, amount, bankAccountId });
    } catch (error) {
      logger.warn("Withdrawal risk assessment skipped", { userId: user.id, error: error instanceof Error ? error.message : "unknown" });
    }

    const fee = withdrawalFee(amount);
    const totalDeduction = amount + fee;
    const reference = `WD-${randomBytes(12).toString("hex")}`;

    const result = await db.transaction(async (tx) => {
      // The unique customer/request key arbitrates concurrent retries. The row,
      // debit and ledger all commit together; failure rolls back the key too.
      const [created] = await tx.insert(withdrawals).values({
        userId: user.id,
        requestId,
        bankAccountId,
        amount,
        fee,
        bankName: bankAccount.bankName,
        accountNumber: bankAccount.accountNumber,
        accountName: bankAccount.accountName,
        recipientCode: bankAccount.recipientCode,
        status: "pending",
        riskLevel: risk.level,
        riskReasons: risk.reasons.length > 0 ? risk.reasons.join("; ") : null,
        reference,
      }).onConflictDoNothing({ target: [withdrawals.userId, withdrawals.requestId] }).returning();
      if (!created) {
        // A concurrent transaction may have created this request after the
        // first lookup. Read it after the unique-index conflict is resolved.
        const [raced] = await tx.select().from(withdrawals).where(requestCondition).limit(1);
        if (!raced) throw new Error("Withdrawal request conflict could not be resolved");
        return { withdrawal: raced, replayed: true as const };
      }

      const [debited] = await tx.update(users)
        .set({ walletBalance: sql`${users.walletBalance} - ${totalDeduction}` })
        .where(and(eq(users.id, user.id), gte(users.walletBalance, totalDeduction)))
        .returning({ balance: users.walletBalance });
      if (!debited) throw new InsufficientWithdrawalBalance();

      await tx.insert(walletTransactions).values({
        userId: user.id,
        type: "withdrawal",
        amount: totalDeduction,
        balanceAfter: debited.balance,
        description: `Withdrawal to ${bankAccount.bankName} (${bankAccount.accountNumber})`,
        reference,
      });

      // The provider reference is written before the money is asked for, in the
      // same transaction as the debit: if the process dies mid-request there is
      // still a row that names the transfer, so a reconciliation can find out
      // what happened instead of guessing from a reference nobody stored.
      const providerReference = paystackTransferReference(created.id);
      const [claimed] = await tx
        .update(withdrawals)
        .set({ status: "processing", paystackReference: providerReference, processedAt: new Date() })
        .where(eq(withdrawals.id, created.id))
        .returning();
      if (!claimed) throw new Error("Withdrawal could not be claimed for payout");
      return { withdrawal: claimed, replayed: false as const, balance: debited.balance };
    });

    if (!result.replayed) {
      logger.info("Withdrawal request created", { userId: user.id, withdrawalId: result.withdrawal.id, amount, fee, reference });
      if (risk.level !== "low") {
        await recordFraudEvent({
          userId: user.id,
          kind: "withdrawal_review",
          severity: risk.severity,
          reasons: risk.reasons,
          amount,
          reference,
          ipHash: risk.ipHash,
        });
      }
    }
    if (result.replayed) {
      scheduleWalletEmails();
      return receipt(result.withdrawal, amount, bankAccountId, true);
    }

    // Past this line the wallet is debited and the row is in flight. Every branch
    // below is a statement about where the money actually is.
    const payout = await sendPayout(result.withdrawal);
    if (payout.outcome === "refunded") {
      logger.warn("Withdrawal refunded instead of paid out", {
        userId: user.id,
        withdrawalId: result.withdrawal.id,
        reason: payout.reason,
        refunded: payout.refunded,
      });
    } else if (payout.outcome === "unconfirmed") {
      // Left in flight on purpose: a refund here could pay twice. It reaches the
      // reconciliation queue, and the sweep asks the provider what happened.
      logger.warn("Withdrawal payout outcome unconfirmed", {
        userId: user.id,
        withdrawalId: result.withdrawal.id,
        reason: payout.reason,
      });
    }

    const [finalRow] = await db.select().from(withdrawals).where(eq(withdrawals.id, result.withdrawal.id)).limit(1);
    const [currentBalance] = await db.select({ balance: users.walletBalance }).from(users).where(eq(users.id, user.id)).limit(1);
    scheduleWalletEmails();
    return receipt(
      finalRow ?? result.withdrawal,
      amount,
      bankAccountId,
      false,
      currentBalance?.balance,
    );
  } catch (error) {
    if (error instanceof InsufficientWithdrawalBalance) {
      return NextResponse.json({ error: "Insufficient balance to cover withdrawal and fees" }, { status: 400 });
    }
    logger.error("Withdrawal request failed", { error });
    return NextResponse.json({ error: "Failed to process withdrawal request" }, { status: 500 });
  }
}
