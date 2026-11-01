export type WalletEmailEvent =
  | { kind: "wallet"; type: string; amount: number; reference: string; description: string; createdAt: Date }
  | { kind: "withdrawal_processing" | "withdrawal_completed" | "withdrawal_rejected" | "purchase_completed"; amount: number; reference: string; createdAt: Date };

/**
 * Resend takes attachments as base64. A `content_id` makes the image available
 * inline as `cid:<id>` as well as downloadable, which is how the eSIM QR reaches
 * a mail client that blocks remote images.
 */
export type ResendAttachment = { filename: string; content: string; content_id?: string };

export type ResendPayload = {
  from: string;
  to: string[];
  subject: string;
  text: string;
  html: string;
  attachments?: ResendAttachment[];
};

function htmlEscape(value: string): string {
  return value.replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[char]!);
}

/** Only known server-generated reference shapes may leave the app. Gift-card references contain redeemable codes. */
function safeReference(event: WalletEmailEvent): string | null {
  const value = event.reference;
  if (event.kind === "wallet" && /gift\s*card/i.test(event.description)) return null;
  if (event.kind === "wallet" && event.type === "credit" && event.description === "Paystack wallet top-up" && /^TOP-[a-f0-9]{24}$/i.test(value)) return value;
  if ((event.kind.startsWith("withdrawal_") || (event.kind === "wallet" && event.type === "withdrawal")) && /^WD-[a-f0-9]{24}$/i.test(value)) return value;
  if (event.kind === "purchase_completed" && /^MKT-[a-f0-9]{28}$/i.test(value)) return value;
  if (event.kind === "wallet" && event.type === "refund" && /^(?:RFD|RWD|REF)-[a-f0-9]{24}$/i.test(value)) return value;
  return null;
}

/** No bank details, balance, gift codes, OTPs, supplier credentials, or arbitrary descriptions leave the app. */
export function makeWalletEmail(event: WalletEmailEvent, recipient: string, sender: string, testMode: boolean): ResendPayload {
  if (!/^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/.test(recipient) || recipient.length > 200 ||
      !sender || sender.length > 255 || /[\r\n]/.test(sender) || !Number.isSafeInteger(event.amount) || event.amount <= 0 ||
      !Number.isFinite(event.createdAt.getTime())) throw new Error("Invalid notification data");

  let subject: string;
  let headline: string;
  let detail: string;
  let amountLabel = "Amount";
  if (event.kind === "wallet") {
    if (event.type === "credit" && event.description === "Paystack wallet top-up") {
      subject = "Wallet top-up confirmed";
      headline = "Your wallet top-up was confirmed and credited.";
      detail = "This confirms the wallet credit, not a bank or card statement.";
      amountLabel = "Amount added";
    } else if (event.type === "refund") {
      subject = "Wallet refund credited";
      headline = "A refund was credited to your wallet.";
      detail = "Check your transaction history for the latest details.";
      amountLabel = "Amount credited";
    } else if (event.type === "withdrawal") {
      subject = "Withdrawal request recorded";
      headline = "Your withdrawal request was recorded.";
      detail = "This is a request, not confirmation of a bank payout. The total below includes the withdrawal fee.";
      amountLabel = "Wallet amount reserved";
    } else if (event.type === "debit") {
      subject = "Wallet debit recorded";
      headline = "A debit was recorded on your wallet.";
      detail = "This confirms the wallet movement only; check your order for delivery or review status.";
      amountLabel = "Amount debited";
    } else if (event.type === "credit") {
      subject = "Wallet credit recorded";
      headline = "A credit was recorded on your wallet.";
      detail = "Check your transaction history for the latest details.";
      amountLabel = "Amount credited";
    } else {
      subject = "Wallet activity recorded";
      headline = "An activity was recorded on your wallet.";
      detail = "Check your transaction history for the latest details.";
    }
  } else if (event.kind === "purchase_completed") {
    subject = "Purchase marked delivered";
    headline = "Your purchase was marked delivered.";
    detail = "Sign in to view the order. Credentials and account details are not included in this email.";
    amountLabel = "Order amount";
  } else {
    amountLabel = "Requested payout";
    if (event.kind === "withdrawal_processing") {
      subject = "Withdrawal under review";
      headline = "Your withdrawal is being processed.";
      detail = "This is not confirmation of a bank payout. Check your requests for updates.";
    } else if (event.kind === "withdrawal_completed") {
      subject = "Withdrawal marked complete";
      headline = "Your withdrawal was marked complete after review.";
      detail = "Check your bank for the final receipt. This email is not a bank statement.";
    } else {
      subject = "Withdrawal request rejected";
      headline = "Your withdrawal request was rejected.";
      detail = "Check your wallet and withdrawal history for details. Any wallet refund is recorded separately.";
    }
  }

  const reference = safeReference(event);
  const lines = [
    testMode ? "TEST MODE — no real payment or payout." : "Pryva wallet notification",
    "",
    headline,
    `${amountLabel}: ₦${event.amount.toLocaleString("en-NG")}`,
    ...(reference ? [`Reference: ${reference}`] : []),
    `Recorded: ${event.createdAt.toISOString().replace("T", " ").replace(".000Z", " UTC")}`,
    "",
    detail,
    "Sign in to Pryva to view your activity. If you don't recognize it, contact support.",
    "Pryva will never ask for your password, OTP or card details by email.",
  ];
  const text = lines.join("\n");
  const html = `<div style="font-family:Arial,sans-serif;color:#1d1830;max-width:560px;margin:auto;line-height:1.6"><p style="font-weight:700;color:#6742a6">PRYVA</p><div style="white-space:pre-line">${htmlEscape(text)}</div></div>`;
  return { from: sender, to: [recipient], subject: `${testMode ? "[TEST] " : ""}Pryva: ${subject}`, text, html };
}
