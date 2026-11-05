import { beforeAll, describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { db } from "@/db";
import { users, walletTransactions } from "@/db/schema";

/**
 * The ledger page is the operator's answer to "where did this naira go".
 *
 * It used to decide that answer from one word: anything that was not literally
 * `debit` got a green plus sign. A withdrawal — money leaving the wallet, the
 * largest number on the screen — was therefore displayed arriving, and the type
 * filter had no option for it at all, so the payout could not even be isolated.
 * Three rows later, a ledger type nobody recognised was also a plus.
 *
 * Rendered against the in-memory database so the assertions are about what the
 * operator actually reads.
 */

vi.mock("@/lib/identity/auth", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/identity/auth")>();
  return { ...actual, requireAdmin: vi.fn().mockResolvedValue({ id: "admin-1", email: "owner@example.test" }) };
});

const USER = "22222222-2222-4222-8222-222222222222";
const EMAIL = "ledger-guard@example.com";
const REFERENCES = ["LEDGER-GUARD-CREDIT", "LEDGER-GUARD-REFUND", "LEDGER-GUARD-DEBIT", "LEDGER-GUARD-PAYOUT", "LEDGER-GUARD-ODD"];
const MINUS = "−";

/** Same formatter the page uses, so the grouping characters cannot drift. */
const naira = (amount: number) => `₦${amount.toLocaleString("en-NG")}`;

async function render(searchParams: Record<string, string> = {}) {
  const { default: TransactionsPage } = await import("@/app/admin/(console)/transactions/page");
  return renderToStaticMarkup(
    await TransactionsPage({ searchParams: Promise.resolve(searchParams) } as never),
  );
}

beforeAll(async () => {
  await db.insert(users).values({
    id: USER,
    name: "Ledger Guard",
    email: EMAIL,
    passwordHash: "x",
    walletBalance: 46_500,
  });

  await db.insert(walletTransactions).values([
    { userId: USER, type: "credit", amount: 5_000, balanceAfter: 5_000, description: "Paystack deposit", reference: REFERENCES[0] },
    { userId: USER, type: "refund", amount: 1_200, balanceAfter: 6_200, description: "Refund · failed boost", reference: REFERENCES[1] },
    { userId: USER, type: "debit", amount: 700, balanceAfter: 5_500, description: "Virtual number", reference: REFERENCES[2] },
    // A payout: ₦50,000 of a ₦56,000 balance is gone. This is the row that must not
    // render as money arriving.
    { userId: USER, type: "withdrawal", amount: 50_000, balanceAfter: 500, description: "Paystack Transfer · Example Bank 0000", reference: REFERENCES[3] },
    // A word this page has never been told about.
    { userId: USER, type: "gift_redeem", amount: 777, balanceAfter: 1_277, description: "Redeemed somebody's card", reference: REFERENCES[4] },
  ] as never);
});

describe("admin wallet ledger", () => {
  it("shows a payout as money leaving", async () => {
    const html = await render({ q: EMAIL });

    expect(html).toContain(`${MINUS}${naira(50_000)}`);
    expect(html).not.toContain(`+${naira(50_000)}`);
    // A type nobody knows is not evidence of money arriving either.
    expect(html).not.toContain(`+${naira(777)}`);
    expect(html).not.toContain(`${MINUS}${naira(777)}`);
    expect(html).toContain(`+${naira(1_200)}`);
  });

  it("counts every kind of movement in the summary", async () => {
    const html = await render({ q: EMAIL });

    // The payout was in none of the three tiles: the ledger said no money left,
    // while the balances column two rows away proved it had.
    expect(html).toMatch(/Withdrawals in the filter<\/p>[\s\S]{0,120}₦50,000/);
    expect(html).toContain("Debits in the filter");
    expect(html).toContain("Credits in the filter");
    // A row this page has no tile for is still listed, with its own word on it.
    expect(html).toContain("gift_redeem");
  });

  it("can be filtered to payouts, and filters to them", async () => {
    const withOption = await render({ q: EMAIL });
    expect(withOption).toContain('value="withdrawal"');

    const html = await render({ q: EMAIL, type: "withdrawal" });
    expect(html).toContain("LEDGER-GUARD-PAYOUT");
    expect(html).not.toContain("LEDGER-GUARD-CREDIT");
  });
});
