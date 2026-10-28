import { randomUUID } from "node:crypto";
import { mutatePreviewDatabase } from "@/db";
import { generateCode } from "@/lib/gift-cards";
import { DemoBalanceError, DemoConflict, DEMO_REQUEST_ID, demoReference } from "@/lib/demo-wallet";

export class DemoGiftError extends Error {}

export function createDemoGiftCard(input: { userId: string; amount: number; requestId: string }) {
  if (!DEMO_REQUEST_ID.test(input.requestId) || !Number.isSafeInteger(input.amount) || input.amount < 1000 || input.amount > 500000) throw new Error("Invalid demo gift card");
  const reference = demoReference("DGFT", input.userId, input.requestId);
  return mutatePreviewDatabase((draft) => {
    const account = draft.users.find((row) => row.id === input.userId);
    if (!account || typeof account.walletBalance !== "number" || !Number.isSafeInteger(account.walletBalance)) throw new DemoBalanceError("Demo wallet not found.");
    const previous = draft.giftCards.find((row) => row.purchasedBy === input.userId && row.demoReference === reference);
    if (previous) {
      if (previous.initialAmount !== input.amount) throw new DemoConflict("This demo request was already used for another amount.");
      return { code: String(previous.code), amount: input.amount, expiresAt: new Date(previous.expiresAt as Date | string).toISOString(), duplicate: true };
    }
    if (account.walletBalance < input.amount) throw new DemoBalanceError("Your demo wallet balance is too low. Add demo funds to continue.");
    let code = generateCode();
    while (draft.giftCards.some((card) => card.code === code)) code = generateCode();
    const now = new Date();
    const expiresAt = new Date(now);
    expiresAt.setFullYear(expiresAt.getFullYear() + 1);
    const balance = account.walletBalance - input.amount;
    account.walletBalance = balance;
    draft.giftCards.push({ id: randomUUID(), code, amount: input.amount, initialAmount: input.amount, purchasedBy: input.userId, recipientEmail: null, message: null, status: "active", expiresAt, redeemedBy: null, redeemedAt: null, createdAt: now, demoReference: reference });
    draft.walletTransactions.push({ id: randomUUID(), userId: input.userId, orderId: null, type: "debit", amount: input.amount, balanceAfter: balance, description: "Demo gift card created", reference, createdAt: now });
    return { code, amount: input.amount, expiresAt: expiresAt.toISOString(), duplicate: false };
  });
}

/** A demo card may be redeemed by its creator so the shared demo can exercise both steps. */
export function redeemDemoGiftCard(input: { userId: string; code: string }) {
  return mutatePreviewDatabase((draft) => {
    const card = draft.giftCards.find((row) => row.code === input.code && typeof row.demoReference === "string");
    const now = new Date();
    const expires = card?.expiresAt ? new Date(card.expiresAt as Date | string).getTime() : NaN;
    if (!card || card.status !== "active" || !Number.isFinite(expires) || expires <= now.getTime() || typeof card.amount !== "number" || !Number.isSafeInteger(card.amount) || card.amount <= 0) throw new DemoGiftError("This demo card is invalid, expired or already redeemed.");
    const account = draft.users.find((row) => row.id === input.userId);
    if (!account || typeof account.walletBalance !== "number" || !Number.isSafeInteger(account.walletBalance) || account.walletBalance + card.amount > 2_147_483_647) throw new DemoBalanceError("Could not update the demo wallet.");
    const balance = account.walletBalance + card.amount;
    account.walletBalance = balance;
    card.status = "redeemed";
    card.redeemedBy = input.userId;
    card.redeemedAt = now;
    draft.walletTransactions.push({ id: randomUUID(), userId: input.userId, orderId: null, type: "credit", amount: card.amount, balanceAfter: balance, description: "Demo gift card redeemed", reference: demoReference("DRED", input.userId, randomUUID()), createdAt: now });
    return { amount: card.amount };
  });
}
