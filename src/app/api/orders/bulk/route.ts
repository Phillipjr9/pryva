import { randomUUID } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { requireAuthApi } from "@/lib/auth";
import { isPreviewDatabase } from "@/lib/demo-policy";
import { db, mutatePreviewDatabase } from "@/db";
import { orders, users } from "@/db/schema";
import { eq } from "drizzle-orm";
import { calculateBulkOrder, expandBulkOrder, type BulkOrderItem } from "@/lib/bulk-orders";
import { findPlan } from "@/lib/catalog";
import { debitWalletInTx, InsufficientFundsError, makeReference } from "@/lib/wallet";
import { isSameOriginMutation } from "@/lib/net";
import { isJsonRequest, readJsonWithLimit, RequestBodyTooLargeError } from "@/lib/request-body";
import { purchaseRateLimiter } from "@/lib/rate-limit";
import { scheduleWalletEmails } from "@/lib/schedule-wallet-emails";

export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  const user = await requireAuthApi();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  if (!isSameOriginMutation(request)) {
    return NextResponse.json({ error: "Invalid origin" }, { status: 403 });
  }

  if (!isJsonRequest(request)) {
    return NextResponse.json({ error: "Expected JSON" }, { status: 415 });
  }

  const limit = await purchaseRateLimiter(`bulk-create:${user.id}`);
  if (limit.unavailable) return NextResponse.json({ error: "Bulk orders are temporarily unavailable." }, { status: 503 });
  if (!limit.allowed) return NextResponse.json({ error: "Too many attempts. Try again later." }, { status: 429 });

  let body: unknown;
  try {
    body = await readJsonWithLimit(request, 16_384);
  } catch (error) {
    return NextResponse.json(
      { error: "Invalid request body" },
      { status: error instanceof RequestBodyTooLargeError ? 413 : 400 },
    );
  }

  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return NextResponse.json({ error: "Invalid request" }, { status: 400 });
  }

  const rawItems = (body as { items?: unknown }).items;
  if (!Array.isArray(rawItems) || rawItems.length === 0 || rawItems.length > 200) {
    return NextResponse.json({ error: "A basket must contain between 1 and 200 items" }, { status: 400 });
  }

  const bulkItems: BulkOrderItem[] = [];
  for (const item of rawItems) {
    if (!item || typeof item !== "object" || typeof (item as any).productSlug !== "string" || !Number.isInteger((item as any).quantity) || (item as any).quantity <= 0) {
      return NextResponse.json({ error: "Invalid item in bulk order" }, { status: 400 });
    }
    bulkItems.push({
      productSlug: (item as any).productSlug,
      quantity: (item as any).quantity,
    });
  }

  let calculated;
  try {
    calculated = calculateBulkOrder(bulkItems);
  } catch (error: any) {
    return NextResponse.json({ error: error?.message || "Invalid bulk calculation" }, { status: 400 });
  }

  const units = expandBulkOrder(calculated);
  const now = new Date();

  if (isPreviewDatabase()) {
    try {
      const result = mutatePreviewDatabase((draft) => {
        const account = draft.users.find((u) => u.id === user.id);
        if (!account || !Number.isSafeInteger(account.walletBalance) || (account.walletBalance as number) < calculated.total) {
          throw new InsufficientFundsError((account?.walletBalance as number) ?? 0, calculated.total);
        }
        const newBalance = (account.walletBalance as number) - calculated.total;
        const batchReference = makeReference("BLK");

        for (const unit of units) {
          const plan = findPlan(unit.productSlug);
          if (!plan) continue;
          const orderId = randomUUID();
          const ref = makeReference("PRY");
          draft.orders.push({
            id: orderId,
            reference: ref,
            userId: user.id,
            service: plan.service,
            productSlug: plan.slug,
            productName: plan.name,
            planLabel: plan.planLabel,
            region: plan.region,
            duration: plan.duration,
            amount: unit.amount,
            status: "delivered",
            provider: "manual",
            createdAt: now,
          });
        }

        draft.walletTransactions.push({
          id: randomUUID(),
          userId: user.id,
          type: "debit",
          amount: calculated.total,
          balanceAfter: newBalance,
          description: `Bulk purchase: ${units.length} items`,
          reference: batchReference,
          createdAt: now,
        });

        account.walletBalance = newBalance;
        return { balance: newBalance, count: units.length, reference: batchReference };
      });

      return NextResponse.json({ ok: true, ...result });
    } catch (err: any) {
      if (err instanceof InsufficientFundsError) {
        return NextResponse.json({ error: `Your wallet balance is ₦${err.balance.toLocaleString("en-NG")} — top up to continue.` }, { status: 402 });
      }
      return NextResponse.json({ error: "Failed to process bulk order" }, { status: 500 });
    }
  }

  try {
    const outcome = await db.transaction(async (tx: any) => {
      const [account] = await tx
        .select({ walletBalance: users.walletBalance })
        .from(users)
        .where(eq(users.id, user.id))
        .limit(1);

      if (!account || account.walletBalance < calculated.total) {
        throw new InsufficientFundsError(account?.walletBalance ?? 0, calculated.total);
      }

      const batchReference = makeReference("BLK");

      for (const unit of units) {
        const plan = findPlan(unit.productSlug);
        if (!plan) continue;
        const orderId = randomUUID();
        const ref = makeReference("PRY");
        await tx.insert(orders).values({
          id: orderId,
          reference: ref,
          userId: user.id,
          service: plan.service,
          productSlug: plan.slug,
          productName: plan.name,
          planLabel: plan.planLabel,
          region: plan.region,
          duration: plan.duration,
          amount: unit.amount,
          status: "delivered",
          provider: "manual",
          createdAt: now,
        });
      }

      const balance = await debitWalletInTx(tx, {
        userId: user.id,
        amount: calculated.total,
        type: "debit",
        description: `Bulk purchase: ${units.length} items`,
        reference: batchReference,
      });

      return { balance, count: units.length, reference: batchReference };
    });

    scheduleWalletEmails();
    return NextResponse.json({ ok: true, ...outcome });
  } catch (error: any) {
    if (error instanceof InsufficientFundsError) {
      return NextResponse.json({ error: `Your wallet balance is ₦${error.balance.toLocaleString("en-NG")} — top up to continue.` }, { status: 402 });
    }
    console.error("Bulk purchase failed", error);
    return NextResponse.json({ error: "Failed to complete bulk purchase" }, { status: 500 });
  }
}
