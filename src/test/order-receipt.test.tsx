// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { readFileSync } from "node:fs";
import { ReceiptBody, type ReceiptData } from "@/app/dashboard/orders/[id]/receipt/ReceiptBody";
import { PrintButton } from "@/app/dashboard/orders/[id]/receipt/PrintButton";
import { RECEIPT_STATUS_LABELS, receiptStatusLabel } from "@/lib/receipt";

/**
 * A receipt is a document, not a screen.
 *
 * The wallet ledger has been exportable for a while, but one order had no paper at
 * all, and the order page cannot stand in for it: that page polls, changes status,
 * and holds the code or the eSIM activation credential. A receipt that carried the
 * credential would be a receipt you must not send to anybody.
 */

const RECEIPT: ReceiptData = {
  reference: "PRY-8H2K4Q",
  productName: "Verified number · Nigeria",
  planLabel: "Any app · 1 use",
  region: "Nigeria",
  duration: "20 minutes",
  amount: 1_500,
  status: "delivered",
  createdAt: "3 November 2026, 14:05",
  paidWith: "Wallet balance",
  customerName: "Ada Obi",
  customerEmail: "ada@example.com",
};

afterEach(cleanup);

describe("receiptStatusLabel", () => {
  it("spells out every status a customer can meet", () => {
    for (const value of ["delivered", "active", "processing", "pending", "review", "refunded", "cancelled", "failed"]) {
      expect(RECEIPT_STATUS_LABELS[value], `${value} needs a human label`).toBeTruthy();
      expect(receiptStatusLabel(value)).not.toBe(value);
    }
  });

  it("does not invent a meaning for an unknown status", () => {
    expect(receiptStatusLabel("something_new")).toBe("something_new");
  });
});

describe("ReceiptBody", () => {
  it("carries the facts a bank or a tax officer asks for", () => {
    render(<ReceiptBody receipt={RECEIPT} />);
    // The reference appears twice on purpose: in the header, and as a field.
    expect(screen.getAllByText("PRY-8H2K4Q").length).toBeGreaterThan(0);
    expect(screen.getByText("Ada Obi")).toBeTruthy();
    expect(screen.getByText("ada@example.com")).toBeTruthy();
    expect(screen.getByText("Verified number · Nigeria")).toBeTruthy();
    expect(screen.getByText("₦1,500")).toBeTruthy();
    expect(screen.getByText("Delivered")).toBeTruthy();
    expect(screen.getByText("Wallet balance")).toBeTruthy();
    expect(screen.getByText("3 November 2026, 14:05")).toBeTruthy();
  });

  it("says a refund happened, with the date, instead of leaving the status ambiguous", () => {
    render(<ReceiptBody receipt={{ ...RECEIPT, status: "refunded", refundedAt: "4 November 2026, 09:10" }} />);
    expect(screen.getByText("Refunded to wallet")).toBeTruthy();
    expect(screen.getByText("4 November 2026, 09:10")).toBeTruthy();
  });

  it("is explicit that it is not a tax invoice", () => {
    render(<ReceiptBody receipt={RECEIPT} />);
    expect(screen.getByText(/not a tax invoice/)).toBeTruthy();
  });
});

/** Comments explain why a field is absent; only code can leak it. */
function withoutComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
}

describe("the receipt leaks nothing the order page guards", () => {
  const receiptSource = readFileSync("src/app/dashboard/orders/[id]/receipt/page.tsx", "utf8");
  const bodySource = readFileSync("src/app/dashboard/orders/[id]/receipt/ReceiptBody.tsx", "utf8");

  it("never reads the provider column, so no supplier can be printed", () => {
    for (const source of [receiptSource, bodySource]) {
      expect(withoutComments(source)).not.toMatch(/\bprovider\b/i);
    }
  });

  it("never reads a credential half of the order", () => {
    for (const source of [receiptSource, bodySource]) {
      expect(withoutComments(source)).not.toMatch(/otpCode|referenceCode|accounts|esimActivationCode|esimIccid/);
    }
  });

  it("authorises against the owner, not just the order id", () => {
    expect(receiptSource).toContain("eq(orders.userId, user.id)");
    expect(receiptSource).toContain("notFound()");
  });
});

describe("PrintButton", () => {
  it("prints, which is how every browser saves a PDF", () => {
    const print = vi.fn();
    vi.stubGlobal("print", print);
    render(<PrintButton />);
    screen.getByRole("button", { name: "Print or save as PDF" }).click();
    expect(print).toHaveBeenCalled();
    vi.unstubAllGlobals();
  });
});
