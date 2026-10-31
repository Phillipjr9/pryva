import { authorizeAdminApi } from "@/lib/admin-auth";
import { recordAdminAction } from "@/lib/admin-audit";
import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { users, orders, walletTransactions, withdrawals } from "@/db/schema";
import { eq, desc, sql } from "drizzle-orm";
import { logger } from "@/lib/logger";
import { creditWallet, debitWallet, InsufficientFundsError } from "@/lib/wallet";
import { isJsonRequest, readJsonWithLimit, RequestBodyTooLargeError } from "@/lib/request-body";
import { isSameOriginMutation } from "@/lib/net";

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
    const access = await authorizeAdminApi(request);
    if (access.response) return access.response;

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
  // The most privileged mutations in the app move real money and edit accounts,
  // and cookie-based sessions make them a CSRF target. The origin is checked
  // before authorization so an unauthenticated cross-origin caller learns nothing.
  if (!isSameOriginMutation(request)) {
    return NextResponse.json({ error: "Invalid origin" }, { status: 403 });
  }
  try {
    const access = await authorizeAdminApi(request);
    if (access.response) return access.response;
    const admin = access.user;

    const { id: userId } = await params;
    if (!isJsonRequest(request)) return NextResponse.json({ error: "Expected JSON" }, { status: 415 });
    let body: unknown;
    try {
      body = await readJsonWithLimit(request, 2_048);
    } catch (error) {
      return NextResponse.json({ error: "Invalid request body" }, { status: error instanceof RequestBodyTooLargeError ? 413 : 400 });
    }
    if (!body || typeof body !== "object" || Array.isArray(body)) return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
    const { action, amount, reason } = body as { action?: unknown; amount?: unknown; reason?: unknown };

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

    if (action !== "credit" && action !== "debit") {
      return NextResponse.json({ error: "Invalid action" }, { status: 400 });
    }
    if (typeof amount !== "number" || !Number.isSafeInteger(amount) || amount <= 0 || amount > 2000000000) {
      return NextResponse.json({ error: "A valid whole-naira amount is required" }, { status: 400 });
    }
    if (reason !== undefined && (typeof reason !== "string" || reason.length > 180)) {
      return NextResponse.json({ error: "Invalid reason" }, { status: 400 });
    }

    const entry = {
      userId,
      type: action,
      amount,
      description: typeof reason === "string" && reason.trim() ? reason.trim() : `Admin ${action} by ${admin.email}`.slice(0, 200),
    } as const;
    const newBalance = action === "credit" ? await creditWallet(entry) : await debitWallet(entry);
    logger.info("Admin adjusted user wallet", { adminId: admin.id, userId, amount, action, reason });
    await recordAdminAction({
      actor: admin,
      action: action === "credit" ? "user.credit" : "user.debit",
      targetType: "user",
      targetId: userId,
      summary:
        `${action === "credit" ? "Credited" : "Debited"} ₦${amount.toLocaleString("en-NG")} ` +
        `${action === "credit" ? "to" : "from"} ${user.email}` +
        (typeof reason === "string" && reason.trim() ? ` — ${reason.trim()}` : ""),
    });
    return NextResponse.json({ ok: true, message: `₦${amount.toLocaleString()} ${action === "credit" ? "credited to" : "debited from"} user wallet`, newBalance });
  } catch (error) {
    if (error instanceof InsufficientFundsError) {
      return NextResponse.json({ error: "Insufficient balance" }, { status: 400 });
    }
    logger.error("Failed to update user:", { error });
    return NextResponse.json(
      { error: "Failed to update user" },
      { status: 500 }
    );
  }
}
