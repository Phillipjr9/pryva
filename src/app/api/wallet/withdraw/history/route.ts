import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { withdrawals } from "@/db/schema";
import { eq, desc, sql } from "drizzle-orm";
import { requireAuthApi } from "@/lib/auth";

export const dynamic = "force-dynamic";

/**
 * GET /api/wallet/withdraw/history
 * Get user's withdrawal history
 */
export async function GET(request: NextRequest) {
  try {
    const user = await requireAuthApi();
    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { searchParams } = new URL(request.url);
    const page = parseInt(searchParams.get("page") || "1");
    const limit = parseInt(searchParams.get("limit") || "20");
    const offset = (page - 1) * limit;

    // Get user's withdrawals
    const userWithdrawals = await db
      .select()
      .from(withdrawals)
      .where(eq(withdrawals.userId, user.id))
      .orderBy(desc(withdrawals.createdAt))
      .limit(limit)
      .offset(offset);

    // Get total count
    const [countResult] = await db
      .select({ count: sql<number>`count(*)` })
      .from(withdrawals)
      .where(eq(withdrawals.userId, user.id));

    const total = Number(countResult?.count || 0);

    return NextResponse.json({
      ok: true,
      withdrawals: userWithdrawals.map((w) => ({
        id: w.id,
        reference: w.reference,
        amount: w.amount,
        fee: w.fee,
        bankName: w.bankName,
        accountNumber: w.accountNumber,
        accountName: w.accountName,
        status: w.status,
        failureReason: w.failureReason,
        createdAt: w.createdAt,
        processedAt: w.processedAt,
        completedAt: w.completedAt,
      })),
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit),
      },
    });
  } catch (error) {
    console.error("Failed to fetch withdrawal history:", error);
    return NextResponse.json(
      { error: "Failed to fetch withdrawal history" },
      { status: 500 }
    );
  }
}
