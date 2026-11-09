import Link from "next/link";
import { notFound } from "next/navigation";
import { desc, eq } from "drizzle-orm";

import { db } from "@/db";
import { orders, users, walletTransactions } from "@/db/schema";
import { CountryFlag } from "@/components/CountryFlag";
import { requireAdmin } from "@/lib/identity/auth";

export const dynamic = "force-dynamic";

function formatNaira(amount: number) {
  return `₦${amount.toLocaleString("en-NG")}`;
}

function formatDateTime(value: Date | string | null) {
  if (!value) return "—";
  const date = typeof value === "string" ? new Date(value) : value;
  return date.toLocaleString("en-NG", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

const STATUS_STYLES: Record<string, string> = {
  active: "bg-blue-50 text-blue-700",
  processing: "bg-amber-50 text-amber-700",
  review: "bg-amber-50 text-amber-700",
  delivered: "bg-emerald-50 text-emerald-700",
  failed: "bg-red-50 text-red-700",
  refunded: "bg-lav-50 text-lav-800",
  expired: "bg-slate-100 text-slate-600",
};

export default async function AdminOrderDetailPage({ params }: { params: Promise<{ id: string }> }) {
  await requireAdmin("/admin/orders");
  const { id } = await params;

  const [order] = await db.select().from(orders).where(eq(orders.id, id)).limit(1);
  if (!order) notFound();

  const [customer] = await db
    .select({
      id: users.id,
      name: users.name,
      email: users.email,
      walletBalance: users.walletBalance,
      emailVerifiedAt: users.emailVerifiedAt,
    })
    .from(users)
    .where(eq(users.id, order.userId))
    .limit(1);

  const ledgerRows = await db
    .select({
      id: walletTransactions.id,
      type: walletTransactions.type,
      amount: walletTransactions.amount,
      balanceAfter: walletTransactions.balanceAfter,
      description: walletTransactions.description,
      reference: walletTransactions.reference,
      createdAt: walletTransactions.createdAt,
    })
    .from(walletTransactions)
    .where(eq(walletTransactions.orderId, order.id))
    .orderBy(desc(walletTransactions.createdAt))
    .limit(10);

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <Link href="/admin/orders" className="text-meta text-ink-3 hover:text-lav-700">
            ← Back to orders
          </Link>
          <h1 className="mt-2 text-[1.7rem] font-semibold text-ink">{order.reference}</h1>
          <p className="text-meta text-ink-3">{order.productName}</p>
        </div>
        <span
          className={`inline-flex rounded-full px-3 py-1 text-[0.8125rem] font-semibold capitalize ${
            STATUS_STYLES[order.status] ?? "bg-slate-100 text-slate-600"
          }`}
        >
          {order.status}
        </span>
      </div>

      <div className="grid gap-4 md:grid-cols-4">
        {[
          ["Customer", customer ? customer.email : "Unknown user"],
          ["Service", `${order.service} · ${order.planLabel}`],
          ["Amount", formatNaira(order.amount)],
          ["Placed", formatDateTime(order.createdAt)],
        ].map(([label, value]) => (
          <div key={label} className="rounded-2xl border border-line bg-white p-4">
            <p className="text-meta uppercase tracking-wide text-ink-3">{label}</p>
            <p className="mt-2 text-[0.98rem] font-medium text-ink break-words">{value}</p>
          </div>
        ))}
      </div>

      <div className="grid gap-6 xl:grid-cols-2">
        <section className="rounded-2xl border border-line bg-white p-5">
          <h2 className="text-[1rem] font-semibold text-ink">Order details</h2>
          <dl className="mt-4 space-y-3 text-[0.86rem]">
            <div className="flex justify-between gap-4 border-b border-line pb-2">
              <dt className="text-ink-3">Provider</dt>
              <dd className="font-medium text-ink">{order.provider}</dd>
            </div>
            <div className="flex justify-between gap-4 border-b border-line pb-2">
              <dt className="text-ink-3">Region</dt>
              <dd className="inline-flex items-center gap-2 font-medium text-ink">
                <CountryFlag region={order.region} size={16} decorative radius={8} />
                <span>{order.region}</span>
              </dd>
            </div>
            <div className="flex justify-between gap-4 border-b border-line pb-2">
              <dt className="text-ink-3">Duration</dt>
              <dd className="font-medium text-ink">{order.duration}</dd>
            </div>
            <div className="flex justify-between gap-4 border-b border-line pb-2">
              <dt className="text-ink-3">Reference code</dt>
              <dd className="font-medium text-ink break-all">{order.referenceCode ?? "—"}</dd>
            </div>
            {order.providerRequestId && (
              <div className="flex justify-between gap-4 border-b border-line pb-2">
                <dt className="text-ink-3">Provider request</dt>
                <dd className="font-medium text-ink break-all">{order.providerRequestId}</dd>
              </div>
            )}
            {order.targetLink && (
              <div className="flex justify-between gap-4 border-b border-line pb-2">
                <dt className="text-ink-3">Target link</dt>
                <dd className="font-medium text-ink break-all">
                  <a href={order.targetLink} target="_blank" rel="noreferrer" className="text-lav-700 underline">
                    {order.targetLink}
                  </a>
                </dd>
              </div>
            )}
            {order.reconciliationNote && (
              <div className="flex justify-between gap-4 border-b border-line pb-2">
                <dt className="text-ink-3">Reconciliation note</dt>
                <dd className="font-medium text-amber-700">{order.reconciliationNote}</dd>
              </div>
            )}
          </dl>
        </section>

        <section className="rounded-2xl border border-line bg-white p-5">
          <h2 className="text-[1rem] font-semibold text-ink">Customer</h2>
          {customer ? (
            <div className="mt-4 space-y-3 text-[0.86rem]">
              <div>
                <p className="text-ink-3">Name</p>
                <p className="font-medium text-ink">{customer.name}</p>
              </div>
              <div>
                <p className="text-ink-3">Email</p>
                <Link href={`/admin/users/${customer.id}`} className="font-medium text-lav-700 hover:underline">
                  {customer.email}
                </Link>
              </div>
              <div>
                <p className="text-ink-3">Wallet balance</p>
                <p className="font-medium text-ink">{formatNaira(customer.walletBalance)}</p>
              </div>
              <div>
                <p className="text-ink-3">Email verified</p>
                <p className="font-medium text-ink">{customer.emailVerifiedAt ? formatDateTime(customer.emailVerifiedAt) : "No"}</p>
              </div>
            </div>
          ) : (
            <p className="mt-4 text-meta text-ink-3">This order has no linked customer profile.</p>
          )}
        </section>
      </div>

      <section className="rounded-2xl border border-line bg-white p-5">
        <h2 className="text-[1rem] font-semibold text-ink">Associated wallet activity</h2>
        {ledgerRows.length === 0 ? (
          <p className="mt-4 text-meta text-ink-3">No wallet entries are linked to this order yet.</p>
        ) : (
          <div className="mt-4 space-y-3">
            {ledgerRows.map((entry) => (
              <div key={entry.id} className="rounded-xl border border-line bg-cream/40 p-3">
                <div className="flex items-center justify-between gap-3">
                  <p className="font-medium text-ink">{entry.type}</p>
                  <span className={entry.amount >= 0 ? "text-emerald-700" : "text-amber-700"}>
                    {entry.amount >= 0 ? "+" : "-"}
                    {formatNaira(Math.abs(Number(entry.amount)))}
                  </span>
                </div>
                <p className="mt-1 text-meta text-ink-3">{entry.description}</p>
                <p className="mt-1 text-meta text-ink-3">{entry.reference} · {formatDateTime(entry.createdAt)}</p>
              </div>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
