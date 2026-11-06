import Link from "next/link";
import { and, desc, eq, ilike, or, sql, type SQL } from "drizzle-orm";
import { db } from "@/db";
import {
  users,
  walletTransactions,
  WALLET_CREDIT_TYPES,
  WALLET_DEBIT_TYPES,
  type WalletEntryType,
} from "@/db/schema";
import { walletEntryDirection, walletEntrySign } from "@/lib/payments/wallet-activity";
import { requireAdmin } from "@/lib/identity/auth";

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
 * (`src/lib/payments/daily-reconciliation.ts`).
 *
 * Direction is never decided from the type word here. This page used to render
 * anything that was not literally `debit` with a green plus, so a payout — money
 * leaving the wallet — was shown arriving, and a type nobody recognises was shown
 * arriving too. Both now come from `walletEntryDirection`, and the type list comes
 * from the same schema vocabulary the writers use, so a new money word cannot be
 * filterable in one place and unreadable in another.
 */

const PAGE_SIZE = 50;
const LEDGER_TYPES: readonly WalletEntryType[] = [...WALLET_CREDIT_TYPES, ...WALLET_DEBIT_TYPES];

/** Colour follows direction, because that is the thing the eye is checking. */
const PILL_TONE = {
  in: "bg-emerald-50 text-emerald-700",
  out: "bg-slate-100 text-slate-700",
  unknown: "bg-amber-50 text-amber-700",
} as const;

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
  const requested = params.type ?? "";
  const type = (LEDGER_TYPES as readonly string[]).includes(requested) ? requested : "";
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

  // One filtered sum per type the vocabulary knows, instead of three hard-coded
  // CASE columns: a payout was money that left and appeared nowhere, and the type
  // it left under is read from the schema rather than spelled out here again.
  //
  // `::bigint`, not `::int`: `amount` is an integer column, so Postgres sums it
  // into an int8 and a cast back to int4 raises `integer out of range` once the
  // filtered total passes 2,147,483,647 kobo (N21,474,836.47). The filter is
  // optional, so with no `day` these are lifetime totals and the page would stop
  // answering for good. int8 reaches the driver as a string, hence the Number().
  const tiles = await Promise.all(
    LEDGER_TYPES.map(async (entry) => {
      const [row] = await db
        .select({
          value: sql<number>`coalesce(sum(${walletTransactions.amount}), 0)::bigint`,
        })
        .from(walletTransactions)
        .innerJoin(users, eq(users.id, walletTransactions.userId))
        .where(and(where, eq(walletTransactions.type, entry)));
      return {
        label: `${entry.charAt(0).toUpperCase()}${entry.slice(1)}s in the filter`,
        value: Number(row?.value ?? 0),
        tone: walletEntryDirection(entry) === "in" ? "text-emerald-700" : "text-ink",
      };
    }),
  );

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

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {tiles.map((card) => (
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
            {LEDGER_TYPES.map((option) => (
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
                  <Link href={`/admin/users/${row.userId}`} className="text-ink underline-offset-2 hover:underline">
                    {row.email}
                  </Link>
                </td>
                <td className="px-4 py-3">
                  <span
                    className={`inline-flex rounded-full px-2 py-0.5 text-meta font-semibold ${
                      PILL_TONE[walletEntryDirection(row.type)]
                    }`}
                  >
                    {row.type}
                  </span>
                </td>
                <td
                  className={`whitespace-nowrap px-4 py-3 font-medium ${
                    walletEntryDirection(row.type) === "in" ? "text-emerald-700" : "text-ink"
                  }`}
                >
                  {walletEntrySign(row.type)}
                  {formatNaira(row.amount)}
                </td>
                <td className="whitespace-nowrap px-4 py-3 text-ink-2">{formatNaira(row.balanceAfter)}</td>
                <td className="px-4 py-3 text-ink-2">{row.description}</td>
                <td className="whitespace-nowrap px-4 py-3">
                  {row.orderId ? (
                    <Link href={`/admin/orders/${row.orderId}`} className="text-lav-700 hover:underline">
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
