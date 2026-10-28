import { randomUUID } from "node:crypto";
import { mutatePreviewDatabase, readPreviewDatabase } from "@/db";
import { DemoBalanceError, DemoConflict, DEMO_REQUEST_ID, demoReference } from "@/lib/demo-wallet";
import { MAX_WITHDRAWAL, MIN_WITHDRAWAL, withdrawalFee } from "@/lib/withdrawal";

export function demoWithdrawalHistory(userId: string) {
  return readPreviewDatabase((state) => state.withdrawals.filter((row) => row.userId === userId && row.demo === true)
    .sort((a, b) => new Date(b.createdAt as Date | string).getTime() - new Date(a.createdAt as Date | string).getTime())
    .slice(0, 20).map((row) => ({ id: String(row.id), reference: String(row.reference), amount: Number(row.amount), fee: Number(row.fee), createdAt: new Date(row.createdAt as Date | string).toISOString() })));
}

/** Simulates a payout to a fixed fictional destination; never accepts bank details. */
export function withdrawDemoFunds(input: { userId: string; amount: number; requestId: string }) {
  if (!DEMO_REQUEST_ID.test(input.requestId) || !Number.isSafeInteger(input.amount) || input.amount < MIN_WITHDRAWAL || input.amount > MAX_WITHDRAWAL) throw new Error("Invalid demo withdrawal");
  const reference = demoReference("DWDR", input.userId, input.requestId);
  return mutatePreviewDatabase((draft) => {
    const user = draft.users.find((row) => row.id === input.userId);
    if (!user || typeof user.walletBalance !== "number" || !Number.isSafeInteger(user.walletBalance)) throw new DemoBalanceError("Demo wallet not found.");
    const previous = draft.withdrawals.find((row) => row.userId === input.userId && row.reference === reference);
    if (previous) {
      if (previous.amount !== input.amount) throw new DemoConflict("This demo request was already used for another amount.");
      return { reference, duplicate: true, balance: user.walletBalance, fee: Number(previous.fee) };
    }
    const fee = withdrawalFee(input.amount);
    const total = input.amount + fee;
    if (user.walletBalance < total) throw new DemoBalanceError("Your demo wallet balance is too low for this withdrawal and fee.");
    const now = new Date();
    const balance = user.walletBalance - total;
    user.walletBalance = balance;
    draft.withdrawals.push({
      id: randomUUID(), userId: input.userId, amount: input.amount, fee, bankName: "Demo destination", accountNumber: "DEMO",
      accountName: "Fictional", recipientCode: null, status: "completed", reference, requestId: input.requestId.toLowerCase(),
      bankAccountId: null, transferReference: null, failureReason: null, processedAt: now, completedAt: now, createdAt: now, demo: true,
    });
    draft.walletTransactions.push({
      id: randomUUID(), userId: input.userId, orderId: null, type: "withdrawal", amount: total, balanceAfter: balance,
      description: "Demo withdrawal · fictional destination", reference, createdAt: now,
    });
    return { reference, duplicate: false, balance, fee };
  });
}
