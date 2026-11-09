import { and, eq, isNull, sql } from "drizzle-orm";
import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { adminAuditLog, orders, walletTransactions } from "@/db/schema";
import { authorizeAdminApi } from "@/lib/identity/admin-auth";
import { isVercelPreview } from "@/lib/platform/financial-environment";
import { isSameOriginMutation } from "@/lib/platform/net";
import { isJsonRequest, readJsonWithLimit } from "@/lib/platform/request-body";
import { creditWalletInTx, makeReference } from "@/lib/payments/wallet";
import { scheduleWalletEmails } from "@/lib/email/schedule-wallet-emails";

export const dynamic = "force-dynamic";
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const UNATTEMPTED = "Bulk unit reserved; provider not yet contacted.";

/** Only a persisted pre-provider claim can be refunded here. Attempted or
 * ambiguous units require separate provider reconciliation, never this path. */
export async function POST(request: NextRequest) {
  if (!isSameOriginMutation(request)) return NextResponse.json({ error: "Invalid origin" }, { status: 403 });
  const access = await authorizeAdminApi(request);
  if (access.response) return access.response;
  if (isVercelPreview()) return NextResponse.json({ error: "Unavailable in preview" }, { status: 503 });
  if (!isJsonRequest(request)) return NextResponse.json({ error: "Expected JSON" }, { status: 415 });
  let body: unknown;
  try { body = await readJsonWithLimit(request, 2048); }
  catch { return NextResponse.json({ error: "Invalid request" }, { status: 400 }); }
  if (!body || typeof body !== "object" || Array.isArray(body)) return NextResponse.json({ error: "Invalid request" }, { status: 400 });
  const { orderId, reason } = body as { orderId?: unknown; reason?: unknown };
  if (typeof orderId !== "string" || !UUID.test(orderId) || typeof reason !== "string" || reason.trim().length < 10 || reason.length > 200) {
    return NextResponse.json({ error: "A valid order and a reason of at least 10 characters are required." }, { status: 400 });
  }
  try {
    const result = await db.transaction(async (tx) => {
      // The exact pre-boundary note and conditional update prevent racing the
      // paid-call boundary; if that boundary wins, this refund cannot proceed.
      const [order] = await tx.update(orders).set({ status: "refunded", refundedAt: new Date(), reconciliationNote: "Unattempted bulk unit refunded by an administrator." })
        .where(and(eq(orders.id, orderId), eq(orders.status, "processing"), eq(orders.reconciliationNote, UNATTEMPTED), isNull(orders.providerRequestId), isNull(orders.refundedAt), sql`${orders.requestIntent} LIKE 'bulk:%'`)).returning();
      if (!order) return false;
      const debits = await tx.select({ amount: walletTransactions.amount }).from(walletTransactions)
        .where(and(eq(walletTransactions.orderId, order.id), eq(walletTransactions.userId, order.userId), eq(walletTransactions.type, "debit")));
      if (debits.length !== 1 || debits[0].amount !== order.amount) throw new Error("Matching debit required");
      await creditWalletInTx(tx, { userId: order.userId, orderId: order.id, amount: order.amount, type: "refund", description: "Refund for unattempted bulk unit", reference: makeReference("RFB") });
      await tx.insert(adminAuditLog).values({ actorId: access.user.id, actorEmail: access.user.email, action: "order.refund", targetType: "order", targetId: order.id, summary: `Refunded unattempted bulk unit ₦${order.amount} — ${reason.trim()}` });
      return true;
    });
    if (!result) return NextResponse.json({ error: "This unit is not provably unattempted or is already settled. Reconcile it before acting." }, { status: 409 });
    scheduleWalletEmails();
    return NextResponse.json({ ok: true });
  } catch {
    return NextResponse.json({ error: "Could not confirm the refund. Check the order and ledger before retrying." }, { status: 500 });
  }
}
