// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { DataPlansForm } from "@/app/dashboard/data/DataPlansForm";

afterEach(() => { cleanup(); vi.unstubAllGlobals(); vi.useRealTimers(); });

describe("mobile data catalogue recovery", () => {
  it("keeps healthy bundles visible through malformed rows, a failed refresh and recovery", async () => {
    const good = { id: "mtn", network: "MTN", networkCode: "01", name: "MTN 1GB", publishedAmountKobo: 50000, dataType: null };
    const fetcher = vi.fn()
      .mockResolvedValueOnce(Response.json({ plans: [good, null, { ...good, id: "bad", name: { unsafe: true } }], checkedAt: "bad", stale: "no", checkoutReason: {} }))
      .mockResolvedValueOnce(Response.json({ plans: [null], checkedAt: "2026-11-12T12:00:00Z", stale: false, checkoutReason: "Checkout is not connected." }))
      .mockResolvedValueOnce(Response.json({ plans: [good], checkedAt: "2026-11-12T12:00:00Z", stale: false, checkoutReason: "Checkout is not connected." }));
    vi.stubGlobal("fetch", fetcher);
    render(<DataPlansForm />);
    expect(await screen.findByRole("heading", { name: "MTN 1GB" })).toBeTruthy();
    expect(screen.getByText(/Listings may be incomplete/)).toBeTruthy();
    expect(screen.getByText(/Catalogue snapshot time unavailable/)).toBeTruthy();
    expect(screen.getByText(/Purchasing is unavailable from this catalogue/)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Reload listings" }));
    expect((await screen.findByRole("alert")).textContent).toContain("Previously loaded listings remain below");
    expect(screen.getByRole("heading", { name: "MTN 1GB" })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Reload listings" }));
    await waitFor(() => expect(screen.queryByRole("alert")).toBeNull());
    await waitFor(() => expect(screen.queryByText(/Listings may be incomplete/)).toBeNull());
    expect(screen.getByRole("heading", { name: "MTN 1GB" })).toBeTruthy();
    expect(screen.getByText(/Checkout is not connected/)).toBeTruthy();
    expect(fetcher).toHaveBeenCalledTimes(3);
  });

  it("explains a missing connection instead of suggesting repeated retries", async () => {
    const fetcher = vi.fn().mockResolvedValue(Response.json({ error: "The mobile data catalogue is not connected yet.", code: "unconfigured" }, {
      status: 503, headers: { "Retry-After": "60" },
    }));
    vi.stubGlobal("fetch", fetcher);
    render(<DataPlansForm />);
    expect((await screen.findByRole("alert")).textContent).toContain("The mobile data catalogue is not connected yet.");
    expect(screen.getByRole("button", { name: "Reload listings" })).toHaveProperty("disabled", true);
    expect(screen.queryByText(/Use Reload listings to retry/)).toBeNull();
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it("prevents reloading until a throttle cooldown has passed", async () => {
    vi.useFakeTimers();
    // A gateway may return a non-JSON throttle body; the header still counts.
    const fetcher = vi.fn().mockResolvedValue(new Response("busy", { status: 429, headers: { "Retry-After": "6" } }));
    vi.stubGlobal("fetch", fetcher);
    render(<DataPlansForm />);
    await act(async () => { await vi.advanceTimersByTimeAsync(0); });
    expect(screen.getByRole("alert").textContent).toContain("Please wait before reloading.");
    expect(screen.getByRole("button", { name: "Reload listings" })).toHaveProperty("disabled", true);
    await act(async () => { await vi.advanceTimersByTimeAsync(6_000); });
    expect(screen.getByRole("button", { name: "Reload listings" })).toHaveProperty("disabled", false);
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it("helps a signed-out shopper sign in again", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(Response.json({ error: "Unauthorized" }, { status: 401 })));
    render(<DataPlansForm />);
    expect((await screen.findByRole("link", { name: "Sign in again" })).getAttribute("href")).toBe("/login?next=%2Fdashboard%2Fdata");
    expect(screen.getByRole("button", { name: "Reload listings" })).toHaveProperty("disabled", true);
  });
});
