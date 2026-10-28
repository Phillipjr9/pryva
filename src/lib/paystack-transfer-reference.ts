const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/** Stable per-withdrawal reference satisfying Paystack's lowercase 16–50 character contract. */
export function paystackTransferReference(withdrawalId: string): string {
  if (!UUID.test(withdrawalId)) throw new Error("Invalid withdrawal ID");
  return `wd-${withdrawalId.replace(/-/g, "").toLowerCase()}`;
}
