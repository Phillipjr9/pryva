import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { users, withdrawals, walletTransactions } from "@/db/schema";
import { eq, and } from "drizzle-orm";
import { requireAuth } from "@/lib/auth";
import { logger } from "@/lib/logger";

export const dynamic = "force-dynamic";

/**
 * POST /api/wallet/withdraw
 * Request a withdrawal from wallet to bank account
 */
export async function POST(request: NextRequest) {
  try {
    const user = await requireAuth(request);
    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const body = await request.json();
    const { amount, bankAccountId } = body;

    // Validate amount
    if (!amount || typeof amount !== "number" || amount < 1000) {
      return NextResponse.json(
        { error: "Minimum withdrawal amount is ₦1,000" },
        { status: 400 }
      );
    }

    if (amount > 5000000) {
      return NextResponse.json(
        { error: "Maximum withdrawal amount is ₦5,000,000" },
        { status: 400 }
      );
    }

    // Get user's current balance
    const [currentUser] = await db
      .select()
      .from(users)
      .where(eq(users.id, user.id))
      .limit(1);

    if (!currentUser) {
      return NextResponse.json({ error: "User not found" }, { status: 404 });
    }

    if (currentUser.walletBalance < amount) {
      return NextResponse.json(
        { error: "Insufficient wallet balance" },
        { status: 400 }
      );
    }

    // Get bank account details
    if (!bankAccountId) {
      return NextResponse.json(
        { error: "Bank account ID is required" },
        { status: 400 }
      );
    }

    const [bankAccount] = await db
      .select()
      .from(bankAccounts)
      .where(
        and(
          eq(bankAccounts.id, bankAccountId),
          eq(bankAccounts.userId, user.id)
        )
      )
      .limit(1);

    if (!bankAccount) {
      return NextResponse.json(
        { error: "Bank account not found" },
        { status: 404 }
      );
    }

    // Calculate fee (1% for withdrawals above ₦5,000, free below)
    const fee = amount > 5000 ? Math.floor(amount * 0.01) : 0;
    const totalDeduction = amount + fee;

    if (currentUser.walletBalance < totalDeduction) {
      return NextResponse.json(
        { error: "Insufficient balance to cover withdrawal and fees" },
        { status: 400 }
      );
    }

    // Generate unique reference
    const reference = `WD-${Date.now()}-${Math.random().toString(36).substring(2, 8).toUpperCase()}`;

    // Create withdrawal request
    const [withdrawal] = await db
      .insert(withdrawals)
      .values({
        userId: user.id,
        amount,
        fee,
        bankName: bankAccount.bankName,
        accountNumber: bankAccount.accountNumber,
        accountName: bankAccount.accountName,
        recipientCode: bankAccount.recipientCode,
        status: "pending",
        reference,
      })
      .returning();

    // Deduct from wallet immediately
    const newBalance = currentUser.walletBalance - totalDeduction;

    await db
      .update(users)
      .set({ walletBalance: newBalance })
      .where(eq(users.id, user.id));

    // Record wallet transaction
    await db.insert(walletTransactions).values({
      userId: user.id,
      type: "withdrawal",
      amount: totalDeduction,
      balanceAfter: newBalance,
      description: `Withdrawal to ${bankAccount.bankName} (${bankAccount.accountNumber})`,
      reference: withdrawal.reference,
    });

    logger.info("Withdrawal request created", {
      userId: user.id,
      withdrawalId: withdrawal.id,
      amount,
      fee,
      reference,
    });

    return NextResponse.json({
      ok: true,
      withdrawal: {
        id: withdrawal.id,
        reference: withdrawal.reference,
        amount,
        fee,
        status: withdrawal.status,
        bankName: bankAccount.bankName,
        accountNumber: bankAccount.accountNumber,
        accountName: bankAccount.accountName,
      },
      newBalance,
      message: "Withdrawal request submitted. Processing within 24 hours.",
    });
  } catch (error) {
    logger.error("Withdrawal request failed", { error });
    return NextResponse.json(
      { error: "Failed to process withdrawal request" },
      { status: 500 }
    );
  }
}
