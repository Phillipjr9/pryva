import { NextRequest, NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { isPreviewDatabase } from "@/lib/demo-policy";
import { DemoDigitalStockError, purchaseDemoDigital } from "@/lib/demo-digital";
import { getDigitalPlan } from "@/lib/digital-services";
import { explorerCountry } from "@/lib/service-explorer";
import { DemoBalanceError, DemoConflict, DEMO_REQUEST_ID } from "@/lib/demo-wallet";
import { isSameOriginMutation } from "@/lib/net";
import { purchaseRateLimiter } from "@/lib/rate-limit";
import { isJsonRequest, readJsonWithLimit, RequestBodyTooLargeError } from "@/lib/request-body";

export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  if (!isPreviewDatabase()) return NextResponse.json({ error: "Demo subscriptions are unavailable here." }, { status: 404 });
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Please sign in." }, { status: 401 });
  if (!isSameOriginMutation(request)) return NextResponse.json({ error: "Invalid origin." }, { status: 403 });
  if (!isJsonRequest(request)) return NextResponse.json({ error: "Expected JSON." }, { status: 415 });
  const limit = await purchaseRateLimiter(`demo-digital:${user.id}`);
  if (limit.unavailable) return NextResponse.json({ error: "Could not place the demo order." }, { status: 503 });
  if (!limit.allowed) return NextResponse.json({ error: "Too many attempts. Please try again shortly." }, { status: 429 });
  let value: unknown;
  try { value = await readJsonWithLimit(request, 1_024); }
  catch (error) { return NextResponse.json({ error: "Invalid request." }, { status: error instanceof RequestBodyTooLargeError ? 413 : 400 }); }
  if (!value || typeof value !== "object" || Array.isArray(value)) return NextResponse.json({ error: "Invalid request." }, { status: 400 });
  const { planId, requestId, country } = value as { planId?: unknown; requestId?: unknown; country?: unknown };
  const selectedCountry = country === undefined ? null : explorerCountry(country);
  if (typeof planId !== "string" || planId.length > 100 || !getDigitalPlan(planId) || typeof requestId !== "string" || !DEMO_REQUEST_ID.test(requestId) || (country !== undefined && !selectedCountry)) return NextResponse.json({ error: "Invalid demo plan, country or request ID." }, { status: 400 });
  try { return NextResponse.json({ ok: true, simulated: true, ...purchaseDemoDigital({ userId: user.id, planId, requestId, countryCode: selectedCountry?.code }) }, { headers: { "Cache-Control": "private, no-store" } }); }
  catch (error) {
    if (error instanceof DemoBalanceError) return NextResponse.json({ error: error.message }, { status: 402 });
    if (error instanceof DemoDigitalStockError || error instanceof DemoConflict) return NextResponse.json({ error: error.message }, { status: 409 });
    return NextResponse.json({ error: "Could not place the demo order." }, { status: 500 });
  }
}
