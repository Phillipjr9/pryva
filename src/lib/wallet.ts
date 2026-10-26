import { randomBytes } from "node:crypto";
import { eq, sql } from "drizzle-orm";
import { db } from "@/db";
import { users, walletTransactions } from "@/db/schema";

export function makeReference(prefix = "PRY"): string {
  const stamp = Date.now().toString(36).toUpperCase().slice(-5);
  const rand = randomBytes(2).toString("hex").toUpperCase();
  return `${prefix}-${stamp}${rand}`;
}

export function generateOtp(): string {
  return String(Math.floor(100000 + Math.random() * 900000));
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

export async function creditWallet(input: WalletEntryInput): Promise<number> {
  return db.transaction(async (tx: any) => {
    const [updated] = await tx
      .update(users)
      .set({ walletBalance: sql`${users.walletBalance} + ${input.amount}` })
      .where(eq(users.id, input.userId))
      .returning({ balance: users.walletBalance });

    if (!updated) throw new Error("User not found");

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
}

export async function debitWallet(input: WalletEntryInput): Promise<number> {
  return db.transaction(async (tx: any) => {
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
}
