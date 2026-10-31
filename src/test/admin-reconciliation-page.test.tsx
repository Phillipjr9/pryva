import { describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { db } from "@/db";
import { orders, paymentTopups, withdrawals } from "@/db/schema";

/**
 * The reconciliation page is read-only, and its job is to stop an ambiguous
 * outcome from looking resolved. These tests render it against the in-memory
 * database with one row of each kind and check that:
 *
 *   * every class appears, with its reference;
 *   * age is shown, because an item that has waited a day is an incident;
 *   * it never prints a bank account number — the operator gets the reference to
 *     check, not the customer's full account;
 *   * it says plainly that nothing resolves itself.
 */

vi.mock("@/lib/auth", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/auth")>();
  return {
    ...actual,
    requireAdmin: vi.fn().mockResolvedValue({
      id: "e6601368-4eef-45e7-a562-f8621c4239f2",
      email: "owner@pryva.ng",
      name: "Owner",
      walletBalance: 0,
      emailVerifiedAt: new Date("2026-01-02T00:00:00Z"),
      createdAt: new Date("2026-01-01T00:00:00Z"),
    }),
  };
});

const hoursAgo = (hours: number) => new Date(Date.now() - hours * 3_600_000);

describe("admin reconciliation page", () => {
  it("shows every unresolved class and refuses to call any of them settled", async () => {
    await db.insert(withdrawals).values({
      id: "11111111-1111-4111-8111-111111111111",
      userId: "e6601368-4eef-45e7-a562-f8621c4239f2",
      amount: 5000,
      fee: 100,
      bankName: "Example Bank",
      accountNumber: "0123456789",
      accountName: "Ada Obi",
      status: "processing",
      reference: "WD-RECON-1",
      failureReason: "Transfer outcome unconfirmed. Check Paystack before resolving.",
      createdAt: hoursAgo(30),
    });

    await db.insert(orders).values({
      reference: "PV-RECON-2",
      userId: "e6601368-4eef-45e7-a562-f8621c4239f2",
      service: "numbers",
      productSlug: "vn-ng",
      productName: "Virtual number",
      planLabel: "Nigeria",
      region: "Nigeria",
      duration: "1 use",
      amount: 1500,
      status: "processing",
      provider: "manual",
      providerRequestId: "prov-ref-9",
      createdAt: hoursAgo(2),
    });

    await db.insert(orders).values({
      reference: "PV-RECON-3",
      userId: "e6601368-4eef-45e7-a562-f8621c4239f2",
      service: "numbers",
      productSlug: "vn-ng",
      productName: "Virtual number",
      planLabel: "Nigeria",
      region: "Nigeria",
      duration: "1 use",
      amount: 900,
      status: "refunded",
      provider: "manual",
      reconciliationNote: "Refunded; upstream unit was not released.",
      createdAt: hoursAgo(50),
    });

    await db.insert(paymentTopups).values({
      reference: "TOPUP-RECON-4",
      userId: "e6601368-4eef-45e7-a562-f8621c4239f2",
      amount: 2000,
      status: "pending",
      createdAt: hoursAgo(3),
    });

    const { default: ReconciliationPage } = await import("@/app/admin/reconciliation/page");
    const html = renderToStaticMarkup(await ReconciliationPage());

    // Every class is present, by reference.
    expect(html).toContain("WD-RECON-1");
    expect(html).toContain("PV-RECON-2");
    expect(html).toContain("PV-RECON-3");
    expect(html).toContain("TOPUP-RECON-4");

    // The provider's own reference is the thing to reconcile against.
    expect(html).toContain("prov-ref-9");

    // Age is visible, including the one that has waited more than a day.
    expect(html).toContain("1d");

    // A full account number must not be on this screen.
    expect(html).not.toContain("0123456789");

    // The page must not imply that anything resolves itself.
    expect(html).toContain("There is no automatic resolver");
    expect(html).not.toMatch(/automatically refunded|settles withdrawals automatically/i);
  });
});
