import { db } from "@/db";
import { sql } from "drizzle-orm";
import { users, orders, walletTransactions } from "@/db/schema";
import { count } from "drizzle-orm";

export const dynamic = "force-dynamic";

export async function GET() {
  const startTime = Date.now();
  const checks: Record<string, { status: "ok" | "error"; latency?: number; message?: string }> = {};

  // Database check
  try {
    const dbStart = Date.now();
    await db.execute(sql`select 1`);
    checks.database = { status: "ok", latency: Date.now() - dbStart };
  } catch (error) {
    checks.database = { 
      status: "error", 
      message: error instanceof Error ? error.message : "Database connection failed" 
    };
  }

  // Basic stats (only if database is healthy)
  let stats = null;
  if (checks.database.status === "ok") {
    try {
      const [userCount] = await db.select({ count: count() }).from(users);
      const [orderCount] = await db.select({ count: count() }).from(orders);
      const [transactionCount] = await db.select({ count: count() }).from(walletTransactions);

      stats = {
        users: userCount.count,
        orders: orderCount.count,
        transactions: transactionCount.count,
      };
    } catch (error) {
      // Stats are optional, don't fail the health check
    }
  }

  const allHealthy = Object.values(checks).every((c) => c.status === "ok");
  const responseTime = Date.now() - startTime;

  return Response.json(
    {
      status: allHealthy ? "healthy" : "degraded",
      timestamp: new Date().toISOString(),
      responseTime,
      checks,
      stats,
      version: process.env.npm_package_version || "1.0.0",
      environment: process.env.NODE_ENV || "development",
    },
    { status: allHealthy ? 200 : 503 }
  );
}
