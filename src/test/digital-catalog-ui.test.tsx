// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { DigitalCatalogBrowser } from "@/app/dashboard/digital-catalog/DigitalCatalogBrowser";

afterEach(() => { cleanup(); vi.unstubAllGlobals(); });
const reply = (data: object, status = 200) => ({ ok: status === 200, json: async () => data });

describe("digital catalogue browser", () => {
  it("paginates and searches without creating an order", async () => {
    const fetchMock = vi.fn().mockImplementation(async (url: string) => {
      const params = new URL(url, "https://example.test").searchParams;
      if (params.has("q")) return reply({ ok: true, items: [{ id: "2", name: "Telegram Stars" }], nextCursor: null, searchLimited: true, skipped: false });
      if (params.has("cursor")) return reply({ ok: true, items: [{ id: "3", name: "Game credit" }], nextCursor: null, searchLimited: false, skipped: false });
      return reply({ ok: true, items: [{ id: "1", name: "Subscription" }], nextCursor: "next", searchLimited: false, skipped: false });
    });
    vi.stubGlobal("fetch", fetchMock);
    render(<DigitalCatalogBrowser />);
    expect(await screen.findByText("Subscription")).toBeTruthy();
    expect(screen.getByText("Not available to order")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Next page" }));
    expect(await screen.findByText("Game credit")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Previous" }));
    expect(await screen.findByText("Subscription")).toBeTruthy();
    fireEvent.change(screen.getByLabelText("Search digital products"), { target: { value: "Telegram" } });
    fireEvent.click(screen.getByRole("button", { name: "Search" }));
    expect(await screen.findByText("Telegram Stars")).toBeTruthy();
    expect(screen.getByText(/more matches may exist/)).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Next page" })).toBeNull();
    expect(fetchMock.mock.calls.every(([url]) => String(url).startsWith("/api/services/digital-catalog?"))).toBe(true);
  });
  it("reports provider errors and can retry", async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce(reply({ error: "Catalogue unavailable." }, 503)).mockResolvedValueOnce(reply({ ok: true, items: [], nextCursor: null, searchLimited: false, skipped: false }));
    vi.stubGlobal("fetch", fetchMock);
    render(<DigitalCatalogBrowser />);
    expect((await screen.findByRole("alert")).textContent).toContain("Catalogue unavailable.");
    fireEvent.click(screen.getByRole("button", { name: "Retry" }));
    expect(await screen.findByText(/No listings returned/)).toBeTruthy();
  });
});
