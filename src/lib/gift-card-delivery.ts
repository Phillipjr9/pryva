import "server-only";

import { giftCardEmail } from "@/lib/email-templates";
import { resendConfigured } from "@/lib/resend-config";

/**
 * Mail a Pryva gift card to the address the buyer typed.
 *
 * The template has existed since the gift-card launch and nothing ever called it,
 * so a card bought "for someone" only reached them if the buyer copied the code
 * out of their own screen. The code is the money: a message that never arrives
 * leaves the recipient with nothing to redeem and the buyer believing it is done.
 *
 * Best effort, like a password reset and for the same reason: the card is already
 * created and the wallet already debited, so a mail failure must not turn a
 * successful purchase into an error the customer retries. The code stays visible
 * on the buyer's screen either way.
 */

const HTML_ESCAPES: Record<string, string> = {
  "&": "&amp;",
  "<": "&lt;",
  ">": "&gt;",
  '"': "&quot;",
  "'": "&#39;",
};

/** The message and the sender's name are customer text that lands inside HTML. */
export function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (char) => HTML_ESCAPES[char]);
}

export interface GiftCardDelivery {
  to: string;
  code: string;
  amount: number;
  senderName: string;
  message?: string;
}

export function giftCardDeliveryConfigured(): boolean {
  return resendConfigured();
}

export async function sendGiftCardDelivery(gift: GiftCardDelivery): Promise<boolean> {
  const key = process.env.RESEND_API_KEY?.trim();
  const from = process.env.RESEND_FROM_EMAIL?.trim();
  if (!resendConfigured() || !key || !from) {
    // Not an error: the buyer still has the code on screen.
    console.info("[gift-cards] delivery email skipped: Resend is not configured");
    return false;
  }

  const template = giftCardEmail({
    code: gift.code,
    amount: gift.amount,
    senderName: escapeHtml(gift.senderName),
    message: gift.message ? escapeHtml(gift.message) : undefined,
  });

  try {
    const response = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
      body: JSON.stringify({ from, to: gift.to, subject: template.subject, html: template.html, text: template.text }),
    });
    if (!response.ok) {
      console.error("[gift-cards] delivery email rejected", { status: response.status });
      return false;
    }
    return true;
  } catch (error) {
    console.error("[gift-cards] delivery email failed", error instanceof Error ? error.message : String(error));
    return false;
  }
}
