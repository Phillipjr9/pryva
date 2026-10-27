import { isPreviewDatabase } from "@/lib/demo-policy";
import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { orders } from "@/db/schema";
import { requireAuthApi } from "@/lib/auth";
import { calculateBulkOrder, type BulkOrderItem } from "@/lib/bulk-orders";
import { purchaseRateLimiter } from "@/lib/rate-limit";
import {
  InsufficientFundsError,
  creditWallet,
  debitWallet,
  makeReference,
} from "@/lib/wallet";
import { logger } from "@/lib/logger";

export const dynamic = "force-dynamic";

const MAX_ITEMS = 50;
const MAX_UNITS = 200;

/**
 * POST /api/orders/bulk  { items: [{ productSlug, quantity }] }
 *
 * One debit for the whole basket (atomic), then the individual order rows. If
 * anything fails after the money moves, the whole basket is refunded — a bulk
 * order is all-or-nothing, never half-delivered and half-charged.
 */
export async function POST(request: NextRequest) {
  try {
    const user = await requireAuthApi();
    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const limit = await purchaseRateLimiter(`bulk:${user.id}`);
    if (!limit.allowed) {
      const seconds = Math.max(1, Math.ceil((limit.resetTime - Date.now()) / 1000));
      return NextResponse.json(
        { error: `Too many attempts. Try again in ${seconds}s.` },
        { status: 429 },
      );
    }

    // Provider fulfilment isn't wired yet; only the preview database may sell.
    if (!isPreviewDatabase()) {
      return NextResponse.json(
        { error: "Bulk purchases are temporarily unavailable." },
        { status: 503 },
      );
    }

    const body = (await request.json()) as { items?: unknown };
    const items = body.items;

    if (!Array.isArray(items) || items.length === 0) {
      return NextResponse.json({ error: "Add at least one item." }, { status: 400 });
    }
    if (items.length > MAX_ITEMS) {
      return NextResponse.json({ error: `Up to ${MAX_ITEMS} different items per order.` }, { status: 400 });
    }

    const units = (items as BulkOrderItem[]).reduce(
      (sum, item) => sum + (Number.isInteger(item?.quantity) ? item.quantity : 0),
      0,
    );
    if (units <= 0 || units > MAX_UNITS) {
      return NextResponse.json(
        { error: `Quantities must total between 1 and ${MAX_UNITS}.` },
        { status: 400 },
      );
    }

    const result = calculateBulkOrder(items as BulkOrderItem[]);
    if (!Number.isFinite(result.total) || result.total <= 0) {
      return NextResponse.json({ error: "That basket has no valid items." }, { status: 400 });
    }

    const reference = makeReference("BULK");

    try {
      await debitWallet({
        userId: user.id,
        amount: result.total,
        type: "debit",
        description: `Bulk order (${result.discountPercent}% off)`.slice(0, 200),
        reference,
      });
    } catch (error) {
      if (error instanceof InsufficientFundsError) {
        return NextResponse.json(
          {
            error: "Insufficient wallet balance.",
            balance: error.balance,
            required: error.required,
          },
          { status: 402 },
        );
      }
      throw error;
    }

    try {
      for (const item of result.items) {
        for (let i = 0; i < item.quantity; i++) {
          await db.insert(orders).values({
            reference: makeReference("BLK"),
            userId: user.id,
            service: "bulk",
            productSlug: item.productSlug,
            productName: item.productName,
            planLabel: `Bulk order (${result.discountPercent}% off)`,
            region: "Nigeria",
            duration: "Bulk purchase",
            amount: item.unitPrice,
            status: "delivered",
            provider: "bulk",
          });
        }
      }
    } catch (error) {
      logger.error("Bulk order rows failed — refunding the basket", {
        reference,
        userId: user.id,
        error: error instanceof Error ? error.message : String(error),
      });
      await creditWallet({
        userId: user.id,
        amount: result.total,
        type: "refund",
        description: `Refund — bulk order ${reference}`,
        reference: makeReference("RFD"),
      });
      return NextResponse.json(
        { error: "We couldn't complete that bulk order. Your wallet has been refunded.", refunded: true },
        { status: 500 },
      );
    }

    logger.info("Bulk order completed", {
      reference,
      userId: user.id,
      total: result.total,
      units,
    });

    return NextResponse.json({
      ok: true,
      reference,
      subtotal: result.subtotal,
      discount: result.discount,
      discountPercent: result.discountPercent,
      total: result.total,
    });
  } catch (error) {
    logger.error("Bulk order failed", {
      error: error instanceof Error ? error.message : String(error),
    });
    return NextResponse.json({ error: "That order could not be completed." }, { status: 500 });
  }
}
