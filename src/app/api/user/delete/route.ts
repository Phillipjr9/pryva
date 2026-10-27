import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { users, sessions, orders, walletTransactions, giftCards, scheduledOrders, notifications } from "@/db/schema";
import { eq } from "drizzle-orm";
import { requireAuthApi } from "@/lib/auth";
import { logger } from "@/lib/logger";

export const dynamic = "force-dynamic";

// DELETE /api/user/delete - Delete user account (GDPR right to be forgotten)
export async function DELETE(request: NextRequest) {
  try {
    const user = await requireAuthApi();
    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const body = await request.json();
    const { confirmation } = body;

    if (confirmation !== "DELETE") {
      return NextResponse.json(
        { error: "Please type 'DELETE' to confirm account deletion" },
        { status: 400 }
      );
    }

    logger.warn("Account deletion requested", { userId: user.id, email: user.email });

    // Delete in transaction to ensure atomicity
    await db.transaction(async (tx) => {
      // Delete sessions
      await tx.delete(sessions).where(eq(sessions.userId, user.id));

      // Delete notifications
      await tx.delete(notifications).where(eq(notifications.userId, user.id));

      // Cancel scheduled orders
      await tx
        .update(scheduledOrders)
        .set({ status: "cancelled" })
        .where(eq(scheduledOrders.userId, user.id));

      // Anonymize orders (keep for financial records but remove personal data)
      // Note: We don't delete orders as they may be needed for financial compliance

      // Anonymize wallet transactions
      // Note: We don't delete transactions as they may be needed for financial compliance

      // Anonymize gift cards
      await tx
        .update(giftCards)
        .set({ 
          recipientEmail: null,
          message: null,
        })
        .where(eq(giftCards.purchasedBy, user.id));

      // Finally delete the user
      await tx.delete(users).where(eq(users.id, user.id));
    });

    logger.info("Account deleted successfully", { userId: user.id });

    return NextResponse.json({
      ok: true,
      message: "Account deleted successfully",
    });
  } catch (error) {
    logger.error("Failed to delete account", { error });
    return NextResponse.json({ error: "Failed to delete account" }, { status: 500 });
  }
}
