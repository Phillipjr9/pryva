import { randomBytes } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { and, eq, gte, sql } from "drizzle-orm";
import { db } from "@/db";
import { users, withdrawals, walletTransactions, bankAccounts } from "@/db/schema";
import { getCurrentUser } from "@/lib/auth";
import { isSameOriginMutation } from "@/lib/net";
import { logger } from "@/lib/logger";

export const dynamic = "force-dynamic";

class InsufficientWithdrawalBalance extends Error {}

/** Request a withdrawal and reserve the amount atomically. */
export async function POST(request: NextRequest) {
  try {
    const user = await getCurrentUser();
    if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    if (!isSameOriginMutation(request)) return NextResponse.json({ error: "Cross-origin request denied" }, { status: 403 });

    const { amount, bankAccountId } = await request.json() as { amount?: unknown; bankAccountId?: unknown };
    if (typeof amount !== "number" || !Number.isSafeInteger(amount) || amount < 1000 || amount > 5000000) {
      return NextResponse.json({ error: "Enter a whole-naira amount between ₦1,000 and ₦5,000,000" }, { status: 400 });
    }
    if (typeof bankAccountId !== "string" || !bankAccountId) {
      return NextResponse.json({ error: "Bank account ID is required" }, { status: 400 });
    }

    const [bankAccount] = await db.select().from(bankAccounts)
      .where(and(eq(bankAccounts.id, bankAccountId), eq(bankAccounts.userId, user.id))).limit(1);
    if (!bankAccount) return NextResponse.json({ error: "Bank account not found" }, { status: 404 });

    const fee = amount > 5000 ? Math.floor(amount * 0.01) : 0;
    const totalDeduction = amount + fee;
    const reference = `WD-${randomBytes(12).toString("hex")}`;

    const result = await db.transaction(async (tx) => {
      // This conditional UPDATE serializes concurrent withdrawal requests and
      // prevents either an overdraft or a lost wallet update.
      const [debited] = await tx.update(users)
        .set({ walletBalance: sql`${users.walletBalance} - ${totalDeduction}` })
        .where(and(eq(users.id, user.id), gte(users.walletBalance, totalDeduction)))
        .returning({ balance: users.walletBalance });
      if (!debited) throw new InsufficientWithdrawalBalance();

      const [withdrawal] = await tx.insert(withdrawals).values({
        userId: user.id,
        amount,
        fee,
        bankName: bankAccount.bankName,
        accountNumber: bankAccount.accountNumber,
        accountName: bankAccount.accountName,
        recipientCode: bankAccount.recipientCode,
        status: "pending",
        reference,
      }).returning();

      await tx.insert(walletTransactions).values({
        userId: user.id,
        type: "withdrawal",
        amount: totalDeduction,
        balanceAfter: debited.balance,
        description: `Withdrawal to ${bankAccount.bankName} (${bankAccount.accountNumber})`,
        reference,
      });
      return { withdrawal, balance: debited.balance };
    });

    logger.info("Withdrawal request created", { userId: user.id, withdrawalId: result.withdrawal.id, amount, fee, reference });
    return NextResponse.json({
      ok: true,
      withdrawal: {
        id: result.withdrawal.id,
        reference,
        amount,
        fee,
        status: result.withdrawal.status,
        bankName: bankAccount.bankName,
        accountNumber: bankAccount.accountNumber,
        accountName: bankAccount.accountName,
      },
      newBalance: result.balance,
      message: "Withdrawal request submitted. Processing within 24 hours.",
    });
  } catch (error) {
    if (error instanceof InsufficientWithdrawalBalance) {
      return NextResponse.json({ error: "Insufficient balance to cover withdrawal and fees" }, { status: 400 });
    }
    logger.error("Withdrawal request failed", { error });
    return NextResponse.json({ error: "Failed to process withdrawal request" }, { status: 500 });
  }
}
