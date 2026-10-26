import type { Metadata } from "next";
import Link from "next/link";
import { desc, eq } from "drizzle-orm";
import { db, hasDatabase } from "@/db";
import { orders, walletTransactions } from "@/db/schema";
import { isDemoUser, requireUser } from "@/lib/auth";
import { getFleexaStatus } from "@/lib/fleexa";
import { formatNaira } from "@/lib/catalog";
import {
  ArrowRight,
  Chat,
  Clock,
  Globe,
  Mail,
  Phone,
  Receipt,
  Refresh,
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
      return "is-active";
    case "refunded":
      return "is-refunded";
    default:
      return "is-pending";
  }
}

export default async function DashboardOverviewPage() {
  const user = await requireUser("/dashboard");
  const readOnlyDemo = !hasDatabase || isDemoUser(user);

  const [recentOrders, recentTx, fleexa] = await Promise.all([
    !readOnlyDemo
      ? db.select().from(orders).where(eq(orders.userId, user.id)).orderBy(desc(orders.createdAt)).limit(5)
      : Promise.resolve([]),
    !readOnlyDemo
      ? db
          .select()
          .from(walletTransactions)
          .where(eq(walletTransactions.userId, user.id))
          .orderBy(desc(walletTransactions.createdAt))
          .limit(4)
      : Promise.resolve([]),
    getFleexaStatus(),
  ]);

  const activeOrders = recentOrders.filter((order) => order.status === "active").length;
  const refunded = recentOrders
    .filter((order) => order.status === "refunded")
    .reduce((sum, order) => sum + order.amount, 0);

  const stats = [
    {
      label: "Active orders",
      value: String(activeOrders),
      note: "In your latest five orders",
      icon: Clock,
    },
    {
      label: "Recent purchases",
      value: String(recentOrders.length),
      note: "Latest order records",
      icon: Receipt,
    },
    {
      label: "Refunded to wallet",
      value: formatNaira(refunded),
      note: "Returned when eligible",
      icon: Shield,
    },
    {
      label: "Wallet entries",
      value: String(recentTx.length),
      note: "Latest transaction records",
      icon: Wallet,
    },
  ];

  return (
    <div className="pryva-page pryva-overview-page">
      <section className="pryva-overview-hero">
        <div className="pryva-overview-hero-copy">
          <span className="pryva-overview-eyebrow">
            <Sparkle className="h-3.5 w-3.5" /> ACCOUNT OVERVIEW
          </span>
          <h1>Welcome back, {user.name.split(" ")[0]}.</h1>
          <p>
            {!readOnlyDemo
              ? "Your wallet, service orders and delivery details, all in one place. Review the price before confirming any wallet payment."
              : "Explore the Pryva workspace with a sample balance. Purchases, funding and support messages are read-only in this demo."}
          </p>
          <div className="pryva-overview-hero-actions">
            <Link href="/pricing" className="pryva-hero-primary">
              Browse services <ArrowRight className="h-4 w-4" />
            </Link>
            <Link href="/dashboard/wallet" className="pryva-hero-secondary">
              Wallet activity <ArrowRight className="h-3.5 w-3.5" />
            </Link>
          </div>
        </div>

        <div className="pryva-overview-balance">
          <div className="pryva-overview-balance-top">
            <span>AVAILABLE TO SPEND</span>
            <Wallet className="h-4 w-4" />
          </div>
          <strong>{formatNaira(user.walletBalance)}</strong>
          <p>{readOnlyDemo ? "Sample balance · read-only demo" : "For Pryva service orders"}</p>
          <div className="pryva-overview-balance-foot">
            <span>Wallet-funded checkout</span>
            <span className="pryva-balance-ready"><i /> {readOnlyDemo ? "Preview" : "Ready"}</span>
          </div>
        </div>
        <span className="pryva-overview-orbit" aria-hidden="true" />
      </section>

      {readOnlyDemo && (
        <div className="pryva-demo-notice" role="status">
          <span className="pryva-demo-mark">DEMO</span>
          <p>
            <strong>Read-only preview.</strong> This wallet balance is sample credit. Orders, top-ups and support messages are disabled here.
          </p>
        </div>
      )}

      {fleexa.configured && (
        <div className={`pryva-provider-notice ${fleexa.online ? "is-online" : "is-offline"}`}>
          <p>
            <span className="pryva-provider-dot" />
            Fulfilment provider <strong>Fleexa API</strong>
            <span>
              {fleexa.online
                ? "· connected for service delivery"
                : "· key set but currently unreachable; check the provider before placing live orders"}
            </span>
          </p>
          {fleexa.online && fleexa.balanceNgn !== null && (
            <span className="pryva-provider-balance">Provider balance · {formatNaira(fleexa.balanceNgn)}</span>
          )}
        </div>
      )}

      <section className="pryva-overview-stats" aria-label="Account summary">
        {stats.map((stat) => {
          const Icon = stat.icon;
          return (
            <article key={stat.label} className="pryva-dashboard-stat">
              <div className="pryva-dashboard-stat-head">
                <p>{stat.label}</p>
                <Icon className="h-4 w-4" />
              </div>
              <strong>{stat.value}</strong>
              <span>{stat.note}</span>
            </article>
          );
        })}
      </section>

      <div className="pryva-overview-columns">
        <section className="pryva-panel pryva-recent-orders">
          <div className="pryva-section-head">
            <div>
              <span className="pryva-section-eyebrow">ACTIVITY</span>
              <h2>Recent orders</h2>
            </div>
            <Link href="/dashboard/orders" className="pryva-text-link">
              View all <ArrowRight className="h-3.5 w-3.5" />
            </Link>
          </div>

          {recentOrders.length === 0 ? (
            <div className="pryva-empty-state">
              <span className="pryva-empty-icon"><Receipt className="h-5 w-5" /></span>
              <p>No orders yet</p>
              <span>Choose a service when you&apos;re ready. The order and its delivery details will appear here.</span>
              <Link href="/pricing" className="pryva-text-link">
                Browse services <ArrowRight className="h-3.5 w-3.5" />
              </Link>
            </div>
          ) : (
            <div className="pryva-order-list">
              {recentOrders.map((order) => (
                <Link
                  key={order.id}
                  href={`/dashboard/orders/${order.id}`}
                  className="pryva-order-row"
                >
                  <span className="pryva-order-symbol"><Receipt className="h-4 w-4" /></span>
                  <span className="pryva-order-copy">
                    <strong>{order.productName} · {order.planLabel}</strong>
                    <small>
                      {order.reference} · {new Date(order.createdAt).toLocaleDateString("en-NG", {
                        day: "numeric",
                        month: "short",
                        year: "numeric",
                      })}
                    </small>
                  </span>
                  <span className="pryva-order-total">{formatNaira(order.amount)}</span>
                  <span className={`pryva-status ${statusStyle(order.status)}`}>{order.status}</span>
                  <ArrowRight className="pryva-order-arrow h-3.5 w-3.5" />
                </Link>
              ))}
            </div>
          )}
        </section>

        <div className="pryva-overview-side">
          <section className="pryva-panel pryva-quick-buy">
            <div className="pryva-section-head">
              <div>
                <span className="pryva-section-eyebrow">START HERE</span>
                <h2>Choose a service</h2>
              </div>
              <Link href="/pricing" className="pryva-icon-link" aria-label="Browse all services">
                <ArrowRight className="h-4 w-4" />
              </Link>
            </div>
            <div className="pryva-quick-buy-list">
              {quickBuys.map((item) => {
                const Icon = item.icon;
                return (
                  <Link key={item.label} href={item.href} className="pryva-quick-buy-row">
                    <span className="pryva-quick-buy-icon"><Icon className="h-4 w-4" /></span>
                    <span>
                      <strong>{item.label}</strong>
                      <small>{item.note}</small>
                    </span>
                    <ArrowRight className="h-3.5 w-3.5" />
                  </Link>
                );
              })}
            </div>
          </section>

          <section className="pryva-panel pryva-wallet-activity">
            <div className="pryva-section-head">
              <div>
                <span className="pryva-section-eyebrow">WALLET</span>
                <h2>Latest entries</h2>
              </div>
              <Link href="/dashboard/wallet" className="pryva-text-link">Details</Link>
            </div>
            {recentTx.length === 0 ? (
              <p className="pryva-ledger-empty">No wallet transactions yet.</p>
            ) : (
              <div className="pryva-ledger-list">
                {recentTx.map((tx) => (
                  <div key={tx.id} className="pryva-ledger-row">
                    <span className={`pryva-ledger-icon ${tx.type === "debit" ? "is-out" : "is-in"}`}>
                      {tx.type === "debit" ? <ArrowRight className="h-3.5 w-3.5" /> : <Refresh className="h-3.5 w-3.5" />}
                    </span>
                    <span className="pryva-ledger-copy">
                      <strong>{tx.description}</strong>
                      <small>{tx.reference}</small>
                    </span>
                    <strong className={tx.type === "debit" ? "is-debit" : "is-credit"}>
                      {tx.type === "debit" ? "−" : "+"}{formatNaira(tx.amount)}
                    </strong>
                  </div>
                ))}
              </div>
            )}
            <Link href="/dashboard/support" className="pryva-support-cta">
              <Chat className="h-4 w-4" /> Need help with an order? <ArrowRight className="ml-auto h-3.5 w-3.5" />
            </Link>
          </section>
        </div>
      </div>
    </div>
  );
}
