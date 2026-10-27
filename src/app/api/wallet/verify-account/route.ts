import { NextRequest, NextResponse } from "next/server";
import { requireAuthApi } from "@/lib/auth";
import { resolveBankAccount } from "@/lib/paystack";
import { logger } from "@/lib/logger";

export const dynamic = "force-dynamic";

/**
 * POST /api/wallet/verify-account
 * Verify bank account details before adding
 */
export async function POST(request: NextRequest) {
  try {
    const user = await requireAuthApi();
    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const body = await request.json();
    const { bankCode, accountNumber } = body;

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

    const { account_name } = accountDetails.data;

    logger.info("Bank account verified", {
      userId: user.id,
      bankCode,
      accountNumber,
      accountName: account_name,
    });

    return NextResponse.json({
      ok: true,
      accountName: account_name,
    });
  } catch (error) {
    logger.error("Failed to verify bank account:", { error });
    return NextResponse.json(
      { error: "Failed to verify bank account" },
      { status: 500 }
    );
  }
}
