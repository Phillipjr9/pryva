/**
 * Pryva gift cards: wallet credit issued and redeemed by this application.
 *
 * This is one of *two* different products that are both called "gift cards".
 * This one has no supplier: `createGiftCard` mints a code, debits the buyer and
 * credits whoever redeems it. The other (`brand-catalog.ts`, sold through
 * `/api/gift-cards/order`) is a third-party voucher bought from a supplier and
 * delivered as a code. Keeping them in one namespace used to make a reader guess
 * which money path a route belonged to, so each module now says which it is:
 *
 *   credit*  — Pryva-issued wallet credit   (`/api/gift-cards/purchase`)
 *   brand*   — supplier vouchers            (`/api/gift-cards/order`)
 */

import { db } from "@/db";
import { giftCards, users, walletTransactions } from "@/db/schema";
import { eq, and, gte, gt, ne, isNull, sql } from "drizzle-orm";
import { randomBytes } from "crypto";
import { scheduleWalletEmails } from "@/lib/email/schedule-wallet-emails";
import {
  GIFT_CARD_MAX_AMOUNT,
  GIFT_CARD_MIN_AMOUNT,
  GIFT_CARD_VALIDITY_MONTHS,
} from "@/lib/services/gift-cards/credit-rules";

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
  requestId: string;
  recipientEmail?: string;
  message?: string;
}): Promise<{ code: string; amount: number; expiresAt: Date; replayed: boolean }> {
  const { userId, amount, requestId, recipientEmail, message } = params;

  if (
    !Number.isSafeInteger(amount) ||
    amount < GIFT_CARD_MIN_AMOUNT ||
    amount > GIFT_CARD_MAX_AMOUNT
  ) {
    throw new Error(
      `Gift card amount must be a whole-naira value between ₦${GIFT_CARD_MIN_AMOUNT.toLocaleString("en-NG")} and ₦${GIFT_CARD_MAX_AMOUNT.toLocaleString("en-NG")}`,
    );
  }

  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(requestId)) {
    throw new Error("A valid purchase request ID is required");
  }

  const code = generateCode();
  const expiresAt = new Date();
  expiresAt.setMonth(expiresAt.getMonth() + GIFT_CARD_VALIDITY_MONTHS);

  const result = await db.transaction(async (tx) => {
    // The unique key arbitrates concurrent retries before either can debit.
    const [created] = await tx.insert(giftCards).values({
      code, requestId: requestId.toLowerCase(), amount, initialAmount: amount, purchasedBy: userId,
      recipientEmail, message, status: "active", expiresAt,
    }).onConflictDoNothing().returning();
    if (!created) {
      const [existing] = await tx.select().from(giftCards)
        .where(and(eq(giftCards.purchasedBy, userId), eq(giftCards.requestId, requestId.toLowerCase()))).limit(1);
      if (!existing) throw new Error("Gift card purchase could not be claimed");
      if (existing.initialAmount !== amount || (existing.recipientEmail ?? null) !== (recipientEmail ?? null) || (existing.message ?? null) !== (message ?? null)) {
        throw new Error("Purchase request ID belongs to a different gift card");
      }
      return { code: existing.code, amount: existing.initialAmount, expiresAt: existing.expiresAt, replayed: true };
    }

    const [user] = await tx.update(users)
      .set({ walletBalance: sql`${users.walletBalance} - ${amount}` })
      // Buying a gift card spends real money, so it must not be funded with
      // funds another in-flight purchase has already committed.
      .where(and(eq(users.id, userId), sql`${users.walletBalance} - ${users.walletReserved} >= ${amount}`, isNull(users.suspendedAt), isNull(users.deletedAt)))
      .returning({ balance: users.walletBalance });
    if (!user) throw new Error("Insufficient wallet balance or user not found");
    await tx.insert(walletTransactions).values({
      userId, type: "debit", amount, balanceAfter: user.balance,
      description: `Gift card purchase: ${code}`, reference: `GIFT-${code}`,
    });
    return { code, amount, expiresAt, replayed: false };
  });

  if (!result.replayed) scheduleWalletEmails();
  return result;
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

/**
 * The status a customer should see for a card, not the status stored on the row.
 *
 * Redemption checks expiry synchronously, so an expired card cannot be spent
 * even if nothing ever swept its `active` status. History has to say the same
 * thing; otherwise a lapsed card is advertised as available.
 */
export function giftCardDisplayStatus(
  card: { status: string; expiresAt: Date },
  now: number = Date.now(),
): string {
  return card.status === "active" && card.expiresAt.getTime() <= now ? "expired" : card.status;
}

export async function getUserGiftCards(userId: string) {
  return db.query.giftCards.findMany({
    where: eq(giftCards.purchasedBy, userId),
    orderBy: (cards, { desc }) => [desc(cards.createdAt), desc(cards.id)],
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
