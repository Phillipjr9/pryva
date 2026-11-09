import { requireAdmin } from "@/lib/identity/auth";
import { db } from "@/db";
import { orders, users } from "@/db/schema";
import { count, sum, eq, or, sql, desc, isNotNull, inArray } from "drizzle-orm";
import { AnalyticsDashboard } from "./AnalyticsDashboard";
import Link from "next/link";
import { ArrowRight } from "@/components/icons";
import { formatCurrency } from "@/lib/platform/utils";
import { cn } from "@/lib/platform/utils";
import { isPreviewDatabase } from "@/lib/platform/demo-policy";

export const dynamic = "force-dynamic";

function formatDateTime(value: Date | string) {
  const date = typeof value === "string" ? new Date(value) : value;
  return date.toLocaleString("en-NG", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function formatDate(value: Date | string) {
  const date = typeof value === "string" ? new Date(value) : value;
  return date.toLocaleDateString("en-NG", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  });
}

const OUTCOMES: {
  label: string;
  statuses: string[];
  iconColor: "mint" | "rose" | "amber" | "lav";
}[] = [
  { label: "Successful", statuses: ["delivered", "active"], iconColor: "mint" },
  { label: "Failed", statuses: ["failed", "expired"], iconColor: "rose" },
  { label: "Pending", statuses: ["processing", "review"], iconColor: "amber" },
  { label: "Refunded", statuses: ["refunded"], iconColor: "lav" },
];

const OUTCOME_COLORS: Record<string, string> = {
  mint: "bg-green-100 text-green-600",
  rose: "bg-rose-50 text-rose-700",
  amber: "bg-amber-50 text-amber-700",
  lav: "bg-lav-100 text-lav-700",
};

type ProductRow = {
  service: string;
  productName: string;
  planLabel: string;
  orders: number;
  revenue: number;
};

type SignupRow = {
  id: string;
  name: string;
  email: string;
  createdAt: Date;
  emailVerifiedAt: Date | null;
  deletedAt: Date | null;
  orderCount: number;
};

export default async function AdminAnalyticsPage() {
  await requireAdmin("/admin/analytics");

  const [totalUsersRow] = await db.select({ count: count() }).from(users);
  const [totalOrdersRow] = await db.select({ count: count() }).from(orders);

  // Signup health: how many accounts exist, how many verified their email, how
  // many are closed. A signup burst of unverified accounts with no orders is the
  // classic spam signal.
  const [verifiedCountRow] = await db
    .select({ count: count() })
    .from(users)
    .where(isNotNull(users.emailVerifiedAt));
  const [closedCountRow] = await db
    .select({ count: count() })
    .from(users)
    .where(isNotNull(users.deletedAt));

  // Outcome breakdown for orders.
  const outcomes = await Promise.all(
    OUTCOMES.map(async (outcome) => {
      const where =
        outcome.statuses.length === 1
          ? eq(orders.status, outcome.statuses[0])
          : or(
              ...outcome.statuses.map((status) => eq(orders.status, status)),
            );
      const [row] = await db
        .select({
          count: count(),
          revenue: sql<number>`coalesce(sum(${orders.amount}), 0)`,
        })
        .from(orders)
        .where(where);
      return {
        ...outcome,
        count: Number(row?.count ?? 0),
        revenue: Number(row?.revenue ?? 0),
      };
    }),
  );

  const totalOrders = Number(totalOrdersRow?.count ?? 0);
  const totalRevenue = outcomes.reduce(
    (sum, o) => sum + o.revenue,
    0,
  );

  // Recent signups: newest accounts first, with their order count so an
  // operator can tell whether a new account is actually buying or just created
  // and abandoned — the pattern spam signups usually follow.
  const signupRows = await db
    .select({
      id: users.id,
      name: users.name,
      email: users.email,
      createdAt: users.createdAt,
      emailVerifiedAt: users.emailVerifiedAt,
      deletedAt: users.deletedAt,
    })
    .from(users)
    .orderBy(desc(users.createdAt))
    .limit(15);

  const signupIds = signupRows.map((row) => row.id);
  const orderCounts = new Map<string, number>();
  if (signupIds.length > 0) {
    if (isPreviewDatabase()) {
      const rowsForCounts = await db.select({ userId: orders.userId }).from(orders).where(inArray(orders.userId, signupIds));
      for (const row of rowsForCounts) orderCounts.set(row.userId, (orderCounts.get(row.userId) ?? 0) + 1);
    } else {
      const grouped = await db
        .select({
          userId: orders.userId,
          count: count(),
        })
        .from(orders)
        .where(inArray(orders.userId, signupIds))
        .groupBy(orders.userId);
      for (const row of grouped) {
        orderCounts.set(row.userId, Number(row.count));
      }
    }
  }

  const signups: SignupRow[] = signupRows.map((row) => ({
    id: row.id,
    name: row.name,
    email: row.email,
    createdAt: row.createdAt,
    emailVerifiedAt: row.emailVerifiedAt,
    deletedAt: row.deletedAt,
    orderCount: orderCounts.get(row.id) ?? 0,
  }));

  const verifiedUsers = Number(verifiedCountRow?.count ?? 0);
  const closedUsers = Number(closedCountRow?.count ?? 0);
  const totalUsers = Number(totalUsersRow?.count ?? 0);
  const unverifiedUsers = totalUsers - verifiedUsers - closedUsers;

  // What customers are actually buying: top products by order count.
  let productRows: { service: string; productName: string; planLabel: string; orders: number; revenue: number }[];
  if (isPreviewDatabase()) {
    const rawProducts = await db.select({ service: orders.service, productName: orders.productName, planLabel: orders.planLabel, amount: orders.amount }).from(orders);
    const groupedProducts = new Map<string, typeof productRows[number]>();
    for (const row of rawProducts) {
      const key = `${row.service}\u0000${row.productName}\u0000${row.planLabel}`;
      const current = groupedProducts.get(key) ?? { service: row.service, productName: row.productName, planLabel: row.planLabel, orders: 0, revenue: 0 };
      current.orders += 1;
      current.revenue += Number(row.amount);
      groupedProducts.set(key, current);
    }
    productRows = [...groupedProducts.values()].sort((a, b) => b.orders - a.orders).slice(0, 10);
  } else {
    productRows = (await db
      .select({
        service: orders.service,
        productName: orders.productName,
        planLabel: orders.planLabel,
        orders: count(),
        revenue: sql<number>`coalesce(sum(${orders.amount}), 0)`,
      })
      .from(orders)
      .groupBy(orders.service, orders.productName, orders.planLabel)
      .orderBy(desc(count()))
      .limit(10)).map((row) => ({ ...row, orders: Number(row.orders), revenue: Number(row.revenue) }));
  }

  const products: ProductRow[] = productRows.map((row) => ({
    service: row.service,
    productName: row.productName,
    planLabel: row.planLabel,
    orders: Number(row.orders),
    revenue: Number(row.revenue),
  }));

  const stats = {
    totalUsers,
    totalOrders,
    totalRevenue,
  };

  return (
    <div>
      <div className="space-y-6">
        <div>
          <h1 className="text-[2rem] font-medium tracking-tight text-ink">
            Admin Analytics
          </h1>
          <p className="mt-2 text-[0.95rem] text-ink-2">
            Platform overview and key metrics
          </p>
        </div>

        <AnalyticsDashboard stats={stats} />

        {/* Signup health — who is signing up and whether they stuck around */}

        <div className="grid gap-6 sm:grid-cols-4">
          <div className="rounded-2xl border border-line bg-white p-6">
            <p className="text-[0.86rem] text-ink-2 mb-1">Total accounts</p>
            <p className="text-[2rem] font-bold text-ink">
              {totalUsers.toLocaleString("en-NG")}
            </p>
          </div>
          <div className="rounded-2xl border border-line bg-white p-6">
            <p className="text-[0.86rem] text-ink-2 mb-1">Verified email</p>
            <p className="text-[2rem] font-bold text-ink">
              {verifiedUsers.toLocaleString("en-NG")}
            </p>
          </div>
          <div className="rounded-2xl border border-line bg-white p-6">
            <p className="text-[0.86rem] text-ink-2 mb-1">Unverified</p>
            <p className="text-[2rem] font-bold text-ink">
              {unverifiedUsers.toLocaleString("en-NG")}
            </p>
          </div>
          <div className="rounded-2xl border border-line bg-white p-6">
            <p className="text-[0.86rem] text-ink-2 mb-1">Closed accounts</p>
            <p className="text-[2rem] font-bold text-ink">
              {closedUsers.toLocaleString("en-NG")}
            </p>
          </div>
        </div>

        {/* Outcome cards — successful vs failed vs pending vs refunded */}

        <div className="grid gap-6 sm:grid-cols-4">
          {outcomes.map((outcome) => {
            const colorClass = OUTCOME_COLORS[outcome.iconColor];
            return (
              <Link
                key={outcome.label}
                href={`/admin/orders?status=${outcome.statuses.join("&status=")}`}
                className={`rounded-2xl border border-line bg-white p-6 transition-colors hover:bg-cream`}
              >
                <div className="flex items-center justify-between mb-4">
                  <span className={`grid h-12 w-12 place-items-center rounded-xl ${colorClass}`}>
                    {outcome.label === "Successful" ? (
                      <span className="text-[1.5rem]">✓</span>
                    ) : outcome.label === "Failed" ? (
                      <span className="text-[1.5rem]">✕</span>
                    ) : outcome.label === "Pending" ? (
                      <span className="text-[1.5rem]">↻</span>
                    ) : (
                      <span className="text-[1.5rem]">↩</span>
                    )}
                  </span>
                </div>
                <p className="text-[0.86rem] text-ink-2 mb-1">
                  {outcome.label} orders
                </p>
                <p className="text-[2rem] font-bold text-ink mb-1">
                  {outcome.count.toLocaleString("en-NG")}
                </p>
                <p className="text-[0.86rem] font-medium text-ink-2">
                  {formatCurrency(outcome.revenue)}
                </p>
              </Link>
            );
          })}
        </div>

        {/* Recent signups — newest accounts, with verification and order count */}

        <div className="rounded-2xl border border-line bg-white p-6">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-[1rem] font-semibold text-ink">
              Recent signups
            </h2>
            <Link
              href="/admin/users"
              className="text-[0.82rem] font-medium text-lav-700 underline underline-offset-2 hover:text-lav-800"
            >
              View all users <ArrowRight className="h-3.5 w-3.5 ml-1" />
            </Link>
          </div>

          <p className="mb-3 text-meta text-ink-2">
            Accounts created newest first. Unverified accounts with no orders are
            the usual spam pattern — check <Link
              href="/admin/users"
              className="font-medium text-lav-700 underline underline-offset-2 hover:text-lav-800"
            >the full user list</Link> to act on them.
            <br />
            <span className="text-[0.8125rem] text-ink-3">
              Note: the database does not currently record signup source or IP
              address, so “where they came from” isn’t available yet. That would
              need to be added to the signup flow.
            </span>
          </p>

          <div className="overflow-x-auto">
            <table className="w-full min-w-[52rem] text-left text-[0.84rem]">
              <thead className="bg-cream/70 text-meta uppercase tracking-wide text-ink-3">
                <tr>
                  <th className="px-4 py-3 font-semibold">Account</th>
                  <th className="px-4 py-3 font-semibold">Email</th>
                  <th className="px-4 py-3 font-semibold">Joined</th>
                  <th className="px-4 py-3 font-semibold">Email verified</th>
                  <th className="px-4 py-3 font-semibold">Orders</th>
                </tr>
              </thead>
              <tbody>
                {signups.length === 0 && (
                  <tr>
                    <td colSpan={5} className="px-4 py-10 text-center text-ink-2">
                      No accounts yet.
                    </td>
                  </tr>
                )}
                {signups.map((row) => (
                  <tr key={row.id} className="border-t border-line/70">
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-2">
                        <div
                          className="grid h-7 w-7 place-items-center rounded-full bg-cream text-ink-2 text-[0.8125rem] font-semibold"
                          title={row.email}
                        >
                          {row.name
                            .split(" ")
                            .map((part) => part[0])
                            .join("")
                            .toUpperCase()
                            .slice(0, 2)}
                        </div>
                        <p className="font-medium text-ink truncate max-w-[16rem]" title={row.name}>
                          {row.name}
                        </p>
                      </div>
                    </td>
                    <td className="px-4 py-3 font-mono text-meta text-ink-2 truncate max-w-[24rem]" title={row.email}>
                      {row.email}
                    </td>
                    <td className="px-4 py-3 text-[0.8rem] text-ink-2">
                      {formatDateTime(row.createdAt)}
                    </td>
                    <td className="px-4 py-3">
                      {row.emailVerifiedAt ? (
                        <span className="rounded-full bg-emerald-50 px-2 py-0.5 text-meta font-semibold text-emerald-700">
                          Verified
                        </span>
                      ) : row.deletedAt ? (
                        <span className="rounded-full bg-slate-100 px-2 py-0.5 text-meta font-semibold text-slate-600">
                          Closed
                        </span>
                      ) : (
                        <span className="rounded-full bg-amber-50 px-2 py-0.5 text-meta font-semibold text-amber-700">
                          Unverified
                        </span>
                      )}
                    </td>
                    <td className="px-4 py-3 font-medium text-ink">
                      {row.orderCount.toLocaleString("en-NG")}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        {/* What's being bought — top products by order count */}

        <div className="rounded-2xl border border-line bg-white p-6">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-[1rem] font-semibold text-ink">
              What customers are buying
            </h2>
            <Link
              href="/admin/orders"
              className="text-[0.82rem] font-medium text-lav-700 underline underline-offset-2 hover:text-lav-800"
            >
              View all orders <ArrowRight className="h-3.5 w-3.5 ml-1" />
            </Link>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full min-w-[44rem] text-left text-[0.84rem]">
              <thead className="bg-cream/70 text-meta uppercase tracking-wide text-ink-3">
                <tr>
                  <th className="px-4 py-3 font-semibold">Product</th>
                  <th className="px-4 py-3 font-semibold">Plan</th>
                  <th className="px-4 py-3 font-semibold">Orders</th>
                  <th className="px-4 py-3 font-semibold">Revenue</th>
                  <th className="px-4 py-3 font-semibold">Service</th>
                </tr>
              </thead>
              <tbody>
                {products.length === 0 && (
                  <tr>
                    <td colSpan={5} className="px-4 py-10 text-center text-ink-2">
                      No orders yet.
                    </td>
                  </tr>
                )}
                {products.map((product) => (
                  <tr
                    key={`${product.service}|${product.productName}`}
                    className="border-t border-line/70"
                  >
                    <td className="px-4 py-3 font-medium text-ink">
                      {product.productName}
                    </td>
                    <td className="px-4 py-3 text-ink-2">{product.planLabel}</td>
                    <td className="px-4 py-3 font-medium text-ink">
                      {product.orders.toLocaleString("en-NG")}
                    </td>
                    <td className="px-4 py-3 font-medium text-ink">
                      {formatCurrency(product.revenue)}
                    </td>
                    <td className="px-4 py-3 text-[0.8rem] text-ink-3 capitalize">
                      {product.service.replace(/_/g, " ")}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </div>
  );
}
