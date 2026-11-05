// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { PayoutNameManager } from "@/app/admin/(console)/payout-names/PayoutNameManager";

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

/**
 * The queue grew a filter, a search and a visible read error. Each is a claim the
 * page makes to an operator, so each gets a guard: a queue that is only searchable
 * in the happy path, or that reports a failed read as an empty one, would send
 * support looking for a customer who is not there.
 */
describe("working a long queue", () => {
  const second = {
    userId: "9b2e7c4d-1a3f-4e8b-9c6d-7f0a1b2c3d4e",
    userName: "Ngozi Adeyemi",
    userEmail: "ngozi@example.com",
    depositorName: "Ngozi Adeyemi",
    approvedName: null as string | null,
    accounts: [{ id: "acc-2", bankName: "GTBank", accountName: "NGOZI ADEYEMI", accountNumberLast4: "1111" }],
  };

  function twoRows() {
    return vi.fn(async (url: RequestInfo | URL, init?: RequestInit) => {
      if (String(url) === "/api/admin/payout-names" && !init?.method) {
        return json({ ok: true, users: [blockedUser, { ...second, approvedName: "NGOZI ADEYEMI" }], count: 2 });
      }
      return json({ ok: true });
    });
  }

  it("counts what is waiting apart from what is approved", async () => {
    vi.stubGlobal("fetch", twoRows());
    render(<PayoutNameManager />);
    await screen.findByText("ngozi@example.com");

    const waiting = screen.getByRole("button", { name: /^Waiting/ });
    const approved = screen.getByRole("button", { name: /^Approved/ });
    expect(waiting.textContent).toContain("1");
    expect(approved.textContent).toContain("1");
  });

  it("narrows the list to the filter that was picked", async () => {
    vi.stubGlobal("fetch", twoRows());
    render(<PayoutNameManager />);
    await screen.findByText("ngozi@example.com");

    fireEvent.click(screen.getByRole("button", { name: /^Waiting/ }));
    expect(screen.getByText("emeka@example.com")).toBeTruthy();
    expect(screen.queryByText("ngozi@example.com")).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: /^Approved/ }));
    expect(screen.getByText("ngozi@example.com")).toBeTruthy();
    expect(screen.queryByText("emeka@example.com")).toBeNull();
  });

  it("finds a customer by bank or account name, not only by email", async () => {
    vi.stubGlobal("fetch", twoRows());
    render(<PayoutNameManager />);
    await screen.findByText("ngozi@example.com");

    fireEvent.change(screen.getByLabelText(/Search blocked payouts/i), { target: { value: "gtbank" } });
    expect(screen.getByText("ngozi@example.com")).toBeTruthy();
    expect(screen.queryByText("emeka@example.com")).toBeNull();

    fireEvent.change(screen.getByLabelText(/Search blocked payouts/i), { target: { value: "nobody-here" } });
    expect(await screen.findByText(/Nothing matches this search/i)).toBeTruthy();
  });

  it("does not let a failed read look like an empty queue", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => json({ ok: false, error: "the queue is unavailable" }, 500)),
    );
    render(<PayoutNameManager />);

    // The alert is in the page, not only in a toast that has already gone.
    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toContain("The queue could not be read.");
    expect(alert.textContent).toContain("the queue is unavailable");
    // It must not claim the reassuring thing.
    expect(screen.queryByText(/Nothing is blocked/i)).toBeNull();
  });
});
