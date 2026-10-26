import type { Metadata } from "next";
import Link from "next/link";
import { desc, eq } from "drizzle-orm";
import { db } from "@/db";
import { orders, walletTransactions } from "@/db/schema";
import { requireUser } from "@/lib/auth";
import { getFleexaStatus } from "@/lib/fleexa";
import { formatNaira } from "@/lib/catalog";
import {
  ArrowRight,
  Chat,
  Clock,
  Globe,
  Mail,
  Phone,
  Plus,
  Receipt,
  Shield,
  Sim,
  Sparkle,
  Wallet,
} from "@/components/icons";

export const metadata: Metadata = { title: "Dashboard" };
export const dynamic = "force-dynamic";

const quickBuys = [
  { label: "Virtual number", note: "From ₦1,200", href: "/virtual-numbers#buy", icon: Phone },
  { label: "eSIM data", note: "From ₦4,500", href: "/esim#buy", icon: Sim },
  { label: "Residential proxy", note: "From ₦3,500", href: "/proxies#buy", icon: Globe },
  { label: "Email OTP", note: "From ₦700", href: "/email-otp#buy", icon: Mail },
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

export default async function DashboardOverviewPage() {
  const user = await requireUser("/dashboard");

  const [recentOrders, recentTx, fleexa] = await Promise.all([
    db.select().from(orders).where(eq(orders.userId, user.id)).orderBy(desc(orders.createdAt)).limit(5),
    db
      .select()
      .from(walletTransactions)
      .where(eq(walletTransactions.userId, user.id))
      .orderBy(desc(walletTransactions.createdAt))
      .limit(4),
    getFleexaStatus(),
  ]);

  const activeOrders = recentOrders.filter((order) => order.status === "active").length;
  const refunded = recentOrders
    .filter((order) => order.status === "refunded")
    .reduce((sum, order) => sum + order.amount, 0);

  const stats = [
    {
      label: "Wallet balance",
      value: formatNaira(user.walletBalance),
      note: "Spendable right now",
      icon: Wallet,
      accent: true,
    },
    {
      label: "Active orders",
      value: String(activeOrders),
      note: "Codes and credentials live",
      icon: Clock,
    },
    {
      label: "Orders this view",
      value: String(recentOrders.length),
      note: "Across all services",
      icon: Receipt,
    },
    {
      label: "Refunded to wallet",
      value: formatNaira(refunded),
      note: "Auto-refund protection",
      icon: Shield,
    },
  ];

  return (
    <div className="grid gap-4">
      <div className="rounded-[1.5rem] border border-lav-200/70 bg-gradient-to-br from-lav-100/80 via-[#fbf7ff] to-white p-5 sm:p-6">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <span className="inline-flex items-center gap-1.5 text-[0.64rem] font-semibold uppercase tracking-[0.16em] text-lav-700">
              <Sparkle className="h-3 w-3" /> Welcome back
            </span>
            <h1 className="mt-2 text-[1.6rem] font-medium leading-tight sm:text-[1.9rem]">
              Your Pryva wallet is ready.
            </h1>
            <p className="mt-1.5 max-w-md text-[0.86rem] leading-relaxed text-ink-2">
              Buy a number, eSIM, proxy pack or temporary inbox. Everything you order appears here
              instantly, with refund protection attached.
            </p>
          </div>
          <Link href="/dashboard/wallet" className="btn btn-primary !px-5 !py-3 !text-[0.8rem]">
            <Plus className="h-4 w-4" /> Top up wallet
          </Link>
        </div>
      </div>

      {fleexa.configured && (
        <div
          className={`flex flex-wrap items-center justify-between gap-2.5 rounded-2xl border px-4 py-3 ${
            fleexa.online ? "border-emerald-200 bg-emerald-50/60" : "border-amber-200 bg-amber-50/60"
          }`}
        >
          <p className="flex items-center gap-2 text-[0.8rem] font-medium text-ink">
            <span
              className={`h-1.5 w-1.5 rounded-full ${fleexa.online ? "bg-emerald-500" : "bg-amber-500"}`}
            />
            Fulfilment provider: <span className="font-semibold">Fleexa API</span>
            <span className="text-ink-3">
              {fleexa.online
                ? "· connected, numbers & codes come straight from Fleexa"
                : "· key set but currently unreachable — orders fall back to preview fulfilment"}
            </span>
          </p>
          {fleexa.online && fleexa.balanceNgn !== null && (
            <p className="text-[0.72rem] font-medium text-ink-2">
              Fleexa wallet: {formatNaira(fleexa.balanceNgn)}
            </p>
          )}
        </div>
      )}

      <div className="grid gap-2.5 sm:grid-cols-2 xl:grid-cols-4">
        {stats.map((stat) => {
          const Icon = stat.icon;
          return (
            <div
              key={stat.label}
              className={`rounded-2xl border p-4 ${
                stat.accent
                  ? "border-ink bg-ink text-white"
                  : "border-line bg-[#fffdfa] text-ink"
              }`}
            >
              <div className="flex items-center justify-between">
                <p
                  className={`text-[0.64rem] uppercase tracking-[0.14em] ${
                    stat.accent ? "text-white/55" : "text-ink-3"
                  }`}
                >
                  {stat.label}
                </p>
                <Icon className={`h-3.5 w-3.5 ${stat.accent ? "text-lav-200" : "text-lav-600"}`} />
              </div>
              <p className="mt-2 text-[1.4rem] font-semibold leading-none">{stat.value}</p>
              <p
                className={`mt-1.5 text-[0.68rem] ${stat.accent ? "text-white/55" : "text-ink-3"}`}
              >
                {stat.note}
              </p>
            </div>
          );
        })}
      </div>

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
                Start with a ₦700 temporary inbox or a ₦1,200 Nigerian verification number.
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
            <h2 className="text-[1rem] font-semibold">Quick buy</h2>
            <div className="mt-3 grid gap-1.5">
              {quickBuys.map((item) => {
                const Icon = item.icon;
                return (
                  <Link
                    key={item.label}
                    href={item.href}
                    className="group flex items-center gap-2.5 rounded-xl border border-line bg-white px-3 py-2.5 transition-all hover:border-lav-200"
                  >
                    <span className="grid h-7 w-7 place-items-center rounded-lg bg-lav-50 text-lav-700">
                      <Icon className="h-3.5 w-3.5" />
                    </span>
                    <span className="flex-1">
                      <span className="block text-[0.8rem] font-semibold text-ink">{item.label}</span>
                      <span className="block text-[0.66rem] text-ink-3">{item.note}</span>
                    </span>
                    <ArrowRight className="h-3.5 w-3.5 text-ink-3 transition-colors group-hover:text-lav-600" />
                  </Link>
                );
              })}
            </div>
          </div>

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
                      <p className="text-[0.64rem] text-ink-3">{tx.reference}</p>
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
    </div>
  );
}
