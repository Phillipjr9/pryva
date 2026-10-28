import Link from "next/link";
import { requireAdmin } from "@/lib/auth";
import { db } from "@/db";
import { orders, users } from "@/db/schema";
import { and, count, desc, eq, ilike, inArray, or } from "drizzle-orm";

export const dynamic = "force-dynamic";

const PAGE_SIZE = 50;

const STATUS_FILTERS = [
  { value: "", label: "All" },
  { value: "active", label: "Active" },
  { value: "processing", label: "Processing" },
  { value: "review", label: "Needs review" },
  { value: "delivered", label: "Delivered" },
  { value: "failed", label: "Failed" },
  { value: "refunded", label: "Refunded" },
  { value: "expired", label: "Expired" },
] as const;

const STATUS_STYLES: Record<string, string> = {
  active: "bg-blue-50 text-blue-700",
  processing: "bg-amber-50 text-amber-700",
  review: "bg-amber-50 text-amber-700",
  delivered: "bg-emerald-50 text-emerald-700",
  failed: "bg-red-50 text-red-700",
  refunded: "bg-lav-50 text-lav-800",
  expired: "bg-slate-100 text-slate-600",
};

function formatNaira(amount: number) {
  return `₦${amount.toLocaleString("en-NG")}`;
}

function formatDate(value: Date | string) {
  const date = typeof value === "string" ? new Date(value) : value;
  return date.toLocaleString("en-NG", {
    day: "2-digit",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export default async function AdminOrdersPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; status?: string; page?: string }>;
}) {
  await requireAdmin("/admin/orders");

  const params = await searchParams;
  const query = (params.q ?? "").trim();
  const status = (params.status ?? "").trim();
  const page = Math.max(1, Number.parseInt(params.page ?? "1", 10) || 1);
  const offset = (page - 1) * PAGE_SIZE;

  const conditions = [];
  if (status) conditions.push(eq(orders.status, status));
  if (query) {
    conditions.push(
      or(
        ilike(orders.reference, `%${query}%`),
        ilike(orders.productName, `%${query}%`),
        ilike(orders.service, `%${query}%`),
      )!,
    );
  }
  const where = conditions.length === 0 ? undefined : conditions.length === 1 ? conditions[0] : and(...conditions);

  const rows = await db
    .select({
      id: orders.id,
      reference: orders.reference,
      userId: orders.userId,
      service: orders.service,
      productName: orders.productName,
      planLabel: orders.planLabel,
      provider: orders.provider,
      providerRequestId: orders.providerRequestId,
      amount: orders.amount,
      status: orders.status,
      createdAt: orders.createdAt,
      refundedAt: orders.refundedAt,
    })
    .from(orders)
    .where(where)
    .orderBy(desc(orders.createdAt))
    .limit(PAGE_SIZE)
    .offset(offset);

  const [{ total }] = await db.select({ total: count() }).from(orders).where(where);

  // Attach the buyer's email so support can answer "which order is mine?"
  // without opening another screen.
  const pageUserIds = [...new Set(rows.map((row) => row.userId))];
  const emailById = new Map<string, string>();
  if (pageUserIds.length > 0) {
    const buyers = await db
      .select({ id: users.id, email: users.email })
      .from(users)
      .where(inArray(users.id, pageUserIds));
    for (const buyer of buyers) emailById.set(buyer.id, buyer.email);
  }

  const totalPages = Math.max(1, Math.ceil(Number(total) / PAGE_SIZE));
  const revenueOnPage = rows
    .filter((row) => row.status === "delivered" || row.status === "active")
    .reduce((sum, row) => sum + row.amount, 0);

  const buildHref = (next: { status?: string; page?: number }) => {
    const search = new URLSearchParams();
    const nextStatus = next.status ?? status;
    const nextPage = next.page ?? page;
    if (nextStatus) search.set("status", nextStatus);
    if (query) search.set("q", query);
    if (nextPage > 1) search.set("page", String(nextPage));
    const suffix = search.toString();
    return suffix ? `/admin/orders?${suffix}` : "/admin/orders";
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-[1.5rem] font-medium tracking-tight">Orders</h1>
          <p className="mt-1 text-[0.86rem] text-ink-2">
            {Number(total).toLocaleString("en-NG")} {Number(total) === 1 ? "order" : "orders"}
            {status ? ` · ${status}` : ""}
            {query ? ` · matching “${query}”` : ""}
          </p>
        </div>
        <div className="rounded-xl border border-line bg-white px-4 py-2 text-right">
          <p className="text-[0.7rem] uppercase tracking-wide text-ink-3">Paid value on this page</p>
          <p className="text-[1rem] font-semibold text-ink">{formatNaira(revenueOnPage)}</p>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        {STATUS_FILTERS.map((filter) => (
          <Link
            key={filter.value || "all"}
            href={buildHref({ status: filter.value, page: 1 })}
            className={
              filter.value === status
                ? "rounded-full border border-lav-600 bg-lav-600 px-3.5 py-1.5 text-[0.8rem] font-medium text-white"
                : "rounded-full border border-line bg-white px-3.5 py-1.5 text-[0.8rem] font-medium text-ink-2 hover:border-lav-300"
            }
          >
            {filter.label}
          </Link>
        ))}

        <form action="/admin/orders" className="ml-auto flex items-center gap-2">
          {status && <input type="hidden" name="status" value={status} />}
          <input
            type="search"
            name="q"
            defaultValue={query}
            placeholder="Search reference, product or service"
            aria-label="Search orders"
            className="w-64 rounded-xl border border-line bg-white px-3.5 py-2 text-[0.84rem] outline-none focus:border-lav-400"
          />
          <button type="submit" className="btn btn-primary btn-sm">
            Search
          </button>
        </form>
      </div>

      <div className="overflow-hidden rounded-2xl border border-line bg-white">
        <table className="w-full text-left text-[0.84rem]">
          <thead className="bg-cream/70 text-[0.72rem] uppercase tracking-wide text-ink-3">
            <tr>
              <th className="px-4 py-3 font-semibold">Order</th>
              <th className="px-4 py-3 font-semibold">Buyer</th>
              <th className="px-4 py-3 font-semibold">Product</th>
              <th className="px-4 py-3 font-semibold">Amount</th>
              <th className="px-4 py-3 font-semibold">Status</th>
              <th className="px-4 py-3 font-semibold">Placed</th>
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 && (
              <tr>
                <td colSpan={6} className="px-4 py-10 text-center text-ink-2">
                  No orders match those filters.
                </td>
              </tr>
            )}
            {rows.map((row) => (
              <tr key={row.id} className="border-t border-line/70">
                <td className="px-4 py-3 font-mono text-[0.76rem] text-ink-2">{row.reference}</td>
                <td className="px-4 py-3 text-[0.8rem] text-ink-2">
                  {emailById.get(row.userId) ?? "—"}
                </td>
                <td className="px-4 py-3">
                  <p className="font-medium text-ink">{row.productName}</p>
                  <p className="text-[0.74rem] text-ink-3">
                    {row.service} · {row.planLabel}
                  </p>
                  {row.provider === "accounts" && row.providerRequestId && (
                    <p className="mt-1 break-all font-mono text-[0.68rem] text-ink-3">Provider reference: {row.providerRequestId}</p>
                  )}
                </td>
                <td className="px-4 py-3 font-medium">{formatNaira(row.amount)}</td>
                <td className="px-4 py-3">
                  <span
                    className={`rounded-full px-2 py-0.5 text-[0.7rem] font-semibold capitalize ${
                      STATUS_STYLES[row.status] ?? "bg-slate-100 text-slate-600"
                    }`}
                  >
                    {row.status}
                  </span>
                  {row.refundedAt && (
                    <p className="mt-1 text-[0.7rem] text-ink-3">refunded {formatDate(row.refundedAt)}</p>
                  )}
                </td>
                <td className="px-4 py-3 text-ink-2">{formatDate(row.createdAt)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {totalPages > 1 && (
        <div className="flex items-center justify-between text-[0.82rem] text-ink-2">
          <span>
            Page {page} of {totalPages}
          </span>
          <div className="flex gap-2">
            {page > 1 && (
              <Link
                href={buildHref({ page: page - 1 })}
                className="rounded-lg border border-line bg-white px-3 py-1.5 hover:border-lav-300"
              >
                Previous
              </Link>
            )}
            {page < totalPages && (
              <Link
                href={buildHref({ page: page + 1 })}
                className="rounded-lg border border-line bg-white px-3 py-1.5 hover:border-lav-300"
              >
                Next
              </Link>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
