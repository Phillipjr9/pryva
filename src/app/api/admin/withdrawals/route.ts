import { randomBytes } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { and, desc, eq, sql } from "drizzle-orm";
import { authorizeAdminApi } from "@/lib/admin-auth";
import { db } from "@/db";
import { withdrawals, users, walletTransactions } from "@/db/schema";
import { initiateTransfer } from "@/lib/paystack";
import { logger } from "@/lib/logger";

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
        transferReference: withdrawals.transferReference,
        failureReason: withdrawals.failureReason,
        createdAt: withdrawals.createdAt,
        processedAt: withdrawals.processedAt,
        completedAt: withdrawals.completedAt,
        userName: users.name,
        userEmail: users.email,
      })
      .from(withdrawals)
      .leftJoin(users, eq(withdrawals.userId, users.id))
      .where(status && status !== "all" ? eq(withdrawals.status, status) : undefined)
      .orderBy(desc(withdrawals.createdAt));

    return NextResponse.json({ ok: true, withdrawals: allWithdrawals, count: allWithdrawals.length });
  } catch (error) {
    logger.error("Failed to fetch withdrawals", { error });
    return NextResponse.json({ error: "Failed to fetch withdrawals" }, { status: 500 });
  }
}

export async function PUT(request: NextRequest) {
  try {
    const access = await authorizeAdminApi(request);
    if (access.response) return access.response;
    const admin = access.user;
    const { id, action, reason } = await request.json() as { id?: unknown; action?: unknown; reason?: unknown };
    if (typeof id !== "string" || !id || !["approve", "reject", "complete"].includes(String(action))) {
      return NextResponse.json({ error: "A withdrawal ID and valid action are required" }, { status: 400 });
    }
    if (reason !== undefined && (typeof reason !== "string" || reason.length > 500)) {
      return NextResponse.json({ error: "Invalid reason" }, { status: 400 });
    }

    if (action === "approve") {
      const [existing] = await db.select().from(withdrawals).where(eq(withdrawals.id, id)).limit(1);
      if (!existing) return NextResponse.json({ error: "Withdrawal not found" }, { status: 404 });
      if (!existing.recipientCode) return NextResponse.json({ error: "Transfer recipient is missing" }, { status: 400 });

      // Only one administrator can claim a pending request and initiate its transfer.
      const [claimed] = await db.update(withdrawals)
        .set({ status: "processing", processedAt: new Date(), failureReason: null })
        .where(and(eq(withdrawals.id, id), eq(withdrawals.status, "pending")))
        .returning();
      if (!claimed) return NextResponse.json({ error: "Withdrawal is no longer pending" }, { status: 409 });

      try {
        const transfer = await initiateTransfer({
          source: "balance",
          amount: claimed.amount * 100,
          recipient: existing.recipientCode,
          reason: `Withdrawal ${claimed.reference}`,
          reference: claimed.reference,
        });
        if (!transfer.status || !transfer.data?.transfer_code) throw new Error("Transfer was not confirmed");

        await db.update(withdrawals)
          .set({ transferReference: transfer.data.transfer_code })
          .where(eq(withdrawals.id, id));
        logger.info("Withdrawal transfer initiated", { withdrawalId: id, adminId: admin.id });
        return NextResponse.json({ ok: true, message: "Withdrawal approved and transfer initiated", transferCode: transfer.data.transfer_code });
      } catch (error) {
        // A timeout can occur after Paystack accepted the transfer. Refunding
        // immediately could pay twice, so leave it for manual reconciliation.
        await db.update(withdrawals)
          .set({ failureReason: "Transfer outcome unconfirmed. Check Paystack before resolving." })
          .where(and(eq(withdrawals.id, id), eq(withdrawals.status, "processing")));
        logger.error("Withdrawal transfer needs reconciliation", { withdrawalId: id, adminId: admin.id, error });
        return NextResponse.json({ error: "Transfer outcome unconfirmed. Check Paystack before resolving this request." }, { status: 502 });
      }
    }

    if (action === "reject") {
      const rejected = await db.transaction(async (tx) => {
        const [claimed] = await tx.update(withdrawals)
          .set({ status: "rejected", failureReason: typeof reason === "string" && reason.trim() ? reason.trim() : "Rejected by admin", processedAt: new Date() })
          .where(and(eq(withdrawals.id, id), eq(withdrawals.status, "pending")))
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
      if (!rejected) return NextResponse.json({ error: "Withdrawal is no longer pending" }, { status: 409 });
      logger.info("Withdrawal rejected", { withdrawalId: id, adminId: admin.id });
      return NextResponse.json({ ok: true, message: "Withdrawal rejected and user refunded" });
    }

    const [completed] = await db.update(withdrawals)
      .set({ status: "completed", completedAt: new Date() })
      .where(and(eq(withdrawals.id, id), eq(withdrawals.status, "processing")))
      .returning({ id: withdrawals.id });
    if (!completed) return NextResponse.json({ error: "Withdrawal is not processing" }, { status: 409 });
    logger.info("Withdrawal completed", { withdrawalId: id, adminId: admin.id });
    return NextResponse.json({ ok: true, message: "Withdrawal marked as completed" });
  } catch (error) {
    logger.error("Failed to process withdrawal", { error });
    return NextResponse.json({ error: "Failed to process withdrawal" }, { status: 500 });
  }
}
