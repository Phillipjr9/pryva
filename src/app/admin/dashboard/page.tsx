import { requireAdmin } from "@/lib/auth";
import { db } from "@/db";
import { users, orders, contactMessages, supportTickets } from "@/db/schema";
import { count, sum, desc, eq } from "drizzle-orm";
import Link from "next/link";
import { Users, ShoppingCart, DollarSign, MessageCircle } from "@/components/icons";

export default async function AdminDashboardPage() {
  await requireAdmin("/admin/dashboard");

  // Fetch admin statistics
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

  // The number worth showing is the one somebody has to act on. "Open support
  // messages" counted form submissions nobody had touched; tickets the assistant
  // could not settle are the ones with a person's name on them.
  const [escalatedRow] = await db
    .select({ count: count() })
    .from(supportTickets)
    .where(eq(supportTickets.status, "escalated"));
  const escalatedTickets = Number(escalatedRow?.count ?? 0);

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
      // This used to be a hard-coded "+12%" growth figure: an invented number
      // presented as a metric, linking to a page that does not compute it.
      label: "Tickets needing a person",
      value: escalatedTickets ?? 0,
      icon: MessageCircle,
      color: "blue",
      href: "/admin/support?status=escalated",
    },
  ];

  return (
    <div>
      <div className="mx-auto max-w-7xl space-y-6">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-[2rem] font-medium tracking-tight text-ink">
              Admin Dashboard
            </h1>
            <p className="mt-2 text-[0.95rem] text-ink-2">
              Platform overview and management
            </p>
          </div>
          <Link
            href="/dashboard"
            className="rounded-xl border border-line bg-white px-4 py-2 text-[0.86rem] font-medium text-ink hover:bg-cream"
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
                className="rounded-2xl border border-line bg-white p-6 transition-colors hover:bg-cream"
              >
                <div className="flex items-center justify-between mb-4">
                  <span
                    className={`grid h-12 w-12 place-items-center rounded-xl ${
                      stat.color === "lav"
                        ? "bg-lav-100 text-lav-600"
                        : stat.color === "peach"
                        ? "bg-orange-100 text-orange-600"
                        : stat.color === "mint"
                        ? "bg-green-100 text-green-600"
                        : "bg-blue-100 text-blue-600"
                    }`}
                  >
                    <Icon className="h-6 w-6" />
                  </span>
                </div>
                <p className="text-[0.86rem] text-ink-2 mb-1">{stat.label}</p>
                <p className="text-[2rem] font-bold text-ink">{stat.value}</p>
              </Link>
            );
          })}
        </div>

        {/* Recent Orders */}
        <div className="rounded-2xl border border-line bg-white p-6">
          <h2 className="text-[1.25rem] font-semibold text-ink mb-4">
            Recent Orders
          </h2>
          <div className="space-y-3">
            {recentOrders.length === 0 ? (
              <p className="text-[0.9rem] text-ink-2 text-center py-8">
                No orders yet
              </p>
            ) : (
              recentOrders.map((order) => (
                <div
                  key={order.id}
                  className="flex items-center justify-between border-b border-line pb-3 last:border-0"
                >
                  <div>
                    <p className="text-[0.9rem] font-medium text-ink">
                      {order.productName}
                    </p>
                    <p className="text-[0.82rem] text-ink-2">
                      {order.reference} · {new Date(order.createdAt).toLocaleDateString()}
                    </p>
                  </div>
                  <div className="text-right">
                    <p className="text-[0.9rem] font-semibold text-ink">
                      ₦{order.amount.toLocaleString()}
                    </p>
                    <p className="text-meta text-ink-2 capitalize">
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
