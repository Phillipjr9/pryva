// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { CallOfDutyBrowser } from "@/app/dashboard/call-of-duty-mobile/CallOfDutyBrowser";

afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

describe("Call of Duty Mobile browser", () => {
  it("browses real Activision listings for the selected account region", async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ ok: true, items: [{ id: "digital-1", name: "80 CP", stock: "reported" }], nextCursor: null }) });
    vi.stubGlobal("fetch", fetchMock);
    render(<CallOfDutyBrowser />);
    await screen.findByText("80 CP");
    expect(fetchMock.mock.calls[0][0]).toContain("category=topups-call-of-duty-mobile-activision-united-states");
    expect(screen.getByText("Not available to order")).toBeTruthy();
    expect(screen.getByLabelText("Activision account region").querySelectorAll("option")).toHaveLength(5);
    fireEvent.change(screen.getByLabelText("Activision account region"), { target: { value: "india" } });
    await waitFor(() => expect(fetchMock.mock.calls.some(([url]) => url.includes("category=topups-call-of-duty-mobile-activision-india"))).toBe(true));
  });
});
