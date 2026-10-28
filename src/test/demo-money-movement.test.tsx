// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { DemoMoneyMovement } from "@/components/dashboard/DemoMoneyMovement";
import { demoMoneyStorageKey, parseDemoMoneyIntent } from "@/lib/demo-money-intent";

vi.mock("@/components/ui/Confetti", () => ({ fireConfetti: vi.fn() }));
const requestId = "7b0402d7-1c72-4055-ab69-ec67f41e6d43";

beforeEach(() => {
  vi.useFakeTimers();
  window.sessionStorage.clear();
  vi.spyOn(crypto, "randomUUID").mockReturnValue(requestId);
});
afterEach(() => { cleanup(); vi.useRealTimers(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });

function response(data: Record<string, unknown>, status = 200) {
  return { ok: status >= 200 && status < 300, status, json: async () => data } as Response;
}
function openAdd(onCompleted = vi.fn()) {
  return { onCompleted, ...render(<DemoMoneyMovement kind="add" balance={5000} userId="demo-user" onClose={vi.fn()} onCompleted={onCompleted} />) };
}
function review(amount: string) {
  fireEvent.change(screen.getByLabelText("Amount (NGN)"), { target: { value: amount } });
  fireEvent.click(screen.getByRole("button", { name: "Review details" }));
}
async function advance(ms: number) { await act(async () => { await vi.advanceTimersByTimeAsync(ms); }); }

describe("demo money movement dialog", () => {
  it("validates whole naira and does not show a receipt until the server confirms", async () => {
    let resolve!: (value: Response) => void;
    const fetchMock = vi.fn((_url: RequestInfo | URL, _options?: RequestInit) => new Promise<Response>((done) => { resolve = done; }));
    vi.stubGlobal("fetch", fetchMock);
    const { onCompleted } = openAdd();
    review("2000.50");
    expect(screen.getByRole("alert").textContent).toContain("whole-naira");
    review("2000");
    fireEvent.click(screen.getByRole("button", { name: "Add ₦2,000" }));
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(JSON.parse(fetchMock.mock.calls[0][1]?.body as string)).toEqual({ amount: 2000, method: "bank-transfer", requestId });
    expect(screen.getByRole("button", { name: "Close transaction dialog" }).hasAttribute("disabled")).toBe(true);
    await advance(3400);
    expect(screen.getByRole("heading", { name: "Waiting for confirmation…" })).toBeTruthy();
    expect(screen.queryByRole("heading", { name: "Demo funds added" })).toBeNull();
    await act(async () => { resolve(response({ ok: true, simulated: true, amount: 2000, fee: 0, reference: "DTOP-TEST", balance: 7000 })); await Promise.resolve(); });
    expect(screen.getByRole("heading", { name: "Demo funds added" })).toBeTruthy();
    expect(screen.getByText("₦7,000")).toBeTruthy();
    expect(onCompleted).toHaveBeenCalledTimes(1);
    expect(sessionStorage.getItem(demoMoneyStorageKey("demo-user", "add"))).toBeNull();
  });

  it("preserves an uncertain request across reopening and retries the same key", async () => {
    const fetchMock = vi.fn().mockRejectedValueOnce(new Error("network"))
      .mockResolvedValueOnce(response({ ok: true, simulated: true, amount: 2000, fee: 0, reference: "DTOP-TEST", balance: 7000 }));
    vi.stubGlobal("fetch", fetchMock);
    const first = openAdd();
    review("2000");
    fireEvent.click(screen.getByRole("button", { name: "Add ₦2,000" }));
    await advance(3400);
    expect(screen.getByRole("button", { name: "Edit" }).hasAttribute("disabled")).toBe(true);
    expect(screen.getByRole("alert").textContent).toContain("Retry this same request");
    first.unmount();
    openAdd();
    expect(screen.getByRole("alert").textContent).toContain("previous demo request");
    fireEvent.click(screen.getByRole("button", { name: "Retry same request" }));
    await advance(3400);
    expect(screen.getByRole("heading", { name: "Demo funds added" })).toBeTruthy();
    const [firstBody, secondBody] = fetchMock.mock.calls.map((call) => JSON.parse(call[1].body));
    expect(firstBody).toEqual(secondBody);
    expect(firstBody.requestId).toBe(requestId);
  });

  it("rejects insufficient send balances and never asks for a real recipient or bank details", () => {
    render(<DemoMoneyMovement kind="send" balance={10000} userId="demo-user" onClose={vi.fn()} onCompleted={vi.fn()} />);
    expect(screen.getByText("Fictional demo destination")).toBeTruthy();
    expect(screen.queryByLabelText(/recipient|bank account|password|PIN/i)).toBeNull();
    review("10000");
    expect(screen.getByRole("alert").textContent).toContain("balance is too low");
    review("6000");
    expect(screen.getByText("₦60")).toBeTruthy();
    expect(screen.getByText("₦3,940")).toBeTruthy();
  });

  it("keeps a rejected payment on review and permits editing after a definite rejection", async () => {
    const fetchMock = vi.fn().mockResolvedValue(response({ error: "Demo wallet balance is too low." }, 402));
    vi.stubGlobal("fetch", fetchMock);
    const onCompleted = vi.fn();
    render(<DemoMoneyMovement kind="send" balance={10000} userId="demo-user" onClose={vi.fn()} onCompleted={onCompleted} />);
    review("6000");
    fireEvent.click(screen.getByRole("button", { name: "Send ₦6,000" }));
    await advance(3400);
    expect(screen.getByRole("alert").textContent).toContain("balance is too low");
    expect(screen.getByRole("button", { name: "Edit" }).hasAttribute("disabled")).toBe(false);
    expect(screen.queryByRole("heading", { name: "Demo transfer complete" })).toBeNull();
    expect(sessionStorage.getItem(demoMoneyStorageKey("demo-user", "send"))).toBeNull();
    expect(onCompleted).not.toHaveBeenCalled();
  });

  it("does not send an unrecoverable request when session storage is blocked", () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => { throw new Error("blocked"); });
    openAdd();
    review("2000");
    fireEvent.click(screen.getByRole("button", { name: "Add ₦2,000" }));
    expect(fetchMock).not.toHaveBeenCalled();
    expect(screen.getByRole("alert").textContent).toContain("session storage");
  });

  it("ignores malformed or cross-flow saved intents", () => {
    const valid = { kind: "add", amount: 2000, method: "card", requestId };
    expect(parseDemoMoneyIntent(JSON.stringify(valid), "add")).toEqual(valid);
    expect(parseDemoMoneyIntent(JSON.stringify(valid), "send")).toBeNull();
    expect(parseDemoMoneyIntent(JSON.stringify({ ...valid, amount: 2.5 }), "add")).toBeNull();
    expect(parseDemoMoneyIntent(JSON.stringify({ ...valid, method: "real-bank" }), "add")).toBeNull();
    expect(parseDemoMoneyIntent(JSON.stringify({ ...valid, requestId: "bad" }), "add")).toBeNull();
  });
});
