/**
 * The words, and the shape, of a receipt.
 *
 * A receipt is a document a customer keeps and may show to a bank, an employer or
 * a tax officer, so every line on it has to be true at the moment it is printed and
 * true a year later. Three rules follow from that:
 *
 *  • no supplier is ever named -- the owner's rule, and on a financial document it
 *    matters more, not less: "who we bought it from" is not part of the sale;
 *  • a status is spelled out rather than repeated as a database value, because
 *    "review" and "active" mean nothing to a reader outside this codebase;
 *  • the document is laid out from data, in one place. The screen, the print
 *    sheet and the tests all read `receiptLineItems`, so a field can never appear
 *    on paper and go missing in the PDF because a second component forgot it.
 */

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
  /** e.g. "Wallet balance" — how the customer paid. */
  paidWith: string;
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

/**
 * The tone a status is drawn in.
 *
 * Three tones, not nine colours: a receipt is read at a glance, and the only
 * question the reader has is "did this happen, is it in flight, or did it not
 * happen". Colour is never the only signal -- the label is always spelled out
 * next to it, so the sheet survives a photocopier and a colour-blind reader.
 */
export function receiptStatusTone(status: string): "settled" | "pending" | "reversed" {
  switch (status) {
    case "delivered":
    case "active":
      return "settled";
    case "refunded":
    case "cancelled":
    case "failed":
    case "expired":
      return "reversed";
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
  if (status === "refunded") {
    // The pill already says "Refunded to wallet"; repeating it here would waste
    // the only line of explanation on the sheet. With no date there is nothing
    // to add, so add nothing.
    return refundedAt ? `Refund processed ${refundedAt}.` : "";
  }
  switch (status) {
    case "delivered":
    case "active":
      return "Paid in full from your Pryva wallet balance.";
    case "cancelled":
    case "failed":
    case "expired":
      return "No working service was delivered, and the charge was reversed.";
    default:
      return "This order is still in progress. The amount above is what was charged.";
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
 * One order is one line item.
 *
 * A receipt with a second line would imply a second charge, and there has never
 * been one: an order debits the wallet once, for one amount. The plan, region and
 * validity belong *under* the item rather than beside it, because they describe
 * the thing bought -- they are not prices.
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
  "This receipt is generated from Pryva's records and is not a tax invoice. It shows what was ordered, what was charged and what the order's status was when it was printed. Supplier and integration details are deliberately not shown.";

/** How a reader gets a human answer if the sheet is wrong. */
export const RECEIPT_SUPPORT_LINE =
  "Something wrong on this receipt? Open Support in your dashboard and quote the reference above.";
