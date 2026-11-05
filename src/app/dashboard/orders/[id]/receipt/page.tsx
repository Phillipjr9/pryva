import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { orders } from "@/db/schema";
import { requireUser } from "@/lib/auth";
import { formatDateNigerian } from "@/lib/date-utils";
import { ArrowLeft, Download, FileText } from "@/components/icons";
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

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3 print:hidden">
        <Link
          href={`/dashboard/orders/${order.id}`}
          className="inline-flex items-center gap-1.5 text-meta font-semibold text-ink-2 hover:text-ink"
        >
          <ArrowLeft className="h-4 w-4" aria-hidden="true" />
          Back to the order
        </Link>
        <div className="flex flex-wrap items-center gap-2">
          <Link
            href={`/dashboard/orders/${order.id}`}
            className="inline-flex items-center gap-1.5 rounded-xl border border-line bg-white px-3 py-2.5 text-meta font-semibold text-ink-2 transition-colors hover:border-lav-300 hover:text-ink"
          >
            <FileText className="h-4 w-4" aria-hidden="true" />
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
        <Download className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden="true" />
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
          paidWith: "Wallet balance",
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
