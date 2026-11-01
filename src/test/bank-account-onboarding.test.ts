import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { readdir, readFile } from "node:fs/promises";
import { PGlite } from "@electric-sql/pglite";
import { drizzle, type PgliteDatabase } from "drizzle-orm/pglite";
import { sql } from "drizzle-orm";
import { NextRequest } from "next/server";

import * as schema from "@/db/schema";
import { bankAccounts, users } from "@/db/schema";

/**
 * Adding a bank account as a brand-new customer.
 *
 * This used to be a dead end, twice over. The withdrawal screen's only call to
 * action was a link to `#bank-accounts`, a panel that is not in the DOM until the
 * Bank accounts tab is open, so the button did nothing. And the save endpoint
 * refused outright whenever the verified bank name differed from the name frozen
 * on the first deposit — which is the name typed at signup, so "Emeka" against
 * "EMEKA CHUKWUEMEKA OKAFOR" was refused even though it is plainly one person.
 *
 * The money rule itself is unchanged: the withdrawal route still refuses to pay
 * an account whose name does not match the depositor. What changed is that the
 * customer can get an account saved, and is told up front whether it can be paid.
 */

const mocks = vi.hoisted(() => ({
  db: undefined as unknown,
  user: { id: "3f1c6a2b-9d4e-4a7c-8b1f-2e5d6c7b8a90", email: "ada@example.com", name: "Emeka" },
  resolveBank: vi.fn(),
  createRecipient: vi.fn(),
  getBanks: vi.fn(),
  configured: true,
}));

vi.mock("@/db", () => ({ get db() { return mocks.db; } }));
vi.mock("@/lib/auth", () => ({ requireAuthApi: async () => mocks.user }));
vi.mock("@/lib/demo-policy", () => ({ isPreviewDatabase: () => false }));
vi.mock("@/lib/rate-limit", () => ({ purchaseRateLimiter: async () => ({ allowed: true, remaining: 5, resetTime: Date.now() }) }));
vi.mock("@/lib/logger", () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));
vi.mock("@/lib/paystack", () => ({
  isPaystackConfigured: () => mocks.configured,
  resolveBankAccount: (...args: unknown[]) => mocks.resolveBank(...args),
  createTransferRecipient: (...args: unknown[]) => mocks.createRecipient(...args),
  getBanks: (...args: unknown[]) => mocks.getBanks(...args),
}));

const ADA = mocks.user.id;

let pg: PGlite;
let database: PgliteDatabase<typeof schema>;
let route: typeof import("@/app/api/wallet/bank-accounts/route");

function addRequest(body: Record<string, unknown> = {}) {
  return new NextRequest("https://pryva.test/api/wallet/bank-accounts", {
    method: "POST",
    headers: { host: "pryva.test", "x-forwarded-proto": "https", origin: "https://pryva.test", "content-type": "application/json" },
    body: JSON.stringify({ bankCode: "044", accountNumber: "0123456789", ...body }),
  });
}

beforeAll(async () => {
  pg = new PGlite();
  const files = (await readdir("migrations")).filter((name) => /^\d{4}_.*\.sql$/.test(name)).sort();
  for (const file of files) await pg.exec(await readFile(`migrations/${file}`, "utf8"));
  database = drizzle(pg, { schema });
  mocks.db = database;
  route = await import("@/app/api/wallet/bank-accounts/route");
}, 30_000);

afterAll(async () => {
  await pg?.close();
});

beforeEach(async () => {
  vi.clearAllMocks();
  mocks.configured = true;
  mocks.getBanks.mockResolvedValue([]);
  mocks.resolveBank.mockResolvedValue({ status: true, data: { account_name: "EMEKA CHUKWUEMEKA OKAFOR", account_number: "0123456789" } });
  mocks.createRecipient.mockResolvedValue({ status: true, data: { recipient_code: "RCP-test" } });
  await database.execute(sql`TRUNCATE TABLE bank_accounts, payment_topups, users CASCADE`);
  await database.insert(users).values({ id: ADA, name: "Emeka", email: "ada@example.com", passwordHash: "x", walletBalance: 10_000 });
});

async function settleDeposit(payerName: string | null) {
  await database.insert(schema.paymentTopups).values({
    reference: "TOP-1", userId: ADA, amount: 10_000, status: "completed", paidAt: new Date(), payerName,
  });
}

describe("a new customer saving their first account", () => {
  it("saves with no warning when no deposit has been recorded yet", async () => {
    const response = await route.POST(addRequest());

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.payoutWarning).toBeNull();
    expect(body.message).toBe("Bank account added successfully");
    expect(await database.select().from(bankAccounts)).toHaveLength(1);
  });

  it("saves when the signup name is a shorter version of the bank name, and says payouts are blocked", async () => {
    // The name frozen at deposit time is the profile name typed at signup.
    await settleDeposit("Emeka");

    const response = await route.POST(addRequest());

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.payoutWarning).toMatch(/same name as the one that funded this wallet/i);
    expect(body.message).toMatch(/payouts to it are blocked/i);
    // Saved, and the provider recipient is registered, because nothing was sent.
    const [saved] = await database.select().from(bankAccounts);
    expect(saved).toMatchObject({ accountName: "EMEKA CHUKWUEMEKA OKAFOR", recipientCode: "RCP-test" });
  });

  it("saves with no warning when the names match, however the bank orders them", async () => {
    await settleDeposit("Emeka Chukwuemeka Okafor");

    const body = await (await route.POST(addRequest())).json();
    expect(body.payoutWarning).toBeNull();
  });

  it("still refuses an account the provider did not verify", async () => {
    mocks.resolveBank.mockResolvedValue({ status: true, data: { account_name: "Someone", account_number: "9999999999" } });
    expect((await route.POST(addRequest())).status).toBe(400);
    expect(await database.select().from(bankAccounts)).toHaveLength(0);
  });

  it("still refuses to save a name the customer did not review", async () => {
    const response = await route.POST(addRequest({ expectedAccountName: "A Different Person" }));
    expect(response.status).toBe(409);
    expect(mocks.createRecipient).not.toHaveBeenCalled();
  });

  it("reports the missing provider rather than an empty environment error", async () => {
    mocks.configured = false;
    const response = await route.POST(addRequest());
    expect(response.status).toBe(503);
    expect(mocks.resolveBank).not.toHaveBeenCalled();
  });
});

describe("the saved accounts list", () => {
  it("flags the accounts a payout would be refused for, before a withdrawal is attempted", async () => {
    await settleDeposit("Emeka Chukwuemeka Okafor");
    await database.insert(bankAccounts).values([
      { userId: ADA, bankName: "Access Bank", bankCode: "044", accountNumber: "0123456789", accountName: "OBINNA CHINEDU", recipientCode: "RCP-1", isDefault: 1 },
      { userId: ADA, bankName: "GTBank", bankCode: "058", accountNumber: "9876543210", accountName: "OKAFOR EMEKA", recipientCode: "RCP-2", isDefault: 0 },
    ]);

    const body = await (await route.GET()).json();
    const byName = Object.fromEntries((body.bankAccounts as { accountName: string; payoutWarning: string | null }[]).map((account) => [account.accountName, account.payoutWarning]));

    expect(byName["OBINNA CHINEDU"]).toMatch(/same name as the one that funded this wallet/i);
    expect(byName["OKAFOR EMEKA"]).toBeNull();
  });

  it("stops warning once support has reviewed the name", async () => {
    await settleDeposit("Emeka");
    await database.insert(schema.payoutNameApprovals).values({
      userId: ADA,
      approvedName: "EMEKA CHUKWUEMEKA OKAFOR",
      depositorName: "Emeka",
      reason: "Bank statement supplied in ticket 412",
      approvedByEmail: "admin@pryva.ng",
    });
    await database.insert(bankAccounts).values({
      userId: ADA, bankName: "Access Bank", bankCode: "044", accountNumber: "0123456789", accountName: "EMEKA CHUKWUEMEKA OKAFOR", recipientCode: "RCP-1", isDefault: 1,
    });

    const body = await (await route.GET()).json();
    expect(body.bankAccounts[0].payoutWarning).toBeNull();
  });

  it("warns about nothing when there is no recorded depositor to compare against", async () => {
    await database.insert(bankAccounts).values({
      userId: ADA, bankName: "Access Bank", bankCode: "044", accountNumber: "0123456789", accountName: "ANY NAME AT ALL", recipientCode: "RCP-1", isDefault: 1,
    });

    const body = await (await route.GET()).json();
    expect(body.bankAccounts[0].payoutWarning).toBeNull();
  });
});
