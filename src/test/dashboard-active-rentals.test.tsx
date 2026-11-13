import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { readdir, readFile } from "node:fs/promises";
import { JSDOM } from "jsdom";
import { PGlite } from "@electric-sql/pglite";
import { drizzle, type PgliteDatabase } from "drizzle-orm/pglite";
import { eq } from "drizzle-orm";
import { renderToStaticMarkup } from "react-dom/server";
import * as schema from "@/db/schema";
import { SINGLE_NUMBER_WINDOW } from "@/lib/services/refund-policy";
import { fulfilablePlans } from "@/lib/services/fulfillment";

// Run the dashboard's actual query against PostgreSQL semantics rather than a
// mock count. The page and its rental reader both use this isolated database.
const mocks = vi.hoisted(() => ({ db: undefined as unknown, requireUser: vi.fn() }));
vi.mock("@/db", () => ({ get db() { return mocks.db; } }));
vi.mock("@/lib/platform/demo-policy", () => ({ isPreviewDatabase: () => false }));
vi.mock("@/lib/identity/auth", () => ({ requireUser: mocks.requireUser }));

const CUSTOMER = "11111111-1111-4111-8111-111111111111";
const OTHER = "22222222-2222-4222-8222-222222222222";
const EMPTY = "33333333-3333-4333-8333-333333333333";
const now = new Date();
const future = new Date(now.getTime() + 60 * 60_000);
const past = new Date(now.getTime() - 60 * 60_000);
let pg: PGlite;
let database: PgliteDatabase<typeof schema>;
let countActiveRentedNumbers: typeof import("@/lib/services/numbers/active-rentals").countActiveRentedNumbers;
let Dashboard: typeof import("@/app/dashboard/page").default;
let nextReference = 0;

type OrderInput = typeof schema.orders.$inferInsert;
function rental(overrides: Partial<OrderInput> = {}): OrderInput {
  nextReference += 1;
  return {
    reference: `DASH-${nextReference}`,
    userId: CUSTOMER,
    service: "numbers",
    productSlug: "rent-us-30",
    productName: "US rental",
    planLabel: "30 days",
    region: "United States",
    duration: "Rent for 30 days",
    amount: 10_000,
    status: "active",
    provider: "fleexa",
    referenceCode: `+1555${String(nextReference).padStart(7, "0")}`,
    expiresAt: future,
    ...overrides,
  };
}

async function renderedDashboard() {
  const html = renderToStaticMarkup(await Dashboard());
  const document = new JSDOM(html).window.document;
  const label = [...document.querySelectorAll("dt")].find((entry) => entry.textContent?.includes("Active numbers"));
  return { html, document, label, count: label?.parentElement?.querySelector("dd")?.textContent };
}

beforeAll(async () => {
  pg = new PGlite();
  const files = (await readdir("migrations")).filter((name) => /^\d{4}_.*\.sql$/.test(name)).sort();
  for (const file of files) await pg.exec(await readFile(`migrations/${file}`, "utf8"));
  database = drizzle(pg, { schema });
  mocks.db = database;
  // Activity-email triggers are not part of this read-only dashboard test.
  await pg.exec("ALTER TABLE orders DISABLE TRIGGER USER; ALTER TABLE users DISABLE TRIGGER USER; ALTER TABLE wallet_transactions DISABLE TRIGGER USER;");
  await database.insert(schema.users).values([
    { id: CUSTOMER, name: "Ada Customer", email: "ada@example.test", passwordHash: "hash", walletBalance: 25_000 },
    { id: OTHER, name: "Other Customer", email: "other@example.test", passwordHash: "hash" },
    { id: EMPTY, name: "New Customer", email: "new@example.test", passwordHash: "hash" },
  ]);
  ({ countActiveRentedNumbers } = await import("@/lib/services/numbers/active-rentals"));
  ({ default: Dashboard } = await import("@/app/dashboard/page"));
}, 120_000);

afterAll(async () => { await pg?.close(); });
beforeEach(async () => {
  await pg.exec("TRUNCATE TABLE orders, wallet_transactions CASCADE");
  mocks.requireUser.mockResolvedValue({ id: CUSTOMER, name: "Ada Customer", walletBalance: 25_000 });
  nextReference = 0;
});
afterEach(() => { vi.restoreAllMocks(); });

describe("active rented numbers on the dashboard", () => {
  it("recognizes every sellable rental plan without treating single-use plans as rentals", () => {
    const supported = fulfilablePlans().filter(({ plan }) => plan.service === "numbers");
    const rentals = supported.filter(({ intent }) => intent.kind === "rental");
    const singles = supported.filter(({ intent }) => intent.kind === "sms");
    expect(rentals.length).toBeGreaterThan(0);
    expect(singles.length).toBeGreaterThan(0);
    for (const { plan } of rentals) expect(plan.slug).toMatch(/^rent-/);
    for (const { plan } of singles) expect(plan.slug).not.toMatch(/^rent-/);
  });

  it("counts distinct, assigned, unexpired rentals belonging to this user only", async () => {
    await database.insert(schema.orders).values([
      rental({ referenceCode: "+15550000001" }),
      rental({ productSlug: "rent-ng-90", region: "Nigeria", referenceCode: "+2348000000002", otpCode: "123456" }),
      rental({ productSlug: "rent-uk-30", region: "United Kingdom", referenceCode: "  +1 (555) 000-0001  " }), // same number, differently formatted
      rental({ productSlug: "rent-jp-30", region: "Japan", referenceCode: "+81312345678" }), // no country allowlist
      rental({ userId: OTHER, referenceCode: "+15550000003" }),
      rental({ productSlug: "vn-us", duration: SINGLE_NUMBER_WINDOW, referenceCode: "+15550000004" }),
      rental({ service: "email-otp", referenceCode: "+15550000005" }),
      rental({ service: "esim", referenceCode: "+15550000006" }),
      rental({ status: "processing" }),
      rental({ status: "review" }),
      rental({ status: "expired" }),
      rental({ status: "cancelled" }),
      rental({ status: "delivered" }),
      rental({ status: "refunded" }),
      rental({ refundedAt: past }), // even an inconsistent active status is not live
      rental({ expiresAt: past }), // status can remain active until the nightly sweep
      rental({ expiresAt: now }), // the term closes at the exact expiry instant
      rental({ expiresAt: null }), // an unknown term is not proof of an active rental
      rental({ referenceCode: null }),
      rental({ referenceCode: "" }),
      rental({ referenceCode: " \t\n " }),
      rental({ referenceCode: "not assigned" }),
    ]);

    expect(await countActiveRentedNumbers(CUSTOMER, now)).toBe(3);
    expect(await countActiveRentedNumbers(OTHER, now)).toBe(1);
    expect(await countActiveRentedNumbers(EMPTY, now)).toBe(0);
  });

  it("updates when the term ends or the rental is refunded, without waiting for a sweep", async () => {
    const [one] = await database.insert(schema.orders).values(rental({ expiresAt: future })).returning();
    expect(await countActiveRentedNumbers(CUSTOMER, new Date(future.getTime() - 1))).toBe(1);
    expect(await countActiveRentedNumbers(CUSTOMER, future)).toBe(0);
    await database.update(schema.orders).set({ refundedAt: now }).where(eq(schema.orders.id, one.id));
    expect(await countActiveRentedNumbers(CUSTOMER, now)).toBe(0);
  });

  it("uses a database aggregate across all rentals, not the dashboard's 50-row live-code slice", async () => {
    await database.insert(schema.orders).values(Array.from({ length: 80 }, () => rental()));
    const spy = vi.spyOn(pg, "query");

    const page = await renderedDashboard();

    expect(page.count).toBe("80");
    expect(page.html).toContain("80 orders with Pryva");
    const aggregate = spy.mock.calls.map((call) => ({ text: String(call[0]), values: call[1] ?? [] }))
      .find((call) => /count\s*\(distinct/i.test(call.text));
    expect(aggregate).toBeDefined();
    expect(aggregate!.text).not.toMatch(/\blimit\b/i);
    expect(aggregate!.values).toContain(CUSTOMER);
  });

  it("removes only the two metrics, while preserving live codes, refunds and wallet actions", async () => {
    await database.insert(schema.orders).values([
      rental({ otpCode: "123456", referenceCode: "+15551111111" }),
      rental({ status: "refunded", referenceCode: "+15552222222" }),
    ]);
    await database.insert(schema.walletTransactions).values({
      userId: CUSTOMER, type: "refund", amount: 1000, balanceAfter: 25_000,
      description: "Refund for previous order", reference: "REFUND-DASH",
    });

    const { html, document, label, count } = await renderedDashboard();
    expect(mocks.requireUser).toHaveBeenCalledWith("/dashboard");
    expect(count).toBe("1");
    expect(label?.textContent).toContain("Current rentals");
    const metrics = [...document.querySelectorAll("dt")].map((entry) => entry.textContent?.trim());
    expect(metrics).not.toContain("Shown with code");
    expect(metrics).not.toContain("Refunded");
    expect(document.querySelector("#live-codes-heading")?.textContent).toContain("Live codes");
    expect(document.querySelector('section[aria-labelledby="live-codes-heading"]')?.textContent).toContain("123456");
    expect(html).toContain("refunded");
    expect(html).toContain("Refund for previous order");
    expect(document.querySelector('a[href="/dashboard/wallet"]')?.textContent).toContain("Top up");
    expect(document.querySelector('a[href="/dashboard/wallet#withdraw"]')?.textContent).toContain("Withdraw");
  });

  it("shows the newest eligible codes, including delivered codes, regardless of newer uncoded orders", async () => {
    await database.insert(schema.orders).values([
      rental({ status: "delivered", productSlug: "vn-us", otpCode: "456789", createdAt: new Date(now.getTime() - 120_000) }),
      rental({ otpCode: "987654", createdAt: new Date(now.getTime() - 60_000) }),
      rental({ userId: OTHER, otpCode: "111111" }),
      rental({ status: "refunded", otpCode: "222222" }),
      rental({ refundedAt: past, otpCode: "333333" }),
      rental({ expiresAt: past, otpCode: "444444" }),
      rental({ expiresAt: null, otpCode: "555555" }),
      ...["\u00a0", "\ufeff", "\u2003\u2028", " \t\n"].map((otpCode, i) => rental({ otpCode, createdAt: new Date(now.getTime() + (100 + i) * 1000) })),
      ...Array.from({ length: 60 }, (_, i) => rental({ otpCode: i % 2 ? " \t " : null, createdAt: new Date(now.getTime() + i * 1000) })),
    ]);
    const { document } = await renderedDashboard();
    const text = document.querySelector('section[aria-labelledby="live-codes-heading"]')?.textContent ?? "";
    expect(text).toContain("456789");
    expect(text).toContain("987654");
    for (const excluded of ["111111", "222222", "333333", "444444", "555555"]) expect(text).not.toContain(excluded);
    // A whitespace-only code is still no code: it must not be offered for copying.
    expect(text).toContain("Live codes");
  });

  it("shows zero when there are no confirmed rentals", async () => {
    const { count, html } = await renderedDashboard();
    expect(count).toBe("0");
    expect(html).toContain("No code waiting right now");
  });
});
