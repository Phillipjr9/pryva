// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { BoostingLiveCheck } from "@/app/admin/boosting/BoostingLiveCheck";

/**
 * The admin live check. Two behaviours matter: it never spends a supplier
 * request on page load (the key is rate-limited), and a failure is shown as a
 * sentence rather than an empty panel.
 */

const CHECK = {
  ok: true,
  configured: true,
  reachable: true,
  currency: "NGN" as const,
  balance: 42.5,
  services: 3,
  listed: 2,
  markupPercent: 35,
  fxRate: null,
  endpointHost: "panel.example",
  error: null,
  hint: "2 of 3 supplier services are listed for sale — one per platform and intent, each priced and ready.",
};

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("boosting live check", () => {
  it("waits to be asked before spending a supplier request", () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    render(<BoostingLiveCheck />);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(screen.getByRole("button", { name: "Run live check" })).toBeTruthy();
  });

  it("shows what the supplier said, including how much of its catalogue is listed", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({ ok: true, json: async () => CHECK }),
    );
    render(<BoostingLiveCheck />);
    fireEvent.click(screen.getByRole("button", { name: "Run live check" }));

    await waitFor(() => expect(screen.getByText("2 of 3")).toBeTruthy());
    expect(screen.getByText("NGN")).toBeTruthy();
    expect(screen.getByText("42.5 NGN")).toBeTruthy();
    expect(screen.getByText(/2 of 3 supplier services are listed/)).toBeTruthy();
    expect(screen.getByText(/naira rate not set/)).toBeTruthy();
  });

  it("reports a failed check instead of showing an empty panel", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("offline")));
    render(<BoostingLiveCheck />);
    fireEvent.click(screen.getByRole("button", { name: "Run live check" }));

    await waitFor(() => expect(screen.getByRole("alert").textContent).toContain("offline"));
  });
});
