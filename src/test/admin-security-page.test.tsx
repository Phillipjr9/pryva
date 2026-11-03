// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";

/**
 * The security page as the owner reads it.
 *
 * Two claims were made here that the code could not support: a protection panel of
 * eight hard-coded "Active" rows, five of which are browser detectors nothing installs,
 * and a violations grid with no tile for `modified_environment` even though the writer
 * accepts it. Both are pinned by rendering the real page.
 */

vi.mock("@/lib/auth", () => ({ requireAdmin: vi.fn().mockResolvedValue({ id: "admin-1" }) }));

import AdminSecurityPage from "@/app/admin/security/page";

const metricsPayload = {
  ok: true,
  metrics: {
    totalViolations: 2,
    byType: {
      devtools: 0,
      debugger: 0,
      injection: 0,
      iframe: 0,
      modified_environment: 1,
      scraping: 1,
    },
  },
  violations: [
    {
      id: "v-1",
      userId: "user-1",
      userEmail: "someone@example.com",
      type: "modified_environment",
      details: "Modified environment detected",
      timestamp: new Date("2026-10-31T12:00:00Z").toISOString(),
      ip: "10.0.0.1",
      url: "/dashboard",
    },
  ],
};

function stubFetch() {
  return vi.fn(async (input: RequestInfo | URL) => {
    const url = String(input);
    const body = url.includes("/api/admin/security/metrics")
      ? metricsPayload
      : { ok: true, events: [], count: 0 };
    return new Response(JSON.stringify(body), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  });
}

beforeEach(() => {
  vi.stubGlobal("fetch", stubFetch());
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

/** The row a label sits in, so its chip can be read. */
function rowFor(label: string): string {
  const label_ = screen.getByText(label);
  const row = label_.parentElement?.parentElement;
  expect(row, label).toBeTruthy();
  return row!.textContent ?? "";
}

/** A tile's number, read from the card its label sits in. */
function tileValue(label: string): string | undefined {
  const found = screen.getByText(label);
  const card = found.closest(".card");
  return card?.querySelector("p:last-of-type")?.textContent ?? undefined;
}

describe("the admin security page", () => {
  it("states which controls are running rather than calling everything active", async () => {
    render(await AdminSecurityPage());
    await waitFor(() => expect(screen.getByText("Total Violations")).toBeTruthy());

    expect(screen.getByText("Security controls")).toBeTruthy();
    expect(screen.queryByText("Active Protections")).toBeNull();
    expect(rowFor("Rate limiting")).toContain("Running");
    expect(rowFor("DevTools detection")).toContain("Not running");
    expect(rowFor("Debugger detection")).toContain("Not running");
    expect(rowFor("Browser fingerprinting")).toContain("Not running");
    expect(rowFor("Frame embedding blocked")).toContain("Running");
  });

  it("counts the violation types it can be given, including the patched-detector one", async () => {
    render(await AdminSecurityPage());
    await waitFor(() => expect(screen.getByText("Total Violations")).toBeTruthy());

    // The tile the old route could not fill, and the total it never added up to.
    expect(tileValue("Modified environment")).toBe("1");
    expect(tileValue("Automated access")).toBe("1");
    expect(tileValue("Total Violations")).toBe("2");
  });

  it("does not leave a stored violation out of the list it shows", async () => {
    render(await AdminSecurityPage());
    await waitFor(() => expect(screen.getByText("Recent Violations")).toBeTruthy());
    expect(screen.getByText(/someone@example\.com/)).toBeTruthy();
    expect(screen.getByText(/Modified environment detected/)).toBeTruthy();
    expect(screen.queryByText(/Only a browser running the client detector/)).toBeNull();
  });

  it("says the counts are unknown when the request fails, not that nothing happened", async () => {
    vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL) =>
      String(input).includes("/metrics") ? new Response("{}", { status: 500 }) : new Response(JSON.stringify({ ok: true, events: [] }))));
    render(await AdminSecurityPage());
    await waitFor(() => expect(screen.getByText("Security data could not be loaded")).toBeTruthy());
    expect(screen.getByText(/failed request, not an empty table/i)).toBeTruthy();
  });
});
