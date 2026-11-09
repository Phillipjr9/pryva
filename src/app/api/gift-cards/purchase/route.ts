import { beginPurchase } from "@/lib/checkout/purchase";
import { NextRequest, NextResponse } from "next/server";
import { createGiftCard } from "@/lib/services/gift-cards/credit";
import { GIFT_CARD_MAX_AMOUNT, GIFT_CARD_MIN_AMOUNT } from "@/lib/services/gift-cards/credit-rules";
import { validateEmail } from "@/lib/platform/validation";
import { sendGiftCardDelivery } from "@/lib/services/gift-cards/credit-delivery";

export const dynamic = "force-dynamic";

/**
 * POST /api/gift-cards/purchase — mint Pryva-issued wallet credit.
 *
 * The sibling `/api/gift-cards/order` buys a third-party brand voucher. This path
 * has no supplier to be late: the code is issued by this call, so its only failure
 * mode is the wallet itself.
 */

export async function POST(request: NextRequest) {
  try {
    const begun = await beginPurchase(request, {
      bucket: "gift-card-purchase",
      maxBodyBytes: 4_096,
      copy: {
        unavailable: "Gift cards are unavailable in this environment.",
        limiterDown: "Gift card service temporarily unavailable.",
        rateLimited: "Too many attempts. Please try again later.",
        invalidBody: "Invalid request",
      },
    });
    if (!begun.ok) return begun.response;
    const { user, body } = begun;
    if (!body || typeof body !== "object" || Array.isArray(body)) return NextResponse.json({ error: "Invalid request" }, { status: 400 });
    const { amount, recipientEmail, message, requestId } = body as { amount?: unknown; recipientEmail?: unknown; message?: unknown; requestId?: unknown };
    if (typeof requestId !== "string" || !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(requestId)) {
      return NextResponse.json({ error: "A valid purchase request ID is required." }, { status: 400 });
    }
    if (
      typeof amount !== "number" ||
      !Number.isSafeInteger(amount) ||
      amount < GIFT_CARD_MIN_AMOUNT ||
      amount > GIFT_CARD_MAX_AMOUNT
    ) {
      return NextResponse.json(
        {
          error: `Enter a whole-naira amount between ₦${GIFT_CARD_MIN_AMOUNT.toLocaleString("en-NG")} and ₦${GIFT_CARD_MAX_AMOUNT.toLocaleString("en-NG")}.`,
        },
        { status: 400 },
      );
    }
    if (recipientEmail != null && (typeof recipientEmail !== "string" || !!validateEmail(recipientEmail.trim()))) {
      return NextResponse.json({ error: "Invalid recipient email" }, { status: 400 });
    }
    if (message != null && (typeof message !== "string" || message.length > 1000)) {
      return NextResponse.json({ error: "Message must be at most 1,000 characters." }, { status: 400 });
    }
    const recipient = typeof recipientEmail === "string" ? recipientEmail.trim().toLowerCase() : undefined;
    const note = typeof message === "string" ? message.trim() : undefined;
    const result = await createGiftCard({ userId: user.id, amount, requestId, recipientEmail: recipient, message: note });

    // The card exists and the wallet is debited; mail is a courtesy on top, so it
    // can never turn this into a failure the customer would retry (and pay twice).
    if (recipient && !result.replayed) {
      await sendGiftCardDelivery({
        to: recipient,
        code: result.code,
        amount: result.amount,
        senderName: user.name ?? "A friend",
        message: note,
      }).catch(() => undefined);
    }
    return NextResponse.json({ ok: true, code: result.code, amount: result.amount, expiresAt: result.expiresAt.toISOString() }, {
      headers: { "Cache-Control": "private, no-store" },
    });
  } catch (error) {
    if (error instanceof Error && error.message === "Purchase request ID belongs to a different gift card") {
      return NextResponse.json({ error: "This purchase attempt used different card details. Check your gift card history before starting another." }, { status: 409 });
    }
    if (error instanceof Error && error.message === "Insufficient wallet balance or user not found") {
      return NextResponse.json({ error: "Insufficient wallet balance." }, { status: 400 });
    }
    console.error("Gift card purchase failed");
    return NextResponse.json({ error: "Purchase failed" }, { status: 500 });
  }
}
