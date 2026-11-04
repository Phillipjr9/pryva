import { WALLET_CREDIT_TYPES, WALLET_DEBIT_TYPES } from "@/db/schema";

// Widened once here so the membership test below takes any string without
// asserting the caller passed a known type.
const CREDIT_TYPES: readonly string[] = WALLET_CREDIT_TYPES;
const DEBIT_TYPES: readonly string[] = WALLET_DEBIT_TYPES;

/**
 * Direction of a ledger entry, read from the vocabulary in `@/db/schema` instead
 * of a list repeated here.
 *
 * Unknown types must not be displayed as credits: a row nobody can classify is
 * shown without a sign, so nobody reading it is invited to believe it added
 * money.
 */
export function walletEntryDirection(type: string): "in" | "out" | "unknown" {
  if (CREDIT_TYPES.includes(type)) return "in";
  if (DEBIT_TYPES.includes(type)) return "out";
  return "unknown";
}

export function walletEntrySign(type: string): string {
  const direction = walletEntryDirection(type);
  return direction === "in" ? "+" : direction === "out" ? "−" : "";
}
