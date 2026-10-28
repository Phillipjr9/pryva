import { db } from "@/db";
import { giftCards, users, walletTransactions } from "@/db/schema";
import { eq, and, gte, gt, ne, sql } from "drizzle-orm";
import { randomBytes } from "crypto";
import { scheduleWalletEmails } from "@/lib/schedule-wallet-emails";

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

  if (!Number.isSafeInteger(amount) || amount < 1000 || amount > 500000) {
    throw new Error("Gift card amount must be a whole-naira value between ₦1,000 and ₦500,000");
  }

  const code = generateCode();
  const expiresAt = new Date();
  expiresAt.setFullYear(expiresAt.getFullYear() + 1);

  await db.transaction(async (tx) => {
    const [user] = await tx.update(users)
      .set({ walletBalance: sql`${users.walletBalance} - ${amount}` })
      .where(and(eq(users.id, userId), gte(users.walletBalance, amount)))
      .returning({ balance: users.walletBalance });
    if (!user) throw new Error("Insufficient wallet balance or user not found");

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
      balanceAfter: user.balance,
      description: `Gift card purchase: ${code}`,
      reference: `GIFT-${code}`,
    });
  });

  scheduleWalletEmails();
  return { code, amount, expiresAt };
}

export async function redeemGiftCard(params: {
  userId: string;
  code: string;
}): Promise<{ amount: number }> {
  const { userId, code } = params;

  const result = await db.transaction(async (tx) => {
    // Claim the active card before crediting the recipient. A concurrent
    // redemption can no longer claim it once the first transaction commits.
    const now = new Date();
    const [card] = await tx.update(giftCards)
      .set({ status: "redeemed", redeemedBy: userId, redeemedAt: now })
      .where(and(
        eq(giftCards.code, code),
        eq(giftCards.status, "active"),
        gt(giftCards.expiresAt, now),
        ne(giftCards.purchasedBy, userId),
        gt(giftCards.amount, 0),
      ))
      .returning();
    if (!card) throw new Error("Gift card is invalid, expired, already redeemed, or belongs to you");

    const [user] = await tx.update(users)
      .set({ walletBalance: sql`${users.walletBalance} + ${card.amount}` })
      .where(eq(users.id, userId))
      .returning({ balance: users.walletBalance });
    if (!user) throw new Error("User not found");

    await tx.insert(walletTransactions).values({
      userId,
      type: "credit",
      amount: card.amount,
      balanceAfter: user.balance,
      description: `Gift card redemption: ${code}`,
      reference: `GIFT-${code}`,
    });
    return { amount: card.amount };
  });
  scheduleWalletEmails();
  return result;
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
