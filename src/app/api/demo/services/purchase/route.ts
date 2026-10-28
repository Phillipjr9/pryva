import { NextRequest, NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { isPreviewDatabase } from "@/lib/demo-policy";
import { DemoStockError, demoService, purchaseDemoService } from "@/lib/demo-services";
import { DemoBalanceError, DemoConflict, DEMO_REQUEST_ID } from "@/lib/demo-wallet";
import { isSameOriginMutation } from "@/lib/net";
import { purchaseRateLimiter } from "@/lib/rate-limit";
import { isJsonRequest, readJsonWithLimit, RequestBodyTooLargeError } from "@/lib/request-body";

export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  if (!isPreviewDatabase()) return NextResponse.json({ error: "Demo orders are unavailable here." }, { status: 404 });
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Please sign in." }, { status: 401 });
  if (!isSameOriginMutation(request)) return NextResponse.json({ error: "Invalid origin." }, { status: 403 });
  if (!isJsonRequest(request)) return NextResponse.json({ error: "Expected JSON." }, { status: 415 });
  const limit = await purchaseRateLimiter(`demo-service-purchase:${user.id}`);
  if (limit.unavailable) return NextResponse.json({ error: "Could not create the demo order." }, { status: 503 });
  if (!limit.allowed) return NextResponse.json({ error: "Too many attempts. Please try again shortly." }, { status: 429 });
  let value: unknown;
  try { value = await readJsonWithLimit(request, 2_048); }
  catch (error) { return NextResponse.json({ error: "Invalid request." }, { status: error instanceof RequestBodyTooLargeError ? 413 : 400 }); }
  if (!value || typeof value !== "object" || Array.isArray(value)) return NextResponse.json({ error: "Invalid request." }, { status: 400 });
  const { itemId, country, requestId } = value as { itemId?: unknown; country?: unknown; requestId?: unknown };
  if (typeof itemId !== "string" || itemId.length > 80 || typeof country !== "string" || typeof requestId !== "string" || !DEMO_REQUEST_ID.test(requestId) || !demoService(itemId, country)) {
    return NextResponse.json({ error: "Invalid demo service selection." }, { status: 400 });
  }
  try {
    const result = purchaseDemoService({ userId: user.id, itemId, countryCode: country, requestId });
    return NextResponse.json({ ok: true, simulated: true, ...result }, { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) {
    if (error instanceof DemoBalanceError) return NextResponse.json({ error: error.message }, { status: 402 });
    if (error instanceof DemoConflict || error instanceof DemoStockError) return NextResponse.json({ error: error.message }, { status: 409 });
    return NextResponse.json({ error: "Could not create the demo order." }, { status: 500 });
  }
}
