import { redirect } from "next/navigation";
import { requireAuth } from "@/lib/auth";
import { db } from "@/db";
import { orders, users, walletTransactions } from "@/db/schema";
import { count, sum, eq } from "drizzle-orm";
import { AnalyticsDashboard } from "./AnalyticsDashboard";

export default async function AdminAnalyticsPage() {
  const user = await requireAuth();
  if (!user) redirect("/login?next=/admin/analytics");

  // For now, show basic stats (in production, add admin role check)
  const totalUsers = await db.select({ count: count() }).from(users);
  const totalOrders = await db.select({ count: count() }).from(orders);
  const totalRevenue = await db
    .select({ sum: sum(orders.amount) })
    .from(orders)
    .where(eq(orders.status, "delivered"));

  const stats = {
    totalUsers: totalUsers[0]?.count || 0,
    totalOrders: totalOrders[0]?.count || 0,
    totalRevenue: totalRevenue[0]?.sum || 0,
  };

  return (
    <div className="min-h-screen bg-cream p-6">
      <div className="mx-auto max-w-7xl space-y-6">
        <div>
          <h1 className="text-[2rem] font-medium tracking-tight text-ink">
            Admin Analytics
          </h1>
          <p className="mt-2 text-[0.95rem] text-ink-2">
            Platform overview and key metrics
          </p>
        </div>
        <AnalyticsDashboard stats={stats} />
      </div>
    </div>
  );
}
