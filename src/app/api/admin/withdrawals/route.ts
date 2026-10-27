import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { withdrawals, users, walletTransactions } from "@/db/schema";
import { eq, and, desc, sql } from "drizzle-orm";
import { requireAdmin } from "@/lib/auth";
import { initiateTransfer } from "@/lib/paystack";
import { logger } from "@/lib/logger";

export const dynamic = "force-dynamic";

/**
 * GET /api/admin/withdrawals
 * Get all withdrawal requests (with optional status filter)
 */
export async function GET(request: NextRequest) {
  try {
    await requireAdmin();

    const { searchParams } = new URL(request.url);
    const status = searchParams.get("status");

    let query = db
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
      .orderBy(desc(withdrawals.createdAt));

    if (status && status !== "all") {
      query = query.where(eq(withdrawals.status, status)) as typeof query;
    }

    const allWithdrawals = await query;

    return NextResponse.json({
      ok: true,
      withdrawals: allWithdrawals,
      count: allWithdrawals.length,
    });
  } catch (error) {
    logger.error("Failed to fetch withdrawals:", { error });
    return NextResponse.json(
      { error: "Failed to fetch withdrawals" },
      { status: 500 }
    );
  }
}

/**
 * PUT /api/admin/withdrawals
 * Process withdrawal (approve/reject/complete)
 */
export async function PUT(request: NextRequest) {
  try {
    const admin = await requireAdmin();

    const body = await request.json();
    const { id, action, reason } = body;

    if (!id || !action) {
      return NextResponse.json(
        { error: "Withdrawal ID and action are required" },
        { status: 400 }
      );
    }

    // Get withdrawal details
    const [withdrawal] = await db
      .select()
      .from(withdrawals)
      .where(eq(withdrawals.id, id))
      .limit(1);

    if (!withdrawal) {
      return NextResponse.json(
        { error: "Withdrawal not found" },
        { status: 404 }
      );
    }

    const now = new Date();

    if (action === "approve") {
      // Verify withdrawal is still pending
      if (withdrawal.status !== "pending") {
        return NextResponse.json(
          { error: "Withdrawal is not in pending status" },
          { status: 400 }
        );
      }

      // Update status to processing
      await db
        .update(withdrawals)
        .set({
          status: "processing",
          processedAt: now,
        })
        .where(eq(withdrawals.id, id));

      // Initiate transfer via Paystack
      try {
        if (!withdrawal.recipientCode) {
          throw new Error("Recipient code not found");
        }

        const transfer = await initiateTransfer({
          source: "balance",
          amount: withdrawal.amount * 100, // Convert to kobo
          recipient: withdrawal.recipientCode,
          reason: `Withdrawal ${withdrawal.reference}`,
          reference: withdrawal.reference,
        });

        if (transfer.status && transfer.data) {
          // Update with transfer reference
          await db
            .update(withdrawals)
            .set({
              transferReference: transfer.data.transfer_code,
            })
            .where(eq(withdrawals.id, id));

          logger.info("Withdrawal transfer initiated", {
            withdrawalId: id,
            transferCode: transfer.data.transfer_code,
            adminId: admin.id,
          });

          return NextResponse.json({
            ok: true,
            message: "Withdrawal approved and transfer initiated",
            transferCode: transfer.data.transfer_code,
          });
        } else {
          throw new Error("Transfer initiation failed");
        }
      } catch (transferError) {
        // Mark as failed if transfer fails
        await db
          .update(withdrawals)
          .set({
            status: "failed",
            failureReason: transferError instanceof Error ? transferError.message : "Transfer failed",
          })
          .where(eq(withdrawals.id, id));

        // Refund the user
        const [user] = await db
          .select()
          .from(users)
          .where(eq(users.id, withdrawal.userId))
          .limit(1);

        if (user) {
          const refundAmount = withdrawal.amount + withdrawal.fee;
          const newBalance = user.walletBalance + refundAmount;

          await db
            .update(users)
            .set({ walletBalance: newBalance })
            .where(eq(users.id, withdrawal.userId));

          // Record refund transaction
          await db.insert(walletTransactions).values({
            userId: withdrawal.userId,
            type: "refund",
            amount: refundAmount,
            balanceAfter: newBalance,
            description: `Refund for failed withdrawal ${withdrawal.reference}`,
            reference: `REFUND-${withdrawal.reference}`,
          });
        }

        logger.error("Withdrawal transfer failed", {
          withdrawalId: id,
          error: transferError,
          adminId: admin.id,
        });

        return NextResponse.json(
          { error: "Transfer initiation failed. User has been refunded." },
          { status: 500 }
        );
      }
    } else if (action === "reject") {
      // Verify withdrawal is still pending
      if (withdrawal.status !== "pending") {
        return NextResponse.json(
          { error: "Withdrawal is not in pending status" },
          { status: 400 }
        );
      }

      // Update status to rejected
      await db
        .update(withdrawals)
        .set({
          status: "rejected",
          failureReason: reason || "Rejected by admin",
          processedAt: now,
        })
        .where(eq(withdrawals.id, id));

      // Refund the user
      const [user] = await db
        .select()
        .from(users)
        .where(eq(users.id, withdrawal.userId))
        .limit(1);

      if (user) {
        const refundAmount = withdrawal.amount + withdrawal.fee;
        const newBalance = user.walletBalance + refundAmount;

        await db
          .update(users)
          .set({ walletBalance: newBalance })
          .where(eq(users.id, withdrawal.userId));

        // Record refund transaction
        await db.insert(walletTransactions).values({
          userId: withdrawal.userId,
          type: "refund",
          amount: refundAmount,
          balanceAfter: newBalance,
          description: `Refund for rejected withdrawal ${withdrawal.reference}`,
          reference: `REFUND-${withdrawal.reference}`,
        });
      }

      logger.info("Withdrawal rejected", {
        withdrawalId: id,
        reason,
        adminId: admin.id,
      });

      return NextResponse.json({
        ok: true,
        message: "Withdrawal rejected and user refunded",
      });
    } else if (action === "complete") {
      // Verify withdrawal is in processing status
      if (withdrawal.status !== "processing") {
        return NextResponse.json(
          { error: "Withdrawal is not in processing status" },
          { status: 400 }
        );
      }

      // Update status to completed
      await db
        .update(withdrawals)
        .set({
          status: "completed",
          completedAt: now,
        })
        .where(eq(withdrawals.id, id));

      logger.info("Withdrawal completed", {
        withdrawalId: id,
        adminId: admin.id,
      });

      return NextResponse.json({
        ok: true,
        message: "Withdrawal marked as completed",
      });
    } else {
      return NextResponse.json(
        { error: "Invalid action" },
        { status: 400 }
      );
    }
  } catch (error) {
    logger.error("Failed to process withdrawal:", { error });
    return NextResponse.json(
      { error: "Failed to process withdrawal" },
      { status: 500 }
    );
  }
}
