// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { BulkOrdersForm } from "@/app/dashboard/bulk-orders/BulkOrdersForm";

const user = { id: "buyer", walletBalance: 100000 } as Parameters<typeof BulkOrdersForm>[0]["user"];
afterEach(() => { cleanup(); localStorage.clear(); vi.unstubAllGlobals(); });
const form = () => <BulkOrdersForm user={user} sellableSlugs={["vn-ng"]} maxUnits={20} />;
function add() { fireEvent.click(screen.getByRole("button", { name: "Add to Order" })); }
function buy() { fireEvent.click(screen.getByRole("button", { name: /^Purchase/ })); }
describe("bulk browser recovery", () => {
  it("reuses the same basket and request id after a lost response and reload", async () => {
    const fetchMock = vi.fn().mockRejectedValue(new Error("network"));
    vi.stubGlobal("fetch", fetchMock);
    const first = render(form()); await waitFor(() => expect(screen.getByRole("button", { name: "Add to Order" }).hasAttribute("disabled")).toBe(false)); add(); buy();
    await waitFor(() => expect(screen.getByText(/could not confirm the batch/i)).toBeTruthy());
    const sent = JSON.parse(fetchMock.mock.calls[0][1].body);
    first.unmount(); render(form());
    await waitFor(() => expect(screen.getByRole("status").textContent).toMatch(/previous batch/i));
    buy(); await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
    expect(JSON.parse(fetchMock.mock.calls[1][1].body)).toEqual(sent);
  });
  it("shows pending review without claiming the full basket was delivered", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, json: async () => ({ ok: true, pending: true, message: "Batch needs review" }) }));
    render(form()); await waitFor(() => expect(screen.getByRole("button", { name: "Add to Order" }).hasAttribute("disabled")).toBe(false)); add(); buy();
    await waitFor(() => expect(screen.getByText("Batch needs review")).toBeTruthy());
    expect(screen.getByRole("button", { name: /^Purchase/ }).hasAttribute("disabled")).toBe(true);
    expect(screen.queryByText(/Batch processed/)).toBeNull();
  });
});
