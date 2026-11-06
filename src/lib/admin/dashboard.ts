import { and, count, desc, eq, gte, isNull, lt, sum } from "drizzle-orm";
import { db } from "@/db";
import { adminAuditLog, contactMessages, fraudEvents, orders, supportTickets, users, withdrawals } from "@/db/schema";

export const REPORT_PERIODS = [7, 30, 90] as const;
export type ReportPeriod = (typeof REPORT_PERIODS)[number];
const DAY = 86_400_000;

export function parseReportPeriod(value: unknown): ReportPeriod {
  return REPORT_PERIODS.includes(Number(value) as ReportPeriod) ? Number(value) as ReportPeriod : 30;
}

/** Calendar-day UTC windows, with an exclusive end and an equal comparison window. */
export function reportWindow(days: ReportPeriod, now = new Date()) {
  const end = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1));
  const start = new Date(end.getTime() - days * DAY);
  const previousStart = new Date(start.getTime() - days * DAY);
  return { start, end, previousStart, days };
}
export type ReportWindow = ReturnType<typeof reportWindow>;

export function percentChange(current: number, previous: number): number | null {
  return previous > 0 ? ((current - previous) / previous) * 100 : null;
}

export type RevenuePoint = { day: string; revenue: number; orders: number };
export type ServiceRevenue = { service: string; revenue: number; orders: number };

/** Fill missing days with zero; never substitute illustrative chart values. */
export function revenueSeries(rows: { createdAt: Date | string; amount: number; status: string }[], window: ReportWindow): RevenuePoint[] {
  const buckets = new Map<string, RevenuePoint>();
  for (let time = window.start.getTime(); time < window.end.getTime(); time += DAY) {
    const day = new Date(time).toISOString().slice(0, 10);
    buckets.set(day, { day, revenue: 0, orders: 0 });
  }
  for (const row of rows) {
    const time = new Date(row.createdAt).getTime();
    if (row.status !== "delivered" || time < window.start.getTime() || time >= window.end.getTime()) continue;
    const bucket = buckets.get(new Date(time).toISOString().slice(0, 10));
    if (bucket) { bucket.revenue += Number(row.amount); bucket.orders += 1; }
  }
  return [...buckets.values()];
}

export function serviceRevenue(rows: { service: string; amount: number; status: string }[]): ServiceRevenue[] {
  const services = new Map<string, ServiceRevenue>();
  for (const row of rows) {
    if (row.status !== "delivered") continue;
    const current = services.get(row.service) ?? { service: row.service, revenue: 0, orders: 0 };
    current.revenue += Number(row.amount);
    current.orders += 1;
    services.set(row.service, current);
  }
  return [...services.values()].sort((a, b) => b.revenue - a.revenue);
}

/** Read-only reporting. No provider calls, estimated costs or invented growth. */
export async function getDashboardData(period: ReportPeriod, now = new Date()) {
  const window = reportWindow(period, now);
  const [
    [customerCount], [newCustomerCount], [orderCount], [previousOrderCount],
    [revenueTotal], [previousRevenueTotal], [pendingPayouts], [escalated],
    [riskSignals], [openMessages], [pendingOrders], deliveredRows, recentOrders,
    recentCustomers, recentActivity,
  ] = await Promise.all([
    db.select({ value: count() }).from(users),
    db.select({ value: count() }).from(users).where(and(gte(users.createdAt, window.start), lt(users.createdAt, window.end))),
    db.select({ value: count() }).from(orders).where(and(gte(orders.createdAt, window.start), lt(orders.createdAt, window.end))),
    db.select({ value: count() }).from(orders).where(and(gte(orders.createdAt, window.previousStart), lt(orders.createdAt, window.start))),
    db.select({ value: sum(orders.amount) }).from(orders).where(and(eq(orders.status, "delivered"), gte(orders.createdAt, window.start), lt(orders.createdAt, window.end))),
    db.select({ value: sum(orders.amount) }).from(orders).where(and(eq(orders.status, "delivered"), gte(orders.createdAt, window.previousStart), lt(orders.createdAt, window.start))),
    db.select({ value: count(), amount: sum(withdrawals.amount) }).from(withdrawals).where(eq(withdrawals.status, "pending")),
    db.select({ value: count() }).from(supportTickets).where(eq(supportTickets.status, "escalated")),
    db.select({ value: count() }).from(fraudEvents).where(isNull(fraudEvents.reviewedAt)),
    db.select({ value: count() }).from(contactMessages).where(eq(contactMessages.status, "open")),
    db.select({ value: count() }).from(orders).where(eq(orders.status, "processing")),
    // Only reporting columns cross the server boundary. Never select credentials,
    // activation codes, provider secrets or the wholesale cost sheet here.
    db.select({ createdAt: orders.createdAt, amount: orders.amount, status: orders.status, service: orders.service })
      .from(orders).where(and(eq(orders.status, "delivered"), gte(orders.createdAt, window.start), lt(orders.createdAt, window.end))),
    db.select({ id: orders.id, reference: orders.reference, productName: orders.productName, service: orders.service, amount: orders.amount, status: orders.status, createdAt: orders.createdAt, customerName: users.name, customerEmail: users.email })
      .from(orders).leftJoin(users, eq(orders.userId, users.id)).orderBy(desc(orders.createdAt)).limit(8),
    db.select({ id: users.id, name: users.name, email: users.email, createdAt: users.createdAt, emailVerifiedAt: users.emailVerifiedAt })
      .from(users).orderBy(desc(users.createdAt)).limit(5),
    db.select({ id: adminAuditLog.id, action: adminAuditLog.action, summary: adminAuditLog.summary, actorEmail: adminAuditLog.actorEmail, createdAt: adminAuditLog.createdAt })
      .from(adminAuditLog).orderBy(desc(adminAuditLog.createdAt)).limit(5),
  ]);

  const revenue = Number(revenueTotal?.value ?? 0);
  const previousRevenue = Number(previousRevenueTotal?.value ?? 0);
  const totalOrders = Number(orderCount?.value ?? 0);
  const previousOrders = Number(previousOrderCount?.value ?? 0);
  return {
    window,
    generatedAt: now,
    totalCustomers: Number(customerCount?.value ?? 0),
    newCustomers: Number(newCustomerCount?.value ?? 0),
    totalOrders,
    revenue,
    revenueChange: percentChange(revenue, previousRevenue),
    ordersChange: percentChange(totalOrders, previousOrders),
    pendingPayoutCount: Number(pendingPayouts?.value ?? 0),
    pendingPayoutAmount: Number(pendingPayouts?.amount ?? 0),
    escalatedTickets: Number(escalated?.value ?? 0),
    openRiskSignals: Number(riskSignals?.value ?? 0),
    openMessages: Number(openMessages?.value ?? 0),
    processingOrders: Number(pendingOrders?.value ?? 0),
    chart: revenueSeries(deliveredRows, window),
    services: serviceRevenue(deliveredRows),
    recentOrders,
    recentCustomers,
    recentActivity,
  };
}
export type DashboardData = Awaited<ReturnType<typeof getDashboardData>>;
