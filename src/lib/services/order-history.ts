import { and, desc, eq, sql, type SQL } from "drizzle-orm";
import { db } from "@/db";
import { orders } from "@/db/schema";
import { isPreviewDatabase } from "@/lib/platform/demo-policy";
import { ORDER_HISTORY_PAGE_SIZE } from "@/lib/platform/pagination";

/**
 * A customer's own order history, one page at a time.
 *
 * ## What this replaced
 *
 * `/dashboard/orders` read every order the customer had ever placed — every
 * column, what was delivered included — and then filtered, searched and counted
 * them in the page. Almost nobody has enough orders to notice. The few who do
 * are the busiest customers, and for them it was a read and a page that grew
 * with every purchase, on the screen they open most; nothing stopped an account
 * from asking for it in a loop.
 *
 * ## What it does now
 *
 * The status filter and the search run in the database, over the whole history,
 * and one page of the result comes back: only the columns the list shows. So
 * the page behaves as it always did — the search finds an old order, the counts
 * are counts of everything — and only the list is cut into pages.
 *
 * For a history that fits on one page with nothing narrowed, which is nearly
 * every visit, that is still a single statement: the counts are taken from the
 * rows already in hand. Otherwise one grouped count is added.
 *
 * The in-memory preview has no SQL to send the search to. Its tables are arrays
 * in this process holding a handful of rows, so it keeps doing in JavaScript
 * what the page used to do, and returns the same shape.
 */

export type OrderHistoryRow = {
  id: string;
  reference: string;
  productName: string;
  planLabel: string;
  region: string | null;
  amount: number;
  status: string;
  otpCode: string | null;
  expiresAt: Date | string | null;
  refundedAt: Date | string | null;
  createdAt: Date | string;
};

/** The ECMAScript trim whitespace set, also passed to SQL when finding live codes. */
export const CODE_TRIM_WHITESPACE = "\u0009\u000a\u000b\u000c\u000d\u0020\u00a0\u1680\u2000\u2001\u2002\u2003\u2004\u2005\u2006\u2007\u2008\u2009\u200a\u2028\u2029\u202f\u205f\u3000\ufeff";

/** A displayed code is only live while its recorded window and order permit it. */
export function hasLiveOrderCode(
  order: Pick<OrderHistoryRow, "status" | "otpCode" | "expiresAt" | "refundedAt">,
  now: number,
): boolean {
  if ((order.status !== "active" && order.status !== "delivered") || order.refundedAt || !order.otpCode?.trim() || !order.expiresAt) {
    return false;
  }
  const expiry = new Date(order.expiresAt).getTime();
  return Number.isFinite(expiry) && expiry > now;
}

export type OrderHistoryPage = {
  /** The orders to list: filtered, searched, newest first, at most one page. */
  rows: OrderHistoryRow[];
  /** More matching orders exist after this page. */
  hasOlder: boolean;
  /** Counts over the whole history, whatever the filter or the search. */
  totals: { all: number; active: number; refunded: number };
};

/** 100,000 orders. Past this the offset costs more than the page is worth. */
export const LAST_ORDER_HISTORY_PAGE = 500;

/** `?page=` as the address bar gives it: a small positive integer, or page one. */
export function orderHistoryPageNumber(value: unknown): number {
  if (typeof value !== "string" || !/^\d{1,4}$/.test(value)) return 1;
  return Math.min(Math.max(Number(value), 1), LAST_ORDER_HISTORY_PAGE);
}

const LISTED_COLUMNS = {
  id: orders.id,
  reference: orders.reference,
  productName: orders.productName,
  planLabel: orders.planLabel,
  region: orders.region,
  amount: orders.amount,
  status: orders.status,
  otpCode: orders.otpCode,
  expiresAt: orders.expiresAt,
  refundedAt: orders.refundedAt,
  createdAt: orders.createdAt,
};

/** What the search box looks through, as one string: the same four fields the page always joined. */
function searchedText(order: Pick<OrderHistoryRow, "productName" | "planLabel" | "reference" | "region">): string {
  return [order.productName, order.planLabel, order.reference, order.region ?? ""].join(" ");
}

/**
 * The customer's words as a `LIKE` pattern that means "contains exactly this".
 * `%` and `_` are wildcards and `\` is the escape character; typed into a search
 * box they are just characters, so each is escaped.
 */
function containsPattern(needle: string): string {
  return `%${needle.replace(/[\\%_]/g, "\\$&")}%`;
}

function totalsOf(rows: readonly Pick<OrderHistoryRow, "status">[]): OrderHistoryPage["totals"] {
  return {
    all: rows.length,
    active: rows.filter((order) => order.status === "active").length,
    refunded: rows.filter((order) => order.status === "refunded").length,
  };
}

async function readPreviewHistory(
  userId: string,
  status: string,
  needle: string,
  page: number,
): Promise<OrderHistoryPage> {
  const everything = (await db
    .select(LISTED_COLUMNS)
    .from(orders)
    .where(eq(orders.userId, userId))
    .orderBy(desc(orders.createdAt), desc(orders.id))) as OrderHistoryRow[];

  const lowered = needle.toLowerCase();
  const matches = everything.filter((order) => {
    if (status !== "all" && order.status !== status) return false;
    return !lowered || searchedText(order).toLowerCase().includes(lowered);
  });

  const start = (page - 1) * ORDER_HISTORY_PAGE_SIZE;
  return {
    rows: matches.slice(start, start + ORDER_HISTORY_PAGE_SIZE),
    hasOlder: matches.length > start + ORDER_HISTORY_PAGE_SIZE,
    totals: totalsOf(everything),
  };
}

export async function readOrderHistory(input: {
  userId: string;
  /** `all`, or the one status to show. An unknown status simply matches nothing. */
  status: string;
  /** The search box, as typed. */
  query: string;
  page: number;
}): Promise<OrderHistoryPage> {
  const needle = input.query.trim();
  const page = Math.min(Math.max(Math.trunc(input.page) || 1, 1), LAST_ORDER_HISTORY_PAGE);

  if (isPreviewDatabase()) return readPreviewHistory(input.userId, input.status, needle, page);

  const own = eq(orders.userId, input.userId);
  const conditions: SQL[] = [own];
  if (input.status !== "all") conditions.push(eq(orders.status, input.status));
  if (needle) {
    conditions.push(
      sql`(${orders.productName} || ' ' || ${orders.planLabel} || ' ' || ${orders.reference} || ' ' || coalesce(${orders.region}, '')) ILIKE ${containsPattern(needle)}`,
    );
  }

  // One row more than a page, to know whether an older page exists without
  // counting the matches. `id` breaks ties: a bulk purchase writes several
  // orders with one timestamp, and a page boundary must not shuffle them.
  const read = (await db
    .select(LISTED_COLUMNS)
    .from(orders)
    .where(and(...conditions))
    .orderBy(desc(orders.createdAt), desc(orders.id))
    .offset((page - 1) * ORDER_HISTORY_PAGE_SIZE)
    .limit(ORDER_HISTORY_PAGE_SIZE + 1)) as OrderHistoryRow[];

  const hasOlder = read.length > ORDER_HISTORY_PAGE_SIZE;
  const rows = hasOlder ? read.slice(0, ORDER_HISTORY_PAGE_SIZE) : read;

  // Nothing narrowed and nothing left over: these rows are the whole history.
  const wholeHistory = page === 1 && !hasOlder && conditions.length === 1;
  if (wholeHistory) return { rows, hasOlder, totals: totalsOf(rows) };

  const [counted] = await db
    .select({
      all: sql<number>`count(*)::int`,
      active: sql<number>`(count(*) FILTER (WHERE ${orders.status} = 'active'))::int`,
      refunded: sql<number>`(count(*) FILTER (WHERE ${orders.status} = 'refunded'))::int`,
    })
    .from(orders)
    .where(own);

  return {
    rows,
    hasOlder,
    totals: {
      all: Number(counted?.all ?? 0),
      active: Number(counted?.active ?? 0),
      refunded: Number(counted?.refunded ?? 0),
    },
  };
}
