import { NextRequest, NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { isPreviewDatabase } from "@/lib/demo-policy";
import { completeDemoTopUp, DemoBalanceError, DemoConflict, DEMO_REQUEST_ID, type DemoPaymentMethod } from "@/lib/demo-wallet";
import { isSameOriginMutation } from "@/lib/net";
import { purchaseRateLimiter } from "@/lib/rate-limit";
import { isJsonRequest, readJsonWithLimit, RequestBodyTooLargeError } from "@/lib/request-body";

export const dynamic = "force-dynamic";

/** Credits simulated funds only; no payment provider or persistent DB is used. */
export async function POST(request: NextRequest) {
  if (!isPreviewDatabase()) return NextResponse.json({ error: "Demo payments are unavailable here." }, { status: 404 });
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Please sign in." }, { status: 401 });
  if (!isSameOriginMutation(request)) return NextResponse.json({ error: "Invalid origin." }, { status: 403 });
  if (!isJsonRequest(request)) return NextResponse.json({ error: "Expected JSON." }, { status: 415 });
  const limit = await purchaseRateLimiter(`demo-topup:${user.id}`);
  if (limit.unavailable) return NextResponse.json({ error: "Could not process the demo payment." }, { status: 503 });
  if (!limit.allowed) return NextResponse.json({ error: "Too many attempts. Please try again shortly." }, { status: 429 });

  let value: unknown;
  try { value = await readJsonWithLimit(request, 2_048); }
  catch (error) { return NextResponse.json({ error: "Invalid request." }, { status: error instanceof RequestBodyTooLargeError ? 413 : 400 }); }
  if (!value || typeof value !== "object" || Array.isArray(value)) return NextResponse.json({ error: "Invalid request." }, { status: 400 });
  const { amount, method, requestId } = value as { amount?: unknown; method?: unknown; requestId?: unknown };
  if (typeof amount !== "number" || !Number.isSafeInteger(amount) || amount < 1000 || amount > 500000) {
    return NextResponse.json({ error: "Enter a whole-naira amount between ₦1,000 and ₦500,000." }, { status: 400 });
  }
  if ((method !== "card" && method !== "bank-transfer") || typeof requestId !== "string" || !DEMO_REQUEST_ID.test(requestId)) {
    return NextResponse.json({ error: "Invalid demo payment request." }, { status: 400 });
  }
  try {
    const result = completeDemoTopUp({ userId: user.id, amount, method: method as DemoPaymentMethod, requestId });
    return NextResponse.json({ ok: true, simulated: true, amount, fee: 0, ...result }, { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) {
    if (error instanceof DemoConflict) return NextResponse.json({ error: error.message }, { status: 409 });
    if (error instanceof DemoBalanceError) return NextResponse.json({ error: error.message }, { status: 409 });
    return NextResponse.json({ error: "Could not complete the demo payment." }, { status: 500 });
  }
}
