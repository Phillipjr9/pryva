// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";

import { DangerZone } from "@/app/dashboard/settings/DangerZone";

/**
 * The screen that closes an account.
 *
 * Two behaviours matter more than the layout: the customer sees what is removed
 * *and* what is kept before they can act, and the button cannot be pressed by
 * accident — typing the address is required, and the button stays disabled until
 * the confirmation is real.
 */

const refresh = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh }) }));

beforeEach(() => refresh.mockClear());
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

function jsonResponse(body: unknown, ok = true, status = 200) {
  return { ok, status, json: async () => body } as unknown as Response;
}

const EMAIL = "buyer@example.com";

function open() {
  fireEvent.click(screen.getByRole("button", { name: /show me what happens/i }));
}

describe("closing an account from settings", () => {
  it("shows what is removed and what is kept before anything can be typed", () => {
    render(<DangerZone email={EMAIL} walletBalance={0} hasPassword />);
    expect(screen.getByText(/close my account/i)).toBeTruthy();
    expect(screen.queryByText("Removed")).toBeNull();

    open();

    expect(screen.getByText("Removed")).toBeTruthy();
    expect(screen.getAllByText(/kept, without your name/i).length).toBeGreaterThan(0);
    expect(screen.getByText(/your name, email address and password/i)).toBeTruthy();
    expect(screen.getByText(/orders, wallet history, deposits and withdrawals/i)).toBeTruthy();
    expect(screen.getAllByText(/cannot be undone/i).length).toBeGreaterThan(0);
  });

  it("keeps the button disabled until the address is typed and understood", () => {
    render(<DangerZone email={EMAIL} walletBalance={0} hasPassword />);
    open();

    const submit = screen.getByRole("button", { name: /delete my account permanently/i }) as HTMLButtonElement;
    expect(submit.disabled).toBe(true);

    fireEvent.change(screen.getByLabelText(/type .* to confirm/i), { target: { value: "wrong@example.com" } });
    fireEvent.click(screen.getByRole("checkbox"));
    expect(submit.disabled).toBe(true);

    fireEvent.change(screen.getByLabelText(/type .* to confirm/i), { target: { value: EMAIL } });
    // Still disabled: the password is empty, and this account has one.
    expect(submit.disabled).toBe(true);

    fireEvent.change(screen.getByLabelText(/your password/i), { target: { value: "correct horse" } });
    expect(submit.disabled).toBe(false);
  });

  it("sends the confirmation and shows the receipt", async () => {
    const fetchMock = vi.fn(async () =>
      jsonResponse({ ok: true, deleted: true, retained: { orders: 2, walletTransactions: 5, giftCards: 0 } }),
    );
    vi.stubGlobal("fetch", fetchMock);

    render(<DangerZone email={EMAIL} walletBalance={0} hasPassword />);
    open();
    fireEvent.change(screen.getByLabelText(/type .* to confirm/i), { target: { value: EMAIL } });
    fireEvent.change(screen.getByLabelText(/your password/i), { target: { value: "pw" } });
    fireEvent.click(screen.getByRole("checkbox"));
    fireEvent.click(screen.getByRole("button", { name: /delete my account permanently/i }));

    await waitFor(() => expect(screen.getByText(/your account is closed/i)).toBeTruthy());
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("/api/user/delete");
    expect(JSON.parse(String(init.body))).toEqual({ confirm: EMAIL, password: "pw" });
    // What was kept is shown as counts, not as a vague reassurance.
    expect(screen.getByText("Orders")).toBeTruthy();
    expect(screen.getByText("Wallet transactions")).toBeTruthy();
    expect(screen.queryByText("Gift cards")).toBeNull(); // zero is not listed
    expect(refresh).toHaveBeenCalled();
  });

  it("does not ask a Google account for a password it never had", () => {
    render(<DangerZone email={EMAIL} walletBalance={0} hasPassword={false} />);
    open();
    expect(screen.queryByLabelText(/your password/i)).toBeNull();
    expect(screen.getByText(/signs in with google/i)).toBeTruthy();
  });

  it("warns about a balance before the customer tries, and links to the wallet", () => {
    render(<DangerZone email={EMAIL} walletBalance={4500} hasPassword />);
    open();
    expect(screen.getByText(/wallet holds ₦4,500/i)).toBeTruthy();
    expect(screen.getByRole("link", { name: /go to wallet/i })).toBeTruthy();
  });

  it("turns a refusal into a sentence with a way out", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        jsonResponse(
          {
            ok: false,
            code: "BALANCE_REMAINING",
            error: "Your wallet still holds ₦4,500. Withdraw it before closing the account.",
            action: { label: "Withdraw my balance", href: "/dashboard/wallet" },
          },
          false,
          409,
        ),
      ),
    );

    render(<DangerZone email={EMAIL} walletBalance={0} hasPassword />);
    open();
    fireEvent.change(screen.getByLabelText(/type .* to confirm/i), { target: { value: EMAIL } });
    fireEvent.change(screen.getByLabelText(/your password/i), { target: { value: "pw" } });
    fireEvent.click(screen.getByRole("checkbox"));
    fireEvent.click(screen.getByRole("button", { name: /delete my account permanently/i }));

    await waitFor(() => expect(screen.getByRole("alert")).toBeTruthy());
    expect(screen.getByText(/still holds ₦4,500/i)).toBeTruthy();
    expect(screen.getByRole("link", { name: /withdraw my balance/i })).toBeTruthy();
    // Nothing claims success.
    expect(screen.queryByText(/your account is closed/i)).toBeNull();
  });

  it("offers a fresh sign-in when the session is too old to be trusted", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        jsonResponse(
          { ok: false, code: "SESSION_TOO_OLD", error: "For your safety, sign out and sign in again." },
          false,
          403,
        ),
      ),
    );

    render(<DangerZone email={EMAIL} walletBalance={0} hasPassword={false} />);
    open();
    fireEvent.change(screen.getByLabelText(/type .* to confirm/i), { target: { value: EMAIL } });
    fireEvent.click(screen.getByRole("checkbox"));
    fireEvent.click(screen.getByRole("button", { name: /delete my account permanently/i }));

    await waitFor(() => expect(screen.getByRole("link", { name: /sign in again/i })).toBeTruthy());
  });

  it("lets the customer back out without doing anything", () => {
    render(<DangerZone email={EMAIL} walletBalance={0} hasPassword />);
    open();
    fireEvent.click(screen.getByRole("button", { name: /keep my account/i }));
    expect(screen.queryByText(/delete my account permanently/i)).toBeNull();
    expect(screen.getByRole("button", { name: /show me what happens/i })).toBeTruthy();
  });
});
