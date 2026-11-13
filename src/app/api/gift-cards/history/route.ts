import { NextRequest, NextResponse } from "next/server";
import { getUserGiftCards, giftCardDisplayStatus } from "@/lib/services/gift-cards/credit";
import { requireAuthApi } from "@/lib/identity/auth";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  try {
    const user = await requireAuthApi();
    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const cards = await getUserGiftCards(user.id);
    const now = Date.now();

    return NextResponse.json({
      ok: true,
      cards: cards.map((card) => ({
        id: card.id,
        code: card.code,
        amount: card.amount,
        initialAmount: card.initialAmount,
        recipientEmail: card.recipientEmail,
        message: card.message,
        // Reflect enforced expiry in history without mutating the record.
        status: giftCardDisplayStatus(card, now),
        expiresAt: card.expiresAt.toISOString(),
        redeemedAt: card.redeemedAt?.toISOString() || null,
        createdAt: card.createdAt.toISOString(),
      })),
    }, { headers: { "Cache-Control": "private, no-store" } });
  } catch {
    console.error("Gift card history failed");
    return NextResponse.json({ error: "Failed to fetch history" }, { status: 500 });
  }
}
