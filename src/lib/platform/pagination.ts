/**
 * A bounded `limit` / `offset` for a list endpoint.
 *
 * ## The failure this prevents
 *
 * A list route that passes `?limit=` straight to the database lets the caller
 * choose how many rows are read, held in memory and serialised. `limit=10000000`
 * is then "fetch the whole table at once": on a table that only ever grows it is
 * a slow page today and an outage later, and the route that allows it is usually
 * one nobody load-tested because it sits behind sign-in. The two console list
 * endpoints did exactly this — `parseInt` and nothing else, so a negative value
 * became a database error and `abc` became `NaN`.
 *
 * ## Why it clamps instead of refusing
 *
 * An operator who asks for 500 rows should get the 100 the endpoint is willing
 * to send, not a 400 to decode. The window that was actually used is returned,
 * and every caller echoes it in the response, so a script paging through
 * results can see that its request was narrowed and step by the real size.
 *
 * `offset` is capped too. `OFFSET n` is not free: PostgreSQL walks and discards
 * `n` rows before returning one, so an unbounded offset is the same full read
 * as an unbounded limit, just with a smaller response.
 */
export type PageWindow = { limit: number; offset: number };

export const DEFAULT_PAGE_LIMIT = 50;
export const MAX_PAGE_LIMIT = 100;
export const MAX_PAGE_OFFSET = 100_000;

type PageWindowOptions = { defaultLimit?: number; maxLimit?: number; maxOffset?: number };

/** A plain run of digits, or nothing. `-1`, `1e9`, `0x10` and `12abc` are nothing. */
function wholeNumber(value: string | null): number | null {
  if (value === null) return null;
  const trimmed = value.trim();
  return /^\d{1,9}$/.test(trimmed) ? Number(trimmed) : null;
}

export function pageWindow(params: URLSearchParams, options: PageWindowOptions = {}): PageWindow {
  const maxLimit = options.maxLimit ?? MAX_PAGE_LIMIT;
  const defaultLimit = Math.min(options.defaultLimit ?? DEFAULT_PAGE_LIMIT, maxLimit);
  const maxOffset = options.maxOffset ?? MAX_PAGE_OFFSET;

  const requestedLimit = wholeNumber(params.get("limit"));
  const requestedOffset = wholeNumber(params.get("offset"));

  return {
    // Zero is treated like a missing value: "no rows, please" is never what a
    // list request means, and it is what an unset form field sends.
    limit: Math.min(maxLimit, requestedLimit && requestedLimit > 0 ? requestedLimit : defaultLimit),
    offset: Math.min(maxOffset, requestedOffset ?? 0),
  };
}

/**
 * Bounds for the export endpoints, which are lists with no page.
 *
 * An export is the one read that is *meant* to return everything, which is why
 * it is the one most likely to be written with no limit at all. "Everything"
 * still has to fit in one request's memory and one response, and on a table that
 * only grows it eventually does not. The exports therefore read at most this
 * many rows and refuse — with an instruction to narrow the range — when there
 * are more. They never truncate: a ledger file that silently stops partway is
 * worse than a request that says no.
 *
 * The byte ceiling bounds the other half of the cost: the file is built whole,
 * in memory, beside the rows it was built from. It sits under 4.5 MB because
 * that is the largest response body the host documents for a function that does
 * not stream (https://vercel.com/docs/functions/limitations), so a file these
 * routes agree to send is one the host delivers however it treats the response.
 * Above it the caller gets a message they can act on instead of a platform
 * error they cannot.
 */
export const MAX_ADMIN_EXPORT_ROWS = 10_000;
/** Matches `/api/user/export`, which has always refused beyond this. */
export const MAX_CUSTOMER_EXPORT_ROWS = 5_000;
export const MAX_EXPORT_BYTES = 4_000_000;

/**
 * Orders on one page of a customer's own history (`/dashboard/orders`).
 *
 * Large on purpose: a customer whose whole history fits sees one list, as
 * before, and that is nearly everyone. It lives here, not in the page, because
 * a Next.js page file may export only page fields.
 */
export const ORDER_HISTORY_PAGE_SIZE = 200;
