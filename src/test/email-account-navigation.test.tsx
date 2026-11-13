// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import InboxPage from "@/app/dashboard/inbox/page";
import DashboardAccountsPage from "@/app/dashboard/accounts/page";

vi.mock("@/lib/identity/auth", () => ({ requireUser: vi.fn(async () => ({ walletBalance: 1000 })) }));
vi.mock("@/app/dashboard/inbox/InboxManager", () => ({ InboxManager: () => <div>Inbox manager</div> }));
vi.mock("@/app/(site)/accounts/AccountsBrowser", () => ({ AccountsBrowser: ({ purchaseEnabled }: { purchaseEnabled: boolean }) => <div>Checkout {purchaseEnabled ? "enabled" : "paused"}</div> }));
vi.mock("@/lib/services/accounts/marketplace-policy", () => ({ isMarketplaceCheckoutConfigured: () => false }));

afterEach(cleanup);

describe("email account navigation", () => {
  it("keeps the free inbox distinct and links to paid accounts", async () => {
    render(await InboxPage());
    expect(screen.getByText(/Paid email accounts.*are separate from this free temporary inbox/)).toBeTruthy();
    expect(screen.getByRole("link", { name: "Browse email accounts" }).getAttribute("href")).toBe("/dashboard/accounts");
    expect(screen.getByText("Inbox manager")).toBeTruthy();
  });

  it("explains where to search without changing the checkout gate", async () => {
    render(await DashboardAccountsPage());
    expect(screen.getByText(/Search by provider below; shortcuts only show platforms on the loaded page/)).toBeTruthy();
    expect(screen.getByText("Checkout paused")).toBeTruthy();
    expect(screen.getByRole("link", { name: "Top up" }).getAttribute("href")).toBe("/dashboard/wallet");
  });
});
