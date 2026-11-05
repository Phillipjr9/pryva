import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { readdir, readFile } from "node:fs/promises";
import { PGlite } from "@electric-sql/pglite";
import { drizzle, type PgliteDatabase } from "drizzle-orm/pglite";
import * as schema from "@/db/schema";

const state = vi.hoisted(() => ({
  db: undefined as unknown,
  user: { id: "11111111-1111-4111-8111-111111111111" } as { id: string } | null,
}));
vi.mock("@/db", () => ({ get db() { return state.db; } }));
vi.mock("@/lib/identity/auth", () => ({ getCurrentUser: async () => state.user }));
vi.mock("@/lib/email/schedule-wallet-emails", () => ({ scheduleWalletEmails: vi.fn() }));

const USER = "11111111-1111-4111-8111-111111111111";
const OTHER = "22222222-2222-4222-8222-222222222222";
let pg: PGlite;
let database: PgliteDatabase<typeof schema>;
let GET: typeof import("@/app/api/orders/route").GET;

beforeAll(async () => {
  pg = new PGlite();
  for (const file of (await readdir("migrations")).filter((name) => /^\d{4}_.*\.sql$/.test(name)).sort()) {
    await pg.exec(await readFile(`migrations/${file}`, "utf8"));
  }
  database = drizzle(pg, { schema });
  state.db = database;
  await database.insert(schema.users).values([
    { id: USER, name: "Ada", email: "ada@example.test", passwordHash: "x", walletBalance: 10_000 },
    { id: OTHER, name: "Other", email: "other@example.test", passwordHash: "x", walletBalance: 10_000 },
  ]);
  const common = { service: "esim" as const, productSlug: "plan", productName: "Data plan", planLabel: "1 GB", region: "Nigeria", duration: "7 days", amount: 2500, provider: "bitcall" };
  await database.insert(schema.orders).values([
    {
      ...common, userId: USER, reference: "PRY-OWNED", status: "review",
      reconciliationNote: "API ERROR secret-diagnostic", providerRequestId: "supplier-reference", providerCostNgn: 1000,
      esimIccid: "private-iccid", esimActivationCode: "LPA:private-activation", esimInstallUrl: "https://secret.example.test/",
      accounts: '["account-credential"]', referenceCode: "visible-order-code", otpCode: "123456",
    },
    { ...common, userId: OTHER, reference: "PRY-OTHER", reconciliationNote: "other-user-note" },
  ]);
  ({ GET } = await import("@/app/api/orders/route"));
}, 30_000);

afterAll(async () => { await pg?.close(); });

describe("customer order index", () => {
  it("returns only the owner's customer-facing fields, without internal errors or credentials", async () => {
    const response = await GET();
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    const result = await response.json();
    expect(result.orders).toHaveLength(1);
    expect(result.orders[0]).toMatchObject({ reference: "PRY-OWNED", status: "review", referenceCode: "visible-order-code", otpCode: "123456" });
    const json = JSON.stringify(result);
    for (const forbidden of ["API ERROR", "secret-diagnostic", "supplier-reference", "private-iccid", "private-activation", "secret.example", "account-credential", "other-user-note", "PRY-OTHER"]) {
      expect(json).not.toContain(forbidden);
    }
    for (const field of ["reconciliationNote", "provider", "providerRequestId", "providerCostNgn", "accounts", "esimIccid", "esimActivationCode", "esimInstallUrl", "requestId", "userId"]) {
      expect(result.orders[0]).not.toHaveProperty(field);
    }
  });

  it("does not return any orders without a session", async () => {
    state.user = null;
    try {
      const response = await GET();
      expect(response.status).toBe(401);
      expect(await response.json()).toEqual({ ok: false, error: "Unauthorized" });
    } finally {
      state.user = { id: USER };
    }
  });
});
