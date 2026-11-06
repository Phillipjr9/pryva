import { and, desc, eq, ne, or, sql } from "drizzle-orm";

import { db } from "@/db";
import { users, withdrawals } from "@/db/schema";

export type PayoutAnomalyRow = {
  id: string;
  userId: string;
  userEmail: string | null;
  amount: number;
  fee: number;
  reference: string;
  bankName: string;
  accountName: string;
  status: string;
  riskLevel: string;
  riskReasons: string | null;
  createdAt: string;
  ageHours: number;
  actionNeeded: boolean;
};

export async function listPayoutAnomalies(limit = 50): Promise<PayoutAnomalyRow[]> {
  const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000);
  const oneDayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000);

  const rows = await db
    .select({
      id: withdrawals.id,
      userId: withdrawals.userId,
      userEmail: users.email,
      amount: withdrawals.amount,
      fee: withdrawals.fee,
      reference: withdrawals.reference,
      bankName: withdrawals.bankName,
      accountName: withdrawals.accountName,
      status: withdrawals.status,
      riskLevel: withdrawals.riskLevel,
      riskReasons: withdrawals.riskReasons,
      createdAt: withdrawals.createdAt,
    })
    .from(withdrawals)
    .leftJoin(users, eq(users.id, withdrawals.userId))
    .where(
      or(
        ne(withdrawals.riskLevel, "low"),
        and(eq(withdrawals.status, "pending"), sql`${withdrawals.createdAt} < ${oneHourAgo}`),
        and(eq(withdrawals.status, "processing"), sql`${withdrawals.createdAt} < ${oneDayAgo}`),
      ),
    )
    .orderBy(desc(withdrawals.createdAt))
    .limit(limit);

  return rows.map((row) => {
    const createdAt = row.createdAt instanceof Date ? row.createdAt : new Date(row.createdAt);
    const ageHours = Math.max(0, (Date.now() - createdAt.getTime()) / (60 * 60 * 1000));
    const actionNeeded = row.status === "pending" || row.status === "processing" || row.riskLevel !== "low";

    return {
      ...row,
      createdAt: createdAt.toISOString(),
      ageHours: Number(ageHours.toFixed(1)),
      actionNeeded,
    };
  });
}
