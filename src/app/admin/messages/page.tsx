import Link from "next/link";
import { requireAdmin } from "@/lib/auth";
import { db } from "@/db";
import { contactMessages } from "@/db/schema";
import { and, count, desc, eq, ilike, or, sql } from "drizzle-orm";
import { MessageStatusControl } from "./MessageStatusControl";
import { isMessageStatus, MESSAGE_STATUS_LABELS, MESSAGE_STATUSES } from "@/lib/support-messages";

export const dynamic = "force-dynamic";

const PAGE_SIZE = 25;

const STATUS_FILTERS = [
  { value: "", label: "All" },
  ...MESSAGE_STATUSES.map((status) => ({ value: status, label: MESSAGE_STATUS_LABELS[status] })),
];

const STATUS_STYLES: Record<string, string> = {
  open: "bg-lav-100 text-lav-800",
  in_progress: "bg-amber-50 text-amber-800",
  resolved: "bg-emerald-50 text-emerald-700",
  closed: "bg-slate-100 text-slate-600",
};

function formatWhen(value: Date | string) {
  const date = typeof value === "string" ? new Date(value) : value;
  return date.toLocaleString("en-NG", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

/**
 * Support inbox.
 *
 * Messages arrive from the public /contact form and from /dashboard/support.
 * They were stored and counted, but no screen ever read them back — the only
 * consumer was an API route nothing called.
 */
export default async function AdminMessagesPage({
  searchParams,
}: {
  searchParams: Promise<{ status?: string; q?: string; page?: string }>;
}) {
  await requireAdmin("/admin/messages");

  const params = await searchParams;
  const status = isMessageStatus(params.status) ? params.status : "";
  const query = (params.q ?? "").trim();
  const page = Math.max(1, Number.parseInt(params.page ?? "1", 10) || 1);
  const offset = (page - 1) * PAGE_SIZE;
  const term = `%${query}%`;

  const filters = [
    status ? eq(contactMessages.status, status) : undefined,
    query ? or(ilike(contactMessages.name, term), ilike(contactMessages.email, term), ilike(contactMessages.topic, term), ilike(contactMessages.message, term)) : undefined,
  ].filter((clause) => clause !== undefined);
  const where = filters.length ? and(...filters) : undefined;

  const [rows, [{ total }], [openRow], [waitingRow]] = await Promise.all([
    db
      .select()
      .from(contactMessages)
      .where(where)
      .orderBy(desc(contactMessages.createdAt))
      .limit(PAGE_SIZE)
      .offset(offset),
    db.select({ total: count() }).from(contactMessages).where(where),
    db.select({ total: count() }).from(contactMessages).where(eq(contactMessages.status, "open")),
    db
      .select({ oldest: sql<string | null>`min(${contactMessages.createdAt})` })
      .from(contactMessages)
      .where(eq(contactMessages.status, "open")),
  ]);

  const totalPages = Math.max(1, Math.ceil(Number(total) / PAGE_SIZE));
  const buildHref = (next: { status?: string; q?: string; page?: number }) => {
    const search = new URLSearchParams();
    const nextStatus = next.status ?? status;
    const nextQuery = next.q ?? query;
    if (nextStatus) search.set("status", nextStatus);
    if (nextQuery) search.set("q", nextQuery);
    if ((next.page ?? page) > 1) search.set("page", String(next.page ?? page));
    const suffix = search.toString();
    return suffix ? `/admin/messages?${suffix}` : "/admin/messages";
  };

  const oldestOpen = waitingRow?.oldest ? new Date(waitingRow.oldest) : null;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-[1.5rem] font-medium tracking-tight">Support messages</h1>
          <p className="mt-1 text-[0.86rem] text-ink-2">
            {Number(total).toLocaleString("en-NG")} {Number(total) === 1 ? "message" : "messages"}
            {status ? ` · ${status.replace("_", " ")}` : ""}
            {query ? ` · matching “${query}”` : ""}
          </p>
        </div>
        <div className="rounded-xl border border-line bg-white px-4 py-2 text-right">
          <p className="text-meta uppercase tracking-wide text-ink-3">Waiting for a reply</p>
          <p className="text-[1rem] font-semibold text-ink">
            {Number(openRow?.total ?? 0).toLocaleString("en-NG")} open
            {oldestOpen ? ` · oldest ${formatWhen(oldestOpen)}` : ""}
          </p>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        {STATUS_FILTERS.map((filter) => (
          <Link
            key={filter.value || "all"}
            href={buildHref({ status: filter.value, page: 1 })}
            aria-current={filter.value === status ? "page" : undefined}
            className={
              filter.value === status
                ? "rounded-full border border-lav-600 bg-lav-600 px-3.5 py-1.5 text-[0.8rem] font-medium text-white"
                : "rounded-full border border-line bg-white px-3.5 py-1.5 text-[0.8rem] font-medium text-ink-2 hover:border-lav-300"
            }
          >
            {filter.label}
          </Link>
        ))}

        <form action="/admin/messages" className="ml-auto flex items-center gap-2">
          {status && <input type="hidden" name="status" value={status} />}
          <input
            type="search"
            name="q"
            defaultValue={query}
            placeholder="Search name, email or message"
            aria-label="Search messages"
            className="w-64 rounded-xl border border-line bg-white px-3.5 py-2 text-[0.84rem] outline-none focus:border-lav-400"
          />
          <button type="submit" className="btn btn-primary btn-sm">
            Search
          </button>
        </form>
      </div>

      <div className="grid gap-3">
        {rows.length === 0 && (
          <p className="rounded-2xl border border-dashed border-line bg-white px-4 py-10 text-center text-[0.86rem] text-ink-2">
            No messages match those filters.
          </p>
        )}

        {rows.map((row) => (
          <article key={row.id} className="rounded-2xl border border-line bg-white p-4">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div className="min-w-0">
                <p className="flex flex-wrap items-center gap-2 text-[0.9rem] font-semibold text-ink">
                  {row.topic}
                  <span
                    className={`rounded-full px-2 py-0.5 text-micro font-semibold capitalize ${
                      STATUS_STYLES[row.status] ?? "bg-slate-100 text-slate-600"
                    }`}
                  >
                    {row.status.replace("_", " ")}
                  </span>
                </p>
                <p className="mt-1 text-meta text-ink-3">
                  {row.name} · <a href={`mailto:${row.email}`} className="text-lav-700 underline underline-offset-2">{row.email}</a>
                  {" · "}
                  {formatWhen(row.createdAt)}
                  {row.userId ? " · signed in" : " · signed out"}
                </p>
              </div>
              <MessageStatusControl id={row.id} status={row.status} />
            </div>
            <p className="mt-3 whitespace-pre-wrap break-words text-[0.84rem] leading-relaxed text-ink-2">
              {row.message}
            </p>
          </article>
        ))}
      </div>

      {totalPages > 1 && (
        <div className="flex items-center justify-between text-[0.82rem] text-ink-2">
          <span>
            Page {page} of {totalPages}
          </span>
          <div className="flex gap-2">
            {page > 1 && (
              <Link
                href={buildHref({ page: page - 1 })}
                className="rounded-lg border border-line bg-white px-3 py-1.5 hover:border-lav-300"
              >
                Previous
              </Link>
            )}
            {page < totalPages && (
              <Link
                href={buildHref({ page: page + 1 })}
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
