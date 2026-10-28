import { randomBytes, randomInt } from "node:crypto";
import { and, eq, lte, sql } from "drizzle-orm";
import { db } from "@/db";
import { users, walletTransactions } from "@/db/schema";
import { scheduleWalletEmails } from "@/lib/schedule-wallet-emails";

export function makeReference(prefix = "PRY"): string {
  const stamp = Date.now().toString(36).toUpperCase().slice(-5);
  const rand = randomBytes(8).toString("hex").toUpperCase();
  return `${prefix}-${stamp}${rand}`;
}

export function generateOtp(): string {
  return String(randomInt(100000, 1_000_000));
}

export type WalletEntryInput = {
  userId: string;
  amount: number;
  description: string;
  type: "credit" | "debit" | "refund";
  orderId?: string | null;
  reference?: string;
};

export class InsufficientFundsError extends Error {
  constructor(public readonly balance: number, public readonly required: number) {
    super("Insufficient wallet balance");
    this.name = "InsufficientFundsError";
  }
}

const MAX_DATABASE_INTEGER = 2_147_483_647;

function validateWalletEntry(input: WalletEntryInput, direction: "credit" | "debit"): void {
  if (!Number.isSafeInteger(input.amount) || input.amount <= 0 || input.amount > MAX_DATABASE_INTEGER) {
    throw new Error("Wallet amount must be a positive whole-naira value");
  }
  if (direction === "credit" ? !["credit", "refund"].includes(input.type) : input.type !== "debit") {
    throw new Error("Wallet transaction type does not match its direction");
  }
}

export async function creditWallet(input: WalletEntryInput): Promise<number> {
  validateWalletEntry(input, "credit");
  const balance = await db.transaction(async (tx: any) => {
    const [updated] = await tx
      .update(users)
      .set({ walletBalance: sql`${users.walletBalance} + ${input.amount}` })
      .where(and(eq(users.id, input.userId), lte(users.walletBalance, MAX_DATABASE_INTEGER - input.amount)))
      .returning({ balance: users.walletBalance });

    if (!updated) throw new Error("User not found or wallet balance would exceed its limit");

    await tx.insert(walletTransactions).values({
      userId: input.userId,
      orderId: input.orderId ?? null,
      type: input.type,
      amount: input.amount,
      balanceAfter: updated.balance,
      description: input.description,
      reference: input.reference ?? makeReference("TOP"),
    });

    return updated.balance;
  });
  scheduleWalletEmails();
  return balance;
}

export async function debitWallet(input: WalletEntryInput): Promise<number> {
  validateWalletEntry(input, "debit");
  const balance = await db.transaction(async (tx: any) => {
    const [updated] = await tx
      .update(users)
      .set({ walletBalance: sql`${users.walletBalance} - ${input.amount}` })
      .where(sql`${users.id} = ${input.userId} AND ${users.walletBalance} >= ${input.amount}`)
      .returning({ balance: users.walletBalance });

    if (!updated) {
      const [current] = await tx
        .select({ balance: users.walletBalance })
        .from(users)
        .where(eq(users.id, input.userId))
        .limit(1);
      throw new InsufficientFundsError(current?.balance ?? 0, input.amount);
    }

    await tx.insert(walletTransactions).values({
      userId: input.userId,
      orderId: input.orderId ?? null,
      type: input.type,
      amount: input.amount,
      balanceAfter: updated.balance,
      description: input.description,
      reference: input.reference ?? makeReference("PAY"),
    });

    return updated.balance;
  });
  scheduleWalletEmails();
  return balance;
}
