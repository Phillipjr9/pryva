import type { Metadata } from "next";
import Link from "next/link";
import { desc, eq } from "drizzle-orm";
import { db, hasDatabase } from "@/db";
import { orders } from "@/db/schema";
import { isDemoUser, requireUser } from "@/lib/auth";
import { formatNaira } from "@/lib/catalog";
import { ArrowRight, Clock, Receipt, Shield, Sparkle } from "@/components/icons";

export const metadata: Metadata = { title: "Orders" };
export const dynamic = "force-dynamic";

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

export default async function OrdersPage() {
  const user = await requireUser("/dashboard/orders");
  const readOnlyDemo = !hasDatabase || isDemoUser(user);
  const rows = !readOnlyDemo
    ? await db
        .select()
        .from(orders)
        .where(eq(orders.userId, user.id))
        .orderBy(desc(orders.createdAt))
    : [];

  const active = rows.filter((order) => order.status === "active").length;

  return (
    <div className="pryva-page pryva-orders-page">
      <header className="pryva-page-header">
        <div>
          <span className="pryva-section-eyebrow">ACCOUNT / ORDERS</span>
          <h1>Your orders</h1>
          <p>Service purchases, delivery status and credentials in one place.</p>
        </div>
        <Link href="/pricing" className="pryva-outline-action">
          <Sparkle className="h-3.5 w-3.5" /> New order <ArrowRight className="h-3.5 w-3.5" />
        </Link>
      </header>

      <div className="pryva-order-summary-pills" aria-label="Order summary">
        <span><Receipt className="h-3.5 w-3.5" /> {rows.length} total</span>
        <span><Clock className="h-3.5 w-3.5" /> {active} active</span>
        <span><Shield className="h-3.5 w-3.5" /> Refund protection on eligible orders</span>
      </div>

      {rows.length === 0 ? (
        <section className="pryva-panel pryva-empty-state pryva-orders-empty">
          <span className="pryva-empty-icon"><Receipt className="h-5 w-5" /></span>
          <span className="pryva-section-eyebrow">NO ACTIVITY YET</span>
          <h2>No orders yet</h2>
          <p>Your purchases will appear here with their delivery details and order reference.</p>
          <Link href="/pricing" className="pryva-checkout-primary">
            Browse services <ArrowRight className="h-4 w-4" />
          </Link>
        </section>
      ) : (
        <section className="pryva-panel pryva-orders-table">
          <div className="pryva-orders-table-head">
            <span>ORDER</span><span>PLACED</span><span>AMOUNT</span><span>STATUS</span><span />
          </div>
          <div className="pryva-orders-list">
            {rows.map((order) => (
              <Link
                key={order.id}
                href={`/dashboard/orders/${order.id}`}
                className="pryva-orders-list-row"
              >
                <span className="pryva-orders-name">
                  <strong>{order.productName}</strong>
                  <small>{order.planLabel} · {order.reference}</small>
                </span>
                <span className="pryva-orders-date">
                  {new Date(order.createdAt).toLocaleDateString("en-NG", {
                    day: "numeric",
                    month: "short",
                    year: "numeric",
                  })}
                </span>
                <strong className="pryva-orders-amount">{formatNaira(order.amount)}</strong>
                <span className={`pryva-status ${statusStyle(order.status)}`}>{order.status}</span>
                <ArrowRight className="pryva-orders-arrow h-3.5 w-3.5" />
              </Link>
            ))}
          </div>
        </section>
      )}
    </div>
  );
}
