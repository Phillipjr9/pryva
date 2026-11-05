// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { AccountsBrowser } from "@/app/(site)/accounts/AccountsBrowser";

vi.mock("next/link", () => ({
  default: ({ href, children, ...props }: React.AnchorHTMLAttributes<HTMLAnchorElement>) => <a href={href} {...props}>{children}</a>,
}));

const UUID = "f15740f0-5c82-488d-88b9-d7050c1da9c8";
const listing = {
  id: 1, slug: "p1:item", title: "Example account", stock: 20, sold: 1, category: "Other", subcategory: null,
  priceNgn: 2000, warrantyDays: 30, minQuantity: 1, maxQuantity: 20, available: true,
  fulfilment: "instant", purchasable: true,
};
function response(body: unknown, status = 200) {
  return { ok: status >= 200 && status < 300, status, json: async () => body } as Response;
}
function quote(input: { slug?: string; quantity?: number; promoCode?: string } = {}, overrides: Record<string, unknown> = {}) {
  return {
    slug: input.slug ?? listing.slug, quantity: input.quantity ?? 1, promoCode: input.promoCode ?? "",
    totalNgn: 2500 * (input.quantity ?? 1), savedNgn: input.promoCode ? 500 : 0,
    terms: "a".repeat(24), title: listing.title, fulfilment: "instant", warrantyDays: 30, stock: 20,
    ...overrides,
  };
}
function setup(handlers: {
  review?: (body: Record<string, unknown>) => Promise<Response> | Response;
  purchase?: (body: Record<string, unknown>, index: number) => Promise<Response> | Response;
} = {}) {
  const purchases: Record<string, unknown>[] = [];
  const reviews: Record<string, unknown>[] = [];
  const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const path = String(input);
    if (path.startsWith("/api/accounts/categories")) return response({ configured: true, categories: [], subcategories: [] });
    if (path.startsWith("/api/accounts/listings")) return response({ configured: true, listings: [listing], meta: { current_page: 1, last_page: 1, per_page: 20, total: 1 } });
    if (path === "/api/accounts/quote") {
      const body = JSON.parse(String(init?.body)) as Record<string, unknown>;
      reviews.push(body);
      return handlers.review ? await handlers.review(body) : response({ ok: true, quote: quote(body) });
    }
    if (path === "/api/accounts/purchase") {
      const body = JSON.parse(String(init?.body)) as Record<string, unknown>;
      purchases.push(body);
      return handlers.purchase ? await handlers.purchase(body, purchases.length) : response({ ok: true, accounts: ["user|password"], order: { reference: "MKT-test" }, totalNgn: body.expectedTotalNgn });
    }
    throw new Error(`Unexpected request ${path}`);
  });
  vi.stubGlobal("fetch", fetchMock);
  vi.stubGlobal("crypto", { randomUUID: () => UUID });
  render(<AccountsBrowser purchaseEnabled={true} />);
  return { fetchMock, purchases, reviews };
}
async function openCheckout() {
  fireEvent.click(await screen.findByRole("button", { name: "Buy" }));
  return screen.getByRole("dialog", { name: "Buy accounts" });
}

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("marketplace reviewed checkout", () => {
  it("requires a server review and sends exactly the displayed total and terms", async () => {
    const { purchases, reviews } = setup();
    const dialog = await openCheckout();
    expect(within(dialog).getByText("Not reviewed")).toBeTruthy();
    expect(within(dialog).queryByRole("button", { name: /^Pay / })).toBeNull();
    fireEvent.click(within(dialog).getByRole("button", { name: "Review price" }));
    const pay = await within(dialog).findByRole("button", { name: "Pay ₦2,500" });
    expect(reviews).toEqual([{ slug: listing.slug, quantity: 1, promoCode: "" }]);
    fireEvent.click(pay);
    expect(await screen.findByText(/Delivered — 1 account/)).toBeTruthy();
    expect(purchases).toHaveLength(1);
    expect(purchases[0]).toMatchObject({ expectedTotalNgn: 2500, expectedTerms: "a".repeat(24), requestId: UUID, quantity: 1 });
  });

  it("shows the updated price and terms and waits for a second click after a change", async () => {
    const { purchases } = setup({
      purchase: (_body, index) => index === 1
        ? response({ code: "quote_changed", quote: quote({}, { totalNgn: 3200, terms: "b".repeat(24), title: "Updated account", warrantyDays: 60 }) }, 409)
        : response({ ok: true, accounts: ["user|password"], order: { reference: "MKT-test" }, totalNgn: 3200 }),
    });
    const dialog = await openCheckout();
    fireEvent.click(within(dialog).getByRole("button", { name: "Review price" }));
    fireEvent.click(await within(dialog).findByRole("button", { name: "Pay ₦2,500" }));
    expect((await within(dialog).findByRole("alert")).textContent).toMatch(/changed.*confirm again/i);
    expect(within(dialog).getByText("Updated account")).toBeTruthy();
    expect(within(dialog).getByText(/2-month replacement warranty/)).toBeTruthy();
    const confirm = within(dialog).getByRole("button", { name: "Confirm and pay ₦3,200" });
    expect(purchases).toHaveLength(1);
    fireEvent.click(confirm);
    expect(await screen.findByText(/Delivered — 1 account/)).toBeTruthy();
    expect(purchases).toHaveLength(2);
    expect(purchases[1]).toMatchObject({ expectedTotalNgn: 3200, expectedTerms: "b".repeat(24), requestId: UUID });
  });

  it("makes changed fulfilment and the absence of a warranty visible before confirming", async () => {
    setup({ purchase: () => response({ code: "quote_changed", quote: quote({}, { terms: "c".repeat(24), fulfilment: "manual", warrantyDays: 0, stock: null }) }, 409) });
    const dialog = await openCheckout();
    fireEvent.click(within(dialog).getByRole("button", { name: "Review price" }));
    fireEvent.click(await within(dialog).findByRole("button", { name: "Pay ₦2,500" }));
    expect(await within(dialog).findByText(/Delivered after confirmation.*No replacement warranty listed/)).toBeTruthy();
    expect(within(dialog).getByText(/prepared for you after payment/)).toBeTruthy();
    expect(within(dialog).getByRole("button", { name: "Confirm and pay ₦2,500" })).toBeTruthy();
  });

  it("invalidates a reviewed total when quantity or promo changes", async () => {
    const { reviews, purchases } = setup();
    const dialog = await openCheckout();
    fireEvent.click(within(dialog).getByRole("button", { name: "Review price" }));
    expect(await within(dialog).findByRole("button", { name: "Pay ₦2,500" })).toBeTruthy();
    fireEvent.click(within(dialog).getByRole("button", { name: "Increase quantity" }));
    expect(within(dialog).queryByRole("button", { name: /^Pay / })).toBeNull();
    fireEvent.change(within(dialog).getByLabelText("Promo code (optional)"), { target: { value: "save50" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Review price" }));
    expect(await within(dialog).findByRole("button", { name: "Pay ₦5,000" })).toBeTruthy();
    expect(reviews.at(-1)).toMatchObject({ quantity: 2, promoCode: "SAVE50" });
    expect(purchases).toHaveLength(0);
  });

  it("does not enable payment when the quote is malformed or requires sign-in", async () => {
    const { purchases } = setup({ review: () => response({ ok: true, quote: quote({}, { terms: "invalid" }) }) });
    let dialog = await openCheckout();
    fireEvent.click(within(dialog).getByRole("button", { name: "Review price" }));
    expect((await within(dialog).findByRole("alert")).textContent).toMatch(/could not verify/i);
    expect(within(dialog).queryByRole("button", { name: /^Pay / })).toBeNull();
    expect(purchases).toHaveLength(0);
    cleanup();
    vi.unstubAllGlobals();

    setup({ review: () => response({ error: "Please sign in to review this price." }, 401) });
    dialog = await openCheckout();
    fireEvent.click(within(dialog).getByRole("button", { name: "Review price" }));
    expect(await within(dialog).findByRole("link", { name: "Sign in" })).toBeTruthy();
    expect(within(dialog).queryByRole("button", { name: /^Pay / })).toBeNull();
  });

  it("hides a technical quote failure without enabling purchase", async () => {
    const { purchases } = setup({ review: () => response({ error: "API ERROR SECRET_RESPONSE" }, 500) });
    const dialog = await openCheckout();
    fireEvent.click(within(dialog).getByRole("button", { name: "Review price" }));
    expect((await within(dialog).findByRole("alert")).textContent).toMatch(/could not review this price/i);
    expect(document.body.textContent).not.toContain("SECRET_RESPONSE");
    expect(purchases).toHaveLength(0);
  });

  it("hides a technical purchase failure and treats the payment as unconfirmed", async () => {
    const { purchases } = setup({ purchase: () => response({ message: "API ERROR SECRET_RESPONSE", error: "API ERROR SECRET_RESPONSE" }, 500) });
    const dialog = await openCheckout();
    fireEvent.click(within(dialog).getByRole("button", { name: "Review price" }));
    fireEvent.click(await within(dialog).findByRole("button", { name: "Pay ₦2,500" }));
    expect(await screen.findByText(/wallet may have been charged/i)).toBeTruthy();
    expect(document.body.textContent).not.toContain("SECRET_RESPONSE");
    expect(purchases).toHaveLength(1);
  });

  it("does not silently remove an expired promo after checkout refuses it", async () => {
    const { purchases } = setup({ purchase: () => response({ code: "promo_unavailable", error: "That promo is no longer available. Review your total before ordering." }, 409) });
    const dialog = await openCheckout();
    const promo = within(dialog).getByLabelText("Promo code (optional)") as HTMLInputElement;
    fireEvent.change(promo, { target: { value: "save50" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Review price" }));
    fireEvent.click(await within(dialog).findByRole("button", { name: "Pay ₦2,500" }));
    expect((await within(dialog).findByRole("alert")).textContent).toMatch(/promo is no longer available/i);
    expect(promo.value).toBe("SAVE50");
    expect(within(dialog).getByRole("button", { name: "Review price" })).toBeTruthy();
    expect(within(dialog).queryByRole("button", { name: /^Pay / })).toBeNull();
    expect(purchases).toHaveLength(1);
  });

  it("prevents a double-click from creating a second purchase request", async () => {
    let resolvePurchase!: (value: Response) => void;
    const deferred = new Promise<Response>((resolve) => { resolvePurchase = resolve; });
    const { purchases } = setup({ purchase: () => deferred });
    const dialog = await openCheckout();
    fireEvent.click(within(dialog).getByRole("button", { name: "Review price" }));
    const pay = await within(dialog).findByRole("button", { name: "Pay ₦2,500" });
    fireEvent.click(pay);
    fireEvent.click(pay);
    expect(purchases).toHaveLength(1);
    await act(async () => {
      resolvePurchase(response({ ok: true, accounts: ["user|password"], order: { reference: "MKT-test" }, totalNgn: 2500 }));
      await deferred;
    });
    expect(await screen.findByText(/Delivered — 1 account/)).toBeTruthy();
  });

  it("does not let an older quote overwrite a newer review", async () => {
    let resolveOld!: (value: Response) => void;
    const old = new Promise<Response>((resolve) => { resolveOld = resolve; });
    let calls = 0;
    const { reviews } = setup({ review: () => ++calls === 1 ? old : response({ ok: true, quote: quote({}, { totalNgn: 3600, terms: "d".repeat(24) }) }) });
    let dialog = await openCheckout();
    const review = within(dialog).getByRole("button", { name: "Review price" });
    fireEvent.click(review);
    fireEvent.click(review);
    expect(reviews).toHaveLength(1);
    fireEvent.click(within(dialog).getByRole("button", { name: "Cancel" }));
    dialog = await openCheckout();
    fireEvent.click(within(dialog).getByRole("button", { name: "Review price" }));
    expect(await within(dialog).findByRole("button", { name: "Pay ₦3,600" })).toBeTruthy();
    await act(async () => { resolveOld(response({ ok: true, quote: quote() })); await old; });
    expect(within(dialog).getByRole("button", { name: "Pay ₦3,600" })).toBeTruthy();
    expect(within(dialog).queryByRole("button", { name: "Pay ₦2,500" })).toBeNull();
    expect(reviews).toHaveLength(2);
  });

  it("ignores a late quote after the customer cancels and reopens checkout", async () => {
    let resolveQuote!: (value: Response) => void;
    const deferred = new Promise<Response>((resolve) => { resolveQuote = resolve; });
    setup({ review: () => deferred });
    let dialog = await openCheckout();
    fireEvent.click(within(dialog).getByRole("button", { name: "Review price" }));
    fireEvent.click(within(dialog).getByRole("button", { name: "Cancel" }));
    dialog = await openCheckout();
    await act(async () => { resolveQuote(response({ ok: true, quote: quote() })); await deferred; });
    expect(within(dialog).getByText("Not reviewed")).toBeTruthy();
    expect(within(dialog).queryByRole("button", { name: /^Pay / })).toBeNull();
  });
});
