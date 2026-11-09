// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { ClientConfirmation } from "@/app/dashboard/orders/[id]/ClientConfirmation";
afterEach(() => { cleanup(); localStorage.clear(); vi.unstubAllGlobals(); });
describe("confirmation UI", () => {
  it("asks for a code only when the owner order explicitly requires it and does not persist it", async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce({ ok: true, json: async () => ({ ok: true, required: true }) }).mockResolvedValueOnce({ ok: true, status: 200, json: async () => ({ ok: true, message: "Code submitted. Check delivery status later." }) });
    vi.stubGlobal("fetch", fetchMock); render(<ClientConfirmation orderId="order-id" />);
    expect(screen.queryByLabelText("Confirmation code")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: /Check if a confirmation/ }));
    const input = await screen.findByLabelText("Confirmation code"); fireEvent.change(input, { target: { value: "123456" } });
    fireEvent.click(screen.getByRole("button", { name: "Submit confirmation code" }));
    expect(await screen.findByText("Code submitted. Check delivery status later.")).toBeTruthy();
    expect(JSON.parse(fetchMock.mock.calls[1][1].body)).toEqual({ orderId: "order-id", code: "123456" });
    expect(localStorage.length).toBe(0); expect(screen.queryByLabelText("Confirmation code")).toBeNull();
  });
  it("does not solicit a code for an order without an active challenge", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, json: async () => ({ ok: true, required: false, blocked: false }) }));
    render(<ClientConfirmation orderId="order-id" />); fireEvent.click(screen.getByRole("button", { name: /Check if a confirmation/ }));
    expect(await screen.findByText(/No confirmation code is requested/)).toBeTruthy(); expect(screen.queryByLabelText("Confirmation code")).toBeNull();
  });
});
