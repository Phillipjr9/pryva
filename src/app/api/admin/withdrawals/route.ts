import { randomBytes } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { and, desc, eq, inArray, isNotNull, isNull, sql } from "drizzle-orm";
import { authorizeAdminApi } from "@/lib/identity/admin-auth";
import { db } from "@/db";
import { withdrawals, users, walletTransactions } from "@/db/schema";
import { initiateTransfer, isPaystackConfigured } from "@/lib/payments/paystack";
import { paystackTransferReference } from "@/lib/payments/paystack-transfer-reference";
import { scheduleWalletEmails } from "@/lib/email/schedule-wallet-emails";
import { financialActionsUnavailable, isVercelPreview } from "@/lib/platform/financial-environment";
import { logger } from "@/lib/platform/logger";
import { isJsonRequest, readJsonWithLimit, RequestBodyTooLargeError } from "@/lib/platform/request-body";
import { isSameOriginMutation } from "@/lib/platform/net";
import { recordAdminAction } from "@/lib/admin/admin-audit";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  try {
    const access = await authorizeAdminApi(request);
    if (access.response) return access.response;

    const status = request.nextUrl.searchParams.get("status");
    const allWithdrawals = await db
      .select({
        id: withdrawals.id,
        userId: withdrawals.userId,
        amount: withdrawals.amount,
        fee: withdrawals.fee,
        bankName: withdrawals.bankName,
        accountNumber: withdrawals.accountNumber,
        accountName: withdrawals.accountName,
        recipientCode: withdrawals.recipientCode,
        status: withdrawals.status,
        reference: withdrawals.reference,
        paystackReference: withdrawals.paystackReference,
        transferReference: withdrawals.transferReference,
        failureReason: withdrawals.failureReason,
        riskLevel: withdrawals.riskLevel,
        riskReasons: withdrawals.riskReasons,
        createdAt: withdrawals.createdAt,
        processedAt: withdrawals.processedAt,
        completedAt: withdrawals.completedAt,
        userName: users.name,
        userEmail: users.email,
      })
      .from(withdrawals)
      .leftJoin(users, eq(withdrawals.userId, users.id))
      .where(status && status !== "all" ? eq(withdrawals.status, status) : undefined)
      .orderBy(desc(withdrawals.createdAt))
      .limit(200);

    return NextResponse.json({ ok: true, withdrawals: allWithdrawals, count: allWithdrawals.length });
  } catch (error) {
    logger.error("Failed to fetch withdrawals", { error });
    return NextResponse.json({ error: "Failed to fetch withdrawals" }, { status: 500 });
  }
}

export async function PUT(request: NextRequest) {
  // These are the most privileged mutations in the app: they move real money out
  // and edit accounts. Cookie-based admin sessions make them a CSRF target, so
  // the origin is checked before authorization -- failing fast also avoids
  // telling an unauthenticated cross-origin caller anything about the account.
  if (!isSameOriginMutation(request)) {
    return NextResponse.json({ error: "Invalid origin" }, { status: 403 });
  }
  try {
    const access = await authorizeAdminApi(request);
    if (access.response) return access.response;
    if (isVercelPreview()) return NextResponse.json({ error: "Withdrawal processing is unavailable in preview" }, { status: 503 });
    const admin = access.user;
    if (!isJsonRequest(request)) return NextResponse.json({ error: "Expected JSON" }, { status: 415 });
    let body: unknown;
    try {
      body = await readJsonWithLimit(request, 2_048);
    } catch (error) {
      return NextResponse.json({ error: "Invalid request body" }, { status: error instanceof RequestBodyTooLargeError ? 413 : 400 });
    }
    if (!body || typeof body !== "object" || Array.isArray(body)) return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
    const { id, action, reason, reconciliationConfirmed } = body as { id?: unknown; action?: unknown; reason?: unknown; reconciliationConfirmed?: unknown };
    if (typeof id !== "string" || !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(id) || !["approve", "reject", "complete"].includes(String(action))) {
      return NextResponse.json({ error: "A withdrawal ID and valid action are required" }, { status: 400 });
    }
    if (reason !== undefined && (typeof reason !== "string" || reason.length > 500)) {
      return NextResponse.json({ error: "Invalid reason" }, { status: 400 });
    }

    if (action === "approve") {
      // Preview balances are simulated, even when a real Paystack key happens
      // to be present. Never turn them into an actual bank transfer.
      if (financialActionsUnavailable() || !isPaystackConfigured()) {
        return NextResponse.json({ error: "Bank transfers are unavailable in this environment" }, { status: 503 });
      }
      const [existing] = await db.select().from(withdrawals).where(eq(withdrawals.id, id)).limit(1);
      if (!existing) return NextResponse.json({ error: "Withdrawal not found" }, { status: 404 });
      if (!existing.recipientCode) return NextResponse.json({ error: "Transfer recipient is missing" }, { status: 400 });
      if (!["pending", "processing"].includes(existing.status)) {
        return NextResponse.json({ error: "This withdrawal is already settled or has been resolved. Reconcile it before retrying." }, { status: 409 });
      }
      if (existing.status === "processing" && existing.transferReference) {
        return NextResponse.json({ error: "This payout already has a transfer code and final status is already in progress; use completion or reconciliation instead." }, { status: 409 });
      }

      // Persist a unique, Paystack-compatible lowercase reference in the same
      // claim as the status transition, before any external request. Legacy
      // processing rows keep their original, possibly unknown reference.
      const providerReference = paystackTransferReference(existing.id);
      const [claimed] = await db.update(withdrawals)
        .set({ status: "processing", paystackReference: providerReference, processedAt: new Date(), failureReason: null })
        .where(and(
          eq(withdrawals.id, id),
          inArray(withdrawals.status, ["pending", "processing"]),
          isNull(withdrawals.transferReference),
        ))
        .returning();
      if (!claimed) return NextResponse.json({ error: "Withdrawal is no longer eligible for manual review; reconcile it before retrying." }, { status: 409 });
      scheduleWalletEmails();

      try {
        const transfer = await initiateTransfer({
          source: "balance",
          amount: claimed.amount * 100,
          currency: "NGN",
          recipient: existing.recipientCode,
          reason: `Withdrawal ${claimed.reference}`,
          reference: providerReference,
        });
        const transferCode = transfer.data?.transfer_code;
        if (transfer.status !== true || typeof transferCode !== "string" || !transferCode.trim() || transferCode.length > 100 ||
            transfer.data.reference !== providerReference || transfer.data.amount !== claimed.amount * 100 || transfer.data.currency !== "NGN") {
          throw new Error("Transfer initiation details were not confirmed");
        }

        const providerStatus = typeof transfer.data.status === "string" && transfer.data.status.length <= 40 ? transfer.data.status : "unknown";
        const note = providerStatus === "otp"
          ? "Paystack requires merchant authorization. Follow its approval process and verify settlement."
          : providerStatus === "failed" || providerStatus === "reversed"
            ? "Paystack reports this transfer failed or reversed. Reconcile the final outcome before refunding."
            : !["pending", "processing", "queued", "success"].includes(providerStatus)
              ? "Paystack transfer status is unconfirmed. Reconcile it before retrying or refunding."
              : null;
        // The row may have moved while Paystack was answering: a signed
        // transfer.success or transfer.reversed event is applied by the webhook
        // whenever it arrives, and what it wrote is newer than this response.
        // Same guard as `lib/payments/payouts.ts:176`, which does this write properly.
        await db.update(withdrawals)
          .set({ transferReference: transferCode, failureReason: note })
          .where(and(eq(withdrawals.id, id), eq(withdrawals.status, "processing")));
        logger.info("Withdrawal transfer initiated", { withdrawalId: id, adminId: admin.id, providerStatus });
        await recordAdminAction({
          actor: admin,
          action: "withdrawal.approve",
          targetType: "withdrawal",
          targetId: claimed.id,
          summary:
            `Initiated a ₦${claimed.amount.toLocaleString("en-NG")} transfer for ${claimed.reference} to ${claimed.bankName}` +
            ` (provider status ${providerStatus})` +
            (note ? " — left for reconciliation" : ""),
        });
        return NextResponse.json({ ok: true, needsReview: Boolean(note), message: note ?? "Transfer initiated; settlement still requires verification.", transferCode, paystackReference: providerReference });
      } catch {
        // A timeout can occur after Paystack accepted the transfer. Refunding
        // immediately could pay twice, so leave it for manual reconciliation.
        await db.update(withdrawals)
          .set({ failureReason: "Transfer outcome unconfirmed. Check Paystack before resolving." })
          .where(and(eq(withdrawals.id, id), eq(withdrawals.status, "processing")));
        logger.error("Withdrawal transfer needs reconciliation", { withdrawalId: id, adminId: admin.id });
        await recordAdminAction({
          actor: admin,
          action: "withdrawal.approve",
          targetType: "withdrawal",
          targetId: claimed.id,
          summary: `Transfer initiation for ${claimed.reference} (₦${claimed.amount.toLocaleString("en-NG")}) has an unconfirmed outcome; left for reconciliation, not refunded`,
        });
        return NextResponse.json({ error: "Transfer outcome unconfirmed. Check Paystack before resolving this request." }, { status: 502 });
      }
    }

    if (action === "reject") {
      const rejected = await db.transaction(async (tx) => {
        const [claimed] = await tx.update(withdrawals)
          .set({ status: "rejected", failureReason: typeof reason === "string" && reason.trim() ? reason.trim() : "Rejected by admin", processedAt: new Date() })
          .where(and(
            eq(withdrawals.id, id),
            inArray(withdrawals.status, ["pending", "processing"]),
            isNull(withdrawals.transferReference),
          ))
          .returning();
        if (!claimed) return null;

        const refundAmount = claimed.amount + claimed.fee;
        const [user] = await tx.update(users)
          .set({ walletBalance: sql`${users.walletBalance} + ${refundAmount}` })
          .where(eq(users.id, claimed.userId))
          .returning({ balance: users.walletBalance });
        if (!user) throw new Error("Withdrawal user not found");

        await tx.insert(walletTransactions).values({
          userId: claimed.userId,
          type: "refund",
          amount: refundAmount,
          balanceAfter: user.balance,
          description: `Refund for rejected withdrawal ${claimed.reference}`,
          reference: `RWD-${randomBytes(12).toString("hex")}`,
        });
        return claimed;
      });
      if (!rejected) return NextResponse.json({ error: "Withdrawal is no longer pending or has a provider reference. Reconcile it before refunding." }, { status: 409 });
      logger.info("Withdrawal rejected", { withdrawalId: id, adminId: admin.id });
      await recordAdminAction({
        actor: admin,
        action: "withdrawal.reject",
        targetType: "withdrawal",
        targetId: rejected.id,
        summary:
          `Rejected ${rejected.reference} (₦${rejected.amount.toLocaleString("en-NG")}) and refunded ` +
          `₦${(rejected.amount + rejected.fee).toLocaleString("en-NG")} to the wallet` +
          (typeof reason === "string" && reason.trim() ? ` — ${reason.trim()}` : ""),
      });
      scheduleWalletEmails();
      return NextResponse.json({ ok: true, message: "Withdrawal rejected and user refunded" });
    }

    if (reconciliationConfirmed !== true || typeof reason !== "string" || !reason.trim()) {
      return NextResponse.json({ error: "Confirm settlement with Paystack and provide a reconciliation note." }, { status: 400 });
    }
    // A processing request with no saved transfer code may still be in flight
    // or have an ambiguous outcome. Do not mark it settled from this endpoint.
    const [completed] = await db.update(withdrawals)
      .set({ status: "completed", completedAt: new Date() })
      .where(and(eq(withdrawals.id, id), eq(withdrawals.status, "processing"), isNotNull(withdrawals.transferReference)))
      .returning({ id: withdrawals.id });
    if (!completed) return NextResponse.json({ error: "Withdrawal has no confirmed initiation; reconcile it manually." }, { status: 409 });
    logger.info("Withdrawal marked completed after manual reconciliation", { withdrawalId: id, adminId: admin.id, note: reason.trim() });
    await recordAdminAction({
      actor: admin,
      action: "withdrawal.complete",
      targetType: "withdrawal",
      targetId: completed.id,
      summary: `Marked withdrawal settled after reconciliation — ${reason.trim()}`,
    });
    scheduleWalletEmails();
    return NextResponse.json({ ok: true, message: "Withdrawal marked as completed" });
  } catch (error) {
    logger.error("Failed to process withdrawal", { error });
    return NextResponse.json({ error: "Failed to process withdrawal" }, { status: 500 });
  }
}
