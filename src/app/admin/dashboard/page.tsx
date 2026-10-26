import { redirect } from "next/navigation";
import { requireAuth } from "@/lib/auth";
import { db } from "@/db";
import { users, orders, walletTransactions } from "@/db/schema";
import { count, sum, desc, eq } from "drizzle-orm";
import Link from "next/link";
import { Users, ShoppingCart, DollarSign, TrendingUp } from "@/components/icons";

export default async function AdminDashboardPage() {
  const user = await requireAuth();
  if (!user) redirect("/login?next=/admin/dashboard");

  // Fetch admin statistics
  const [userStats] = await db.select({ count: count() }).from(users);
  const [orderStats] = await db.select({ count: count() }).from(orders);
  const [revenueStats] = await db
    .select({ sum: sum(orders.amount) })
    .from(orders)
    .where(eq(orders.status, "delivered"));

  const recentOrders = await db.query.orders.findMany({
    orderBy: [desc(orders.createdAt)],
    limit: 10,
  });

  const stats = [
    {
      label: "Total Users",
      value: userStats?.count || 0,
      icon: Users,
      color: "lav",
      href: "/admin/users",
    },
    {
      label: "Total Orders",
      value: orderStats?.count || 0,
      icon: ShoppingCart,
      color: "peach",
      href: "/admin/orders",
    },
    {
      label: "Total Revenue",
      value: `₦${(revenueStats?.sum || 0).toLocaleString()}`,
      icon: DollarSign,
      color: "mint",
      href: "/admin/analytics",
    },
    {
      label: "Growth",
      value: "+12%",
      icon: TrendingUp,
      color: "blue",
      href: "/admin/analytics",
    },
  ];

  return (
    <div className="min-h-screen bg-cream p-6 dark:bg-gray-900">
      <div className="mx-auto max-w-7xl space-y-6">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-[2rem] font-medium tracking-tight text-ink dark:text-gray-100">
              Admin Dashboard
            </h1>
            <p className="mt-2 text-[0.95rem] text-ink-2 dark:text-gray-400">
              Platform overview and management
            </p>
          </div>
          <Link
            href="/dashboard"
            className="rounded-xl border border-line bg-white px-4 py-2 text-[0.86rem] font-medium text-ink hover:bg-cream dark:bg-gray-800 dark:border-gray-700 dark:text-gray-100 dark:hover:bg-gray-700"
          >
            Back to Dashboard
          </Link>
        </div>

        {/* Stats Grid */}
        <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-4">
          {stats.map((stat) => {
            const Icon = stat.icon;
            return (
              <Link
                key={stat.label}
                href={stat.href}
                className="rounded-2xl border border-line bg-white p-6 transition-colors hover:bg-cream dark:bg-gray-800 dark:border-gray-700 dark:hover:bg-gray-700"
              >
                <div className="flex items-center justify-between mb-4">
                  <span
                    className={`grid h-12 w-12 place-items-center rounded-xl ${
                      stat.color === "lav"
                        ? "bg-lav-100 text-lav-600 dark:bg-lav-900/30 dark:text-lav-400"
                        : stat.color === "peach"
                        ? "bg-orange-100 text-orange-600 dark:bg-orange-900/30 dark:text-orange-400"
                        : stat.color === "mint"
                        ? "bg-green-100 text-green-600 dark:bg-green-900/30 dark:text-green-400"
                        : "bg-blue-100 text-blue-600 dark:bg-blue-900/30 dark:text-blue-400"
                    }`}
                  >
                    <Icon className="h-6 w-6" />
                  </span>
                </div>
                <p className="text-[0.86rem] text-ink-2 dark:text-gray-400 mb-1">{stat.label}</p>
                <p className="text-[2rem] font-bold text-ink dark:text-gray-100">{stat.value}</p>
              </Link>
            );
          })}
        </div>

        {/* Recent Orders */}
        <div className="rounded-2xl border border-line bg-white p-6 dark:bg-gray-800 dark:border-gray-700">
          <h2 className="text-[1.25rem] font-semibold text-ink dark:text-gray-100 mb-4">
            Recent Orders
          </h2>
          <div className="space-y-3">
            {recentOrders.length === 0 ? (
              <p className="text-[0.9rem] text-ink-2 dark:text-gray-400 text-center py-8">
                No orders yet
              </p>
            ) : (
              recentOrders.map((order) => (
                <div
                  key={order.id}
                  className="flex items-center justify-between border-b border-line pb-3 last:border-0 dark:border-gray-700"
                >
                  <div>
                    <p className="text-[0.9rem] font-medium text-ink dark:text-gray-100">
                      {order.productName}
                    </p>
                    <p className="text-[0.82rem] text-ink-2 dark:text-gray-400">
                      {order.reference} · {new Date(order.createdAt).toLocaleDateString()}
                    </p>
                  </div>
                  <div className="text-right">
                    <p className="text-[0.9rem] font-semibold text-ink dark:text-gray-100">
                      ₦{order.amount.toLocaleString()}
                    </p>
                    <p className="text-[0.78rem] text-ink-2 dark:text-gray-400 capitalize">
                      {order.status}
                    </p>
                  </div>
                </div>
              ))
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
