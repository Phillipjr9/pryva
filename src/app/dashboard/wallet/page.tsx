import type { Metadata } from "next";
import Link from "next/link";
import { and, desc, eq } from "drizzle-orm";
import { db, hasDatabase } from "@/db";
import { walletTopups, walletTransactions } from "@/db/schema";
import { isDemoUser, requireUser } from "@/lib/auth";
import { isPaystackConfigured } from "@/lib/paystack";
import { formatNaira } from "@/lib/catalog";
import { TopUpForm } from "@/components/dashboard/TopUpForm";
import { ArrowRight, Card, Check, Refresh, Shield, Wallet } from "@/components/icons";

export const metadata: Metadata = { title: "Wallet" };
export const dynamic = "force-dynamic";

function safeReturnTo(value: string | string[] | undefined): string | null {
  if (typeof value !== "string" || !value.startsWith("/") || value.startsWith("//") || value.includes("\\") || value.length > 600) {
    return null;
  }
  try {
    const target = new URL(value, "https://pryva.invalid");
    if (target.origin !== "https://pryva.invalid") return null;
    return `${target.pathname}${target.search}${target.hash}`;
  } catch {
    return null;
  }
}

export default async function WalletPage({
  searchParams,
}: {
  searchParams: Promise<{ funding?: string | string[]; reference?: string | string[]; returnTo?: string | string[] }>;
}) {
  const [user, query] = await Promise.all([requireUser("/dashboard/wallet"), searchParams]);
  const readOnlyDemo = !hasDatabase || isDemoUser(user);
  const requestedReference = typeof query.reference === "string" ? query.reference : null;
  const requestedReturnTo = safeReturnTo(query.returnTo);

  const [transactions, topup] = await Promise.all([
    !readOnlyDemo
      ? db
          .select()
          .from(walletTransactions)
          .where(eq(walletTransactions.userId, user.id))
          .orderBy(desc(walletTransactions.createdAt))
          .limit(40)
      : Promise.resolve([]),
    !readOnlyDemo && requestedReference && /^[a-z0-9-]{1,40}$/i.test(requestedReference)
      ? db
          .select({ reference: walletTopups.reference, amount: walletTopups.amount, status: walletTopups.status })
          .from(walletTopups)
          .where(and(eq(walletTopups.userId, user.id), eq(walletTopups.reference, requestedReference)))
          .limit(1)
          .then((rows) => rows[0] ?? null)
      : Promise.resolve(null),
  ]);

  const paymentResult: {
    status: "paid" | "pending" | "failed";
    amount: number;
    reference: string;
  } | null = topup
    ? {
        status: topup.status === "paid" ? "paid" : topup.status === "failed" ? "failed" : "pending",
        amount: topup.amount,
        reference: topup.reference,
      }
    : null;

  const added = transactions
    .filter((tx) => tx.type !== "debit")
    .reduce((sum, tx) => sum + tx.amount, 0);
  const spent = transactions
    .filter((tx) => tx.type === "debit")
    .reduce((sum, tx) => sum + tx.amount, 0);

  return (
    <div className="pryva-page pryva-wallet-page">
      <header className="pryva-page-header">
        <div>
          <span className="pryva-section-eyebrow">ACCOUNT / WALLET</span>
          <h1>Your wallet</h1>
          <p>
            Review your available balance and transaction history. Service orders are paid from your Pryva wallet.
          </p>
        </div>
        <Link href="/dashboard/orders" className="pryva-outline-action">
          View orders <ArrowRight className="h-3.5 w-3.5" />
        </Link>
      </header>

      <section className="pryva-wallet-stats" aria-label="Wallet summary">
        <article className="pryva-wallet-stat is-primary">
          <div className="pryva-wallet-stat-head">
            <span>AVAILABLE NOW</span><Wallet className="h-4 w-4" />
          </div>
          <strong>{formatNaira(user.walletBalance)}</strong>
          <small>Current balance for Pryva orders</small>
        </article>
        <article className="pryva-wallet-stat">
          <div className="pryva-wallet-stat-head">
            <span>ADDED IN TOTAL</span><Card className="h-4 w-4" />
          </div>
          <strong>{formatNaira(added)}</strong>
          <small>Credits recorded in your wallet history</small>
        </article>
        <article className="pryva-wallet-stat">
          <div className="pryva-wallet-stat-head">
            <span>SPENT IN TOTAL</span><Refresh className="h-4 w-4" />
          </div>
          <strong>{formatNaira(spent)}</strong>
          <small>{transactions.filter((tx) => tx.type === "debit").length} wallet-funded orders</small>
        </article>
      </section>

      <div className="pryva-wallet-columns">
        <TopUpForm
          balance={user.walletBalance}
          previewMode={readOnlyDemo}
          paystackReady={hasDatabase && !readOnlyDemo && isPaystackConfigured()}
          paymentResult={paymentResult}
          returnTo={requestedReturnTo}
        />

        <div className="pryva-wallet-side">
          <section className="pryva-panel pryva-transaction-history">
            <div className="pryva-section-head">
              <div>
                <span className="pryva-section-eyebrow">LEDGER</span>
                <h2>Transaction history</h2>
              </div>
              <span className="pryva-entry-count">{transactions.length} entries</span>
            </div>
            {transactions.length === 0 ? (
              <div className="pryva-empty-ledger">
                <span><Wallet className="h-4 w-4" /></span>
                <p>No wallet transactions yet.</p>
                <small>Orders and eligible refunds will be listed here.</small>
              </div>
            ) : (
              <div className="pryva-ledger-list pryva-wallet-ledger">
                {transactions.map((tx) => (
                  <div key={tx.id} className="pryva-ledger-row">
                    <span className={`pryva-ledger-icon ${tx.type === "debit" ? "is-out" : "is-in"}`}>
                      {tx.type === "debit" ? <ArrowRight className="h-3.5 w-3.5" /> : <Refresh className="h-3.5 w-3.5" />}
                    </span>
                    <span className="pryva-ledger-copy">
                      <strong>{tx.description}</strong>
                      <small>
                        {tx.reference} · {new Date(tx.createdAt).toLocaleString("en-NG", {
                          day: "numeric",
                          month: "short",
                          hour: "2-digit",
                          minute: "2-digit",
                        })}
                      </small>
                    </span>
                    <span className="pryva-ledger-amount">
                      <strong className={tx.type === "debit" ? "is-debit" : "is-credit"}>
                        {tx.type === "debit" ? "−" : "+"}{formatNaira(tx.amount)}
                      </strong>
                      <small>Balance {formatNaira(tx.balanceAfter)}</small>
                    </span>
                  </div>
                ))}
              </div>
            )}
          </section>

          <section className="pryva-panel pryva-wallet-explainer">
            <div className="pryva-section-head">
              <div>
                <span className="pryva-section-eyebrow">HOW IT WORKS</span>
                <h2>Wallet payments</h2>
              </div>
              <Shield className="h-4 w-4" />
            </div>
            <ul>
              <li><Check className="h-4 w-4" /> Review the service and total before confirming.</li>
              <li><Refresh className="h-4 w-4" /> Eligible refunds return to your Pryva wallet.</li>
              <li><Card className="h-4 w-4" /> Card and bank-transfer top-ups use Paystack when it is configured.</li>
            </ul>
            <Link href="/pricing" className="pryva-text-link">
              Browse services <ArrowRight className="h-3.5 w-3.5" />
            </Link>
          </section>
        </div>
      </div>
    </div>
  );
}
