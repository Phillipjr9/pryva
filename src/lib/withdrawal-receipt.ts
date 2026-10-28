import type { WithdrawalIntent } from "./withdrawal-intent";

export type WithdrawalStatus = "pending" | "processing" | "completed" | "failed" | "rejected";
export type WithdrawalReceipt = {
  reference: string; amount: number; fee: number; status: WithdrawalStatus; createdAt: string;
  bankName: string; accountNumber: string; accountName: string; replayed: boolean; newBalance?: number;
};
export type WithdrawalSubmitResult = { ok: true; receipt: WithdrawalReceipt } | { ok: false; message: string };

/** An HTTP 200 alone is not proof that the intended request was recorded. */
export function parseWithdrawalReceipt(value: unknown, intent: WithdrawalIntent): WithdrawalReceipt | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const result = value as Record<string, unknown>;
  if (result.ok !== true || typeof result.replayed !== "boolean" || !result.withdrawal || typeof result.withdrawal !== "object" || Array.isArray(result.withdrawal)) return null;
  const w = result.withdrawal as Record<string, unknown>;
  if (typeof w.id !== "string" || !/^[a-f0-9-]{36}$/i.test(w.id) || typeof w.reference !== "string" || !/^WD-[a-f0-9]{24}$/i.test(w.reference) ||
      w.amount !== intent.amount || typeof w.fee !== "number" || !Number.isSafeInteger(w.fee) || w.fee < 0 || w.fee > 5_000_000 ||
      typeof w.status !== "string" || !["pending", "processing", "completed", "failed", "rejected"].includes(w.status) ||
      typeof w.createdAt !== "string" || !Number.isFinite(Date.parse(w.createdAt)) ||
      typeof w.bankName !== "string" || !w.bankName || w.bankName.length > 100 || typeof w.accountName !== "string" || !w.accountName || w.accountName.length > 200 ||
      typeof w.accountNumber !== "string" || !/^\d{10}$/.test(w.accountNumber) ||
      (result.newBalance !== undefined && (typeof result.newBalance !== "number" || !Number.isSafeInteger(result.newBalance) || result.newBalance < 0))) return null;
  return {
    reference: w.reference, amount: w.amount as number, fee: w.fee, status: w.status as WithdrawalStatus, createdAt: w.createdAt,
    bankName: w.bankName, accountNumber: w.accountNumber, accountName: w.accountName, replayed: result.replayed,
    ...(typeof result.newBalance === "number" ? { newBalance: result.newBalance } : {}),
  };
}

export function withdrawalStatusLabel(status: WithdrawalStatus) {
  switch (status) {
    case "pending": return "Awaiting approval";
    case "processing": return "Processing / review";
    case "completed": return "Marked paid out after review";
    case "failed": return "Failed";
    case "rejected": return "Rejected";
  }
}

export function maskAccountNumber(value: string) { return `••••••${value.slice(-4)}`; }
