import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

/**
 * An export is the one read that is meant to return everything, which is why it
 * is the one most likely to have no limit at all.
 *
 * The operator export read every order, account or ledger row the business had
 * ever had — every column, into one request — and built the file as one string.
 * The customer's ledger export had no row limit and no budget, so its cost was
 * set by whoever called it. Neither hurts on a young table; both end, eventually,
 * as a request that cannot finish.
 *
 * They are bounded now, and they refuse rather than truncate: a ledger file that
 * silently stops partway is worse than one that says no.
 */

const mocks = vi.hoisted(() => ({
  user: vi.fn(),
  admin: vi.fn(),
  /** What the operator export selected, filtered, sorted and asked for. */
  select: vi.fn(),
  orderBy: vi.fn(),
  limit: vi.fn(),
  findMany: vi.fn(),
}));

vi.mock("@/db", () => ({
  db: {
    select: (projection: unknown) => {
      mocks.select(projection);
      return {
        from: () => ({
          where: () => ({
            orderBy: (...order: unknown[]) => {
              mocks.orderBy(...order);
              return { limit: mocks.limit };
            },
          }),
        }),
      };
    },
    query: { walletTransactions: { findMany: mocks.findMany } },
  },
}));
vi.mock("@/lib/identity/auth", () => ({ requireAuthApi: mocks.user }));
vi.mock("@/lib/identity/admin-auth", () => ({ authorizeAdminApi: mocks.admin }));
vi.mock("@/lib/platform/logger", () => ({ logger: { info: vi.fn(), error: vi.fn(), warn: vi.fn() } }));

import * as adminExport from "@/app/api/admin/export/route";
import * as walletExport from "@/app/api/wallet/transactions/export/route";
import { MAX_ADMIN_EXPORT_ROWS, MAX_CUSTOMER_EXPORT_ROWS, MAX_EXPORT_BYTES } from "@/lib/platform/pagination";

const at = new Date("2026-03-01T00:00:00Z");

const ledgerRow = (index: number, description = "Wallet top-up") => ({
  id: `tx-${index}`,
  userId: "user-1",
  orderId: null,
  type: "credit",
  amount: 1_000,
  balanceAfter: 1_000 * (index + 1),
  description,
  reference: `ref-${index}`,
  createdAt: at,
});

const rows = (count: number, description?: string) => Array.from({ length: count }, (_, index) => ledgerRow(index, description));

const adminGet = (query: string) => adminExport.GET(new NextRequest(`https://pryva.test/api/admin/export?${query}`));
const walletGet = (format: string) =>
  walletExport.GET(new NextRequest(`https://pryva.test/api/wallet/transactions/export?format=${format}`));

let customer = 0;

beforeEach(() => {
  vi.clearAllMocks();
  mocks.admin.mockResolvedValue({ user: { id: "admin" }, response: null });
  // A fresh account per test: the read budget is per account and outlives a test.
  customer += 1;
  mocks.user.mockResolvedValue({ id: `export-customer-${customer}` });
  mocks.limit.mockResolvedValue(rows(3));
  mocks.findMany.mockResolvedValue(rows(3));
});

describe("the operator export is a bounded read", () => {
  it.each(["orders", "users", "transactions"])("asks the database for one row more than it will send (%s)", async (type) => {
    const response = await adminGet(`type=${type}&format=json`);

    expect(response.status).toBe(200);
    // One more than the ceiling, so "exactly at the limit" and "over it" can be
    // told apart without counting the table first.
    expect(mocks.limit).toHaveBeenCalledTimes(1);
    expect(mocks.limit).toHaveBeenCalledWith(MAX_ADMIN_EXPORT_ROWS + 1);
    // Sorted, so consecutive date ranges join up into one history.
    expect(mocks.orderBy).toHaveBeenCalledTimes(1);
  });

  it("reads only the columns the file contains", async () => {
    await adminGet("type=users&format=json");
    const accountColumns = Object.keys(mocks.select.mock.calls[0]?.[0] as object).sort();
    expect(accountColumns).toEqual(["createdAt", "email", "id", "name", "walletBalance"]);

    await adminGet("type=orders&format=json");
    const orderColumns = Object.keys(mocks.select.mock.calls[1]?.[0] as object);
    // Password hashes and what was delivered — codes, account credentials, eSIM
    // activation details — used to be loaded for every row in the range.
    for (const secret of ["passwordHash", "otpCode", "accounts", "esimActivationCode", "esimInstallUrl", "referenceCode"]) {
      expect(accountColumns).not.toContain(secret);
      expect(orderColumns).not.toContain(secret);
    }
    expect(orderColumns.sort()).toEqual(
      ["amount", "createdAt", "duration", "expiresAt", "id", "planLabel", "productName", "provider", "reference", "region", "service", "status", "userId"].sort(),
    );
  });

  it("exports a range that fits, exactly at the ceiling", async () => {
    mocks.limit.mockResolvedValue(rows(MAX_ADMIN_EXPORT_ROWS));

    const response = await adminGet("type=transactions&format=csv");

    expect(response.status).toBe(200);
    const lines = (await response.text()).trim().split("\n");
    expect(lines).toHaveLength(MAX_ADMIN_EXPORT_ROWS + 1); // header + rows
  });

  it("refuses a range that holds more, and says what to do about it", async () => {
    mocks.limit.mockResolvedValue(rows(MAX_ADMIN_EXPORT_ROWS + 1));

    const response = await adminGet("type=transactions&format=csv");
    const body = (await response.json()) as { error: string };

    expect(response.status).toBe(413);
    expect(body.error).toContain("10,000");
    expect(body.error).toMatch(/Narrow startDate and endDate/);
    expect(response.headers.get("cache-control")).toContain("no-store");
    // Refused, not shortened: no partial file under a download name.
    expect(response.headers.get("content-disposition")).toBeNull();
  });

  it("refuses a file larger than one response should carry, in either format", async () => {
    // Under the row ceiling, over the size one: long descriptions.
    mocks.limit.mockResolvedValue(rows(8_000, "x".repeat(600)));

    for (const format of ["json", "csv"]) {
      const response = await adminGet(`type=transactions&format=${format}`);
      expect(response.status, format).toBe(413);
      expect(((await response.json()) as { error: string }).error).toContain("4 MB");
    }
  });

  it("keeps the size ceiling below the 4.5 MB the host documents for a response that is not streamed", () => {
    expect(MAX_EXPORT_BYTES).toBeLessThan(4_500_000);
  });
});

describe("a customer's ledger export is bounded and budgeted", () => {
  it("asks for the caller's rows only, the file's columns only, and no more than it will send", async () => {
    const response = await walletGet("json");

    expect(response.status).toBe(200);
    expect(mocks.findMany).toHaveBeenCalledTimes(1);
    const query = mocks.findMany.mock.calls[0]?.[0] as { limit: number; columns: Record<string, boolean>; where: unknown };
    expect(query.limit).toBe(MAX_CUSTOMER_EXPORT_ROWS + 1);
    expect(Object.keys(query.columns).sort()).toEqual(["amount", "balanceAfter", "createdAt", "description", "reference", "type"]);
    expect(query.where).toBeDefined();
  });

  it("exports a full history at the ceiling", async () => {
    mocks.findMany.mockResolvedValue(rows(MAX_CUSTOMER_EXPORT_ROWS));

    const response = await walletGet("json");

    expect(response.status).toBe(200);
    expect((await response.json()) as unknown[]).toHaveLength(MAX_CUSTOMER_EXPORT_ROWS);
  });

  it("refuses a longer history instead of returning part of it", async () => {
    mocks.findMany.mockResolvedValue(rows(MAX_CUSTOMER_EXPORT_ROWS + 1));

    for (const format of ["csv", "json"]) {
      const response = await walletGet(format);
      expect(response.status, format).toBe(413);
      expect(((await response.json()) as { error: string }).error).toMatch(/too large.*Contact support/);
      expect(response.headers.get("content-disposition")).toBeNull();
    }
  });

  it("refuses a file too large for one download", async () => {
    mocks.findMany.mockResolvedValue(rows(4_500, "y".repeat(1_200)));

    const response = await walletGet("csv");

    expect(response.status).toBe(413);
  });

  it("allows two a minute for each account, so a loop cannot keep the database busy", async () => {
    // Once as CSV and once as JSON is what a person does; a loop is refused.
    const statuses = [
      (await walletGet("csv")).status,
      (await walletGet("json")).status,
      (await walletGet("csv")).status,
      (await walletGet("json")).status,
    ];

    expect(statuses).toEqual([200, 200, 429, 429]);
    // The refused calls never reached the database.
    expect(mocks.findMany).toHaveBeenCalledTimes(2);

    const refused = await walletGet("csv");
    const retryAfter = Number(refused.headers.get("retry-after"));
    expect(retryAfter).toBeGreaterThan(0);
    expect(retryAfter).toBeLessThanOrEqual(60);
    expect(((await refused.json()) as { error: string }).error).toMatch(/exporting too quickly/);
  });

  it("budgets each account separately", async () => {
    for (let call = 0; call < 3; call += 1) await walletGet("csv");
    expect((await walletGet("csv")).status).toBe(429);

    mocks.user.mockResolvedValue({ id: "export-customer-someone-else" });
    expect((await walletGet("csv")).status).toBe(200);
  });

  it("does not spend a refused request's budget on an unsupported format", async () => {
    // Validation comes first: a mistyped format is a 400 and costs nothing.
    for (let call = 0; call < 5; call += 1) expect((await walletGet("xml")).status).toBe(400);
    expect((await walletGet("csv")).status).toBe(200);
  });

  it("still answers a signed-out caller with 401 before anything is counted or read", async () => {
    mocks.user.mockResolvedValue(null);

    const response = await walletGet("csv");

    expect(response.status).toBe(401);
    expect(mocks.findMany).not.toHaveBeenCalled();
  });
});
