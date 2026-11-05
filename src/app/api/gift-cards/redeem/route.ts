import { financialActionsUnavailable } from "@/lib/platform/financial-environment";
import { NextRequest, NextResponse } from "next/server";
import { redeemGiftCard } from "@/lib/services/gift-cards/gift-cards";
import { requireAuthApi } from "@/lib/identity/auth";
import { isSameOriginMutation } from "@/lib/platform/net";
import { isJsonRequest, readJsonWithLimit, RequestBodyTooLargeError } from "@/lib/platform/request-body";
import { giftCardAttemptLimit, normalizeGiftCardCode } from "@/lib/services/gift-cards/gift-card-requests";
import { giftCardVelocity, recordFraudEvent } from "@/lib/admin/fraud";

export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  try {
    const user = await requireAuthApi();
    if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    if (!isSameOriginMutation(request)) return NextResponse.json({ error: "Invalid origin" }, { status: 403 });
    if (!isJsonRequest(request)) return NextResponse.json({ error: "Expected JSON" }, { status: 415 });
    if (financialActionsUnavailable()) return NextResponse.json({ error: "Gift cards are unavailable in this environment." }, { status: 503 });
    const limited = await giftCardAttemptLimit(request, user.id);
    if (limited) return limited;
    let body: unknown;
    try {
      body = await readJsonWithLimit(request, 2_048);
    } catch (error) {
      return NextResponse.json({ error: "Invalid request" }, { status: error instanceof RequestBodyTooLargeError ? 413 : 400 });
    }
    // A stolen card is monetised by redeeming it, so redemptions have a daily
    // ceiling as well as an attempt budget. Counted from the database: an
    // in-memory counter would be per-instance.
    const velocity = await giftCardVelocity(user.id).catch(() => ({ allowed: true, count: 0, limit: 0 }));
    if (!velocity.allowed) {
      await recordFraudEvent({
        userId: user.id,
        kind: "gift_card_velocity",
        severity: "warn",
        reasons: [`${velocity.count} gift cards redeemed in the last day (limit ${velocity.limit})`],
      });
      return NextResponse.json(
        { error: "That is a lot of gift cards in one day. Please contact support." },
        { status: 429 },
      );
    }

    const code = body && body !== null && typeof body === "object" && !Array.isArray(body) ? normalizeGiftCardCode((body as { code?: unknown }).code) : null;
    if (!code) return NextResponse.json({ error: "Invalid code" }, { status: 400 });
    const result = await redeemGiftCard({ userId: user.id, code });
    return NextResponse.json({ ok: true, amount: result.amount }, { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) {
    if (error instanceof Error && error.message === "Gift card is invalid, expired, already redeemed, or belongs to you") {
      return NextResponse.json({ error: error.message }, { status: 400 });
    }
    // Database errors can include the bearer code in SQL parameters.
    console.error("Gift card redemption failed");
    return NextResponse.json({ error: "Redemption failed" }, { status: 500 });
  }
}
