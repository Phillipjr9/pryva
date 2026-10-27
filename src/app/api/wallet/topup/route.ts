import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth";
import { initializePayment } from "@/lib/paystack";
import { logger } from "@/lib/logger";

export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  try {
    const user = await requireAuth(request);
    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const body = await request.json();
    const { amount } = body;

    if (!amount || typeof amount !== "number" || amount < 100) {
      return NextResponse.json({ error: "Invalid amount. Minimum is ₦100" }, { status: 400 });
    }

    if (amount > 10000000) {
      return NextResponse.json({ error: "Maximum top-up is ₦10,000,000" }, { status: 400 });
    }

    const reference = `TOPUP-${Date.now()}-${Math.random().toString(36).slice(2, 8).toUpperCase()}`;

    const payment = await initializePayment({
      email: user.email,
      amount: amount * 100, // Convert to kobo
      reference,
      callback_url: `${process.env.NEXT_PUBLIC_APP_URL || "https://pryva.ng"}/dashboard/wallet?topup=success`,
      metadata: {
        userId: user.id,
        type: "wallet_topup",
      },
    });

    logger.info("Wallet top-up initialized", { userId: user.id, amount, reference });

    return NextResponse.json({
      ok: true,
      authorizationUrl: payment.data.authorization_url,
      reference,
    });
  } catch (error) {
    logger.error("Wallet top-up initialization failed", { error });
    const message = error instanceof Error ? error.message : "Failed to initialize payment";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
