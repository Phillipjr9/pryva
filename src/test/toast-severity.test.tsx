// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { ToastProvider, useToast } from "@/components/ui/Toast";

const pathname = vi.hoisted(() => ({ value: "/wallet" }));
vi.mock("next/navigation", () => ({ usePathname: () => pathname.value }));

function Trigger({ message, type }: { message: string; type: "success" | "error" }) {
  const { addToast } = useToast();
  return <button type="button" onClick={() => addToast({ type, message })}>Add</button>;
}

afterEach(() => { cleanup(); pathname.value = "/wallet"; });

/**
 * Colour and an icon are not a message. Every toast names its severity in text,
 * on public pages as well as in the dashboard, so the same sentence means the
 * same thing to a screen reader or in a grayscale screenshot.
 */
describe("toast severity", () => {
  it("spells out the severity and keeps the message", () => {
    render(<ToastProvider><Trigger type="error" message="The transfer was not sent." /></ToastProvider>);
    fireEvent.click(screen.getByRole("button", { name: "Add" }));
    expect(screen.getByText("Error")).toBeTruthy();
    expect(screen.getByText("The transfer was not sent.")).toBeTruthy();
  });

  it("uses text controls in the dashboard and icons elsewhere", () => {
    const view = render(<ToastProvider><Trigger type="success" message="Saved" /></ToastProvider>);
    fireEvent.click(screen.getByRole("button", { name: "Add" }));
    // Public surfaces keep their compact icon close control.
    expect(screen.getByRole("button", { name: "Dismiss notification" }).textContent).toBe("");
    cleanup();
    pathname.value = "/dashboard/wallet";
    render(<ToastProvider><Trigger type="success" message="Saved" /></ToastProvider>);
    fireEvent.click(screen.getByRole("button", { name: "Add" }));
    expect(screen.getByRole("button", { name: "Dismiss notification" }).textContent).toBe("Dismiss");
    view.unmount();
  });
});
