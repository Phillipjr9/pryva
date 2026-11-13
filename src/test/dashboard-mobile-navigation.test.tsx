// @vitest-environment jsdom
import type { AnchorHTMLAttributes, ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { DashboardShell } from "@/components/dashboard/DashboardShell";

vi.mock("next/navigation", () => ({
  usePathname: () => "/dashboard",
  useSearchParams: () => new URLSearchParams(),
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), refresh: vi.fn() }),
}));
vi.mock("next/link", () => ({
  default: ({ href, children, onClick, ...props }: AnchorHTMLAttributes<HTMLAnchorElement> & { children: ReactNode }) => (
    <a href={href} {...props} onClick={(event) => { event.preventDefault(); onClick?.(event); }}>{children}</a>
  ),
}));
vi.mock("@/components/notifications/NotificationBell", () => ({
  NotificationBell: () => <button type="button">Notifications</button>,
}));

function renderShell() {
  return render(
    <DashboardShell buildId="test" user={{ name: "Ada", email: "ada@example.test", walletBalance: 0 }}>
      <p>Dashboard content</p>
    </DashboardShell>,
  );
}

beforeEach(() => {
  Object.defineProperty(window, "innerWidth", { configurable: true, writable: true, value: 390 });
  Object.defineProperty(window, "matchMedia", {
    configurable: true,
    writable: true,
    value: vi.fn((query: string) => ({ matches: query === "(min-width: 1024px)" && window.innerWidth >= 1024 })),
  });
  document.body.style.overflow = "auto";
});

afterEach(() => {
  cleanup();
  document.body.style.overflow = "";
  vi.restoreAllMocks();
});

describe("mobile dashboard navigation", () => {
  it("opens a labelled dialog, contains keyboard focus, and restores focus and scrolling", () => {
    renderShell();
    const opener = screen.getByRole("button", { name: "Open menu" });
    opener.focus();
    fireEvent.click(opener);

    const menu = screen.getByRole("dialog", { name: "Dashboard menu" });
    const close = within(menu).getByRole("button", { name: "Close menu" });
    expect(menu.getAttribute("aria-modal")).toBe("true");
    expect(opener.getAttribute("aria-expanded")).toBe("true");
    expect(opener.getAttribute("aria-controls")).toBe(menu.id);
    expect(document.activeElement).toBe(close);
    expect(document.body.style.overflow).toBe("hidden");

    const first = within(menu).getByRole("link", { name: "PryvaLogs home" });
    const last = within(menu).getByRole("button", { name: "Sign out" });
    first.focus();
    fireEvent.keyDown(document, { key: "Tab", shiftKey: true });
    expect(document.activeElement).toBe(last);
    fireEvent.keyDown(document, { key: "Tab" });
    expect(document.activeElement).toBe(first);

    fireEvent.keyDown(document, { key: "Escape" });
    expect(screen.queryByRole("dialog", { name: "Dashboard menu" })).toBeNull();
    expect(opener.getAttribute("aria-expanded")).toBe("false");
    expect(document.activeElement).toBe(opener);
    expect(document.body.style.overflow).toBe("auto");
  });

  it("unlocks the page after following a navigation link", () => {
    renderShell();
    fireEvent.click(screen.getByRole("button", { name: "Open menu" }));
    const menu = screen.getByRole("dialog", { name: "Dashboard menu" });
    fireEvent.click(within(menu).getByRole("link", { name: "Orders" }));
    expect(screen.queryByRole("dialog", { name: "Dashboard menu" })).toBeNull();
    expect(document.body.style.overflow).toBe("auto");
  });

  it("closes and unlocks the drawer if the viewport becomes desktop-sized", () => {
    renderShell();
    fireEvent.click(screen.getByRole("button", { name: "Open menu" }));
    expect(document.body.style.overflow).toBe("hidden");
    window.innerWidth = 1200;
    fireEvent(window, new Event("resize"));
    expect(screen.queryByRole("dialog", { name: "Dashboard menu" })).toBeNull();
    expect(document.body.style.overflow).toBe("auto");
  });
});
