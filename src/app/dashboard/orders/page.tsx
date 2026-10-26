import type { Metadata } from "next";
import Link from "next/link";
import { desc, eq } from "drizzle-orm";
import { db } from "@/db";
import { orders } from "@/db/schema";
import { requireUser } from "@/lib/auth";
import { formatNaira } from "@/lib/catalog";
import { ArrowRight, ArrowUpRight, Clock, Receipt, Shield, Sparkle } from "@/components/icons";

export const metadata: Metadata = { title: "Orders" };
export const dynamic = "force-dynamic";

function statusStyle(status: string) {
  switch (status) {
    case "active":
      return "bg-emerald-50 text-emerald-700";
    case "refunded":
      return "bg-amber-50 text-amber-700";
    default:
      return "bg-lav-50 text-lav-700";
  }
}

export default async function OrdersPage() {
  const user = await requireUser("/dashboard/orders");
  const rows = await db
    .select()
    .from(orders)
    .where(eq(orders.userId, user.id))
    .orderBy(desc(orders.createdAt));

  const active = rows.filter((order) => order.status === "active").length;

  return (
    <div className="grid gap-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-[1.5rem] font-medium tracking-tight">Orders</h1>
          <p className="mt-1 text-[0.86rem] text-ink-2">
            Every number, eSIM, proxy pack and inbox you&apos;ve bought — with codes kept safe.
          </p>
        </div>
        <Link href="/pricing" className="btn btn-primary !px-4 !py-2.5 !text-[0.78rem]">
          <Sparkle className="h-3.5 w-3.5" /> New order
        </Link>
      </div>

      <div className="flex flex-wrap gap-2 text-[0.72rem]">
        <span className="inline-flex items-center gap-1.5 rounded-full border border-line bg-white/70 px-3 py-1.5 text-ink-2">
          <Receipt className="h-3.5 w-3.5 text-lav-600" /> {rows.length} total
        </span>
        <span className="inline-flex items-center gap-1.5 rounded-full border border-line bg-white/70 px-3 py-1.5 text-ink-2">
          <Clock className="h-3.5 w-3.5 text-emerald-600" /> {active} active
        </span>
        <span className="inline-flex items-center gap-1.5 rounded-full border border-line bg-white/70 px-3 py-1.5 text-ink-2">
          <Shield className="h-3.5 w-3.5 text-lav-600" /> Auto-refund on every number order
        </span>
      </div>

      {rows.length === 0 ? (
        <div className="rounded-[1.5rem] border border-dashed border-line bg-[#fffdfa] p-10 text-center">
          <span className="mx-auto grid h-12 w-12 place-items-center rounded-full bg-lav-50 text-lav-700">
            <Receipt className="h-5 w-5" />
          </span>
          <h2 className="mt-4 text-[1.1rem] font-medium">No orders yet</h2>
          <p className="mx-auto mt-1.5 max-w-sm text-[0.84rem] text-ink-2">
            Your first purchase appears here instantly. Numbers start at ₦1,200 and temporary inboxes
            at ₦700.
          </p>
          <Link href="/pricing" className="btn btn-primary mt-5 !px-5 !py-3 !text-[0.8rem]">
            Browse pricing
            <ArrowRight className="h-3.5 w-3.5" />
          </Link>
        </div>
      ) : (
        <div className="overflow-hidden rounded-[1.5rem] border border-line bg-[#fffdfa]">
          <div className="hidden grid-cols-[1.6fr_0.9fr_0.7fr_0.6fr_0.4fr] gap-3 border-b border-line px-5 py-3 text-[0.64rem] font-semibold uppercase tracking-[0.14em] text-ink-3 md:grid">
            <span>Order</span>
            <span>Placed</span>
            <span>Amount</span>
            <span>Status</span>
            <span />
          </div>
          <div className="divide-y divide-line/80">
            {rows.map((order) => (
              <Link
                key={order.id}
                href={`/dashboard/orders/${order.id}`}
                className="grid gap-1.5 px-5 py-3.5 transition-colors hover:bg-lav-50/40 md:grid-cols-[1.6fr_0.9fr_0.7fr_0.6fr_0.4fr] md:items-center md:gap-3"
              >
                <div className="min-w-0">
                  <p className="truncate text-[0.87rem] font-semibold text-ink">
                    {order.productName}
                  </p>
                  <p className="truncate text-[0.7rem] text-ink-3">
                    {order.planLabel} · {order.reference}
                  </p>
                </div>
                <p className="text-[0.76rem] text-ink-2">
                  {new Date(order.createdAt).toLocaleDateString("en-NG", {
                    day: "numeric",
                    month: "short",
                    year: "numeric",
                  })}
                </p>
                <p className="text-[0.82rem] font-semibold text-ink">{formatNaira(order.amount)}</p>
                <span
                  className={`inline-flex w-fit items-center rounded-full px-2.5 py-1 text-[0.64rem] font-semibold capitalize ${statusStyle(order.status)}`}
                >
                  {order.status}
                </span>
                <span className="hidden justify-self-end text-ink-3 md:block">
                  <ArrowUpRight className="h-4 w-4" />
                </span>
              </Link>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
