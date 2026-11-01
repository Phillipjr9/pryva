/**
 * The words a receipt may use.
 *
 * A receipt is a document a customer keeps and may show to a bank, an employer or
 * a tax office, so every line on it has to be true at the moment it is printed and
 * true a year later. Two rules follow from that:
 *
 *  • no supplier is ever named -- the owner's rule, and on a financial document it
 *    matters more, not less: "who we bought it from" is not part of the sale;
 *  • a status is spelled out rather than repeated as a database value, because
 *    "review" and "active" mean nothing to a reader outside this codebase.
 */

export const RECEIPT_STATUS_LABELS: Record<string, string> = {
  delivered: "Delivered",
  active: "Delivered — still within its validity window",
  processing: "Processing",
  pending: "Pending",
  review: "Under review",
  refunded: "Refunded to wallet",
  cancelled: "Cancelled",
  failed: "Failed",
  expired: "Expired",
};

export function receiptStatusLabel(status: string): string {
  return RECEIPT_STATUS_LABELS[status] ?? status;
}

/** A status that means the customer was not charged for a delivered good. */
export function receiptIsRefunded(status: string): boolean {
  return status === "refunded";
}

export const RECEIPT_FOOTER =
  "This receipt is generated from Pryva's records and is not a tax invoice. It shows what was ordered, what was charged and what the order's status was when it was printed. Supplier and integration details are deliberately not shown.";
