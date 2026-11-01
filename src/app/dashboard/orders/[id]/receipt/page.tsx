import Link from "next/link";
import { notFound } from "next/navigation";
import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { orders } from "@/db/schema";
import { requireUser } from "@/lib/auth";
import { formatDateNigerian } from "@/lib/date-utils";
import { ArrowLeft } from "@/components/icons";
import { ReceiptBody } from "./ReceiptBody";
import { PrintButton } from "./PrintButton";

export const dynamic = "force-dynamic";

/**
 * A receipt the customer can keep.
 *
 * The wallet ledger has always been exportable as CSV/JSON, but a single order
 * had no document at all: the order page is a live screen (it polls, it changes
 * status, it holds the code and the activation credential), so it is the wrong
 * thing to hand a bank, an employer or a tax officer. This page is deliberately
 * static in content and safe to print: no credentials, no supplier, one amount.
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
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3 print:hidden">
        <Link href={`/dashboard/orders/${order.id}`} className="inline-flex items-center gap-1.5 text-meta font-semibold text-ink-2 hover:text-ink">
          <ArrowLeft className="h-4 w-4" aria-hidden="true" />
          Back to the order
        </Link>
        <PrintButton />
      </div>

      <ReceiptBody
        receipt={{
          reference: order.reference,
          productName: order.productName,
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
        }}
      />
    </div>
  );
}
