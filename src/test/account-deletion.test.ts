import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import {
  DELETION_TERMS,
  FRESH_SESSION_MS,
  TOMBSTONE_NAME,
  confirmationMatches,
  deletionBlock,
  forfeitureWarning,
  retentionSummary,
  sessionIsFresh,
  tombstoneEmail,
} from "@/lib/account-deletion";

/**
 * Closing an account, as a set of promises.
 *
 * The interesting risk is not the button — it is the gap between what the screen
 * says will happen and what the endpoint does. So the rules are tested here, and
 * the last case reads the route to check that the words and the SQL agree.
 */

const read = (path: string) => readFileSync(path, "utf8");

describe("the confirmation is a sentence, not a click", () => {
  it("requires the account's own address, loosely typed but exactly meant", () => {
    expect(confirmationMatches("buyer@example.com", "buyer@example.com")).toBe(true);
    expect(confirmationMatches("  BUYER@Example.com ", "buyer@example.com")).toBe(true);
    expect(confirmationMatches("buyer@example.co", "buyer@example.com")).toBe(false);
    expect(confirmationMatches("", "buyer@example.com")).toBe(false);
    expect(confirmationMatches(null, "buyer@example.com")).toBe(false);
    expect(confirmationMatches(undefined, "buyer@example.com")).toBe(false);
  });

  it("leaves an address that can never receive mail and never repeats", () => {
    const tombstone = tombstoneEmail("f5ca2925-6050-49d2-ab89-fc324953ed11");
    expect(tombstone).toBe("deleted+f5ca2925-6050-49d2-ab89-fc324953ed11@deleted.pryva.invalid");
    expect(tombstone).toMatch(/@deleted\.pryva\.invalid$/);
    expect(tombstoneEmail("a")).not.toBe(tombstoneEmail("b"));
    // The column is unique; the tombstone must therefore be unique per account.
    expect(TOMBSTONE_NAME).toBe("Deleted account");
  });
});

describe("money in the wallet: warned, acknowledged, forfeited", () => {
  it("names the amount that closing will destroy", () => {
    const warning = forfeitureWarning(4_500);
    expect(warning).toMatchObject({ amount: 4_500 });
    expect(warning?.message).toContain("4,500");
    expect(warning?.message.toLowerCase()).toContain("forfeits");
    expect(warning?.message.toLowerCase()).toContain("not refunded");
    // It says what to do about it, rather than only what will happen.
    expect(warning?.message.toLowerCase()).toContain("withdraw");
  });

  it("says nothing when there is nothing to lose", () => {
    expect(forfeitureWarning(0)).toBeNull();
    expect(forfeitureWarning(-1)).toBeNull();
  });

  it("no longer refuses a balance — only a payout that is still moving", () => {
    // The decision: a customer may leave with money, forfeiting it knowingly.
    expect(deletionBlock({ pendingWithdrawals: 0 })).toBeNull();
    const block = deletionBlock({ pendingWithdrawals: 1 });
    expect(block?.code).toBe("WITHDRAWAL_IN_FLIGHT");
    expect(block?.error.toLowerCase()).toContain("withdraw");
  });
});

describe("a session that has been open all day is not consent", () => {
  const now = new Date("2026-10-31T12:00:00.000Z");

  it("accepts a sign-in from the last few minutes", () => {
    expect(sessionIsFresh(new Date(now.getTime() - 60_000), now)).toBe(true);
    expect(sessionIsFresh(new Date(now.getTime() - FRESH_SESSION_MS), now)).toBe(true);
  });

  it("refuses an old session, a missing one, and one from the future", () => {
    expect(sessionIsFresh(new Date(now.getTime() - FRESH_SESSION_MS - 1), now)).toBe(false);
    expect(sessionIsFresh(null, now)).toBe(false);
    expect(sessionIsFresh(undefined, now)).toBe(false);
    // A clock skew is not understood, so it is not trusted.
    expect(sessionIsFresh(new Date(now.getTime() + 5_000), now)).toBe(false);
  });
});

describe("the receipt counts, and never copies", () => {
  it("records what was kept as numbers", () => {
    expect(
      retentionSummary({
        orders: 3,
        walletTransactions: 9,
        deposits: 2,
        withdrawals: 1,
        giftCards: 0,
        supportTickets: 4,
        reviews: 1,
      }),
    ).toEqual({
      orders: 3,
      walletTransactions: 9,
      deposits: 2,
      withdrawals: 1,
      giftCards: 0,
      supportTickets: 4,
      reviews: 1,
    });
  });
});

describe("what the customer is told before they confirm", () => {
  it("names what is deleted and what stays", () => {
    const removed = DELETION_TERMS.removed.join(" ").toLowerCase();
    expect(removed).toContain("password");
    expect(removed).toContain("email");
    expect(removed).toContain("device");
    expect(removed).toContain("passkey");

    const kept = DELETION_TERMS.kept.map((item) => item.what.toLowerCase()).join(" ");
    expect(kept).toContain("orders");
    expect(kept).toContain("withdrawals");
    expect(kept).toContain("payment");
    expect(kept).toContain("support");
    expect(kept).toContain("fraud");

    // Every retained category carries the reason it is retained — the list is not
    // a legal paragraph, it is five answers to "why do you still have that?".
    for (const item of DELETION_TERMS.kept) expect(item.why.length).toBeGreaterThan(30);
  });

  it("never tells the customer how long the records are kept", () => {
    // The owner's decision: ten years, and not disclosed. The horizon lives in a
    // server-only module, so it cannot reach the bundle this panel ships in.
    const copy = JSON.stringify(DELETION_TERMS) + read("src/app/dashboard/settings/DangerZone.tsx");
    expect(copy).not.toMatch(/\b(10|ten)\s*years?\b/i);
    expect(copy).not.toContain("RETENTION_YEARS");
    expect(read("src/lib/account-deletion.ts")).not.toContain("RETENTION_YEARS");
  });

  it("says plainly that it cannot be undone", () => {
    expect(DELETION_TERMS.summary.toLowerCase()).toContain("cannot be undone");
    expect(DELETION_TERMS.summary.toLowerCase()).toContain("without your name or email");
  });

  it("matches what the endpoint actually does", () => {
    const route = read("src/app/api/user/delete/route.ts");
    // Identity is scrubbed, not the row deleted.
    expect(route).toContain("deletedAt: now");
    expect(route).toContain("deletedEmailHash");
    expect(route).toContain("tombstoneEmail(");
    expect(route).not.toContain("delete(users)");
    // Credentials and devices go.
    for (const table of [
      "sessions",
      "webauthnCredentials",
      "userTwoFactor",
      "twoFactorRecoveryCodes",
      "passwordResetTokens",
      "emailVerificationTokens",
    ]) {
      expect(route, table).toContain(`delete(${table})`);
    }
    // The financial record is never touched.
    expect(route).not.toMatch(/delete\((orders|walletTransactions|paymentTopups|withdrawals|giftCards)\)/);
    // And the guards exist in code, not only in copy.
    expect(route).toContain("deletionBlock(");
    expect(route).toContain("sessionIsFresh(");
    // A balance is forfeited through the ledger, never destroyed silently.
    expect(route).toContain("forfeitAcknowledged");
    expect(route).toContain("debitWalletInTx(");
    expect(route).toContain("balance forfeited");
  });
});
