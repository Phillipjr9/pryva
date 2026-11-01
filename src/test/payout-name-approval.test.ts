import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { readdir, readFile } from "node:fs/promises";
import { PGlite } from "@electric-sql/pglite";
import { drizzle, type PgliteDatabase } from "drizzle-orm/pglite";
import { isNull, sql } from "drizzle-orm";
import { NextRequest } from "next/server";

import * as schema from "@/db/schema";
import { adminAuditLog, bankAccounts, paymentTopups, payoutNameApprovals, users } from "@/db/schema";

/**
 * The reviewed payout name.
 *
 * The payout rule refuses an account whose name does not match the name frozen on
 * the funding deposit, and it is right to: a payout to the wrong person cannot be
 * undone. But the frozen name is what the customer typed at signup, so "Emeka"
 * against "EMEKA CHUKWUEMEKA OKAFOR" is refused for a real person, and until now
 * the only advice was "contact support" with nothing support could do.
 *
 * What is tested here is the narrowness of the fix: approval widens the accepted
 * name for exactly one account, is stored beside the frozen name rather than over
 * it, is revocable, requires a recorded reason, and is written to the audit log.
 */

const mocks = vi.hoisted(() => ({
  db: undefined as unknown,
  admin: { id: "5c9d0b1a-2e3f-4a5b-8c6d-7e8f9a0b1c2d", email: "admin@pryva.ng" } as { id: string; email: string } | null,
  sameOrigin: true,
}));

vi.mock("@/db", () => ({ get db() { return mocks.db; } }));
vi.mock("@/lib/logger", () => ({ logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));
vi.mock("@/lib/net", () => ({ isSameOriginMutation: () => mocks.sameOrigin }));
vi.mock("@/lib/admin-auth", () => ({
  authorizeAdminApi: async () =>
    mocks.admin
      ? { user: mocks.admin, response: null }
      : { user: null, response: Response.json({ ok: false, error: "Administrator access required" }, { status: 403 }) },
}));

const EMeka = "3f1c6a2b-9d4e-4a7c-8b1f-2e5d6c7b8a90";
const OTHER = "7a2b3c4d-5e6f-4a8b-9c0d-1e2f3a4b5c6d";
const ADMIN = "5c9d0b1a-2e3f-4a5b-8c6d-7e8f9a0b1c2d";

let pg: PGlite;
let database: PgliteDatabase<typeof schema>;
let nameCheck: typeof import("@/lib/withdrawal-name-check");
let route: typeof import("@/app/api/admin/payout-names/route");

function request(method: string, body?: unknown) {
  return new NextRequest("https://pryva.ng/api/admin/payout-names", {
    method,
    headers: { origin: "https://pryva.ng", "content-type": "application/json" },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
}

async function settleDeposit(payerName: string | null) {
  await database.insert(paymentTopups).values({
    reference: `TOP-${Math.random().toString(36).slice(2, 8)}`,
    userId: EMeka,
    amount: 10_000,
    status: "completed",
    paidAt: new Date(),
    payerName,
  });
}

async function saveAccount(accountName: string, userId = EMeka) {
  const [row] = await database
    .insert(bankAccounts)
    .values({
      userId,
      bankName: "Access Bank",
      bankCode: "044",
      accountNumber: "0123456789",
      accountName,
      recipientCode: "RCP-1",
      isDefault: 1,
    })
    .returning();
  return row;
}

beforeAll(async () => {
  pg = new PGlite();
  const files = (await readdir("migrations")).filter((name) => /^\d{4}_.*\.sql$/.test(name)).sort();
  for (const file of files) await pg.exec(await readFile(`migrations/${file}`, "utf8"));
  database = drizzle(pg, { schema });
  mocks.db = database;
  nameCheck = await import("@/lib/withdrawal-name-check");
  route = await import("@/app/api/admin/payout-names/route");
}, 30_000);

afterAll(async () => {
  await pg?.close();
});

beforeEach(async () => {
  vi.clearAllMocks();
  mocks.admin = { id: ADMIN, email: "admin@pryva.ng" };
  mocks.sameOrigin = true;
  await database.execute(sql`TRUNCATE TABLE admin_audit_log, payout_name_approvals, bank_accounts, payment_topups, users CASCADE`);
  await database.insert(users).values([
    { id: EMeka, name: "Emeka", email: "emeka@example.com", passwordHash: "x", walletBalance: 10_000 },
    { id: OTHER, name: "Bola", email: "bola@example.com", passwordHash: "x", walletBalance: 0 },
    // The audit log records the acting administrator by id, so the actor is a real row.
    { id: ADMIN, name: "Operator", email: "admin@pryva.ng", passwordHash: "x", walletBalance: 0 },
  ]);
});

describe("what decides whether a payout is allowed", () => {
  it("refuses a fuller bank name when there is no approval", async () => {
    await settleDeposit("Emeka");
    await expect(nameCheck.checkPayoutDestination(EMeka, "EMEKA CHUKWUEMEKA OKAFOR")).resolves.toEqual({
      ok: false,
      reason: "mismatch",
    });
  });

  it("allows the reviewed name once an administrator records it", async () => {
    await settleDeposit("Emeka");
    await database.insert(payoutNameApprovals).values({
      userId: EMeka,
      approvedName: "EMEKA CHUKWUEMEKA OKAFOR",
      depositorName: "Emeka",
      reason: "Bank statement supplied in ticket 412",
      approvedByEmail: "admin@pryva.ng",
    });

    await expect(nameCheck.checkPayoutDestination(EMeka, "EMEKA CHUKWUEMEKA OKAFOR")).resolves.toEqual({
      ok: true,
      matched: "approval",
    });
    // The frozen name is still what it was; approval sits beside it, not over it.
    expect(await nameCheck.depositorNameFor(EMeka)).toBe("Emeka");
  });

  it("does not let an approval admit a different person", async () => {
    await settleDeposit("Emeka");
    await database.insert(payoutNameApprovals).values({
      userId: EMeka,
      approvedName: "EMEKA CHUKWUEMEKA OKAFOR",
      depositorName: "Emeka",
      reason: "Bank statement supplied in ticket 412",
      approvedByEmail: "admin@pryva.ng",
    });

    await expect(nameCheck.checkPayoutDestination(EMeka, "BOLA ADEYEMI")).resolves.toEqual({ ok: false, reason: "mismatch" });
  });

  it("does not consult an approval belonging to another account", async () => {
    await settleDeposit("Emeka");
    await database.insert(payoutNameApprovals).values({
      userId: OTHER,
      approvedName: "EMEKA CHUKWUEMEKA OKAFOR",
      reason: "Another account entirely",
      approvedByEmail: "admin@pryva.ng",
    });

    await expect(nameCheck.checkPayoutDestination(EMeka, "EMEKA CHUKWUEMEKA OKAFOR")).resolves.toMatchObject({ ok: false });
  });

  it("ignores a revoked approval", async () => {
    await settleDeposit("Emeka");
    await database.insert(payoutNameApprovals).values({
      userId: EMeka,
      approvedName: "EMEKA CHUKWUEMEKA OKAFOR",
      reason: "Approved then withdrawn",
      approvedByEmail: "admin@pryva.ng",
      revokedAt: new Date(),
      revokedByEmail: "admin@pryva.ng",
    });

    await expect(nameCheck.checkPayoutDestination(EMeka, "EMEKA CHUKWUEMEKA OKAFOR")).resolves.toMatchObject({ ok: false });
  });

  it("can approve a name for a wallet with no recorded deposit", async () => {
    // Gift-card and credited wallets have no payer name at all, so the rule can
    // only ever answer "no deposit" — a human decision is the only path.
    await database.insert(payoutNameApprovals).values({
      userId: EMeka,
      approvedName: "EMEKA CHUKWUEMEKA OKAFOR",
      reason: "Funded by gift card; identity checked at support",
      approvedByEmail: "admin@pryva.ng",
    });

    await expect(nameCheck.checkPayoutDestination(EMeka, "EMEKA CHUKWUEMEKA OKAFOR")).resolves.toEqual({
      ok: true,
      matched: "approval",
    });
  });
});

describe("the administrator's review endpoint", () => {
  it("lists only the accounts a payout would refuse, without full account numbers", async () => {
    await settleDeposit("Emeka");
    await saveAccount("EMEKA CHUKWUEMEKA OKAFOR");
    // A second customer whose own name matches their deposit: nothing to review.
    await database.insert(paymentTopups).values({
      reference: "TOP-BOLA", userId: OTHER, amount: 5_000, status: "completed", paidAt: new Date(), payerName: "Bola Adeyemi",
    });
    await saveAccount("BOLA ADEYEMI", OTHER);

    const response = await route.GET(request("GET"));
    expect(response.status).toBe(200);
    const body = await response.json();

    expect(body.users).toHaveLength(1);
    expect(body.users[0]).toMatchObject({ userEmail: "emeka@example.com", depositorName: "Emeka", approvedName: null });
    expect(body.users[0].accounts[0]).toMatchObject({ bankName: "Access Bank", accountNumberLast4: "6789" });
    expect(JSON.stringify(body)).not.toContain("0123456789");
  });

  it("records an approval with its reason, and writes an audit entry", async () => {
    await settleDeposit("Emeka");

    const response = await route.POST(request("POST", {
      userId: EMeka,
      approvedName: "  EMEKA   CHUKWUEMEKA OKAFOR ",
      reason: "Bank statement supplied in ticket 412",
    }));

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ ok: true, approvedName: "EMEKA CHUKWUEMEKA OKAFOR" });

    const [approval] = await database.select().from(payoutNameApprovals);
    expect(approval).toMatchObject({
      userId: EMeka,
      approvedName: "EMEKA CHUKWUEMEKA OKAFOR",
      depositorName: "Emeka",
      reason: "Bank statement supplied in ticket 412",
      approvedByEmail: "admin@pryva.ng",
      revokedAt: null,
    });

    const [audit] = await database.select().from(adminAuditLog);
    expect(audit).toMatchObject({ action: "user.payout_name", targetType: "user", targetId: EMeka });
    expect(audit.summary).toContain("EMEKA CHUKWUEMEKA OKAFOR");
    expect(audit.summary).toContain("ticket 412");

    // And it changes the verdict the payout route will reach.
    await expect(nameCheck.checkPayoutDestination(EMeka, "EMEKA CHUKWUEMEKA OKAFOR")).resolves.toMatchObject({ ok: true });
  });

  it("replaces a previous live approval rather than leaving two", async () => {
    await route.POST(request("POST", { userId: EMeka, approvedName: "First Name", reason: "First review" }));
    await route.POST(request("POST", { userId: EMeka, approvedName: "Second Name", reason: "Corrected review" }));

    const live = await database.select().from(payoutNameApprovals).where(isNull(payoutNameApprovals.revokedAt));
    const rows = await database.select().from(payoutNameApprovals);
    expect(rows).toHaveLength(2);
    expect(live).toHaveLength(1);
    expect(await nameCheck.payoutApprovalFor(EMeka)).toBe("Second Name");
  });

  it("requires a name, a reason, and a real account", async () => {
    expect((await route.POST(request("POST", { userId: EMeka, approvedName: "EMEKA", reason: "ok" }))).status).toBe(400);
    expect((await route.POST(request("POST", { userId: EMeka, approvedName: "", reason: "Bank statement checked" }))).status).toBe(400);
    expect((await route.POST(request("POST", { userId: OTHER, approvedName: "BOLA ADEYEMI", reason: "Bank statement checked" }))).status).toBe(200);
    expect((await route.POST(request("POST", { userId: "not-a-uuid", approvedName: "X Y", reason: "Bank statement checked" }))).status).toBe(400);
    expect((await route.POST(request("POST", { userId: "11111111-1111-4111-8111-111111111111", approvedName: "X Y", reason: "Bank statement checked" }))).status).toBe(404);
    expect(await database.select().from(payoutNameApprovals)).toHaveLength(1);
  });

  it("refuses a caller who is not an administrator, and a cross-origin post", async () => {
    mocks.admin = null;
    expect((await route.POST(request("POST", { userId: EMeka, approvedName: "EMEKA OKAFOR", reason: "Bank statement checked" }))).status).toBe(403);
    expect((await route.GET(request("GET"))).status).toBe(403);

    mocks.admin = { id: ADMIN, email: "admin@pryva.ng" };
    mocks.sameOrigin = false;
    expect((await route.POST(request("POST", { userId: EMeka, approvedName: "EMEKA OKAFOR", reason: "Bank statement checked" }))).status).toBe(403);
    expect(await database.select().from(payoutNameApprovals)).toHaveLength(0);
  });

  it("revokes an approval, restoring the frozen-name rule and recording who did it", async () => {
    await settleDeposit("Emeka");
    await route.POST(request("POST", { userId: EMeka, approvedName: "EMEKA CHUKWUEMEKA OKAFOR", reason: "Bank statement checked" }));

    const response = await route.DELETE(request("DELETE", { userId: EMeka }));
    expect(response.status).toBe(200);

    await expect(nameCheck.checkPayoutDestination(EMeka, "EMEKA CHUKWUEMEKA OKAFOR")).resolves.toMatchObject({ ok: false });
    const [approval] = await database.select().from(payoutNameApprovals);
    expect(approval.revokedAt).toBeInstanceOf(Date);
    expect(approval.revokedByEmail).toBe("admin@pryva.ng");

    const audit = await database.select().from(adminAuditLog);
    expect(audit.map((entry) => entry.action)).toEqual(["user.payout_name", "user.payout_name_revoke"]);

    expect((await route.DELETE(request("DELETE", { userId: EMeka }))).status).toBe(404);
  });
});
