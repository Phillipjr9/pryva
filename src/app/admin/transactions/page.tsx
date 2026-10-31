import Link from "next/link";
import { and, desc, eq, ilike, or, sql, type SQL } from "drizzle-orm";
import { db } from "@/db";
import { users, walletTransactions } from "@/db/schema";
import { requireAdmin } from "@/lib/auth";

export const dynamic = "force-dynamic";

/**
 * Every movement of money, in the order it happened.
 *
 * This is the operator's answer to "where did this naira go": one row per wallet
 * transaction with the account it belongs to, the balance it produced, and the
 * reference that ties it back to an order, a deposit or a withdrawal. It is
 * read-only by design — a ledger you can edit from a web page is not a ledger.
 *
 * The balance column is shown deliberately. A transaction list tells you what
 * moved; the running balance tells you whether the arithmetic still holds, which
 * is what the nightly close checks across every account
 * (`src/lib/daily-reconciliation.ts`).
 */

const PAGE_SIZE = 50;
const TYPES = ["credit", "debit", "refund"] as const;

function formatNaira(amount: number) {
  return `₦${Math.abs(amount).toLocaleString("en-NG")}`;
}

function formatInstant(value: Date | string) {
  const date = typeof value === "string" ? new Date(value) : value;
  return date.toLocaleString("en-NG", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export default async function AdminTransactionsPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; type?: string; day?: string; page?: string }>;
}) {
  await requireAdmin("/admin/transactions");

  const params = await searchParams;
  const query = (params.q ?? "").trim();
  const type = TYPES.includes(params.type as (typeof TYPES)[number]) ? params.type : "";
  const day = /^\d{4}-\d{2}-\d{2}$/.test(params.day ?? "") ? params.day : "";
  const page = Math.max(1, Number.parseInt(params.page ?? "1", 10) || 1);
  const offset = (page - 1) * PAGE_SIZE;

  const filters: SQL[] = [];
  if (query) {
    const term = `%${query}%`;
    // Searching by email joins the account: "the customer says they paid" is
    // almost always answered from an address, not a reference.
    filters.push(
      or(
        ilike(walletTransactions.reference, term),
        ilike(walletTransactions.description, term),
        ilike(users.email, term),
      ) as SQL,
    );
  }
  if (type) filters.push(eq(walletTransactions.type, type));
  if (day) {
    // A Lagos business day, matching the nightly close.
    filters.push(
      sql`${walletTransactions.createdAt} >= ${`${day} 00:00:00+01`}::timestamptz
          AND ${walletTransactions.createdAt} < (${`${day} 00:00:00+01`}::timestamptz + interval '1 day')`,
    );
  }
  const where = filters.length ? and(...filters) : undefined;

  const rows = await db
    .select({
      id: walletTransactions.id,
      type: walletTransactions.type,
      amount: walletTransactions.amount,
      balanceAfter: walletTransactions.balanceAfter,
      description: walletTransactions.description,
      reference: walletTransactions.reference,
      orderId: walletTransactions.orderId,
      createdAt: walletTransactions.createdAt,
      email: users.email,
      userId: users.id,
    })
    .from(walletTransactions)
    .innerJoin(users, eq(users.id, walletTransactions.userId))
    .where(where)
    .orderBy(desc(walletTransactions.createdAt), desc(walletTransactions.id))
    .limit(PAGE_SIZE)
    .offset(offset);

  const [{ total }] = await db
    .select({ total: sql<number>`count(*)::int` })
    .from(walletTransactions)
    .innerJoin(users, eq(users.id, walletTransactions.userId))
    .where(where);

  const [{ credits, debits, refunds } = { credits: 0, debits: 0, refunds: 0 }] = await db
    .select({
      credits: sql<number>`coalesce(sum(CASE WHEN ${walletTransactions.type} = 'credit' THEN ${walletTransactions.amount} ELSE 0 END), 0)::int`,
      debits: sql<number>`coalesce(sum(CASE WHEN ${walletTransactions.type} = 'debit' THEN ${walletTransactions.amount} ELSE 0 END), 0)::int`,
      refunds: sql<number>`coalesce(sum(CASE WHEN ${walletTransactions.type} = 'refund' THEN ${walletTransactions.amount} ELSE 0 END), 0)::int`,
    })
    .from(walletTransactions)
    .innerJoin(users, eq(users.id, walletTransactions.userId))
    .where(where);

  const totalPages = Math.max(1, Math.ceil(Number(total) / PAGE_SIZE));
  const pageHref = (next: number) => {
    const search = new URLSearchParams();
    if (query) search.set("q", query);
    if (type) search.set("type", type);
    if (day) search.set("day", day);
    search.set("page", String(next));
    return `/admin/transactions?${search.toString()}`;
  };

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-[1.35rem] font-medium tracking-tight">Wallet ledger</h1>
        <p className="mt-1 max-w-3xl text-[0.85rem] text-ink-2">
          Every wallet movement, newest first, with the balance it produced. Read-only: corrections
          are made by the code that owns the money, never by editing this table.
        </p>
      </div>

      <div className="grid gap-3 sm:grid-cols-3">
        {[
          { label: "Credits in the filter", value: credits, tone: "text-emerald-700" },
          { label: "Debits in the filter", value: debits, tone: "text-ink" },
          { label: "Refunds in the filter", value: refunds, tone: "text-amber-700" },
        ].map((card) => (
          <div key={card.label} className="rounded-2xl border border-line bg-white p-4">
            <p className="text-meta uppercase tracking-wide text-ink-3">{card.label}</p>
            <p className={`mt-1 text-[1.15rem] font-semibold ${card.tone}`}>{formatNaira(card.value)}</p>
          </div>
        ))}
      </div>

      <form className="flex flex-wrap items-end gap-3 rounded-2xl border border-line bg-white p-4">
        <label className="flex-1 min-w-[12rem] text-meta font-semibold uppercase tracking-wide text-ink-3">
          Search
          <input
            name="q"
            defaultValue={query}
            placeholder="Reference, description or email"
            className="mt-1 w-full rounded-xl border border-line px-3 py-2 text-[0.86rem] font-normal normal-case tracking-normal text-ink outline-none focus:border-lav-400"
          />
        </label>
        <label className="text-meta font-semibold uppercase tracking-wide text-ink-3">
          Type
          <select
            name="type"
            defaultValue={type}
            className="mt-1 block rounded-xl border border-line px-3 py-2 text-[0.86rem] font-normal normal-case tracking-normal text-ink outline-none focus:border-lav-400"
          >
            <option value="">All</option>
            {TYPES.map((option) => (
              <option key={option} value={option}>
                {option}
              </option>
            ))}
          </select>
        </label>
        <label className="text-meta font-semibold uppercase tracking-wide text-ink-3">
          Lagos day
          <input
            type="date"
            name="day"
            defaultValue={day}
            className="mt-1 block rounded-xl border border-line px-3 py-2 text-[0.86rem] font-normal normal-case tracking-normal text-ink outline-none focus:border-lav-400"
          />
        </label>
        <button type="submit" className="btn btn-primary btn-sm">
          Filter
        </button>
        {(query || type || day) && (
          <Link href="/admin/transactions" className="text-[0.82rem] text-ink-3 underline">
            Clear
          </Link>
        )}
      </form>

      <div className="overflow-x-auto rounded-2xl border border-line bg-white">
        <table className="w-full min-w-[48rem] text-left text-[0.84rem]">
          <thead className="bg-cream/70 text-meta uppercase tracking-wide text-ink-3">
            <tr>
              <th className="px-4 py-3 font-semibold">When</th>
              <th className="px-4 py-3 font-semibold">Account</th>
              <th className="px-4 py-3 font-semibold">Type</th>
              <th className="px-4 py-3 font-semibold">Amount</th>
              <th className="px-4 py-3 font-semibold">Balance after</th>
              <th className="px-4 py-3 font-semibold">Detail</th>
              <th className="px-4 py-3 font-semibold">Reference</th>
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 && (
              <tr>
                <td colSpan={7} className="px-4 py-10 text-center text-ink-2">
                  Nothing matches that filter.
                </td>
              </tr>
            )}
            {rows.map((row) => (
              <tr key={row.id} className="border-t border-line/70">
                <td className="whitespace-nowrap px-4 py-3 text-ink-2">{formatInstant(row.createdAt)}</td>
                <td className="px-4 py-3">
                  <Link
                    href={`/admin/users?q=${encodeURIComponent(row.email)}`}
                    className="text-ink underline-offset-2 hover:underline"
                  >
                    {row.email}
                  </Link>
                </td>
                <td className="px-4 py-3">
                  <span
                    className={`inline-flex rounded-full px-2 py-0.5 text-meta font-semibold ${
                      row.type === "debit"
                        ? "bg-slate-100 text-slate-700"
                        : row.type === "refund"
                          ? "bg-amber-50 text-amber-700"
                          : "bg-emerald-50 text-emerald-700"
                    }`}
                  >
                    {row.type}
                  </span>
                </td>
                <td className={`whitespace-nowrap px-4 py-3 font-medium ${row.type === "debit" ? "text-ink" : "text-emerald-700"}`}>
                  {row.type === "debit" ? "−" : "+"}
                  {formatNaira(row.amount)}
                </td>
                <td className="whitespace-nowrap px-4 py-3 text-ink-2">{formatNaira(row.balanceAfter)}</td>
                <td className="px-4 py-3 text-ink-2">{row.description}</td>
                <td className="whitespace-nowrap px-4 py-3">
                  {row.orderId ? (
                    <Link href="/admin/orders" className="text-lav-700 hover:underline">
                      {row.reference}
                    </Link>
                  ) : (
                    <span className="text-ink-3">{row.reference}</span>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {totalPages > 1 && (
        <div className="flex items-center justify-between text-[0.82rem] text-ink-2">
          <span>
            Page {page} of {totalPages} · {Number(total).toLocaleString("en-NG")} transactions
          </span>
          <div className="flex gap-2">
            {page > 1 && (
              <Link href={pageHref(page - 1)} className="rounded-lg border border-line bg-white px-3 py-1.5 hover:border-lav-300">
                Previous
              </Link>
            )}
            {page < totalPages && (
              <Link href={pageHref(page + 1)} className="rounded-lg border border-line bg-white px-3 py-1.5 hover:border-lav-300">
                Next
              </Link>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
