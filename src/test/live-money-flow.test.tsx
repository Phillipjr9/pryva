// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { PaystackTopUpFlow } from "@/components/dashboard/PaystackTopUpFlow";
import { TopUpForm } from "@/components/dashboard/TopUpForm";
import { TopUpReturn } from "@/app/dashboard/wallet/TopUpReturn";
import { WithdrawalReviewDialog, type WithdrawalReview } from "@/components/dashboard/WithdrawalReviewDialog";
import { WithdrawalDashboard } from "@/app/dashboard/wallet/WithdrawalDashboard";
import { readPendingPaystackTopUps, rememberPaystackTopUp } from "@/lib/paystack-topup-intent";
import { readWithdrawalIntents } from "@/lib/withdrawal-intent";
import type { WithdrawalReceipt } from "@/lib/withdrawal-receipt";

const mocks = vi.hoisted(() => ({
  navigate: vi.fn(), confetti: vi.fn(), addToast: vi.fn(),
  router: { refresh: vi.fn(), replace: vi.fn(), push: vi.fn() },
}));
vi.mock("next/navigation", () => ({ useRouter: () => mocks.router }));
vi.mock("next/link", () => ({ default: ({ href, children, ...props }: React.AnchorHTMLAttributes<HTMLAnchorElement>) => <a href={href} {...props}>{children}</a> }));
vi.mock("@/lib/paystack-navigate", () => ({ navigateToPaystack: mocks.navigate }));
vi.mock("@/components/ui/Confetti", () => ({ fireConfetti: mocks.confetti }));
vi.mock("@/components/ui/Toast", () => ({ useToast: () => ({ addToast: mocks.addToast }) }));

const userId = "b0cb37f2-ed07-42f5-b9df-9921ff628f94";
const reference = "TOP-aaaaaaaaaaaaaaaaaaaaaaaa";
const requestId = "da16d859-1301-4851-a124-b9dddf107333";
const bankId = "6db3231e-312b-4f81-82a2-2d078e784b6f";
const createdAt = "2026-10-27T12:00:00.000Z";
const withdrawalReference = "WD-bbbbbbbbbbbbbbbbbbbbbbbb";
const bank = { id: bankId, bankName: "Test Bank", bankCode: "044", accountNumber: "1234567890", accountName: "Test Customer", isDefault: true };
const review: WithdrawalReview = { amount: 6000, fee: 60, bankAccountId: bankId, bankName: bank.bankName, accountNumber: bank.accountNumber, accountName: bank.accountName };
const withdrawalReceipt: WithdrawalReceipt = { reference: withdrawalReference, amount: 6000, fee: 60, status: "pending", createdAt, bankName: bank.bankName, accountNumber: bank.accountNumber, accountName: bank.accountName, replayed: false, newBalance: 3940 };

function response(data: unknown, status = 200) {
  return { ok: status >= 200 && status < 300, status, json: async () => data } as Response;
}
function topupReceipt() {
  return { reference, amount: 2000, balanceAfter: 7000, creditedAt: createdAt };
}
function topupReview() {
  fireEvent.change(screen.getByLabelText("Amount (NGN)"), { target: { value: "2000" } });
  fireEvent.click(screen.getByRole("button", { name: "Review details" }));
}

beforeEach(() => { window.localStorage.clear(); mocks.navigate.mockReset(); mocks.confetti.mockReset(); mocks.addToast.mockReset(); mocks.router.refresh.mockReset(); mocks.router.replace.mockReset(); });
afterEach(() => { cleanup(); vi.useRealTimers(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });

describe("real Paystack top-up flow", () => {
  it("reviews first, waits for checkout creation, and stores only the reference before navigating", async () => {
    let resolve!: (response: Response) => void;
    const fetchMock = vi.fn((_url: RequestInfo | URL, _init?: RequestInit) => new Promise<Response>((done) => { resolve = done; }));
    vi.stubGlobal("fetch", fetchMock);
    render(<PaystackTopUpFlow balance={5000} userId={userId} onClose={vi.fn()} />);
    fireEvent.change(screen.getByLabelText("Amount (NGN)"), { target: { value: "2000.5" } });
    fireEvent.click(screen.getByRole("button", { name: "Review details" }));
    expect(screen.getByRole("alert").textContent).toContain("whole-naira");
    topupReview();
    expect(screen.getByText("Choose in Paystack")).toBeTruthy();
    expect(screen.queryByLabelText(/PIN|card number/i)).toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Continue to Paystack" }));
    expect(JSON.parse(fetchMock.mock.calls[0][1]?.body as string)).toEqual({ amount: 2000 });
    expect(screen.getByRole("heading", { name: "Opening Paystack checkout" })).toBeTruthy();
    expect(screen.queryByText(/Funds added to your wallet/i)).toBeNull();
    expect(mocks.navigate).not.toHaveBeenCalled();
    await act(async () => { resolve(response({ ok: true, authorizationUrl: "https://checkout.paystack.com/session", reference })); });
    expect(mocks.navigate).toHaveBeenCalledWith("https://checkout.paystack.com/session");
    expect(readPendingPaystackTopUps(localStorage, userId)).toEqual([{ reference, amount: 2000 }]);
    expect(localStorage.getItem(`pryva.topup.pending.v1.${userId}.${reference}`)).not.toContain("session");
    expect(screen.queryByText(/Funds added to your wallet/i)).toBeNull();
  });

  it("refuses unsafe checkout URLs and never navigates if recovery storage fails", async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce(response({ ok: true, authorizationUrl: "https://checkout.paystack.com.evil.test/session", reference }))
      .mockResolvedValueOnce(response({ ok: true, authorizationUrl: "https://checkout.paystack.com/session", reference }));
    vi.stubGlobal("fetch", fetchMock);
    const first = render(<PaystackTopUpFlow balance={5000} userId={userId} onClose={vi.fn()} />);
    topupReview();
    fireEvent.click(screen.getByRole("button", { name: "Continue to Paystack" }));
    await screen.findByRole("alert");
    expect(mocks.navigate).not.toHaveBeenCalled();
    expect(localStorage.length).toBe(0);
    first.unmount();
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => { throw new Error("Storage blocked"); });
    render(<PaystackTopUpFlow balance={5000} userId={userId} onClose={vi.fn()} />);
    topupReview();
    fireEvent.click(screen.getByRole("button", { name: "Continue to Paystack" }));
    expect((await screen.findByRole("alert")).textContent).toContain("No payment was opened");
    expect(mocks.navigate).not.toHaveBeenCalled();
  });

  it("shows outstanding references and blocks another checkout until reconciliation", async () => {
    rememberPaystackTopUp(localStorage, userId, { reference, amount: 2000 });
    render(<TopUpForm balance={5000} userId={userId} />);
    expect(await screen.findByText(/previous payment needs attention/i)).toBeTruthy();
    expect(screen.getByRole("button", { name: /Review a top-up/i }).hasAttribute("disabled")).toBe(true);
    expect(screen.getByRole("link", { name: "Check payment status" }).getAttribute("href")).toContain(reference);
    vi.spyOn(window, "confirm").mockReturnValue(false);
    fireEvent.click(screen.getByRole("button", { name: "Clear after reconciliation" }));
    expect(readPendingPaystackTopUps(localStorage, userId)).toHaveLength(1);
  });
});

describe("Paystack return confirmation", () => {
  it("keeps pending payments unconfirmed and shows a receipt only after a verified wallet credit", async () => {
    let finishFirst!: (result: Response) => void;
    const fetchMock = vi.fn().mockImplementationOnce(() => new Promise<Response>((resolve) => { finishFirst = resolve; }))
      .mockResolvedValueOnce(response({ ok: true, status: "completed", credited: true, receipt: topupReceipt() }));
    vi.stubGlobal("fetch", fetchMock);
    rememberPaystackTopUp(localStorage, userId, { reference, amount: 2000 });
    render(<TopUpReturn status="return" reference={reference} userId={userId} />);
    expect(screen.getByRole("heading", { name: "Confirming your payment" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Download receipt" })).toBeNull();
    await act(async () => { finishFirst(response({ ok: true, status: "pending", message: "Payment is not confirmed yet." }, 202)); });
    expect(screen.getByRole("heading", { name: "Payment not confirmed yet" })).toBeTruthy();
    expect(mocks.confetti).not.toHaveBeenCalled();
    expect(readPendingPaystackTopUps(localStorage, userId)).toHaveLength(1);
    fireEvent.click(screen.getByRole("button", { name: "Check again" }));
    expect(await screen.findByRole("heading", { name: "Funds added to your wallet" })).toBeTruthy();
    expect(screen.getByText("₦7,000")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Download receipt" })).toBeTruthy();
    expect(mocks.confetti).toHaveBeenCalledTimes(1);
    expect(readPendingPaystackTopUps(localStorage, userId)).toHaveLength(0);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("accepts a duplicate credit with its ledger receipt, but not an incomplete success response", async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce(response({ ok: true, status: "completed", credited: true }))
      .mockResolvedValueOnce(response({ ok: true, status: "completed", credited: false, reason: "already_credited", receipt: topupReceipt() }));
    vi.stubGlobal("fetch", fetchMock);
    render(<TopUpReturn status="success" reference={reference} userId={userId} />);
    expect(await screen.findByRole("heading", { name: "Payment not confirmed yet" })).toBeTruthy();
    expect(mocks.confetti).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Check again" }));
    expect(await screen.findByRole("heading", { name: "Funds added to your wallet" })).toBeTruthy();
    expect(screen.getByText(/already added to your wallet/i)).toBeTruthy();
  });

  it.each([
    [402, { ok: false, status: "failed", error: "Paystack reports this payment failed." }, "Payment needs attention"],
    [409, { error: "Payment details could not be verified." }, "Payment not confirmed yet"],
    [502, { error: "Provider unavailable." }, "Payment not confirmed yet"],
  ])("does not show a receipt for HTTP %s", async (status, body, heading) => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(response(body, status)));
    render(<TopUpReturn status="return" reference={reference} userId={userId} />);
    expect(await screen.findByRole("heading", { name: heading })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Download receipt" })).toBeNull();
    expect(mocks.confetti).not.toHaveBeenCalled();
    expect(screen.getByText(/before paying again/i)).toBeTruthy();
  });

  it("clearly marks test-key checkout and confirmed test receipts as not real payments", async () => {
    const dialog = render(<PaystackTopUpFlow balance={5000} userId={userId} testMode onClose={vi.fn()} />);
    expect(screen.getByText(/PAYSTACK TEST MODE — use test data/)).toBeTruthy();
    dialog.unmount();
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(response({ ok: true, status: "completed", credited: true, receipt: topupReceipt() })));
    render(<TopUpReturn status="return" reference={reference} userId={userId} testMode />);
    expect(await screen.findByRole("heading", { name: "Test funds added to your wallet" })).toBeTruthy();
    expect(screen.getByText(/no real payment was made/i)).toBeTruthy();
    expect(screen.getByText("Paystack test checkout")).toBeTruthy();
  });

  it("does not invent success when a callback has no reference", () => {
    const fetchMock = vi.fn(); vi.stubGlobal("fetch", fetchMock);
    render(<TopUpReturn status="return" userId={userId} />);
    expect(screen.getByRole("heading", { name: "Payment not confirmed yet" })).toBeTruthy();
    expect(screen.getByText(/No payment reference was returned/)).toBeTruthy();
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe("withdrawal request review", () => {
  it("waits for the actual response and labels a pending request as not paid", async () => {
    vi.useFakeTimers();
    let resolve!: (result: { ok: true; receipt: WithdrawalReceipt }) => void;
    const onSubmit = vi.fn(() => new Promise<{ ok: true; receipt: WithdrawalReceipt }>((done) => { resolve = done; }));
    render(<WithdrawalReviewDialog review={review} onSubmit={onSubmit} onClose={vi.fn()} />);
    expect(screen.getByText(/Test Bank · ••••••7890/)).toBeTruthy();
    expect(screen.queryByLabelText(/PIN/i)).toBeNull();
    expect(onSubmit).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Submit withdrawal request" }));
    await act(async () => { await vi.advanceTimersByTimeAsync(1000); });
    expect(screen.getByRole("heading", { name: "Submitting your request" })).toBeTruthy();
    expect(screen.queryByRole("heading", { name: "Withdrawal request recorded" })).toBeNull();
    await act(async () => { resolve({ ok: true, receipt: withdrawalReceipt }); });
    expect(screen.getByRole("heading", { name: "Withdrawal request recorded" })).toBeTruthy();
    expect(screen.getByText("Awaiting approval")).toBeTruthy();
    expect(screen.getByText(/not confirmation of a completed bank payout/i)).toBeTruthy();
    expect(screen.getByRole("button", { name: "Download request receipt" })).toBeTruthy();
  });

  it("never presents an uncertain request as a completed payout", async () => {
    vi.useFakeTimers();
    render(<WithdrawalReviewDialog review={review} onSubmit={vi.fn().mockResolvedValue({ ok: false, message: "Outcome unconfirmed." })} onClose={vi.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: "Submit withdrawal request" }));
    await act(async () => { await vi.advanceTimersByTimeAsync(1000); });
    expect(screen.getByRole("heading", { name: "Request needs attention" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Download request receipt" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Submit withdrawal request" })).toBeNull();
  });

  it("freezes bank details while resolving them and requires re-verification if the name changes", async () => {
    let finishVerify!: (result: Response) => void;
    const fetchMock = vi.fn(async (url: RequestInfo | URL, init?: RequestInit) => {
      const path = String(url);
      if (path === "/api/wallet/bank-accounts" && !init?.method) return response({ ok: true, bankAccounts: [] });
      if (path === "/api/wallet/banks") return response({ ok: true, banks: [{ name: "Test Bank", code: "044" }] });
      if (path === "/api/wallet/withdraw/history") return response({ ok: true, withdrawals: [] });
      if (path === "/api/wallet/verify-account") return new Promise<Response>((resolve) => { finishVerify = resolve; });
      if (path === "/api/wallet/bank-accounts" && init?.method === "POST") {
        expect(JSON.parse(init.body as string)).toMatchObject({ bankCode: "044", accountNumber: "1234567890", expectedAccountName: "Test Customer" });
        return response({ error: "The resolved account name changed. Verify it again before saving." }, 409);
      }
      throw new Error(`Unexpected request ${path}`);
    });
    vi.stubGlobal("fetch", fetchMock);
    render(<WithdrawalDashboard balance={10000} userId={userId} />);
    fireEvent.click(screen.getByRole("button", { name: "Bank accounts" }));
    const bankSelect = screen.getByLabelText("Bank");
    await waitFor(() => expect(within(bankSelect).getByRole("option", { name: "Test Bank" })).toBeTruthy());
    fireEvent.change(bankSelect, { target: { value: "044" } });
    fireEvent.change(screen.getByLabelText("Account number"), { target: { value: "1234567890" } });
    fireEvent.click(screen.getByRole("button", { name: "Verify" }));
    expect(bankSelect.hasAttribute("disabled")).toBe(true);
    expect(screen.getByLabelText("Account number").hasAttribute("disabled")).toBe(true);
    await act(async () => { finishVerify(response({ ok: true, accountName: "Test Customer" })); });
    expect(screen.getByText("Test Customer")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Save bank account" }));
    await waitFor(() => expect(screen.queryByText("Test Customer")).toBeNull());
    expect(screen.getByRole("button", { name: "Save bank account" }).hasAttribute("disabled")).toBe(true);
  });

  it("integrates review with the idempotent withdrawal API and preserves the request on an invalid receipt", async () => {
    vi.spyOn(crypto, "randomUUID").mockReturnValue(requestId);
    let postCount = 0;
    const fetchMock = vi.fn(async (url: RequestInfo | URL, init?: RequestInit) => {
      const path = String(url);
      if (path === "/api/wallet/bank-accounts") return response({ ok: true, bankAccounts: [bank] });
      if (path === "/api/wallet/banks") return response({ ok: true, banks: [] });
      if (path === "/api/wallet/withdraw/history") return response({ ok: true, withdrawals: [] });
      if (path === "/api/wallet/withdraw" && init?.method === "POST") {
        postCount++;
        expect(JSON.parse(init.body as string)).toEqual({ requestId, amount: 6000, bankAccountId: bankId });
        return response({ ok: true, withdrawal: { id: "incomplete" } });
      }
      throw new Error(`Unexpected request ${path}`);
    });
    vi.stubGlobal("fetch", fetchMock);
    render(<WithdrawalDashboard balance={10000} userId={userId} />);
    const select = await screen.findByLabelText("Pay out to");
    await waitFor(() => expect(within(select).getByRole("option", { name: /Test Bank/ })).toBeTruthy());
    fireEvent.change(screen.getByLabelText("Amount to withdraw"), { target: { value: "6000" } });
    fireEvent.change(select, { target: { value: bankId } });
    fireEvent.click(screen.getByRole("button", { name: /Review withdrawal/ }));
    expect(screen.getByRole("heading", { name: "Review your withdrawal" })).toBeTruthy();
    expect(postCount).toBe(0);
    fireEvent.click(screen.getByRole("button", { name: "Submit withdrawal request" }));
    expect(await screen.findByRole("heading", { name: "Request needs attention" })).toBeTruthy();
    expect(postCount).toBe(1);
    expect(readWithdrawalIntents(localStorage, `pryva.withdrawal.pending.v1.${userId}`)).toEqual([{ requestId, amount: 6000, bankAccountId: bankId }]);
    fireEvent.click(screen.getByRole("button", { name: "View requests" }));
    expect(screen.getByRole("button", { name: "Retry original request" })).toBeTruthy();
  });
});
