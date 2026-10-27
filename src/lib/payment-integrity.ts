import { db } from "@/db";
import { users, walletTransactions, orders } from "@/db/schema";
import { eq, and, sql } from "drizzle-orm";

export interface IntegrityCheckResult {
  valid: boolean;
  issues: string[];
}

export async function checkWalletIntegrity(userId: string): Promise<IntegrityCheckResult> {
  const issues: string[] = [];

  // Get current wallet balance
  const user = await db.query.users.findFirst({
    where: eq(users.id, userId),
    columns: { walletBalance: true },
  });

  if (!user) {
    return { valid: false, issues: ["User not found"] };
  }

  // Calculate expected balance from transactions
  const transactions = await db.query.walletTransactions.findMany({
    where: eq(walletTransactions.userId, userId),
    orderBy: (tx, { asc }) => [asc(tx.createdAt)],
  });

  let calculatedBalance = 0;
  for (const tx of transactions) {
    if (tx.type === "credit") {
      calculatedBalance += tx.amount;
    } else if (tx.type === "debit") {
      calculatedBalance -= tx.amount;
    }
  }

  if (calculatedBalance !== user.walletBalance) {
    issues.push(
      `Balance mismatch: recorded ${user.walletBalance}, calculated ${calculatedBalance}`
    );
  }

  // Check for duplicate transactions
  const references = transactions.map((tx) => tx.reference);
  const uniqueReferences = new Set(references);
  if (references.length !== uniqueReferences.size) {
    issues.push("Duplicate transaction references detected");
  }

  // Check for negative balance
  if (user.walletBalance < 0) {
    issues.push("Negative wallet balance detected");
  }

  return {
    valid: issues.length === 0,
    issues,
  };
}

export async function checkOrderIntegrity(orderId: string): Promise<IntegrityCheckResult> {
  const issues: string[] = [];

  const order = await db.query.orders.findFirst({
    where: eq(orders.id, orderId),
  });

  if (!order) {
    return { valid: false, issues: ["Order not found"] };
  }

  // Check for corresponding transaction
  const transaction = await db.query.walletTransactions.findFirst({
    where: eq(walletTransactions.orderId, orderId),
  });

  if (!transaction && order.status !== "refunded") {
    issues.push("No transaction found for order");
  }

  if (transaction && transaction.amount !== order.amount) {
    issues.push(
      `Transaction amount mismatch: order ${order.amount}, transaction ${transaction.amount}`
    );
  }

  // Check refunded orders have refund transaction
  if (order.status === "refunded") {
    const refundTx = await db.query.walletTransactions.findFirst({
      where: and(
        eq(walletTransactions.orderId, orderId),
        eq(walletTransactions.type, "credit")
      ),
    });

    if (!refundTx) {
      issues.push("Refunded order missing refund transaction");
    }
  }

  return {
    valid: issues.length === 0,
    issues,
  };
}

export async function runFullIntegrityCheck(): Promise<{
  users: { checked: number; issues: number };
  orders: { checked: number; issues: number };
}> {
  const allUsers = await db.query.users.findMany();
  const allOrders = await db.query.orders.findMany();

  let userIssues = 0;
  let orderIssues = 0;

  for (const user of allUsers) {
    const result = await checkWalletIntegrity(user.id);
    if (!result.valid) {
      userIssues++;
      console.error(`Wallet integrity issues for user ${user.id}:`, result.issues);
    }
  }

  for (const order of allOrders) {
    const result = await checkOrderIntegrity(order.id);
    if (!result.valid) {
      orderIssues++;
      console.error(`Order integrity issues for order ${order.id}:`, result.issues);
    }
  }

  return {
    users: { checked: allUsers.length, issues: userIssues },
    orders: { checked: allOrders.length, issues: orderIssues },
  };
}

export function validateTransactionAmount(amount: number): boolean {
  return Number.isInteger(amount) && amount > 0 && amount <= 10000000; // Max 10M kobo
}

export function validateWalletBalance(balance: number): boolean {
  return Number.isInteger(balance) && balance >= 0;
}
