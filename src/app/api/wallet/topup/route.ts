import { randomBytes } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { paymentTopups } from "@/db/schema";
import { getCurrentUser } from "@/lib/auth";
import { isPreviewDatabase } from "@/lib/demo-policy";
import { isSameOriginMutation, publicOrigin } from "@/lib/net";
import { initializePayment } from "@/lib/paystack";
import { logger } from "@/lib/logger";

export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  try {
    const user = await getCurrentUser();
    if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    if (!isSameOriginMutation(request)) return NextResponse.json({ error: "Cross-origin request denied" }, { status: 403 });

    if (isPreviewDatabase() || !process.env.PAYSTACK_SECRET_KEY?.trim()) {
      return NextResponse.json({ error: "Wallet top-ups are not configured." }, { status: 503 });
    }

    const { amount } = (await request.json()) as { amount?: unknown };
    if (typeof amount !== "number" || !Number.isSafeInteger(amount) || amount < 1000 || amount > 500000) {
      return NextResponse.json({ error: "Enter a whole-naira amount between ₦1,000 and ₦500,000." }, { status: 400 });
    }

    const reference = `TOP-${randomBytes(12).toString("hex")}`;
    // Record the intended user and amount before Paystack can send an event.
    await db.insert(paymentTopups).values({ reference, userId: user.id, amount });

    const payment = await initializePayment({
      email: user.email,
      amount: amount * 100,
      reference,
      callback_url: `${process.env.NEXT_PUBLIC_APP_URL?.replace(/\/+$/, "") || publicOrigin(request)}/dashboard/wallet?topup=success`,
      metadata: { userId: user.id, type: "wallet_topup" },
    });

    if (!payment.status || !payment.data?.authorization_url || payment.data.reference !== reference) {
      throw new Error("Paystack did not return a valid checkout session");
    }

    logger.info("Wallet top-up initialized", { userId: user.id, amount, reference });
    return NextResponse.json({ ok: true, authorizationUrl: payment.data.authorization_url, reference });
  } catch (error) {
    logger.error("Wallet top-up initialization failed", { error });
    return NextResponse.json({ error: "Failed to initialize payment." }, { status: 500 });
  }
}
