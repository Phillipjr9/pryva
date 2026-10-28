import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { bankAccounts } from "@/db/schema";
import { eq, and, desc } from "drizzle-orm";
import { requireAuthApi } from "@/lib/auth";
import { resolveBankAccount, createTransferRecipient, getBanks, isPaystackConfigured } from "@/lib/paystack";
import { FALLBACK_BANKS } from "@/lib/banks";
import { isPreviewDatabase } from "@/lib/demo-policy";
import { isSameOriginMutation } from "@/lib/net";
import { logger } from "@/lib/logger";
import { readJsonWithLimit, RequestBodyTooLargeError } from "@/lib/request-body";
import { purchaseRateLimiter } from "@/lib/rate-limit";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const user = await requireAuthApi();
    if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    const accounts = await db.select().from(bankAccounts)
      .where(eq(bankAccounts.userId, user.id)).orderBy(desc(bankAccounts.isDefault));
    return NextResponse.json({
      ok: true,
      bankAccounts: accounts.map((acc) => ({
        id: acc.id, bankName: acc.bankName, bankCode: acc.bankCode,
        accountNumber: acc.accountNumber, accountName: acc.accountName,
        isDefault: acc.isDefault === 1, createdAt: acc.createdAt,
      })),
    });
  } catch {
    logger.error("Failed to fetch bank accounts");
    return NextResponse.json({ error: "Failed to fetch bank accounts" }, { status: 500 });
  }
}

/** Add a verified recipient; the bank name comes from the trusted directory. */
export async function POST(request: NextRequest) {
  try {
    const user = await requireAuthApi();
    if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    if (!isSameOriginMutation(request)) return NextResponse.json({ error: "Cross-origin request denied" }, { status: 403 });
    if (!/^application\/json(?:\s*;|$)/i.test(request.headers.get("content-type") ?? "")) {
      return NextResponse.json({ error: "Content-Type must be application/json" }, { status: 415 });
    }
    if (isPreviewDatabase() || !isPaystackConfigured()) {
      return NextResponse.json({ error: "Bank transfers are unavailable in this environment." }, { status: 503 });
    }

    const limit = await purchaseRateLimiter(`bank-account-add:${user.id}`);
    if (limit.unavailable) return NextResponse.json({ error: "Bank verification is temporarily unavailable." }, { status: 503 });
    if (!limit.allowed) return NextResponse.json({ error: "Too many attempts. Try again later." }, { status: 429 });
    let body: { bankCode?: unknown; accountNumber?: unknown; expectedAccountName?: unknown; setDefault?: unknown };
    try {
      const value = await readJsonWithLimit(request, 2_048);
      if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Invalid body");
      body = value;
    } catch (error) {
      return NextResponse.json({ error: "Invalid request body" }, { status: error instanceof RequestBodyTooLargeError ? 413 : 400 });
    }
    const { bankCode, accountNumber, expectedAccountName, setDefault } = body;
    if (typeof bankCode !== "string" || !/^[a-z0-9]{1,20}$/i.test(bankCode) ||
        typeof accountNumber !== "string" || !/^\d{10}$/.test(accountNumber) ||
        (expectedAccountName !== undefined && (typeof expectedAccountName !== "string" || !expectedAccountName.trim() || expectedAccountName.length > 200)) ||
        (setDefault !== undefined && typeof setDefault !== "boolean")) {
      return NextResponse.json({ error: "Enter a valid bank code and 10-digit account number" }, { status: 400 });
    }

    // /bank/resolve provides account_name and bank_id, not bank_name. Never use
    // an arbitrary client-supplied name. The bundled directory is a trusted
    // fallback when the live list is unavailable; resolution still verifies it.
    let directory = FALLBACK_BANKS;
    try {
      const liveBanks = await getBanks();
      if (liveBanks.length) directory = liveBanks;
    } catch {
      logger.warn("Bank directory unavailable; using bundled directory");
    }
    const bank = directory.find((item) => item.code === bankCode);
    if (!bank || !bank.name.trim() || bank.name.length > 100) {
      return NextResponse.json({ error: "Bank is not in the supported directory." }, { status: 400 });
    }
    const resolved = await resolveBankAccount(accountNumber, bankCode);
    const accountName = resolved.data?.account_name?.trim();
    if (resolved.status !== true || resolved.data?.account_number !== accountNumber ||
        !accountName || accountName.length > 200) {
      return NextResponse.json({ error: "Unable to verify bank account. Please check the details." }, { status: 400 });
    }
    // The name the customer reviewed must still match the provider result at
    // save time; otherwise show the updated result for review instead.
    if (typeof expectedAccountName === "string" && accountName !== expectedAccountName.trim()) {
      return NextResponse.json({ error: "The resolved account name changed. Verify it again before saving." }, { status: 409 });
    }
    const recipient = await createTransferRecipient({ name: accountName, accountNumber, bankCode });
    const recipientCode = recipient.data?.recipient_code;
    if (recipient.status !== true || typeof recipientCode !== "string" || !recipientCode || recipientCode.length > 100) {
      return NextResponse.json({ error: "Failed to create transfer recipient" }, { status: 502 });
    }

    const newAccount = await db.transaction(async (tx) => {
      if (setDefault) {
        await tx.update(bankAccounts).set({ isDefault: 0 }).where(eq(bankAccounts.userId, user.id));
      }
      const [saved] = await tx.insert(bankAccounts).values({
        userId: user.id, bankName: bank.name, bankCode, accountNumber,
        accountName, recipientCode, isDefault: setDefault ? 1 : 0,
      }).returning();
      if (!saved) throw new Error("Bank account insert failed");
      return saved;
    });
    logger.info("Bank account added", { userId: user.id, accountId: newAccount.id });
    return NextResponse.json({
      ok: true,
      bankAccount: {
        id: newAccount.id, bankName: newAccount.bankName, bankCode: newAccount.bankCode,
        accountNumber: newAccount.accountNumber, accountName: newAccount.accountName,
        isDefault: newAccount.isDefault === 1,
      },
      message: "Bank account added successfully",
    });
  } catch {
    // Provider responses may contain bank account information; don't log them.
    logger.error("Failed to add bank account");
    return NextResponse.json({ error: "Failed to add bank account" }, { status: 502 });
  }
}

export async function DELETE(request: NextRequest) {
  try {
    const user = await requireAuthApi();
    if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    if (!isSameOriginMutation(request)) return NextResponse.json({ error: "Cross-origin request denied" }, { status: 403 });
    const accountId = new URL(request.url).searchParams.get("id");
    if (!accountId) return NextResponse.json({ error: "Account ID is required" }, { status: 400 });
    const [account] = await db.select().from(bankAccounts)
      .where(and(eq(bankAccounts.id, accountId), eq(bankAccounts.userId, user.id))).limit(1);
    if (!account) return NextResponse.json({ error: "Bank account not found" }, { status: 404 });
    await db.delete(bankAccounts).where(and(eq(bankAccounts.id, accountId), eq(bankAccounts.userId, user.id)));
    logger.info("Bank account deleted", { userId: user.id, accountId });
    return NextResponse.json({ ok: true, message: "Bank account deleted successfully" });
  } catch {
    logger.error("Failed to delete bank account");
    return NextResponse.json({ error: "Failed to delete bank account" }, { status: 500 });
  }
}
