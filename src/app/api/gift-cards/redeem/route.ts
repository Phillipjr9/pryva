import { NextRequest, NextResponse } from "next/server";
import { redeemGiftCard } from "@/lib/gift-cards";
import { requireAuth } from "@/lib/auth";

export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  try {
    const user = await requireAuth(request);
    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const body = await request.json();
    const { code } = body;

    if (!code || typeof code !== "string") {
      return NextResponse.json({ error: "Invalid code" }, { status: 400 });
    }

    const result = await redeemGiftCard({
      userId: user.id,
      code: code.trim().toUpperCase(),
    });

    return NextResponse.json({
      ok: true,
      amount: result.amount,
    });
  } catch (error) {
    console.error("Gift card redemption failed:", error);
    const message = error instanceof Error ? error.message : "Redemption failed";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
