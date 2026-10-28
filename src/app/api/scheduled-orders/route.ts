import { isPreviewDatabase } from "@/lib/demo-policy";
import { NextRequest, NextResponse } from "next/server";
import { requireAuthApi } from "@/lib/auth";
import { createScheduledOrder, getUserScheduledOrders, pauseScheduledOrder, resumeScheduledOrder, cancelScheduledOrder, type Frequency } from "@/lib/scheduled-orders";
import { findPlan } from "@/lib/catalog";
import { isSameOriginMutation } from "@/lib/net";
import { isJsonRequest, readJsonWithLimit, RequestBodyTooLargeError } from "@/lib/request-body";
import { purchaseRateLimiter } from "@/lib/rate-limit";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  try {
    const user = await requireAuthApi();
    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const orders = await getUserScheduledOrders(user.id);

    return NextResponse.json({
      ok: true,
      orders: orders.map((order) => ({
        id: order.id,
        service: order.service,
        productSlug: order.productSlug,
        frequency: order.frequency,
        nextRunAt: order.nextRunAt.toISOString(),
        lastRunAt: order.lastRunAt?.toISOString() || null,
        status: order.status,
        createdAt: order.createdAt.toISOString(),
      })),
    });
  } catch (error) {
    console.error("Failed to fetch scheduled orders:", error);
    return NextResponse.json({ error: "Failed to fetch scheduled orders" }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    const user = await requireAuthApi();
    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    if (!isSameOriginMutation(request)) return NextResponse.json({ error: "Invalid origin" }, { status: 403 });
    if (!isJsonRequest(request)) return NextResponse.json({ error: "Expected JSON" }, { status: 415 });
    if (!isPreviewDatabase()) {
      return NextResponse.json({ error: "Scheduled purchases are temporarily unavailable." }, { status: 503 });
    }
    const limit = await purchaseRateLimiter(`scheduled-create:${user.id}`);
    if (limit.unavailable) return NextResponse.json({ error: "Scheduled purchases are temporarily unavailable." }, { status: 503 });
    if (!limit.allowed) return NextResponse.json({ error: "Too many attempts. Try again later." }, { status: 429 });

    let body: unknown;
    try {
      body = await readJsonWithLimit(request, 2_048);
    } catch (error) {
      return NextResponse.json({ error: "Invalid request" }, { status: error instanceof RequestBodyTooLargeError ? 413 : 400 });
    }
    if (!body || typeof body !== "object" || Array.isArray(body)) return NextResponse.json({ error: "Invalid request" }, { status: 400 });
    const { service, productSlug, frequency } = body as { service?: unknown; productSlug?: unknown; frequency?: unknown };
    if (typeof service !== "string" || typeof productSlug !== "string" || productSlug.length > 80 ||
        typeof frequency !== "string" || !["daily", "weekly", "biweekly", "monthly"].includes(frequency) ||
        findPlan(productSlug)?.service !== service) {
      return NextResponse.json({ error: "Invalid product, service or frequency" }, { status: 400 });
    }

    const result = await createScheduledOrder({ userId: user.id, service, productSlug, frequency: frequency as Frequency });

    return NextResponse.json({
      ok: true,
      id: result.id,
      nextRunAt: result.nextRunAt.toISOString(),
    });
  } catch {
    console.error("Failed to create scheduled order");
    return NextResponse.json({ error: "Failed to create scheduled order" }, { status: 500 });
  }
}

export async function PATCH(request: NextRequest) {
  try {
    const user = await requireAuthApi();
    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    if (!isSameOriginMutation(request)) return NextResponse.json({ error: "Invalid origin" }, { status: 403 });
    if (!isJsonRequest(request)) return NextResponse.json({ error: "Expected JSON" }, { status: 415 });
    let body: unknown;
    try {
      body = await readJsonWithLimit(request, 2_048);
    } catch (error) {
      return NextResponse.json({ error: "Invalid request" }, { status: error instanceof RequestBodyTooLargeError ? 413 : 400 });
    }
    if (!body || typeof body !== "object" || Array.isArray(body)) return NextResponse.json({ error: "Invalid request" }, { status: 400 });
    const { orderId, action } = body as { orderId?: unknown; action?: unknown };
    if (typeof orderId !== "string" || !(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(orderId) || (isPreviewDatabase() && /^[a-z0-9-]{1,64}$/i.test(orderId)))) {
      return NextResponse.json({ error: "Invalid order ID" }, { status: 400 });
    }
    if (action === "resume" && !isPreviewDatabase()) return NextResponse.json({ error: "Scheduled purchases are temporarily unavailable." }, { status: 503 });

    let updated: boolean;
    if (action === "pause") {
      updated = await pauseScheduledOrder(orderId, user.id);
    } else if (action === "resume") {
      updated = await resumeScheduledOrder(orderId, user.id);
    } else if (action === "cancel") {
      updated = await cancelScheduledOrder(orderId, user.id);
    } else {
      return NextResponse.json({ error: "Invalid action" }, { status: 400 });
    }
    if (!updated) return NextResponse.json({ error: "Schedule not found or cannot be changed in its current state" }, { status: 409 });
    return NextResponse.json({ ok: true });
  } catch {
    console.error("Failed to update scheduled order");
    return NextResponse.json({ error: "Failed to update scheduled order" }, { status: 500 });
  }
}
