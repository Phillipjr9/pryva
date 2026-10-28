import { NextRequest, NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { isPreviewDatabase } from "@/lib/demo-policy";
import { buyDemoAccounts, demoMarketplaceInventory } from "@/lib/demo-marketplace";
import { DemoStockError } from "@/lib/demo-services";
import { DemoBalanceError, DemoConflict, DEMO_REQUEST_ID } from "@/lib/demo-wallet";
import { isSameOriginMutation } from "@/lib/net";
import { purchaseRateLimiter } from "@/lib/rate-limit";
import { isJsonRequest, readJsonWithLimit, RequestBodyTooLargeError } from "@/lib/request-body";

export const dynamic = "force-dynamic";
const noStore = { "Cache-Control": "private, no-store" };

export async function GET() {
  if (!isPreviewDatabase()) return NextResponse.json({ error: "Demo accounts are unavailable here." }, { status: 404 });
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Please sign in." }, { status: 401 });
  try { return NextResponse.json({ ok: true, simulated: true, listings: demoMarketplaceInventory(user.id) }, { headers: noStore }); }
  catch { return NextResponse.json({ error: "Could not load demo accounts." }, { status: 500 }); }
}

export async function POST(request: NextRequest) {
  if (!isPreviewDatabase()) return NextResponse.json({ error: "Demo accounts are unavailable here." }, { status: 404 });
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Please sign in." }, { status: 401 });
  if (!isSameOriginMutation(request)) return NextResponse.json({ error: "Invalid origin." }, { status: 403 });
  if (!isJsonRequest(request)) return NextResponse.json({ error: "Expected JSON." }, { status: 415 });
  const limit = await purchaseRateLimiter(`demo-accounts:${user.id}`);
  if (limit.unavailable) return NextResponse.json({ error: "Could not place the demo order." }, { status: 503 });
  if (!limit.allowed) return NextResponse.json({ error: "Too many attempts. Please try again shortly." }, { status: 429 });
  let value: unknown;
  try { value = await readJsonWithLimit(request, 2_048); }
  catch (error) { return NextResponse.json({ error: "Invalid request." }, { status: error instanceof RequestBodyTooLargeError ? 413 : 400 }); }
  if (!value || typeof value !== "object" || Array.isArray(value)) return NextResponse.json({ error: "Invalid request." }, { status: 400 });
  const { slug, quantity, requestId } = value as { slug?: unknown; quantity?: unknown; requestId?: unknown };
  if (typeof slug !== "string" || slug.length > 80 || typeof quantity !== "number" || !Number.isSafeInteger(quantity) || quantity < 1 || quantity > 50 || typeof requestId !== "string" || !DEMO_REQUEST_ID.test(requestId) || !demoMarketplaceInventory(user.id).some((row) => row.slug === slug)) {
    return NextResponse.json({ error: "Invalid demo listing or quantity." }, { status: 400 });
  }
  try { return NextResponse.json({ ok: true, simulated: true, ...buyDemoAccounts({ userId: user.id, slug, quantity, requestId }) }, { headers: noStore }); }
  catch (error) {
    if (error instanceof DemoBalanceError) return NextResponse.json({ error: error.message }, { status: 402 });
    if (error instanceof DemoStockError || error instanceof DemoConflict) return NextResponse.json({ error: error.message }, { status: 409 });
    return NextResponse.json({ error: "Could not place the demo order." }, { status: 500 });
  }
}
