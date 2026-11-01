// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { WithdrawalDashboard } from "@/app/dashboard/wallet/WithdrawalDashboard";

/**
 * Getting a first bank account onto the withdrawal screen.
 *
 * The empty state used to point at `#bank-accounts`, a panel that only exists
 * while the Bank accounts tab is open — so a customer with no accounts pressed
 * the one button offered to them and nothing happened. The panel is now opened by
 * the button itself.
 */

const mocks = vi.hoisted(() => ({ addToast: vi.fn() }));

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn(), replace: vi.fn(), push: vi.fn() }) }));
vi.mock("next/link", () => ({
  default: ({ href, children, ...props }: React.AnchorHTMLAttributes<HTMLAnchorElement>) => <a href={href} {...props}>{children}</a>,
}));
vi.mock("@/components/ui/Toast", () => ({ useToast: () => ({ addToast: mocks.addToast }) }));

const userId = "b0cb37f2-ed07-42f5-b9df-9921ff628f94";

function response(data: unknown, status = 200) {
  return { ok: status >= 200 && status < 300, status, json: async () => data } as Response;
}

function fetchFor(accounts: unknown[]) {
  return vi.fn(async (url: RequestInfo | URL) => {
    const path = String(url);
    if (path === "/api/wallet/bank-accounts") return response({ ok: true, bankAccounts: accounts });
    if (path === "/api/wallet/banks") return response({ ok: true, banks: [{ name: "Access Bank", code: "044" }] });
    if (path === "/api/wallet/withdraw/history") return response({ ok: true, withdrawals: [] });
    throw new Error(`Unexpected request ${path}`);
  });
}

beforeEach(() => {
  window.localStorage.clear();
  mocks.addToast.mockReset();
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("with no bank account yet", () => {
  it("opens the Bank accounts tab from the empty state instead of linking nowhere", async () => {
    vi.stubGlobal("fetch", fetchFor([]));
    // jsdom has requestAnimationFrame but not scrollIntoView.
    Element.prototype.scrollIntoView = vi.fn();

    render(<WithdrawalDashboard balance={10000} userId={userId} />);

    expect(await screen.findByText("Add a bank account first")).toBeTruthy();
    // The panel does not exist while the Withdraw tab is showing.
    expect(document.getElementById("bank-accounts")).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: /Add a bank account/ }));

    const panel = document.getElementById("bank-accounts");
    expect(panel).toBeTruthy();
    expect(within(panel as HTMLElement).getByText("Add a bank account")).toBeTruthy();
    expect(within(panel as HTMLElement).getByLabelText("Bank")).toBeTruthy();
    expect((await screen.findByRole("option", { name: "Access Bank" })) as HTMLOptionElement).toBeTruthy();
  });

  it("keeps the panel reachable from the tab strip too", async () => {
    vi.stubGlobal("fetch", fetchFor([]));
    Element.prototype.scrollIntoView = vi.fn();

    render(<WithdrawalDashboard balance={10000} userId={userId} />);
    await screen.findByText("Add a bank account first");

    fireEvent.click(screen.getByRole("button", { name: /Bank accounts/ }));
    expect(document.getElementById("bank-accounts")).toBeTruthy();
  });
});

describe("with a saved account that cannot be paid", () => {
  it("says so on the account and in the picker, before a withdrawal is attempted", async () => {
    const warning = "Withdrawals can only be paid to a bank account in the same name as the one that funded this wallet.";
    vi.stubGlobal("fetch", fetchFor([
      { id: "acc-1", bankName: "Access Bank", bankCode: "044", accountNumber: "0123456789", accountName: "EMEKA CHUKWUEMEKA OKAFOR", isDefault: true, payoutWarning: warning },
    ]));

    render(<WithdrawalDashboard balance={10000} userId={userId} />);

    const picker = await screen.findByLabelText("Pay out to");
    await waitFor(() => expect(within(picker).getByRole("option", { name: /Access Bank/ })).toBeTruthy());
    expect(within(picker).getByRole("option", { name: /payouts blocked/i })).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: /Bank accounts/ }));
    expect(screen.getByText(warning)).toBeTruthy();
  });

  it("leaves a payrable account unmarked", async () => {
    vi.stubGlobal("fetch", fetchFor([
      { id: "acc-1", bankName: "Access Bank", bankCode: "044", accountNumber: "0123456789", accountName: "EMEKA OKAFOR", isDefault: true, payoutWarning: null },
    ]));

    render(<WithdrawalDashboard balance={10000} userId={userId} />);
    const picker = await screen.findByLabelText("Pay out to");
    await waitFor(() => expect(within(picker).getByRole("option", { name: /Access Bank/ })).toBeTruthy());
    expect(within(picker).queryByRole("option", { name: /payouts blocked/i })).toBeNull();
  });
});
