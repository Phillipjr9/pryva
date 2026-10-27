import { db } from "@/db";
import { giftCards, users, walletTransactions } from "@/db/schema";
import { eq, and, sql } from "drizzle-orm";
import { randomBytes } from "crypto";

export function generateCode(): string {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  const segment1 = Array.from(randomBytes(4))
    .map((b) => chars[b % chars.length])
    .join("");
  const segment2 = Array.from(randomBytes(4))
    .map((b) => chars[b % chars.length])
    .join("");
  const segment3 = Array.from(randomBytes(4))
    .map((b) => chars[b % chars.length])
    .join("");
  return `PRYVA-${segment1}-${segment2}-${segment3}`;
}

export async function createGiftCard(params: {
  userId: string;
  amount: number;
  recipientEmail?: string;
  message?: string;
}): Promise<{ code: string; amount: number; expiresAt: Date }> {
  const { userId, amount, recipientEmail, message } = params;

  if (amount < 1000 || amount > 500000) {
    throw new Error("Gift card amount must be between ₦1,000 and ₦500,000");
  }

  const user = await db.query.users.findFirst({
    where: eq(users.id, userId),
  });

  if (!user) {
    throw new Error("User not found");
  }

  if (user.walletBalance < amount) {
    throw new Error("Insufficient wallet balance");
  }

  const code = generateCode();
  const expiresAt = new Date();
  expiresAt.setFullYear(expiresAt.getFullYear() + 1);

  await db.transaction(async (tx: typeof db) => {
    const newBalance = user.walletBalance - amount;

    await tx.update(users).set({ walletBalance: newBalance }).where(eq(users.id, userId));

    await tx.insert(giftCards).values({
      code,
      amount,
      initialAmount: amount,
      purchasedBy: userId,
      recipientEmail,
      message,
      status: "active",
      expiresAt,
    });

    await tx.insert(walletTransactions).values({
      userId,
      type: "debit",
      amount,
      balanceAfter: newBalance,
      description: `Gift card purchase: ${code}`,
      reference: `GIFT-${code}`,
    });
  });

  return { code, amount, expiresAt };
}

export async function redeemGiftCard(params: {
  userId: string;
  code: string;
}): Promise<{ amount: number }> {
  const { userId, code } = params;

  const card = await db.query.giftCards.findFirst({
    where: eq(giftCards.code, code),
  });

  if (!card) {
    throw new Error("Invalid gift card code");
  }

  if (card.status !== "active") {
    throw new Error("Gift card has already been redeemed or cancelled");
  }

  if (card.expiresAt < new Date()) {
    throw new Error("Gift card has expired");
  }

  if (card.purchasedBy === userId) {
    throw new Error("You cannot redeem your own gift card");
  }

  const user = await db.query.users.findFirst({
    where: eq(users.id, userId),
  });

  if (!user) {
    throw new Error("User not found");
  }

  await db.transaction(async (tx: typeof db) => {
    const newBalance = user.walletBalance + card.amount;

    await tx.update(users).set({ walletBalance: newBalance }).where(eq(users.id, userId));

    await tx
      .update(giftCards)
      .set({
        status: "redeemed",
        redeemedBy: userId,
        redeemedAt: new Date(),
      })
      .where(eq(giftCards.code, code));

    await tx.insert(walletTransactions).values({
      userId,
      type: "credit",
      amount: card.amount,
      balanceAfter: newBalance,
      description: `Gift card redemption: ${code}`,
      reference: `GIFT-${code}`,
    });
  });

  return { amount: card.amount };
}

export async function getUserGiftCards(userId: string) {
  return db.query.giftCards.findMany({
    where: eq(giftCards.purchasedBy, userId),
    orderBy: (cards, { desc }) => [desc(cards.createdAt)],
  });
}

export async function checkGiftCardBalance(code: string) {
  const card = await db.query.giftCards.findFirst({
    where: eq(giftCards.code, code),
  });

  if (!card) {
    return null;
  }

  return {
    amount: card.amount,
    status: card.status,
    expiresAt: card.expiresAt,
  };
}

export async function refundGiftCard(cardId: string): Promise<void> {
  throw new Error("Gift cards are non-refundable");
}

export function isRefundEligible(transaction: { type: string; description: string }): boolean {
  if (transaction.type === "debit" && transaction.description.startsWith("Gift card purchase:")) {
    return false;
  }
  return true;
}
