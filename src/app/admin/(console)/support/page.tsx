import Link from "next/link";
import { and, count, desc, eq, asc } from "drizzle-orm";

import { db } from "@/db";
import { supportTickets, users } from "@/db/schema";
import { requireAdmin } from "@/lib/auth";
import {
  SUPPORT_STATUSES,
  SUPPORT_STATUS_LABELS,
  isSupportStatus,
} from "@/lib/ai-support/types";
import { SupportStatusPill } from "@/components/support/SupportStatusPill";
import { ticketQueueSummary } from "@/lib/support-tickets";
import { Sparkle } from "@/components/icons";

export const dynamic = "force-dynamic";

const PAGE_SIZE = 25;

const PRIORITY_STYLES: Record<string, string> = {
  urgent: "bg-rose-100 text-rose-800",
  high: "bg-amber-100 text-amber-800",
  normal: "bg-slate-100 text-slate-700",
  low: "bg-slate-50 text-slate-500",
};

/**
 * The ticket queue.
 *
 * Sorted by what the assistant was least sure about, not by arrival time, because
 * the expensive tickets are the ones it could not settle — the ones it answered
 * and fixed need nobody. Every row carries its confidence and the playbook it
 * chose, so an operator can open the doubtful ones and leave the rest.
 */
export default async function AdminSupportPage({
  searchParams,
}: {
  searchParams: Promise<{ status?: string; sort?: string }>;
}) {
  await requireAdmin("/admin/support");

  const params = await searchParams;
  const status = isSupportStatus(params.status) ? params.status : "";
  const leastSureFirst = params.sort === "confidence";

  const where = status ? eq(supportTickets.status, status) : undefined;

  const [rows, summary, [totalRow]] = await Promise.all([
    db
      .select({
        id: supportTickets.id,
        subject: supportTickets.subject,
        status: supportTickets.status,
        priority: supportTickets.priority,
        confidence: supportTickets.assistantConfidence,
        handledBy: supportTickets.handledBy,
        lastActivityAt: supportTickets.lastActivityAt,
        customerEmail: users.email,
        customerName: users.name,
      })
      .from(supportTickets)
      .leftJoin(users, eq(users.id, supportTickets.userId))
      .where(where)
      .orderBy(leastSureFirst ? asc(supportTickets.assistantConfidence) : desc(supportTickets.lastActivityAt))
      .limit(PAGE_SIZE),
    ticketQueueSummary(),
    db.select({ total: count() }).from(supportTickets).where(where),
  ]);

  const filterHref = (next: { status?: string; sort?: string }) => {
    const query = new URLSearchParams();
    if (next.status) query.set("status", next.status);
    if (next.sort) query.set("sort", next.sort);
    const suffix = query.toString();
    return suffix ? `/admin/support?${suffix}` : "/admin/support";
  };

  return (
    <div className="mx-auto max-w-6xl px-4 py-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-[1.5rem] font-semibold text-ink">Support queue</h1>
          <p className="mt-1 text-[0.86rem] text-ink-2">
            The assistant answers every ticket first. These are the ones that need a person, plus everything it
            handled so you can read what it did.
          </p>
        </div>
        <Link
          href={leastSureFirst ? "/admin/support" : "/admin/support?sort=confidence"}
          className="rounded-xl border border-line px-3 py-2 text-[0.8rem] font-medium text-ink-2 hover:border-lav-300"
        >
          {leastSureFirst ? "Sort by latest activity" : "Sort by least confident first"}
        </Link>
      </div>

      <div className="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-4">
        {[
          { label: "Never answered", value: summary.open, tone: "text-ink" },
          { label: "With a person", value: summary.escalated, tone: "text-rose-700" },
          { label: "Waiting on customer", value: summary.waiting, tone: "text-amber-700" },
          { label: "Resolved today", value: summary.resolvedToday, tone: "text-emerald-700" },
        ].map((stat) => (
          <div key={stat.label} className="rounded-2xl border border-line bg-[#fffdfa] p-3">
            <p className="text-micro text-ink-3">{stat.label}</p>
            <p className={`mt-0.5 text-[1.25rem] font-semibold ${stat.tone}`}>{stat.value}</p>
          </div>
        ))}
      </div>

      <div className="mt-4 flex flex-wrap gap-1.5">
        <Link
          href={filterHref({ sort: params.sort })}
          className={`rounded-full px-3 py-1 text-micro font-semibold ${status === "" ? "bg-ink text-white" : "bg-white text-ink-2 ring-1 ring-line"}`}
        >
          All ({Number(totalRow?.total ?? 0)})
        </Link>
        {SUPPORT_STATUSES.map((option) => (
          <Link
            key={option}
            href={filterHref({ status: option, sort: params.sort })}
            className={`rounded-full px-3 py-1 text-micro font-semibold ${status === option ? "bg-ink text-white" : "bg-white text-ink-2 ring-1 ring-line"}`}
          >
            {SUPPORT_STATUS_LABELS[option]}
          </Link>
        ))}
      </div>

      <div className="mt-4 overflow-x-auto rounded-2xl border border-line bg-[#fffdfa]">
        <table className="w-full min-w-[46rem] text-left text-[0.84rem]">
          <thead className="border-b border-line text-micro uppercase tracking-wide text-ink-3">
            <tr>
              <th className="px-3 py-2.5 font-medium">Ticket</th>
              <th className="px-3 py-2.5 font-medium">Customer</th>
              <th className="px-3 py-2.5 font-medium">Status</th>
              <th className="px-3 py-2.5 font-medium">Priority</th>
              <th className="px-3 py-2.5 font-medium">Assistant</th>
              <th className="px-3 py-2.5 font-medium">Last activity</th>
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 ? (
              <tr>
                <td colSpan={6} className="px-3 py-8 text-center text-ink-3">
                  No tickets here.
                </td>
              </tr>
            ) : (
              rows.map((row) => (
                <tr key={row.id} className="border-b border-line/60 last:border-0 hover:bg-cream/40">
                  <td className="px-3 py-2.5">
                    <Link href={`/admin/support/${row.id}`} className="font-medium text-ink hover:text-lav-700">
                      {row.subject}
                    </Link>
                  </td>
                  <td className="px-3 py-2.5 text-ink-2">{row.customerEmail ?? "—"}</td>
                  <td className="px-3 py-2.5">
                    <SupportStatusPill status={row.status} />
                  </td>
                  <td className="px-3 py-2.5">
                    <span className={`rounded-full px-2 py-0.5 text-micro font-semibold ${PRIORITY_STYLES[row.priority] ?? PRIORITY_STYLES.normal}`}>
                      {row.priority}
                    </span>
                  </td>
                  <td className="px-3 py-2.5 text-ink-2">
                    {row.confidence === null ? (
                      "—"
                    ) : (
                      <span className="inline-flex items-center gap-1">
                        <Sparkle className="h-3 w-3 text-lav-600" />
                        {row.confidence}%
                        {row.handledBy === "assistant" ? <span className="text-micro text-emerald-700">· fixed</span> : null}
                      </span>
                    )}
                  </td>
                  <td className="px-3 py-2.5 text-ink-3">
                    {new Date(row.lastActivityAt).toLocaleString("en-NG", {
                      day: "2-digit",
                      month: "short",
                      hour: "2-digit",
                      minute: "2-digit",
                    })}
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      <p className="mt-3 text-micro text-ink-3">
        Contact-form messages (from the public page, no account attached) are in{" "}
        <Link href="/admin/messages" className="underline hover:text-lav-700">
          the contact inbox
        </Link>
        .
      </p>
    </div>
  );
}
