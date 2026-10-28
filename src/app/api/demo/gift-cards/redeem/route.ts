import { NextRequest, NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { isPreviewDatabase } from "@/lib/demo-policy";
import { DemoGiftError, redeemDemoGiftCard } from "@/lib/demo-gift-cards";
import { DemoBalanceError } from "@/lib/demo-wallet";
import { isSameOriginMutation } from "@/lib/net";
import { giftCardAttemptLimit, normalizeGiftCardCode } from "@/lib/gift-card-requests";
import { isJsonRequest, readJsonWithLimit, RequestBodyTooLargeError } from "@/lib/request-body";

export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  if (!isPreviewDatabase()) return NextResponse.json({ error: "Demo gift cards are unavailable here." }, { status: 404 });
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Please sign in." }, { status: 401 });
  if (!isSameOriginMutation(request)) return NextResponse.json({ error: "Invalid origin." }, { status: 403 });
  if (!isJsonRequest(request)) return NextResponse.json({ error: "Expected JSON." }, { status: 415 });
  const limited = await giftCardAttemptLimit(request, user.id);
  if (limited) return limited;
  let value: unknown;
  try { value = await readJsonWithLimit(request, 1_024); }
  catch (error) { return NextResponse.json({ error: "Invalid request." }, { status: error instanceof RequestBodyTooLargeError ? 413 : 400 }); }
  const code = value && typeof value === "object" && !Array.isArray(value) ? normalizeGiftCardCode((value as { code?: unknown }).code) : null;
  if (!code) return NextResponse.json({ error: "Invalid demo code." }, { status: 400 });
  try { return NextResponse.json({ ok: true, simulated: true, ...redeemDemoGiftCard({ userId: user.id, code }) }, { headers: { "Cache-Control": "private, no-store" } }); }
  catch (error) {
    if (error instanceof DemoGiftError || error instanceof DemoBalanceError) return NextResponse.json({ error: error.message }, { status: 400 });
    return NextResponse.json({ error: "Could not redeem the demo card. Check your wallet before retrying." }, { status: 500 });
  }
}
