import { NextRequest, NextResponse } from "next/server";
import { and, eq, sql } from "drizzle-orm";
import { db } from "@/db";
import { paymentTopups, users, walletTransactions } from "@/db/schema";
import { isPreviewDatabase } from "@/lib/demo-policy";
import { verifyPaystackSignature } from "@/lib/paystack-webhook";
import { logger } from "@/lib/logger";

export const dynamic = "force-dynamic";

class PaymentMismatchError extends Error {}

/** Verify the raw Paystack payload and credit only a matching pending top-up. */
export async function POST(request: NextRequest) {
  const secret = process.env.PAYSTACK_SECRET_KEY?.trim();
  if (!secret || isPreviewDatabase()) {
    return NextResponse.json({ error: "Payment webhook is not configured" }, { status: 503 });
  }

  const rawBody = await request.text();
  if (!verifyPaystackSignature(rawBody, request.headers.get("x-paystack-signature"), secret)) {
    return NextResponse.json({ error: "Invalid signature" }, { status: 401 });
  }

  let payload: {
    event?: unknown;
    data?: {
      status?: unknown;
      reference?: unknown;
      amount?: unknown;
      currency?: unknown;
      metadata?: { userId?: unknown; type?: unknown };
    };
  };
  try {
    payload = JSON.parse(rawBody);
  } catch {
    return NextResponse.json({ error: "Invalid payload" }, { status: 400 });
  }

  if (!payload || typeof payload !== "object") {
    return NextResponse.json({ error: "Invalid payload" }, { status: 400 });
  }
  // Other Paystack events do not credit a wallet.
  if (payload.event !== "charge.success") return NextResponse.json({ ok: true });

  const data = payload.data;
  const userId = data?.metadata?.userId;
  const reference = data?.reference;
  const kobo = data?.amount;
  if (
    data?.status !== "success" ||
    data.currency !== "NGN" ||
    data.metadata?.type !== "wallet_topup" ||
    typeof userId !== "string" ||
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(userId) ||
    typeof reference !== "string" || reference.length > 40 || reference.length === 0 ||
    typeof kobo !== "number" || !Number.isSafeInteger(kobo) || kobo < 10000 || kobo > 1000000000 || kobo % 100 !== 0
  ) {
    return NextResponse.json({ error: "Invalid payment details" }, { status: 400 });
  }
  const amount = kobo / 100;

  try {
    const result = await db.transaction(async (tx) => {
      // The conditional update serializes concurrent deliveries of the same
      // event. The status change, wallet credit and ledger row all commit or
      // roll back together.
      const [topup] = await tx
        .update(paymentTopups)
        .set({ status: "completed", paidAt: new Date() })
        .where(and(
          eq(paymentTopups.reference, reference),
          eq(paymentTopups.userId, userId),
          eq(paymentTopups.amount, amount),
          eq(paymentTopups.status, "pending"),
        ))
        .returning();

      if (!topup) {
        const [previous] = await tx.select().from(paymentTopups)
          .where(eq(paymentTopups.reference, reference)).limit(1);
        if (previous?.status === "completed" && previous.userId === userId && previous.amount === amount) {
          return "duplicate" as const;
        }
        throw new PaymentMismatchError("No matching pending top-up");
      }

      const [updatedUser] = await tx.update(users)
        .set({ walletBalance: sql`${users.walletBalance} + ${amount}` })
        .where(eq(users.id, userId))
        .returning({ balance: users.walletBalance });
      if (!updatedUser) throw new Error("Top-up user not found");

      await tx.insert(walletTransactions).values({
        userId,
        type: "credit",
        amount,
        balanceAfter: updatedUser.balance,
        description: "Paystack wallet top-up",
        reference,
      });
      return "credited" as const;
    });

    logger.info("Paystack webhook processed", { reference, result });
    return NextResponse.json({ ok: true, duplicate: result === "duplicate" });
  } catch (error) {
    if (error instanceof PaymentMismatchError) {
      logger.warn("Paystack event did not match a pending top-up", { reference });
      return NextResponse.json({ error: "Payment does not match a pending top-up" }, { status: 400 });
    }
    logger.error("Payment webhook processing failed", { error, reference });
    return NextResponse.json({ error: "Webhook processing failed" }, { status: 500 });
  }
}
