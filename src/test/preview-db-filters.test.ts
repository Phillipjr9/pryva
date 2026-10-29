import { beforeAll, describe, expect, it, vi } from "vitest";
import { randomUUID } from "node:crypto";
import { and, eq, ilike, inArray, like, notIlike, or } from "drizzle-orm";

let mine: string[] = [];
let database: typeof import("@/db");
let schema: typeof import("@/db/schema");

beforeAll(async () => {
  // No DATABASE_URL: exercise the in-memory preview database, which evaluates
  // drizzle conditions itself instead of handing them to Postgres.
  vi.stubEnv("DATABASE_URL", "");
  [database, schema] = await Promise.all([import("@/db"), import("@/db/schema")]);

  const userId = randomUUID();
  await database.db.insert(schema.users).values({
    id: userId,
    name: "Filter Tester",
    email: `${userId}@example.test`,
    passwordHash: "hash",
    walletBalance: 0,
  });

  const orderRows = [
    {
      reference: "FILTER-NG-NUMBER", service: "numbers", productSlug: "vn-ng",
      productName: "Nigeria number", planLabel: "Single verification", region: "Nigeria",
      duration: "20 minutes", amount: 1340, status: "active",
    },
    {
      reference: "FILTER-US-ESIM", service: "esim", productSlug: "esim-us",
      productName: "United States eSIM", planLabel: "10GB", region: "United States",
      duration: "30 days", amount: 9000, status: "delivered",
    },
    {
      reference: "FILTER-NG-PROXY", service: "proxies", productSlug: "proxy-ng-1",
      productName: "Nigeria Starter", planLabel: "1GB", region: "Nigeria",
      duration: "30 days", amount: 4500, status: "refunded",
    },
  ];
  for (const row of orderRows) {
    await database.db.insert(schema.orders).values({ ...row, userId, provider: "preview" });
  }

  // The preview database also seeds its own demo orders; scope every assertion
  // to this test's rows.
  mine = orderRows.map((row) => row.reference);
});

describe("preview database condition evaluation", () => {
  it("matches ilike patterns instead of comparing to the literal %term%", async () => {
    const rows = await database.db
      .select()
      .from(schema.orders)
      .where(ilike(schema.orders.productName, "%nigeria%"));
    expect(mine.filter((reference) => rows.some((row) => row.reference === reference)).sort())
      .toEqual(["FILTER-NG-NUMBER", "FILTER-NG-PROXY"]);
  });

  it("keeps like case-sensitive and supports negation", async () => {
    const sensitive = await database.db
      .select()
      .from(schema.orders)
      .where(like(schema.orders.productName, "%nigeria%"));
    expect(sensitive.filter((row) => mine.includes(row.reference))).toHaveLength(0);

    const negated = await database.db
      .select()
      .from(schema.orders)
      .where(notIlike(schema.orders.productName, "%nigeria%"));
    expect(mine.filter((reference) => negated.some((row) => row.reference === reference)))
      .toEqual(["FILTER-US-ESIM"]);
  });

  it("honours or() grouping inside and() instead of only the first comparison", async () => {
    // The reference matches the second branch only; before grouping was
    // preserved this returned nothing at all.
    const byReference = await database.db
      .select()
      .from(schema.orders)
      .where(
        and(
          eq(schema.orders.service, "esim"),
          or(ilike(schema.orders.productName, "%filter-us%"), ilike(schema.orders.reference, "%filter-us%")),
        ),
      );
    expect(byReference.map((row) => row.reference)).toEqual(["FILTER-US-ESIM"]);

    const bothBranches = await database.db
      .select()
      .from(schema.orders)
      .where(or(ilike(schema.orders.productName, "%nigeria%"), ilike(schema.orders.reference, "%esim%")));
    expect(mine.filter((reference) => bothBranches.some((row) => row.reference === reference)).sort())
      .toEqual(["FILTER-NG-NUMBER", "FILTER-NG-PROXY", "FILTER-US-ESIM"]);
  });

  it("still enforces every and() branch", async () => {
    const rows = await database.db
      .select()
      .from(schema.orders)
      .where(and(ilike(schema.orders.productName, "%nigeria%"), eq(schema.orders.status, "refunded")));
    expect(rows.map((row) => row.reference)).toEqual(["FILTER-NG-PROXY"]);
  });

  it("supports inArray filtering", async () => {
    const rows = await database.db
      .select()
      .from(schema.orders)
      .where(inArray(schema.orders.status, ["active", "refunded"]));
    expect(mine.filter((reference) => rows.some((row) => row.reference === reference)).sort())
      .toEqual(["FILTER-NG-NUMBER", "FILTER-NG-PROXY"]);
  });
});
