/**
 * The words, and the shape, of a receipt.
 *
 * A receipt is a document a customer keeps and may show to a bank, an employer or
 * a tax officer, so every line on it has to be true at the moment it is printed and
 * true a year later. Three rules follow from that:
 *
 *  • no supplier is ever named -- the owner's rule, and on a financial document it
 *    matters more, not less: "who we bought it from" is not part of the sale;
 *  • the order status and the wallet entries are separate facts: an order may
 *    exist before any debit, and an expired order is not necessarily refunded;
 *  • the document is laid out from data, in one place. The screen, the print
 *    sheet and the tests all read `receiptLineItems`, so a field can never appear
 *    on paper and go missing in the PDF because a second component forgot it.
 */

/** A ledger amount is only displayed when exactly one valid entry establishes it. */
export type ReceiptLedgerAmount =
  | { state: "recorded"; amount: number }
  | { state: "not-recorded" }
  | { state: "ambiguous" };

export type ReceiptWalletSummary = {
  charge: ReceiptLedgerAmount;
  refund: ReceiptLedgerAmount;
  needsReview: boolean;
};

/** Everything a receipt is allowed to know. Nothing here is a credential. */
export interface ReceiptData {
  reference: string;
  productName: string;
  /** The live catalogue name of the product ("Virtual number · Nigeria"). */
  service?: string;
  planLabel: string;
  region: string;
  duration: string;
  amount: number;
  status: string;
  createdAt: string;
  /** Wallet entries for this owner and order, not an inference from order status. */
  wallet: ReceiptWalletSummary;
  customerName: string;
  customerEmail: string;
  refundedAt?: string | null;
  /**
   * Boosting orders only: what was promoted and how much of it.
   *
   * A receipt for a promotion that does not say which post was promoted is not
   * evidence of anything, which is why these ride along -- as the description
   * under the line item, never as a second charge.
   */
  targetLink?: string | null;
  quantity?: number | null;
  /** When this sheet was produced, so a later reader knows which copy they hold. */
  generatedAt?: string;
}

/**
 * A purchase can have an order row before a wallet debit exists. Never turn the
 * quoted order amount or a status into a payment claim. Three rows are enough to
 * reveal duplicate debit/refund entries, so the caller deliberately bounds the
 * read at three and treats that case as ambiguous rather than guessing a total.
 */
export function receiptWalletSummary(
  order: { amount: number; status: string },
  entries: readonly { type: string; amount: number }[],
): ReceiptWalletSummary {
  if (entries.length >= 3) {
    return { charge: { state: "ambiguous" }, refund: { state: "ambiguous" }, needsReview: true };
  }
  const classify = (type: "debit" | "refund"): ReceiptLedgerAmount => {
    const matching = entries.filter((entry) => entry.type === type);
    if (!matching.length) return { state: "not-recorded" };
    if (matching.length !== 1 || !Number.isSafeInteger(matching[0].amount) || matching[0].amount < 0) {
      return { state: "ambiguous" };
    }
    return { state: "recorded", amount: matching[0].amount };
  };
  const charge = classify("debit");
  const refund = classify("refund");
  const chargeAmount = charge.state === "recorded" ? charge.amount : null;
  const refundAmount = refund.state === "recorded" ? refund.amount : null;
  const shouldHaveCharge = ["active", "delivered", "expired", "refunded"].includes(order.status);
  const needsReview = charge.state === "ambiguous" || refund.state === "ambiguous" ||
    (shouldHaveCharge && chargeAmount === null) ||
    (chargeAmount !== null && chargeAmount !== order.amount) ||
    (order.status === "refunded" && refundAmount === null) ||
    (refundAmount !== null && (order.status !== "refunded" || chargeAmount === null || refundAmount !== chargeAmount));
  return { charge, refund, needsReview };
}

export const RECEIPT_STATUS_LABELS: Record<string, string> = {
  delivered: "Delivered",
  active: "Active",
  processing: "Processing",
  pending: "Pending",
  review: "Under review",
  refunded: "Refunded",
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

/**
 * The tone a status is drawn in.
 *
 * Colour is never the only signal: the recorded order status is spelled out.
 * A failed, cancelled or expired order is not proof that money was refunded.
 */
export function receiptStatusTone(status: string): "settled" | "pending" | "reversed" | "closed" {
  switch (status) {
    case "delivered":
    case "active":
      return "settled";
    case "refunded":
      return "reversed";
    case "cancelled":
    case "failed":
    case "expired":
      return "closed";
    default:
      return "pending";
  }
}

/**
 * The human name for a `orders.service` value.
 *
 * That column holds an internal slug ("numbers", "social"), and a receipt that
 * prints "numbers" looks like a database export, not a document. The values are
 * spelled out here rather than read from the catalogue because the catalogue is
 * a marketing surface that can rename a service: a receipt from last year must
 * still say what was bought last year.
 */
export const RECEIPT_SERVICE_NAMES: Record<string, string> = {
  numbers: "Virtual number",
  esim: "eSIM data plan",
  proxies: "Residential proxies",
  "email-otp": "Email OTP inbox",
  email: "Email OTP inbox",
  accounts: "Digital account",
  social: "Social promotion",
  boosting: "Social promotion",
  data: "Mobile data plan",
  "gift-cards": "Pryva gift card",
  subscriptions: "Subscription",
  tools: "Pryva tool",
};

export function receiptServiceName(service: string): string {
  return RECEIPT_SERVICE_NAMES[service] ?? service;
}

/**
 * One sentence a reader can quote, for the state the order was in.
 *
 * Split out from the component because "refunded" once fell through the
 * pending branch and told a refunded customer their order "is not yet
 * complete" — on a document they may hand to a bank.
 */
export function receiptStatusNote(status: string, refundedAt?: string | null): string {
  switch (status) {
    case "refunded":
      return refundedAt ? `Order marked refunded ${refundedAt}.` : "Order marked refunded.";
    case "delivered":
      return "The order is marked delivered.";
    case "active":
      return "The order is active.";
    case "expired":
      return "The order's validity window has ended.";
    case "cancelled":
      return "The order was cancelled.";
    case "failed":
      return "The order failed.";
    case "review":
      return "The order requires review.";
    case "processing":
    case "pending":
      return "The order is still in progress.";
    default:
      return "";
  }
}

export type ReceiptLineItem = {
  /** The thing that was bought. */
  description: string;
  /** What it covers: plan, region, validity, the promoted link. */
  detail: string | null;
  /** Pre-formatted so the screen and any export show the identical string. */
  amountLabel: string;
};

/**
 * One order is one line item. This is the recorded order amount, not evidence
 * that a wallet charge occurred. Plan, region and validity describe the item;
 * the separately read wallet entries are shown below the order total.
 */
export function receiptLineItems(receipt: ReceiptData, amountLabel: string): ReceiptLineItem[] {
  const detail = [
    receipt.planLabel,
    receipt.region,
    receipt.duration,
    receipt.quantity && receipt.quantity > 0
      ? `${receipt.quantity.toLocaleString("en-NG")} units`
      : null,
    receipt.targetLink ?? null,
  ]
    .filter((part): part is string => Boolean(part && String(part).trim()))
    .join(" · ");

  return [
    {
      description: receipt.productName,
      detail: detail || null,
      amountLabel,
    },
  ];
}

export const RECEIPT_DOCUMENT_TITLE = "Payment receipt";

export const RECEIPT_FOOTER =
  "This document is generated from Pryva's records and is not a tax invoice. It shows the order amount, recorded wallet activity and order status when it was printed. Supplier and integration details are deliberately not shown.";

/** How a reader gets a human answer if the sheet is wrong. */
export const RECEIPT_SUPPORT_LINE =
  "Something wrong on this receipt? Open Support in your dashboard and quote the reference above.";
