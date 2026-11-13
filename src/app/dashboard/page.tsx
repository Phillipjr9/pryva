import type { Metadata } from "next";
import Link from "next/link";
import { and, count, desc, eq, gt, inArray, isNull, sql } from "drizzle-orm";
import { db } from "@/db";
import { orders, walletTransactions } from "@/db/schema";
import { requireUser } from "@/lib/identity/auth";
import { formatNaira } from "@/lib/services/catalog";
import { walletEntryDirection, walletEntrySign } from "@/lib/payments/wallet-activity";

import { LiveCodeCard, type LiveCode } from "@/components/dashboard/LiveCodeCard";
import { EmptyState } from "@/components/dashboard/EmptyState";
import { BalanceHero } from "@/components/dashboard/BalanceHero";
import { readServiceReadiness } from "@/lib/services/service-readiness";
import { orderByReadiness, SERVICE_STATE_LABEL } from "@/lib/services/service-states";
import { countActiveRentedNumbers } from "@/lib/services/numbers/active-rentals";
import { isPreviewDatabase } from "@/lib/platform/demo-policy";
import { CODE_TRIM_WHITESPACE, hasLiveOrderCode } from "@/lib/services/order-history";

export const metadata: Metadata = { title: "Dashboard" };
export const dynamic = "force-dynamic";

const quickBuys = [
  { label: "Number plans", note: "App-specific & general plans", href: "/dashboard/services?country=ng&category=numbers", category: "numbers" },
  { label: "Social boosts", note: "Followers, likes & views", href: "/dashboard/services?country=ng&category=social", category: "social" },
  { label: "eSIM data", note: "Travel data plans", href: "/dashboard/services?country=ng&category=esim", category: "esim" },
  { label: "Residential proxies", note: "Clean rotating IP pools", href: "/dashboard/services?country=ng&category=proxies", category: "proxies" },
  { label: "Social & Digital Accounts", note: "Social media, email & aged listings", href: "/dashboard/accounts", category: "accounts" },
  { label: "Games & gaming", note: "Games, keys & credits", href: "/dashboard/services?category=games", category: "games" },
  { label: "Account top-ups", note: "Game & account credits", href: "/dashboard/services?category=topups", category: "topups" },
  { label: "Gift cards", note: "Vouchers & app stores", href: "/dashboard/services?category=gift-cards", category: "gift-cards" },
  { label: "Subscriptions", note: "Entertainment & tools", href: "/dashboard/services?category=subscriptions", category: "subscriptions" },
  { label: "Prepaid & finance", note: "Prepaid products & cards", href: "/dashboard/services?category=prepaid", category: "prepaid" },
  { label: "Mobile data & airtime", note: "MTN, Airtel, Glo & 9mobile", href: "/dashboard/services?category=data", category: "data" },
  { label: "Temporary inbox", note: "Free disposable email", href: "/dashboard/inbox", category: "email" },
  { label: "Bulk orders", note: "Volume basket discounts", href: "/dashboard/bulk-orders", category: "tools" },
] as const;

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

  // The tiles lead with what can actually be done on this deployment. States
  // come from the same configuration the checkout reads, so a tile cannot
  // promise more than the page behind it will honour.
  const readiness = new Map(readServiceReadiness().map((entry) => [entry.id, entry]));
  const accountReadiness = readiness.get("accounts");
  const accountState = accountReadiness?.state ?? "unavailable";
  const accountShortcut = quickBuys.find((item) => item.category === "accounts")!;
  const serviceTiles = orderByReadiness(
    quickBuys.filter((item) => item.category !== "accounts").map((item) => ({
      ...item,
      state: readiness.get(item.category)?.state ?? ("unavailable" as const),
    })),
  );

  // One server timestamp keeps the rental count and the first countdown render
  // consistent. The countdown takes over with the browser clock after hydration.
  // eslint-disable-next-line react-hooks/purity
  const now = Date.now();

  const liveCriteria = and(
    eq(orders.userId, user.id),
    inArray(orders.service, ["numbers", "email-otp"]),
    inArray(orders.status, ["active", "delivered"]),
    gt(orders.expiresAt, new Date(now)),
    isNull(orders.refundedAt),
  );
  const liveFields = {
    id: orders.id, productName: orders.productName, planLabel: orders.planLabel,
    region: orders.region, amount: orders.amount, referenceCode: orders.referenceCode,
    otpCode: orders.otpCode, expiresAt: orders.expiresAt, createdAt: orders.createdAt,
    status: orders.status, refundedAt: orders.refundedAt,
  };
  // The preview adapter cannot evaluate translate; its process-local data is
  // small, so use the JS predicate there. Real databases filter before limiting,
  // using JavaScript's exact trim whitespace set, so blank codes cannot hide
  // older eligible ones (including when the blank is Unicode whitespace).
  const liveQuery = isPreviewDatabase()
    ? db.select(liveFields).from(orders).where(liveCriteria).orderBy(desc(orders.createdAt), desc(orders.id))
    : db.select(liveFields).from(orders)
      .where(and(liveCriteria, sql`translate(${orders.otpCode}, ${CODE_TRIM_WHITESPACE}, '') <> ''`))
      .orderBy(desc(orders.createdAt), desc(orders.id)).limit(2);

  const [recentOrders, recentTx, liveRows, [orderCount], activeNumbers] =
    await Promise.all([
      db
        .select()
        .from(orders)
        .where(eq(orders.userId, user.id))
        .orderBy(desc(orders.createdAt), desc(orders.id))
        .limit(4),
      db
        .select()
        .from(walletTransactions)
        .where(eq(walletTransactions.userId, user.id))
        .orderBy(desc(walletTransactions.createdAt), desc(walletTransactions.id))
        .limit(4),
      liveQuery,
      db.select({ value: count() }).from(orders).where(eq(orders.userId, user.id)),
      countActiveRentedNumbers(user.id, new Date(now)),
    ]);

  // Aggregates, never a slice: headline numbers must describe the whole account.
  const totalOrders = Number(orderCount?.value ?? 0);
  const liveCodes: LiveCode[] = liveRows
    .filter((order) => hasLiveOrderCode(order, now))
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
  // items' min-content, and an unbroken order reference is long enough to push
  // the whole overview past a 375px viewport once an order exists.
  return (
    <div className="grid min-w-0 grid-cols-1 gap-4">
      {/* 1 — money first, with the two actions attached to it */}
      <BalanceHero
        name={firstName(user.name)}
        balance={user.walletBalance}
        activeNumbers={activeNumbers}
      />

      {/* Keep a live code card and a country hint near the active account state,
          while letting recent activity and quick actions lead the page. */}
      {liveCodes.length > 0 ? (
        <LiveCodeCard codes={liveCodes} initialNow={now} />
      ) : (
        <EmptyState
          title="No code waiting right now"
          body="When a verification code arrives it lands here first, with a timer."
          action={{ label: "Explore number plans", href: "/dashboard/services?category=numbers" }}
        />
      )}

      <div className="grid min-w-0 grid-cols-1 gap-4 lg:grid-cols-[minmax(0,1.25fr)_minmax(0,0.75fr)]">
        {/* Recent orders lead the overview because they reflect what the account is
            already doing; the service browser stays as a quick action panel. */}
        <section className="rounded-[1.5rem] border border-line bg-[#fffdfa] p-5 lg:order-1">
          <div className="flex items-center justify-between">
            <h2 className="text-[1rem] font-semibold">Recent orders</h2>
            <Link
              href="/dashboard/orders"
              className="inline-flex items-center gap-1 text-meta font-semibold text-lav-700 hover:underline"
            >
              View all
            </Link>
          </div>

          {recentOrders.length === 0 ? (
            <p className="mt-3 rounded-xl border border-dashed border-line bg-cream/50 px-4 py-6 text-center text-[0.8125rem] text-ink-3">
              Orders and their references will appear here.
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
                    <p className="[overflow-wrap:anywhere] text-[0.875rem] font-semibold text-ink">
                      {order.productName} · {order.planLabel}
                    </p>
                    <p className="[overflow-wrap:anywhere] text-meta text-ink-3">
                      {order.reference} ·{" "}
                      {new Date(order.createdAt).toLocaleDateString("en-NG", {
                        day: "numeric",
                        month: "short",
                      })}
                    </p>
                  </div>
                  <div className="flex shrink-0 items-center gap-2.5">
                    <span className="text-[0.8125rem] font-semibold">{formatNaira(order.amount)}</span>
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

        <section aria-labelledby="select-service-title" className="rounded-[1.5rem] border border-line bg-[#fffdfa] p-4 sm:p-5 lg:order-2">
          <h2 id="select-service-title" className="sr-only">Select a service</h2>
          <div className="flex items-start justify-between gap-2">
            <div className="min-w-0">
              <h3 className="text-[1rem] font-semibold">Quick actions</h3>
              <p className="mt-0.5 text-meta text-ink-3">Labels show setup; check each listing for availability.</p>
            </div>
            <Link
              href="/dashboard/services?country=ng"
              className="inline-flex shrink-0 items-center gap-1 text-meta font-semibold text-lav-700 hover:underline"
            >
               All services
            </Link>
          </div>
          <Link
            href={accountShortcut.href}
            className="group mt-3 flex min-h-[76px] min-w-0 items-center gap-3 rounded-2xl border border-lav-200 bg-lav-50/70 p-3 transition-colors hover:border-lav-400 hover:bg-lav-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-lav-500 sm:p-3.5"
          >
            <span className="min-w-0 flex-1">
              <span className="block break-words text-[0.875rem] font-semibold leading-snug text-ink group-hover:text-lav-700">{accountShortcut.label}</span>
              <span className="mt-0.5 block text-micro leading-snug text-ink-3">Browse account listings · separate from App verification</span>
              <span className="mt-2 inline-flex items-center gap-1.5 rounded-full bg-white px-2 py-1 text-micro font-semibold text-ink-2">
                {SERVICE_STATE_LABEL[accountState]}
              </span>
            </span>

          </Link>
          <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-2 sm:gap-2.5 lg:grid-cols-1">
            {serviceTiles.map((item) => (
              <Link
                key={item.label}
                href={item.href}
                className="group flex min-w-0 items-start rounded-xl border border-line bg-white p-3 text-left transition-all hover:border-lav-300 hover:shadow-xs"
              >
                <span className="min-w-0 flex-1">
                  <span className="flex min-w-0 items-center gap-1.5">
                    <span className="block min-w-0 text-[0.8125rem] font-semibold leading-tight text-ink group-hover:text-lav-700 sm:text-[0.8125rem]">{item.label}</span>
                  </span>
                  <span className="hidden truncate text-micro text-ink-3 sm:block">{item.note}</span>
                  <span className="mt-1 block break-words text-micro font-medium leading-snug text-ink-2">{SERVICE_STATE_LABEL[item.state]}</span>
                </span>

              </Link>
            ))}
          </div>
          <div className="mt-4 rounded-xl border border-dashed border-line bg-cream/30 px-3 py-2.5">
            <p className="text-[0.8125rem] font-medium uppercase tracking-[0.12em] text-ink-3">Recommended next</p>
            <div className="mt-1 flex flex-wrap items-center gap-2 text-[0.8125rem] text-ink-3">
              <Link href="/dashboard/services?country=ng&category=numbers" className="font-semibold text-lav-700 hover:underline">Numbers</Link>
              <span>•</span>
              <Link href="/dashboard/services?country=ng&category=social" className="font-semibold text-lav-700 hover:underline">Social</Link>
              <span>•</span>
              <Link href="/dashboard/services?country=ng&category=esim" className="font-semibold text-lav-700 hover:underline">eSIM</Link>
            </div>
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
            <p className="mt-3 text-[0.8125rem] text-ink-3">No transactions yet.</p>
          ) : (
            <div className="mt-2 divide-y divide-line/80">
              {recentTx.map((tx) => (
                <div key={tx.id} className="flex items-start justify-between gap-2 py-2.5">
                  <div className="min-w-0">
                    <p className="[overflow-wrap:anywhere] text-[0.8125rem] font-medium text-ink">{tx.description}</p>
                    <p className="text-micro text-ink-3">
                      {tx.reference} · Bal. {formatNaira(tx.balanceAfter)}
                    </p>
                  </div>
                  <span
                    className={`shrink-0 text-[0.8125rem] font-semibold ${
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
          <p className="flex items-center gap-2 text-[0.9375rem] font-semibold text-ink">
             Need help with an order?
          </p>
          <p className="text-[0.8125rem] leading-relaxed text-ink-2">
            If a code doesn&apos;t arrive, contact support with your order reference. Refund eligibility
            and the delivery outcome need to be reviewed.
          </p>
          <div className="mt-1 grid gap-1.5">
            <Link
              href="/dashboard/orders"
              className="flex items-center justify-between rounded-lg bg-white/80 px-3 py-2 text-meta font-medium text-ink-2 hover:text-lav-700"
            >
              Find an order code
            </Link>
            <Link
              href="/dashboard/support"
              className="flex items-center justify-between rounded-lg bg-white/80 px-3 py-2 text-meta font-medium text-ink-2 hover:text-lav-700"
            >
              <span className="inline-flex items-center gap-1.5">
                 Message support
              </span>

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
