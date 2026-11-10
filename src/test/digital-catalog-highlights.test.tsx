// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { DigitalCatalogHighlights } from "@/components/dashboard/DigitalCatalogHighlights";

afterEach(() => { cleanup(); vi.unstubAllGlobals(); });
const id = (c: string) => `digital-${c.repeat(24)}`;
const reply = (data: object, status = 200) => ({ ok: status === 200, json: async () => data });

describe("dashboard digital product highlights", () => {
  it("loads real catalogue results into the overview and links only approved checkout items", async () => {
    const fetchMock = vi.fn().mockResolvedValue(reply({ ok: true, items: [
      { id: id("a"), name: "Game", stock: "reported", checkout: "codes" },
      { id: id("b"), name: "Top-up", stock: "reported" },
      { id: id("c"), name: "Sold out", stock: "out" },
    ] }));
    vi.stubGlobal("fetch", fetchMock); render(<DigitalCatalogHighlights />);
    expect(await screen.findByText("Game")).toBeTruthy();
    expect(screen.getByText("Top-up")).toBeTruthy(); expect(screen.queryByText("Sold out")).toBeNull();
    expect(screen.getByText("Not available to order")).toBeTruthy();
    expect(screen.getByRole("link", { name: "Check price and availability" }).getAttribute("href")).toBe(`/dashboard/digital-codes?product=${id("a")}`);
    expect(screen.getByRole("link", { name: "Browse all digital products" }).getAttribute("href")).toBe("/dashboard/digital-catalog");
    expect(fetchMock.mock.calls[0][0]).toBe("/api/services/digital-catalog?stock=available");
  });
  it("shows an error rather than invented stock, and retries", async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce(reply({ error: "private" }, 503)).mockResolvedValueOnce(reply({ ok: true, items: [] }));
    vi.stubGlobal("fetch", fetchMock); render(<DigitalCatalogHighlights />);
    expect((await screen.findByRole("alert")).textContent).not.toContain("private");
    fireEvent.click(screen.getByRole("button", { name: "Retry" }));
    expect(await screen.findByText(/No in-stock listings returned/)).toBeTruthy();
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
  it("does not show checkout for an unrecognized product type", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(reply({ ok: true, items: [{ id: id("d"), name: "Other", stock: "reported", checkout: "unsafe" }] })));
    render(<DigitalCatalogHighlights />); expect(await screen.findByText("Other")).toBeTruthy();
    expect(screen.queryByRole("link", { name: "Check price and availability" })).toBeNull();
  });
});
