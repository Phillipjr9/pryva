import { beforeAll, describe, expect, it, vi } from "vitest";
import { randomUUID } from "node:crypto";
import { renderToStaticMarkup } from "react-dom/server";

const mocks = vi.hoisted(() => ({ user: vi.fn() }));
vi.mock("@/lib/auth", () => ({ requireUser: mocks.user }));
vi.mock("@/components/dashboard/TopUpForm", () => ({ TopUpForm: () => null }));
vi.mock("@/components/dashboard/DemoWithdrawal", () => ({ DemoWithdrawal: () => null }));
vi.mock("@/app/dashboard/wallet/WithdrawalDashboard", () => ({ WithdrawalDashboard: () => null }));
vi.mock("@/app/dashboard/wallet/TopUpReturn", () => ({ TopUpReturn: () => null }));

let database: typeof import("@/db");
let schema: typeof import("@/db/schema");
let WalletPage: typeof import("@/app/dashboard/wallet/page").default;

beforeAll(async () => {
  vi.stubEnv("DATABASE_URL", "");
  [database, schema, { default: WalletPage }] = await Promise.all([
    import("@/db"), import("@/db/schema"), import("@/app/dashboard/wallet/page"),
  ]);
});

describe("wallet dashboard", () => {
  it("shows withdrawals as deductions rather than adding them to credited totals", async () => {
    const id = randomUUID();
    await database.db.insert(schema.users).values({ id, name: "Wallet Tester", email: `${id}@example.test`, passwordHash: "hash", walletBalance: 5500 });
    for (const row of [
      { type: "credit", amount: 10000, balanceAfter: 10000, reference: "credit", description: "Top-up" },
      { type: "debit", amount: 2000, balanceAfter: 8000, reference: "debit", description: "Purchase" },
      { type: "withdrawal", amount: 3000, balanceAfter: 5000, reference: "withdrawal", description: "Withdrawal" },
      { type: "refund", amount: 500, balanceAfter: 5500, reference: "refund", description: "Refund" },
    ]) await database.db.insert(schema.walletTransactions).values({ ...row, userId: id });
    mocks.user.mockResolvedValue({ id, walletBalance: 5500 });
    const html = renderToStaticMarkup(await WalletPage({ searchParams: Promise.resolve({}) }));
    expect(html).toContain("₦10,500"); // credits plus refunds only
    expect(html).toContain("₦2,000"); // purchases only
    expect(html).toContain("−₦3,000"); // withdrawal is outgoing
    expect(html).not.toContain("90 days");
  });
});
