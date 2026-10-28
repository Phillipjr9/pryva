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
import { MAX_WITHDRAWAL, MIN_WITHDRAWAL, withdrawalFee } from "@/lib/withdrawal";
import { scheduleWalletEmails } from "@/lib/schedule-wallet-emails";

export const dynamic = "force-dynamic";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
class InsufficientWithdrawalBalance extends Error {}
type Withdrawal = typeof withdrawals.$inferSelect;

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
      : "Withdrawal request submitted for review. A request is not confirmation of settlement.",
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
      return { withdrawal: created, replayed: false as const, balance: debited.balance };
    });

    if (!result.replayed) {
      logger.info("Withdrawal request created", { userId: user.id, withdrawalId: result.withdrawal.id, amount, fee, reference });
    }
    scheduleWalletEmails();
    return receipt(result.withdrawal, amount, bankAccountId, result.replayed, result.replayed ? undefined : result.balance);
  } catch (error) {
    if (error instanceof InsufficientWithdrawalBalance) {
      return NextResponse.json({ error: "Insufficient balance to cover withdrawal and fees" }, { status: 400 });
    }
    logger.error("Withdrawal request failed", { error });
    return NextResponse.json({ error: "Failed to process withdrawal request" }, { status: 500 });
  }
}
