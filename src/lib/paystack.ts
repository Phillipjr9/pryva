import { createHmac, timingSafeEqual } from "node:crypto";
import { and, eq, sql } from "drizzle-orm";
import { db, hasDatabase } from "@/db";
import { users, walletTopups, walletTransactions } from "@/db/schema";

const PAYSTACK_API = "https://api.paystack.co";

export type WalletTopupSettlement = {
  status: "paid" | "pending" | "failed" | "invalid" | "not_found";
  amount?: number;
  reference?: string;
};

type PaystackVerification = {
  status?: string;
  reference?: string;
  amount?: number;
  currency?: string;
};

type PaystackVerificationResponse = {
  status?: boolean;
  message?: string;
  data?: PaystackVerification;
};

export function isPaystackConfigured(): boolean {
  return Boolean(process.env.PAYSTACK_SECRET_KEY?.trim());
}

function getPaystackSecret(): string {
  const secret = process.env.PAYSTACK_SECRET_KEY?.trim();
  if (!secret) throw new Error("Paystack is not configured");
  return secret;
}

export function verifyPaystackWebhookSignature(rawBody: string, signature: string | null): boolean {
  const secret = process.env.PAYSTACK_SECRET_KEY?.trim();
  if (!secret || !signature || !/^[a-f\d]{128}$/i.test(signature)) return false;

  const expected = createHmac("sha512", secret).update(rawBody).digest();
  const received = Buffer.from(signature, "hex");
  return received.length === expected.length && timingSafeEqual(received, expected);
}

async function verifyTransaction(reference: string): Promise<PaystackVerification> {
  const response = await fetch(
    `${PAYSTACK_API}/transaction/verify/${encodeURIComponent(reference)}`,
    {
      method: "GET",
      headers: { Authorization: `Bearer ${getPaystackSecret()}` },
      cache: "no-store",
      signal: AbortSignal.timeout(15_000),
    },
  );

  const result = (await response.json().catch(() => null)) as PaystackVerificationResponse | null;
  if (!response.ok || !result?.status || !result.data) {
    throw new Error("Paystack could not verify the transaction");
  }
  return result.data;
}

/**
 * Verify the provider-side transaction and credit a pending wallet top-up once.
 * The row lock makes callback and webhook delivery safely idempotent.
 */
export async function settleWalletTopup(reference: string): Promise<WalletTopupSettlement> {
  if (!hasDatabase) throw new Error("A database is required to settle wallet funding");

  const [topup] = await db
    .select()
    .from(walletTopups)
    .where(eq(walletTopups.reference, reference))
    .limit(1);

  if (!topup) return { status: "not_found", reference };
  if (topup.status === "paid") return { status: "paid", amount: topup.amount, reference };
  if (topup.status === "failed") return { status: "failed", amount: topup.amount, reference };

  const payment = await verifyTransaction(reference);
  if (payment.status !== "success") {
    if (payment.status === "failed" || payment.status === "abandoned") {
      await db
        .update(walletTopups)
        .set({ status: "failed" })
        .where(and(eq(walletTopups.reference, reference), eq(walletTopups.status, "pending")));
      return { status: "failed", amount: topup.amount, reference };
    }
    return { status: "pending", amount: topup.amount, reference };
  }

  const verified =
    payment.reference === topup.reference &&
    payment.currency?.toUpperCase() === topup.currency &&
    Number.isSafeInteger(payment.amount) &&
    payment.amount === topup.amount * 100;

  if (!verified) {
    console.error("Paystack verification did not match a pending wallet top-up", reference);
    await db
      .update(walletTopups)
      .set({ status: "failed" })
      .where(and(eq(walletTopups.reference, reference), eq(walletTopups.status, "pending")));
    return { status: "invalid", amount: topup.amount, reference };
  }

  return db.transaction(async (tx) => {
    const [lockedTopup] = await tx
      .select()
      .from(walletTopups)
      .where(eq(walletTopups.reference, reference))
      .for("update")
      .limit(1);

    if (!lockedTopup) return { status: "not_found", reference };
    if (lockedTopup.status === "paid") {
      return { status: "paid", amount: lockedTopup.amount, reference };
    }
    if (lockedTopup.status !== "pending") {
      return { status: "failed", amount: lockedTopup.amount, reference };
    }
    if (
      lockedTopup.amount !== topup.amount ||
      lockedTopup.currency !== "NGN" ||
      lockedTopup.reference !== payment.reference
    ) {
      return { status: "invalid", amount: lockedTopup.amount, reference };
    }

    const [updatedUser] = await tx
      .update(users)
      .set({ walletBalance: sql`${users.walletBalance} + ${lockedTopup.amount}` })
      .where(eq(users.id, lockedTopup.userId))
      .returning({ balance: users.walletBalance });

    if (!updatedUser) throw new Error("Wallet owner not found while settling top-up");

    await tx.insert(walletTransactions).values({
      userId: lockedTopup.userId,
      orderId: null,
      type: "credit",
      amount: lockedTopup.amount,
      balanceAfter: updatedUser.balance,
      description: "Wallet top-up · Paystack",
      reference: lockedTopup.reference,
    });

    await tx
      .update(walletTopups)
      .set({ status: "paid", verifiedAt: new Date() })
      .where(eq(walletTopups.id, lockedTopup.id));

    return { status: "paid", amount: lockedTopup.amount, reference };
  });
}
