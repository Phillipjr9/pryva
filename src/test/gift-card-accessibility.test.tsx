// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { GiftCardsManager } from "@/app/dashboard/gift-cards/GiftCardsManager";
import type { PublicUser } from "@/lib/identity/auth";

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));

const user: PublicUser = {
  id: "buyer", name: "Ada", email: "ada@example.test", walletBalance: 2000,
  emailVerifiedAt: null, createdAt: new Date("2026-01-01"),
};
afterEach(cleanup);

describe("gift-card form accessibility", () => {
  it("associates visible labels with every create and redeem field", () => {
    render(<GiftCardsManager user={user} brandSalesEnabled={false} />);
    const amount = screen.getByLabelText("Custom Amount (₦1,000 - ₦500,000)") as HTMLInputElement;
    expect(screen.getByLabelText("Recipient Email (Optional)").tagName).toBe("INPUT");
    expect(screen.getByLabelText("Personal Message (Optional)").tagName).toBe("TEXTAREA");
    const presets = screen.getByRole("group", { name: "Select Amount" });
    const twoThousand = within(presets).getByRole("button", { name: "₦2,000" });
    fireEvent.click(twoThousand);
    expect(twoThousand.getAttribute("aria-pressed")).toBe("true");
    expect(amount.value).toBe("2000");

    fireEvent.click(screen.getByRole("button", { name: "Redeem Code" }));
    expect(screen.getByLabelText("Gift Card Code").tagName).toBe("INPUT");
  });
});
