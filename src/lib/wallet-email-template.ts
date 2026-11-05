import { brandedNotificationEmail } from "@/lib/email-templates";

export type WalletEmailEvent =
  | { kind: "wallet"; type: string; amount: number; reference: string; description: string; createdAt: Date }
  | { kind: "withdrawal_processing" | "withdrawal_completed" | "withdrawal_rejected" | "withdrawal_failed" | "purchase_completed"; amount: number; reference: string; createdAt: Date }
  | { kind: "first_purchase"; amount: number; reference: string; description: string; productName: string | null; createdAt: Date }
  | { kind: "bank_linked"; bankName: string; lastFour: string | null; createdAt: Date };

/** Resend accepts inline attachments as base64 with a content ID. */
export type ResendAttachment = { filename: string; content: string; content_id?: string };
export type ResendPayload = {
  from: string;
  to: string[];
  subject: string;
  text: string;
  html: string;
  attachments?: ResendAttachment[];
};

function clean(value: string, max: number): string {
  return value.replace(/[\u0000-\u001f\u007f]/g, " ").replace(/\s+/g, " ").trim().slice(0, max);
}

/** Only server-generated references can leave the app. Gift-card references are redeemable codes. */
function safeReference(event: Exclude<WalletEmailEvent, { kind: "bank_linked" }>): string | null {
  const value = event.reference;
  if ((event.kind === "wallet" || event.kind === "first_purchase") && /gift\s*card/i.test(event.description)) return null;
  if (event.kind === "wallet" && event.type === "credit" && event.description === "Paystack wallet top-up" && /^TOP-[a-f0-9]{24}$/i.test(value)) return value;
  if ((event.kind.startsWith("withdrawal_") || (event.kind === "wallet" && event.type === "withdrawal")) && /^WD-[a-f0-9]{24}$/i.test(value)) return value;
  if ((event.kind === "purchase_completed" || event.kind === "first_purchase") && /^MKT-[a-f0-9]{28}$/i.test(value)) return value;
  if (event.kind === "first_purchase" && /^(?:PRY|GC|BLK)-[a-z0-9]{21}$/i.test(value)) return value;
  if (event.kind === "wallet" && event.type === "refund" && /^(?:RFD|RWD|REF)-[a-f0-9]{24}$/i.test(value)) return value;
  return null;
}

/** No full bank details, balances, gift codes, OTPs, credentials or arbitrary descriptions leave the app. */
export function makeWalletEmail(event: WalletEmailEvent, recipient: string, sender: string): ResendPayload {
  if (!/^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/.test(recipient) || recipient.length > 200 ||
      !sender || sender.length > 255 || /[\r\n]/.test(sender) ||
      !Number.isFinite(event.createdAt.getTime())) throw new Error("Invalid notification data");

  const recorded = event.createdAt.toISOString().replace("T", " ").slice(0, 16) + " UTC";
  const warning = "If you don't recognize this activity, secure your account and contact support. Pryva will never ask for your password, OTP or card details by email.";
  if (event.kind === "bank_linked") {
    const bankName = clean(event.bankName, 100) || "Bank account";
    const account = event.lastFour && /^\d{4}$/.test(event.lastFour) ? `Ending in ${event.lastFour}` : "Details hidden";
    const message = brandedNotificationEmail({
      subject: "Pryva: A bank account was linked",
      eyebrow: "Account security",
      title: "A bank account was linked",
      intro: "A bank account was added to your Pryva account. You can review your saved accounts in your wallet.",
      hero: "bank", heroAlt: "Bank account linked",
      rows: [{ label: "Bank", value: bankName }, { label: "Account", value: account }, { label: "Added", value: recorded }],
      ctaPath: "/dashboard/wallet", ctaLabel: "View my wallet", note: warning,
    });
    return { from: sender, to: [recipient], ...message };
  }

  if (!Number.isSafeInteger(event.amount) || event.amount <= 0) throw new Error("Invalid notification data");
  let subject: string;
  let title: string;
  let intro: string;
  let eyebrow = "Wallet activity";
  let hero: "wallet" | "withdrawal" | "order" | "refund" = "wallet";
  let amountLabel = "Amount";
  let ctaPath = "/dashboard/wallet";
  let ctaLabel = "View my wallet";

  if (event.kind === "wallet") {
    if (event.type === "credit" && event.description === "Paystack wallet top-up") {
      subject = "Wallet top-up confirmed";
      title = "Your wallet has been topped up";
      intro = "Your wallet top-up was confirmed and credited. This confirms the wallet credit, not a bank or card statement.";
      eyebrow = "Top-up successful";
      amountLabel = "Amount added";
    } else if (event.type === "refund") {
      subject = "Wallet refund credited";
      title = "A refund reached your wallet";
      intro = "A refund was credited to your wallet. Check your transaction history for the latest details.";
      eyebrow = "Refund credited";
      hero = "refund";
      amountLabel = "Amount credited";
    } else if (event.type === "withdrawal") {
      subject = "Withdrawal request recorded";
      title = "Your withdrawal was requested";
      intro = "Your withdrawal request was recorded. This is a request, not confirmation of a bank payout. The total below includes the withdrawal fee.";
      eyebrow = "Withdrawal requested";
      hero = "withdrawal";
      amountLabel = "Wallet amount reserved";
    } else if (event.type === "debit") {
      subject = "Wallet debit recorded";
      title = "A wallet debit was recorded";
      intro = "This confirms the wallet movement only; check your order for delivery or review status.";
      amountLabel = "Amount debited";
    } else if (event.type === "credit") {
      subject = "Wallet credit recorded";
      title = "A credit reached your wallet";
      intro = "A credit was recorded on your wallet. Check your transaction history for the latest details.";
      amountLabel = "Amount credited";
    } else {
      subject = "Wallet activity recorded";
      title = "Your wallet activity";
      intro = "An activity was recorded on your wallet. Check your transaction history for the latest details.";
    }
  } else if (event.kind === "first_purchase") {
    subject = "Thank you for your first purchase";
    title = "Your first Pryva purchase";
    intro = "Thank you for choosing Pryva. Your purchase has been recorded; open your account for its current status and details.";
    eyebrow = "A first worth celebrating";
    hero = "order";
    amountLabel = "Purchase amount";
    ctaPath = "/dashboard";
    ctaLabel = "Open my account";
  } else if (event.kind === "purchase_completed") {
    subject = "Purchase marked delivered";
    title = "Your purchase was marked delivered";
    intro = "Sign in to view the order. Credentials and account details are not included in this email.";
    eyebrow = "Order update";
    hero = "order";
    amountLabel = "Order amount";
    ctaPath = "/dashboard/orders";
    ctaLabel = "View my orders";
  } else {
    eyebrow = "Withdrawal update";
    hero = "withdrawal";
    amountLabel = "Requested payout";
    if (event.kind === "withdrawal_processing") {
      subject = "Withdrawal under review";
      title = "Your withdrawal is being processed";
      intro = "This is not confirmation of a bank payout. Check your requests for updates.";
    } else if (event.kind === "withdrawal_completed") {
      subject = "Withdrawal marked complete";
      title = "Your withdrawal was marked complete";
      intro = "Your withdrawal was marked complete. Check your bank for the final receipt. This email is not a bank statement.";
    } else if (event.kind === "withdrawal_failed") {
      subject = "Withdrawal could not be completed";
      title = "Your withdrawal could not be completed";
      intro = "The withdrawal did not complete. The amount and fee were returned to your wallet; check your wallet and withdrawal history for details.";
    } else {
      subject = "Withdrawal request rejected";
      title = "Your withdrawal request was rejected";
      intro = "Check your wallet and withdrawal history for details. Any wallet refund is recorded separately.";
    }
  }

  const rows = [{ label: amountLabel, value: `₦${event.amount.toLocaleString("en-NG")}` }];
  if (event.kind === "first_purchase" && event.productName) rows.unshift({ label: "Product", value: clean(event.productName, 120) });
  const reference = safeReference(event);
  if (reference) rows.push({ label: "Reference", value: reference });
  rows.push({ label: "Recorded", value: recorded });
  const message = brandedNotificationEmail({
    subject: `Pryva: ${subject}`,
    eyebrow, title, intro, hero, heroAlt: title, rows, ctaPath, ctaLabel, note: warning,
  });
  return { from: sender, to: [recipient], ...message };
}
