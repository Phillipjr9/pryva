// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";

const checks = vi.hoisted(() => ({
  admin: vi.fn(),
  probe: vi.fn(),
  fallback: vi.fn(),
}));
vi.mock("@/lib/identity/auth", () => ({ requireAdmin: checks.admin }));
vi.mock("@/lib/providers/bulkacc", () => ({ probeCatalog: checks.probe }));
vi.mock("@/lib/providers/accszone", () => ({ isAccsZoneConfigured: checks.fallback }));

import AccountCatalogHealthPage from "@/app/admin/(console)/account-catalog/page";

afterEach(() => { cleanup(); vi.resetAllMocks(); });

describe("admin account catalog health", () => {
  it("checks admin access before touching the supplier", async () => {
    checks.admin.mockRejectedValue(new Error("not authorized"));
    await expect(AccountCatalogHealthPage()).rejects.toThrow("not authorized");
    expect(checks.probe).not.toHaveBeenCalled();
    expect(checks.fallback).not.toHaveBeenCalled();
  });

  it("shows the primary probe and makes no claim that configured fallback is healthy", async () => {
    checks.admin.mockResolvedValue({ id: "admin" });
    checks.probe.mockResolvedValue({ state: "serving", totalCount: 412 });
    checks.fallback.mockReturnValue(true);
    render(await AccountCatalogHealthPage());
    expect(checks.admin).toHaveBeenCalledWith("/admin/account-catalog");
    expect(screen.getByText("serving")).toBeTruthy();
    expect(screen.getByText(/Products reported by the feed: 412/)).toBeTruthy();
    expect(screen.getByText(/does not confirm that the feed is working/)).toBeTruthy();
  });

  it("does not expose raw upstream details or unsafe error codes", async () => {
    checks.admin.mockResolvedValue({ id: "admin" });
    checks.probe.mockResolvedValue({ state: "failed", code: "secret key=hidden", detail: "private upstream message" });
    checks.fallback.mockReturnValue(false);
    const { container } = render(await AccountCatalogHealthPage());
    expect(screen.getByText("failed")).toBeTruthy();
    expect(container.textContent).not.toContain("private upstream message");
    expect(container.textContent).not.toContain("secret key=hidden");
    expect(screen.getByText("no")).toBeTruthy();
  });

  it("reports no products without claiming the cause is an empty catalog", async () => {
    checks.admin.mockResolvedValue({ id: "admin" });
    checks.probe.mockResolvedValue({ state: "no_products", detail: "private upstream message" });
    checks.fallback.mockReturnValue(false);
    render(await AccountCatalogHealthPage());
    expect(screen.getByText(/does not distinguish an empty catalog from a refused request/)).toBeTruthy();
  });
});
