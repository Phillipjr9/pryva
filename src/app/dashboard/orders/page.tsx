import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { requireUser } from "@/lib/identity/auth";
import { ORDER_HISTORY_PAGE_SIZE as ORDERS_PER_PAGE } from "@/lib/platform/pagination";
import { formatNaira } from "@/lib/services/catalog";
import { hasLiveOrderCode, orderHistoryPageNumber, readOrderHistory, type OrderHistoryRow } from "@/lib/services/order-history";

import { EmptyState } from "@/components/dashboard/EmptyState";

export const metadata: Metadata = { title: "Orders" };
export const dynamic = "force-dynamic";

type OrderRow = OrderHistoryRow;

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

/** A repeated `?q=a&q=b` arrives as an array; the first one is the one meant. */
function single(value: string | string[] | undefined, fallback: string): string {
  if (Array.isArray(value)) return value[0] ?? fallback;
  return value ?? fallback;
}

export default async function OrdersPage({
  searchParams,
}: {
  searchParams: Promise<{ status?: string | string[]; q?: string | string[]; page?: string | string[] }>;
}) {
  const user = await requireUser("/dashboard/orders");
  const params = await searchParams;
  const status = single(params.status, "all");
  const q = single(params.q, "");
  const page = orderHistoryPageNumber(params.page);
  const query = q.trim();

  // The filter and the search are applied in the database, over the whole
  // history; what comes back is one page of the result. See the reader for why.
  const { rows, hasOlder, totals } = await readOrderHistory({ userId: user.id, status, query, page });

  // Group by month so a long history reads as a timeline instead of one wall.
  const grouped = rows.reduce<Array<{ label: string; items: OrderRow[] }>>((acc, order) => {
    const label = monthLabel(new Date(order.createdAt));
    const bucket = acc.find((entry) => entry.label === label);
    if (bucket) bucket.items.push(order);
    else acc.push({ label, items: [order] });
    return acc;
  }, []);

  const filters = [
    { key: "all", label: `All (${totals.all})` },
    { key: "active", label: `Active (${totals.active})` },
    { key: "refunded", label: `Refunded (${totals.refunded})` },
  ];

  // Choosing a filter starts again from the newest orders; the pager below
  // carries the filter and the search across pages.
  const hrefFor = (nextStatus: string, nextPage = 1) => {
    const next = new URLSearchParams();
    if (nextStatus !== "all") next.set("status", nextStatus);
    if (query) next.set("q", query);
    if (nextPage > 1) next.set("page", String(nextPage));
    const qs = next.toString();
    return qs ? `/dashboard/orders?${qs}` : "/dashboard/orders";
  };

  // A page number past the end (a stale link, or a filter that now matches
  // fewer orders) would otherwise read as "Nothing matches that".
  if (page > 1 && rows.length === 0) redirect(hrefFor(status));

  /** The matching orders do not fit on one page, so this is one of several. */
  const paged = page > 1 || hasOlder;
  const firstShown = (page - 1) * ORDERS_PER_PAGE + 1;
  const lastShown = firstShown + rows.length - 1;
  const narrowed = status !== "all" || query.length > 0;
  // This dynamic server page uses one request-time instant for every row.
  // eslint-disable-next-line react-hooks/purity
  const now = Date.now();

  return (
    <div className="grid gap-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-[1.5rem] font-medium tracking-tight sm:text-[1.7rem]">Orders</h1>
          <p className="mt-1 text-[0.875rem] text-ink-2">
            Every number, eSIM, proxy pack and inbox you&apos;ve bought — with codes kept safe.
          </p>
        </div>
        <Link href="/pricing" className="btn btn-primary !px-4 !py-2.5 !text-[0.8125rem] sm:!text-[0.8125rem]">
           New order
        </Link>
      </div>

      {totals.all > 0 && (
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex flex-wrap gap-1.5">
            {filters.map((filter) => {
              const active = status === filter.key;
              return (
                <Link
                  key={filter.key}
                  href={hrefFor(filter.key)}
                  aria-current={active ? "page" : undefined}
                  className={`whitespace-nowrap rounded-full border px-3 py-1.5 text-meta font-semibold transition-colors ${
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

            <input
              type="search"
              name="q"
              defaultValue={q}
              placeholder="Search reference or product"
              aria-label="Search orders"
              className="w-full rounded-full border border-line bg-white py-2 px-3 text-meta text-ink outline-none placeholder:text-ink-3 focus:border-lav-300"
            />
          </form>
        </div>
      )}

      {totals.all === 0 ? (
        <EmptyState
          title="No orders yet"
          body="Orders and their references appear here. Temporary inboxes are free and never create an order, so they do not appear in this list."
          action={{ label: "Browse pricing", href: "/pricing" }}
        />
      ) : rows.length === 0 ? (
        <EmptyState
          title="Nothing matches that"
          body={`No ${status === "all" ? "" : `${status} `}orders match “${query}”. Try the reference number or a product name.`}
          action={{ label: "Clear filters", href: "/dashboard/orders" }}
        />
      ) : (
        <div className="grid gap-5">
          {grouped.map((group) => (
            <section key={group.label} className="grid gap-2">
              <h2 className="px-1 text-micro font-semibold uppercase tracking-[0.16em] text-ink-3">
                {group.label}
              </h2>
              <div className="overflow-hidden rounded-[1.5rem] border border-line bg-[#fffdfa]">
                <div className="hidden grid-cols-[1.45fr_0.9fr_0.7fr_0.75fr_0.25fr] gap-3 border-b border-line px-5 py-3 text-micro font-semibold uppercase tracking-[0.14em] text-ink-3 md:grid">
                  <span>Order</span>
                  <span>Placed</span>
                  <span>Amount</span>
                  <span>Status</span>
                  <span />
                </div>
                <div className="divide-y divide-line/80">
                  {/* `relative` anchor for the desktop receipt link below. */}
                  {group.items.map((order) => {
                    const live = hasLiveOrderCode(order, now);
                    return (
                      <div key={order.id} className="relative">
                      <Link
                        href={`/dashboard/orders/${order.id}`}
                        className="grid gap-1.5 px-4 py-3.5 transition-colors hover:bg-lav-50/40 md:grid-cols-[1.45fr_0.9fr_0.7fr_0.75fr_0.25fr] md:items-center md:gap-3 md:px-5"
                      >
                        <div className="min-w-0">
                          <p className="[overflow-wrap:anywhere] text-[0.875rem] font-semibold text-ink">
                            {order.productName}
                          </p>
                          <p className="[overflow-wrap:anywhere] text-meta text-ink-3">
                            {order.planLabel} · {order.reference}
                          </p>
                        </div>
                        <div className="flex items-center justify-between gap-2 md:block">
                          <p className="text-meta text-ink-2">{dayLabel(new Date(order.createdAt))}</p>
                          <p className="text-[0.8125rem] font-semibold text-ink md:hidden">
                            {formatNaira(order.amount)}
                          </p>
                        </div>
                        <p className="hidden text-[0.8125rem] font-semibold text-ink md:block">
                          {formatNaira(order.amount)}
                        </p>
                        <div className="flex flex-wrap items-center gap-2">
                          <span
                            className={`inline-flex w-fit items-center whitespace-nowrap rounded-full px-2.5 py-1 text-micro font-semibold capitalize ${statusStyle(order.status)}`}
                          >
                            {order.status}
                          </span>
                          {live && (
                            <span className="inline-flex items-center gap-1 whitespace-nowrap rounded-full bg-lav-50 px-2 py-1 text-micro font-semibold text-lav-700">
                               Code live
                            </span>
                          )}
                        </div>

                        <span className="inline-flex items-center gap-1 text-meta font-semibold text-lav-700 md:hidden">
                          Open order
                        </span>
                      </Link>
                      {/*
                        A sibling, not a child: the row above is one big link, and
                        a link inside a link is invalid and unreachable by keyboard.
                        A receipt is the thing people come back for when a bank or
                        an employer asks for proof, so it gets its own control here
                        rather than two taps deep behind the order page.
                      */}
                      <Link
                        href={`/dashboard/orders/${order.id}/receipt`}
                        aria-label={`Receipt for ${order.productName}, ${order.reference}`}
                        className="mb-3 ml-4 inline-flex items-center gap-1.5 text-meta font-semibold text-ink-3 hover:text-lav-700 md:absolute md:right-14 md:top-1/2 md:mb-0 md:ml-0 md:-translate-y-1/2"
                      >

                        Receipt
                      </Link>
                      </div>
                    );
                  })}
                </div>
              </div>
            </section>
          ))}
        </div>
      )}

      {paged && (
        <nav
          aria-label="Order history pages"
          className="flex flex-col gap-3 rounded-[1.5rem] border border-line bg-white/70 px-4 py-3 sm:flex-row sm:items-center sm:justify-between"
        >
          <p className="text-meta text-ink-2">
            {narrowed ? "Matching orders" : "Orders"} {firstShown.toLocaleString("en-NG")}–
            {lastShown.toLocaleString("en-NG")}
            {!narrowed && ` of ${totals.all.toLocaleString("en-NG")}`}, newest first.
          </p>
          <div className="flex flex-wrap gap-1.5">
            {page > 1 && (
              <Link
                href={hrefFor(status, page - 1)}
                rel="prev"
                className="whitespace-nowrap rounded-full border border-line bg-white px-3 py-1.5 text-meta font-semibold text-ink-2 transition-colors hover:border-lav-200"
              >
                Newer orders
              </Link>
            )}
            {hasOlder && (
              <Link
                href={hrefFor(status, page + 1)}
                rel="next"
                className="whitespace-nowrap rounded-full border border-line bg-white px-3 py-1.5 text-meta font-semibold text-ink-2 transition-colors hover:border-lav-200"
              >
                Older orders
              </Link>
            )}
          </div>
        </nav>
      )}
    </div>
  );
}
