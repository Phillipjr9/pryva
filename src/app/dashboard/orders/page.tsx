import type { Metadata } from "next";
import Link from "next/link";
import { desc, eq } from "drizzle-orm";
import { db } from "@/db";
import { orders } from "@/db/schema";
import { requireUser } from "@/lib/auth";
import { formatNaira, serviceMap } from "@/lib/catalog";
import { ArrowRight, ArrowUpRight, Clock, Receipt, Search, Sparkle } from "@/components/icons";
import { EmptyState } from "@/components/dashboard/EmptyState";

export const metadata: Metadata = { title: "Orders" };
export const dynamic = "force-dynamic";

type OrderRow = {
  id: string;
  reference: string;
  productName: string;
  planLabel: string;
  region: string | null;
  amount: number;
  status: string;
  otpCode: string | null;
  expiresAt: Date | string | null;
  createdAt: Date | string;
};

const statusStyles: Record<string, string> = {
  active: "bg-emerald-50 text-emerald-700",
  refunded: "bg-amber-50 text-amber-700",
  expired: "bg-ink/5 text-ink-2",
};

function statusStyle(status: string) {
  return statusStyles[status] ?? "bg-lav-50 text-lav-700";
}

function monthLabel(date: Date) {
  return date.toLocaleDateString("en-NG", { month: "long", year: "numeric" });
}

function dayLabel(date: Date) {
  return date.toLocaleDateString("en-NG", { day: "numeric", month: "short" });
}

export default async function OrdersPage({
  searchParams,
}: {
  searchParams: Promise<{ status?: string; q?: string }>;
}) {
  const user = await requireUser("/dashboard/orders");
  const { status = "all", q = "" } = await searchParams;

  const rows = (await db
    .select()
    .from(orders)
    .where(eq(orders.userId, user.id))
    .orderBy(desc(orders.createdAt))) as unknown as OrderRow[];

  const query = q.trim().toLowerCase();
  const matches = rows.filter((order) => {
    if (status !== "all" && order.status !== status) return false;
    if (!query) return true;
    return [order.productName, order.planLabel, order.reference, order.region ?? ""]
      .join(" ")
      .toLowerCase()
      .includes(query);
  });

  const activeCount = rows.filter((order) => order.status === "active").length;
  const refundedCount = rows.filter((order) => order.status === "refunded").length;

  // Group by month so a long history reads as a timeline instead of one wall.
  const grouped = matches.reduce<Array<{ label: string; items: OrderRow[] }>>((acc, order) => {
    const label = monthLabel(new Date(order.createdAt));
    const bucket = acc.find((entry) => entry.label === label);
    if (bucket) bucket.items.push(order);
    else acc.push({ label, items: [order] });
    return acc;
  }, []);

  const filters = [
    { key: "all", label: `All (${rows.length})` },
    { key: "active", label: `Active (${activeCount})` },
    { key: "refunded", label: `Refunded (${refundedCount})` },
  ];

  const hrefFor = (nextStatus: string) => {
    const params = new URLSearchParams();
    if (nextStatus !== "all") params.set("status", nextStatus);
    if (query) params.set("q", q.trim());
    const qs = params.toString();
    return qs ? `/dashboard/orders?${qs}` : "/dashboard/orders";
  };

  return (
    <div className="grid gap-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-[1.5rem] font-medium tracking-tight sm:text-[1.7rem]">Orders</h1>
          <p className="mt-1 text-[0.86rem] text-ink-2">
            Every number, eSIM, proxy pack and inbox you&apos;ve bought — with codes kept safe.
          </p>
        </div>
        <Link href="/pricing" className="btn btn-primary !px-4 !py-2.5 !text-[0.78rem]">
          <Sparkle className="h-3.5 w-3.5" /> New order
        </Link>
      </div>

      {rows.length > 0 && (
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex flex-wrap gap-1.5">
            {filters.map((filter) => {
              const active = status === filter.key;
              return (
                <Link
                  key={filter.key}
                  href={hrefFor(filter.key)}
                  aria-current={active ? "page" : undefined}
                  className={`rounded-full border px-3 py-1.5 text-[0.74rem] font-semibold transition-colors ${
                    active
                      ? "border-ink bg-ink text-white"
                      : "border-line bg-white/70 text-ink-2 hover:border-lav-200"
                  }`}
                >
                  {filter.label}
                </Link>
              );
            })}
          </div>
          <form action="/dashboard/orders" className="relative w-full sm:w-64">
            {status !== "all" && <input type="hidden" name="status" value={status} />}
            <Search className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-ink-3" />
            <input
              type="search"
              name="q"
              defaultValue={q}
              placeholder="Search reference or product"
              aria-label="Search orders"
              className="w-full rounded-full border border-line bg-white py-2 pl-9 pr-3 text-[0.78rem] text-ink outline-none placeholder:text-ink-3 focus:border-lav-300"
            />
          </form>
        </div>
      )}

      {rows.length === 0 ? (
        <EmptyState
          icon={Receipt}
          title="No orders yet"
          body={`Your first purchase appears here instantly, with its code and timer. Numbers start at ${formatNaira(serviceMap.numbers.fromPrice)} and temporary inboxes at ${formatNaira(serviceMap["email-otp"].fromPrice)}.`}
          action={{ label: "Browse pricing", href: "/pricing" }}
        />
      ) : matches.length === 0 ? (
        <EmptyState
          icon={Search}
          title="Nothing matches that"
          body={`No ${status === "all" ? "" : `${status} `}orders match “${q.trim()}”. Try the reference number or a product name.`}
          action={{ label: "Clear filters", href: "/dashboard/orders" }}
        />
      ) : (
        <div className="grid gap-5">
          {grouped.map((group) => (
            <section key={group.label} className="grid gap-2">
              <h2 className="px-1 text-[0.64rem] font-semibold uppercase tracking-[0.16em] text-ink-3">
                {group.label}
              </h2>
              <div className="overflow-hidden rounded-[1.5rem] border border-line bg-[#fffdfa]">
                <div className="hidden grid-cols-[1.6fr_0.9fr_0.7fr_0.6fr_0.3fr] gap-3 border-b border-line px-5 py-3 text-[0.64rem] font-semibold uppercase tracking-[0.14em] text-ink-3 md:grid">
                  <span>Order</span>
                  <span>Placed</span>
                  <span>Amount</span>
                  <span>Status</span>
                  <span />
                </div>
                <div className="divide-y divide-line/80">
                  {group.items.map((order) => {
                    const expires = order.expiresAt ? new Date(order.expiresAt) : null;
                    const live = expires && expires.getTime() > Date.now();
                    return (
                      <Link
                        key={order.id}
                        href={`/dashboard/orders/${order.id}`}
                        className="grid gap-1.5 px-4 py-3.5 transition-colors hover:bg-lav-50/40 md:grid-cols-[1.6fr_0.9fr_0.7fr_0.6fr_0.3fr] md:items-center md:gap-3 md:px-5"
                      >
                        <div className="min-w-0">
                          <p className="truncate text-[0.87rem] font-semibold text-ink">
                            {order.productName}
                          </p>
                          <p className="truncate text-[0.7rem] text-ink-3">
                            {order.planLabel} · {order.reference}
                          </p>
                        </div>
                        <div className="flex items-center justify-between gap-2 md:block">
                          <p className="text-[0.76rem] text-ink-2">{dayLabel(new Date(order.createdAt))}</p>
                          <p className="text-[0.82rem] font-semibold text-ink md:hidden">
                            <span className="tnum">{formatNaira(order.amount)}</span>
                          </p>
                        </div>
                        <p className="hidden text-[0.82rem] font-semibold text-ink md:block">
                          <span className="tnum">{formatNaira(order.amount)}</span>
                        </p>
                        <div className="flex items-center gap-2">
                          <span
                            className={`inline-flex w-fit items-center rounded-full px-2.5 py-1 text-[0.64rem] font-semibold capitalize ${statusStyle(order.status)}`}
                          >
                            {order.status}
                          </span>
                          {live && order.otpCode && (
                            <span className="inline-flex items-center gap-1 rounded-full bg-lav-50 px-2 py-1 text-[0.62rem] font-semibold text-lav-700">
                              <Clock className="h-2.5 w-2.5" /> Code live
                            </span>
                          )}
                        </div>
                        <span className="hidden justify-self-end text-ink-3 md:block">
                          <ArrowUpRight className="h-4 w-4" />
                        </span>
                        <span className="inline-flex items-center gap-1 text-[0.72rem] font-semibold text-lav-700 md:hidden">
                          Open order <ArrowRight className="h-3 w-3" />
                        </span>
                      </Link>
                    );
                  })}
                </div>
              </div>
            </section>
          ))}
        </div>
      )}
    </div>
  );
}
