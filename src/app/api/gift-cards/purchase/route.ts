import { NextRequest, NextResponse } from "next/server";
import { createGiftCard } from "@/lib/gift-cards";
import { GIFT_CARD_MAX_AMOUNT, GIFT_CARD_MIN_AMOUNT } from "@/lib/gift-card-rules";
import { requireAuthApi } from "@/lib/auth";
import { isSameOriginMutation } from "@/lib/net";
import { isJsonRequest, readJsonWithLimit, RequestBodyTooLargeError } from "@/lib/request-body";
import { purchaseRateLimiter } from "@/lib/rate-limit";
import { validateEmail } from "@/lib/validation";
import { sendGiftCardDelivery } from "@/lib/gift-card-delivery";

export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  try {
    const user = await requireAuthApi();
    if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    if (!isSameOriginMutation(request)) return NextResponse.json({ error: "Invalid origin" }, { status: 403 });
    if (!isJsonRequest(request)) return NextResponse.json({ error: "Expected JSON" }, { status: 415 });
    const limit = await purchaseRateLimiter(`gift-card-purchase:${user.id}`);
    if (limit.unavailable) return NextResponse.json({ error: "Gift card service temporarily unavailable." }, { status: 503 });
    if (!limit.allowed) return NextResponse.json({ error: "Too many attempts. Please try again later." }, { status: 429 });

    let body: unknown;
    try {
      body = await readJsonWithLimit(request, 4_096);
    } catch (error) {
      return NextResponse.json({ error: "Invalid request" }, { status: error instanceof RequestBodyTooLargeError ? 413 : 400 });
    }
    if (!body || typeof body !== "object" || Array.isArray(body)) return NextResponse.json({ error: "Invalid request" }, { status: 400 });
    const { amount, recipientEmail, message } = body as { amount?: unknown; recipientEmail?: unknown; message?: unknown };
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
    const result = await createGiftCard({ userId: user.id, amount, recipientEmail: recipient, message: note });

    // The card exists and the wallet is debited; mail is a courtesy on top, so it
    // can never turn this into a failure the customer would retry (and pay twice).
    if (recipient) {
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
    if (error instanceof Error && error.message === "Insufficient wallet balance or user not found") {
      return NextResponse.json({ error: "Insufficient wallet balance." }, { status: 400 });
    }
    console.error("Gift card purchase failed");
    return NextResponse.json({ error: "Purchase failed" }, { status: 500 });
  }
}
