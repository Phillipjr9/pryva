// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { TelegramProducts } from "@/app/dashboard/telegram-stars/TelegramProducts";
afterEach(() => { cleanup(); localStorage.clear(); vi.unstubAllGlobals(); });
describe("Telegram products", () => {
  it("shows live indicative prices, allows quantity selection, and keeps Premium gated", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, json: async () => ({ ok: true, stars: [{ quantity: 50, amount: 2100 }, { quantity: 100, amount: null }], premium: [{ months: 3, amount: 10500 }, { months: 6, amount: null }, { months: 12, amount: null }] }) }));
    render(<TelegramProducts userId="buyer" available={false} />);
    expect(await screen.findByText("₦2,100")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: /50.*₦2,100/ }));
    expect((screen.getByLabelText("Or enter a custom number of Stars") as HTMLInputElement).value).toBe("50");
    fireEvent.click(screen.getByRole("button", { name: "✦ Premium" }));
    expect(screen.getByRole("textbox", { name: "Recipient Telegram username" })).toBeTruthy();
    expect(screen.getByText("₦10,500")).toBeTruthy();
    expect((screen.getByRole("button", { name: "Premium ordering unavailable" }) as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(screen.getByRole("button", { name: "★ Stars" }));
    expect((screen.getByLabelText("Or enter a custom number of Stars") as HTMLInputElement).value).toBe("50");
  });
});
