import { randomBytes } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { paymentTopups } from "@/db/schema";
import { getCurrentUser } from "@/lib/auth";
import { isPreviewDatabase } from "@/lib/demo-policy";
import { isSameOriginMutation, publicOrigin } from "@/lib/net";
import { initializePayment } from "@/lib/paystack";
import { logger } from "@/lib/logger";
import { purchaseRateLimiter } from "@/lib/rate-limit";
import { isJsonRequest, readJsonWithLimit, RequestBodyTooLargeError } from "@/lib/request-body";
import { isSafePaystackCheckoutUrl } from "@/lib/paystack-checkout";
import { paystackAppOrigin } from "@/lib/paystack-origin";

export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  try {
    const user = await getCurrentUser();
    if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    if (!isSameOriginMutation(request)) return NextResponse.json({ error: "Cross-origin request denied" }, { status: 403 });
    if (!isJsonRequest(request)) return NextResponse.json({ error: "Expected JSON" }, { status: 415 });

    if (isPreviewDatabase() || !process.env.PAYSTACK_SECRET_KEY?.trim()) {
      return NextResponse.json({ error: "Wallet top-ups are not configured." }, { status: 503 });
    }
    const limit = await purchaseRateLimiter(`topup-init:${user.id}`);
    if (limit.unavailable) return NextResponse.json({ error: "Wallet top-ups are temporarily unavailable." }, { status: 503 });
    if (!limit.allowed) return NextResponse.json({ error: "Too many top-up attempts. Please try again later." }, { status: 429 });

    let body: unknown;
    try {
      body = await readJsonWithLimit(request, 2_048);
    } catch (error) {
      return NextResponse.json({ error: "Invalid request body" }, { status: error instanceof RequestBodyTooLargeError ? 413 : 400 });
    }
    if (!body || typeof body !== "object" || Array.isArray(body)) return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
    // Available channels are chosen in Paystack's hosted checkout. Do not
    // silently pretend a client-supplied method restricts the payment channel.
    if (Object.hasOwn(body, "method")) {
      return NextResponse.json({ error: "Choose the payment method in Paystack checkout." }, { status: 400 });
    }
    const { amount } = body as { amount?: unknown };
    if (typeof amount !== "number" || !Number.isSafeInteger(amount) || amount < 1000 || amount > 500000) {
      return NextResponse.json({ error: "Enter a whole-naira amount between ₦1,000 and ₦500,000." }, { status: 400 });
    }

    const origin = paystackAppOrigin(process.env.NEXT_PUBLIC_APP_URL?.trim() || publicOrigin(request), process.env.NODE_ENV !== "production");
    if (!origin) return NextResponse.json({ error: "The payment return URL is not configured correctly." }, { status: 503 });
    const reference = `TOP-${randomBytes(12).toString("hex")}`;
    const callbackUrl = `${origin}/dashboard/wallet?topup=return`;
    // Record the intended user and amount before Paystack can send an event.
    await db.insert(paymentTopups).values({ reference, userId: user.id, amount });

    const payment = await initializePayment({
      email: user.email,
      amount: String(amount * 100),
      currency: "NGN",
      reference,
      callback_url: callbackUrl,
      metadata: JSON.stringify({ userId: user.id, type: "wallet_topup", cancel_action: `${callbackUrl}&reference=${encodeURIComponent(reference)}` }),
    });

    if (!payment.status || !isSafePaystackCheckoutUrl(payment.data?.authorization_url) || payment.data.reference !== reference) {
      throw new Error("Paystack did not return a valid checkout session");
    }

    logger.info("Wallet top-up initialized", { userId: user.id, amount, reference });
    return NextResponse.json({ ok: true, authorizationUrl: payment.data.authorization_url, reference });
  } catch {
    logger.error("Wallet top-up initialization failed");
    return NextResponse.json({ error: "Failed to initialize payment." }, { status: 500 });
  }
}
