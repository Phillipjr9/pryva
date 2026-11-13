// @vitest-environment jsdom
import { useState } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { CommandPalette } from "@/components/command/CommandPalette";

const push = vi.hoisted(() => vi.fn());
vi.mock("next/navigation", () => ({ useRouter: () => ({ push }) }));

function SearchHarness() {
  const [open, setOpen] = useState(false);
  return <>
    <button type="button" onClick={() => setOpen(true)}>Open search</button>
    {open && <CommandPalette isOpen onClose={() => setOpen(false)} />}
  </>;
}

afterEach(() => {
  cleanup();
  document.body.style.overflow = "";
  push.mockReset();
  vi.unstubAllGlobals();
});

describe("dashboard search on small screens", () => {
  it("offers a touch-sized close control, traps focus, and restores focus and scrolling", () => {
    document.body.style.overflow = "auto";
    render(<SearchHarness />);
    const trigger = screen.getByRole("button", { name: "Open search" });
    trigger.focus();
    fireEvent.click(trigger);

    const dialog = screen.getByRole("dialog", { name: "Dashboard search and commands" });
    const input = within(dialog).getByRole("searchbox", { name: "Search the dashboard" });
    const close = within(dialog).getByRole("button", { name: "Close dashboard search" });
    expect(document.activeElement).toBe(input);
    expect(document.body.style.overflow).toBe("hidden");
    expect(dialog.className).toContain("max-h-[calc(84dvh-1rem)]");
    expect(within(dialog).getByRole("listbox").className).toContain("overflow-y-auto");
    expect(close.className).toContain("min-h-11");
    expect(close.textContent).toBe("Close");

    const options = within(dialog).getAllByRole("option");
    fireEvent.keyDown(document, { key: "Tab", shiftKey: true });
    expect(document.activeElement).toBe(options[options.length - 1]);
    fireEvent.keyDown(document, { key: "Tab" });
    expect(document.activeElement).toBe(input);

    fireEvent.keyDown(document, { key: "Escape" });
    expect(screen.queryByRole("dialog", { name: "Dashboard search and commands" })).toBeNull();
    expect(document.activeElement).toBe(trigger);
    expect(document.body.style.overflow).toBe("auto");
  });

  it("does not turn Enter on the close button into navigation", () => {
    render(<SearchHarness />);
    fireEvent.click(screen.getByRole("button", { name: "Open search" }));
    const close = screen.getByRole("button", { name: "Close dashboard search" });
    close.focus();
    const enter = new KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true });
    close.dispatchEvent(enter);
    expect(enter.defaultPrevented).toBe(false);
    expect(push).not.toHaveBeenCalled();
    fireEvent.click(close);
    expect(screen.queryByRole("dialog", { name: "Dashboard search and commands" })).toBeNull();
  });

  it("still navigates with arrow keys and searches account records", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ ok: true, results: { orders: [], transactions: [], giftCards: [] } }),
    });
    vi.stubGlobal("fetch", fetchMock);
    render(<SearchHarness />);
    const trigger = screen.getByRole("button", { name: "Open search" });
    fireEvent.click(trigger);
    const input = screen.getByRole("searchbox", { name: "Search the dashboard" });
    fireEvent.keyDown(input, { key: "ArrowDown" });
    fireEvent.keyDown(input, { key: "Enter" });
    expect(push).toHaveBeenCalledWith("/dashboard/services");

    fireEvent.click(trigger);
    fireEvent.change(screen.getByRole("searchbox", { name: "Search the dashboard" }), { target: { value: "wallet" } });
    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith("/api/search?q=wallet&type=all", { cache: "no-store" }));
    expect(screen.getByRole("option", { name: /Wallet/ })).toBeTruthy();
  });
});
