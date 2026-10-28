import { NextRequest, NextResponse } from "next/server";
import { and, desc, eq, inArray, isNull } from "drizzle-orm";
import { db } from "@/db";
import { orders, users } from "@/db/schema";
import { authorizeAdminApi } from "@/lib/admin-auth";
import { isJsonRequest, readJsonWithLimit, RequestBodyTooLargeError } from "@/lib/request-body";
import { manualWarrantyDays } from "@/lib/manual-catalog";
import { MANUAL_PROVIDER, MAX_QUEUE_ITEMS, QUEUE_STATUSES, quantityFromPlanLabel } from "@/lib/fulfilment-queue";
import { logger } from "@/lib/logger";

export const dynamic = "force-dynamic";

/** Credentials can be long; 50 rows of them still has to fit. */
const BODY_LIMIT = 200_000;
const MAX_ITEMS = MAX_QUEUE_ITEMS;
const MAX_CREDENTIAL_LENGTH = 2_000;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/**
 * Fulfilment queue for hand-sourced orders.
 *
 * Some products have no supplier API: the customer pays, the order waits here,
 * the owner buys it and pastes the credentials back. Nothing in this route names
 * a supplier, and credentials are never logged — only the order reference is.
 *
 * An order that cannot be sourced is moved to `review`, not refunded here: the
 * audited refund endpoint owns wallet credits, and it requires an explicit
 * reconciliation reason for a `review` order.
 */

/** Reject control characters but leave the credential itself untouched. */
function isUsableCredential(value: unknown): value is string {
  if (typeof value !== "string") return false;
  const trimmed = value.trim();
  // Written as escapes, so no literal control character ever appears in this file.
  return trimmed.length > 0 && trimmed.length <= MAX_CREDENTIAL_LENGTH && !/[\u0000-\u001f\u007f]/.test(trimmed);
}

export async function GET(request: NextRequest) {
  try {
    const access = await authorizeAdminApi(request);
    if (access.response) return access.response;

    const rows = await db.select({
      id: orders.id,
      reference: orders.reference,
      email: users.email,
      productName: orders.productName,
      productSlug: orders.productSlug,
      planLabel: orders.planLabel,
      amount: orders.amount,
      status: orders.status,
      createdAt: orders.createdAt,
    })
      .from(orders)
      .leftJoin(users, eq(users.id, orders.userId))
      .where(and(
        eq(orders.provider, MANUAL_PROVIDER),
        inArray(orders.status, [...QUEUE_STATUSES]),
        isNull(orders.refundedAt),
      ))
      .orderBy(desc(orders.createdAt))
      .limit(100);

    return NextResponse.json({
      ok: true,
      queue: rows.map((row) => ({
        id: row.id,
        reference: row.reference,
        email: row.email,
        productName: row.productName,
        // Never returned: the slug's source token and any supplier identity.
        quantity: quantityFromPlanLabel(row.planLabel),
        amountNgn: row.amount,
        status: row.status,
        warrantyDays: manualWarrantyDays(row.productSlug),
        createdAt: row.createdAt,
      })),
    });
  } catch (error) {
    logger.error("Failed to read the fulfilment queue", { error });
    return NextResponse.json({ error: "Failed to read the fulfilment queue" }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    const access = await authorizeAdminApi(request);
    if (access.response) return access.response;

    if (!isJsonRequest(request)) return NextResponse.json({ error: "Expected JSON" }, { status: 415 });

    let body: unknown;
    try {
      body = await readJsonWithLimit(request, BODY_LIMIT);
    } catch (error) {
      return NextResponse.json({ error: "Invalid request body" }, { status: error instanceof RequestBodyTooLargeError ? 413 : 400 });
    }
    if (!body || typeof body !== "object" || Array.isArray(body)) {
      return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
    }

    const { orderId, action, credentials, reason } = body as {
      orderId?: unknown;
      action?: unknown;
      credentials?: unknown;
      reason?: unknown;
    };

    if (typeof orderId !== "string" || !UUID.test(orderId)) {
      return NextResponse.json({ error: "A valid order ID is required" }, { status: 400 });
    }
    if (action !== "deliver" && action !== "unavailable") {
      return NextResponse.json({ error: "Unknown action" }, { status: 400 });
    }

    const [order] = await db.select({
      id: orders.id,
      reference: orders.reference,
      productSlug: orders.productSlug,
      planLabel: orders.planLabel,
      status: orders.status,
      provider: orders.provider,
      refundedAt: orders.refundedAt,
    }).from(orders).where(eq(orders.id, orderId)).limit(1);

    if (!order || order.provider !== MANUAL_PROVIDER || order.refundedAt) {
      return NextResponse.json({ error: "That order is not in the fulfilment queue" }, { status: 404 });
    }

    if (action === "unavailable") {
      if (typeof reason !== "string" || !reason.trim() || reason.trim().length > 180) {
        return NextResponse.json({ error: "A short reason is required so the customer and the refund record both make sense" }, { status: 400 });
      }
      const [moved] = await db.update(orders)
        .set({ status: "review" })
        .where(and(eq(orders.id, orderId), eq(orders.provider, MANUAL_PROVIDER), eq(orders.status, "processing"), isNull(orders.refundedAt)))
        .returning({ id: orders.id });
      if (!moved) {
        return NextResponse.json({ error: "That order has already been fulfilled or changed" }, { status: 409 });
      }
      logger.info("Hand-sourced order marked unavailable", { reference: order.reference });
      return NextResponse.json({
        ok: true,
        status: "review",
        // The refund itself stays on the audited endpoint, which needs the
        // reconciliation reason because a review order may already be spent.
        nextStep: "Refund it from the orders page with reconciliationConfirmed and this reason.",
      });
    }

    // action === "deliver"
    if (!Array.isArray(credentials) || credentials.length === 0 || credentials.length > MAX_ITEMS) {
      return NextResponse.json({ error: `Provide between 1 and ${MAX_ITEMS} credentials` }, { status: 400 });
    }
    const wanted = quantityFromPlanLabel(order.planLabel);
    if (credentials.length !== wanted) {
      return NextResponse.json({ error: `This order needs exactly ${wanted} credential${wanted === 1 ? "" : "s"}.` }, { status: 400 });
    }
    if (!credentials.every(isUsableCredential)) {
      return NextResponse.json({ error: "One or more credentials are empty, too long or contain control characters" }, { status: 400 });
    }

    const warrantyDays = manualWarrantyDays(order.productSlug);
    const expiresAt = warrantyDays && warrantyDays > 0
      ? new Date(Date.now() + warrantyDays * 24 * 60 * 60 * 1000)
      : null;

    const [saved] = await db.update(orders)
      .set({
        status: "delivered",
        accounts: JSON.stringify(credentials.map((value) => (value as string).trim())),
        expiresAt,
      })
      // Guarded on processing so two admins cannot both deliver the same order.
      .where(and(eq(orders.id, orderId), eq(orders.provider, MANUAL_PROVIDER), eq(orders.status, "processing"), isNull(orders.refundedAt)))
      .returning({ id: orders.id });

    if (!saved) {
      return NextResponse.json({ error: "That order has already been fulfilled or changed" }, { status: 409 });
    }

    // The count is logged; the credentials never are.
    logger.info("Hand-sourced order delivered", { reference: order.reference, items: credentials.length });
    return NextResponse.json({ ok: true, status: "delivered", items: credentials.length, warrantyDays });
  } catch (error) {
    logger.error("Failed to fulfil a hand-sourced order", { error });
    return NextResponse.json({ error: "Failed to fulfil that order" }, { status: 500 });
  }
}
