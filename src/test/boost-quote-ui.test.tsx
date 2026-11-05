// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { BoostPurchaseForm } from "@/app/dashboard/services/boost/[id]/BoostPurchaseForm";

const router = vi.hoisted(() => ({ refresh: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => router }));
vi.mock("next/link", () => ({ default: ({ href, children, ...props }: React.AnchorHTMLAttributes<HTMLAnchorElement>) => <a href={href} {...props}>{children}</a> }));

const listing = {
  id: "live-boost-0123456789abcdef0123", name: "Instagram Followers", tag: "Followers",
  min: 100, max: 10_000, perThousand: 1_500, terms: "a".repeat(24),
};
const updated = { ...listing, name: "Instagram Followers updated", perThousand: 2_100, terms: "b".repeat(24) };
function response(body: unknown, status = 200) {
  return { ok: status >= 200 && status < 300, status, json: async () => body } as Response;
}

beforeEach(() => {
  router.refresh.mockReset();
  vi.stubGlobal("crypto", { randomUUID: () => "11111111-2222-4333-8444-555555555555" });
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

describe("social promotion price review", () => {
  it("never automatically pays a changed price and sends the reviewed new amount only after another click", async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(response({ ok: false, code: "quote_changed", quote: updated }, 409))
      .mockResolvedValueOnce(response({ ok: true, order: {
        reference: "PRY-BOOST1", amount: 210, quantity: 100,
        targetLink: "https://instagram.com/ada", status: "active",
      } }));
    vi.stubGlobal("fetch", fetchMock);
    render(<BoostPurchaseForm listing={listing} walletBalance={100_000} />);
    fireEvent.change(screen.getByLabelText("Profile or post link"), { target: { value: "https://instagram.com/ada" } });
    fireEvent.click(screen.getByRole("button", { name: /Pay .*150.* from wallet/i }));

    expect((await screen.findByRole("alert")).textContent).toMatch(/price or service details changed/i);
    expect(screen.getByRole("status").textContent).toContain("Instagram Followers updated");
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const first = JSON.parse(fetchMock.mock.calls[0][1].body);
    expect(first).toMatchObject({ quantity: 100, expectedTotalNgn: 150, expectedTerms: listing.terms });

    fireEvent.click(screen.getByRole("button", { name: /Pay .*210.* from wallet/i }));
    expect(await screen.findByText("Boost started")).toBeTruthy();
    const second = JSON.parse(fetchMock.mock.calls[1][1].body);
    expect(second).toMatchObject({ quantity: 100, expectedTotalNgn: 210, expectedTerms: updated.terms, requestId: first.requestId });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("does not use an invalid changed quote supplied by the response", async () => {
    const fetchMock = vi.fn().mockResolvedValue(response({ ok: false, code: "quote_changed", quote: { ...updated, perThousand: -1 }, error: "Refresh to review." }, 409));
    vi.stubGlobal("fetch", fetchMock);
    render(<BoostPurchaseForm listing={listing} walletBalance={100_000} />);
    fireEvent.change(screen.getByLabelText("Profile or post link"), { target: { value: "https://instagram.com/ada" } });
    fireEvent.click(screen.getByRole("button", { name: /Pay .*150.* from wallet/i }));
    await waitFor(() => expect(screen.getByRole("alert").textContent).toContain("Refresh to review"));
    expect(screen.getByRole("button", { name: /Pay .*150.* from wallet/i })).toBeTruthy();
  });
});
