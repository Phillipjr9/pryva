import React from "react";
import { describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { HeaderNav } from "@/components/site/HeaderNav";
import { DashboardShell } from "@/components/dashboard/DashboardShell";

vi.mock("next/navigation", () => ({
  usePathname: () => "/",
  useRouter: () => ({ push: vi.fn() }),
}));

describe("navigation without the oversized logo", () => {
  it("keeps navigation and a home link without the image in the site header", () => {
    const html = renderToStaticMarkup(<HeaderNav user={null} />);
    expect(html).not.toContain("pryva-logo.png");
    expect(html).toContain('href="/"');
    expect(html).toContain('aria-label="Open menu"');
    expect(html).toContain('href="/login"');
  });

  it("does not show the oversized image in the dashboard sidebar", () => {
    const html = renderToStaticMarkup(
      <DashboardShell user={{ name: "Demo User", email: "demo@example.test", walletBalance: 0 }}>
        <p>Dashboard content</p>
      </DashboardShell>,
    );
    expect(html).not.toContain("pryva-logo.png");
    expect(html).toContain("Dashboard content");
    expect(html).toContain("Overview");
  });
});
