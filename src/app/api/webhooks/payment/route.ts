import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { orders, walletTransactions, users } from "@/db/schema";
import { eq } from "drizzle-orm";
import { logger } from "@/lib/logger";

export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { event, data } = body;

    logger.info("Payment webhook received", { event });

    // Verify webhook signature (in production)
    // const signature = request.headers.get("x-webhook-signature");
    // if (!verifySignature(body, signature)) {
    //   return NextResponse.json({ error: "Invalid signature" }, { status: 401 });
    // }

    switch (event) {
      case "payment.success":
        await handlePaymentSuccess(data);
        break;
      case "payment.failed":
        await handlePaymentFailed(data);
        break;
      case "transfer.success":
        await handleTransferSuccess(data);
        break;
      default:
        logger.warn("Unknown webhook event", { event });
    }

    return NextResponse.json({ ok: true });
  } catch (error) {
    logger.error("Webhook processing failed", { error });
    return NextResponse.json({ error: "Webhook processing failed" }, { status: 500 });
  }
}

async function handlePaymentSuccess(data: any) {
  const { reference, amount, customer } = data;

  logger.info("Processing payment success", { reference, amount });

  const user = await db.query.users.findFirst({
    where: eq(users.email, customer.email),
  });

  if (!user) {
    logger.error("User not found for payment", { email: customer.email });
    return;
  }

  await db.transaction(async (tx) => {
    const newBalance = user.walletBalance + amount;

    await tx.update(users).set({ walletBalance: newBalance }).where(eq(users.id, user.id));

    await tx.insert(walletTransactions).values({
      userId: user.id,
      type: "credit",
      amount,
      balanceAfter: newBalance,
      description: "Wallet top-up",
      reference,
    });
  });

  logger.info("Payment processed successfully", { reference, userId: user.id });
}

async function handlePaymentFailed(data: any) {
  const { reference, reason } = data;
  logger.warn("Payment failed", { reference, reason });
}

async function handleTransferSuccess(data: any) {
  const { reference, amount, recipient } = data;
  logger.info("Transfer successful", { reference, amount, recipient });
}
