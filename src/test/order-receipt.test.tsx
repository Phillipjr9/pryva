// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { readFileSync } from "node:fs";
import { ReceiptBody, type ReceiptData } from "@/app/dashboard/orders/[id]/receipt/ReceiptBody";
import { PrintButton } from "@/app/dashboard/orders/[id]/receipt/PrintButton";
import {
  RECEIPT_STATUS_LABELS,
  receiptLineItems,
  receiptServiceName,
  receiptStatusLabel,
  receiptStatusNote,
  receiptStatusTone,
} from "@/lib/payments/receipt";

/**
 * A receipt is a document, not a screen.
 *
 * The wallet ledger has been exportable for a while, but one order had no paper at
 * all, and the order page cannot stand in for it: that page polls, changes status,
 * and holds the code or the eSIM activation credential. A receipt that carried the
 * credential would be a receipt you must not send to anybody.
 *
 * The page it is read on is also the page that gets printed, which is why the
 * assertions below cover the paper: what is hidden from the print sheet, and
 * what the sheet is guaranteed to carry.
 */

const RECEIPT: ReceiptData = {
  reference: "PRY-8H2K4Q",
  productName: "Verified number · Nigeria",
  service: "Virtual number",
  planLabel: "Any app · 1 use",
  region: "Nigeria",
  duration: "5 minutes",
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
    for (const value of ["delivered", "active", "processing", "pending", "review", "refunded", "cancelled", "failed", "expired"]) {
      expect(RECEIPT_STATUS_LABELS[value], `${value} needs a human label`).toBeTruthy();
      expect(receiptStatusLabel(value)).not.toBe(value);
    }
  });

  it("does not invent a meaning for an unknown status", () => {
    expect(receiptStatusLabel("something_new")).toBe("something_new");
  });

  it("groups every status into settled, in flight or reversed", () => {
    expect(receiptStatusTone("delivered")).toBe("settled");
    expect(receiptStatusTone("active")).toBe("settled");
    expect(receiptStatusTone("processing")).toBe("pending");
    expect(receiptStatusTone("review")).toBe("pending");
    expect(receiptStatusTone("refunded")).toBe("reversed");
    expect(receiptStatusTone("cancelled")).toBe("reversed");
    // An unknown value must not be presented as a completed payment.
    expect(receiptStatusTone("something_new")).toBe("pending");
  });
});

describe("receiptStatusNote", () => {
  it("never tells a refunded customer their order is still in progress", () => {
    // A regression the first draft shipped: "refunded" fell through to the
    // pending sentence on a document a customer may hand to a bank.
    const note = receiptStatusNote("refunded", "4 November 2026, 09:10");
    expect(note).toMatch(/refund/i);
    expect(note).not.toMatch(/paid in full|in progress|not yet complete/i);
    expect(note).toContain("4 November 2026, 09:10");
  });

  it("separates a settled payment from one still in flight", () => {
    expect(receiptStatusNote("delivered")).toMatch(/paid in full/i);
    expect(receiptStatusNote("processing")).toMatch(/in progress/i);
    expect(receiptStatusNote("failed")).toMatch(/reversed/i);
  });
});

describe("receiptServiceName", () => {
  it("spells out the internal slug a customer should never read", () => {
    expect(receiptServiceName("numbers")).toBe("Virtual number");
    expect(receiptServiceName("social")).toBe("Social promotion");
    expect(receiptServiceName("esim")).toBe("eSIM data plan");
  });

  it("passes an unknown value through rather than inventing a product", () => {
    expect(receiptServiceName("something_new")).toBe("something_new");
  });
});

describe("receiptLineItems", () => {
  it("charges one line for one order, never a second charge", () => {
    const items = receiptLineItems(RECEIPT, "₦1,500");
    expect(items).toHaveLength(1);
    expect(items[0].description).toBe("Verified number · Nigeria");
    expect(items[0].amountLabel).toBe("₦1,500");
  });

  it("puts plan, region and validity under the item, not beside it as prices", () => {
    const [item] = receiptLineItems(RECEIPT, "₦1,500");
    expect(item.detail).toContain("Any app · 1 use");
    expect(item.detail).toContain("Nigeria");
    expect(item.detail).toContain("5 minutes");
    // The amount belongs to the description line only.
    expect(item.detail).not.toContain("₦");
  });

  it("identifies what a boosting order promoted, with the quantity", () => {
    const [item] = receiptLineItems(
      { ...RECEIPT, productName: "Instagram followers", targetLink: "https://instagram.com/p/abc", quantity: 1000 },
      "₦18,200",
    );
    expect(item.detail).toContain("https://instagram.com/p/abc");
    expect(item.detail).toContain("1,000 units");
  });

  it("does not leave a dangling separator when a field is empty", () => {
    const [item] = receiptLineItems({ ...RECEIPT, planLabel: "", region: "Nigeria" }, "₦1,500");
    expect(item.detail).toBe("Nigeria · 5 minutes");
    expect(item.detail).not.toContain("· ·");
  });
});

describe("ReceiptBody", () => {
  it("carries the facts a bank or a tax officer asks for", () => {
    render(<ReceiptBody receipt={RECEIPT} />);
    // The reference appears twice on purpose: in the letterhead, and as a field.
    expect(screen.getAllByText("PRY-8H2K4Q").length).toBeGreaterThan(1);
    expect(screen.getByText("Ada Obi")).toBeTruthy();
    expect(screen.getByText("ada@example.com")).toBeTruthy();
    expect(screen.getByText("Verified number · Nigeria")).toBeTruthy();
    expect(screen.getAllByText("₦1,500").length).toBe(2); // line item and total
    expect(screen.getByText("Delivered")).toBeTruthy();
    expect(screen.getByText("Virtual number")).toBeTruthy(); // not the raw "numbers" slug
    expect(screen.getByText("Wallet balance")).toBeTruthy();
    expect(screen.getAllByText("3 November 2026, 14:05").length).toBeGreaterThan(0);
  });

  it("names the buyer, so the document can be filed by the buyer", () => {
    render(<ReceiptBody receipt={RECEIPT} />);
    expect(screen.getByText("Billed to")).toBeTruthy();
    expect(screen.getByText("Paid with")).toBeTruthy();
  });

  it("says a refund happened, with the date, instead of leaving the status ambiguous", () => {
    render(<ReceiptBody receipt={{ ...RECEIPT, status: "refunded", refundedAt: "4 November 2026, 09:10" }} />);
    expect(screen.getByText("Refunded to wallet")).toBeTruthy();
    expect(screen.getByText(/Refund processed 4 November 2026, 09:10/)).toBeTruthy();
  });

  it("is explicit that it is not a tax invoice", () => {
    render(<ReceiptBody receipt={RECEIPT} />);
    expect(screen.getByText(/not a tax invoice/)).toBeTruthy();
  });

  it("tells the reader how to dispute it", () => {
    render(<ReceiptBody receipt={RECEIPT} />);
    expect(screen.getByText(/Open Support in your dashboard/)).toBeTruthy();
  });

  it("marks itself as the printable document", () => {
    const { container } = render(<ReceiptBody receipt={RECEIPT} />);
    // globals.css hides everything outside `.print-document` when printing.
    expect(container.querySelector(".print-document")).toBeTruthy();
  });

  it("gives the sheet a real heading rather than a picture of one", () => {
    render(<ReceiptBody receipt={RECEIPT} />);
    expect(screen.getByRole("heading", { level: 1, name: /payment receipt/i })).toBeTruthy();
    // Column headings make it a table a screen reader can read across.
    expect(screen.getByRole("table", { name: /item charged/i })).toBeTruthy();
    expect(screen.getByRole("columnheader", { name: /description/i })).toBeTruthy();
    expect(screen.getByRole("columnheader", { name: /amount/i })).toBeTruthy();
  });
});

/**
 * Comments explain why a field is absent; only code can leak it.
 */
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

  it("keeps the receipt out of search results and link previews", () => {
    expect(receiptSource).toContain("index: false");
  });
});

describe("the printed sheet is the document, not the dashboard", () => {
  const css = readFileSync("src/app/globals.css", "utf8");

  it("hides the app chrome around a print document", () => {
    // Without this the A4 sheet came out with the sidebar, wallet chip, tab bar
    // and build stamp on it, with the receipt squeezed into the middle column.
    expect(css).toContain("@media print");
    // One rule keeps the document and the elements that contain it, and hides
    // everything else. Listing tags by name missed the dashboard top bar, which
    // is a plain div.
    expect(css).toContain(
      "body:has(.print-document) *:not(.print-document):not(.print-document *):not(:has(.print-document))",
    );
    expect(css).toContain(".print-document {");
  });

  it("gives the page a real size and margin rather than shrinking to fit", () => {
    expect(css).toContain("size: A4;");
    expect(css).toContain("margin: 14mm 14mm 16mm;");
  });

  it("drops the card chrome so the sheet is ink on white", () => {
    const block = css.slice(css.indexOf("@media print"), css.indexOf("@media print") + 2200);
    expect(block).toContain("box-shadow: none !important;");
    expect(block).toContain("border-radius: 0 !important;");
  });
});

describe("PrintButton", () => {
  it("prints, which is how every browser saves a PDF", () => {
    const print = vi.fn();
    vi.spyOn(window, "print").mockImplementation(print);
    render(<PrintButton />);
    screen.getByRole("button", { name: "Print or save as PDF" }).click();
    expect(print).toHaveBeenCalled();
    vi.restoreAllMocks();
  });

  it("is hidden from the paper it produces", () => {
    render(<PrintButton />);
    expect(screen.getByRole("button", { name: "Print or save as PDF" }).className).toContain("print:hidden");
  });
});
