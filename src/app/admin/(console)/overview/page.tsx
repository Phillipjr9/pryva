import Link from "next/link";
import type { ComponentType } from "react";
import { requireAdmin } from "@/lib/identity/auth";
import { getDashboardData, parseReportPeriod, REPORT_PERIODS } from "@/lib/admin/dashboard";
import { formatCurrency } from "@/lib/platform/utils";
import { Activity, ArrowRight, ArrowUpRight, BarChart3, CheckCircle, Clock, DollarSign, MessageCircle, Shield, ShoppingCart, TrendingUp, Users, Wallet } from "@/components/icons";
import { CalendarDays, TrendDown } from "@/components/admin/AdminIcons";
import { AdminCard, AdminTimestamp, EmptyState, PageHeading, StatusBadge, adminDate, initials, serviceLabel } from "@/components/admin/AdminUi";
import { ExportMenu, RefreshButton } from "@/components/admin/DashboardControls";
import { RevenueChart } from "@/components/admin/RevenueChart";

export const dynamic = "force-dynamic";
export const metadata = { title: "Dashboard" };

function Change({ value, previousLabel }: { value: number | null; previousLabel: string }) {
  if (value === null) return <span>{previousLabel}</span>;
  const Icon = value < 0 ? TrendDown : TrendingUp;
  return <><span className={`stat-change${value < 0 ? " negative" : ""}`}><Icon />{value > 0 ? "+" : ""}{value.toFixed(1)}%</span><span>vs previous period</span></>;
}

function StatCard({ label, value, icon: Icon, tone, href, link, children }: { label: string; value: string | number; icon: ComponentType<{ className?: string }>; tone: string; href: string; link: string; children: React.ReactNode }) {
  return <Link href={href} className={`small-box stat-card tone-${tone}`}><div className="inner"><span className="stat-label">{label}</span><h3>{value}</h3><div className="stat-note">{children}</div></div><Icon className="small-box-icon" /><span className="small-box-footer">{link}<ArrowRight /></span></Link>;
}

export default async function AdminOverviewPage({ searchParams }: { searchParams: Promise<{ days?: string }> }) {
  await requireAdmin("/admin/overview");
  const params = await searchParams;
  const period = parseReportPeriod(params.days);
  const data = await getDashboardData(period);
  const number = (value: number) => value.toLocaleString("en-NG");
  const range = `${adminDate(data.window.start)} – ${adminDate(data.generatedAt)} · UTC`;
  const queues = [
    { label: "Pending withdrawals", description: `${formatCurrency(data.pendingPayoutAmount)} awaiting review`, count: data.pendingPayoutCount, href: "/admin/withdrawals", icon: Wallet, tone: "warning" },
    { label: "Processing orders", description: "Purchases being fulfilled", count: data.processingOrders, href: "/admin/orders?status=processing", icon: ShoppingCart, tone: "info" },
    { label: "Escalated tickets", description: "Customers waiting for a person", count: data.escalatedTickets, href: "/admin/support?status=escalated", icon: MessageCircle, tone: "primary" },
    { label: "Open risk signals", description: "Advisory flags to review", count: data.openRiskSignals, href: "/admin/security", icon: Shield, tone: "danger" },
    { label: "Contact messages", description: "Open public-form conversations", count: data.openMessages, href: "/admin/messages", icon: MessageCircle, tone: "info" },
  ];

  return <div className="console-page">
    <PageHeading
      title="Dashboard"
      description="Your commerce, customers and operations at a glance."
      actions={<><div className="period-switch" aria-label="Reporting period">{REPORT_PERIODS.map((days) => <Link key={days} href={`/admin/overview?days=${days}`} aria-current={days === period ? "true" : undefined}>{days}D</Link>)}</div><ExportMenu start={data.window.start.toISOString()} end={data.generatedAt.toISOString()} /><RefreshButton /></>}
    />

    <div className="stat-grid">
      <StatCard label={`Revenue · ${period} days`} value={formatCurrency(data.revenue)} icon={DollarSign} tone="primary" href="/admin/analytics" link="View analytics"><Change value={data.revenueChange} previousLabel="Delivered-order value" /></StatCard>
      <StatCard label={`Total orders · ${period} days`} value={number(data.totalOrders)} icon={ShoppingCart} tone="info" href="/admin/orders" link="View orders"><Change value={data.ordersChange} previousLabel="All order statuses" /></StatCard>
      <StatCard label="Registered customers" value={number(data.totalCustomers)} icon={Users} tone="success" href="/admin/users" link="Manage customers"><span className="stat-change">+{number(data.newCustomers)}</span><span>in the last {period} days</span></StatCard>
      <StatCard label="Pending withdrawals" value={number(data.pendingPayoutCount)} icon={Wallet} tone="warning" href="/admin/withdrawals" link="Review withdrawals"><span>{formatCurrency(data.pendingPayoutAmount)} awaiting review</span></StatCard>
    </div>

    <div className="overview-grid">
      <AdminCard title="Revenue overview" subtitle={`Delivered orders · ${range}`} actions={<span className="chart-legend"><i />Revenue (NGN)</span>} padded={false}>
        <div className="px-3 pt-3 px-sm-4 pt-sm-4"><div className="chart-summary"><strong>{formatCurrency(data.revenue)}</strong><span className="chart-legend">Last {period} days</span></div><RevenueChart data={data.chart} /></div>
      </AdminCard>
      <AdminCard title="Needs your attention" subtitle="Live queues across the platform" padded={false} footer={<Link href="/admin/health" className="card-link">View operational health <ArrowRight /></Link>}>
        <div className="queue-list">{queues.map((queue) => { const Icon = queue.icon; return <Link href={queue.href} key={queue.label} className={`queue-row tone-${queue.tone}`}><span className="queue-icon"><Icon /></span><span><span className="queue-label">{queue.label}</span><span className="queue-description">{queue.description}</span></span><span className="queue-value">{number(queue.count)}</span><ArrowRight /></Link>; })}</div>
      </AdminCard>
    </div>

    <div className="overview-grid">
      <AdminCard title="Recent orders" subtitle="The latest purchases across all services" padded={false} actions={<Link href="/admin/orders" className="card-link">View all orders <ArrowRight /></Link>}>
        {data.recentOrders.length === 0 ? <EmptyState title="No orders yet" description="New purchases will appear here as customers use your platform." icon={<ShoppingCart />} /> : <div className="table-wrap overflow-x-auto"><table><thead><tr><th scope="col">Order / product</th><th scope="col">Customer</th><th scope="col">Amount</th><th scope="col">Status</th><th scope="col">Placed</th></tr></thead><tbody>{data.recentOrders.map((order) => <tr key={order.id}><td><Link href={`/admin/orders/${order.id}`} className="cell-title">{order.reference}</Link><span className="cell-subtitle" title={order.productName}>{order.productName}</span></td><td><div className="customer-cell"><span className="table-avatar">{initials(order.customerName)}</span><span><span className="cell-title">{order.customerName ?? "Customer"}</span><span className="cell-subtitle" title={order.customerEmail ?? undefined}>{order.customerEmail ?? "—"}</span></span></div></td><td className="text-nowrap fw-semibold">{formatCurrency(order.amount)}</td><td><StatusBadge status={order.status} /></td><td className="text-nowrap" style={{ color: "var(--pc-muted)", fontSize: ".65rem" }}><AdminTimestamp value={order.createdAt} time /></td></tr>)}</tbody></table></div>}
      </AdminCard>
      <div className="d-flex flex-column gap-4">
        <AdminCard title="Revenue by service" subtitle={`Share of delivered revenue · last ${period} days`}>
          {data.services.length === 0 ? <EmptyState title="No sales to break down" description="Service revenue appears after a delivered order." icon={<BarChart3 />} /> : <div>{data.services.slice(0, 5).map((service, index) => <div className="service-row" key={service.service}><div className="service-row-top"><strong>{serviceLabel(service.service)}</strong><span>{formatCurrency(service.revenue)} <span className="ms-1">· {data.revenue ? Math.round(service.revenue / data.revenue * 100) : 0}%</span></span></div><div className="progress" role="progressbar" aria-label={`${serviceLabel(service.service)} share of revenue`} aria-valuenow={data.revenue ? Math.round(service.revenue / data.revenue * 100) : 0} aria-valuemin={0} aria-valuemax={100}><div className="progress-bar" style={{ width: `${data.revenue ? service.revenue / data.revenue * 100 : 0}%`, opacity: 1 - index * 0.12 }} /></div></div>)}</div>}
        </AdminCard>
        <AdminCard title="Quick actions"><div className="quick-links">{[{ label: "Review payouts", href: "/admin/withdrawals", icon: Wallet }, { label: "Manage users", href: "/admin/users", icon: Users }, { label: "Wallet ledger", href: "/admin/transactions", icon: Activity }, { label: "Security center", href: "/admin/security", icon: Shield }].map((action) => { const Icon = action.icon; return <Link href={action.href} key={action.href} className="quick-link"><Icon />{action.label}<ArrowUpRight className="ms-auto" /></Link>; })}</div></AdminCard>
      </div>
    </div>

    <div className="row g-4">
      <div className="col-lg-6"><AdminCard title="Recent operator activity" subtitle="Recorded administrative actions" className="h-100" padded={false} actions={<Link href="/admin/audit" className="card-link">Audit log <ArrowRight /></Link>}>
        {data.recentActivity.length === 0 ? <EmptyState title="No operator actions recorded" description="Refunds, payout decisions and other recorded actions appear here." icon={<Clock />} /> : data.recentActivity.map((entry) => <div className="activity-item" key={entry.id}><span className="activity-icon"><CheckCircle /></span><div className="min-w-0"><p className="activity-title">{entry.summary}</p><p className="activity-detail">{entry.actorEmail}</p><span className="activity-time"><AdminTimestamp value={entry.createdAt} time /> UTC</span></div></div>)}
      </AdminCard></div>
      <div className="col-lg-6"><AdminCard title="New customers" subtitle="The latest accounts on your platform" className="h-100" padded={false} actions={<Link href="/admin/users" className="card-link">View all <ArrowRight /></Link>}>
        {data.recentCustomers.length === 0 ? <EmptyState title="No customers yet" description="Registered accounts will appear here." icon={<Users />} /> : data.recentCustomers.map((customer) => <Link className="activity-item" key={customer.id} href={`/admin/users/${customer.id}`}><span className="table-avatar">{initials(customer.name)}</span><span className="min-w-0 flex-grow-1"><span className="cell-title">{customer.name}</span><span className="cell-subtitle">{customer.email}</span></span><span className="text-end"><StatusBadge status={customer.emailVerifiedAt ? "verified" : "pending"} /><span className="activity-time"><AdminTimestamp value={customer.createdAt} /></span></span></Link>)}
      </AdminCard></div>
    </div>
    <div className="d-flex flex-wrap align-items-center justify-content-between gap-2" style={{ color: "var(--pc-muted)", fontSize: ".64rem" }}><span className="d-inline-flex align-items-center gap-2"><CalendarDays style={{ width: 13, height: 13 }} />Reporting period: {range}</span><span>Updated <AdminTimestamp value={data.generatedAt} time /> UTC · Revenue includes delivered orders only.</span></div>
  </div>;
}
