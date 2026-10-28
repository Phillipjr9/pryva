import { NextRequest, NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { isPreviewDatabase } from "@/lib/demo-policy";
import { demoWithdrawalHistory, withdrawDemoFunds } from "@/lib/demo-withdrawal";
import { DemoBalanceError, DemoConflict, DEMO_REQUEST_ID } from "@/lib/demo-wallet";
import { isSameOriginMutation } from "@/lib/net";
import { purchaseRateLimiter } from "@/lib/rate-limit";
import { isJsonRequest, readJsonWithLimit, RequestBodyTooLargeError } from "@/lib/request-body";
import { MAX_WITHDRAWAL, MIN_WITHDRAWAL } from "@/lib/withdrawal";

export const dynamic = "force-dynamic";
const noStore = { "Cache-Control": "private, no-store" };

export async function GET() {
  if (!isPreviewDatabase()) return NextResponse.json({ error: "Demo withdrawals are unavailable here." }, { status: 404 });
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Please sign in." }, { status: 401 });
  try { return NextResponse.json({ ok: true, simulated: true, withdrawals: demoWithdrawalHistory(user.id) }, { headers: noStore }); }
  catch { return NextResponse.json({ error: "Could not load demo withdrawals." }, { status: 500 }); }
}

export async function POST(request: NextRequest) {
  if (!isPreviewDatabase()) return NextResponse.json({ error: "Demo withdrawals are unavailable here." }, { status: 404 });
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Please sign in." }, { status: 401 });
  if (!isSameOriginMutation(request)) return NextResponse.json({ error: "Invalid origin." }, { status: 403 });
  if (!isJsonRequest(request)) return NextResponse.json({ error: "Expected JSON." }, { status: 415 });
  const limit = await purchaseRateLimiter(`demo-withdraw:${user.id}`);
  if (limit.unavailable) return NextResponse.json({ error: "Could not process the demo withdrawal." }, { status: 503 });
  if (!limit.allowed) return NextResponse.json({ error: "Too many attempts. Please try again shortly." }, { status: 429 });
  let value: unknown;
  try { value = await readJsonWithLimit(request, 1_024); }
  catch (error) { return NextResponse.json({ error: "Invalid request." }, { status: error instanceof RequestBodyTooLargeError ? 413 : 400 }); }
  if (!value || typeof value !== "object" || Array.isArray(value)) return NextResponse.json({ error: "Invalid request." }, { status: 400 });
  const body = value as { amount?: unknown; requestId?: unknown };
  if (Object.keys(body).some((key) => key !== "amount" && key !== "requestId") || typeof body.amount !== "number" || !Number.isSafeInteger(body.amount) || body.amount < MIN_WITHDRAWAL || body.amount > MAX_WITHDRAWAL || typeof body.requestId !== "string" || !DEMO_REQUEST_ID.test(body.requestId)) {
    return NextResponse.json({ error: "Enter a valid demo amount and request ID. Bank details are not accepted." }, { status: 400 });
  }
  try { return NextResponse.json({ ok: true, simulated: true, amount: body.amount, ...withdrawDemoFunds({ userId: user.id, amount: body.amount, requestId: body.requestId }) }, { headers: noStore }); }
  catch (error) {
    if (error instanceof DemoBalanceError) return NextResponse.json({ error: error.message }, { status: 402 });
    if (error instanceof DemoConflict) return NextResponse.json({ error: error.message }, { status: 409 });
    return NextResponse.json({ error: "Could not process the demo withdrawal." }, { status: 500 });
  }
}
