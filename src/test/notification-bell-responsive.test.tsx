// @vitest-environment jsdom
import type { AnchorHTMLAttributes, ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { NotificationBell } from "@/components/notifications/NotificationBell";

vi.mock("next/link", () => ({
  default: ({ href, children, onClick, ...props }: AnchorHTMLAttributes<HTMLAnchorElement> & { children: ReactNode }) => (
    <a href={href} {...props} onClick={(event) => { event.preventDefault(); onClick?.(event); }}>{children}</a>
  ),
}));

const notification = {
  id: "notice-1", type: "new_message", title: "A message arrived", message: "Open your inbox.",
  read: false, createdAt: "2026-11-01T10:00:00.000Z",
};

function stubNotifications() {
  const fetchMock = vi.fn(async (_url: RequestInfo | URL, _init?: RequestInit) => ({
    ok: true,
    json: async () => ({ notifications: [notification], unreadCount: 1 }),
  }));
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("dashboard notification popover", () => {
  it("links to notification history without marking anything read", async () => {
    const fetchMock = stubNotifications();
    render(<NotificationBell iconOnly alignToHeader viewAllHref="/dashboard/notifications" />);
    const bell = await screen.findByRole("button", { name: "1 unread notifications" });
    await waitFor(() => expect(bell.hasAttribute("disabled")).toBe(false));
    fireEvent.click(bell);

    const panel = screen.getByRole("region", { name: "Notifications" });
    expect(bell.getAttribute("aria-expanded")).toBe("true");
    expect(bell.getAttribute("aria-controls")).toBe(panel.id);
    expect(panel.className).toContain("top-full");
    expect(panel.className).toContain("max-h-");
    const history = within(panel).getByRole("link", { name: "View all notifications" });
    expect(history.getAttribute("href")).toBe("/dashboard/notifications");
    fireEvent.click(history);

    expect(screen.queryByRole("region", { name: "Notifications" })).toBeNull();
    expect(fetchMock.mock.calls.filter(([, init]) => init?.method === "POST")).toHaveLength(0);
  });

  it("keeps the compact mobile bell labelled and exposes unread status", async () => {
    stubNotifications();
    render(<NotificationBell textOnly compactOnMobile alignToHeader viewAllHref="/dashboard/notifications" />);
    const bell = await screen.findByRole("button", { name: "1 unread notifications" });
    await waitFor(() => expect(bell.hasAttribute("disabled")).toBe(false));
    expect(bell.className).toContain("h-10 w-10");
    expect(bell.querySelector("svg")?.getAttribute("class")).toContain("lg:hidden");
    expect(bell.textContent).toContain("Alerts");
    fireEvent.click(bell);
    expect(screen.getByRole("region", { name: "Notifications" })).toBeTruthy();
  });

  it("dismisses on Escape or an outside pointer, returning focus on Escape", async () => {
    stubNotifications();
    render(<NotificationBell iconOnly alignToHeader viewAllHref="/dashboard/notifications" />);
    const bell = await screen.findByRole("button", { name: "1 unread notifications" });
    await waitFor(() => expect(bell.hasAttribute("disabled")).toBe(false));
    fireEvent.click(bell);
    fireEvent.keyDown(document, { key: "Escape" });
    expect(screen.queryByRole("region", { name: "Notifications" })).toBeNull();
    expect(document.activeElement).toBe(bell);
    fireEvent.click(bell);
    fireEvent.pointerDown(document.body);
    expect(screen.queryByRole("region", { name: "Notifications" })).toBeNull();
  });

  it("fits the full panel above the mobile tabs, even after rotation or a wrapped header", async () => {
    stubNotifications();
    const originalHeight = window.innerHeight;
    const { container } = render(<><nav data-dashboard-bottom-nav /><NotificationBell iconOnly alignToHeader viewAllHref="/dashboard/notifications" /></>);
    const bell = await screen.findByRole("button", { name: "1 unread notifications" });
    await waitFor(() => expect(bell.hasAttribute("disabled")).toBe(false));
    fireEvent.click(bell);
    const panel = screen.getByRole("region", { name: "Notifications" });
    const tabs = container.querySelector("nav")!;
    const panelRect = vi.spyOn(panel, "getBoundingClientRect").mockReturnValue({ top: 89 } as DOMRect);
    const tabsRect = vi.spyOn(tabs, "getBoundingClientRect").mockReturnValue({ top: 502, height: 66 } as DOMRect);
    Object.defineProperty(window, "innerHeight", { configurable: true, writable: true, value: 568 });
    fireEvent.resize(window);
    expect(panel.style.maxHeight).toBe("405px");

    tabsRect.mockReturnValue({ top: 254, height: 66 } as DOMRect);
    window.innerHeight = 320;
    fireEvent.resize(window);
    expect(panel.style.maxHeight).toBe("157px");

    // If the header wraps, shift the panel up rather than hiding its actions.
    panelRect.mockReturnValue({ top: 200 } as DOMRect);
    fireEvent.resize(window);
    expect(panel.style.transform).toBe("translateY(-104px)");
    expect(panel.style.maxHeight).toBe("150px");

    // Prefer leaving the bell tappable when the footer can still fit below it.
    vi.spyOn(bell, "getBoundingClientRect").mockReturnValue({ bottom: 115 } as DOMRect);
    fireEvent.resize(window);
    expect(panel.style.transform).toBe("translateY(-77px)");
    expect(panel.style.maxHeight).toBe("123px");
    window.innerHeight = originalHeight;
  });

  it("does not invent an admin history destination and retains mark-all-read", async () => {
    const fetchMock = stubNotifications();
    render(<NotificationBell />);
    const bell = await screen.findByRole("button", { name: "1 unread notifications" });
    await waitFor(() => expect(bell.hasAttribute("disabled")).toBe(false));
    fireEvent.click(bell);
    const panel = screen.getByRole("region", { name: "Notifications" });
    expect(within(panel).queryByRole("link", { name: "View all notifications" })).toBeNull();
    fireEvent.click(within(panel).getByRole("button", { name: "Mark all read" }));
    await waitFor(() => expect(fetchMock.mock.calls.some(([url, init]) => url === "/api/notifications/mark-read" && JSON.parse(String(init?.body)).markAll === true)).toBe(true));
    await waitFor(() => expect(screen.queryByRole("region", { name: "Notifications" })).toBeNull());
  });
});
