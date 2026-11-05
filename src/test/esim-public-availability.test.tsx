import { afterEach, describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import EsimPage from "@/app/(site)/esim/page";
import StatusPage from "@/app/(site)/status/page";
import { serviceMap } from "@/lib/catalog";

afterEach(() => vi.unstubAllEnvs());

function connected() {
  vi.stubEnv("DATABASE_URL", "postgres://configured.test/database");
  vi.stubEnv("BITCALL_KEY_ID", "ak_live_abc");
  vi.stubEnv("BITCALL_API_SECRET", "a".repeat(128));
}

describe("eSIM availability shown to customers", () => {
  it("shows an unavailable state rather than invented plans", () => {
    vi.stubEnv("BITCALL_KEY_ID", "");
    vi.stubEnv("BITCALL_API_SECRET", "");
    const html = renderToStaticMarkup(<EsimPage />);
    expect(html).toContain("eSIM ordering is not connected yet.");
    expect(html).not.toContain("Example only");
    expect(html).not.toContain("Nigeria Lite");
    expect(html).not.toContain("/signup?plan=esim-");
  });

  it("points to the live catalog without claiming example cards are purchasable", () => {
    connected();
    const html = renderToStaticMarkup(<EsimPage />);
    expect(html).toContain("eSIM ordering is configured.");
    expect(html).toContain("/dashboard/esim");
    expect(html).toContain("Can I choose a phone number with my eSIM?");
    expect(html).toContain("you cannot select a specific phone number");
    expect(html).not.toContain("eSIM plans are not available for purchase yet.");
    expect(html).not.toContain("/signup?plan=esim-");
    // Shared description is used on the home page even when ordering is connected.
    expect(serviceMap.esim.description).not.toMatch(/not available/i);
  });

  it("reports the configured path, not a false count of sellable examples", () => {
    connected();
    const html = renderToStaticMarkup(<StatusPage />);
    expect(html).toContain("eSIM ordering is configured.");
    expect(html).not.toContain("example plans are not orderable");
    expect(html).not.toContain("6 of 6 plans in this category can be ordered");
  });

  it("does not advertise ordering in a preview even when keys are present", () => {
    connected();
    vi.stubEnv("DATABASE_URL", "");
    vi.stubEnv("PGHOST", "");
    const html = renderToStaticMarkup(<EsimPage />);
    expect(html).toContain("eSIM ordering is not connected yet.");
    expect(html).not.toContain("eSIM ordering is configured.");
  });
});
