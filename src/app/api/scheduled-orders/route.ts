import { isPreviewDatabase } from "@/lib/demo-policy";
import { NextRequest, NextResponse } from "next/server";
import { requireAuthApi } from "@/lib/auth";
import { createScheduledOrder, getUserScheduledOrders, pauseScheduledOrder, resumeScheduledOrder, cancelScheduledOrder } from "@/lib/scheduled-orders";

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

    if (!isPreviewDatabase()) {
      return NextResponse.json({ error: "Scheduled purchases are temporarily unavailable." }, { status: 503 });
    }

    const body = await request.json();
    const { service, productSlug, frequency } = body;

    if (!service || !productSlug || !frequency) {
      return NextResponse.json({ error: "Missing required fields" }, { status: 400 });
    }

    const result = await createScheduledOrder({
      userId: user.id,
      service,
      productSlug,
      frequency,
    });

    return NextResponse.json({
      ok: true,
      id: result.id,
      nextRunAt: result.nextRunAt.toISOString(),
    });
  } catch (error) {
    console.error("Failed to create scheduled order:", error);
    const message = error instanceof Error ? error.message : "Failed to create scheduled order";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}

export async function PATCH(request: NextRequest) {
  try {
    const user = await requireAuthApi();
    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const body = await request.json();
    const { orderId, action } = body;

    if (!orderId || !action) {
      return NextResponse.json({ error: "Missing orderId or action" }, { status: 400 });
    }

    if (action === "pause") {
      await pauseScheduledOrder(orderId, user.id);
    } else if (action === "resume") {
      await resumeScheduledOrder(orderId, user.id);
    } else if (action === "cancel") {
      await cancelScheduledOrder(orderId, user.id);
    } else {
      return NextResponse.json({ error: "Invalid action" }, { status: 400 });
    }

    return NextResponse.json({ ok: true });
  } catch (error) {
    console.error("Failed to update scheduled order:", error);
    const message = error instanceof Error ? error.message : "Failed to update scheduled order";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
