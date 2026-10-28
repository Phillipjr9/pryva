import { NextRequest, NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { isPreviewDatabase } from "@/lib/demo-policy";
import { DemoScheduleError, runDemoSchedule } from "@/lib/demo-schedule";
import { DemoBalanceError, DemoConflict, DEMO_REQUEST_ID } from "@/lib/demo-wallet";
import { isSameOriginMutation } from "@/lib/net";
import { purchaseRateLimiter } from "@/lib/rate-limit";
import { isJsonRequest, readJsonWithLimit, RequestBodyTooLargeError } from "@/lib/request-body";

export const dynamic = "force-dynamic";

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  if (!isPreviewDatabase()) return NextResponse.json({ error: "Demo schedules are unavailable here." }, { status: 404 });
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Please sign in." }, { status: 401 });
  if (!isSameOriginMutation(request)) return NextResponse.json({ error: "Invalid origin." }, { status: 403 });
  if (!isJsonRequest(request)) return NextResponse.json({ error: "Expected JSON." }, { status: 415 });
  const limit = await purchaseRateLimiter(`demo-schedule:${user.id}`);
  if (limit.unavailable) return NextResponse.json({ error: "Could not run the demo schedule." }, { status: 503 });
  if (!limit.allowed) return NextResponse.json({ error: "Too many attempts. Please try again shortly." }, { status: 429 });
  let value: unknown;
  try { value = await readJsonWithLimit(request, 1_024); }
  catch (error) { return NextResponse.json({ error: "Invalid request." }, { status: error instanceof RequestBodyTooLargeError ? 413 : 400 }); }
  const requestId = value && typeof value === "object" && !Array.isArray(value) ? (value as { requestId?: unknown }).requestId : null;
  const { id } = await params;
  if (!/^[a-z0-9-]{1,64}$/i.test(id) || typeof requestId !== "string" || !DEMO_REQUEST_ID.test(requestId)) return NextResponse.json({ error: "Invalid demo schedule or request ID." }, { status: 400 });
  try { return NextResponse.json({ ok: true, simulated: true, ...runDemoSchedule({ userId: user.id, scheduleId: id, requestId }) }, { headers: { "Cache-Control": "private, no-store" } }); }
  catch (error) {
    if (error instanceof DemoBalanceError) return NextResponse.json({ error: error.message }, { status: 402 });
    if (error instanceof DemoScheduleError || error instanceof DemoConflict) return NextResponse.json({ error: error.message }, { status: 409 });
    return NextResponse.json({ error: "Could not run the demo schedule." }, { status: 500 });
  }
}
