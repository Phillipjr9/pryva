import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { and, eq, inArray } from "drizzle-orm";
import { db } from "@/db";
import { orders, walletTransactions } from "@/db/schema";
import { requireUser } from "@/lib/identity/auth";
import { formatDateNigerian } from "@/lib/platform/date-utils";
import { receiptWalletSummary } from "@/lib/payments/receipt";

import { ReceiptBody } from "./ReceiptBody";
import { PrintButton } from "./PrintButton";

export const dynamic = "force-dynamic";

/** The browser's own tab and "Save as PDF" filename come from here. */
export async function generateMetadata({ params }: { params: Promise<{ id: string }> }): Promise<Metadata> {
  const { id } = await params;
  return {
    title: `Receipt · ${id.slice(0, 8).toUpperCase()}`,
    // A receipt is a private document: it must never be indexed or unfurled.
    robots: { index: false, follow: false },
  };
}

/**
 * A receipt the customer can keep.
 *
 * The wallet ledger has always been exportable as CSV/JSON, but a single order
 * had no document at all: the order page is a live screen (it polls, it changes
 * status, it holds the code and the activation credential), so it is the wrong
 * thing to hand a bank, an employer or a tax officer. This page is deliberately
 * static in content and safe to print: no credentials, no supplier, one amount.
 *
 * The screen version is the same DOM as the paper version -- one component, one
 * CSS file -- because a "print layout" maintained separately from the on-screen
 * one drifts on the first edit and nobody notices until an accountant does.
 */
export default async function OrderReceiptPage({ params }: { params: Promise<{ id: string }> }) {
  const user = await requireUser("/dashboard/orders");
  const { id } = await params;

  const [order] = await db
    .select()
    .from(orders)
    .where(and(eq(orders.id, id), eq(orders.userId, user.id)))
    .limit(1);
  if (!order) notFound();

  // The order amount can be a quote on a cancelled or review-stage attempt.
  // Read the owner's actual wallet entries rather than inferring a debit/refund
  // from the order status. Three rows already mean the record needs review.
  const ledger = await db.select({ type: walletTransactions.type, amount: walletTransactions.amount })
    .from(walletTransactions)
    .where(and(
      eq(walletTransactions.userId, user.id),
      eq(walletTransactions.orderId, order.id),
      inArray(walletTransactions.type, ["debit", "refund"]),
    ))
    .limit(3);
  const wallet = receiptWalletSummary(order, ledger);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3 print:hidden">
        <Link
          href={`/dashboard/orders/${order.id}`}
          className="inline-flex items-center gap-1.5 text-meta font-semibold text-ink-2 hover:text-ink"
        >

          Back to the order
        </Link>
        <div className="flex flex-wrap items-center gap-2">
          <Link
            href={`/dashboard/orders/${order.id}`}
            className="inline-flex items-center gap-1.5 rounded-xl border border-line bg-white px-3 py-2.5 text-meta font-semibold text-ink-2 transition-colors hover:border-lav-300 hover:text-ink"
          >

            Order details
          </Link>
          <PrintButton />
        </div>
      </div>

      {/*
        A hint, not a control: the button above hands the browser's own print
        dialogue the document, and "Save as PDF" lives in that dialogue. Naming
        it here is what makes the download discoverable without a second code
        path that could produce a *different* file from the printed one.
      */}
      <p className="flex items-start gap-2 text-meta leading-relaxed text-ink-3 print:hidden">

        <span>
          Choose &ldquo;Save as PDF&rdquo; as the destination to keep a copy. The printed sheet carries the
          same reference as this one.
        </span>
      </p>

      <ReceiptBody
        receipt={{
          reference: order.reference,
          productName: order.productName,
          service: order.service,
          planLabel: order.planLabel,
          region: order.region,
          duration: order.duration,
          amount: order.amount,
          status: order.status,
          createdAt: formatDateNigerian(order.createdAt, { includeTime: true }),
          wallet,
          customerName: user.name,
          customerEmail: user.email,
          refundedAt: order.refundedAt ? formatDateNigerian(order.refundedAt, { includeTime: true }) : null,
          targetLink: order.targetLink,
          quantity: order.quantity,
          generatedAt: formatDateNigerian(new Date(), { includeTime: true }),
        }}
      />
    </div>
  );
}
