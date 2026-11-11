import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi, type MockInstance } from "vitest";
import { readdir, readFile } from "node:fs/promises";
import { readFileSync } from "node:fs";
import { renderToStaticMarkup } from "react-dom/server";
import { PGlite } from "@electric-sql/pglite";
import { drizzle, type PgliteDatabase } from "drizzle-orm/pglite";
import * as schema from "@/db/schema";
import { ORDER_HISTORY_PAGE_SIZE } from "@/lib/platform/pagination";

/**
 * A customer's order history used to be read whole — every order, every column,
 * what was delivered included — and then filtered, searched and counted in the
 * page, on every visit to the page customers open most. The filter and the
 * search now run in the database and one page of the result comes back.
 *
 * Three promises are held here: the page behaves as it always did (the search
 * finds an old order, the counts are counts of everything); a long history is
 * reachable in full, in order, with nothing skipped or repeated at a page
 * boundary; and the read stays one page however long the history is.
 *
 * Real SQL against PGlite, so what is asserted is the statement the page sends.
 * `list-endpoints-bounded.test.ts` runs the same page on the in-memory preview.
 */

const mocks = vi.hoisted(() => ({ db: undefined as unknown, user: vi.fn() }));
vi.mock("@/db", () => ({ get db() { return mocks.db; } }));
// No DATABASE_URL in a test run, so the reader would take its preview path.
vi.mock("@/lib/platform/demo-policy", () => ({ isPreviewDatabase: () => false }));
vi.mock("@/lib/identity/auth", () => ({ requireUser: mocks.user }));
vi.mock("next/navigation", () => ({
  redirect: (url: string) => {
    throw new Error(`REDIRECT ${url}`);
  },
}));

let pg: PGlite;
let database: PgliteDatabase<typeof schema>;
let OrdersPage: typeof import("@/app/dashboard/orders/page").default;

const CUSTOMER = "11111111-1111-4111-8111-111111111111";
const SOMEONE_ELSE = "22222222-2222-4222-8222-222222222222";
const NEW_CUSTOMER = "33333333-3333-4333-8333-333333333333";
const SECRET = "delivered-login-never-in-a-list";

type Params = { status?: unknown; q?: unknown; page?: unknown };

async function render(params: Params = {}): Promise<string> {
  const element = await OrdersPage({
    searchParams: Promise.resolve(params) as Parameters<typeof OrdersPage>[0]["searchParams"],
  });
  return renderToStaticMarkup(element);
}

/** The statements one render sent, with their parameters. */
function sent(spy: MockInstance<PGlite["query"]>): Array<{ text: string; values: unknown[] }> {
  return spy.mock.calls.map((call) => ({ text: String(call[0]), values: (call[1] ?? []) as unknown[] }));
}

/** Order ids in the order the list shows them. */
function listed(html: string): string[] {
  return [...html.matchAll(/href="\/dashboard\/orders\/([0-9a-f-]{36})"/g)].map((match) => match[1]);
}

function link(html: string, rel: "prev" | "next"): string | null {
  const tag = html.match(new RegExp(`<a[^>]*rel="${rel}"[^>]*>`))?.[0];
  return tag?.match(/href="([^"]*)"/)?.[1].replaceAll("&amp;", "&") ?? null;
}

/**
 * `count` orders for one account, order 1 the newest and a minute between each.
 * One in ten is refunded (5, 15, 25…). Orders 199 to 202 share one timestamp,
 * the way a bulk purchase writes them, so the first page boundary falls inside a
 * tie; none of those four is refunded, so which side of the boundary each lands
 * on does not change any count below.
 */
async function seedHistory(userId: string, count: number, label = "History") {
  await pg.query(
    `INSERT INTO orders (reference, user_id, service, product_slug, product_name, plan_label, region, duration,
                         amount, provider, status, accounts, created_at)
     SELECT $2 || '-' || g, $1, 'numbers', 'history', $2 || ' ' || g, 'One', 'NG', '20 min',
            1000 + g, 'test',
            CASE WHEN g % 10 = 5 THEN 'refunded' ELSE 'active' END,
            $3,
            timestamptz '2026-05-01 00:00:00+00'
              - make_interval(mins => CASE WHEN g BETWEEN 199 AND 202 THEN 200 ELSE g END)
       FROM generate_series(1, $4::int) g`,
    [userId, label, JSON.stringify([SECRET]), count],
  );
}

beforeAll(async () => {
  pg = new PGlite();
  const files = (await readdir("migrations")).filter((name) => /^\d{4}_.*\.sql$/.test(name)).sort();
  for (const file of files) await pg.exec(await readFile(`migrations/${file}`, "utf8"));
  database = drizzle(pg, { schema });
  mocks.db = database;
  // The page is the unit under test; what an insert schedules is not.
  await pg.exec(
    "ALTER TABLE orders DISABLE TRIGGER USER; ALTER TABLE users DISABLE TRIGGER USER; ALTER TABLE product_reviews DISABLE TRIGGER USER;",
  );
  await pg.query(
    `INSERT INTO users (id, name, email, password_hash)
     VALUES ($1, 'Busy Customer', 'busy@example.test', 'x'),
            ($2, 'Someone Else', 'else@example.test', 'x'),
            ($3, 'New Customer', 'new@example.test', 'x')`,
    [CUSTOMER, SOMEONE_ELSE, NEW_CUSTOMER],
  );
  ({ default: OrdersPage } = await import("@/app/dashboard/orders/page"));
}, 120_000);

afterAll(async () => {
  await pg?.close();
});

beforeEach(async () => {
  await pg.exec("TRUNCATE TABLE orders CASCADE");
  mocks.user.mockResolvedValue({ id: CUSTOMER, email: "busy@example.test", name: "Busy Customer" });
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("a history that fits on one page is shown as it always was", () => {
  it("lists every order, with counts in the filters and no pager, in one statement", async () => {
    await seedHistory(CUSTOMER, 30);
    const spy = vi.spyOn(pg, "query");

    const html = await render();

    expect(listed(html)).toHaveLength(30);
    expect(html).toContain("All (30)");
    expect(html).toContain("Active (27)");
    expect(html).toContain("Refunded (3)");
    expect(html).not.toContain("Order history pages");
    expect(html).not.toContain("Older orders");
    expect(html).not.toContain("Newer orders");
    // The counts come from the rows in hand: no second trip for nearly every visit.
    expect(spy).toHaveBeenCalledTimes(1);
  });

  it("filters by status, and keeps counting the whole history", async () => {
    await seedHistory(CUSTOMER, 30);

    const html = await render({ status: "refunded" });

    expect(listed(html)).toHaveLength(3);
    expect(html).toContain("History 15<");
    expect(html).not.toContain("History 16<");
    expect(html).toContain("All (30)");
    expect(html).toContain("Active (27)");
    expect(html).toContain("Refunded (3)");
  });

  it("searches the product, the plan, the reference and the region, in any case", async () => {
    await seedHistory(CUSTOMER, 30);

    const byReference = await render({ q: "  HISTORY-17 " });
    expect(listed(byReference)).toHaveLength(1);
    expect(byReference).toContain("History 17<");
    expect(byReference).toContain("All (30)");

    // The four fields were always searched as one string, so words that run
    // from the plan into the reference still match.
    const acrossFields = await render({ q: "one history-17" });
    expect(listed(acrossFields)).toHaveLength(1);

    expect(listed(await render({ q: "ng" }))).toHaveLength(30);
    expect(listed(await render({ q: "history-17", status: "refunded" }))).toHaveLength(0);
  });

  it("says so when nothing matches, and when the status is one it has never heard of", async () => {
    await seedHistory(CUSTOMER, 30);

    const noMatch = await render({ q: "no such order" });
    expect(noMatch).toContain("Nothing matches that");
    expect(noMatch).not.toContain("No orders yet");
    expect(noMatch).toContain("All (30)");

    const unknownStatus = await render({ status: "teleported" });
    expect(listed(unknownStatus)).toHaveLength(0);
    expect(unknownStatus).toContain("Nothing matches that");
  });

  it("treats %, _ and \\ in the search box as characters, not wildcards", async () => {
    await seedHistory(CUSTOMER, 30);
    await pg.query(
      `INSERT INTO orders (reference, user_id, service, product_slug, product_name, plan_label, region, duration, amount, provider, status)
       VALUES ('PV-ODD-1', $1, 'numbers', 'odd', '50% off_deal C:\\temp', 'One', 'NG', '20 min', 500, 'test', 'active')`,
      [CUSTOMER],
    );

    // Unescaped, `%` and `_` would each match all thirty-one orders.
    for (const needle of ["%", "_", "\\", "50% off_deal", "c:\\temp"]) {
      const html = await render({ q: needle });
      expect(listed(html), `searching for ${needle}`).toHaveLength(1);
      expect(html).toContain("PV-ODD-1");
    }
    expect(listed(await render({ q: "5_%" }))).toHaveLength(0);
  });

  it("holds exactly one page without calling it paged", async () => {
    await seedHistory(CUSTOMER, ORDER_HISTORY_PAGE_SIZE);

    const html = await render();

    expect(listed(html)).toHaveLength(ORDER_HISTORY_PAGE_SIZE);
    expect(html).toContain(`All (${ORDER_HISTORY_PAGE_SIZE})`);
    expect(html).not.toContain("Order history pages");
  });

  it("tells a customer with no orders that there are none", async () => {
    mocks.user.mockResolvedValue({ id: NEW_CUSTOMER });

    const html = await render();

    expect(html).toContain("No orders yet");
    expect(html).not.toContain("Order history pages");
    expect(html).not.toContain("Search orders");
  });

  it("does not fall over when the address repeats a parameter", async () => {
    await seedHistory(CUSTOMER, 30);

    const html = await render({ q: ["history-17", "history-18"], status: ["refunded", "active"], page: ["2", "3"] });

    // The first of each: refunded orders matching history-17, of which there are none.
    expect(html).toContain("Nothing matches that");
  });
});

describe("a longer history is read one page at a time", () => {
  it("asks the database for one page, and only the columns the list shows", async () => {
    await seedHistory(CUSTOMER, 450);
    const spy = vi.spyOn(pg, "query");

    await render();

    // The page, then one grouped count for the filters. It used to be one
    // statement that returned everything.
    const [page, counts, ...rest] = sent(spy);
    expect(rest).toEqual([]);
    expect(page.text).toMatch(/\blimit \$2$/i);
    // One row more than a page: enough to know an older page exists.
    expect(page.values).toEqual([CUSTOMER, ORDER_HISTORY_PAGE_SIZE + 1]);
    // It was `select *`: delivered credentials and activation codes for every
    // order the customer ever placed, to draw a list of names and prices.
    expect(page.text).not.toMatch(/"accounts"|esim_activation_code|esim_install_url|reference_code|target_link/);
    expect(page.text).toMatch(/order by "orders"\."created_at" desc, "orders"\."id" desc/i);

    expect(counts.text).toMatch(/count\(\*\)/i);
    expect(counts.text).not.toMatch(/\blimit\b|order by/i);
    expect(counts.values).toEqual([CUSTOMER]);

    spy.mockClear();
    await render({ page: "2" });
    const [older] = sent(spy);
    expect(older.text).toMatch(/\blimit \$2 offset \$3$/i);
    expect(older.values).toEqual([CUSTOMER, ORDER_HISTORY_PAGE_SIZE + 1, ORDER_HISTORY_PAGE_SIZE]);
  });

  it("sends the filter and the search to the database as values, never as SQL", async () => {
    await seedHistory(CUSTOMER, 450);
    const spy = vi.spyOn(pg, "query");

    const html = await render({ status: "refunded'; DROP TABLE orders; --", q: "x' OR '1'='1" });

    const [page] = sent(spy);
    expect(page.values).toEqual([
      CUSTOMER,
      "refunded'; DROP TABLE orders; --",
      "%x' OR '1'='1%",
      ORDER_HISTORY_PAGE_SIZE + 1,
    ]);
    expect(page.text).not.toContain("DROP TABLE");
    expect(html).toContain("Nothing matches that");
    expect((await pg.query<{ n: number }>("SELECT count(*)::int AS n FROM orders")).rows[0].n).toBe(450);
  });

  it("never puts what was delivered into the list", async () => {
    await seedHistory(CUSTOMER, 5);
    expect(await render()).not.toContain(SECRET);
  });

  it("shows the newest page first, with a way to the older ones and counts of everything", async () => {
    await seedHistory(CUSTOMER, 450);

    const html = await render();

    expect(listed(html)).toHaveLength(ORDER_HISTORY_PAGE_SIZE);
    expect(html).toContain("History 1<");
    expect(html).not.toContain("History 203<");
    expect(html).toContain("Orders 1–200 of 450, newest first.");
    expect(link(html, "next")).toBe("/dashboard/orders?page=2");
    expect(link(html, "prev")).toBeNull();
    // Counts of the whole history, not of the two hundred on screen.
    expect(html).toContain("All (450)");
    expect(html).toContain("Active (405)");
    expect(html).toContain("Refunded (45)");
  });

  it("walks the whole history, in order, with nothing skipped or repeated", async () => {
    await seedHistory(CUSTOMER, 450);
    const everything = (
      await pg.query<{ id: string }>(
        `SELECT id FROM orders WHERE user_id = $1 ORDER BY created_at DESC, id DESC`,
        [CUSTOMER],
      )
    ).rows.map((row) => row.id);

    const first = await render();
    const second = await render({ page: "2" });
    const third = await render({ page: "3" });

    expect(listed(second)).toHaveLength(ORDER_HISTORY_PAGE_SIZE);
    expect(listed(third)).toHaveLength(50);
    // The first boundary falls inside four orders that share a timestamp.
    expect([...listed(first), ...listed(second), ...listed(third)]).toEqual(everything);

    expect(second).toContain("Orders 201–400 of 450, newest first.");
    expect(second).toContain("All (450)");
    expect(link(second, "prev")).toBe("/dashboard/orders");
    expect(link(second, "next")).toBe("/dashboard/orders?page=3");

    expect(third).toContain("Orders 401–450 of 450, newest first.");
    expect(link(third, "prev")).toBe("/dashboard/orders?page=2");
    expect(link(third, "next")).toBeNull();
  });

  it("finds an old order from the first page: the search covers the whole history", async () => {
    await seedHistory(CUSTOMER, 450);

    // Order 300 is on the second page of the unfiltered list.
    const html = await render({ q: "history-300" });

    expect(listed(html)).toHaveLength(1);
    expect(html).toContain("History 300<");
    expect(html).not.toContain("Order history pages");
    expect(html).toContain("All (450)");
  });

  it("gathers every refunded order onto one page, wherever it sits in the history", async () => {
    await seedHistory(CUSTOMER, 450);

    const html = await render({ status: "refunded" });

    // Forty-five of them, spread across all three unfiltered pages.
    expect(listed(html)).toHaveLength(45);
    expect(html).toContain("History 445<");
    expect(html).not.toContain("Order history pages");
  });

  it("pages a search that matches more than a page, carrying it across", async () => {
    await seedHistory(CUSTOMER, 450);

    // Every active order: 405 of them.
    const first = await render({ status: "active", q: "history" });
    expect(listed(first)).toHaveLength(ORDER_HISTORY_PAGE_SIZE);
    expect(first).toContain("Matching orders 1–200, newest first.");
    expect(link(first, "next")).toBe("/dashboard/orders?status=active&q=history&page=2");

    const second = await render({ status: "active", q: "history", page: "2" });
    expect(listed(second)).toHaveLength(ORDER_HISTORY_PAGE_SIZE);
    expect(second).toContain("Matching orders 201–400, newest first.");
    expect(link(second, "prev")).toBe("/dashboard/orders?status=active&q=history");
    expect(link(second, "next")).toBe("/dashboard/orders?status=active&q=history&page=3");

    const third = await render({ status: "active", q: "history", page: "3" });
    expect(listed(third)).toHaveLength(5);
    expect(link(third, "next")).toBeNull();

    const all = [...listed(first), ...listed(second), ...listed(third)];
    expect(new Set(all).size).toBe(405);
  });

  it("sends a page number past the end back to the newest orders, keeping the filter and the search", async () => {
    await seedHistory(CUSTOMER, 30);

    await expect(render({ page: "9" })).rejects.toThrow("REDIRECT /dashboard/orders");
    await expect(render({ page: "9", status: "refunded", q: "history" })).rejects.toThrow(
      "REDIRECT /dashboard/orders?status=refunded&q=history",
    );
  });

  it.each([["abc"], ["-1"], ["0"], ["1e3"], ["2.5"], [" 2"], [["2", "3"]], [undefined], [""]])(
    "reads page=%j as the first page instead of sending it to the database",
    async (value) => {
      await seedHistory(CUSTOMER, 450);
      const spy = vi.spyOn(pg, "query");

      const html = await render({ page: value });

      // No offset at all: the newest page.
      expect(sent(spy)[0].values).toEqual([CUSTOMER, ORDER_HISTORY_PAGE_SIZE + 1]);
      expect(html).toContain("Orders 1–200 of 450, newest first.");
    },
  );

  it("caps how deep a page number can reach", async () => {
    await seedHistory(CUSTOMER, 30);
    const spy = vi.spyOn(pg, "query");

    await expect(render({ page: "9999" })).rejects.toThrow("REDIRECT");

    expect(sent(spy)[0].values[2]).toBe(499 * ORDER_HISTORY_PAGE_SIZE);
  });

  it("shows and counts nobody else's orders, on any page", async () => {
    await seedHistory(CUSTOMER, 210);
    await seedHistory(SOMEONE_ELSE, 210, "Theirs");

    for (const page of ["1", "2"]) {
      const html = await render({ page });
      expect(html).not.toContain("Theirs");
      expect(html).toContain("All (210)");
    }
    expect(listed(await render({ page: "2" }))).toHaveLength(10);
    // Searching for their product name finds nothing of theirs.
    expect(listed(await render({ q: "theirs" }))).toHaveLength(0);
  });
});

/**
 * The review form's drop-down reads the same history. Its bounds are held on the
 * in-memory database in `list-endpoints-bounded.test.ts`; this is the statement
 * it sends to a real one, with real uuid columns behind `NOT IN`.
 */
describe("the review picker, against real SQL", () => {
  async function seedDelivered(count: number) {
    // Order 1 is the newest. Every fourth never arrived.
    await pg.query(
      `INSERT INTO orders (reference, user_id, service, product_slug, product_name, plan_label, region, duration,
                           amount, provider, status, created_at)
       SELECT 'Picker-' || g, $1, 'numbers', 'picker', 'Picker ' || g, 'One', 'NG', '20 min', 1000, 'test',
              CASE WHEN g % 4 = 0 THEN 'refunded' ELSE 'delivered' END,
              timestamptz '2026-05-01 00:00:00+00' - make_interval(mins => g)
         FROM generate_series(1, $2::int) g`,
      [CUSTOMER, count],
    );
  }

  it("offers the newest delivered orders that have no review, in two bounded statements", async () => {
    const { listReviewableOrders, REVIEWABLE_ORDERS_LIMIT } = await import("@/lib/content/reviews");
    await seedDelivered(200);
    // The two newest delivered orders already have a review.
    await pg.query(
      `INSERT INTO product_reviews (user_id, order_id, service, product_name, rating, body)
       SELECT user_id, id, 'numbers', product_name, 5, 'Arrived in seconds and worked the first time.'
         FROM orders WHERE reference IN ('Picker-1', 'Picker-2')`,
    );
    const spy = vi.spyOn(pg, "query");

    const offered = await listReviewableOrders(CUSTOMER);

    expect(offered).toHaveLength(REVIEWABLE_ORDERS_LIMIT);
    expect(offered[0].reference).toBe("Picker-3");
    expect(offered.every((order) => order.status === "delivered")).toBe(true);
    // 100 delivered orders after the two reviewed ones: 3..135, less the 33 refunded.
    expect(offered.at(-1)?.reference).toBe("Picker-135");

    const statements = sent(spy);
    expect(statements).toHaveLength(2);
    for (const statement of statements) expect(statement.text).toMatch(/\blimit \$\d+$/i);
    expect(statements[1].text).toMatch(/"orders"\."id" not in \(\$\d+, \$\d+\)/i);
    expect(statements[1].values.at(-1)).toBe(REVIEWABLE_ORDERS_LIMIT);
  });

  it("offers nothing that belongs to someone else", async () => {
    const { listReviewableOrders } = await import("@/lib/content/reviews");
    await seedDelivered(8);

    expect(await listReviewableOrders(SOMEONE_ELSE)).toEqual([]);
    expect(await listReviewableOrders(CUSTOMER)).toHaveLength(6);
  });
});

describe("the page file", () => {
  it("exports only what a Next.js page may export", () => {
    // A stray named export fails the production build, not the type check.
    const source = readFileSync("src/app/dashboard/orders/page.tsx", "utf8");
    const exported = [...source.matchAll(/^export (?:default )?(?:async )?(?:const|function) (\w+)/gm)].map((m) => m[1]);
    expect(exported.sort()).toEqual(["OrdersPage", "dynamic", "metadata"]);
  });
});
