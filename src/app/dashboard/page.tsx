import type { Metadata } from "next";
import Link from "next/link";
import { and, count, desc, eq, sum } from "drizzle-orm";
import { db } from "@/db";
import { orders, walletTransactions } from "@/db/schema";
import { requireUser } from "@/lib/auth";
import { formatNaira } from "@/lib/catalog";
import { walletEntryDirection, walletEntrySign } from "@/lib/wallet-activity";
import { ArrowRight, Chat, Clock, Receipt, Shield } from "@/components/icons";
import { ServiceIcon } from "@/components/ServiceIcon";
import { LiveCodeCard, type LiveCode } from "@/components/dashboard/LiveCodeCard";
import { EmptyState } from "@/components/dashboard/EmptyState";
import { BalanceHero } from "@/components/dashboard/BalanceHero";
import { CountryLaunch } from "@/components/dashboard/CountryLaunch";

export const metadata: Metadata = { title: "Dashboard" };
export const dynamic = "force-dynamic";

const quickBuys = [
  { label: "Number plans", note: "Single-use & rentals", href: "/dashboard/services?category=numbers", service: "numbers" as const },
  { label: "eSIM data", note: "Travel data previews", href: "/dashboard/services?category=esim", service: "esim" as const },
  { label: "Residential proxy", note: "Browse catalog plans", href: "/dashboard/services?category=proxies", service: "proxies" as const },
  { label: "Email OTP", note: "Free temporary inbox", href: "/dashboard/services?category=email", service: "email-otp" as const },
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

  const [recentOrders, recentTx, activeOrderRows, [orderCount], [activeCount], [refundedRow]] =
    await Promise.all([
      db
        .select()
        .from(orders)
        .where(eq(orders.userId, user.id))
        .orderBy(desc(orders.createdAt))
        .limit(4),
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
        .limit(50),
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

  // Aggregates, never a slice: headline numbers must describe the whole account.
  const totalOrders = Number(orderCount?.value ?? 0);
  const activeOrders = Number(activeCount?.value ?? 0);
  const refundedToWallet = Number(refundedRow?.value ?? 0);

  // This dynamic server timestamp is also passed to the countdown for a stable
  // first render; the browser clock takes over after hydration.
  // eslint-disable-next-line react-hooks/purity
  const now = Date.now();
  const liveCodes: LiveCode[] = activeOrderRows
    .filter((order) => {
      if (order.service !== "numbers" && order.service !== "email-otp") return false;
      if (!order.expiresAt) return Boolean(order.otpCode);
      return new Date(order.expiresAt).getTime() > now;
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

  // min-w-0 plus minmax(0,…) tracks: an implicit auto grid track is sized to its
  // items' min-content, and a truncated order reference is long enough to push
  // the whole overview past a 375px viewport once an order exists.
  return (
    <div className="grid min-w-0 grid-cols-1 gap-4">
      {/* 1 — money first, with the two actions attached to it */}
      <BalanceHero
        name={firstName(user.name)}
        balance={user.walletBalance}
        stats={[
          { label: "Active", value: String(activeOrders), note: "active orders" },
          { label: "Shown with code", value: String(liveCodes.filter((order) => order.otpCode).length), note: "in cards below" },
          { label: "Refunded", value: formatNaira(refundedToWallet), note: "back to wallet" },
        ]}
      />

      {/* Country comes before services, whether browsing from Home or the hub. */}
      <CountryLaunch />

      {/* 2 — then whatever is on a timer */}
      {liveCodes.length > 0 ? (
        <LiveCodeCard codes={liveCodes} initialNow={now} />
      ) : (
        <EmptyState
          icon={Clock}
          title="No code waiting right now"
          body="When a verification code arrives it lands here first, with a timer. Preview codes are simulated."
          action={{ label: "Explore number plans", href: "/dashboard/services?category=numbers" }}
        />
      )}

      <div className="grid min-w-0 grid-cols-1 gap-4 lg:grid-cols-[minmax(0,1.25fr)_minmax(0,0.75fr)]">
        {/* 3 — recent orders */}
        <section className="rounded-[1.5rem] border border-line bg-[#fffdfa] p-5">
          <div className="flex items-center justify-between">
            <h2 className="text-[1rem] font-semibold">Recent orders</h2>
            <Link
              href="/dashboard/orders"
              className="inline-flex items-center gap-1 text-meta font-semibold text-lav-700 hover:underline"
            >
              View all <ArrowRight className="h-3 w-3" />
            </Link>
          </div>

          {recentOrders.length === 0 ? (
            <p className="mt-3 rounded-xl border border-dashed border-line bg-cream/50 px-4 py-6 text-center text-[0.82rem] text-ink-3">
              Orders and their references will appear here. Preview orders are simulated.
            </p>
          ) : (
            <div className="mt-2 divide-y divide-line/80">
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
                    <p className="truncate text-meta text-ink-3">
                      {order.reference} ·{" "}
                      {new Date(order.createdAt).toLocaleDateString("en-NG", {
                        day: "numeric",
                        month: "short",
                      })}
                    </p>
                  </div>
                  <div className="flex shrink-0 items-center gap-2.5">
                    <span className="text-[0.82rem] font-semibold">{formatNaira(order.amount)}</span>
                    <span
                      className={`rounded-full px-2 py-0.5 text-micro font-semibold capitalize ${statusStyle(order.status)}`}
                    >
                      {order.status}
                    </span>
                  </div>
                </Link>
              ))}
            </div>
          )}
        </section>

        {/* 4 — what to do next */}
        <section className="rounded-[1.5rem] border border-line bg-[#fffdfa] p-5">
          <div className="flex items-center justify-between">
            <h2 className="text-[1rem] font-semibold">Explore categories</h2>
            <Link
              href="/dashboard/services"
              className="inline-flex items-center gap-1 text-meta font-semibold text-lav-700 hover:underline"
            >
              <Receipt className="h-3 w-3" /> All services
            </Link>
          </div>
          <div className="mt-2.5 grid gap-1.5">
            {quickBuys.map((item) => (
              <Link
                key={item.label}
                href={item.href}
                className="group flex items-center gap-2.5 rounded-xl border border-line bg-white px-3 py-2.5 transition-all hover:border-lav-200"
              >
                <ServiceIcon service={item.service} size="sm" />
                <span className="flex-1">
                  <span className="block text-[0.8rem] font-semibold text-ink">{item.label}</span>
                  <span className="block text-micro text-ink-3">{item.note}</span>
                </span>
                <ArrowRight className="h-3.5 w-3.5 text-ink-3 transition-colors group-hover:text-lav-600" />
              </Link>
            ))}
          </div>
        </section>
      </div>

      {/* 5 — the ledger, and a way out if something is wrong */}
      <div className="grid min-w-0 grid-cols-1 gap-4 lg:grid-cols-[minmax(0,1.25fr)_minmax(0,0.75fr)]">
        <section className="rounded-[1.5rem] border border-line bg-[#fffdfa] p-5">
          <div className="flex items-center justify-between">
            <h2 className="text-[1rem] font-semibold">Wallet activity</h2>
            <Link
              href="/dashboard/wallet"
              className="text-meta font-semibold text-lav-700 hover:underline"
            >
              Statement
            </Link>
          </div>
          {recentTx.length === 0 ? (
            <p className="mt-3 text-[0.8rem] text-ink-3">No transactions yet.</p>
          ) : (
            <div className="mt-2 divide-y divide-line/80">
              {recentTx.map((tx) => (
                <div key={tx.id} className="flex items-start justify-between gap-2 py-2.5">
                  <div className="min-w-0">
                    <p className="truncate text-[0.8rem] font-medium text-ink">{tx.description}</p>
                    <p className="text-micro text-ink-3">
                      {tx.reference} · Bal. {formatNaira(tx.balanceAfter)}
                    </p>
                  </div>
                  <span
                    className={`shrink-0 text-[0.8rem] font-semibold ${
                      walletEntryDirection(tx.type) === "in" ? "text-emerald-600" : "text-ink-2"
                    }`}
                  >
                    {walletEntrySign(tx.type)}
                    {formatNaira(tx.amount)}
                  </span>
                </div>
              ))}
            </div>
          )}
        </section>

        <section className="grid gap-2.5 rounded-[1.5rem] border border-lav-200 bg-gradient-to-br from-lav-50 to-white p-5">
          <p className="flex items-center gap-2 text-[0.92rem] font-semibold text-ink">
            <Shield className="h-4 w-4 text-lav-700" /> Need help with an order?
          </p>
          <p className="text-[0.8rem] leading-relaxed text-ink-2">
            If a code doesn&apos;t arrive, contact support with your order reference. Refund eligibility
            and the delivery outcome need to be reviewed.
          </p>
          <div className="mt-1 grid gap-1.5">
            <Link
              href="/dashboard/orders"
              className="flex items-center justify-between rounded-lg bg-white/80 px-3 py-2 text-meta font-medium text-ink-2 hover:text-lav-700"
            >
              Find an order code <ArrowRight className="h-3.5 w-3.5" />
            </Link>
            <Link
              href="/dashboard/support"
              className="flex items-center justify-between rounded-lg bg-white/80 px-3 py-2 text-meta font-medium text-ink-2 hover:text-lav-700"
            >
              <span className="inline-flex items-center gap-1.5">
                <Chat className="h-3.5 w-3.5" /> Message support
              </span>
              <ArrowRight className="h-3.5 w-3.5" />
            </Link>
          </div>
        </section>
      </div>

      <p className="text-center text-meta text-ink-3">
        {totalOrders} order{totalOrders === 1 ? "" : "s"} with Pryva
      </p>
    </div>
  );
}
