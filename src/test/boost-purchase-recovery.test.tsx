// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { BoostPurchaseForm } from "@/app/dashboard/services/boost/[id]/BoostPurchaseForm";

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));
const listing = { id: "live-boost-0123456789abcdef0123", name: "Followers", tag: "Followers", perThousand: 1500, min: 1000, max: 10000 };
afterEach(() => { cleanup(); localStorage.clear(); vi.unstubAllGlobals(); });
function submit() {
  fireEvent.change(screen.getByLabelText("Profile or post link"), { target: { value: "https://instagram.com/test" } });
  fireEvent.click(screen.getByRole("button", { name: /Pay .* from wallet/ }));
}
describe("boost browser recovery", () => {
  it("reuses a saved request after a lost response and reload, scoped to the account", async () => {
    const fetchMock = vi.fn().mockRejectedValue(new TypeError("Failed to fetch"));
    vi.stubGlobal("fetch", fetchMock);
    const first = render(<BoostPurchaseForm listing={listing} walletBalance={10000} userId="a" />);
    submit();
    await waitFor(() => expect(screen.getByRole("alert").textContent).toMatch(/check your wallet and orders/i));
    const key = JSON.parse(fetchMock.mock.calls[0][1].body).requestId;
    first.unmount();
    const second = render(<BoostPurchaseForm listing={listing} walletBalance={10000} userId="a" />);
    submit();
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
    expect(JSON.parse(fetchMock.mock.calls[1][1].body).requestId).toBe(key);
    second.unmount();
    render(<BoostPurchaseForm listing={listing} walletBalance={10000} userId="b" />);
    submit();
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(3));
    expect(JSON.parse(fetchMock.mock.calls[2][1].body).requestId).not.toBe(key);
  });
  it("shows review instead of claiming a pending boost started", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, json: async () => ({ ok: true, pending: true, order: { reference: "PRY-123" }, message: "Needs review" }) }));
    render(<BoostPurchaseForm listing={listing} walletBalance={10000} userId="a" />);
    submit();
    await waitFor(() => expect(screen.getByRole("status").textContent).toContain("Needs review"));
    expect(screen.queryByText("Boost started")).toBeNull();
    expect(screen.queryByRole("button", { name: /Buy another/ })).toBeNull();
  });
});
