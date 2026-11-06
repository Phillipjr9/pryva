import Link from "next/link";
import { requireAdmin } from "@/lib/identity/auth";
import { db } from "@/db";
import { contactMessages, orders, supportTickets, users } from "@/db/schema";
import { count, desc, eq, sum, isNotNull, inArray } from "drizzle-orm";
import {
  ArrowRight,
  Bell,
  ChevronDown,
  DollarSign,
  MessageCircle,
  Search,
  Shield,
  ShoppingCart,
  TrendingUp,
  User,
  Users,
} from "@/components/icons";
import { cn } from "@/lib/platform/utils";

export const dynamic = "force-dynamic";
export const metadata = { title: "Dashboard" };

function formatNaira(amount: number) {
  return `₦${Number(amount).toLocaleString("en-NG")}`;
}

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

function initials(name: string | null) {
  return (name ?? "User")
    .split(" ")
    .map((part) => part[0])
    .join("")
    .toUpperCase()
    .slice(0, 2);
}

const STATUS_STYLES: Record<string, string> = {
  active: "bg-blue-50 text-blue-700",
  processing: "bg-amber-50 text-amber-700",
  review: "bg-amber-50 text-amber-700",
  delivered: "bg-emerald-50 text-emerald-700",
  failed: "bg-rose-50 text-rose-700",
  refunded: "bg-lav-50 text-lav-800",
  expired: "bg-slate-100 text-slate-600",
};

type StatCard = {
  label: string;
  value: string | number;
  sub: string;
  href: string;
  icon: React.ComponentType<{ className?: string }>;
  color: "lav" | "peach" | "mint" | "blue" | "rose";
  trend?: { label: string; direction: "up" | "down" | "neutral" };
};

const STAT_COLORS: Record<string, string> = {
  lav: "bg-lav-100 text-lav-700",
  peach: "bg-orange-100 text-orange-600",
  mint: "bg-green-100 text-green-600",
  blue: "bg-blue-100 text-blue-600",
  rose: "bg-rose-50 text-rose-700",
};

const TREND_STYLES: Record<string, string> = {
  up: "text-emerald-600",
  down: "text-rose-600",
  neutral: "text-ink-3",
};

const TREND_ICONS: Record<string, React.ComponentType<{ className?: string }>> = {
  up: TrendingUp,
  down: MessageCircle,
  neutral: MessageCircle,
};

export default async function AdminOverviewPage() {
  const operator = await requireAdmin("/admin/overview");

  // Core counts
  const [userStats] = await db.select({ count: count() }).from(users);
  const [orderStats] = await db.select({ count: count() }).from(orders);
  const [revenueStats] = await db
    .select({ sum: sum(orders.amount) })
    .from(orders)
    .where(eq(orders.status, "delivered"));
  const [openMessages] = await db
    .select({ count: count() })
    .from(contactMessages)
    .where(eq(contactMessages.status, "open"));
  const [escalatedRow] = await db
    .select({ count: count() })
    .from(supportTickets)
    .where(eq(supportTickets.status, "escalated"));

  const totalUsers = Number(userStats?.count ?? 0);
  const totalOrders = Number(orderStats?.count ?? 0);
  const revenue = Number(revenueStats?.sum ?? 0);
  const openMessageCount = Number(openMessages?.count ?? 0);
  const escalated = Number(escalatedRow?.count ?? 0);

  // Signup health: verified vs unverified vs closed.
  const [verifiedCountRow] = await db
    .select({ count: count() })
    .from(users)
    .where(isNotNull(users.emailVerifiedAt));
  const [closedCountRow] = await db
    .select({ count: count() })
    .from(users)
    .where(isNotNull(users.deletedAt));
  const verifiedUsers = Number(verifiedCountRow?.count ?? 0);
  const closedUsers = Number(closedCountRow?.count ?? 0);
  const unverifiedUsers = totalUsers - verifiedUsers - closedUsers;

  // Recent orders for the activity table.
  const recentOrders = await db
    .select({
      id: orders.id,
      reference: orders.reference,
      productName: orders.productName,
      planLabel: orders.planLabel,
      service: orders.service,
      amount: orders.amount,
      status: orders.status,
      createdAt: orders.createdAt,
      customerName: users.name,
      customerEmail: users.email,
    })
    .from(orders)
    .innerJoin(users, eq(orders.userId, users.id))
    .orderBy(desc(orders.createdAt))
    .limit(8);

  // Recent signups: newest accounts first.
  const signupRows = await db
    .select({
      id: users.id,
      name: users.name,
      email: users.email,
      createdAt: users.createdAt,
      emailVerifiedAt: users.emailVerifiedAt,
    })
    .from(users)
    .orderBy(desc(users.createdAt))
    .limit(6);

  const signupIds = signupRows.map((row) => row.id);
  const signupOrderCounts = new Map<string, number>();
  if (signupIds.length > 0) {
    const grouped = await db
      .select({
        userId: orders.userId,
        count: count(),
      })
      .from(orders)
      .where(inArray(orders.userId, signupIds))
      .groupBy(orders.userId);
    for (const row of grouped) {
      signupOrderCounts.set(row.userId, Number(row.count));
    }
  }

  const recentSignups = signupRows.map((row) => ({
    id: row.id,
    name: row.name,
    email: row.email,
    createdAt: row.createdAt,
    emailVerifiedAt: row.emailVerifiedAt,
    orderCount: signupOrderCounts.get(row.id) ?? 0,
  }));

  const stats: StatCard[] = [
    {
      label: "Total Users",
      value: totalUsers,
      sub: "Registered accounts",
      href: "/admin/users",
      icon: Users,
      color: "lav",
      trend: {
        label: `${verifiedUsers} verified`,
        direction: "neutral",
      },
    },
    {
      label: "Total Orders",
      value: totalOrders,
      sub: "Placed orders",
      href: "/admin/orders",
      icon: ShoppingCart,
      color: "peach",
      trend: {
        label: `${totalOrders > 0 ? Math.round((totalOrders / Math.max(totalUsers, 1)) * 100) : 0} per user`,
        direction: "neutral",
      },
    },
    {
      label: "Total Revenue",
      value: formatNaira(revenue),
      sub: "Delivered orders",
      href: "/admin/analytics",
      icon: DollarSign,
      color: "mint",
      trend: {
        label: "+0.0% vs last period",
        direction: "neutral",
      },
    },
    {
      label: "Open Messages",
      value: openMessageCount,
      sub: "From the contact form",
      href: "/admin/messages",
      icon: MessageCircle,
      color: "blue",
      trend: {
        label: openMessageCount > 0 ? "needs attention" : "all clear",
        direction: openMessageCount > 0 ? "down" : "neutral",
      },
    },
    {
      label: "Escalated Tickets",
      value: escalated,
      sub: "Needing a person",
      href: "/admin/support?status=escalated",
      icon: Shield,
      color: "rose",
      trend: {
        label: escalated > 0 ? "needs attention" : "all clear",
        direction: escalated > 0 ? "down" : "neutral",
      },
    },
  ];

  return (
    <div className="space-y-6">
      {/* Header — welcome + date range + search + notifications + profile */}
      <div
        className={cn(
          "flex flex-col lg:flex-row lg:items-center lg:justify-between gap-4 border-b border-line pb-6",
          "relative"
        )}
      >
        <div className="flex flex-col gap-1">
          <div className="flex items-center gap-2">
            <span className="text-[0.72rem] font-semibold uppercase tracking-wide text-ink-3">
              Welcome back,
            </span>
            <span className="text-[0.72rem] font-semibold uppercase tracking-wide text-ink-2">
              {operator.email.split("@")[0]}
            </span>
          </div>
          <div className="flex items-center gap-2 text-[0.82rem] text-ink-2">
            <span className="text-meta">Data showing for</span>
            <button
              className={cn(
                "flex items-center gap-1.5 rounded-lg border border-line bg-white px-3 py-1.5 text-[0.82rem] font-medium text-ink transition-colors hover:bg-cream",
                "focus-visible:outline-2 focus-visible:outline-lav-500 focus-visible:outline-offset-2"
              )}
            >
              Oct 7, 26 – Nov 5, 26
              <ChevronDown className="h-3.5 w-3.5 text-ink-3" />
            </button>
          </div>
        </div>

        <div className="flex items-center gap-2 w-full lg:w-auto max-w-[46rem]">
          <div className="relative w-full lg:w-[32rem]">
            <Search
              className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-ink-3"
              aria-hidden="true"
            />
            <input
              type="search"
              placeholder="Search orders, users, messages…"
              aria-label="Global search"
              className="field pl-9 w-full"
            />
          </div>

          <Link
            href="/admin/messages"
            className={cn(
              "relative -ml-2 lg:ml-0 rounded-lg border border-line bg-white px-3 py-2 text-[0.82rem] font-medium text-ink transition-colors",
              openMessageCount > 0 && "border-lav-400"
            )}
          >
            <Bell className="h-4 w-4 mr-1.5 text-ink-2" />
            <span className="hidden lg:inline">Messages</span>
            {openMessageCount > 0 && (
              <span className="absolute -top-1 -right-1 z-10 rounded-full bg-ink px-1.5 py-0.5 text-[0.65rem] font-bold text-white">
                {openMessageCount}
              </span>
            )}
          </Link>

          <Link
            href="/admin/account"
            className="flex items-center gap-2 rounded-lg border border-line bg-white px-3 py-2 text-[0.82rem] font-medium text-ink transition-colors hover:bg-cream"
          >
            <div
              className="h-7 w-7 rounded-full bg-lav-100 flex items-center justify-center text-lav-800 font-semibold text-[0.75rem]"
            >
              {operator.email[0].toUpperCase()}
            </div>
            <span className="hidden lg:inline">Account</span>
            <User className="h-3.5 w-3.5 ml-1 text-ink-2" />
          </Link>
        </div>
      </div>

      {/* Stat cards — Raven style: icon circle, big number, trend */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-5">
        {stats.map((stat) => {
          const Icon = stat.icon;
          const TrendIcon =
            TREND_ICONS[stat.trend?.direction ?? "neutral"] ?? MessageCircle;
          const trendStyle = TREND_STYLES[stat.trend?.direction ?? "neutral"];
          return (
            <Link
              key={stat.label}
              href={stat.href}
              className={cn(
                "flex flex-col rounded-2xl border border-line bg-white p-5 transition-colors",
                "hover:bg-cream/50 focus-visible:outline-2 focus-visible:outline-lav-500 focus-visible:outline-offset-2"
              )}
            >
              <div className="flex items-center justify-between mb-4">
                <div
                  className={`grid h-11 w-11 place-items-center rounded-xl ${STAT_COLORS[stat.color]}`}
                >
                  <Icon className="h-5 w-5" />
                </div>
                <TrendIcon className="h-4 w-4 text-ink-3" />
              </div>
              <p className="text-meta text-ink-2">{stat.label}</p>
              <p className="mt-1 text-[1.75rem] font-bold text-ink">
                {stat.value}
              </p>
              <p className={cn("mt-auto mt-3 text-[0.7rem] font-medium", trendStyle)}>
                {stat.trend?.label}
              </p>
              <p className="mt-0.5 text-[0.68rem] text-ink-3">{stat.sub}</p>
            </Link>
          );
        })}
      </div>

      {/* Widget grid */}
      <div className="grid gap-6 lg:grid-cols-3">
        {/* Recent Activity — 2 columns */}
        <div className="lg:col-span-2 rounded-2xl border border-line bg-white p-6">
          <div className="flex items-center justify-between mb-5">
            <h2 className="text-[1rem] font-semibold text-ink">
              Recent Activity
            </h2>
            <Link
              href="/admin/orders"
              className="text-[0.78rem] font-medium text-lav-700 underline underline-offset-2 hover:text-lav-800"
            >
              View all orders <ArrowRight className="h-3.5 w-3.5 ml-1" />
            </Link>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full min-w-[56rem] text-left text-[0.82rem]">
              <thead className="bg-cream/70 text-meta uppercase tracking-wide text-ink-3">
                <tr>
                  <th className="px-4 py-3 font-semibold">Order</th>
                  <th className="px-4 py-3 font-semibold">Customer</th>
                  <th className="px-4 py-3 font-semibold">Service</th>
                  <th className="px-4 py-3 font-semibold">Amount</th>
                  <th className="px-4 py-3 font-semibold">Status</th>
                  <th className="px-4 py-3 font-semibold">Placed</th>
                </tr>
              </thead>
              <tbody>
                {recentOrders.length === 0 && (
                  <tr>
                    <td colSpan={6} className="px-4 py-10 text-center text-ink-2">
                      No recent orders.
                    </td>
                  </tr>
                )}
                {recentOrders.map((row) => (
                  <tr key={row.id} className="border-t border-line/70">
                    <td className="px-4 py-3">
                      <p className="font-mono text-micro text-ink-2">
                        {row.reference}
                      </p>
                      <p className="text-meta text-ink-2">{row.productName}</p>
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-2">
                        <div
                          className="grid h-6 w-6 place-items-center rounded-full bg-cream text-ink-2 text-[0.65rem] font-semibold"
                          title={row.customerEmail}
                        >
                          {initials(row.customerName)}
                        </div>
                        <div>
                          <p className="font-medium text-ink">
                            {row.customerName ?? row.customerEmail}
                          </p>
                          <p className="text-[0.75rem] text-ink-3 truncate max-w-[14rem]" title={row.customerEmail}>
                            {row.customerEmail}
                          </p>
                        </div>
                      </div>
                    </td>
                    <td className="px-4 py-3 capitalize text-ink-2">
                      {row.service.replace(/_/g, " ")}
                    </td>
                    <td className="px-4 py-3 font-medium">{formatNaira(row.amount)}</td>
                    <td className="px-4 py-3">
                      <span
                        className={cn(
                          "rounded-full px-2 py-0.5 text-meta font-semibold",
                          STATUS_STYLES[row.status] ??
                            "bg-cream text-ink-2"
                        )}
                      >
                        {row.status.replace(/_/g, " ")}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-[0.75rem] text-ink-2">
                      {formatDateTime(row.createdAt)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        {/* Signup health — 1 column */}
        <div className="rounded-2xl border border-line bg-white p-6">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-[1rem] font-semibold text-ink">New Signups</h2>
            <Link
              href="/admin/users"
              className="text-[0.78rem] font-medium text-lav-700 underline underline-offset-2 hover:text-lav-800"
            >
              View all users <ArrowRight className="h-3.5 w-3.5 ml-1" />
            </Link>
          </div>

          <div className="space-y-4">
            {[verifiedUsers, unverifiedUsers, closedUsers].map((value, idx) => {
              const label =
                idx === 0
                  ? "Verified email"
                  : idx === 1
                    ? "Unverified"
                    : "Closed accounts";
              const color =
                idx === 0
                  ? "bg-emerald-50 text-emerald-700"
                  : idx === 1
                    ? "bg-amber-50 text-amber-700"
                    : "bg-slate-100 text-slate-600";
              const share = totalUsers > 0 ? (value / totalUsers) * 100 : 0;
              return (
                <div key={label} className="space-y-1.5">
                  <div className="flex items-center justify-between">
                    <span className="text-[0.78rem] text-ink-2">{label}</span>
                    <span className="text-[0.78rem] font-medium text-ink">
                      {value.toLocaleString("en-NG")}
                    </span>
                  </div>
                  <div className="h-1.5 w-full rounded-full bg-cream overflow-hidden">
                    <div
                      className={`h-full ${color}`}
                      style={{ width: `${Math.min(share, 100)}%` }}
                    />
                  </div>
                  <span className="text-[0.68rem] text-ink-3">
                    {share.toFixed(1)}% of accounts
                  </span>
                </div>
              );
            })}
          </div>

          <div className="mt-5 border-t border-line pt-4">
            <p className="mb-2 text-[0.68rem] text-ink-3">
              Unverified accounts with no orders are the usual spam pattern.
              Signup source and IP address aren&apos;t recorded yet — that needs to
              be added to the signup flow.
            </p>
          </div>
        </div>

        {/* Top Products — 1 column */}
        <div className="rounded-2xl border border-line bg-white p-6">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-[1rem] font-semibold text-ink">Top Products</h2>
            <Link
              href="/admin/orders"
              className="text-[0.78rem] font-medium text-lav-700 underline underline-offset-2 hover:text-lav-800"
            >
              View all orders <ArrowRight className="h-3.5 w-3.5 ml-1" />
            </Link>
          </div>

          <div className="space-y-3">
            {recentOrders.slice(0, 6).map((row) => (
              <div
                key={row.id}
                className="flex items-center justify-between gap-3 border-b border-line/50 pb-2 last:border-0 last:pb-0"
              >
                <div className="flex-1 min-w-0">
                  <p className="text-[0.8rem] font-medium text-ink truncate">
                    {row.productName}
                  </p>
                  <p className="text-[0.7rem] text-ink-3 truncate">
                    {row.service.replace(/_/g, " ")} · {row.planLabel}
                  </p>
                </div>
                <div className="text-right">
                  <p className="text-[0.8rem] font-medium text-ink">
                    {formatNaira(row.amount)}
                  </p>
                  <span
                    className={cn(
                      "rounded-full px-2 py-0.5 text-meta font-semibold",
                      STATUS_STYLES[row.status] ??
                        "bg-cream text-ink-2"
                    )}
                  >
                    {row.status.replace(/_/g, " ")}
                  </span>
                </div>
              </div>
            ))}
            {recentOrders.length === 0 && (
              <p className="text-[0.8rem] text-ink-2 text-center py-8">
                No orders yet.
              </p>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
