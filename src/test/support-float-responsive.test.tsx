// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { SupportChat } from "@/components/support/SupportChat";
import { SupportFloatButton } from "@/components/site/SupportFloatButton";

vi.mock("next/navigation", () => ({
  usePathname: () => "/dashboard/support",
  useRouter: () => ({ refresh: vi.fn(), push: vi.fn(), replace: vi.fn() }),
}));

beforeEach(() => window.localStorage.clear());
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("floating support on the dashboard", () => {
  it("keeps each composer's label unique and returns focus after closing", () => {
    const scrollIntoView = vi.spyOn(HTMLElement.prototype, "scrollIntoView");
    render(<><SupportChat /><SupportFloatButton /></>);
    const trigger = screen.getByRole("button", { name: "Need help? Open support chat" });
    trigger.focus();
    fireEvent.click(trigger);

    const panel = screen.getByRole("region", { name: "Support chat" });
    expect(trigger.getAttribute("aria-expanded")).toBe("true");
    expect(trigger.getAttribute("aria-controls")).toBe(panel.id);
    const allComposers = screen.getAllByLabelText("Your message") as HTMLTextAreaElement[];
    expect(allComposers).toHaveLength(2);
    expect(allComposers[0].id).not.toBe(allComposers[1].id);
    for (const textarea of allComposers) {
      const label = Array.from(document.querySelectorAll("label")).find((item) => item.htmlFor === textarea.id);
      expect(label?.control).toBe(textarea);
    }
    expect(within(panel).getByLabelText("Your message").getAttribute("rows")).toBe("2");
    expect(scrollIntoView).not.toHaveBeenCalled();

    fireEvent.keyDown(window, { key: "Escape" });
    expect(screen.queryByRole("region", { name: "Support chat" })).toBeNull();
    expect(trigger.getAttribute("aria-expanded")).toBe("false");
    expect(document.activeElement).toBe(trigger);
  });

  it("retains the real conversation flow in its compact presentation", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ ok: true, ticketId: "ticket-test", status: "answered", reply: "We are looking into it." }),
    });
    vi.stubGlobal("fetch", fetchMock);
    render(<SupportFloatButton />);
    fireEvent.click(screen.getByRole("button", { name: "Need help? Open support chat" }));
    const panel = screen.getByRole("region", { name: "Support chat" });
    fireEvent.change(within(panel).getByLabelText("Your message"), { target: { value: "Where is my order?" } });
    fireEvent.click(within(panel).getByRole("button", { name: "Ask the assistant" }));
    await waitFor(() => expect(within(panel).getByText("We are looking into it.")).toBeTruthy());
    expect(fetchMock).toHaveBeenCalledWith("/api/support/tickets", expect.objectContaining({ method: "POST" }));
    expect(within(panel).getByText("Where is my order?")).toBeTruthy();
  });
});
