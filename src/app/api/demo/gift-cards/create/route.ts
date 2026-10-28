import { NextRequest, NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { isPreviewDatabase } from "@/lib/demo-policy";
import { createDemoGiftCard } from "@/lib/demo-gift-cards";
import { DemoBalanceError, DemoConflict, DEMO_REQUEST_ID } from "@/lib/demo-wallet";
import { isSameOriginMutation } from "@/lib/net";
import { purchaseRateLimiter } from "@/lib/rate-limit";
import { isJsonRequest, readJsonWithLimit, RequestBodyTooLargeError } from "@/lib/request-body";

export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  if (!isPreviewDatabase()) return NextResponse.json({ error: "Demo gift cards are unavailable here." }, { status: 404 });
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Please sign in." }, { status: 401 });
  if (!isSameOriginMutation(request)) return NextResponse.json({ error: "Invalid origin." }, { status: 403 });
  if (!isJsonRequest(request)) return NextResponse.json({ error: "Expected JSON." }, { status: 415 });
  const limit = await purchaseRateLimiter(`demo-gift:${user.id}`);
  if (limit.unavailable) return NextResponse.json({ error: "Could not create the demo gift card." }, { status: 503 });
  if (!limit.allowed) return NextResponse.json({ error: "Too many attempts. Please try again shortly." }, { status: 429 });
  let value: unknown;
  try { value = await readJsonWithLimit(request, 1_024); }
  catch (error) { return NextResponse.json({ error: "Invalid request." }, { status: error instanceof RequestBodyTooLargeError ? 413 : 400 }); }
  if (!value || typeof value !== "object" || Array.isArray(value)) return NextResponse.json({ error: "Invalid request." }, { status: 400 });
  const body = value as { amount?: unknown; requestId?: unknown };
  if (Object.keys(body).some((key) => key !== "amount" && key !== "requestId") || typeof body.amount !== "number" || !Number.isSafeInteger(body.amount) || body.amount < 1000 || body.amount > 500000 || typeof body.requestId !== "string" || !DEMO_REQUEST_ID.test(body.requestId)) return NextResponse.json({ error: "Enter a valid demo amount and request ID. Personal details are not accepted." }, { status: 400 });
  try { return NextResponse.json({ ok: true, simulated: true, ...createDemoGiftCard({ userId: user.id, amount: body.amount, requestId: body.requestId }) }, { headers: { "Cache-Control": "private, no-store" } }); }
  catch (error) {
    if (error instanceof DemoBalanceError) return NextResponse.json({ error: error.message }, { status: 402 });
    if (error instanceof DemoConflict) return NextResponse.json({ error: error.message }, { status: 409 });
    return NextResponse.json({ error: "Could not create the demo gift card." }, { status: 500 });
  }
}
