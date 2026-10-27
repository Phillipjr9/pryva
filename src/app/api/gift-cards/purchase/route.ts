import { NextRequest, NextResponse } from "next/server";
import { createGiftCard } from "@/lib/gift-cards";
import { requireAuth } from "@/lib/auth";

export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  try {
    const user = await requireAuth(request);
    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const body = await request.json();
    const { amount, recipientEmail, message } = body;

    if (!amount || typeof amount !== "number") {
      return NextResponse.json({ error: "Invalid amount" }, { status: 400 });
    }

    if (recipientEmail && typeof recipientEmail !== "string") {
      return NextResponse.json({ error: "Invalid recipient email" }, { status: 400 });
    }

    if (message && typeof message !== "string") {
      return NextResponse.json({ error: "Invalid message" }, { status: 400 });
    }

    const result = await createGiftCard({
      userId: user.id,
      amount,
      recipientEmail,
      message,
    });

    return NextResponse.json({
      ok: true,
      code: result.code,
      amount: result.amount,
      expiresAt: result.expiresAt.toISOString(),
    });
  } catch (error) {
    console.error("Gift card purchase failed:", error);
    const message = error instanceof Error ? error.message : "Purchase failed";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
