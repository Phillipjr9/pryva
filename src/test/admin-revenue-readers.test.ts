import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { readdir, readFile } from "node:fs/promises";
import { renderToStaticMarkup } from "react-dom/server";
import { PGlite } from "@electric-sql/pglite";
import { drizzle, type PgliteDatabase } from "drizzle-orm/pglite";

import { NextRequest } from "next/server";

import * as schema from "@/db/schema";
import { fulfilledOrderRevenue, fulfilledOrderWhere, orders, users } from "@/db/schema";

/**
 * "Total Revenue" is the number the admin surface is read for, and it used to be
 * computed as `status = 'delivered'` — one word out of a free-text column.
 *
 * That word belongs to virtual numbers (a code arrived) and gift cards (a key was
 * sent). Every other service this shop sells finishes at `active`: an installed
 * eSIM, an accepted boost, a bulk or proxy batch, a scheduled purchase. And a
 * rental that simply ran its term out is moved from `active` to `expired`. So the
 * tile counted a fraction of what the shop sold and then *shrank* as customers
 * used what they had bought.
 *
 * One row of every status, against a real database, because the thing being
 * tested is which rows a SQL predicate lets through — and because the other half
 * of the finding, a `sum()` the driver hands back as a string, only shows up on a
 * real driver.
 */

const mocks = vi.hoisted(() => ({ db: undefined as unknown }));

vi.mock("@/db", () => ({ get db() { return mocks.db; } }));
vi.mock("@/lib/admin-auth", () => ({
  authorizeAdminApi: vi.fn().mockResolvedValue({ user: { id: "admin-1", email: "owner@pryva.ng" } }),
}));
vi.mock("@/lib/auth", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/auth")>();
  return { ...actual, requireAdmin: vi.fn().mockResolvedValue({ id: "admin-1", email: "owner@pryva.ng" }) };
});

const USER = "11111111-1111-4111-8111-111111111111";

let pg: PGlite;
let database: PgliteDatabase<typeof schema>;
let route: typeof import("@/app/api/admin/stats/route");
let analyticsRoute: typeof import("@/app/api/admin/analytics/route");

const HOUR = 60 * 60 * 1000;

async function seed(reference: string, amount: number, status: string, ageHours: number, refunded = false) {
  const at = new Date(Date.now() - ageHours * HOUR);
  await database.insert(orders).values({
    reference,
    userId: USER,
    service: "numbers",
    productSlug: "vn-ng",
    productName: "Virtual Numbers",
    planLabel: "Nigeria number",
    region: "Nigeria",
    duration: "7 days",
    amount,
    status,
    provider: "fleexa",
    refundedAt: refunded ? at : null,
    createdAt: at,
  });
}

beforeAll(async () => {
  pg = new PGlite();
  const files = (await readdir("migrations")).filter((name) => /^\d{4}_.*\.sql$/.test(name)).sort();
  for (const file of files) await pg.exec(await readFile(`migrations/${file}`, "utf8"));
  database = drizzle(pg, { schema });
  mocks.db = database;
  await database.insert(users).values({
    id: USER,
    name: "Ada",
    email: "ada@example.com",
    passwordHash: "x",
    walletBalance: 0,
  });

  // Money in, customer served: three different words for it.
  await seed("REV-ACTIVE", 4_000, "active", 2);
  await seed("REV-DELIVERED", 5_000, "delivered", 2);
  await seed("REV-EXPIRED", 6_000, "expired", 40 * 24);
  // Money in, delivery unsettled — not yet revenue by any honest reading.
  await seed("REV-PROCESSING", 7_000, "processing", 2);
  await seed("REV-REVIEW", 8_000, "review", 2);
  // Money given back.
  await seed("REV-REFUNDED", 9_000, "refunded", 2, true);
  // The ledger's word outranks the status letter: refunded money is not revenue
  // whatever the row's status happens to say.
  await seed("REV-SECRETLY-REFUNDED", 1_000, "active", 2, true);

  route = await import("@/app/api/admin/stats/route");
  analyticsRoute = await import("@/app/api/admin/analytics/route");
}, 60_000);

afterAll(async () => {
  await pg?.close();
});

async function stats() {
  const response = await route.GET(new Request("https://pryva.ng/api/admin/stats") as never);
  return (await response.json()) as {
    stats: { total: { revenue: unknown; orders: number }; last24h: { revenue: unknown; orders: number } };
  };
}

describe("admin revenue", () => {
  it("counts every order the customer kept", async () => {
    const { stats: s } = await stats();
    // ₦7,000 of live-but-undelivered orders and ₦10,000 given back stay out; the
    // three served words are all revenue, including the rental that has ended.
    expect(Number(s.total.revenue)).toBe(4_000 + 5_000 + 6_000);
  });

  it("shrinks the 24-hour figure by age, not by vocabulary", async () => {
    const { stats: s } = await stats();
    expect(Number(s.last24h.revenue)).toBe(4_000 + 5_000);
    expect(Number(s.total.revenue)).toBeGreaterThan(Number(s.last24h.revenue));
  });

  it("answers with numbers, the way its sibling fields do", async () => {
    const { stats: s } = await stats();
    // `sum` over an integer column is a bigint, and the driver answers a bigint
    // with a string. Every sibling field in this payload is a number, and a tile
    // that formats the string one still renders it without its separators — the
    // dashboard below showed `₦5000` while its neighbours showed `₦9,000`.
    expect(typeof s.total.revenue).toBe("number");
    expect(typeof s.last24h.revenue).toBe("number");
  });

  it("renders the headline tile against a real database", async () => {
    const { default: DashboardPage } = await import("@/app/admin/dashboard/page");
    const html = await renderToStaticMarkup(await DashboardPage());
    expect(html).toMatch(/Total Revenue<\/p>\s*<p[^>]*>₦15,000</);
  });

  it("gives the analytics page the same figure", async () => {
    const { default: AnalyticsPage } = await import("@/app/admin/analytics/page");
    const html = await renderToStaticMarkup(await AnalyticsPage());
    expect(html).toContain("₦15,000");
    // The one-word answer: ₦5,000, the only row in the table a `delivered` query
    // could see.
    expect(html).not.toContain("₦5,000");
  });

  it("subtotalises the orders list the same way", async () => {
    const { default: OrdersPage } = await import("@/app/admin/orders/page");
    const html = await renderToStaticMarkup(
      await OrdersPage({ searchParams: Promise.resolve({}) }),
    );
    // This one had a third, hand-written list — `delivered || active` — which both
    // lost the expired rental and kept the order whose money had gone back.
    expect(html).toMatch(/Paid value on this page<\/p>\s*<p[^>]*>₦15,000</);
  });

  it("still counts every order row it is not paying for", async () => {
    const { stats: s } = await stats();
    expect(s.total.orders).toBe(7);
  });
});

/**
 * `/api/admin/analytics` is the fourth place a shop owner goes to be told what
 * the shop earned, and it had never been given the definition above: every one of
 * its aggregates summed `orders.amount` over all rows in the window. So it priced
 * ₦40,000 of orders -- including ₦15,000 the shop still owes a delivery for and
 * ₦10,000 it handed back -- while the three surfaces under it answered ₦15,000.
 */
async function analytics(period: string) {
  const response = await analyticsRoute.GET(
    new NextRequest(`https://pryva.ng/api/admin/analytics?period=${period}`, {
      headers: { host: "pryva.ng", "x-forwarded-proto": "https" },
    }),
  );
  expect(response.status).toBe(200);
  const body = (await response.json()) as {
    analytics: {
      revenue: { total: number; orders: number; average: number };
      orders: {
        byService: { service: string; count: number; revenue: number }[];
        dailyTrend: { date: string; revenue: number; orders: number }[];
        topProducts: { name: string; count: number; revenue: number }[];
      };
    };
  };
  return body.analytics;
}

describe("the analytics endpoint prices revenue like the rest of the admin surface", () => {
  it("pays for served orders only, across the whole window", async () => {
    const a = await analytics("90d");
    // The seven seeded rows are worth ₦40,000 as written. Three of them --
    // processing, review, refunded -- are not revenue.
    expect(a.revenue.total).toBe(15_000);
    expect(a.revenue.orders).toBe(3);
    expect(a.revenue.average).toBe(5_000);
  });

  it("keeps the expired rental in, by status rather than by age", async () => {
    // The 40-day-old expired rental is revenue in the 90d window and absent from
    // the 30d one; nothing here decides that by which word the row happens to use.
    expect((await analytics("90d")).revenue.total).toBe(15_000);
    expect((await analytics("30d")).revenue.total).toBe(9_000);
  });

  it("prices every breakdown in the payload the same way as the headline", async () => {
    const a = await analytics("90d");
    const summed = (rows: { revenue: number }[]) => rows.reduce((total, row) => total + row.revenue, 0);
    // One number, four places: a fix that reached only the tile would leave the
    // service table, the trend and the product list disagreeing with it. Day
    // buckets are summed rather than asserted so this cannot break at midnight.
    expect(summed(a.orders.byService)).toBe(a.revenue.total);
    expect(summed(a.orders.dailyTrend)).toBe(a.revenue.total);
    expect(summed(a.orders.topProducts)).toBe(a.revenue.total);
  });
});

/**
 * `coalesce(sum(amount), 0)::int` was written to make the driver hand over a
 * number instead of a bigint string. `amount` fits an int4 -- a ₦3bn order does
 * not exist -- but the sum of them does not, and Postgres does not clamp an
 * overflow, it raises `integer_out_of_range`. The ceiling lands on whichever
 * surface grows past ₦2,147,483,647 first, and it lands as a 500.
 */
describe("revenue that outgrows the column it is added up in", () => {
  let big: PGlite;
  let bigDatabase: PgliteDatabase<typeof schema>;

  beforeAll(async () => {
    big = new PGlite();
    const files = (await readdir("migrations")).filter((name) => /^\d{4}_.*\.sql$/.test(name)).sort();
    for (const file of files) await big.exec(await readFile(`migrations/${file}`, "utf8"));
    bigDatabase = drizzle(big, { schema });
    await bigDatabase.insert(users).values({
      id: USER,
      name: "Ada",
      email: "ada@example.com",
      passwordHash: "x",
      walletBalance: 0,
    });
    // Three legal int4 amounts whose total is not.
    for (const reference of ["BIG-1", "BIG-2", "BIG-3"]) {
      await bigDatabase.insert(orders).values({
        reference,
        userId: USER,
        service: "numbers",
        productSlug: "vn-ng",
        productName: "Virtual Numbers",
        planLabel: "Nigeria number",
        region: "Nigeria",
        duration: "7 days",
        amount: 1_000_000_000,
        status: "active",
        provider: "fleexa",
        refundedAt: null,
        createdAt: new Date(),
      });
    }
  }, 60_000);
  afterAll(async () => {
    await big?.close();
  });

  it("adds up past the int4 ceiling without the database refusing", async () => {
    const [row] = await bigDatabase
      .select({ sum: fulfilledOrderRevenue() })
      .from(orders)
      .where(fulfilledOrderWhere());
    expect(Number(row.sum)).toBe(3_000_000_000);
  });

  it("still answers the admin surfaces that read it", async () => {
    mocks.db = bigDatabase;
    try {
      const { stats: s } = await stats();
      expect(Number(s.total.revenue)).toBe(3_000_000_000);
      // A number, not a bigint string: the tile beside it formats with
      // separators, and the two have to agree.
      expect(typeof s.total.revenue).toBe("number");
    } finally {
      mocks.db = database;
    }
  });
});
