import { randomBytes, randomInt } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { mutatePreviewDatabase } from "@/db";
import { getCurrentUser } from "@/lib/auth";
import { isPreviewDatabase } from "@/lib/demo-policy";
import { DEMO_REQUEST_ID } from "@/lib/demo-wallet";
import { isSameOriginMutation } from "@/lib/net";
import { purchaseRateLimiter } from "@/lib/rate-limit";
import { isJsonRequest, readJsonWithLimit, RequestBodyTooLargeError } from "@/lib/request-body";

export const dynamic = "force-dynamic";

/** Consume the next unit from a demo bundle, without any new charge. */
export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  if (!isPreviewDatabase()) return NextResponse.json({ error: "Demo orders are unavailable here." }, { status: 404 });
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Please sign in." }, { status: 401 });
  if (!isSameOriginMutation(request)) return NextResponse.json({ error: "Invalid origin." }, { status: 403 });
  if (!isJsonRequest(request)) return NextResponse.json({ error: "Expected JSON." }, { status: 415 });
  const limit = await purchaseRateLimiter(`demo-next-code:${user.id}`);
  if (limit.unavailable) return NextResponse.json({ error: "Could not start another demo code." }, { status: 503 });
  if (!limit.allowed) return NextResponse.json({ error: "Too many attempts. Please try again shortly." }, { status: 429 });
  let value: unknown;
  try { value = await readJsonWithLimit(request, 1_024); }
  catch (error) { return NextResponse.json({ error: "Invalid request." }, { status: error instanceof RequestBodyTooLargeError ? 413 : 400 }); }
  const requestId = value && typeof value === "object" && !Array.isArray(value) ? (value as { requestId?: unknown }).requestId : null;
  if (typeof requestId !== "string" || !DEMO_REQUEST_ID.test(requestId)) return NextResponse.json({ error: "Invalid request ID." }, { status: 400 });
  const { id } = await params;
  if (!/^[a-z0-9-]{1,64}$/i.test(id)) return NextResponse.json({ error: "Order not found." }, { status: 404 });
  try {
    const result = mutatePreviewDatabase((draft) => {
      const order = draft.orders.find((row) => row.id === id && row.userId === user.id);
      if (!order || order.provider !== "simulated" || !["numbers", "email-otp"].includes(String(order.service))) return "missing";
      if (order.demoLastNextId === requestId) return "ok";
      const expiresAt = order.expiresAt ? new Date(order.expiresAt as Date | string).getTime() : Infinity;
      if (order.status !== "active" || order.refundedAt || (expiresAt !== Infinity && !Number.isFinite(expiresAt)) || Date.now() >= expiresAt ||
          typeof order.demoUnitsRemaining !== "number" || !Number.isSafeInteger(order.demoUnitsRemaining) || order.demoUnitsRemaining < 1 || !order.otpCode) return "unavailable";
      order.demoLastNextId = requestId;
      order.demoOtpRequestedAt = new Date();
      order.otpCode = null;
      order.referenceCode = order.service === "numbers"
        ? `+000 555 ${String(randomInt(10000)).padStart(4, "0")}`
        : `demo-${randomBytes(3).toString("hex")}@example.test`;
      return "ok";
    });
    if (result === "missing") return NextResponse.json({ error: "Order not found." }, { status: 404 });
    if (result === "unavailable") return NextResponse.json({ error: "No additional demo unit is ready to use." }, { status: 409 });
    return NextResponse.json({ ok: true, simulated: true }, { headers: { "Cache-Control": "private, no-store" } });
  } catch {
    return NextResponse.json({ error: "Could not start another demo code." }, { status: 500 });
  }
}
