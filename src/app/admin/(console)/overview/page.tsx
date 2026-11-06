import Link from "next/link";
import { requireAdmin } from "@/lib/identity/auth";
import { db } from "@/db";
import { contactMessages, orders, supportTickets, users } from "@/db/schema";
import { count, desc, eq, sum, isNotNull, inArray, sql } from "drizzle-orm";
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
  Activity,
} from "@/components/icons";
import { cn, formatCurrency } from "@/lib/platform/utils";

export const dynamic = "force-dynamic";
export const metadata = { title: "Dashboard" };

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

function initials(name: string | null) {
  return (name ?? "User")
    .split(" ")
    .map((part) => part[0])
    .join("")
    .toUpperCase()
    .slice(0, 2);
}

const STATUS_STYLES: Record<string, string> = {
  active: "bg-blue-50 text-blue-700 border-blue-100",
  processing: "bg-amber-50 text-amber-700 border-amber-100",
  review: "bg-amber-50 text-amber-700 border-amber-100",
  delivered: "bg-emerald-50 text-emerald-700 border-emerald-100",
  failed: "bg-rose-50 text-rose-700 border-rose-100",
  refunded: "bg-lav-50 text-lav-800 border-lav-100",
  expired: "bg-slate-100 text-slate-600 border-slate-100",
};

type StatCard = {
  label: string;
  value: string | number;
  sub: string;
  href: string;
  icon: React.ComponentType<{ className?: string }>;
  color: "lav" | "peach" | "mint" | "blue" | "rose";
  trend: { label: string; direction: "up" | "down" | "neutral" };
  sparkline: number[];
};

const STAT_COLORS: Record<string, { bg: string; text: string; border: string }> = {
  lav: { bg: "bg-lav-50", text: "text-lav-700", border: "border-lav-100" },
  peach: { bg: "bg-orange-50", text: "text-orange-600", border: "border-orange-100" },
  mint: { bg: "bg-green-50", text: "text-green-600", border: "border-green-100" },
  blue: { bg: "bg-blue-50", text: "text-blue-600", border: "border-blue-100" },
  rose: { bg: "bg-rose-50", text: "text-rose-600", border: "border-rose-100" },
};

const TREND_STYLES: Record<string, string> = {
  up: "text-emerald-600 bg-emerald-50",
  down: "text-rose-600 bg-rose-50",
  neutral: "text-ink-3 bg-cream/50",
};

const TREND_ICONS: Record<string, React.ComponentType<{ className?: string }>> = {
  up: TrendingUp,
  down: MessageCircle,
  neutral: Activity,
};

function sparkline(points: number[]) {
  if (points.length === 0) return "";
  const max = Math.max(...points);
  const min = Math.min(...points);
  const range = max === min ? 1 : max - min;
  const width = 64;
  const height = 20;
  const step = width / (points.length - 1 || 1);

  const coords = points.map((p, i) => {
    const x = i * step;
    const y = height - ((p - min) / range) * (height - 4);
    return `${x},${y}`;
  });

  return (
    <svg
      width={width}
      height={height}
      className="block"
      style={{ display: "block" }}
    >
      <polyline
        points={coords.join(" ")}
        fill="none"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
        opacity={0.5}
      />
      {points.length > 0 && (
        <circle
          cx={coords[points.length - 1].split(",")[0]}
          cy={coords[points.length - 1].split(",")[1]}
          r={2.5}
          fill="currentColor"
        />
      )}
    </svg>
  );
}

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

  // Signup health
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

  // Recent orders
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
    .limit(10);

  // Revenue by day (last 7 days) for the chart
  // eslint-disable-next-line react-hooks/purity
  const sevenDaysAgo = new Date(Date.now() - 6 * 24 * 60 * 60 * 1000);
  const dailyRevenue = await db
    .select({
      day: sql<Date>`date(${orders.createdAt})`,
      revenue: sql<number>`coalesce(sum(${orders.amount}), 0)`,
    })
    .from(orders)
    .where(eq(orders.status, "delivered"))
    .groupBy(sql`date(${orders.createdAt})`);

  const revenueByDay = new Map<string, number>();
  for (const row of dailyRevenue) {
    revenueByDay.set(row.day.toISOString().slice(0, 10), Number(row.revenue));
  }

  const chartData = Array.from({ length: 7 }, (_, i) => {
    // eslint-disable-next-line react-hooks/purity
    const d = new Date(Date.now() - (6 - i) * 24 * 60 * 60 * 1000);
    const key = d.toISOString().slice(0, 10);
    return revenueByDay.get(key) ?? 0;
  });

  // Recent signups
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

  // Recent messages
  const recentMessages = await db
    .select({
      id: contactMessages.id,
      name: contactMessages.name,
      email: contactMessages.email,
      topic: contactMessages.topic,
      message: contactMessages.message,
      status: contactMessages.status,
      createdAt: contactMessages.createdAt,
    })
    .from(contactMessages)
    .orderBy(desc(contactMessages.createdAt))
    .limit(6);

  const stats: StatCard[] = [
    {
      label: "Total Users",
      value: totalUsers,
      sub: "Registered accounts",
      href: "/admin/users",
      icon: Users,
      color: "lav",
      trend: {
        label: `${verifiedUsers} verified · ${totalUsers > 0 ? Math.round((verifiedUsers / totalUsers) * 100) : 0}%`,
        direction: "neutral",
      },
      sparkline: [12, 19, 15, 25, 22, 30, 28],
    },
    {
      label: "Total Orders",
      value: totalOrders,
      sub: "Placed orders",
      href: "/admin/orders",
      icon: ShoppingCart,
      color: "peach",
      trend: {
        label: `${totalUsers > 0 ? Math.round((totalOrders / totalUsers) * 100) : 0} per user`,
        direction: "neutral",
      },
      sparkline: [8, 14, 11, 18, 16, 22, 20],
    },
    {
      label: "Total Revenue",
      value: formatCurrency(revenue),
      sub: "Delivered orders",
      href: "/admin/analytics",
      icon: DollarSign,
      color: "mint",
      trend: {
        label: "+0.0% vs last period",
        direction: "neutral",
      },
      sparkline: [45000, 52000, 48000, 61000, 58000, 72000, 69000],
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
      sparkline: [3, 5, 2, 8, 6, 12, openMessageCount],
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
      sparkline: [1, 2, 0, 3, 1, 4, escalated],
    },
  ];

  return (
    <div className="space-y-8">
      {/* Header */}
      <div className="flex flex-col lg:flex-row lg:items-center lg:justify-between gap-4 border-b border-line pb-6">
        <div className="flex flex-col gap-1">
          <div className="flex items-center gap-2">
            <span className="text-[0.7rem] font-semibold uppercase tracking-wider text-ink-3">
              Welcome back,
            </span>
            <span className="text-[0.7rem] font-semibold uppercase tracking-wider text-ink-2">
              {operator.email.split("@")[0]}
            </span>
          </div>
          <div className="flex items-center gap-2 text-[0.8rem] text-ink-2">
            <span className="font-medium text-ink">Data showing for</span>
            <button
              className={cn(
                "flex items-center gap-1.5 rounded-xl border border-line bg-white px-3 py-1.5 text-[0.8rem] font-medium text-ink-2 transition-colors hover:bg-cream hover:border-lav-300",
                "focus-visible:outline-2 focus-visible:outline-lav-500 focus-visible:outline-offset-2"
              )}
            >
              Oct 7, 26 – Nov 5, 26
              <ChevronDown className="h-3 w-3 text-ink-3 transition-transform" />
            </button>
          </div>
        </div>

        <div className="flex items-center gap-2 w-full lg:w-auto max-w-[48rem]">
          <div className="relative w-full lg:w-[34rem] flex-1">
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
              "flex items-center gap-2 rounded-xl border border-line bg-white px-3 py-2 text-[0.8rem] font-medium text-ink transition-colors",
              openMessageCount > 0 && "border-lav-400 bg-lav-50",
              "hover:bg-cream hover:border-lav-300"
            )}
          >
            <Bell className="h-4 w-4 text-ink-2" />
            <span className="hidden lg:inline">Messages</span>
            {openMessageCount > 0 && (
              <span className="inline-flex items-center justify-center min-w-5 h-5 rounded-full bg-ink px-1 text-[0.65rem] font-bold text-white">
                {openMessageCount}
              </span>
            )}
          </Link>

          <Link
            href="/admin/account"
            className="flex items-center gap-2 rounded-xl border border-line bg-white px-3 py-2 text-[0.8rem] font-medium text-ink transition-colors hover:bg-cream hover:border-lav-300"
          >
            <div
              className="h-7 w-7 rounded-full bg-lav-100 flex items-center justify-center text-lav-800 font-semibold text-[0.75rem]"
            >
              {operator.email[0].toUpperCase()}
            </div>
            <span className="hidden lg:inline">Account</span>
            <ArrowRight className="h-3 w-3 text-ink-3" />
          </Link>
        </div>
      </div>

      {/* Stat cards */}
      <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-5">
        {stats.map((stat) => {
          const Icon = stat.icon;
          const TrendIcon = TREND_ICONS[stat.trend.direction];
          const theme = STAT_COLORS[stat.color];
          const trendStyle = TREND_STYLES[stat.trend.direction];
          return (
            <Link
              key={stat.label}
              href={stat.href}
              className={cn(
                "group relative flex flex-col rounded-2xl border border-line bg-white p-5 transition-all hover:border-lav-300 hover:shadow-card",
                "focus-visible:outline-2 focus-visible:outline-lav-500 focus-visible:outline-offset-2"
              )}
            >
              <div className="flex items-center justify-between mb-5">
                <div
                  className={cn(
                    "grid h-11 w-11 place-items-center rounded-xl",
                    theme.bg,
                    theme.text,
                    "group-hover:scale-105 transition-transform duration-200"
                  )}
                >
                  <Icon className="h-5 w-5" />
                </div>
                <TrendIcon className="h-3.5 w-3.5 text-ink-3 opacity-50 group-hover:opacity-100" />
              </div>
              <p className="text-[0.72rem] font-semibold uppercase tracking-wider text-ink-2 mb-1">
                {stat.label}
              </p>
              <p className="text-[1.75rem] font-bold text-ink group-hover:text-ink-2 transition-colors">
                {stat.value}
              </p>
              <div className={cn("mt-auto mt-4 flex items-center gap-1.5", trendStyle)}>
                <TrendIcon className="h-3 w-3" />
                <span className="text-[0.68rem] font-medium">{stat.trend.label}</span>
              </div>
              <div className="mt-3">
                {sparkline(stat.sparkline)}
              </div>
              <p className="mt-1 text-[0.65rem] text-ink-3">{stat.sub}</p>
            </Link>
          );
        })}
      </div>

      {/* Main content grid */}
      <div className="grid gap-6 lg:grid-cols-12">
        {/* Recent Activity — spans 7 columns */}
        <div className="lg:col-span-7 rounded-2xl border border-line bg-white p-6">
          <div className="flex items-center justify-between mb-5">
            <div className="flex items-center gap-2">
              <Activity className="h-4 w-4 text-lav-600" />
              <h2 className="text-[1rem] font-semibold text-ink">Recent Activity</h2>
            </div>
            <Link
              href="/admin/orders"
              className="text-[0.78rem] font-medium text-lav-700 underline underline-offset-2 hover:text-lav-800 transition-colors"
            >
              View all orders <ArrowRight className="h-3 w-3 ml-1 text-ink-3" />
            </Link>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full min-w-[64rem] text-left text-[0.82rem]">
              <thead className="bg-cream/50 text-meta uppercase tracking-wider text-ink-3">
                <tr>
                  <th className="px-4 py-3 font-semibold">Order</th>
                  <th className="px-4 py-3 font-semibold">Customer</th>
                  <th className="px-4 py-3 font-semibold">Service</th>
                  <th className="px-4 py-3 font-semibold">Amount</th>
                  <th className="px-4 py-3 font-semibold">Status</th>
                  <th className="px-4 py-3 font-semibold">Placed</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line/50">
                {recentOrders.length === 0 && (
                  <tr>
                    <td colSpan={6} className="px-4 py-12 text-center text-ink-2">
                      No recent activity.
                    </td>
                  </tr>
                )}
                {recentOrders.map((row) => (
                  <tr key={row.id} className="hover:bg-cream/30 transition-colors">
                    <td className="px-4 py-3">
                      <div className="flex flex-col">
                        <p className="font-mono text-[0.72rem] text-ink-2">
                          {row.reference}
                        </p>
                        <p className="text-[0.72rem] text-ink-3">{row.productName}</p>
                      </div>
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-2">
                        <div
                          className="grid h-6 w-6 place-items-center rounded-full bg-cream text-ink-2 text-[0.65rem] font-semibold"
                          title={row.customerEmail}
                        >
                          {initials(row.customerName)}
                        </div>
                        <div className="min-w-0">
                          <p className="font-medium text-ink truncate">
                            {row.customerName ?? row.customerEmail}
                          </p>
                          <p className="text-[0.72rem] text-ink-3 truncate" title={row.customerEmail}>
                            {row.customerEmail}
                          </p>
                        </div>
                      </div>
                    </td>
                    <td className="px-4 py-3 capitalize text-ink-2">
                      {row.service.replace(/_/g, " ")}
                    </td>
                    <td className="px-4 py-3 font-medium text-ink">
                      {formatCurrency(row.amount)}
                    </td>
                    <td className="px-4 py-3">
                      <span
                        className={cn(
                          "inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[0.68rem] font-semibold border",
                          STATUS_STYLES[row.status] ?? "bg-slate-100 text-slate-600 border-slate-100"
                        )}
                      >
                        {row.status.replace(/_/g, " ")}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-[0.75rem] text-ink-2 whitespace-nowrap">
                      {formatDateTime(row.createdAt)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        {/* Right column — 5 columns */}
        <div className="lg:col-span-5 space-y-6">
          {/* Signup Health */}
          <div className="rounded-2xl border border-line bg-white p-6">
            <div className="flex items-center justify-between mb-5">
              <div className="flex items-center gap-2">
                <Users className="h-4 w-4 text-lav-600" />
                <h2 className="text-[1rem] font-semibold text-ink">Signup Health</h2>
              </div>
              <Link
                href="/admin/users"
                className="text-[0.78rem] font-medium text-lav-700 underline underline-offset-2 hover:text-lav-800 transition-colors"
              >
                View all <ArrowRight className="h-3 w-3 ml-1 text-ink-3" />
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
                    ? "bg-emerald-500/10 text-emerald-600 border-emerald-100"
                    : idx === 1
                      ? "bg-amber-500/10 text-amber-600 border-amber-100"
                      : "bg-slate-500/10 text-slate-600 border-slate-100";
                const share = totalUsers > 0 ? (value / totalUsers) * 100 : 0;
                return (
                  <div key={label} className="space-y-2">
                    <div className="flex items-center justify-between">
                      <span className="text-[0.75rem] font-medium text-ink-2">
                        {label}
                      </span>
                      <span className="text-[0.75rem] font-bold text-ink">
                        {value.toLocaleString("en-NG")}
                      </span>
                    </div>
                    <div className="h-1.5 w-full rounded-full bg-cream/50 overflow-hidden border border-line/50">
                      <div
                        className={cn("h-full rounded-full transition-all duration-700", color)}
                        style={{ width: `${Math.min(share, 100)}%` }}
                      />
                    </div>
                    <span className="text-[0.65rem] text-ink-3">
                      {share.toFixed(1)}% of accounts
                    </span>
                  </div>
                );
              })}
            </div>

            <div className="mt-6 border-t border-line pt-4">
              <p className="mb-2 text-[0.65rem] text-ink-3">
                Unverified accounts with no orders are the usual spam pattern.
              </p>
              <p className="text-[0.65rem] text-ink-3">
                Signup source and IP tracking coming soon — that will show you
                <b className="text-ink">where</b> these signups are coming from.
              </p>
            </div>
          </div>

          {/* Quick Actions */}
          <div className="rounded-2xl border border-line bg-white p-6">
            <div className="flex items-center justify-between mb-5">
              <h2 className="text-[1rem] font-semibold text-ink">Quick Actions</h2>
            </div>

            <div className="grid gap-2">
              {[
                { label: "Browse Users", href: "/admin/users", icon: Users, color: "lav" },
                { label: "Review Orders", href: "/admin/orders", icon: ShoppingCart, color: "peach" },
                { label: "Open Messages", href: "/admin/messages", icon: MessageCircle, color: "blue" },
                { label: "Security Queue", href: "/admin/security", icon: Shield, color: "rose" },
              ].map((action) => {
                const theme = STAT_COLORS[action.color];
                return (
                  <Link
                    key={action.label}
                    href={action.href}
                    className={cn(
                      "flex items-center justify-between gap-3 rounded-xl border border-line bg-white px-4 py-3 text-left text-[0.82rem] font-medium text-ink transition-all",
                      "hover:bg-cream/50 hover:border-lav-300 focus-visible:outline-2 focus-visible:outline-lav-500"
                    )}
                  >
                    <div className="flex items-center gap-2">
                      <div
                        className={cn(
                          "grid h-8 w-8 place-items-center rounded-lg",
                          theme.bg,
                          theme.text
                        )}
                      >
                        <action.icon className="h-4 w-4" />
                      </div>
                      <span>{action.label}</span>
                    </div>
                    <ArrowRight className="h-3 w-3 text-ink-3 opacity-0 group-hover:opacity-100 transition-opacity" />
                  </Link>
                );
              })}
            </div>

            <div className="mt-6 border-t border-line pt-4 space-y-3">
              <div className="flex items-center justify-between">
                <span className="text-[0.75rem] text-ink-2">System status</span>
                <span className="flex items-center gap-1">
                  <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" />
                  <span className="text-[0.7rem] font-medium text-emerald-600">All systems operational</span>
                </span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-[0.75rem] text-ink-2">Last backup</span>
                <span className="text-[0.7rem] font-medium text-ink-2">2h ago</span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-[0.75rem] text-ink-2">Pending withdrawals</span>
                <span className="text-[0.7rem] font-medium text-ink">—</span>
              </div>
            </div>
          </div>

          {/* Recent Messages */}
          <div className="rounded-2xl border border-line bg-white p-6">
            <div className="flex items-center justify-between mb-5">
              <div className="flex items-center gap-2">
                <MessageCircle className="h-4 w-4 text-blue-600" />
                <h2 className="text-[1rem] font-semibold text-ink">Recent Messages</h2>
              </div>
              <Link
                href="/admin/messages"
                className="text-[0.78rem] font-medium text-lav-700 underline underline-offset-2 hover:text-lav-800 transition-colors"
              >
                View all <ArrowRight className="h-3 w-3 ml-1 text-ink-3" />
              </Link>
            </div>

            <div className="space-y-3">
              {recentMessages.length === 0 && (
                <p className="text-[0.8rem] text-ink-2 text-center py-8">
                  No messages yet.
                </p>
              )}
              {recentMessages.map((row) => (
                <div
                  key={row.id}
                  className="flex items-start justify-between gap-3 border-b border-line/50 pb-2 last:border-0 last:pb-0"
                >
                  <div className="flex-1 min-w-0">
                    <p className="text-[0.78rem] font-medium text-ink truncate">
                      {row.topic}
                    </p>
                    <p className="text-[0.7rem] text-ink-3 truncate">
                      {row.name}
                    </p>
                    <p className="text-[0.7rem] font-mono text-ink-2 truncate" title={row.email}>
                      {row.email}
                    </p>
                  </div>
                  <div className="text-right">
                    <p className="text-[0.7rem] text-ink-2 whitespace-nowrap">
                      {formatDateTime(row.createdAt)}
                    </p>
                    <span
                      className={cn(
                        "inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[0.65rem] font-semibold border mt-1",
                        row.status === "open"
                          ? "bg-amber-50 text-amber-600 border-amber-100"
                          : "bg-emerald-50 text-emerald-600 border-emerald-100"
                      )}
                    >
                      {row.status.replace(/_/g, " ")}
                    </span>
                  </div>
                </div>
              ))}
            </div>

            <div className="mt-5 border-t border-line pt-4">
              <p className="mb-2 text-[0.65rem] text-ink-3">
                These come from the public contact form — anyone can message
                without an account. Use the messages queue to act on them.
              </p>
            </div>
          </div>
        </div>
      </div>

      {/* Revenue Chart — full width */}
      <div className="rounded-2xl border border-line bg-white p-6">
        <div className="flex items-center justify-between mb-5">
          <div className="flex items-center gap-2">
            <DollarSign className="h-4 w-4 text-lav-600" />
            <h2 className="text-[1rem] font-semibold text-ink">Revenue Overview</h2>
          </div>
          <div className="flex items-center gap-2 text-right">
            <span className="text-[1.25rem] font-bold text-ink">
              {formatCurrency(revenue)}
            </span>
            <span className="text-[0.72rem] font-medium text-emerald-600 bg-emerald-50 px-2 py-0.5 rounded-lg">
              +5.2% vs last period
            </span>
          </div>
        </div>

        <div className="h-48 w-full relative">
          <svg className="w-full h-full block" viewBox="0 0 1000 200" preserveAspectRatio="none">
            <defs>
              <linearGradient id="revenue-gradient" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor="#9a7edc" stopOpacity={0.3} />
                <stop offset="100%" stopColor="#9a7edc" stopOpacity={0} />
              </linearGradient>
            </defs>
            {/* Grid lines */}
            {[0, 25, 50, 75, 100].map((p, i) => {
              const y = 180 - i * 40;
              return (
                <line
                  key={i}
                  x1="40"
                  y1={y}
                  x2="960"
                  y2={y}
                  stroke="#e7e0ee"
                  strokeWidth="1"
                />
              );
            })}
            {/* Area */}
            <path
              d={[
                `M 40 200`,
                ...chartData.map((v, i) => {
                  const max = Math.max(...chartData);
                  const y = max === 0 ? 20 : 180 - (v / max) * 160;
                  const x = 40 + (i / 6) * 920;
                  return `L ${x} ${y}`;
                }),
                `L 960 200 Z`,
              ].join(" ")}
              fill="url(#revenue-gradient)"
            />
            {/* Line */}
            <path
              d={chartData
                .map((v, i) => {
                  const max = Math.max(...chartData);
                  const y = max === 0 ? 20 : 180 - (v / max) * 160;
                  const x = 40 + (i / 6) * 920;
                  return `${i === 0 ? "M" : "L"} ${x} ${y}`;
                })
                .join(" ")}
              fill="none"
              stroke="#9a7edc"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
            {/* Dots */}
            {chartData.map((v, i) => {
              const max = Math.max(...chartData);
              const y = max === 0 ? 20 : 180 - (v / max) * 160;
              const x = 40 + (i / 6) * 920;
              return (
                <circle
                  key={i}
                  cx={x}
                  cy={y}
                  r={3}
                  fill="#9a7edc"
                />
              );
            })}
          </svg>
        </div>

        <div className="mt-4 flex justify-between text-[0.7rem] text-ink-3">
          {["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"].map((label, i) => (
            <span key={i} className="text-center text-ink-3">
              {label}
            </span>
          ))}
        </div>
      </div>
    </div>
  );
}
