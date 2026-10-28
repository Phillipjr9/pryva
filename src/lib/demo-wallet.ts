import { createHash, randomUUID } from "node:crypto";
import { mutatePreviewDatabase } from "@/db";

export const DEMO_REQUEST_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const MAX_BALANCE = 2_147_483_647;
export type DemoPaymentMethod = "bank-transfer" | "card";

/** Stable, user-scoped keys make a retried demo payment a single credit. */
export function demoReference(prefix: string, userId: string, requestId: string): string {
  const hash = createHash("sha256").update(`${userId}\0${requestId.toLowerCase()}`).digest("hex").slice(0, 24).toUpperCase();
  return `${prefix}-${hash}`;
}

export class DemoConflict extends Error {}
export class DemoBalanceError extends Error {}

/**
 * The process-local demo wallet and its ledger are changed together. This must
 * never fall back to a real database, payment gateway, or provider.
 */
export function completeDemoTopUp(input: {
  userId: string;
  amount: number;
  method: DemoPaymentMethod;
  requestId: string;
}): { reference: string; balance: number; duplicate: boolean } {
  if (!DEMO_REQUEST_ID.test(input.requestId) || !Number.isSafeInteger(input.amount) || input.amount < 1000 || input.amount > 500000 ||
      !["card", "bank-transfer"].includes(input.method)) throw new Error("Invalid demo payment");
  const reference = demoReference("DTOP", input.userId, input.requestId);
  return mutatePreviewDatabase((draft) => {
    const account = draft.users.find((row) => row.id === input.userId);
    if (!account || typeof account.walletBalance !== "number" || !Number.isSafeInteger(account.walletBalance)) throw new DemoBalanceError("Demo wallet not found");
    const existing = draft.paymentTopups.find((row) => row.reference === reference);
    if (existing) {
      if (existing.userId !== input.userId || existing.amount !== input.amount || existing.demoMethod !== input.method) throw new DemoConflict("This demo payment request was already used for another amount or method.");
      return { reference, balance: account.walletBalance, duplicate: true };
    }
    if (account.walletBalance > MAX_BALANCE - input.amount) throw new DemoBalanceError("Demo wallet balance limit reached.");
    const now = new Date();
    const balance = account.walletBalance + input.amount;
    account.walletBalance = balance;
    draft.paymentTopups.push({ reference, userId: input.userId, amount: input.amount, status: "completed", demoMethod: input.method, paidAt: now, createdAt: now });
    draft.walletTransactions.push({
      id: randomUUID(), userId: input.userId, orderId: null, type: "credit", amount: input.amount, balanceAfter: balance,
      description: `Demo top-up · ${input.method === "card" ? "card" : "bank transfer"}`, reference, createdAt: now,
    });
    return { reference, balance, duplicate: false };
  });
}
