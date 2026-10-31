import Link from "next/link";
import { requireAdmin } from "@/lib/auth";
import { db } from "@/db";
import { adminAuditLog } from "@/db/schema";
import { and, count, desc, ilike, or } from "drizzle-orm";

export const dynamic = "force-dynamic";

const PAGE_SIZE = 50;

/**
 * The audit trail an operator can actually read.
 *
 * This is a record, not the source of truth for money: the wallet ledger is.
 * An entry can be missing if its insert failed (see `src/lib/admin-audit.ts`),
 * so the page says so instead of implying completeness.
 *
 * Nothing here is customer-facing, and nothing here is editable: the table is
 * append-only and this page has no mutation.
 */

const ACTION_LABELS: Record<string, string> = {
  "order.refund": "Order refunded",
  "order.deliver": "Order delivered",
  "order.unavailable": "Order unsourceable",
  "withdrawal.approve": "Withdrawal approved",
  "withdrawal.reject": "Withdrawal rejected",
  "withdrawal.complete": "Withdrawal settled",
  "user.credit": "Wallet credited",
  "user.debit": "Wallet debited",
  "message.status": "Support status changed",
};

const ACTION_FILTERS = [
  { value: "", label: "All actions" },
  { value: "order.refund", label: "Refunds" },
  { value: "order.deliver", label: "Deliveries" },
  { value: "order.unavailable", label: "Unsourceable" },
  { value: "withdrawal.approve", label: "Withdrawals approved" },
  { value: "withdrawal.complete", label: "Withdrawals settled" },
  { value: "user.credit", label: "Wallet credits" },
  { value: "user.debit", label: "Wallet debits" },
] as const;

function formatDate(value: Date | string) {
  const date = typeof value === "string" ? new Date(value) : value;
  return date.toLocaleString("en-NG", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export default async function AdminAuditPage({
  searchParams,
}: {
  searchParams: Promise<{ action?: string; q?: string; page?: string }>;
}) {
  await requireAdmin("/admin/audit");

  const params = await searchParams;
  const query = (params.q ?? "").trim();
  const action = (params.action ?? "").trim();
  const page = Math.max(1, Number.parseInt(params.page ?? "1", 10) || 1);
  const offset = (page - 1) * PAGE_SIZE;

  const conditions = [];
  if (action) conditions.push(ilike(adminAuditLog.action, action));
  if (query) {
    conditions.push(
      or(
        ilike(adminAuditLog.actorEmail, `%${query}%`),
        ilike(adminAuditLog.targetId, `%${query}%`),
        ilike(adminAuditLog.summary, `%${query}%`),
      )!,
    );
  }
  const where = conditions.length === 0 ? undefined : conditions.length === 1 ? conditions[0] : and(...conditions);

  const rows = await db
    .select({
      id: adminAuditLog.id,
      actorEmail: adminAuditLog.actorEmail,
      action: adminAuditLog.action,
      targetType: adminAuditLog.targetType,
      targetId: adminAuditLog.targetId,
      summary: adminAuditLog.summary,
      createdAt: adminAuditLog.createdAt,
    })
    .from(adminAuditLog)
    .where(where)
    .orderBy(desc(adminAuditLog.createdAt))
    .limit(PAGE_SIZE)
    .offset(offset);

  const [{ total }] = await db.select({ total: count() }).from(adminAuditLog).where(where);
  const totalPages = Math.max(1, Math.ceil(Number(total) / PAGE_SIZE));

  const buildHref = (next: { action?: string; page?: number }) => {
    const search = new URLSearchParams();
    const nextAction = next.action ?? action;
    const nextPage = next.page ?? page;
    if (nextAction) search.set("action", nextAction);
    if (query) search.set("q", query);
    if (nextPage > 1) search.set("page", String(nextPage));
    const suffix = search.toString();
    return suffix ? `/admin/audit?${suffix}` : "/admin/audit";
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-[1.5rem] font-medium tracking-tight">Audit log</h1>
          <p className="mt-1 max-w-2xl text-[0.86rem] text-ink-2">
            Every privileged action that moved money or changed an account, newest first.{" "}
            <span className="text-ink-3">
              Append-only. A missing row means its insert failed and was logged — the wallet
              ledger, not this page, is the authoritative financial record.
            </span>
          </p>
        </div>
        <div className="rounded-xl border border-line bg-white px-4 py-2 text-right">
          <p className="text-meta uppercase tracking-wide text-ink-3">Entries</p>
          <p className="text-[1rem] font-semibold text-ink">{Number(total).toLocaleString("en-NG")}</p>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        {ACTION_FILTERS.map((filter) => (
          <Link
            key={filter.value || "all"}
            href={buildHref({ action: filter.value, page: 1 })}
            className={
              filter.value === action
                ? "rounded-full border border-lav-600 bg-lav-600 px-3.5 py-1.5 text-[0.8rem] font-medium text-white"
                : "rounded-full border border-line bg-white px-3.5 py-1.5 text-[0.8rem] font-medium text-ink-2 hover:border-lav-300"
            }
          >
            {filter.label}
          </Link>
        ))}

        <form action="/admin/audit" className="ml-auto flex items-center gap-2">
          {action && <input type="hidden" name="action" value={action} />}
          <input
            type="search"
            name="q"
            defaultValue={query}
            placeholder="Search actor, target or summary"
            aria-label="Search the audit log"
            className="w-64 rounded-xl border border-line bg-white px-3.5 py-2 text-[0.84rem] outline-none focus:border-lav-400"
          />
          <button type="submit" className="btn btn-primary btn-sm">
            Search
          </button>
        </form>
      </div>

      <div className="overflow-x-auto rounded-2xl border border-line bg-white">
        <table className="w-full min-w-[36rem] text-left text-[0.84rem]">
          <thead className="bg-cream/70 text-meta uppercase tracking-wide text-ink-3">
            <tr>
              <th className="px-4 py-3 font-semibold">When</th>
              <th className="px-4 py-3 font-semibold">Administrator</th>
              <th className="px-4 py-3 font-semibold">Action</th>
              <th className="px-4 py-3 font-semibold">What happened</th>
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 && (
              <tr>
                <td colSpan={4} className="px-4 py-10 text-center text-ink-2">
                  No audit entries match those filters.
                </td>
              </tr>
            )}
            {rows.map((row) => (
              <tr key={row.id} className="border-t border-line/70 align-top">
                <td className="whitespace-nowrap px-4 py-3 text-meta text-ink-3">{formatDate(row.createdAt)}</td>
                <td className="px-4 py-3 text-[0.8rem] text-ink-2">{row.actorEmail}</td>
                <td className="px-4 py-3">
                  <p className="font-medium text-ink">{ACTION_LABELS[row.action] ?? row.action}</p>
                  <p className="font-mono text-meta text-ink-3">
                    {row.targetType}:{row.targetId}
                  </p>
                </td>
                <td className="px-4 py-3 text-[0.82rem] text-ink-2">{row.summary}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {totalPages > 1 && (
        <div className="flex items-center justify-between text-[0.82rem] text-ink-2">
          <span>
            Page {page} of {totalPages}
          </span>
          <div className="flex gap-2">
            {page > 1 && (
              <Link href={buildHref({ page: page - 1 })} className="btn btn-ghost btn-sm">
                Previous
              </Link>
            )}
            {page < totalPages && (
              <Link href={buildHref({ page: page + 1 })} className="btn btn-ghost btn-sm">
                Next
              </Link>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
