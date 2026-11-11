import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { eq } from "drizzle-orm";
import { renderToStaticMarkup } from "react-dom/server";
import { db } from "@/db";
import { notifications, orders, productReviews, users, walletTransactions } from "@/db/schema";
import { getCurrentUser, requireAuthApi, requireUser, type PublicUser } from "@/lib/identity/auth";
import {
  DEFAULT_PAGE_LIMIT,
  MAX_PAGE_LIMIT,
  MAX_PAGE_OFFSET,
  ORDER_HISTORY_PAGE_SIZE,
  pageWindow,
} from "@/lib/platform/pagination";
import { listReviewableOrders, REVIEWABLE_ORDERS_LIMIT, REVIEWABLE_STATUSES } from "@/lib/content/reviews";
import { isPreviewDatabase } from "@/lib/platform/demo-policy";
import OrdersPage from "@/app/dashboard/orders/page";
import * as adminExport from "@/app/api/admin/export/route";
import * as adminOrders from "@/app/api/admin/orders/route";
import * as adminUsers from "@/app/api/admin/users/route";
import * as markRead from "@/app/api/notifications/mark-read/route";
import * as walletExport from "@/app/api/wallet/transactions/export/route";

/**
 * "Fetching all users at once" is not a hypothetical here: two console list
 * endpoints handed `?limit=` to the database unchanged, and marking a list of
 * notifications read was one UPDATE per id. Neither hurts on a small table,
 * which is exactly why neither was noticed.
 *
 * `DATABASE_URL` is unset in the test environment, so `db` is the in-memory
 * preview database — enough to prove what the routes ask for.
 */

// Both are replaced: the console routes resolve the operator through
// `getCurrentUser`, the customer route through `requireAuthApi`, and the real
// `requireAuthApi` calls the module's own `getCurrentUser`, not this export.
vi.mock("@/lib/identity/auth", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/identity/auth")>();
  return { ...actual, getCurrentUser: vi.fn(), requireAuthApi: vi.fn(), requireUser: vi.fn() };
});

const ADMIN: PublicUser = {
  id: "9d2c1b7e-0f4a-4c8e-9a51-6a3f1d2e4b01",
  email: "admin@pryva.test",
  name: "Operator",
  walletBalance: 0,
  emailVerifiedAt: new Date("2026-01-02T00:00:00Z"),
  createdAt: new Date("2026-01-01T00:00:00Z"),
};

const CUSTOMER: PublicUser = {
  id: "9d2c1b7e-0f4a-4c8e-9a51-6a3f1d2e4b02",
  email: "customer@example.test",
  name: "Customer",
  walletBalance: 0,
  emailVerifiedAt: new Date("2026-01-02T00:00:00Z"),
  createdAt: new Date("2026-01-01T00:00:00Z"),
};

const STRANGER = "9d2c1b7e-0f4a-4c8e-9a51-6a3f1d2e4b03";

function get(path: string) {
  return new NextRequest(`https://pryva.test${path}`, {
    method: "GET",
    headers: { host: "pryva.test", "x-forwarded-proto": "https", origin: "https://pryva.test" },
  });
}

function post(path: string, body: unknown) {
  return new NextRequest(`https://pryva.test${path}`, {
    method: "POST",
    headers: {
      host: "pryva.test",
      "x-forwarded-proto": "https",
      origin: "https://pryva.test",
      "content-type": "application/json",
    },
    body: JSON.stringify(body),
  });
}

beforeEach(() => {
  vi.stubEnv("ADMIN_EMAILS", "admin@pryva.test");
  vi.mocked(getCurrentUser).mockResolvedValue(ADMIN);
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
});

describe("pageWindow", () => {
  const read = (query: string, options?: Parameters<typeof pageWindow>[1]) =>
    pageWindow(new URLSearchParams(query), options);

  it("uses the defaults when nothing is asked for", () => {
    expect(read("")).toEqual({ limit: DEFAULT_PAGE_LIMIT, offset: 0 });
  });

  it("passes an ordinary request through unchanged", () => {
    expect(read("limit=25&offset=75")).toEqual({ limit: 25, offset: 75 });
  });

  it("narrows a request for the whole table to one page", () => {
    expect(read("limit=10000000")).toEqual({ limit: MAX_PAGE_LIMIT, offset: 0 });
    expect(read("limit=101").limit).toBe(MAX_PAGE_LIMIT);
    // Too many digits to be a page size at all: the default, not a crash.
    expect(read("limit=99999999999999999999").limit).toBe(DEFAULT_PAGE_LIMIT);
  });

  it("caps the offset, because OFFSET n reads and discards n rows", () => {
    expect(read("offset=999999999").offset).toBe(MAX_PAGE_OFFSET);
  });

  it.each(["-1", "abc", "1e9", "0x10", "12abc", "1.5", " ", "NaN", "0"])(
    "reads limit=%j as the default rather than sending it to the database",
    (value) => {
      expect(read(`limit=${encodeURIComponent(value)}`).limit).toBe(DEFAULT_PAGE_LIMIT);
    },
  );

  it.each(["-1", "abc", "1e9", "1.5", "NaN"])("reads offset=%j as the first page", (value) => {
    expect(read(`offset=${encodeURIComponent(value)}`).offset).toBe(0);
  });

  it("lets a caller choose tighter bounds, never looser than its own maximum", () => {
    expect(read("", { defaultLimit: 20, maxLimit: 40 })).toEqual({ limit: 20, offset: 0 });
    expect(read("limit=1000", { defaultLimit: 20, maxLimit: 40 }).limit).toBe(40);
    expect(read("", { defaultLimit: 500, maxLimit: 40 }).limit).toBe(40);
    expect(read("offset=900", { maxOffset: 200 }).offset).toBe(200);
  });
});

describe("GET /api/admin/users", () => {
  it("cannot be asked for every account at once", async () => {
    const findMany = vi.spyOn(db.query.users, "findMany");

    const response = await adminUsers.GET(get("/api/admin/users?limit=100000000&offset=-40"));
    const body = (await response.json()) as { limit: number; offset: number };

    expect(response.status).toBe(200);
    expect(body.limit).toBe(MAX_PAGE_LIMIT);
    expect(body.offset).toBe(0);
    expect(findMany).toHaveBeenCalledTimes(1);
    expect(findMany.mock.calls[0]?.[0]).toMatchObject({ limit: MAX_PAGE_LIMIT, offset: 0 });
  });

  it.each(["abc", "-1", "NaN", ""])("answers a junk limit (%j) with a normal page, not a 500", async (value) => {
    const response = await adminUsers.GET(get(`/api/admin/users?limit=${value}`));
    expect(response.status).toBe(200);
    expect(((await response.json()) as { limit: number }).limit).toBe(DEFAULT_PAGE_LIMIT);
  });

  it("reads only the columns it returns", async () => {
    const id = "5a6f0c2d-3b1e-4f7a-8c9d-0e1f2a3b4c01";
    await db.insert(users).values({
      id,
      name: "Listed Person",
      email: "listed-person@example.test",
      passwordHash: "never-leaves-the-database",
      walletBalance: 4_200,
    });
    const findMany = vi.spyOn(db.query.users, "findMany");

    const response = await adminUsers.GET(get("/api/admin/users?limit=100"));
    const text = await response.text();

    // Password hashes used to be loaded into memory for every listed account.
    expect(findMany.mock.calls[0]?.[0]?.columns).toEqual({
      id: true,
      name: true,
      email: true,
      walletBalance: true,
      createdAt: true,
    });
    expect(text).not.toContain("never-leaves-the-database");
    const listed = (JSON.parse(text) as { users: Array<Record<string, unknown>> }).users.find((u) => u.id === id);
    expect(listed).toEqual({
      id,
      name: "Listed Person",
      email: "listed-person@example.test",
      walletBalance: 4_200,
      createdAt: expect.any(String),
    });
  });
});

describe("GET /api/admin/orders", () => {
  const order = (index: number, status: string) => ({
    id: `7b1d4e9a-2c3f-4a5b-8d6e-0f1a2b3c4d${String(index).padStart(2, "0")}`,
    reference: `PV-SCALE-${status}-${index}`,
    userId: CUSTOMER.id,
    service: "numbers" as const,
    productSlug: "scale-test",
    productName: "Scale test",
    planLabel: "One",
    region: "NG",
    duration: "20 min",
    amount: 1_000 + index,
    status,
    provider: "test",
    otpCode: "delivered-secret-code",
  });

  it("cannot be asked for the whole order history at once", async () => {
    const findMany = vi.spyOn(db.query.orders, "findMany");

    const response = await adminOrders.GET(get("/api/admin/orders?limit=5000000&offset=abc"));
    const body = (await response.json()) as { limit: number; offset: number };

    expect(response.status).toBe(200);
    expect(body).toMatchObject({ limit: MAX_PAGE_LIMIT, offset: 0 });
    expect(findMany.mock.calls[0]?.[0]).toMatchObject({ limit: MAX_PAGE_LIMIT, offset: 0 });
  });

  it("reports a total for the filtered set, and never loads what was delivered", async () => {
    // A status nothing else in the test run uses, so the counts below are exact.
    await db.insert(orders).values([order(1, "scale-held"), order(2, "scale-held"), order(3, "scale-other")]);
    const findMany = vi.spyOn(db.query.orders, "findMany");

    const response = await adminOrders.GET(get("/api/admin/orders?status=scale-held&limit=1"));
    const text = await response.text();
    const body = JSON.parse(text) as { orders: Array<{ status: string }>; total: number; limit: number };

    expect(response.status).toBe(200);
    expect(body.limit).toBe(1);
    expect(body.orders).toHaveLength(1);
    expect(body.orders[0].status).toBe("scale-held");
    // It used to count every order in the table, whatever the filter said.
    expect(body.total).toBe(2);

    const columns = findMany.mock.calls[0]?.[0]?.columns as Record<string, boolean>;
    expect(columns.otpCode).toBeUndefined();
    expect(Object.keys(columns).sort()).toEqual(
      ["amount", "createdAt", "id", "productName", "reference", "service", "status", "userId"].sort(),
    );
    expect(text).not.toContain("delivered-secret-code");
  });

  it("still counts everything when no filter is given", async () => {
    const all = await db.select().from(orders);
    const response = await adminOrders.GET(get("/api/admin/orders"));
    expect(((await response.json()) as { total: number }).total).toBe(all.length);
  });
});

describe("POST /api/notifications/mark-read", () => {
  const note = (index: number, userId: string) => ({
    id: `3c5e7a9b-1d2f-4b6c-8e0a-2c4e6a8b0d${String(index).padStart(2, "0")}`,
    userId,
    title: `Notice ${index}`,
    message: "Scale test",
    // Explicit: the in-memory database does not apply column defaults.
    read: 0,
  });

  it("marks a whole list read with one statement, and only the caller's rows", async () => {
    vi.mocked(requireAuthApi).mockResolvedValue(CUSTOMER);
    const mine = [note(1, CUSTOMER.id), note(2, CUSTOMER.id), note(3, CUSTOMER.id)];
    const untouched = note(4, CUSTOMER.id);
    const theirs = note(5, STRANGER);
    await db.insert(notifications).values([...mine, untouched, theirs]);
    const update = vi.spyOn(db, "update");

    const response = await markRead.POST(
      post("/api/notifications/mark-read", {
        // A repeated id and somebody else's id: neither may cost a statement,
        // and the second must not be marked.
        notificationIds: [...mine.map((row) => row.id), mine[0].id, theirs.id],
      }),
    );

    expect(response.status).toBe(200);
    // It was one UPDATE per id: a hundred ids, a hundred round trips.
    expect(update).toHaveBeenCalledTimes(1);

    const readOf = async (id: string) =>
      (await db.select().from(notifications).where(eq(notifications.id, id)))[0]?.read;
    for (const row of mine) expect(await readOf(row.id)).toBe(1);
    expect(await readOf(untouched.id)).toBe(0);
    expect(await readOf(theirs.id)).toBe(0);
  });

  it("still refuses more than a hundred ids", async () => {
    vi.mocked(requireAuthApi).mockResolvedValue(CUSTOMER);
    const update = vi.spyOn(db, "update");
    const ids = Array.from({ length: 101 }, () => note(1, CUSTOMER.id).id);

    const response = await markRead.POST(post("/api/notifications/mark-read", { notificationIds: ids }));

    expect(response.status).toBe(400);
    expect(update).not.toHaveBeenCalled();
  });
});

/**
 * The limits themselves are pinned in `export-bounds.test.ts`, against a query
 * recorder. These run the same routes against the in-memory database the preview
 * uses, to prove the bounded queries still return what an export is for.
 */
describe("exports still export", () => {
  it("the operator export returns the accounts in a date range, and only their listed fields", async () => {
    const createdAt = new Date("2001-05-05T12:00:00Z");
    await db.insert(users).values([
      { id: "6b7a1d3e-4c2f-4a8b-9d0e-1f2a3b4c5d01", name: "Early One", email: "early-one@example.test", passwordHash: "export-must-not-carry-this", walletBalance: 10, createdAt },
      { id: "6b7a1d3e-4c2f-4a8b-9d0e-1f2a3b4c5d02", name: "Early Two", email: "early-two@example.test", passwordHash: "export-must-not-carry-this", walletBalance: 20, createdAt },
    ]);

    const response = await adminExport.GET(
      get("/api/admin/export?type=users&format=json&startDate=2001-05-01&endDate=2001-05-31"),
    );
    const text = await response.text();
    const exported = JSON.parse(text) as Array<Record<string, unknown>>;

    expect(response.status).toBe(200);
    expect(exported.map((row) => row.email).sort()).toEqual(["early-one@example.test", "early-two@example.test"]);
    expect(Object.keys(exported[0]).sort()).toEqual(["createdAt", "email", "id", "name", "walletBalance"]);
    expect(text).not.toContain("export-must-not-carry-this");
  });

  it("a customer's ledger export returns their own rows and nobody else's", async () => {
    vi.mocked(requireAuthApi).mockResolvedValue(CUSTOMER);
    const row = (index: number, userId: string) => ({
      id: `4d6f8a0c-2e4b-4c6d-8f0a-3b5d7f9a1c${String(index).padStart(2, "0")}`,
      userId,
      type: "credit",
      amount: 500 + index,
      balanceAfter: 500 + index,
      description: `Scale export ${index}`,
      reference: `scale-export-${index}`,
    });
    await db.insert(walletTransactions).values([row(1, CUSTOMER.id), row(2, CUSTOMER.id), row(3, STRANGER)]);

    const response = await walletExport.GET(get("/api/wallet/transactions/export?format=json"));
    const exported = (await response.json()) as Array<{ reference: string }>;

    expect(response.status).toBe(200);
    const references = exported.map((entry) => entry.reference);
    expect(references).toContain("scale-export-1");
    expect(references).toContain("scale-export-2");
    expect(references).not.toContain("scale-export-3");
    expect(Object.keys(exported[0]).sort()).toEqual(["amount", "balanceAfter", "date", "description", "reference", "type"]);
  });
});

/**
 * `orders-history-page.test.tsx` holds the customer's order history to its page
 * size against real SQL. The preview has no SQL to send a search to, so the
 * reader keeps a second path for it; that path is exercised here, on the
 * in-memory database itself, and must give the same page.
 */
describe("the customer's order history on the in-memory database", () => {
  const HISTORY_OWNER: PublicUser = { ...CUSTOMER, id: "9d2c1b7e-0f4a-4c8e-9a51-6a3f1d2e4b77", email: "history@example.test" };

  const historyOrder = (index: number) => ({
    id: `8c2e5f0b-3d4a-4b6c-9e7f-${String(index).padStart(12, "0")}`,
    reference: `PV-HIST-${index}`,
    userId: HISTORY_OWNER.id,
    service: "numbers" as const,
    productSlug: "history",
    productName: `Preview history ${index}`,
    planLabel: "One",
    region: "NG",
    duration: "20 min",
    amount: 1_000,
    status: index % 2 === 0 ? "refunded" : "active",
    provider: "test",
    // Newest first is order 1: a minute apart, so the order is not left to ties.
    createdAt: new Date(Date.UTC(2026, 4, 1) - index * 60_000),
  });

  const listed = (html: string) => [...html.matchAll(/href="\/dashboard\/orders\/([0-9a-f-]{36})"/g)].map((m) => m[1]);

  async function renderHistory(params: { status?: string; q?: string; page?: string } = {}) {
    vi.mocked(requireUser).mockResolvedValue(HISTORY_OWNER);
    // No DATABASE_URL in a test run, so this is the preview path, as deployed previews run it.
    expect(isPreviewDatabase()).toBe(true);
    return renderToStaticMarkup(await OrdersPage({ searchParams: Promise.resolve(params) }));
  }

  it("lists a short history whole, with its counts", async () => {
    await db.insert(orders).values([historyOrder(1), historyOrder(2), historyOrder(3)]);

    const html = await renderHistory();

    expect(listed(html)).toHaveLength(3);
    expect(html).toContain("All (3)");
    expect(html).toContain("Active (2)");
    expect(html).toContain("Refunded (1)");
    expect(html).not.toContain("Order history pages");
  });

  it("pages a long one, newest first, without losing or repeating an order", async () => {
    const total = ORDER_HISTORY_PAGE_SIZE + 5;
    // Orders 1 to 3 exist from the test above.
    await db.insert(orders).values(Array.from({ length: total - 3 }, (_, index) => historyOrder(index + 4)));

    const first = await renderHistory();
    const second = await renderHistory({ page: "2" });

    expect(listed(first)).toHaveLength(ORDER_HISTORY_PAGE_SIZE);
    expect(listed(second)).toHaveLength(5);
    expect(new Set([...listed(first), ...listed(second)]).size).toBe(total);
    expect(first).toContain("Preview history 1<");
    expect(first).toContain("Older orders");
    expect(first).toContain(`Orders 1–${ORDER_HISTORY_PAGE_SIZE} of ${total}, newest first.`);
    expect(second).toContain(`Preview history ${total}<`);
    expect(second).toContain("Newer orders");
    expect(second).not.toContain("Older orders");
    // Counts of the whole history on every page: odd orders are active.
    for (const html of [first, second]) {
      expect(html).toContain(`All (${total})`);
      expect(html).toContain(`Active (${Math.ceil(total / 2)})`);
      expect(html).toContain(`Refunded (${Math.floor(total / 2)})`);
    }
  });

  it("searches and filters the whole history, not the page on screen", async () => {
    const total = ORDER_HISTORY_PAGE_SIZE + 5;

    // The oldest order is on the second page of the unfiltered list.
    const found = await renderHistory({ q: `pv-hist-${total}` });
    expect(listed(found)).toHaveLength(1);
    expect(found).toContain(`Preview history ${total}<`);
    expect(found).not.toContain("Order history pages");

    const refunded = await renderHistory({ status: "refunded" });
    expect(listed(refunded)).toHaveLength(Math.floor(total / 2));
    expect(refunded).not.toContain("Order history pages");

    const nothing = await renderHistory({ q: "no such order" });
    expect(nothing).toContain("Nothing matches that");
    expect(nothing).toContain(`All (${total})`);
  });

  it("sends a page past the end back to the start", async () => {
    // The framework's own redirect: an error whose digest carries the target.
    await expect(renderHistory({ page: "7", status: "refunded" })).rejects.toMatchObject({
      digest: expect.stringMatching(/^NEXT_REDIRECT;.*;\/dashboard\/orders\?status=refunded;/),
    });
  });
});

/**
 * One drop-down on the reviews page used to cost a read of every order the
 * customer had ever placed, whatever its status, plus every review they wrote.
 */
describe("the review picker", () => {
  const REVIEWER = "9d2c1b7e-0f4a-4c8e-9a51-6a3f1d2e4b88";

  const purchase = (index: number, status: string) => ({
    id: `5e7a9c1d-2f3b-4d5e-8a6b-${String(index).padStart(12, "0")}`,
    reference: `PV-REVIEW-${index}`,
    userId: REVIEWER,
    service: "numbers" as const,
    productSlug: "review",
    productName: `Reviewable ${index}`,
    planLabel: "One",
    region: "NG",
    duration: "20 min",
    amount: 1_000,
    status,
    provider: "test",
    // Purchase 1 is the newest.
    createdAt: new Date(Date.UTC(2026, 4, 1) - index * 60_000),
  });

  it("offers the most recent delivered orders, not the whole history", async () => {
    const total = REVIEWABLE_ORDERS_LIMIT + 40;
    await db.insert(orders).values(
      // Every fifth purchase never arrived, so it can never be reviewed.
      Array.from({ length: total }, (_, index) => purchase(index + 1, (index + 1) % 5 === 0 ? "refunded" : "delivered")),
    );
    const select = vi.spyOn(db, "select");

    const offered = await listReviewableOrders(REVIEWER);

    expect(offered).toHaveLength(REVIEWABLE_ORDERS_LIMIT);
    expect(offered[0].reference).toBe("PV-REVIEW-1");
    expect(offered.every((order) => (REVIEWABLE_STATUSES as readonly string[]).includes(order.status))).toBe(true);
    // The hundred newest delivered ones: 124 purchases back, a fifth of them refunded.
    expect(offered.at(-1)?.reference).toBe("PV-REVIEW-124");
    // The customer's reviews, then the orders. Two bounded reads.
    expect(select).toHaveBeenCalledTimes(2);
  });

  it("drops an order once it has a review, and offers the next one in its place", async () => {
    await db.insert(productReviews).values({
      id: "6f8b0d2e-3a4c-4e6f-9b7c-000000000001",
      userId: REVIEWER,
      orderId: purchase(1, "delivered").id,
      service: "numbers",
      productName: "Reviewable 1",
      rating: 5,
      body: "Arrived in seconds and worked the first time.",
      status: "pending",
    });

    const offered = await listReviewableOrders(REVIEWER);

    expect(offered.map((order) => order.reference)).not.toContain("PV-REVIEW-1");
    expect(offered[0].reference).toBe("PV-REVIEW-2");
    // Still a full list: a reviewed order makes room for an older one, so a
    // customer who reviews everything recent is not left with an empty picker.
    expect(offered).toHaveLength(REVIEWABLE_ORDERS_LIMIT);
    expect(offered.at(-1)?.reference).toBe("PV-REVIEW-126");
  });

  it("answers a customer with nothing delivered", async () => {
    expect(await listReviewableOrders("9d2c1b7e-0f4a-4c8e-9a51-6a3f1d2e4b99")).toHaveLength(0);
  });
});
