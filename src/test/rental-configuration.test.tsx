// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { PlanPurchase } from "@/components/purchase/PlanPurchase";
import { findPlan } from "@/lib/services/catalog";
import { isRentalOrderingUnconfigured } from "@/lib/services/numbers/number-availability";

vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }) }));
afterEach(() => { cleanup(); vi.unstubAllEnvs(); vi.unstubAllGlobals(); });

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
    render(<PlanPurchase groups={[{ label: "Rental", plans: [plan] }]} signedIn walletBalance={500000} nextPath="/virtual-numbers" unavailableSlugs={[plan.slug]} />);
    expect(screen.getAllByText(plan.name).length).toBeGreaterThan(0);
    expect(screen.getByRole("status").textContent).toContain("temporarily unavailable");
    expect(screen.queryByRole("button", { name: /Pay from wallet/ })).toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("still offers single-use Bitcall orders and configured rentals", () => {
    const single = findPlan("vn-us")!, rental = findPlan("rent-us-30")!;
    const { rerender } = render(<PlanPurchase groups={[{ label: "Single", plans: [single] }]} signedIn walletBalance={500000} nextPath="/virtual-numbers" unavailableSlugs={[rental.slug]} />);
    expect(screen.getByRole("button", { name: /Pay from wallet/ }).hasAttribute("disabled")).toBe(false);
    rerender(<PlanPurchase groups={[{ label: "Rental", plans: [rental] }]} signedIn walletBalance={500000} nextPath="/virtual-numbers" />);
    expect(screen.getByRole("button", { name: /Pay from wallet/ }).hasAttribute("disabled")).toBe(false);
  });

  it("does not send an unavailable rental to sign-in as if it could be purchased", () => {
    const rental = findPlan("rent-us-30")!;
    render(<PlanPurchase groups={[{ label: "Rental", plans: [rental] }]} signedIn={false} walletBalance={null} nextPath="/virtual-numbers" unavailableSlugs={[rental.slug]} />);
    expect(screen.queryByRole("link", { name: /Sign in to buy/ })).toBeNull();
    expect(screen.getByRole("status")).toBeTruthy();
  });
});
