// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { PayoutNameManager } from "@/app/admin/payout-names/PayoutNameManager";

/**
 * The operator's side of a refused payout.
 *
 * The queue is only useful if approving it actually reaches the endpoint that
 * stores the decision, and if the reason is compulsory: an approval without a
 * reason is an unexplained payment to somebody, which is the thing the rule
 * exists to prevent.
 */

const mocks = vi.hoisted(() => ({ addToast: vi.fn() }));
vi.mock("@/components/ui/Toast", () => ({ useToast: () => ({ addToast: mocks.addToast }) }));

const blockedUser = {
  userId: "3f1c6a2b-9d4e-4a7c-8b1f-2e5d6c7b8a90",
  userName: "Emeka",
  userEmail: "emeka@example.com",
  depositorName: "Emeka",
  approvedName: null as string | null,
  accounts: [{ id: "acc-1", bankName: "Access Bank", accountName: "EMEKA CHUKWUEMEKA OKAFOR", accountNumberLast4: "6789" }],
};

function json(data: unknown, status = 200) {
  return { ok: status >= 200 && status < 300, status, json: async () => data } as Response;
}

let postPayload: unknown;

function fetchMock(row = blockedUser) {
  postPayload = undefined;
  return vi.fn(async (url: RequestInfo | URL, init?: RequestInit) => {
    const path = String(url);
    if (path === "/api/admin/payout-names" && !init?.method) return json({ ok: true, users: [row], count: 1 });
    if (path === "/api/admin/payout-names" && init?.method === "POST") {
      postPayload = JSON.parse(String(init.body));
      return json({ ok: true, approvedName: "EMEKA CHUKWUEMEKA OKAFOR" });
    }
    if (path === "/api/admin/payout-names" && init?.method === "DELETE") return json({ ok: true });
    throw new Error(`Unexpected request ${path}`);
  });
}

beforeEach(() => {
  mocks.addToast.mockReset();
  vi.stubGlobal("confirm", () => true);
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("the payout-name review queue", () => {
  it("shows the frozen depositor name and the blocked account without the full number", async () => {
    vi.stubGlobal("fetch", fetchMock());
    render(<PayoutNameManager />);

    expect(await screen.findByText("emeka@example.com")).toBeTruthy();
    // Shown once as the account holder and once as the frozen depositor name.
    expect(screen.getByText(/Depositor name on record:/).textContent).toContain("Emeka");
    expect(screen.getByText(/••••6789/)).toBeTruthy();
    expect(document.body.textContent).not.toContain("0123456789");
  });

  it("posts the reviewed name and the reason", async () => {
    vi.stubGlobal("fetch", fetchMock());
    render(<PayoutNameManager />);
    await screen.findByText("emeka@example.com");

    fireEvent.change(screen.getByLabelText(/Reviewed payout name for emeka@example.com/i), {
      target: { value: "EMEKA CHUKWUEMEKA OKAFOR" },
    });
    fireEvent.change(screen.getByLabelText(/Reason for approving a payout name for emeka@example.com/i), {
      target: { value: "Bank statement in ticket 412" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Approve name" }));

    await waitFor(() => expect(postPayload).toBeTruthy());
    expect(postPayload).toEqual({
      userId: blockedUser.userId,
      approvedName: "EMEKA CHUKWUEMEKA OKAFOR",
      reason: "Bank statement in ticket 412",
    });
  });

  it("refuses to approve without a reason", async () => {
    const fetchSpy = fetchMock();
    vi.stubGlobal("fetch", fetchSpy);
    render(<PayoutNameManager />);
    await screen.findByText("emeka@example.com");

    fireEvent.change(screen.getByLabelText(/Reviewed payout name for emeka@example.com/i), {
      target: { value: "EMEKA CHUKWUEMEKA OKAFOR" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Approve name" }));

    await waitFor(() => expect(mocks.addToast).toHaveBeenCalledWith(expect.objectContaining({ type: "error" })));
    // No POST to the endpoint: the only fetch calls are the initial load.
    expect(fetchSpy.mock.calls.filter(([, init]) => (init as RequestInit | undefined)?.method === "POST")).toHaveLength(0);
  });

  it("offers revocation once a name is approved", async () => {
    const fetchSpy = fetchMock({ ...blockedUser, approvedName: "EMEKA CHUKWUEMEKA OKAFOR" });
    vi.stubGlobal("fetch", fetchSpy);
    render(<PayoutNameManager />);
    await screen.findByText("emeka@example.com");

    expect(screen.getByText(/Approved: EMEKA CHUKWUEMEKA OKAFOR/)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Revoke" }));
    await waitFor(() =>
      expect(fetchSpy.mock.calls.some(([, init]) => (init as RequestInit | undefined)?.method === "DELETE")).toBe(true),
    );
  });

  it("says so plainly when nothing is blocked", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => json({ ok: true, users: [], count: 0 })));
    render(<PayoutNameManager />);
    expect(await screen.findByText(/Nothing is blocked/i)).toBeTruthy();
  });
});
