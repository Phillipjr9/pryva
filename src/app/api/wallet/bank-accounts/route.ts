import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { bankAccounts } from "@/db/schema";
import { eq, and, desc } from "drizzle-orm";
import { requireAuth } from "@/lib/auth";
import { resolveBankAccount, createTransferRecipient } from "@/lib/paystack";
import { logger } from "@/lib/logger";

export const dynamic = "force-dynamic";

/**
 * GET /api/wallet/bank-accounts
 * Get user's saved bank accounts
 */
export async function GET(request: NextRequest) {
  try {
    const user = await requireAuth(request);
    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const userBankAccounts = await db
      .select()
      .from(bankAccounts)
      .where(eq(bankAccounts.userId, user.id))
      .orderBy(desc(bankAccounts.isDefault));

    return NextResponse.json({
      ok: true,
      bankAccounts: userBankAccounts.map((acc) => ({
        id: acc.id,
        bankName: acc.bankName,
        bankCode: acc.bankCode,
        accountNumber: acc.accountNumber,
        accountName: acc.accountName,
        isDefault: acc.isDefault === 1,
        createdAt: acc.createdAt,
      })),
    });
  } catch (error) {
    logger.error("Failed to fetch bank accounts:", { error });
    return NextResponse.json(
      { error: "Failed to fetch bank accounts" },
      { status: 500 }
    );
  }
}

/**
 * POST /api/wallet/bank-accounts
 * Add a new bank account
 */
export async function POST(request: NextRequest) {
  try {
    const user = await requireAuth(request);
    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const body = await request.json();
    const { bankCode, accountNumber, setDefault } = body;

    if (!bankCode || !accountNumber) {
      return NextResponse.json(
        { error: "Bank code and account number are required" },
        { status: 400 }
      );
    }

    // Validate account number format (10 digits for Nigerian banks)
    if (!/^\d{10}$/.test(accountNumber)) {
      return NextResponse.json(
        { error: "Account number must be 10 digits" },
        { status: 400 }
      );
    }

    // Resolve account details from Paystack
    const accountDetails = await resolveBankAccount(accountNumber, bankCode);

    if (!accountDetails || !accountDetails.data) {
      return NextResponse.json(
        { error: "Unable to verify bank account. Please check the details." },
        { status: 400 }
      );
    }

    const { account_name, bank_name } = accountDetails.data;

    // Create transfer recipient in Paystack
    const recipient = await createTransferRecipient({
      name: account_name,
      accountNumber,
      bankCode,
    });

    if (!recipient || !recipient.data) {
      return NextResponse.json(
        { error: "Failed to create transfer recipient" },
        { status: 500 }
      );
    }

    const recipientCode = recipient.data.recipient_code;

    // If setting as default, unset other defaults
    if (setDefault) {
      await db
        .update(bankAccounts)
        .set({ isDefault: 0 })
        .where(eq(bankAccounts.userId, user.id));
    }

    // Save bank account
    const [newAccount] = await db
      .insert(bankAccounts)
      .values({
        userId: user.id,
        bankName: bank_name,
        bankCode,
        accountNumber,
        accountName: account_name,
        recipientCode,
        isDefault: setDefault ? 1 : 0,
      })
      .returning();

    logger.info("Bank account added", {
      userId: user.id,
      accountId: newAccount.id,
      bankName: bank_name,
    });

    return NextResponse.json({
      ok: true,
      bankAccount: {
        id: newAccount.id,
        bankName: newAccount.bankName,
        bankCode: newAccount.bankCode,
        accountNumber: newAccount.accountNumber,
        accountName: newAccount.accountName,
        isDefault: newAccount.isDefault === 1,
      },
      message: "Bank account added successfully",
    });
  } catch (error) {
    logger.error("Failed to add bank account:", { error });
    return NextResponse.json(
      { error: "Failed to add bank account" },
      { status: 500 }
    );
  }
}

/**
 * DELETE /api/wallet/bank-accounts
 * Delete a bank account
 */
export async function DELETE(request: NextRequest) {
  try {
    const user = await requireAuth(request);
    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { searchParams } = new URL(request.url);
    const accountId = searchParams.get("id");

    if (!accountId) {
      return NextResponse.json(
        { error: "Account ID is required" },
        { status: 400 }
      );
    }

    // Verify account belongs to user
    const [account] = await db
      .select()
      .from(bankAccounts)
      .where(
        and(
          eq(bankAccounts.id, accountId),
          eq(bankAccounts.userId, user.id)
        )
      )
      .limit(1);

    if (!account) {
      return NextResponse.json(
        { error: "Bank account not found" },
        { status: 404 }
      );
    }

    // Delete account
    await db
      .delete(bankAccounts)
      .where(eq(bankAccounts.id, accountId));

    logger.info("Bank account deleted", {
      userId: user.id,
      accountId,
    });

    return NextResponse.json({
      ok: true,
      message: "Bank account deleted successfully",
    });
  } catch (error) {
    logger.error("Failed to delete bank account:", { error });
    return NextResponse.json(
      { error: "Failed to delete bank account" },
      { status: 500 }
    );
  }
}
