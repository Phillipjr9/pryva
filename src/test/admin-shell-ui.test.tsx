// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { AdminShell, type AttentionItem } from "@/components/admin/AdminShell";

const navigation = vi.hoisted(() => ({ push: vi.fn(), refresh: vi.fn(), replace: vi.fn() }));
vi.mock("next/navigation", () => ({
  usePathname: () => "/admin/overview",
  useRouter: () => navigation,
}));

const attention: AttentionItem[] = [
  { label: "Withdrawals to review", description: "Pending payout requests", count: 2, href: "/admin/withdrawals", kind: "payouts" },
  { label: "Escalated tickets", description: "Customers waiting", count: 0, href: "/admin/support", kind: "support" },
];

beforeEach(() => {
  localStorage.clear();
  window.matchMedia = vi.fn().mockImplementation((query: string) => ({
    matches: query.includes("max-width") ? window.innerWidth < 992 : false,
    media: query,
    onchange: null,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    addListener: vi.fn(),
    removeListener: vi.fn(),
    dispatchEvent: vi.fn(),
  }));
  const dialogPrototype = Object.getPrototypeOf(document.createElement("dialog")) as HTMLDialogElement;
  dialogPrototype.showModal = function () { this.setAttribute("open", ""); };
  dialogPrototype.close = function () { this.removeAttribute("open"); this.dispatchEvent(new Event("close")); };
});
afterEach(() => { cleanup(); vi.clearAllMocks(); document.body.style.overflow = ""; });

function shell() {
  return render(<AdminShell email="ops@example.test" name="Ops" attention={attention} preview={false}><h1>Dashboard</h1></AdminShell>);
}

describe("the rebuilt operator shell", () => {
  it("keeps every section reachable and marks the overview active", () => {
    const { container } = shell();
    expect(container.querySelectorAll("#operator-sidebar .nav-link").length).toBe(25);
    expect(screen.getByRole("link", { name: "Dashboard" }).getAttribute("aria-current")).toBe("page");
    expect(screen.getByRole("link", { name: "Integrity checks" }).getAttribute("href")).toBe("/admin/integrity");
    expect(screen.getAllByRole("main")).toHaveLength(1);
  });

  it("opens command search with Ctrl+K and finds real destinations", () => {
    shell();
    fireEvent.keyDown(document, { key: "k", ctrlKey: true });
    const dialog = screen.getByRole("dialog", { name: "Search the operator console" });
    expect(dialog.hasAttribute("open")).toBe(true);
    fireEvent.change(screen.getByRole("searchbox", { name: "Search pages, orders or users" }), { target: { value: "withdrawals" } });
    expect(screen.getByRole("link", { name: /Withdrawals Finance/ })).toBeTruthy();
    expect(screen.getByRole("link", { name: /Search orders for/ }).getAttribute("href")).toBe("/admin/orders?q=withdrawals");
    fireEvent.keyDown(document, { key: "Escape" });
    expect(dialog.hasAttribute("open")).toBe(false);
  });

  it("persists the chosen theme and applies it to the scoped boundary", () => {
    const { container } = shell();
    fireEvent.click(screen.getByRole("button", { name: "Operator menu" }));
    fireEvent.click(screen.getByRole("button", { name: "Dark" }));
    expect(localStorage.getItem("pryva-admin-theme")).toBe("dark");
    expect(container.querySelector("#pryva-admin")?.getAttribute("data-bs-theme")).toBe("dark");
  });

  it("shows only queues with pending items in notifications", () => {
    shell();
    fireEvent.click(screen.getByRole("button", { name: /Notifications, 2 items/ }));
    expect(screen.getByRole("link", { name: /Withdrawals to review/ }).getAttribute("href")).toBe("/admin/withdrawals");
    expect(screen.queryByText("Escalated tickets")).toBeNull();
  });

  it("opens and closes the mobile drawer without leaving scroll locked", () => {
    window.innerWidth = 390;
    const { container } = shell();
    fireEvent.click(screen.getByRole("button", { name: "Toggle navigation" }));
    expect(container.querySelector(".app-wrapper")?.className).toContain("sidebar-open");
    expect(document.body.style.overflow).toBe("hidden");
    fireEvent.keyDown(document, { key: "Escape" });
    expect(container.querySelector(".app-wrapper")?.className).not.toContain("sidebar-open");
    expect(document.body.style.overflow).toBe("");
  });
});
