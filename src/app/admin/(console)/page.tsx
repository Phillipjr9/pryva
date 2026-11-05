import { redirect } from "next/navigation";
import Link from "next/link";
import { and, count, eq, isNull } from "drizzle-orm";
import { db } from "@/db";
import { contactMessages, orders, payoutNameApprovals, supportTickets, withdrawals } from "@/db/schema";
import { requireAdmin } from "@/lib/auth";
import { ArrowRight } from "@/components/icons";

export const dynamic = "force-dynamic";
export const metadata = { title: "Operator console" };

/**
 * The console home.
 *
 * `/admin` used to 404: the console had eighteen pages and no front door, so the
 * only way in was the sidebar link that pointed straight at `/admin/dashboard`.
 * Two things were wrong with that. A deep link that lost its path landed on a 404,
 * and "where do I start" had no answer that was not a guess.
 *
 * This is not a second dashboard. `/admin/dashboard` already answers "how is the
 * business doing"; this answers "what needs a person now", which is the only
 * question worth answering first. Every tile links to the queue it summarises, and
 * a tile that is zero says so plainly rather than disappearing — an operator
 * checking at 09:00 wants to know that nothing is waiting, not to wonder whether
 * the page failed to load it.
 */
export default async function AdminHomePage() {
  await requireAdmin("/admin");

  // Each count is its own query against its own table, so one of them failing
  // must not take the console home down with it -- but it must not read as "zero
  // waiting" either. `allSettled` gives us the failure and this keeps it: a count
  // that could not be read is `null`, which the tiles render as unknown, never as
  // clear. A swallowed `.catch(() => 0)` would have told an operator a queue was
  // empty when the query had merely failed.
  const counted = await Promise.allSettled([
    db.select({ value: count() }).from(withdrawals).where(eq(withdrawals.status, "pending")),
    db.select({ value: count() }).from(payoutNameApprovals).where(isNull(payoutNameApprovals.revokedAt)),
    db.select({ value: count() }).from(supportTickets).where(eq(supportTickets.status, "escalated")),
    db.select({ value: count() }).from(contactMessages).where(eq(contactMessages.status, "open")),
    db
      .select({ value: count() })
      .from(orders)
      .where(and(eq(orders.status, "processing"), isNull(orders.refundedAt))),
  ]);

  const tally = (index: number): number | null => {
    const result = counted[index];
    if (!result || result.status !== "fulfilled") return null;
    const [row] = result.value as { value: number | string }[];
    return row?.value === undefined ? null : Number(row.value);
  };

  const [waitingWithdrawals, approvedNames, escalated, openMessages, stuckOrders] = [
    tally(0),
    tally(1),
    tally(2),
    tally(3),
    tally(4),
  ];

  const queues = [
    {
      href: "/admin/withdrawals",
      label: "Withdrawals waiting",
      body: "Money a customer has asked to take out. Nothing moves until someone approves it.",
      value: waitingWithdrawals,
      urgency: "high" as const,
    },
    {
      href: "/admin/payout-names",
      label: "Payout names cleared",
      body: "Names an operator has approved where the bank name differs from the depositor.", 
      value: approvedNames,
      urgency: "normal" as const,
    },
    {
      href: "/admin/support",
      label: "Support escalations",
      body: "Tickets the assistant could not settle and handed to a person.",
      value: escalated,
      urgency: "normal" as const,
    },
    {
      href: "/admin/messages",
      label: "Contact form open",
      body: "Messages from the public contact page.",
      value: openMessages,
      urgency: "normal" as const,
    },
    {
      href: "/admin/orders",
      label: "Orders still processing",
      body: "Paid orders whose delivery has not settled — the supplier outcome is still unknown.",
      value: stuckOrders,
      urgency: "high" as const,
    },
  ];

  const asking = queues.filter((queue) => queue.value === null || queue.value > 0);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-[1.5rem] font-medium tracking-tight">Operator console</h1>
        <p className="mt-1 max-w-2xl text-[0.86rem] leading-relaxed text-ink-2">
          {asking.length === 0
            ? "Nothing is waiting on a person right now."
            : `${asking.length} ${asking.length === 1 ? "queue needs" : "queues need"} a decision.`}
          {queues.some((queue) => queue.value === null) && (
            <>
              {" "}
              A queue marked <strong className="font-semibold">unread</strong> could not be counted —
              that is not the same as it being clear.
            </>
          )}
        </p>
      </div>

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
        {queues.map((queue) => {
          const unknown = queue.value === null;
          const nothing = queue.value === 0;
          return (
            <Link
              key={queue.href + queue.label}
              href={queue.href}
              className="group flex flex-col justify-between gap-3 rounded-2xl border border-line bg-white p-4 transition-colors hover:border-lav-300"
            >
              <div>
                <div className="flex items-start justify-between gap-3">
                  <p className="text-[0.9rem] font-semibold text-ink">{queue.label}</p>
                  <span
                    className={
                      unknown
                        ? "rounded-full bg-cream px-2 py-0.5 text-meta font-semibold text-ink-2"
                        : nothing
                          ? "rounded-full bg-cream px-2 py-0.5 text-meta font-semibold text-ink-3"
                          : queue.urgency === "high"
                            ? "rounded-full bg-rose-50 px-2 py-0.5 text-meta font-semibold text-rose-700"
                            : "rounded-full bg-amber-50 px-2 py-0.5 text-meta font-semibold text-amber-800"
                    }
                  >
                    {unknown ? "unread" : nothing ? "clear" : queue.value}
                  </span>
                </div>
                <p className="mt-1.5 text-meta leading-relaxed text-ink-2">{queue.body}</p>
              </div>
              <span className="inline-flex items-center gap-1 text-meta font-medium text-lav-700">
                Open queue
                <ArrowRight className="h-3.5 w-3.5 transition-transform group-hover:translate-x-0.5" />
              </span>
            </Link>
          );
        })}
      </div>

      <div className="rounded-2xl border border-line bg-white p-4">
        <p className="text-[0.9rem] font-semibold text-ink">Looking for the numbers?</p>
        <p className="mt-1 max-w-2xl text-meta leading-relaxed text-ink-2">
          Revenue, users and order volume live on{" "}
          <Link href="/admin/dashboard" className="font-medium text-lav-700 underline underline-offset-2">
            Overview
          </Link>
          . The daily close — whether the ledger still adds up — is on{" "}
          <Link href="/admin/reconciliation" className="font-medium text-lav-700 underline underline-offset-2">
            Reconciliation
          </Link>
          .
        </p>
      </div>
    </div>
  );
}
