// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { PlanPurchase } from "@/components/purchase/PlanPurchase";
import { findPlan } from "@/lib/services/catalog";
import { isRentalOrderingUnconfigured } from "@/lib/services/numbers/number-availability";

vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }) }));
afterEach(() => { cleanup(); window.localStorage.clear(); vi.unstubAllEnvs(); vi.unstubAllGlobals(); });

describe("rental provider configuration", () => {
  it("marks only mapped rentals unavailable when the provider key is absent or blank", () => {
    for (const value of ["", "   "]) {
      vi.stubEnv("FLEEXA_API_KEY", value);
      expect(isRentalOrderingUnconfigured("rent-ng-30")).toBe(true);
      expect(isRentalOrderingUnconfigured("rent-us-30")).toBe(true);
      expect(isRentalOrderingUnconfigured("vn-us")).toBe(false);
      expect(isRentalOrderingUnconfigured("rent-ng-7")).toBe(false);
    }
    vi.stubEnv("FLEEXA_API_KEY", "test-only-key");
    expect(isRentalOrderingUnconfigured("rent-ng-30")).toBe(false);
  });

  it("keeps the plan visible but blocks purchase when unavailable", () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const plan = findPlan("rent-us-30")!;
    render(<PlanPurchase groups={[{ label: "Rental", plans: [plan] }]} signedIn userId="user-a" walletBalance={500000} nextPath="/virtual-numbers" unavailableSlugs={[plan.slug]} />);
    expect(screen.getAllByText(plan.name).length).toBeGreaterThan(0);
    expect(screen.getByRole("status").textContent).toContain("temporarily unavailable");
    expect(screen.queryByRole("button", { name: /Pay from wallet/ })).toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("still offers single-use Bitcall orders and configured rentals", () => {
    const single = findPlan("vn-us")!, rental = findPlan("rent-us-30")!;
    const { rerender } = render(<PlanPurchase groups={[{ label: "Single", plans: [single] }]} signedIn userId="user-a" walletBalance={500000} nextPath="/virtual-numbers" unavailableSlugs={[rental.slug]} />);
    expect(screen.getByRole("button", { name: /Pay from wallet/ }).hasAttribute("disabled")).toBe(false);
    rerender(<PlanPurchase groups={[{ label: "Rental", plans: [rental] }]} signedIn userId="user-a" walletBalance={500000} nextPath="/virtual-numbers" />);
    expect(screen.getByRole("button", { name: /Pay from wallet/ }).hasAttribute("disabled")).toBe(false);
  });

  it("disables further purchases on the page after an uncertain outcome", async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: false, status: 502, json: async () => ({
      ok: false, safeToRetry: false, error: "Contact support before trying again.",
    }) });
    vi.stubGlobal("fetch", fetchMock);
    const plan = findPlan("vn-us")!;
    render(<PlanPurchase groups={[{ label: "Single", plans: [plan] }]} signedIn userId="user-a" walletBalance={500000} nextPath="/virtual-numbers" />);
    fireEvent.click(screen.getByRole("button", { name: /Pay from wallet/ }));
    await waitFor(() => expect(screen.getByRole("button", { name: /Pay from wallet/ }).hasAttribute("disabled")).toBe(true));
    expect(screen.getByText(/Contact support before trying again/)).toBeTruthy();
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("reuses a persisted attempt after a lost response and reload", async () => {
    const fetchMock = vi.fn().mockRejectedValue(new Error("network"));
    vi.stubGlobal("fetch", fetchMock);
    const plan = findPlan("vn-us")!;
    const props = { groups: [{ label: "Single", plans: [plan] }], signedIn: true, userId: "user-a", walletBalance: 500000, nextPath: "/virtual-numbers" };
    const first = render(<PlanPurchase {...props} />);
    fireEvent.click(screen.getByRole("button", { name: /Pay from wallet/ }));
    await waitFor(() => expect(screen.getByText(/purchase outcome is uncertain/i)).toBeTruthy());
    const firstKey = JSON.parse(String(fetchMock.mock.calls[0][1]?.body)).requestId;
    first.unmount();
    render(<PlanPurchase {...props} />);
    fireEvent.click(screen.getByRole("button", { name: /Pay from wallet/ }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
    expect(JSON.parse(String(fetchMock.mock.calls[1][1]?.body)).requestId).toBe(firstKey);
  });

  it("reuses the claimed rental request after a lost response and reload", async () => {
    const fetchMock = vi.fn().mockRejectedValue(new Error("network"));
    vi.stubGlobal("fetch", fetchMock);
    const plan = findPlan("rent-us-30")!;
    const props = { groups: [{ label: "Rental", plans: [plan] }], signedIn: true, userId: "user-a", walletBalance: 500000, nextPath: "/virtual-numbers" };
    const first = render(<PlanPurchase {...props} />);
    fireEvent.click(screen.getByRole("button", { name: /Pay from wallet/ }));
    await waitFor(() => expect(screen.getByText(/purchase outcome is uncertain/i)).toBeTruthy());
    const originalKey = JSON.parse(String(fetchMock.mock.calls[0][1]?.body)).requestId;
    first.unmount();
    render(<PlanPurchase {...props} />);
    fireEvent.click(screen.getByRole("button", { name: /Pay from wallet/ }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
    expect(JSON.parse(String(fetchMock.mock.calls[1][1]?.body)).requestId).toBe(originalKey);
  });

  it("keeps pending purchase IDs separate between accounts on a shared device", async () => {
    const fetchMock = vi.fn().mockRejectedValue(new Error("network"));
    vi.stubGlobal("fetch", fetchMock);
    const plan = findPlan("vn-us")!;
    const props = { groups: [{ label: "Single", plans: [plan] }], signedIn: true, walletBalance: 500000, nextPath: "/virtual-numbers" };
    const first = render(<PlanPurchase {...props} userId="user-a" />);
    fireEvent.click(screen.getByRole("button", { name: /Pay from wallet/ }));
    await waitFor(() => expect(screen.getByText(/purchase outcome is uncertain/i)).toBeTruthy());
    const firstKey = JSON.parse(String(fetchMock.mock.calls[0][1]?.body)).requestId;
    first.unmount();
    const second = render(<PlanPurchase {...props} userId="user-b" />);
    fireEvent.click(screen.getByRole("button", { name: /Pay from wallet/ }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
    expect(JSON.parse(String(fetchMock.mock.calls[1][1]?.body)).requestId).not.toBe(firstKey);
    second.unmount();
    render(<PlanPurchase {...props} userId="user-a" />);
    fireEvent.click(screen.getByRole("button", { name: /Pay from wallet/ }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(3));
    expect(JSON.parse(String(fetchMock.mock.calls[2][1]?.body)).requestId).toBe(firstKey);
  });

  it("does not spend when it cannot persist a recovery key", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    vi.spyOn(Storage.prototype, "setItem").mockImplementationOnce(() => { throw new Error("blocked"); });
    const plan = findPlan("vn-us")!;
    render(<PlanPurchase groups={[{ label: "Single", plans: [plan] }]} signedIn userId="user-a" walletBalance={500000} nextPath="/virtual-numbers" />);
    fireEvent.click(screen.getByRole("button", { name: /Pay from wallet/ }));
    expect(screen.getByText(/Order recovery storage is unavailable/i)).toBeTruthy();
    expect(fetchMock).not.toHaveBeenCalled();
    vi.restoreAllMocks();
  });

  it("does not send an unavailable rental to sign-in as if it could be purchased", () => {
    const rental = findPlan("rent-us-30")!;
    render(<PlanPurchase groups={[{ label: "Rental", plans: [rental] }]} signedIn={false} userId={null} walletBalance={null} nextPath="/virtual-numbers" unavailableSlugs={[rental.slug]} />);
    expect(screen.queryByRole("link", { name: /Sign in to buy/ })).toBeNull();
    expect(screen.getByRole("status")).toBeTruthy();
  });
});
