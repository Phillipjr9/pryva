// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { DashboardShell } from "@/components/dashboard/DashboardShell";

const location = vi.hoisted(() => ({ pathname: "/dashboard", query: "" }));
vi.mock("next/navigation", () => ({
  usePathname: () => location.pathname,
  useSearchParams: () => new URLSearchParams(location.query),
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn(), replace: vi.fn() }),
}));

afterEach(() => { cleanup(); location.pathname = "/dashboard"; location.query = ""; });
const shell = () => <DashboardShell buildId="test" user={{ name: "Ada", email: "ada@example.test", walletBalance: 0 }}>Content</DashboardShell>;

describe("dashboard navigation disclosure", () => {
  it("keeps key links visible and reveals the remaining services on request", () => {
    render(shell());
    const nav = screen.getByRole("navigation", { name: "Dashboard navigation" });
    expect(within(nav).getByRole("link", { name: "Marketplace" })).toBeTruthy();
    const summary = within(nav).getByText("More services");
    const details = summary.closest("details")!;
    expect(details.open).toBe(false);
    expect(details.contains(within(nav).getByRole("link", { name: "Social & Digital Accounts", hidden: true }))).toBe(true);
    fireEvent.click(summary);
    expect(details.open).toBe(true);
    expect(within(nav).getByRole("link", { name: "Social & Digital Accounts" }).getAttribute("href")).toBe("/dashboard/accounts");
    expect(within(nav).getByRole("link", { name: "Gift cards" }).getAttribute("href")).toBe("/dashboard/services?category=gift-cards");
  });

  it("opens the group containing the active service and preserves the selected country", () => {
    location.pathname = "/dashboard/services";
    location.query = "country=us&category=gift-cards";
    render(shell());
    const nav = screen.getByRole("navigation", { name: "Dashboard navigation" });
    expect(within(nav).getByText("More services").closest("details")?.open).toBe(true);
    const link = within(nav).getByRole("link", { name: "Gift cards" });
    expect(link.getAttribute("aria-current")).toBe("page");
    expect(link.getAttribute("href")).toBe("/dashboard/services?country=us&category=gift-cards");
  });
});
