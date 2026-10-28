import { randomUUID } from "node:crypto";
import { isPreviewDatabase } from "@/lib/demo-policy";
import { NextRequest, NextResponse } from "next/server";
import { mutatePreviewDatabase } from "@/db";
import { requireAuthApi } from "@/lib/auth";
import { calculateBulkOrder, expandBulkOrder, type BulkOrderItem } from "@/lib/bulk-orders";
import { purchaseRateLimiter } from "@/lib/rate-limit";
import { findPlan } from "@/lib/catalog";
import { demoPlanUnits } from "@/lib/demo-service-catalog";
import { expiryForPlan, provisionPlan } from "@/lib/provision";
import { isSameOriginMutation } from "@/lib/net";
import { isJsonRequest, readJsonWithLimit, RequestBodyTooLargeError } from "@/lib/request-body";
import {
  InsufficientFundsError,
  makeReference,
} from "@/lib/wallet";
import { logger } from "@/lib/logger";

export const dynamic = "force-dynamic";

const MAX_ITEMS = 50;
const MAX_UNITS = 200;

/**
 * POST /api/orders/bulk  { items: [{ productSlug, quantity }] }
 *
 * Preview only: commit the simulated debit, ledger and order rows together in
 * a synchronous copy-on-write mutation. Live bulk purchasing remains disabled.
 */
export async function POST(request: NextRequest) {
  try {
    const user = await requireAuthApi();
    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    if (!isSameOriginMutation(request)) return NextResponse.json({ error: "Invalid origin." }, { status: 403 });
    if (!isJsonRequest(request)) return NextResponse.json({ error: "Expected JSON." }, { status: 415 });

    const limit = await purchaseRateLimiter(`bulk:${user.id}`);
    if (limit.unavailable) return NextResponse.json({ error: "Purchases are temporarily unavailable." }, { status: 503 });
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

    let body: unknown;
    try {
      body = await readJsonWithLimit(request, 16_384);
    } catch (error) {
      return NextResponse.json({ error: "Invalid basket." }, { status: error instanceof RequestBodyTooLargeError ? 413 : 400 });
    }
    const items = body && typeof body === "object" && !Array.isArray(body) ? (body as { items?: unknown }).items : undefined;

    if (!Array.isArray(items) || items.length === 0) {
      return NextResponse.json({ error: "Add at least one item." }, { status: 400 });
    }
    if (items.length > MAX_ITEMS) {
      return NextResponse.json({ error: `Up to ${MAX_ITEMS} different items per order.` }, { status: 400 });
    }

    const allowedServices = new Set(["numbers", "esim", "proxies", "email-otp"]);
    if (items.some((item) => {
      if (!item || typeof item !== "object" || Array.isArray(item) || typeof item.productSlug !== "string" || item.productSlug.length > 80 || !Number.isSafeInteger(item.quantity) || item.quantity < 1 || item.quantity > MAX_UNITS) return true;
      const plan = findPlan(item.productSlug);
      return !plan || !allowedServices.has(plan.service);
    })) return NextResponse.json({ error: "Every basket item must have a valid product and positive whole quantity." }, { status: 400 });
    const units = (items as BulkOrderItem[]).reduce((sum, item) => sum + item.quantity, 0);
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
    const unitsToCreate = expandBulkOrder(result);
    const now = new Date();

    try {
      mutatePreviewDatabase((draft) => {
        const account = draft.users.find((row) => row.id === user.id);
        if (!account || !Number.isSafeInteger(account.walletBalance)) throw new Error("Preview wallet not found");
        const balance = account.walletBalance as number;
        if (balance < result.total) throw new InsufficientFundsError(balance, result.total);
        const newBalance = balance - result.total;
        const createdOrders = unitsToCreate.map((item) => {
          const plan = findPlan(item.productSlug);
          if (!plan) throw new Error("Invalid demo plan");
          const simulated = provisionPlan(plan);
          return {
            id: randomUUID(), reference: makeReference("BLK"), userId: user.id, service: plan.service,
            productSlug: item.productSlug, productName: item.productName,
            planLabel: `Demo bulk · ${plan.planLabel} (${result.discountPercent}% off)`,
            region: plan.region, duration: plan.duration, amount: item.amount, status: "active", provider: "simulated",
            providerRequestId: null, referenceCode: simulated.referenceCode, otpCode: simulated.otpCode, accounts: null,
            expiresAt: expiryForPlan(plan), refundedAt: null, createdAt: now,
            demoUnitsPurchased: demoPlanUnits(plan.slug), demoUnitsRemaining: demoPlanUnits(plan.slug),
          };
        });
        draft.orders.push(...createdOrders);
        draft.walletTransactions.push({
          id: randomUUID(), userId: user.id, orderId: null, type: "debit",
          amount: result.total, balanceAfter: newBalance,
          description: `Bulk order (${result.discountPercent}% off)`, reference, createdAt: now,
        });
        account.walletBalance = newBalance;
      });
    } catch (error) {
      if (error instanceof InsufficientFundsError) {
        return NextResponse.json({ error: "Insufficient wallet balance.", balance: error.balance, required: error.required }, { status: 402 });
      }
      throw error;
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
