import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

// The process-local preview uses a small in-memory Drizzle adapter. It must
// report the same user-scoped and expiry-aware count as the Postgres query.
const CUSTOMER = randomUUID();
const OTHER = randomUUID();
const now = new Date("2030-01-01T00:00:00Z");
const future = new Date("2030-02-01T00:00:00Z");
let db: typeof import("@/db").db;
let orders: typeof import("@/db/schema").orders;
let countActiveRentedNumbers: typeof import("@/lib/services/numbers/active-rentals").countActiveRentedNumbers;

beforeAll(async () => {
  vi.stubEnv("DATABASE_URL", "");
  vi.stubEnv("PGHOST", "");
  ({ db } = await import("@/db"));
  ({ orders } = await import("@/db/schema"));
  ({ countActiveRentedNumbers } = await import("@/lib/services/numbers/active-rentals"));

  const common = {
    userId: CUSTOMER, service: "numbers" as const, productSlug: "rent-us-30", productName: "US rental",
    planLabel: "30 days", region: "United States", duration: "Rent for 30 days", amount: 1000,
    status: "active", provider: "preview", expiresAt: future, refundedAt: null,
  };
  await db.insert(orders).values([
    { ...common, reference: "PREVIEW-1", referenceCode: "+15550000001" },
    { ...common, reference: "PREVIEW-2", referenceCode: " +1 (555) 000-0001 " },
    { ...common, reference: "PREVIEW-3", referenceCode: "+2348000000002", productSlug: "rent-ng-30" },
    { ...common, reference: "PREVIEW-OTHER", userId: OTHER, referenceCode: "+15550000003" },
    { ...common, reference: "PREVIEW-SINGLE", productSlug: "vn-us", referenceCode: "+15550000004" },
    { ...common, reference: "PREVIEW-ESIM", service: "esim", referenceCode: "+15550000005" },
    { ...common, reference: "PREVIEW-EXPIRED", expiresAt: now, referenceCode: "+15550000006" },
    { ...common, reference: "PREVIEW-UNKNOWN", expiresAt: null, referenceCode: "+15550000007" },
    { ...common, reference: "PREVIEW-REFUNDED", refundedAt: now, referenceCode: "+15550000008" },
    { ...common, reference: "PREVIEW-REVIEW", status: "review", referenceCode: "+15550000009" },
    { ...common, reference: "PREVIEW-BLANK", referenceCode: " \t\n " },
    { ...common, reference: "PREVIEW-NONNUMBER", referenceCode: "not assigned" },
    { ...common, reference: "PREVIEW-UNASSIGNED", referenceCode: null },
  ]);
});

afterAll(() => { vi.unstubAllEnvs(); });

describe("preview dashboard rental count", () => {
  it("uses the same boundaries and distinct numbers as the persistent database", async () => {
    expect(await countActiveRentedNumbers(CUSTOMER, now)).toBe(2);
    expect(await countActiveRentedNumbers(OTHER, now)).toBe(1);
    expect(await countActiveRentedNumbers(CUSTOMER, future)).toBe(0);
  });
});
