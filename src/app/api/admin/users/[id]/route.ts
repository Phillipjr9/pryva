import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { users, orders, walletTransactions, withdrawals } from "@/db/schema";
import { eq, desc, sql } from "drizzle-orm";
import { requireAdminApi } from "@/lib/auth";
import { logger } from "@/lib/logger";

export const dynamic = "force-dynamic";

/**
 * GET /api/admin/users/[id]
 * Get detailed user information for admin
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const admin = await requireAdminApi();
    if (!admin) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const { id: userId } = await params;

    // Get user details
    const [user] = await db
      .select()
      .from(users)
      .where(eq(users.id, userId))
      .limit(1);

    if (!user) {
      return NextResponse.json(
        { error: "User not found" },
        { status: 404 }
      );
    }

    // Get user's orders
    const userOrders = await db
      .select()
      .from(orders)
      .where(eq(orders.userId, userId))
      .orderBy(desc(orders.createdAt))
      .limit(50);

    // Get user's transactions
    const userTransactions = await db
      .select()
      .from(walletTransactions)
      .where(eq(walletTransactions.userId, userId))
      .orderBy(desc(walletTransactions.createdAt))
      .limit(50);

    // Get user's withdrawals
    const userWithdrawals = await db
      .select()
      .from(withdrawals)
      .where(eq(withdrawals.userId, userId))
      .orderBy(desc(withdrawals.createdAt))
      .limit(50);

    // Calculate stats
    const [orderStats] = await db
      .select({
        total: sql<number>`count(*)`,
        totalSpent: sql<number>`COALESCE(sum(${orders.amount}), 0)`,
      })
      .from(orders)
      .where(eq(orders.userId, userId));

    const [withdrawalStats] = await db
      .select({
        total: sql<number>`count(*)`,
        totalWithdrawn: sql<number>`COALESCE(sum(${withdrawals.amount}), 0)`,
        pending: sql<number>`count(*) FILTER (WHERE ${withdrawals.status} = 'pending')`,
      })
      .from(withdrawals)
      .where(eq(withdrawals.userId, userId));

    return NextResponse.json({
      ok: true,
      user: {
        id: user.id,
        name: user.name,
        email: user.email,
        walletBalance: user.walletBalance,
        createdAt: user.createdAt,
      },
      stats: {
        totalOrders: Number(orderStats?.total || 0),
        totalSpent: Number(orderStats?.totalSpent || 0),
        totalWithdrawals: Number(withdrawalStats?.total || 0),
        totalWithdrawn: Number(withdrawalStats?.totalWithdrawn || 0),
        pendingWithdrawals: Number(withdrawalStats?.pending || 0),
      },
      recentOrders: userOrders.slice(0, 10),
      recentTransactions: userTransactions.slice(0, 20),
      recentWithdrawals: userWithdrawals.slice(0, 10),
    });
  } catch (error) {
    logger.error("Failed to fetch user details:", { error });
    return NextResponse.json(
      { error: "Failed to fetch user details" },
      { status: 500 }
    );
  }
}

/**
 * PUT /api/admin/users/[id]
 * Update user (adjust balance, etc.)
 */
export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const admin = await requireAdminApi();
    if (!admin) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const { id: userId } = await params;
    const body = await request.json();
    const { action, amount, reason } = body;

    if (!action) {
      return NextResponse.json(
        { error: "Action is required" },
        { status: 400 }
      );
    }

    // Get user
    const [user] = await db
      .select()
      .from(users)
      .where(eq(users.id, userId))
      .limit(1);

    if (!user) {
      return NextResponse.json(
        { error: "User not found" },
        { status: 404 }
      );
    }

    if (action === "credit") {
      if (!amount || amount <= 0) {
        return NextResponse.json(
          { error: "Valid amount is required" },
          { status: 400 }
        );
      }

      const newBalance = user.walletBalance + amount;

      await db
        .update(users)
        .set({ walletBalance: newBalance })
        .where(eq(users.id, userId));

      // Record transaction
      const reference = `ADMIN-CREDIT-${Date.now()}`;
      await db.insert(walletTransactions).values({
        userId,
        type: "credit",
        amount,
        balanceAfter: newBalance,
        description: reason || `Admin credit by ${admin.email}`,
        reference,
      });

      logger.info("Admin credited user wallet", {
        adminId: admin.id,
        userId,
        amount,
        reason,
      });

      return NextResponse.json({
        ok: true,
        message: `₦${amount.toLocaleString()} credited to user wallet`,
        newBalance,
      });
    } else if (action === "debit") {
      if (!amount || amount <= 0) {
        return NextResponse.json(
          { error: "Valid amount is required" },
          { status: 400 }
        );
      }

      if (user.walletBalance < amount) {
        return NextResponse.json(
          { error: "Insufficient balance" },
          { status: 400 }
        );
      }

      const newBalance = user.walletBalance - amount;

      await db
        .update(users)
        .set({ walletBalance: newBalance })
        .where(eq(users.id, userId));

      // Record transaction
      const reference = `ADMIN-DEBIT-${Date.now()}`;
      await db.insert(walletTransactions).values({
        userId,
        type: "debit",
        amount,
        balanceAfter: newBalance,
        description: reason || `Admin debit by ${admin.email}`,
        reference,
      });

      logger.info("Admin debited user wallet", {
        adminId: admin.id,
        userId,
        amount,
        reason,
      });

      return NextResponse.json({
        ok: true,
        message: `₦${amount.toLocaleString()} debited from user wallet`,
        newBalance,
      });
    } else {
      return NextResponse.json(
        { error: "Invalid action" },
        { status: 400 }
      );
    }
  } catch (error) {
    logger.error("Failed to update user:", { error });
    return NextResponse.json(
      { error: "Failed to update user" },
      { status: 500 }
    );
  }
}
