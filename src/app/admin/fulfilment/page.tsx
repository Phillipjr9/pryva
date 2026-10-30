import Link from "next/link";
import { requireAdmin } from "@/lib/auth";
import { db } from "@/db";
import { orders, users } from "@/db/schema";
import { and, desc, eq, inArray, isNull } from "drizzle-orm";
import { FulfilmentControl } from "./FulfilmentControl";
import { MANUAL_PROVIDER, QUEUE_STATUSES, quantityFromPlanLabel } from "@/lib/fulfilment-queue";
import { manualWarrantyDays, readManualCatalog } from "@/lib/manual-catalog";
import { formatNaira } from "@/lib/catalog";
import { warrantyLabel } from "@/lib/warranty";

export const dynamic = "force-dynamic";

function formatWhen(value: Date | string) {
  const date = typeof value === "string" ? new Date(value) : value;
  return date.toLocaleString("en-NG", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

/**
 * Hand-sourced fulfilment queue.
 *
 * Products with no supplier API are sold like everything else, then wait here:
 * the customer has already paid, so an order sitting in this list is a promise
 * outstanding. Oldest first, with the count each order needs, because delivering
 * the wrong number of credentials is the easiest mistake to make on this screen.
 */
export default async function AdminFulfilmentPage() {
  await requireAdmin("/admin/fulfilment");

  const rows = await db
    .select({
      id: orders.id,
      reference: orders.reference,
      productName: orders.productName,
      productSlug: orders.productSlug,
      planLabel: orders.planLabel,
      amount: orders.amount,
      status: orders.status,
      createdAt: orders.createdAt,
      email: users.email,
      userName: users.name,
    })
    .from(orders)
    .leftJoin(users, eq(users.id, orders.userId))
    .where(and(
      eq(orders.provider, MANUAL_PROVIDER),
      inArray(orders.status, [...QUEUE_STATUSES]),
      isNull(orders.refundedAt),
    ))
    // Oldest first: the longest-standing promise is the one most overdue.
    .orderBy(orders.createdAt)
    .limit(100);

  const catalog = readManualCatalog();
  const waiting = rows.filter((row) => row.status === "processing").length;
  const blocked = rows.length - waiting;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-[1.5rem] font-medium tracking-tight">Fulfilment queue</h1>
          <p className="mt-1 text-[0.86rem] text-ink-2">
            {rows.length.toLocaleString("en-NG")} {rows.length === 1 ? "order" : "orders"} need a hand
            {waiting ? ` · ${waiting} waiting for credentials` : ""}
            {blocked ? ` · ${blocked} could not be sourced` : ""}
          </p>
        </div>
        <div className="rounded-xl border border-line bg-white px-4 py-2 text-right">
          <p className="text-meta uppercase tracking-wide text-ink-3">Catalog items</p>
          <p className="text-[1rem] font-semibold text-ink">
            {catalog.filter((item) => item.available).length} live of {catalog.length}
          </p>
        </div>
      </div>

      <p className="rounded-xl border border-line bg-white px-4 py-3 text-[0.8rem] leading-relaxed text-ink-2">
        These items are prepared by hand, so every order here is already paid for. Paste one credential
        per line — the count must match the order exactly — or move it to review and refund it from the{" "}
        <Link href="/admin/orders" className="font-medium text-lav-700 underline underline-offset-2">orders page</Link>{" "}
        with a reconciliation reason. Credentials are never written to logs.
      </p>

      <div className="grid gap-3">
        {rows.length === 0 && (
          <p className="rounded-2xl border border-dashed border-line bg-white px-4 py-10 text-center text-[0.86rem] text-ink-2">
            Nothing waiting. Orders for hand-prepared items appear here as soon as they are paid for.
          </p>
        )}

        {rows.map((row) => {
          const quantity = quantityFromPlanLabel(row.planLabel);
          const warranty = manualWarrantyDays(row.productSlug);
          return (
            <article key={row.id} className="rounded-2xl border border-line bg-white p-4">
              <div className="grid min-w-0 gap-3 lg:grid-cols-[minmax(0,1fr)_minmax(0,26rem)]">
                <div className="min-w-0">
                  <p className="flex flex-wrap items-center gap-2 text-[0.92rem] font-semibold text-ink">
                    <span className="min-w-0 break-words">{row.productName}</span>
                    <span
                      className={
                        row.status === "processing"
                          ? "rounded-full bg-amber-50 px-2 py-0.5 text-micro font-semibold text-amber-800"
                          : "rounded-full bg-rose-50 px-2 py-0.5 text-micro font-semibold text-rose-700"
                      }
                    >
                      {row.status === "processing" ? "Needs credentials" : "Could not source"}
                    </span>
                  </p>
                  <dl className="mt-2 grid min-w-0 grid-cols-1 gap-x-6 gap-y-1 text-meta text-ink-2 sm:grid-cols-2">
                    <div className="flex min-w-0 gap-1">
                      <dt className="shrink-0 text-ink-3">Order</dt>
                      <dd className="min-w-0 break-all font-mono">{row.reference}</dd>
                    </div>
                    <div className="flex min-w-0 gap-1">
                      <dt className="shrink-0 text-ink-3">Units</dt>
                      <dd className="font-semibold text-ink">{quantity}</dd>
                    </div>
                    <div className="flex min-w-0 gap-1">
                      <dt className="shrink-0 text-ink-3">Paid</dt>
                      <dd>{formatNaira(row.amount)}</dd>
                    </div>
                    <div className="flex min-w-0 gap-1">
                      <dt className="shrink-0 text-ink-3">Placed</dt>
                      <dd>{formatWhen(row.createdAt)}</dd>
                    </div>
                    <div className="flex min-w-0 gap-1">
                      <dt className="shrink-0 text-ink-3">Warranty</dt>
                      <dd>{warrantyLabel(warranty) ?? "None set"}</dd>
                    </div>
                    <div className="flex min-w-0 gap-1">
                      <dt className="shrink-0 text-ink-3">Customer</dt>
                      <dd className="min-w-0 break-all">
                        {row.email
                          ? <a href={`mailto:${row.email}`} className="text-lav-700 underline underline-offset-2">{row.email}</a>
                          : "—"}
                      </dd>
                    </div>
                  </dl>
                </div>
                <div className="min-w-0">
                  <FulfilmentControl
                    orderId={row.id}
                    reference={row.reference}
                    quantity={quantity}
                    status={row.status}
                  />
                </div>
              </div>
            </article>
          );
        })}
      </div>
    </div>
  );
}
