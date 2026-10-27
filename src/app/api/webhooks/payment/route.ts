import { NextRequest, NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { users, withdrawals } from "@/db/schema";
import { verifyWebhookSignature } from "@/lib/paystack";
import { creditTopUpOnce } from "@/lib/payments";
import { logger } from "@/lib/logger";

export const dynamic = "force-dynamic";

type PaystackWebhook = {
  event?: string;
  data?: {
    reference?: string;
    amount?: number;
    currency?: string;
    status?: string;
    customer?: { email?: string };
    metadata?: { userId?: string; type?: string } | string;
    transfer_code?: string;
    reason?: string;
    recipient?: { recipient_code?: string };
  };
};

/**
 * Paystack webhook.
 *
 * Security model:
 *   • The raw body is verified against `x-paystack-signature` (HMAC-SHA512).
 *     No signature, no processing — this endpoint used to credit any amount a
 *     caller asked for.
 *   • Amounts come from the signed payload only, in kobo, and are capped.
 *   • Crediting is idempotent on the Paystack reference.
 */
export async function POST(request: NextRequest) {
  const rawBody = await request.text();
  const signature = request.headers.get("x-paystack-signature");

  if (!verifyWebhookSignature(rawBody, signature)) {
    logger.warn("Rejected payment webhook with invalid signature", {
      hasSignature: Boolean(signature),
      bodyLength: rawBody.length,
    });
    return NextResponse.json({ error: "Invalid signature" }, { status: 401 });
  }

  let payload: PaystackWebhook;
  try {
    payload = JSON.parse(rawBody) as PaystackWebhook;
  } catch {
    return NextResponse.json({ error: "Invalid payload" }, { status: 400 });
  }

  const event = payload.event ?? "";
  const data = payload.data ?? {};
  logger.info("Payment webhook received", { event, reference: data.reference });

  try {
    switch (event) {
      case "charge.success":
        await handleChargeSuccess(data);
        break;
      case "transfer.success":
        await handleTransferUpdate(data, "paid");
        break;
      case "transfer.failed":
      case "transfer.reversed":
        await handleTransferUpdate(data, "failed");
        break;
      default:
        // Everything else is acknowledged so Paystack stops retrying.
        logger.info("Ignoring webhook event", { event });
    }

    return NextResponse.json({ ok: true });
  } catch (error) {
    logger.error("Webhook processing failed", {
      event,
      reference: data.reference,
      error: error instanceof Error ? error.message : String(error),
    });
    // A 500 makes Paystack retry — which is what we want for transient failures,
    // because the credit path is idempotent.
    return NextResponse.json({ error: "Webhook processing failed" }, { status: 500 });
  }
}

async function resolveUserId(data: PaystackWebhook["data"]): Promise<string | null> {
  const metadata =
    typeof data?.metadata === "string"
      ? (JSON.parse(data.metadata) as { userId?: string })
      : data?.metadata;

  if (metadata?.userId) return metadata.userId;

  const email = data?.customer?.email;
  if (!email) return null;

  const user = await db.query.users.findFirst({
    where: eq(users.email, email.toLowerCase()),
    columns: { id: true },
  });

  return user?.id ?? null;
}

async function handleChargeSuccess(data: PaystackWebhook["data"]): Promise<void> {
  const reference = data?.reference;
  if (!reference) {
    logger.warn("charge.success without a reference — ignoring");
    return;
  }

  if ((data?.status ?? "success") !== "success") {
    logger.warn("charge.success with non-success status", { reference, status: data?.status });
    return;
  }

  const amountKobo = Number(data?.amount ?? 0);
  if (!Number.isFinite(amountKobo) || amountKobo <= 0) {
    logger.warn("charge.success with invalid amount", { reference, amount: data?.amount });
    return;
  }

  const userId = await resolveUserId(data);
  if (!userId) {
    logger.error("charge.success for unknown user", { reference, email: data?.customer?.email });
    return;
  }

  const result = await creditTopUpOnce({
    reference,
    amountNgn: Math.round(amountKobo / 100),
    userId,
    description: "Wallet top-up",
  });

  if (!result.credited) {
    logger.warn("charge.success not credited", { reference, reason: result.reason });
  }
}

async function handleTransferUpdate(
  data: PaystackWebhook["data"],
  outcome: "paid" | "failed",
): Promise<void> {
  const reference = data?.reference;
  const transferReference = data?.transfer_code;
  if (!reference && !transferReference) return;

  const existing = reference
    ? await db.query.withdrawals.findFirst({ where: eq(withdrawals.reference, reference) })
    : null;

  if (!existing) {
    logger.warn("Transfer webhook for unknown withdrawal", { reference, transferReference });
    return;
  }

  if (existing.status === "paid" || existing.status === "failed") {
    logger.info("Withdrawal already settled — skipping", { reference, status: existing.status });
    return;
  }

  if (outcome === "paid") {
    await db
      .update(withdrawals)
      .set({ status: "paid", completedAt: new Date(), transferReference: transferReference ?? null })
      .where(eq(withdrawals.id, existing.id));

    logger.info("Withdrawal paid", { reference });
    return;
  }

  // Failed transfer: the wallet was debited at request time, so put it back.
  await db
    .update(withdrawals)
    .set({
      status: "failed",
      failureReason: data?.reason ?? "Transfer failed",
      transferReference: transferReference ?? null,
    })
    .where(eq(withdrawals.id, existing.id));

  const refundAmount = existing.amount + (existing.fee ?? 0);
  try {
    const { creditWallet } = await import("@/lib/wallet");
    await creditWallet({
      userId: existing.userId,
      amount: refundAmount,
      type: "refund",
      description: `Refund — withdrawal ${existing.reference} could not be completed`,
      reference: `WDRFD-${existing.reference}`.slice(0, 40),
    });
    logger.info("Withdrawal refunded", { reference, amount: refundAmount });
  } catch (error) {
    logger.error("WITHDRAWAL REFUND FAILED — manual action required", {
      reference,
      userId: existing.userId,
      amount: refundAmount,
      error: error instanceof Error ? error.message : String(error),
    });
  }
}
