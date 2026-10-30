import Link from "next/link";
import { requireAdmin } from "@/lib/auth";
import { db } from "@/db";
import { users, orders } from "@/db/schema";
import { count, desc, ilike, inArray, or, sql } from "drizzle-orm";

export const dynamic = "force-dynamic";

const PAGE_SIZE = 50;

function formatNaira(amount: number) {
  return `₦${amount.toLocaleString("en-NG")}`;
}

function formatDate(value: Date | string) {
  const date = typeof value === "string" ? new Date(value) : value;
  return date.toLocaleDateString("en-NG", { day: "2-digit", month: "short", year: "numeric" });
}

/**
 * Shows whether an account is locked, and how many consecutive failures it has.
 * A lock is deliberately left to expire on its own: it exists to stop online
 * guessing, and an operator unlocking it on request would hand that back to the
 * person who was guessing. A customer who cannot wait resets their password,
 * which releases the lock because it proves control of the mailbox.
 */
function SignInState({ lockedUntil, attempts }: { lockedUntil: Date | string | null; attempts: number }) {
  const until = lockedUntil ? new Date(lockedUntil) : null;
  if (until && until.getTime() > Date.now()) {
    const minutes = Math.max(1, Math.ceil((until.getTime() - Date.now()) / 60_000));
    return (
      <span className="inline-flex rounded-full bg-red-50 px-2 py-0.5 text-meta font-semibold text-red-700">
        Locked · {minutes} min
      </span>
    );
  }
  if (attempts > 0) {
    return <span className="text-meta text-amber-700">{attempts} failed</span>;
  }
  return <span className="text-meta text-ink-3">—</span>;
}

export default async function AdminUsersPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; page?: string }>;
}) {
  await requireAdmin("/admin/users");

  const params = await searchParams;
  const query = (params.q ?? "").trim();
  const page = Math.max(1, Number.parseInt(params.page ?? "1", 10) || 1);
  const offset = (page - 1) * PAGE_SIZE;
  const term = `%${query}%`;

  // One page of users plus their lifetime order counts. Two queries beat a
  // correlated subquery per row on Postgres here, and it keeps the count map
  // small (only the ids on this page).
  const rows = await db
    .select({
      id: users.id,
      name: users.name,
      email: users.email,
      walletBalance: users.walletBalance,
      createdAt: users.createdAt,
      // Lockout state, so a support call can be answered without SQL. Both
      // columns are read-only here: releasing a lock from the admin UI would be
      // a second, unaudited way to undo a security control.
      lockedUntil: users.lockedUntil,
      failedLoginAttempts: users.failedLoginAttempts,
    })
    .from(users)
    .where(query ? or(ilike(users.name, term), ilike(users.email, term)) : undefined)
    .orderBy(desc(users.createdAt))
    .limit(PAGE_SIZE)
    .offset(offset);

  const [{ total }] = await db
    .select({ total: count() })
    .from(users)
    .where(query ? or(ilike(users.name, term), ilike(users.email, term)) : undefined);

  const pageIds = rows.map((row) => row.id);
  const orderCounts = new Map<string, { orders: number; spent: number }>();

  if (pageIds.length > 0) {
    const grouped = await db
      .select({
        userId: orders.userId,
        orderCount: count(),
        spent: sql<number>`coalesce(sum(${orders.amount}), 0)`,
      })
      .from(orders)
      .where(inArray(orders.userId, pageIds))
      .groupBy(orders.userId);

    for (const row of grouped) {
      orderCounts.set(row.userId, { orders: Number(row.orderCount), spent: Number(row.spent) });
    }
  }

  const totalPages = Math.max(1, Math.ceil(Number(total) / PAGE_SIZE));
  const walletTotal = rows.reduce((sum, row) => sum + row.walletBalance, 0);

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-[1.5rem] font-medium tracking-tight">Users</h1>
          <p className="mt-1 text-[0.86rem] text-ink-2">
            {Number(total).toLocaleString("en-NG")} registered {Number(total) === 1 ? "account" : "accounts"}
            {query ? ` matching “${query}”` : ""}.
          </p>
        </div>
        <div className="rounded-xl border border-line bg-white px-4 py-2 text-right">
          <p className="text-meta uppercase tracking-wide text-ink-3">Wallet balance on this page</p>
          <p className="text-[1rem] font-semibold text-ink">{formatNaira(walletTotal)}</p>
        </div>
      </div>

      <form action="/admin/users" className="flex flex-wrap items-center gap-2">
        <input
          type="search"
          name="q"
          defaultValue={query}
          placeholder="Search by name or email"
          aria-label="Search users"
          className="w-full max-w-sm rounded-xl border border-line bg-white px-3.5 py-2 text-[0.86rem] outline-none focus:border-lav-400"
        />
        <button type="submit" className="btn btn-primary btn-sm">
          Search
        </button>
        {query && (
          <Link href="/admin/users" className="text-[0.82rem] text-ink-3 underline">
            Clear
          </Link>
        )}
      </form>

      <div className="overflow-x-auto rounded-2xl border border-line bg-white">
        <table className="w-full min-w-[36rem] text-left text-[0.84rem]">
          <thead className="bg-cream/70 text-meta uppercase tracking-wide text-ink-3">
            <tr>
              <th className="px-4 py-3 font-semibold">User</th>
              <th className="px-4 py-3 font-semibold">Wallet</th>
              <th className="px-4 py-3 font-semibold">Orders</th>
              <th className="px-4 py-3 font-semibold">Spent</th>
              <th className="px-4 py-3 font-semibold">Sign-in</th>
              <th className="px-4 py-3 font-semibold">Joined</th>
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 && (
              <tr>
                <td colSpan={6} className="px-4 py-10 text-center text-ink-2">
                  No users match that search.
                </td>
              </tr>
            )}
            {rows.map((row) => {
              const stats = orderCounts.get(row.id);
              return (
                <tr key={row.id} className="border-t border-line/70">
                  <td className="px-4 py-3">
                    <p className="font-medium text-ink">{row.name}</p>
                    <p className="text-meta text-ink-3">{row.email}</p>
                  </td>
                  <td className="px-4 py-3 font-medium">{formatNaira(row.walletBalance)}</td>
                  <td className="px-4 py-3">{stats?.orders ?? 0}</td>
                  <td className="px-4 py-3">{formatNaira(stats?.spent ?? 0)}</td>
                  <td className="px-4 py-3">
                    <SignInState lockedUntil={row.lockedUntil} attempts={row.failedLoginAttempts} />
                  </td>
                  <td className="px-4 py-3 text-ink-2">{formatDate(row.createdAt)}</td>
                </tr>
              );
            })}
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
              <Link
                href={`/admin/users?page=${page - 1}${query ? `&q=${encodeURIComponent(query)}` : ""}`}
                className="rounded-lg border border-line bg-white px-3 py-1.5 hover:border-lav-300"
              >
                Previous
              </Link>
            )}
            {page < totalPages && (
              <Link
                href={`/admin/users?page=${page + 1}${query ? `&q=${encodeURIComponent(query)}` : ""}`}
                className="rounded-lg border border-line bg-white px-3 py-1.5 hover:border-lav-300"
              >
                Next
              </Link>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
