// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";

/**
 * The readiness screen itself. It is the one place that explains *why* boosting
 * is not selling yet, so the states are pinned rather than left to prose.
 */

vi.mock("@/lib/auth", () => ({ requireAdmin: vi.fn().mockResolvedValue({ id: "admin-1" }) }));
vi.mock("@/lib/smm-panel", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/smm-panel")>();
  return { ...actual, isSmmPanelConfigured: vi.fn(), smmPanelApiKey: vi.fn(), panelEndpoint: vi.fn() };
});

import AdminBoostingPage from "@/app/admin/boosting/page";
import { isSmmPanelConfigured, panelEndpoint, smmPanelApiKey, SmmPanelError } from "@/lib/smm-panel";

beforeEach(() => {
  vi.clearAllMocks();
  delete process.env.SMM_USD_NGN_RATE;
  delete process.env.SMM_MARKUP_PERCENT;
  delete process.env.SMM_PANEL_API_KEY;
  vi.mocked(isSmmPanelConfigured).mockReturnValue(false);
  vi.mocked(smmPanelApiKey).mockReturnValue(null);
  vi.mocked(panelEndpoint).mockImplementation(() => {
    throw new SmmPanelError("SMM_PANEL_API_URL is not configured", 503, "NO_API_URL");
  });
});

afterEach(cleanup);

async function page() {
  render(await AdminBoostingPage());
}

describe("the boosting readiness page", () => {
  it("says boosting is off and names the two variables to set", async () => {
    await page();
    expect(screen.getByRole("heading", { level: 1 }).textContent).toBe("Boosting");
    expect(screen.getByText(/Boosting is off/)).toBeTruthy();
    expect(screen.getByText("SMM_PANEL_API_KEY")).toBeTruthy();
    expect(screen.getByText("SMM_PANEL_API_URL")).toBeTruthy();
    // Nothing to do yet is not the same as broken: the key step reads "To do".
    expect(screen.getAllByText("To do").length).toBeGreaterThanOrEqual(2);
  });

  it("marks an endpoint that a request must not reach as rejected, not missing", async () => {
    vi.mocked(isSmmPanelConfigured).mockReturnValue(false);
    vi.mocked(smmPanelApiKey).mockReturnValue("set");
    process.env.SMM_PANEL_API_URL = "http://127.0.0.1:9000/api";
    vi.mocked(panelEndpoint).mockImplementation(() => {
      throw new SmmPanelError("blocked", 503, "INVALID_API_URL");
    });
    try {
      await page();
      expect(screen.getByText("Rejected")).toBeTruthy();
      expect(screen.getByText(/not a usable supplier endpoint/)).toBeTruthy();
    } finally {
      delete process.env.SMM_PANEL_API_URL;
    }
  });

  it("reads configured once a key and a usable endpoint exist, and never prints the key", async () => {
    process.env.SMM_PANEL_API_KEY = "super-secret-panel-key";
    process.env.SMM_USD_NGN_RATE = "1600";
    vi.mocked(isSmmPanelConfigured).mockReturnValue(true);
    vi.mocked(smmPanelApiKey).mockReturnValue("super-secret-panel-key");
    vi.mocked(panelEndpoint).mockReturnValue("https://panel.example/api/v2");
    try {
      const { container } = render(await AdminBoostingPage());
      expect(screen.getByText(/Boosting is configured/)).toBeTruthy();
      expect(screen.getByText(/Requests go to panel\.example/)).toBeTruthy();
      expect(container.textContent).not.toContain("super-secret-panel-key");
      // The customer-facing home of boosting is one click away from here.
      expect(screen.getByRole("link", { name: /See the storefront/ }).getAttribute("href")).toBe(
        "/dashboard/services?category=social",
      );
    } finally {
      delete process.env.SMM_PANEL_API_KEY;
      delete process.env.SMM_USD_NGN_RATE;
    }
  });

  it("documents the money path without naming where stock comes from", async () => {
    await page();
    expect(screen.getByText(/wallet is debited and the order is written/)).toBeTruthy();
    expect(screen.getByText(/supplier refuses, the wallet is credited back in full/)).toBeTruthy();
  });
});
