import type { Metadata } from "next";
import Link from "next/link";
import { and, count, desc, eq, sum } from "drizzle-orm";
import { db } from "@/db";
import { orders, walletTransactions } from "@/db/schema";
import { requireUser } from "@/lib/auth";
import { isPreviewDatabase } from "@/lib/demo-policy";
import { formatNaira, serviceMap } from "@/lib/catalog";
import {
  ArrowRight,
  Chat,
  Clock,
  Plus,
  Receipt,
  Shield,
  Sparkle,
  Wallet,
} from "@/components/icons";
import { ServiceIcon } from "@/components/ServiceIcon";
import { LiveCodeCard, type LiveCode } from "@/components/dashboard/LiveCodeCard";
import { EmptyState } from "@/components/dashboard/EmptyState";

export const metadata: Metadata = { title: "Dashboard" };
export const dynamic = "force-dynamic";

const quickBuys = [
  { label: "Virtual number", note: `From ${formatNaira(serviceMap.numbers.fromPrice)}`, href: "/virtual-numbers#buy", service: "numbers" as const },
  { label: "eSIM data", note: `From ${formatNaira(serviceMap.esim.fromPrice)}`, href: "/esim#buy", service: "esim" as const },
  { label: "Residential proxy", note: `From ${formatNaira(serviceMap.proxies.fromPrice)}`, href: "/proxies#buy", service: "proxies" as const },
  { label: "Email OTP", note: `From ${formatNaira(serviceMap["email-otp"].fromPrice)}`, href: "/email-otp#buy", service: "email-otp" as const },
];

function statusStyle(status: string) {
  switch (status) {
    case "active":
      return "bg-emerald-50 text-emerald-700";
    case "refunded":
      return "bg-amber-50 text-amber-700";
    default:
      return "bg-lav-50 text-lav-700";
  }
}

function firstName(name: string | null | undefined) {
  const first = (name ?? "").trim().split(/\s+/)[0];
  return first || "there";
}

export default async function DashboardOverviewPage() {
  const user = await requireUser("/dashboard");

  const [recentOrders, recentTx, liveOrderRows, [orderCount], [activeCount], [refundedRow]] =
    await Promise.all([
      db
        .select()
        .from(orders)
        .where(eq(orders.userId, user.id))
        .orderBy(desc(orders.createdAt))
        .limit(5),
      db
        .select()
        .from(walletTransactions)
        .where(eq(walletTransactions.userId, user.id))
        .orderBy(desc(walletTransactions.createdAt))
        .limit(4),
      db
        .select()
        .from(orders)
        .where(and(eq(orders.userId, user.id), eq(orders.status, "active")))
        .orderBy(desc(orders.createdAt))
        .limit(4),
      db.select({ value: count() }).from(orders).where(eq(orders.userId, user.id)),
      db
        .select({ value: count() })
        .from(orders)
        .where(and(eq(orders.userId, user.id), eq(orders.status, "active"))),
      db
        .select({ value: sum(orders.amount) })
        .from(orders)
        .where(and(eq(orders.userId, user.id), eq(orders.status, "refunded"))),
    ]);

  // Aggregate at the database, never over a `limit(5)` slice: the old headline
  // numbers were computed from the five rows rendered below them.
  const totalOrders = Number(orderCount?.value ?? 0);
  const activeOrders = Number(activeCount?.value ?? 0);
  const refundedToWallet = Number(refundedRow?.value ?? 0);

  const liveCodes: LiveCode[] = liveOrderRows
    .filter((order) => {
      if (order.status !== "active") return false;
      if (!order.expiresAt) return Boolean(order.otpCode);
      return new Date(order.expiresAt).getTime() > Date.now();
    })
    .slice(0, 2)
    .map((order) => ({
      id: order.id,
      productName: order.productName,
      planLabel: order.planLabel,
      region: order.region ?? "Nigeria",
      amount: order.amount,
      referenceCode: order.referenceCode ?? null,
      otpCode: order.otpCode ?? null,
      expiresAt: order.expiresAt ? new Date(order.expiresAt).toISOString() : null,
      createdAt: new Date(order.createdAt).toISOString(),
    }));

  return (
    <div className="grid gap-5">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="flex items-center gap-1.5 text-[0.66rem] font-semibold uppercase tracking-[0.16em] text-lav-700">
            <Sparkle className="h-3 w-3" /> Overview
          </p>
          <h1 className="mt-1.5 text-[1.5rem] font-medium tracking-tight sm:text-[1.7rem]">
            Welcome back, {firstName(user.name)}
          </h1>
        </div>
        <div className="flex items-center gap-2">
          <Link href="/dashboard/wallet" className="btn btn-primary !px-4 !py-2.5 !text-[0.78rem]">
            <Plus className="h-3.5 w-3.5" /> Top up
          </Link>
          <Link
            href="/dashboard/wallet#withdraw"
            className="btn border border-line bg-white !px-4 !py-2.5 !text-[0.78rem] text-ink hover:border-lav-200"
          >
            Withdraw
          </Link>
        </div>
      </div>

      <p className="inline-flex w-fit items-center gap-1.5 rounded-full border border-line bg-white/70 px-2.5 py-1 text-[0.68rem] text-ink-3">
        <Shield className="h-3 w-3 text-lav-600" />
        {isPreviewDatabase()
          ? "Preview mode · orders and balances here are simulated"
          : "Live purchasing is paused while provider integrations are reviewed"}
      </p>

      {liveCodes.length > 0 ? (
        <LiveCodeCard codes={liveCodes} />
      ) : (
        <EmptyState
          icon={Clock}
          title="No code waiting right now"
          body={`When a verification code arrives it lands here first, with a live timer. Nigerian numbers start at ${formatNaira(serviceMap.numbers.fromPrice)}.`}
          action={{ label: "Buy a number", href: "/virtual-numbers#buy" }}
        />
      )}

      <section className="grid gap-2.5 rounded-[1.5rem] border border-ink bg-ink p-5 text-white sm:p-6">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <p className="flex items-center gap-1.5 text-[0.64rem] uppercase tracking-[0.14em] text-white/55">
              <Wallet className="h-3.5 w-3.5" /> Wallet balance
            </p>
            <p className="mt-2 text-[1.9rem] font-semibold leading-none sm:text-[2.2rem]">
              {formatNaira(user.walletBalance)}
            </p>
            <p className="mt-2 text-[0.74rem] text-white/55">
              Spendable right now · refunds land here automatically
            </p>
          </div>
          <div className="grid w-full grid-cols-3 gap-2 sm:w-auto sm:min-w-[19rem]">
            {[
              { label: "Active", value: String(activeOrders) },
              { label: "All orders", value: String(totalOrders) },
              { label: "Refunded", value: formatNaira(refundedToWallet) },
            ].map((stat) => (
              <div key={stat.label} className="rounded-xl bg-white/10 px-3 py-2.5">
                <p className="text-[0.6rem] uppercase tracking-[0.12em] text-white/50">
                  {stat.label}
                </p>
                <p className="mt-1 truncate text-[0.92rem] font-semibold">{stat.value}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      <div className="grid gap-4 lg:grid-cols-[1.4fr_0.6fr]">
        <div className="rounded-[1.5rem] border border-line bg-[#fffdfa] p-5">
          <div className="flex items-center justify-between">
            <h2 className="text-[1rem] font-semibold">Recent orders</h2>
            <Link
              href="/dashboard/orders"
              className="inline-flex items-center gap-1 text-[0.76rem] font-semibold text-lav-700 hover:underline"
            >
              View all <ArrowRight className="h-3 w-3" />
            </Link>
          </div>

          {recentOrders.length === 0 ? (
            <div className="mt-4 rounded-2xl border border-dashed border-line bg-cream/50 p-6 text-center">
              <p className="text-[0.9rem] font-medium text-ink">No orders yet</p>
              <p className="mx-auto mt-1 max-w-xs text-[0.8rem] text-ink-3">
                Start with a {formatNaira(serviceMap["email-otp"].fromPrice)} temporary inbox or a{" "}
                {formatNaira(serviceMap.numbers.fromPrice)} Nigerian verification number.
              </p>
              <Link href="/pricing" className="btn btn-primary mt-4 !px-4 !py-2.5 !text-[0.78rem]">
                Browse services
                <ArrowRight className="h-3.5 w-3.5" />
              </Link>
            </div>
          ) : (
            <div className="mt-3 divide-y divide-line/80">
              {recentOrders.map((order) => (
                <Link
                  key={order.id}
                  href={`/dashboard/orders/${order.id}`}
                  className="flex items-center justify-between gap-3 py-3 transition-colors hover:bg-lav-50/40"
                >
                  <div className="min-w-0">
                    <p className="truncate text-[0.86rem] font-semibold text-ink">
                      {order.productName} · {order.planLabel}
                    </p>
                    <p className="truncate text-[0.7rem] text-ink-3">
                      {order.reference} ·{" "}
                      {new Date(order.createdAt).toLocaleDateString("en-NG", {
                        day: "numeric",
                        month: "short",
                        year: "numeric",
                      })}
                    </p>
                  </div>
                  <div className="flex shrink-0 items-center gap-2.5">
                    <span className="text-[0.82rem] font-semibold">{formatNaira(order.amount)}</span>
                    <span
                      className={`rounded-full px-2 py-0.5 text-[0.62rem] font-semibold capitalize ${statusStyle(order.status)}`}
                    >
                      {order.status}
                    </span>
                  </div>
                </Link>
              ))}
            </div>
          )}
        </div>

        <div className="grid gap-4">
          <div className="rounded-[1.5rem] border border-line bg-[#fffdfa] p-5">
            <div className="flex items-center justify-between">
              <h2 className="text-[1rem] font-semibold">Wallet activity</h2>
              <Link
                href="/dashboard/wallet"
                className="text-[0.72rem] font-semibold text-lav-700 hover:underline"
              >
                Details
              </Link>
            </div>
            {recentTx.length === 0 ? (
              <p className="mt-3 text-[0.8rem] text-ink-3">No transactions yet.</p>
            ) : (
              <div className="mt-3 grid gap-2">
                {recentTx.map((tx) => (
                  <div key={tx.id} className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <p className="truncate text-[0.78rem] font-medium text-ink">{tx.description}</p>
                      <p className="text-[0.64rem] text-ink-3">
                        {tx.reference} · Bal. {formatNaira(tx.balanceAfter)}
                      </p>
                    </div>
                    <span
                      className={`shrink-0 text-[0.78rem] font-semibold ${
                        tx.type === "debit" ? "text-ink-2" : "text-emerald-600"
                      }`}
                    >
                      {tx.type === "debit" ? "−" : "+"}
                      {formatNaira(tx.amount)}
                    </span>
                  </div>
                ))}
              </div>
            )}
            <Link
              href="/dashboard/support"
              className="mt-4 flex items-center gap-2 rounded-xl bg-lav-50 px-3 py-2.5 text-[0.76rem] font-semibold text-lav-800"
            >
              <Chat className="h-3.5 w-3.5" /> Need a hand? Message support
            </Link>
          </div>
        </div>
      </div>

      <section className="grid gap-2.5">
        <div className="flex items-center justify-between">
          <h2 className="text-[1rem] font-semibold">Buy again</h2>
          <Link
            href="/pricing"
            className="inline-flex items-center gap-1 text-[0.74rem] font-semibold text-lav-700 hover:underline"
          >
            <Receipt className="h-3 w-3" /> Full price list
          </Link>
        </div>
        <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-4">
          {quickBuys.map((item) => (
            <Link
              key={item.label}
              href={item.href}
              className="group flex items-center gap-2.5 rounded-xl border border-line bg-white px-3 py-2.5 transition-all hover:border-lav-200"
            >
              <ServiceIcon service={item.service} size="sm" />
              <span className="flex-1">
                <span className="block text-[0.8rem] font-semibold text-ink">{item.label}</span>
                <span className="block text-[0.66rem] text-ink-3">{item.note}</span>
              </span>
              <ArrowRight className="h-3.5 w-3.5 text-ink-3 transition-colors group-hover:text-lav-600" />
            </Link>
          ))}
        </div>
      </section>
    </div>
  );
}
