import Link from "next/link";
import { notFound } from "next/navigation";
import { eq, desc, sql } from "drizzle-orm";

import { db } from "@/db";
import { orders, users, walletTransactions, withdrawals } from "@/db/schema";
import { requireAdmin } from "@/lib/identity/auth";

export const dynamic = "force-dynamic";

function formatNaira(amount: number) {
  return `₦${amount.toLocaleString("en-NG")}`;
}

function formatDate(value: Date | string | null) {
  if (!value) return "—";
  const date = typeof value === "string" ? new Date(value) : value;
  return date.toLocaleDateString("en-NG", { day: "2-digit", month: "short", year: "numeric" });
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

export default async function AdminUserDetailPage({ params }: { params: Promise<{ id: string }> }) {
  await requireAdmin("/admin/users");
  const { id } = await params;

  const [user] = await db
    .select()
    .from(users)
    .where(eq(users.id, id))
    .limit(1);

  if (!user) notFound();

  const userOrders = await db
    .select()
    .from(orders)
    .where(eq(orders.userId, id))
    .orderBy(desc(orders.createdAt))
    .limit(10);

  const userTransactions = await db
    .select()
    .from(walletTransactions)
    .where(eq(walletTransactions.userId, id))
    .orderBy(desc(walletTransactions.createdAt))
    .limit(10);

  const userWithdrawals = await db
    .select()
    .from(withdrawals)
    .where(eq(withdrawals.userId, id))
    .orderBy(desc(withdrawals.createdAt))
    .limit(10);

  const [orderStats] = await db
    .select({
      count: sql<number>`count(*)`,
      spent: sql<number>`coalesce(sum(${orders.amount}), 0)`,
    })
    .from(orders)
    .where(eq(orders.userId, id));

  const [withdrawalStats] = await db
    .select({
      count: sql<number>`count(*)`,
      withdrawn: sql<number>`coalesce(sum(${withdrawals.amount}), 0)`,
    })
    .from(withdrawals)
    .where(eq(withdrawals.userId, id));

  return (
    <div className="mx-auto max-w-6xl space-y-6 px-4 py-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <Link href="/admin/users" className="text-meta text-ink-3 hover:text-lav-700">
            ← Back to users
          </Link>
          <h1 className="mt-2 text-[1.6rem] font-semibold text-ink">{user.name}</h1>
          <p className="text-meta text-ink-3">{user.email}</p>
        </div>
        <div className="rounded-xl border border-line bg-white px-3 py-2 text-right">
          <p className="text-meta uppercase tracking-wide text-ink-3">Wallet balance</p>
          <p className="text-xl font-semibold text-ink">{formatNaira(user.walletBalance)}</p>
        </div>
      </div>

      <div className="grid gap-4 md:grid-cols-4">
        {[
          ["Joined", formatDate(user.createdAt)],
          ["Email verified", user.emailVerifiedAt ? formatDate(user.emailVerifiedAt) : "Not verified"],
          ["Orders", String(Number(orderStats?.count ?? 0))],
          ["Total spent", formatNaira(Number(orderStats?.spent ?? 0))],
          ["Withdrawals", String(Number(withdrawalStats?.count ?? 0))],
          ["Withdrawn", formatNaira(Number(withdrawalStats?.withdrawn ?? 0))],
        ].map(([label, value]) => (
          <div key={label} className="rounded-2xl border border-line bg-white p-4">
            <p className="text-meta uppercase tracking-wide text-ink-3">{label}</p>
            <p className="mt-2 text-[0.98rem] font-medium text-ink">{value}</p>
          </div>
        ))}
      </div>

      <div className="grid gap-6 xl:grid-cols-2">
        <section className="rounded-2xl border border-line bg-white p-5">
          <h2 className="text-[1rem] font-semibold text-ink">Recent orders</h2>
          <div className="mt-4 space-y-3">
            {userOrders.length === 0 ? (
              <p className="text-meta text-ink-3">No orders yet.</p>
            ) : (
              userOrders.map((order) => (
                <div key={order.id} className="rounded-xl border border-line bg-cream/40 p-3">
                  <div className="flex items-center justify-between gap-3">
                    <p className="font-medium text-ink">{order.productName || "Order"}</p>
                    <span className="text-meta text-ink-3">{order.status}</span>
                  </div>
                  <p className="mt-1 text-meta text-ink-3">
                    {formatNaira(Number(order.amount))} · {formatDateTime(order.createdAt)}
                  </p>
                </div>
              ))
            )}
          </div>
        </section>

        <section className="rounded-2xl border border-line bg-white p-5">
          <h2 className="text-[1rem] font-semibold text-ink">Recent wallet activity</h2>
          <div className="mt-4 space-y-3">
            {userTransactions.length === 0 ? (
              <p className="text-meta text-ink-3">No wallet activity yet.</p>
            ) : (
              userTransactions.map((tx) => (
                <div key={tx.id} className="rounded-xl border border-line bg-cream/40 p-3">
                  <div className="flex items-center justify-between gap-3">
                    <p className="font-medium text-ink">{tx.type}</p>
                    <span className={tx.amount >= 0 ? "text-emerald-700" : "text-amber-700"}>
                      {tx.amount >= 0 ? "+" : "-"}{formatNaira(Math.abs(Number(tx.amount)))}
                    </span>
                  </div>
                  <p className="mt-1 text-meta text-ink-3">{tx.description || "Wallet activity"}</p>
                </div>
              ))
            )}
          </div>
        </section>
      </div>

      <section className="rounded-2xl border border-line bg-white p-5">
        <h2 className="text-[1rem] font-semibold text-ink">Recent withdrawals</h2>
        <div className="mt-4 space-y-3">
          {userWithdrawals.length === 0 ? (
            <p className="text-meta text-ink-3">No withdrawals on file.</p>
          ) : (
            userWithdrawals.map((withdrawal) => (
              <div key={withdrawal.id} className="rounded-xl border border-line bg-cream/40 p-3">
                <div className="flex items-center justify-between gap-3">
                  <p className="font-medium text-ink">{formatNaira(Number(withdrawal.amount))}</p>
                  <span className="text-meta text-ink-3">{withdrawal.status}</span>
                </div>
                <p className="mt-1 text-meta text-ink-3">{withdrawal.bankName} · {withdrawal.accountNumber}</p>
                <p className="mt-1 text-meta text-ink-3">{formatDateTime(withdrawal.createdAt)}</p>
              </div>
            ))
          )}
        </div>
      </section>
    </div>
  );
}
