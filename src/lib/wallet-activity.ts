/** Direction of a ledger entry. Unknown types must not be displayed as credits. */
export function walletEntryDirection(type: string): "in" | "out" | "unknown" {
  if (type === "credit" || type === "refund") return "in";
  if (type === "debit" || type === "withdrawal") return "out";
  return "unknown";
}

export function walletEntrySign(type: string): string {
  const direction = walletEntryDirection(type);
  return direction === "in" ? "+" : direction === "out" ? "−" : "";
}
