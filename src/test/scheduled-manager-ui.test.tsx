// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { ScheduledManager } from "@/app/dashboard/scheduled/ScheduledManager";

/**
 * The customer's side of a recurring purchase.
 *
 * The page can now offer the feature only because the nightly job runs the
 * processor, so the UI has two jobs: send the right body to the right endpoint,
 * and be honest about the fact that a run is nightly and can be skipped. A
 * "charged on the 1st" style promise would be a lie at this cadence.
 */

const refresh = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh }) }));

const PLAN = { slug: "vn-otp-1", service: "numbers", name: "Verification number", planLabel: "Any app · 1 use", price: 500 };

const ACTIVE = {
  id: "0b6f7f1e-1f0a-4a4f-9d1a-6b2f4a8c0d11",
  status: "active",
  frequency: "weekly",
  productName: "Verification number",
  planLabel: "Any app · 1 use",
  price: 500,
  nextRunLabel: "12 Nov, 02:20",
  due: false,
  lastRunLabel: null as string | null,
  lastOrderId: null as string | null,
};

function json(data: unknown, status = 200) {
  return { ok: status >= 200 && status < 300, status, json: async () => data } as Response;
}

let calls: { url: string; method?: string; body?: unknown }[] = [];

function fetchMock(respond: (url: string, init?: RequestInit) => Response = () => json({ ok: true, nextRunAt: "2026-11-12T02:20:00.000Z" })) {
  calls = [];
  return vi.fn(async (url: RequestInfo | URL, init?: RequestInit) => {
    calls.push({
      url: String(url),
      method: init?.method,
      body: init?.body ? JSON.parse(String(init.body)) : undefined,
    });
    return respond(String(url), init);
  });
}

beforeEach(() => {
  refresh.mockClear();
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("ScheduledManager", () => {
  it("sends the plan, its service and the frequency the customer chose", async () => {
    vi.stubGlobal("fetch", fetchMock());
    render(<ScheduledManager rows={[]} creatable={[PLAN]} balance={5_000} />);

    fireEvent.change(screen.getByLabelText("How often"), { target: { value: "monthly" } });
    fireEvent.click(screen.getByRole("button", { name: "Schedule this purchase" }));

    await waitFor(() => expect(calls.length).toBe(1));
    expect(calls[0]).toMatchObject({
      url: "/api/scheduled-orders",
      method: "POST",
      body: { service: "numbers", productSlug: "vn-otp-1", frequency: "monthly" },
    });
    await waitFor(() => expect(refresh).toHaveBeenCalled());
  });

  it("says a balance below one run will not be charged, instead of silently creating it", () => {
    vi.stubGlobal("fetch", fetchMock());
    render(<ScheduledManager rows={[]} creatable={[PLAN]} balance={100} />);
    expect(screen.getByText(/your balance is below one run/)).toBeTruthy();
  });

  it("states that a night where delivery fails costs nothing", () => {
    vi.stubGlobal("fetch", fetchMock());
    render(<ScheduledManager rows={[]} creatable={[PLAN]} balance={5_000} />);
    expect(screen.getByText(/Nothing is charged unless the plan is delivered/)).toBeTruthy();
  });

  it("offers only cadences the nightly runner can honour", () => {
    vi.stubGlobal("fetch", fetchMock());
    render(<ScheduledManager rows={[]} creatable={[PLAN]} balance={5_000} />);
    const select = screen.getByLabelText("How often") as HTMLSelectElement;
    const values = Array.from(select.options).map((option) => option.value);
    // `daily` is "every night" here, which one run a night can keep; anything
    // faster than that would need a job the cron plan has no room for.
    expect(values).toEqual(["daily", "weekly", "biweekly", "monthly"]);
  });

  it("pauses, resumes and cancels through PATCH with the schedule's own id", async () => {
    vi.stubGlobal("fetch", fetchMock(() => json({ ok: true })));
    render(<ScheduledManager rows={[ACTIVE]} creatable={[PLAN]} balance={5_000} />);

    fireEvent.click(screen.getByRole("button", { name: "Pause Verification number" }));
    await waitFor(() => expect(calls.length).toBe(1));
    expect(calls[0]).toMatchObject({
      url: "/api/scheduled-orders",
      method: "PATCH",
      body: { orderId: ACTIVE.id, action: "pause" },
    });

    fireEvent.click(screen.getByRole("button", { name: "Cancel Verification number" }));
    await waitFor(() => expect(calls.length).toBe(2));
    expect(calls[1].body).toEqual({ orderId: ACTIVE.id, action: "cancel" });
  });

  it("offers Resume only for a paused schedule", () => {
    vi.stubGlobal("fetch", fetchMock());
    render(<ScheduledManager rows={[{ ...ACTIVE, status: "paused" }]} creatable={[PLAN]} balance={5_000} />);
    expect(screen.getByRole("button", { name: "Resume Verification number" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Pause Verification number" })).toBeNull();
  });

  it("explains a schedule that is due because its last attempt did not go through", () => {
    vi.stubGlobal("fetch", fetchMock());
    render(<ScheduledManager rows={[{ ...ACTIVE, due: true }]} creatable={[PLAN]} balance={5_000} />);
    expect(screen.getByText(/Due now — the last attempt did not go through/)).toBeTruthy();
  });

  it("shows a cancelled schedule without any action that would restart it", () => {
    vi.stubGlobal("fetch", fetchMock());
    render(<ScheduledManager rows={[{ ...ACTIVE, status: "cancelled" }]} creatable={[PLAN]} balance={5_000} />);
    expect(screen.getByText(/Cancelled. Nothing further will run./)).toBeTruthy();
    expect(screen.queryByRole("button", { name: /Cancel Verification number/ })).toBeNull();
    expect(screen.queryByRole("button", { name: /Resume Verification number/ })).toBeNull();
  });

  it("surfaces the route's own refusal rather than inventing one", async () => {
    vi.stubGlobal("fetch", fetchMock(() => json({ error: "That plan cannot be delivered automatically, so it cannot be scheduled." }, 400)));
    render(<ScheduledManager rows={[]} creatable={[PLAN]} balance={5_000} />);
    fireEvent.click(screen.getByRole("button", { name: "Schedule this purchase" }));
    await waitFor(() =>
      expect(screen.getByRole("alert").textContent).toBe("That plan cannot be delivered automatically, so it cannot be scheduled."),
    );
  });

  it("says nothing can be scheduled when no plan is deliverable", () => {
    vi.stubGlobal("fetch", fetchMock());
    render(<ScheduledManager rows={[]} creatable={[]} balance={5_000} />);
    expect(screen.getByText(/nothing can be scheduled/)).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Schedule this purchase" })).toBeNull();
  });
});
